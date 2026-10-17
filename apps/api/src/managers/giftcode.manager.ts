import {
  TICKET_TYPES,
  type AdminGiftCodeDto,
  type GiftCodePublicDto,
  type GiftCodeRedemptionDto,
  type GiftCodeReward,
  type TicketType,
} from '@tq/shared';
import { GIFT_CODE_MAX_TICKETS } from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso } from '../utils.ts';
import { invalidatePlayers } from '../cache.ts';
import { tx } from '../db.ts';
import { applyTicketDelta } from '../repositories/ticket.repository.ts';
import {
  findGiftCodeByCode,
  findGiftCodeRewards,
  giftCodeExists,
  hasRedemption,
  insertRedemption,
  listFeaturedGiftCodes as repoListFeaturedGiftCodes,
  listUserRedemptions,
  insertGiftCode,
  setGiftCodeActive,
  listAdminGiftCodes as repoListAdminGiftCodes,
  findAdminGiftCode,
  type GiftCodeRow,
  type AdminGiftCodeRow,
} from '../repositories/giftcode.repository.ts';
import { getTickets } from './ticket.manager.ts';

/**
 * Giftcode (mục 3.9) — CHỈ tặng vé quay.
 * - Mỗi giftcode gồm các dòng { kind: 'ticket', pool, count }: cộng `count` vé loại `pool` (ledger reason 'giftcode').
 * - Code thẻ cũ (kind 'card', trước migration v9) đã bị tắt, không nhập/bật lại được; lịch sử cũ giữ nguyên.
 * - Mỗi người chơi nhập mỗi code đúng 1 lần (UNIQUE code_id, user_id).
 * - Code có thể có hạn sử dụng (expires_at, null = không hạn) và có thể bị admin tắt.
 */

const CODE_RE = /^[A-Z0-9_-]{3,32}$/;
export const normalizeCode = (code: string) => code.trim().toUpperCase();

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

const isExpired = (row: GiftCodeRow, now: number) => row.expires_at !== null && Date.parse(row.expires_at) <= now;

/**
 * Người chơi nhập giftcode. Kiểm tra code tồn tại, đang bật, chưa hết hạn, người chơi chưa nhập;
 * cộng vé + ghi lượt nhập trong 1 transaction. Lỗi ở bất kỳ bước nào => không cộng vé nào.
 */
export function redeemGiftCode(ctx: GameContext, userId: number, rawCode: string): GiftCodeRedemptionDto {
  const code = normalizeCode(rawCode);
  if (!CODE_RE.test(code)) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
  const stored = tx(ctx.db, () => {
    const row = findGiftCodeByCode(ctx.db, code);
    if (!row || row.is_active !== 1) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
    const now = ctx.now();
    if (isExpired(row, now)) throw new AppError(410, 'GIFTCODE_EXPIRED', 'Giftcode đã hết hạn.');
    if (hasRedemption(ctx.db, row.id, userId)) throw new AppError(409, 'GIFTCODE_ALREADY_REDEEMED', 'Bạn đã nhập giftcode này rồi.');

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
    insertRedemption(ctx.db, { codeId: row.id, userId, ticketsSnapshot: JSON.stringify(tickets), createdAt: nowIso });
    return { code: row.code, rewards, tickets, createdAt: nowIso };
  });
  // Lượt nhập + vé vào sổ cái => lịch sử và danh sách Quản trị của người chơi đọc lại từ DB.
  invalidatePlayers(ctx.cache, userId);
  return { ...stored, balances: getTickets(ctx, userId) };
}

/** Giftcode gợi ý (featured, đang bật, chưa hết hạn) kèm trạng thái đã nhập của người chơi. */
export function listFeaturedGiftCodes(ctx: GameContext, userId: number): GiftCodePublicDto[] {
  const now = ctx.now();
  return repoListFeaturedGiftCodes(ctx.db, userId)
    .filter((r) => !isExpired(r, now))
    .map((r) => ({ code: r.code, rewards: parseRewards(r.rewards), expiresAt: r.expires_at, redeemed: r.redeemed === 1 }));
}

/** Các giftcode người chơi đã nhập (mới nhất trước). */
export function listMyRedemptions(
  ctx: GameContext,
  userId: number,
): { code: string; cardCount: number; ticketCount: number; createdAt: string }[] {
  return listUserRedemptions(ctx.db, userId).map((x) => {
    const ticketCount = (JSON.parse(x.tickets_snapshot) as { count: number }[]).reduce((s, t) => s + t.count, 0);
    return { code: x.code, cardCount: x.card_count, ticketCount, createdAt: x.created_at };
  });
}

// ======================= Admin =======================

function toAdminDto(r: AdminGiftCodeRow): AdminGiftCodeDto {
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

export function adminListGiftCodes(ctx: GameContext): AdminGiftCodeDto[] {
  return repoListAdminGiftCodes(ctx.db).map(toAdminDto);
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
    if (giftCodeExists(ctx.db, code)) throw new AppError(409, 'GIFTCODE_EXISTS', `Giftcode "${code}" đã tồn tại.`);
    const id = insertGiftCode(ctx.db, {
      code,
      rewards: JSON.stringify(rewards),
      totalTickets: rewards.reduce((s, r) => s + r.count, 0),
      expiresAt,
      featured: !!input.featured,
      createdBy: adminId,
      createdAt: iso(ctx.now()),
    });
    return toAdminDto(findAdminGiftCode(ctx.db, id)!);
  });
}

/** Bật/tắt giftcode. Code đã tắt không nhập được; lượt nhập cũ và thẻ đã nhận giữ nguyên. */
export function adminSetGiftCodeActive(ctx: GameContext, id: number, isActive: boolean): AdminGiftCodeDto {
  const row = findGiftCodeRewards(ctx.db, id);
  if (!row) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
  if (isActive && hasCards(parseRewards(row.rewards))) {
    throw new AppError(409, 'GIFTCODE_LEGACY', 'Giftcode tặng thẻ cũ không còn dùng được (giftcode chỉ tặng vé quay).');
  }
  const changes = setGiftCodeActive(ctx.db, id, isActive);
  if (changes !== 1) throw new AppError(404, 'GIFTCODE_NOT_FOUND', 'Giftcode không tồn tại.');
  return toAdminDto(findAdminGiftCode(ctx.db, id)!);
}
