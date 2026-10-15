import {
  TICKET_TYPES,
  type AdminApproveDto,
  type AdminCardDto,
  type AdminGrantDto,
  type AdminUserDto,
  type AdminUsersPage,
  type Faction,
  type Page,
  type TicketType,
  type UserStatus,
} from '@tq/shared';
import { ADMIN_GRANT_MAX_TICKETS, ROSTER } from '@tq/game-config';
import { AppError, iso, sha256, findIdempotent, saveIdempotent, type GameContext } from './context.ts';
import { tx } from './db.ts';
import { activateAccount } from './auth.ts';
import { applyTicketDelta, readBalances } from './tickets.ts';
import { foldVi } from './queries.ts';

/**
 * Trang quản trị (mục 3.8). Mọi hàm ở đây giả định người gọi ĐÃ được xác thực là admin
 * (server.ts kiểm tra bằng preHandler adminAuth).
 */

const likeEscape = (q: string) => `%${q.trim().replace(/[%_\\]/g, (m) => '\\' + m)}%`;

interface UserRow {
  id: number;
  username: string;
  status: UserStatus;
  is_admin: number;
  created_at: string;
  approved_at: string | null;
  card_count: number;
  max_level: number | null;
}

const USER_SELECT = `SELECT u.id, u.username, u.status, u.is_admin, u.created_at, u.approved_at,
  (SELECT COUNT(*) FROM user_cards c WHERE c.user_id = u.id AND c.status = 'active') AS card_count,
  (SELECT MAX(level) FROM user_cards c WHERE c.user_id = u.id AND c.status = 'active') AS max_level
  FROM users u`;

function toDto(ctx: GameContext, r: UserRow): AdminUserDto {
  const tickets = readBalances(ctx.db, r.id);
  return {
    id: r.id,
    username: r.username,
    status: r.status,
    isAdmin: r.is_admin === 1,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    tickets,
    ticketTotal: TICKET_TYPES.reduce((s, t) => s + tickets[t], 0),
    cardCount: r.card_count,
    maxLevel: r.max_level,
  };
}

function getUserRow(ctx: GameContext, userId: number): UserRow {
  const r = ctx.db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(userId) as UserRow | undefined;
  if (!r) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy người chơi.');
  return r;
}

export interface AdminUsersQuery {
  q?: string;
  status?: UserStatus;
  page?: number;
  pageSize?: number;
}

/** Danh sách người chơi: tài khoản chờ duyệt lên đầu, sau đó mới nhất trước. */
export function adminListUsers(ctx: GameContext, query: AdminUsersQuery): AdminUsersPage {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (query.q?.trim()) {
    where.push(`u.username LIKE $q ESCAPE '\\'`);
    params.q = likeEscape(query.q);
  }
  if (query.status) {
    where.push('u.status = $status');
    params.status = query.status;
  }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM users u${w}`).get(params) as { n: number }).n;
  const rows = ctx.db
    .prepare(`${USER_SELECT}${w} ORDER BY (u.status = 'pending') DESC, u.id DESC LIMIT $limit OFFSET $offset`)
    .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as unknown as UserRow[];
  const pendingCount = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'pending'`).get() as { n: number }).n;
  return { items: rows.map((r) => toDto(ctx, r)), page, pageSize, total, pendingCount, grantMaxTickets: ADMIN_GRANT_MAX_TICKETS };
}

/**
 * Duyệt tài khoản: pending → approved, kích hoạt (số dư vé, mốc hồi vé, quà đăng ký) trong 1 transaction.
 * Duyệt lại tài khoản đã duyệt => 409 ALREADY_APPROVED (không cấp quà lần 2).
 */
export function approveUser(ctx: GameContext, userId: number): AdminApproveDto {
  return tx(ctx.db, () => {
    const row = getUserRow(ctx, userId);
    if (row.status !== 'pending') throw new AppError(409, 'ALREADY_APPROVED', 'Tài khoản đã được duyệt.');
    const now = ctx.now();
    const upd = ctx.db
      .prepare(`UPDATE users SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'`)
      .run(iso(now), userId);
    if (upd.changes !== 1) throw new AppError(409, 'ALREADY_APPROVED', 'Tài khoản đã được duyệt.');
    const signupBonus = activateAccount(ctx, userId, now);
    return { user: toDto(ctx, getUserRow(ctx, userId)), signupBonus };
  });
}

/** Từ chối đăng ký: xoá tài khoản đang chờ duyệt (chưa có vé/thẻ/lịch sử). Tên đăng nhập được giải phóng. */
export function rejectUser(ctx: GameContext, userId: number): { ok: true; username: string } {
  return tx(ctx.db, () => {
    const row = getUserRow(ctx, userId);
    if (row.status !== 'pending') throw new AppError(409, 'NOT_PENDING', 'Chỉ từ chối được tài khoản đang chờ duyệt.');
    ctx.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    ctx.db.prepare(`DELETE FROM users WHERE id = ? AND status = 'pending'`).run(userId);
    return { ok: true as const, username: row.username };
  });
}

/** Cấp/thu quyền admin. Không tự thu quyền của chính mình (luôn còn ít nhất 1 admin). */
export function setAdmin(ctx: GameContext, actorId: number, userId: number, value: boolean): AdminUserDto {
  return tx(ctx.db, () => {
    const row = getUserRow(ctx, userId);
    if (row.status !== 'approved') throw new AppError(409, 'NOT_APPROVED', 'Tài khoản chưa được duyệt.');
    if (!value && userId === actorId) throw new AppError(400, 'ADMIN_SELF', 'Không thể tự thu quyền quản trị của chính mình.');
    ctx.db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(value ? 1 : 0, userId);
    return toDto(ctx, getUserRow(ctx, userId));
  });
}

/**
 * Admin cộng vé cho người chơi (mục 3.7): admin chọn loại vé + số lượng (1–ADMIN_GRANT_MAX_TICKETS).
 * - Chỉ cho tài khoản đã duyệt. Cộng số dư + ghi ledger reason 'admin_grant' trong 1 transaction.
 * - Idempotency key gắn với admin: retry trả kết quả cũ; cùng key cho yêu cầu khác => 409.
 */
export function adminGrantTickets(
  ctx: GameContext,
  adminId: number,
  userId: number,
  ticketType: TicketType,
  amount: number,
  idempotencyKey: string,
): AdminGrantDto {
  if (!(TICKET_TYPES as readonly string[]).includes(ticketType)) {
    throw new AppError(400, 'INVALID_TICKET_TYPE', 'Loại vé không hợp lệ.');
  }
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > ADMIN_GRANT_MAX_TICKETS) {
    throw new AppError(400, 'INVALID_AMOUNT', `Số vé mỗi lần cộng phải từ 1 đến ${ADMIN_GRANT_MAX_TICKETS}.`);
  }
  const requestHash = sha256(JSON.stringify({ userId, ticketType, amount }));
  return tx(ctx.db, () => {
    const prev = findIdempotent<AdminGrantDto>(ctx.db, adminId, 'admin_grant', idempotencyKey, requestHash);
    if (prev) return prev;
    const row = getUserRow(ctx, userId);
    if (row.status !== 'approved') throw new AppError(409, 'NOT_APPROVED', 'Tài khoản chưa được duyệt, chưa thể cộng vé.');
    // Tài khoản quản trị không chơi game => không cộng vé cho admin
    if (row.is_admin === 1) throw new AppError(409, 'TARGET_IS_ADMIN', 'Không cộng vé cho tài khoản quản trị (admin không chơi game).');
    const nowIso = iso(ctx.now());
    applyTicketDelta(ctx.db, userId, ticketType, amount, 'admin_grant', `admin:${adminId}:${idempotencyKey}`, idempotencyKey, nowIso);
    const result: AdminGrantDto = {
      userId,
      username: row.username,
      ticketType,
      amount,
      balances: readBalances(ctx.db, userId),
    };
    saveIdempotent(ctx.db, adminId, 'admin_grant', idempotencyKey, requestHash, result, nowIso);
    return result;
  });
}

export interface AdminCardsQuery {
  userId?: number;
  faction?: Faction;
  level?: number;
  q?: string;
  sort?: 'newest' | 'level_desc' | 'level_asc' | 'name' | 'owner';
  page?: number;
  pageSize?: number;
}

/** Mọi thẻ đang active của mọi người chơi (chỉ đọc), có lọc và phân trang. */
export function adminListCards(ctx: GameContext, query: AdminCardsQuery): Page<AdminCardDto> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 60;
  const where = ["c.status = 'active'"];
  const params: (string | number)[] = [];
  if (query.userId) {
    where.push('c.user_id = ?');
    params.push(query.userId);
  }
  if (query.faction) {
    where.push('g.faction = ?');
    params.push(query.faction);
  }
  if (query.level) {
    where.push('c.level = ?');
    params.push(query.level);
  }
  if (query.q?.trim()) {
    const needle = foldVi(query.q.trim());
    const ids = ROSTER.filter((g) => foldVi(g.name).includes(needle) || g.id.includes(needle)).map((g) => g.id);
    if (ids.length === 0) return { items: [], page, pageSize, total: 0 };
    where.push(`c.general_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const order =
    query.sort === 'level_desc'
      ? 'c.level DESC, c.id DESC'
      : query.sort === 'level_asc'
        ? 'c.level ASC, c.id DESC'
        : query.sort === 'name'
          ? 'g.name ASC, c.level DESC, c.id ASC'
          : query.sort === 'owner'
            ? 'u.username COLLATE NOCASE ASC, c.level DESC, c.id ASC'
            : 'c.id DESC';
  const from = `FROM user_cards c JOIN generals g ON g.id = c.general_id JOIN users u ON u.id = c.user_id WHERE ${where.join(' AND ')}`;
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as { n: number }).n;
  const rows = ctx.db
    .prepare(`SELECT c.id, c.user_id, u.username, c.general_id, c.level, c.created_at ${from} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as {
    id: number;
    user_id: number;
    username: string;
    general_id: string;
    level: number;
    created_at: string;
  }[];
  return {
    items: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      username: r.username,
      generalId: r.general_id,
      level: r.level,
      createdAt: r.created_at,
    })),
    page,
    pageSize,
    total,
  };
}
