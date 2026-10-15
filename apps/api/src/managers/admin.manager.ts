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
import { ADMIN_GRANT_MAX_TICKETS } from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso, sha256, searchGeneralIds } from '../utils.ts';
import { tx } from '../db.ts';
import {
  queryAdminUsers,
  findAdminUserRow,
  approveUserRow,
  deletePendingUser,
  deleteSessionsForUser,
  updateUserAdmin,
  type AdminUserRow,
} from '../repositories/user.repository.ts';
import { applyTicketDelta, readBalances } from '../repositories/ticket.repository.ts';
import { listAllCards, type AdminCardsFilter } from '../repositories/card.repository.ts';
import { findIdempotent, saveIdempotent } from '../repositories/idempotency.repository.ts';
import { activateAccount } from './auth.manager.ts';

/**
 * Trang quản trị (mục 3.8). Mọi hàm ở đây giả định người gọi ĐÃ được xác thực là admin
 * (controller/admin.controller.ts kiểm tra bằng preHandler adminGuard).
 */

function toDto(ctx: GameContext, r: AdminUserRow): AdminUserDto {
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

function getUserRow(ctx: GameContext, userId: number): AdminUserRow {
  const r = findAdminUserRow(ctx.db, userId);
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
  const { rows, total, pendingCount } = queryAdminUsers(ctx.db, {
    username: query.q,
    status: query.status,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
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
    const changes = approveUserRow(ctx.db, userId, iso(now));
    if (changes !== 1) throw new AppError(409, 'ALREADY_APPROVED', 'Tài khoản đã được duyệt.');
    const signupBonus = activateAccount(ctx, userId, now);
    return { user: toDto(ctx, getUserRow(ctx, userId)), signupBonus };
  });
}

/** Từ chối đăng ký: xoá tài khoản đang chờ duyệt (chưa có vé/thẻ/lịch sử). Tên đăng nhập được giải phóng. */
export function rejectUser(ctx: GameContext, userId: number): { ok: true; username: string } {
  return tx(ctx.db, () => {
    const row = getUserRow(ctx, userId);
    if (row.status !== 'pending') throw new AppError(409, 'NOT_PENDING', 'Chỉ từ chối được tài khoản đang chờ duyệt.');
    deleteSessionsForUser(ctx.db, userId);
    deletePendingUser(ctx.db, userId);
    return { ok: true as const, username: row.username };
  });
}

/** Cấp/thu quyền admin. Không tự thu quyền của chính mình (luôn còn ít nhất 1 admin). */
export function setAdmin(ctx: GameContext, actorId: number, userId: number, value: boolean): AdminUserDto {
  return tx(ctx.db, () => {
    const row = getUserRow(ctx, userId);
    if (row.status !== 'approved') throw new AppError(409, 'NOT_APPROVED', 'Tài khoản chưa được duyệt.');
    if (!value && userId === actorId) throw new AppError(400, 'ADMIN_SELF', 'Không thể tự thu quyền quản trị của chính mình.');
    updateUserAdmin(ctx.db, userId, value);
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
  const filter: AdminCardsFilter = {
    userId: query.userId,
    faction: query.faction,
    level: query.level,
    generalIds: query.q?.trim() ? searchGeneralIds(query.q) : undefined,
    sort: query.sort,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
  const { rows, total } = listAllCards(ctx.db, filter);
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
