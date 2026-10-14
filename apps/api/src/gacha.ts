import {
  TICKET_TYPES,
  TICKET_LABELS,
  type TicketType,
  type GachaConfigDto,
  type DrawResultDto,
  type DrawnCardDto,
} from '@tq/shared';
import { GACHA_LEVEL_RATES, BPS_SCALE, DRAW_COUNT_OPTIONS, UPGRADE_INPUT_COUNT, QUICK_UPGRADE_MAX_LEVEL, GIFT_MAX_CARDS, UPGRADE_SUCCESS_BPS, UPGRADE_FAILURE_DISTRIBUTION, GENERALS_BY_ID, poolForTicket, rollLevel } from '@tq/game-config';
import { AppError, iso, sha256, findIdempotent, saveIdempotent, type GameContext } from './context.ts';
import { tx } from './db.ts';
import { applyTicketDelta, getTickets, readBalances, syncRecovery } from './tickets.ts';

export function getGachaConfig(): GachaConfigDto {
  return {
    ticketTypes: TICKET_TYPES.map((id) => ({ id, label: TICKET_LABELS[id], pool: poolForTicket(id).map((g) => g.id) })),
    levelRates: GACHA_LEVEL_RATES.map((e) => ({ ...e })),
    bpsScale: BPS_SCALE,
    drawCountOptions: [...DRAW_COUNT_OPTIONS],
    upgradeInputCount: UPGRADE_INPUT_COUNT,
    quickUpgradeMaxLevel: QUICK_UPGRADE_MAX_LEVEL,
    giftMaxCards: GIFT_MAX_CARDS,
    upgradeRates: Object.keys(UPGRADE_SUCCESS_BPS).map(Number).sort((a, b) => a - b).map((level) => ({
      level,
      successBps: UPGRADE_SUCCESS_BPS[level]!,
      failureDistribution: (UPGRADE_FAILURE_DISTRIBUTION[level] ?? []).map((e) => ({ ...e })),
    })),
  };
}

type StoredDraw = Omit<DrawResultDto, 'tickets'>;

/**
 * Quay `count` lần bằng loại vé đã chọn (mục 4.1, 4.4). Mọi kết quả do server quyết định.
 * - Số lần thực sự quay = min(count, số dư loại vé). Số dư 0 => NO_TICKETS.
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
  if (!DRAW_COUNT_OPTIONS.includes(count)) {
    throw new AppError(400, 'INVALID_DRAW_COUNT', `Số lần quay phải là một trong: ${DRAW_COUNT_OPTIONS.join(', ')}.`);
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
    const insCard = ctx.db.prepare(
      'INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?,?,?,?,?)',
    );
    const insHist = ctx.db.prepare(
      `INSERT INTO gacha_history (user_id, ticket_type, general_id, card_id, card_level, ticket_transaction_id, idempotency_key, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    );

    const results: DrawnCardDto[] = [];
    for (let i = 0; i < n; i++) {
      // Key con cho từng lượt; '#' không thể xuất hiện trong key client (schema chỉ cho [A-Za-z0-9_-]).
      const rowKey = count === 1 ? idempotencyKey : `${idempotencyKey}#${i + 1}`;
      // Bước 4: tiêu 1 vé (ném NO_TICKETS nếu hết => rollback toàn bộ)
      const ttxId = applyTicketDelta(ctx.db, userId, ticketType, -1, 'gacha_draw', `gacha:${rowKey}`, idempotencyKey, nowIso);
      // Bước 5-7: chọn đều trong pool, roll level độc lập
      const general = pool[ctx.rand(pool.length)]!;
      const level = rollLevel(GACHA_LEVEL_RATES, ctx.rand);
      // Bước 8-9: tạo thẻ + lịch sử
      const cardId = Number(insCard.run(userId, general.id, level, nowIso, nowIso).lastInsertRowid);
      const hist = insHist.run(userId, ticketType, general.id, cardId, level, ttxId, rowKey, nowIso);
      results.push({
        drawId: Number(hist.lastInsertRowid),
        card: { id: cardId, generalId: general.id, level, createdAt: nowIso },
        general: { ...general },
      });
    }

    const result: StoredDraw = { ticketType, requested: count, drawn: n, results };
    saveIdempotent(ctx.db, userId, 'gacha_draw', idempotencyKey, requestHash, result, nowIso);
    return result;
  });

  // Dữ liệu tướng trả về khớp roster hiện tại
  const results = stored.results.map((r) => ({ ...r, general: GENERALS_BY_ID.get(r.card.generalId) ?? r.general }));
  return { ...stored, results, tickets: getTickets(ctx, userId) };
}
