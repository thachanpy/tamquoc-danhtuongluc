import {
  TICKET_TYPES,
  TICKET_LABELS,
  type TicketType,
  type GemDto,
  type GachaConfigDto,
  type DrawResultDto,
  type DrawnCardDto,
} from '@tq/shared';
import {
  gachaLevelRates,
  GACHA_LEVEL_SCALE,
  BPS_SCALE,
  DRAW_COUNT_OPTIONS,
  DRAW_ALL_MAX,
  UPGRADE_INPUT_COUNT,
  QUICK_UPGRADE_MAX_LEVEL,
  GIFT_MAX_CARDS,
  GIFT_CODE_MAX_TICKETS,
  upgradeRateTable,
  GENERALS_BY_ID,
  poolForTicket,
  rollGemDrop,
  rollLevel,
} from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso, sha256 } from '../utils.ts';
import { invalidatePlayers } from '../cache.ts';
import { tx } from '../db.ts';
import { applyTicketDelta, readBalances } from '../repositories/ticket.repository.ts';
import { insertCard } from '../repositories/card.repository.ts';
import { insertGem } from '../repositories/gem.repository.ts';
import { insertGacha } from '../repositories/gacha.repository.ts';
import { findIdempotent, saveIdempotent } from '../repositories/idempotency.repository.ts';
import { syncRecovery, getTickets } from './ticket.manager.ts';

export function getGachaConfig(): GachaConfigDto {
  return {
    ticketTypes: TICKET_TYPES.map((id) => ({ id, label: TICKET_LABELS[id], pool: poolForTicket(id).map((g) => g.id) })),
    levelRates: gachaLevelRates().map((e) => ({ ...e })),
    /** Đơn vị của `levelRates` (khác `bpsScale` vì Lv9 = 0.005% cần thang chi tiết hơn). */
    levelScale: GACHA_LEVEL_SCALE,
    bpsScale: BPS_SCALE,
    drawCountOptions: [...DRAW_COUNT_OPTIONS],
    drawAllMax: DRAW_ALL_MAX,
    upgradeInputCount: UPGRADE_INPUT_COUNT,
    quickUpgradeMaxLevel: QUICK_UPGRADE_MAX_LEVEL,
    giftMaxCards: GIFT_MAX_CARDS,
    giftCodeMaxTickets: GIFT_CODE_MAX_TICKETS,
    upgradeRates: upgradeRateTable(),
  };
}

type StoredDraw = Omit<DrawResultDto, 'tickets'>;

/**
 * Quay `count` lần bằng loại vé đã chọn (mục 4.1, 4.4). Mọi kết quả do server quyết định.
 * - Số lần thực sự quay = min(count, số dư loại vé). Số dư 0 => NO_TICKETS.
 * - count = DRAW_ALL_MAX ("Mở tất cả") quay hết vé loại đã chọn, tối đa DRAW_ALL_MAX lượt.
 * - Toàn bộ lượt quay nằm trong MỘT transaction: lỗi ở bất kỳ lượt nào => không mất vé, không tạo thẻ.
 * - Mỗi lượt có 1 dòng ledger (-1) và 1 dòng gacha_history riêng.
 * - Một idempotency key cho cả lần bấm; retry trả lại đúng kết quả đã lưu.
 */
export function draw(
  ctx: GameContext,
  userId: number,
  ticketType: TicketType,
  idempotencyKey: string,
  count = 1,
): DrawResultDto {
  if (!TICKET_TYPES.includes(ticketType)) throw new AppError(400, 'INVALID_TICKET_TYPE', 'Loại vé không hợp lệ.');
  // count = DRAW_ALL_MAX là nút "Mở tất cả": quay hết vé loại này, tối đa DRAW_ALL_MAX lượt mỗi lần bấm
  if (!DRAW_COUNT_OPTIONS.includes(count) && count !== DRAW_ALL_MAX) {
    throw new AppError(400, 'INVALID_DRAW_COUNT', `Số lần quay phải là một trong: ${[...DRAW_COUNT_OPTIONS, DRAW_ALL_MAX].join(', ')}.`);
  }

  // Bước 2: đồng bộ mốc hồi vé trước khi kiểm tra số dư.
  syncRecovery(ctx, userId);

  const requestHash = sha256(JSON.stringify({ ticketType, count }));
  const stored = tx(ctx.db, (): StoredDraw => {
    const prev = findIdempotent<StoredDraw>(ctx.db, userId, 'gacha_draw', idempotencyKey, requestHash);
    if (prev) return prev;

    // Bước 3: số lượt thực tế theo số dư hiện tại
    const balance = readBalances(ctx.db, userId)[ticketType];
    if (balance <= 0) throw new AppError(409, 'NO_TICKETS', 'Không đủ vé loại này.');
    const n = Math.min(count, balance);

    const nowIso = iso(ctx.now());
    const pool = poolForTicket(ticketType);
    if (pool.length === 0) throw new AppError(500, 'POOL_EMPTY', 'Pool tướng rỗng.');

    const results: DrawnCardDto[] = [];
    for (let i = 0; i < n; i++) {
      // Key con cho từng lượt; '#' không thể xuất hiện trong key client (schema chỉ cho [A-Za-z0-9_-]).
      const rowKey = count === 1 ? idempotencyKey : `${idempotencyKey}#${i + 1}`;
      // Bước 4: tiêu 1 vé (ném NO_TICKETS nếu hết => rollback toàn bộ)
      const ttxId = applyTicketDelta(ctx.db, userId, ticketType, -1, 'gacha_draw', `gacha:${rowKey}`, idempotencyKey, nowIso);
      // Bước 5-7: chọn đều trong pool, roll level độc lập
      const general = pool[ctx.rand(pool.length)]!;
      const level = rollLevel(gachaLevelRates(), ctx.rand);
      // Bước 8-9: tạo thẻ + lịch sử
      const cardId = insertCard(ctx.db, userId, general.id, level, nowIso);
      // Ngọc Ngũ Hành đính kèm: tỉ lệ rớt + trọng số từng hệ do Admin cấu hình; Ngọc cùng cấp với Tướng.
      const gemElement = rollGemDrop(ctx.rand);
      const gem: GemDto | null = gemElement
        ? { id: insertGem(ctx.db, userId, gemElement, level, nowIso), element: gemElement, level, createdAt: nowIso }
        : null;
      const drawId = insertGacha(ctx.db, {
        userId,
        ticketType,
        generalId: general.id,
        cardId,
        cardLevel: level,
        ticketTransactionId: ttxId,
        idempotencyKey: rowKey,
        createdAt: nowIso,
      });
      results.push({
        drawId,
        card: { id: cardId, generalId: general.id, level, createdAt: nowIso },
        general: { ...general },
        gem,
      });
    }

    const result: StoredDraw = { ticketType, requested: count, drawn: n, results };
    saveIdempotent(ctx.db, userId, 'gacha_draw', idempotencyKey, requestHash, result, nowIso);
    return result;
  });

  // Dữ liệu tướng trả về khớp roster hiện tại
  const results = stored.results.map((r) => ({ ...r, general: GENERALS_BY_ID.get(r.card.generalId) ?? r.general }));
  // Thẻ/Ngọc mới => bộ sưu tập, đội hình tự động và bảng xếp hạng đều đổi.
  invalidatePlayers(ctx.cache, userId);
  return { ...stored, results, tickets: getTickets(ctx, userId) };
}
