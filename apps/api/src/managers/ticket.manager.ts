import {
  TICKET_TYPES,
  type TicketBalances,
  type TicketsDto,
  type ClaimRecoveryDto,
  type DevTopupDto,
} from '@tq/shared';
import {
  RECOVERY_INTERVAL_MS,
  RECOVERY_BATCH_SIZE,
  SIGNUP_BONUS_TICKETS,
  DEV_TOPUP_TICKETS,
  RECOVERY_CAP_PER_TYPE,
  rollTicketType,
  rollTicketTypeAmong,
} from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso } from '../utils.ts';
import { DROP } from '../cache.ts';
import { tx } from '../db.ts';
import {
  applyTicketDelta,
  readBalances,
  emptyBalances,
  floorToSlot,
  findRecoveryState,
  advanceRecoveryState,
} from '../repositories/ticket.repository.ts';
import { findIdempotent, saveIdempotent } from '../repositories/idempotency.repository.ts';

/**
 * Nghiệp vụ vé (mục 3.6, 3.7, 8.2): quà đăng ký, nút cộng vé thử nghiệm, hồi vé theo mốc.
 */

/**
 * Quà đăng ký: cấp SIGNUP_BONUS_TICKETS vé, mỗi vé roll loại độc lập (server RNG).
 * Ghi 1 dòng ledger cho mỗi loại vé nhận được (amount_delta = số vé loại đó).
 * PHẢI gọi trong transaction tạo tài khoản; unique index chặn cấp lần 2.
 */
export function grantSignupBonus(ctx: GameContext, userId: number, nowIso: string): TicketBalances {
  const granted = emptyBalances();
  for (let i = 0; i < SIGNUP_BONUS_TICKETS; i++) granted[rollTicketType(ctx.rand)]++;
  for (const t of TICKET_TYPES) {
    if (granted[t] > 0) applyTicketDelta(ctx.db, userId, t, granted[t], 'signup_bonus', 'signup', null, nowIso);
  }
  return granted;
}

/**
 * Nút cộng vé thử nghiệm: cấp DEV_TOPUP_TICKETS vé, mỗi vé roll loại độc lập (server RNG).
 * - Chỉ chạy khi server bật features.devTopup (ENABLE_DEV_TOPUP); nếu tắt => 404.
 * - Không giới hạn số lần bấm. Mỗi lần bấm có 1 idempotency key: retry trả kết quả cũ, không cấp thêm.
 * - Ghi ledger reason 'dev_topup', mỗi loại vé 1 dòng. Tất cả trong 1 transaction.
 */
export function devTopup(ctx: GameContext, userId: number, idempotencyKey: string): DevTopupDto {
  if (!ctx.features?.devTopup) throw new AppError(404, 'FEATURE_DISABLED', 'Tính năng cộng vé thử nghiệm đang tắt.');
  const requestHash = 'dev_topup';
  const stored = tx(ctx.db, (): Omit<DevTopupDto, 'tickets'> => {
    const prev = findIdempotent<Omit<DevTopupDto, 'tickets'>>(ctx.db, userId, 'dev_topup', idempotencyKey, requestHash);
    if (prev) return prev;
    const nowIso = iso(ctx.now());
    const granted = emptyBalances();
    for (let i = 0; i < DEV_TOPUP_TICKETS; i++) granted[rollTicketType(ctx.rand)]++;
    for (const t of TICKET_TYPES) {
      if (granted[t] > 0) {
        applyTicketDelta(ctx.db, userId, t, granted[t], 'dev_topup', `devtopup:${idempotencyKey}`, idempotencyKey, nowIso);
      }
    }
    const result = { granted, grantedTotal: DEV_TOPUP_TICKETS };
    saveIdempotent(ctx.db, userId, 'dev_topup', idempotencyKey, requestHash, result, nowIso);
    return result;
  });
  // Vé vào sổ cái => lịch sử của người chơi phải đọc lại.
  ctx.cache.drop([DROP.history(userId)]);
  return { ...stored, tickets: getTickets(ctx, userId) };
}

/**
 * Xử lý toàn bộ mốc hồi vé chưa xử lý (mục 3.6, 8.2).
 * - Mỗi mốc hồi (RECOVERY_INTERVAL_MS, hiện 1 phút) UTC = đúng 1 vé, loại vé roll độc lập.
 * - Chia batch nội bộ; mỗi batch là 1 transaction: cấp vé + ledger + cập nhật mốc.
 *   Nếu lỗi giữa chừng, các batch đã commit được giữ, lần gọi sau tiếp tục từ mốc đã lưu.
 * - Unique index (user_id, reference_id) cho reason=time_recovery chặn cấp trùng mốc.
 * - Trần RECOVERY_CAP_PER_TYPE theo loại CHỈ cho vé hồi: mỗi mốc random trong các loại còn dưới trần;
 *   cả 5 loại đã đầy thì mốc đó được đánh dấu đã xử lý mà không cấp vé (không cộng bù).
 */
export function syncRecoveryDetailed(ctx: GameContext, userId: number): { granted: TicketBalances; skippedFull: number } {
  const granted = emptyBalances();
  let skippedFull = 0;
  for (;;) {
    const done = tx(ctx.db, () => {
      const now = ctx.now();
      const nowSlot = floorToSlot(now);
      const state = findRecoveryState(ctx.db, userId);
      if (!state) throw new AppError(500, 'RECOVERY_STATE_MISSING', 'Thiếu trạng thái hồi vé.');
      const last = Date.parse(state.last_processed_recovery_at);
      if (!Number.isFinite(last) || last % RECOVERY_INTERVAL_MS !== 0) {
        throw new AppError(500, 'RECOVERY_STATE_INVALID', 'Trạng thái hồi vé không hợp lệ.');
      }
      if (last >= nowSlot) return true;
      const pending = (nowSlot - last) / RECOVERY_INTERVAL_MS;
      const n = Math.min(pending, RECOVERY_BATCH_SIZE);
      const nowIso = iso(now);
      const bal = readBalances(ctx.db, userId);
      for (let i = 1; i <= n; i++) {
        const open = TICKET_TYPES.filter((t) => bal[t] < RECOVERY_CAP_PER_TYPE[t]);
        const type = rollTicketTypeAmong(ctx.rand, open);
        if (type === null) {
          skippedFull++; // cả 5 loại đã đầy: mốc này không cấp vé
          continue;
        }
        const slotIso = iso(last + i * RECOVERY_INTERVAL_MS);
        applyTicketDelta(ctx.db, userId, type, 1, 'time_recovery', slotIso, null, nowIso);
        bal[type]++;
        granted[type]++;
      }
      const newLast = iso(last + n * RECOVERY_INTERVAL_MS);
      const changes = advanceRecoveryState(ctx.db, userId, newLast, state.last_processed_recovery_at, nowIso);
      if (changes !== 1) throw new AppError(409, 'CONCURRENT_UPDATE', 'Trạng thái hồi vé vừa thay đổi.');
      return n === pending;
    });
    if (done) break;
  }
  // Vé hồi ghi thêm dòng sổ cái => lịch sử của người chơi phải đọc lại (cache 30s coi như trượt).
  if (TICKET_TYPES.some((t) => granted[t] > 0)) ctx.cache.drop([DROP.history(userId)]);
  return { granted, skippedFull };
}

export function syncRecovery(ctx: GameContext, userId: number): TicketBalances {
  return syncRecoveryDetailed(ctx, userId).granted;
}

export function getTickets(ctx: GameContext, userId: number): TicketsDto {
  const balances = readBalances(ctx.db, userId);
  const state = findRecoveryState(ctx.db, userId) as { last_processed_recovery_at: string };
  const now = ctx.now();
  const next = floorToSlot(now) + RECOVERY_INTERVAL_MS;
  return {
    balances,
    total: TICKET_TYPES.reduce((s, t) => s + balances[t], 0),
    lastProcessedRecoveryAt: state.last_processed_recovery_at,
    nextRecoveryAt: iso(next),
    serverNow: iso(now),
    msUntilNextRecovery: next - now,
    recoveryCap: { ...RECOVERY_CAP_PER_TYPE },
  };
}

export function claimRecovery(ctx: GameContext, userId: number): ClaimRecoveryDto {
  const { granted, skippedFull } = syncRecoveryDetailed(ctx, userId);
  return {
    ...getTickets(ctx, userId),
    granted,
    skippedFull,
    grantedTotal: TICKET_TYPES.reduce((s, t) => s + granted[t], 0),
  };
}
