import {
  TICKET_TYPES,
  type AdminGiftCodeDto,
  type GiftCodePublicDto,
  type GiftCodeRedemptionDto,
  type GiftCodeReward,
  type TicketType,
} from '@tq/shared';
import { GIFT_CODE_MAX_TICKETS } from '@tq/game-config';
import { AppError, iso, type GameContext } from './context.ts';
import { tx } from './db.ts';
import { applyTicketDelta, getTickets } from './tickets.ts';

/**
 * Giftcode (mục 3.9) — CHỈ tặng vé quay.
 * - Mỗi giftcode gồm các dòng { kind: 'ticket', pool, count }: cộng `count` vé loại `pool` (ledger reason 'giftcode').
 * - Code thẻ cũ (kind 'card', trước migration v9) đã bị tắt, không nhập/bật lại được; lịch sử cũ giữ nguyên.
 * - Mỗi người chơi nhập mỗi code đúng 1 lần (UNIQUE code_id, user_id).
 * - Code có thể có hạn sử dụng (expires_at, null = không hạn) và có thể bị admin tắt.
 */

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
export const normalizeCode = (code: string) => code.trim().toUpperCase();

interface CodeRow {
  id: number;
  code: string;
  rewards: string;
  total_cards: number;
  total_tickets: number;
  expires_at: string | null;
  is_active: number;
  featured: number;
  created_by: number | null;
  created_at: string;
}

/** Đọc phần thưởng đã lưu; dòng cũ (trước migration v8) không có `kind` là thẻ (code thẻ cũ). */
const parseRewards = (json: string) =>
  (JSON.parse(json) as Partial<GiftCodeReward>[]).map((r) => ({ kind: r.kind ?? 'card', pool: r.pool!, count: r.count! }));

const hasCards = (rewards: GiftCodeReward[]) => rewards.some((r) => r.kind !== 'ticket');

/** Validate + gộp các dòng cùng loại vé. Chỉ nhận vé quay; tổng vé 1–GIFT_CODE_MAX_TICKETS. */
export function normalizeRewards(rewards: Partial<GiftCodeReward>[]): GiftCodeReward[] {
  if (!Array.isArray(rewards) || rewards.length === 0) {
    throw new AppError(400, 'INVALID_REWARDS', 'Giftcode phải có ít nhất 1 loại vé.');
  }
  const sums = new Map<TicketType, number>();
  for (const r of rewards) {
    if ((r.kind ?? 'ticket') !== 'ticket') throw new AppError(400, 'INVALID_REWARDS', 'Giftcode chỉ tặng vé quay.');
    if (!(TICKET_TYPES as readonly string[]).includes(r.pool as string)) throw new AppError(400, 'INVALID_REWARDS', 'Loại vé không hợp lệ.');
    if (!Number.isSafeInteger(r.count) || r.count! < 1) throw new AppError(400, 'INVALID_REWARDS', 'Số vé phải là số nguyên ≥ 1.');
    sums.set(r.pool!, (sums.get(r.pool!) ?? 0) + r.count!);
  }
  const out = TICKET_TYPES.filter((t) => sums.has(t)).map((t) => ({ kind: 'ticket' as const, pool: t, count: sums.get(t)! }));
  if (out.reduce((s, r) => s + r.count, 0) > GIFT_CODE_MAX_TICKETS) {
    throw new AppError(400, 'INVALID_REWARDS', `Mỗi giftcode tối đa ${GIFT_CODE_MAX_TICKETS} vé.`);
  }
  return out;
}

const isExpired = (row: CodeRow, now: number) => row.expires_at !== null && Date.parse(row.expires_at) <= now;

/**
 * Người chơi nhập giftcode. Kiểm tra code tồn tại, đang bật, chưa hết hạn, người chơi chưa nhập;
 * cộng vé + ghi lượt nhập trong 1 transaction. Lỗi ở bất kỳ bước nào => không cộng vé nào.
 */
export function redeemGiftCode(ctx: GameContext, userId: number, rawCode: string): GiftCodeRedemptionDto {
  const code = normalizeCode(rawCode);
  if (!CODE_RE.test(code)) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
  const stored = tx(ctx.db, () => {
    const row = ctx.db.prepare('SELECT * FROM gift_codes WHERE code = ?').get(code) as CodeRow | undefined;
    if (!row || row.is_active !== 1) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
    const now = ctx.now();
    if (isExpired(row, now)) throw new AppError(410, 'GIFTCODE_EXPIRED', 'Giftcode đã hết hạn.');
    const used = ctx.db.prepare('SELECT 1 FROM gift_code_redemptions WHERE code_id = ? AND user_id = ?').get(row.id, userId);
    if (used) throw new AppError(409, 'GIFTCODE_ALREADY_REDEEMED', 'Bạn đã nhập giftcode này rồi.');

    const nowIso = iso(now);
    const rewards = parseRewards(row.rewards);
    // Code thẻ cũ không còn dùng được (giftcode chỉ tặng vé)
    if (hasCards(rewards)) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
    const tickets: { pool: TicketType; count: number }[] = [];
    for (const r of rewards) {
      // Cộng vé + ledger; unique index (user, giftcode:{id}, loại vé) chặn cộng lần 2
      applyTicketDelta(ctx.db, userId, r.pool, r.count, 'giftcode', `giftcode:${row.id}`, null, nowIso);
      tickets.push({ pool: r.pool, count: r.count });
    }
    // UNIQUE (code_id, user_id) chặn nhập 2 lần kể cả khi 2 request chạy đồng thời
    ctx.db
      .prepare(
        'INSERT INTO gift_code_redemptions (code_id, user_id, cards_snapshot, card_count, tickets_snapshot, created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(row.id, userId, '[]', 0, JSON.stringify(tickets), nowIso);
    return { code: row.code, rewards, tickets, createdAt: nowIso };
  });
  return { ...stored, balances: getTickets(ctx, userId) };
}

/** Giftcode gợi ý (featured, đang bật, chưa hết hạn) kèm trạng thái đã nhập của người chơi. */
export function listFeaturedGiftCodes(ctx: GameContext, userId: number): GiftCodePublicDto[] {
  const now = ctx.now();
  const rows = ctx.db
    .prepare(
      `SELECT g.*, EXISTS(SELECT 1 FROM gift_code_redemptions r WHERE r.code_id = g.id AND r.user_id = ?) AS redeemed
         FROM gift_codes g WHERE g.featured = 1 AND g.is_active = 1 ORDER BY g.id`,
    )
    .all(userId) as unknown as (CodeRow & { redeemed: number })[];
  return rows
    .filter((r) => !isExpired(r, now))
    .map((r) => ({ code: r.code, rewards: parseRewards(r.rewards), expiresAt: r.expires_at, redeemed: r.redeemed === 1 }));
}

/** Các giftcode người chơi đã nhập (mới nhất trước). */
export function listMyRedemptions(
  ctx: GameContext,
  userId: number,
): { code: string; cardCount: number; ticketCount: number; createdAt: string }[] {
  return ctx.db
    .prepare(
      `SELECT g.code, r.card_count, r.tickets_snapshot, r.created_at FROM gift_code_redemptions r JOIN gift_codes g ON g.id = r.code_id
        WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 200`,
    )
    .all(userId)
    .map((r) => {
      const x = r as { code: string; card_count: number; tickets_snapshot: string; created_at: string };
      const ticketCount = (JSON.parse(x.tickets_snapshot) as { count: number }[]).reduce((s, t) => s + t.count, 0);
      return { code: x.code, cardCount: x.card_count, ticketCount, createdAt: x.created_at };
    });
}

// ======================= Admin =======================

function toAdminDto(r: CodeRow & { redemption_count: number; creator: string | null }): AdminGiftCodeDto {
  return {
    id: r.id,
    code: r.code,
    rewards: parseRewards(r.rewards),
    totalCards: r.total_cards,
    totalTickets: r.total_tickets,
    expiresAt: r.expires_at,
    isActive: r.is_active === 1,
    featured: r.featured === 1,
    redemptionCount: r.redemption_count,
    createdBy: r.creator,
    createdAt: r.created_at,
  };
}

const ADMIN_SELECT = `SELECT g.*, (SELECT COUNT(*) FROM gift_code_redemptions r WHERE r.code_id = g.id) AS redemption_count,
  u.username AS creator FROM gift_codes g LEFT JOIN users u ON u.id = g.created_by`;

export function adminListGiftCodes(ctx: GameContext): AdminGiftCodeDto[] {
  return (ctx.db.prepare(`${ADMIN_SELECT} ORDER BY g.id DESC`).all() as unknown as Parameters<typeof toAdminDto>[0][]).map(toAdminDto);
}

/** Admin tạo giftcode. Code duy nhất (không phân biệt hoa thường), lưu dạng IN HOA. expiresAt null = không hạn. */
export function adminCreateGiftCode(
  ctx: GameContext,
  adminId: number,
  input: { code: string; rewards: Partial<GiftCodeReward>[]; expiresAt?: string | null; featured?: boolean },
): AdminGiftCodeDto {
  const code = normalizeCode(input.code);
  if (!CODE_RE.test(code)) throw new AppError(400, 'INVALID_CODE', 'Mã chỉ gồm chữ, số, "-" hoặc "_", dài 3–32 ký tự.');
  const rewards = normalizeRewards(input.rewards);
  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const t = Date.parse(input.expiresAt);
    if (!Number.isFinite(t)) throw new AppError(400, 'INVALID_EXPIRY', 'Hạn sử dụng không hợp lệ.');
    if (t <= ctx.now()) throw new AppError(400, 'INVALID_EXPIRY', 'Hạn sử dụng phải ở tương lai.');
    expiresAt = iso(t);
  }
  return tx(ctx.db, () => {
    if (ctx.db.prepare('SELECT 1 FROM gift_codes WHERE code = ?').get(code)) {
      throw new AppError(409, 'GIFTCODE_EXISTS', `Giftcode "${code}" đã tồn tại.`);
    }
    const r = ctx.db
      .prepare(
        `INSERT INTO gift_codes (code, rewards, total_cards, total_tickets, expires_at, is_active, featured, created_by, created_at)
         VALUES (?,?,?,?,?,1,?,?,?)`,
      )
      .run(code, JSON.stringify(rewards), 0, rewards.reduce((s, r) => s + r.count, 0), expiresAt, input.featured ? 1 : 0, adminId, iso(ctx.now()));
    return toAdminDto(ctx.db.prepare(`${ADMIN_SELECT} WHERE g.id = ?`).get(Number(r.lastInsertRowid)) as never);
  });
}

/** Bật/tắt giftcode. Code đã tắt không nhập được; lượt nhập cũ và thẻ đã nhận giữ nguyên. */
export function adminSetGiftCodeActive(ctx: GameContext, id: number, isActive: boolean): AdminGiftCodeDto {
  const row = ctx.db.prepare('SELECT rewards FROM gift_codes WHERE id = ?').get(id) as { rewards: string } | undefined;
  if (!row) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
  if (isActive && hasCards(parseRewards(row.rewards))) {
    throw new AppError(409, 'GIFTCODE_LEGACY', 'Giftcode tặng thẻ cũ không còn dùng được (giftcode chỉ tặng vé quay).');
  }
  const upd = ctx.db.prepare('UPDATE gift_codes SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
  if (upd.changes !== 1) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
  return toAdminDto(ctx.db.prepare(`${ADMIN_SELECT} WHERE g.id = ?`).get(id) as never);
}
