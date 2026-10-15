import {
  MAX_LEVEL,
  MIN_LEVEL,
  type QuickUpgradeResultDto,
  type UpgradePreviewDto,
  type UpgradeResultDto,
  type WeightEntry,
} from '@tq/shared';
import {
  BPS_SCALE,
  UPGRADE_SUCCESS_BPS,
  UPGRADE_FAILURE_DISTRIBUTION,
  UPGRADE_INPUT_COUNT,
  QUICK_UPGRADE_MAX_LEVEL,
  QUICK_UPGRADE_MAX_MERGES,
  rollSuccess,
  rollLevel,
} from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso, sha256 } from '../utils.ts';
import { tx, type DB } from '../db.ts';
import { findCardsByIds, consumeActiveCards, attachConsumedByUpgrade, insertCard, listActiveCardsUpTo } from '../repositories/card.repository.ts';
import { insertUpgrade } from '../repositories/upgrade.repository.ts';
import { findIdempotent, saveIdempotent } from '../repositories/idempotency.repository.ts';

function normalizeIds(cardIds: number[]): number[] {
  const n = UPGRADE_INPUT_COUNT;
  if (!Array.isArray(cardIds) || cardIds.length !== n) {
    throw new AppError(400, 'WRONG_CARD_COUNT', `Cần chọn đúng ${n} thẻ.`);
  }
  if (!cardIds.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new AppError(400, 'INVALID_CARD_ID', 'Card ID không hợp lệ.');
  }
  if (new Set(cardIds).size !== n) throw new AppError(400, 'DUPLICATE_CARD', 'Không được chọn trùng một thẻ.');
  return [...cardIds].sort((a, b) => a - b);
}

/** Kiểm tra các thẻ đầu vào theo mục 5.1/8.4 và trả về (generalId, level). Không ghi dữ liệu. */
function loadAndValidate(db: DB, userId: number, ids: number[]): { generalId: string; level: number } {
  const rows = findCardsByIds(db, ids);
  // Không phân biệt "không tồn tại" và "của người khác" để tránh lộ thông tin.
  if (rows.length !== ids.length || rows.some((r) => r.user_id !== userId)) {
    throw new AppError(404, 'CARD_NOT_FOUND', 'Có thẻ không tồn tại hoặc không thuộc về bạn.');
  }
  if (rows.some((r) => r.status !== 'active')) {
    throw new AppError(409, 'CARD_CONSUMED', 'Có thẻ đã bị tiêu thụ.');
  }
  const first = rows[0]!;
  if (rows.some((r) => r.general_id !== first.general_id)) {
    throw new AppError(400, 'DIFFERENT_GENERAL', 'Các thẻ ghép phải cùng một tướng.');
  }
  if (rows.some((r) => r.level !== first.level)) {
    throw new AppError(400, 'DIFFERENT_LEVEL', 'Các thẻ ghép phải cùng level.');
  }
  if (first.level < MIN_LEVEL || first.level > MAX_LEVEL - 1) {
    throw new AppError(400, 'MAX_LEVEL', 'Thẻ level 10 không thể ghép tiếp.');
  }
  return { generalId: first.general_id, level: first.level };
}

function ratesFor(level: number): { successBps: number; failureBps: number; failureDistribution: WeightEntry[] } {
  const successBps = UPGRADE_SUCCESS_BPS[level];
  const dist = UPGRADE_FAILURE_DISTRIBUTION[level];
  if (successBps === undefined || !dist) throw new AppError(500, 'CONFIG_MISSING', 'Thiếu cấu hình nâng cấp.');
  return { successBps, failureBps: BPS_SCALE - successBps, failureDistribution: dist.map((e) => ({ ...e })) };
}

export function previewUpgrade(ctx: GameContext, userId: number, cardIds: number[]): UpgradePreviewDto {
  const ids = normalizeIds(cardIds);
  const { generalId, level } = loadAndValidate(ctx.db, userId, ids);
  return { generalId, inputLevel: level, successLevel: level + 1, ...ratesFor(level), bpsScale: BPS_SCALE };
}

/**
 * Lõi ghép thẻ: validate, roll, tiêu thụ thẻ đầu vào, tạo thẻ kết quả, ghi lịch sử.
 * PHẢI gọi bên trong transaction. Dùng chung cho ghép thường và Nâng cấp nhanh.
 */
function performUpgradeInTx(ctx: GameContext, userId: number, ids: number[], historyKey: string): UpgradeResultDto {
  const { generalId, level } = loadAndValidate(ctx.db, userId, ids);
  const { successBps, failureBps, failureDistribution } = ratesFor(level);

  // Roll thành công trước; chỉ roll bảng thất bại khi đã xác định thất bại.
  const success = rollSuccess(successBps, ctx.rand);
  const resultLevel = success ? level + 1 : rollLevel(failureDistribution, ctx.rand);
  if (resultLevel < MIN_LEVEL || resultLevel > MAX_LEVEL || (!success && resultLevel > level)) {
    throw new AppError(500, 'INVALID_RESULT', 'Kết quả nâng cấp không hợp lệ.');
  }

  const nowIso = iso(ctx.now());
  // Tiêu thụ có điều kiện: chỉ thẻ còn active của chính người chơi. Phải đúng số thẻ đầu vào.
  const consumed = consumeActiveCards(ctx.db, ids, userId, nowIso);
  if (consumed !== ids.length) throw new AppError(409, 'CARD_CONSUMED', 'Có thẻ vừa bị thao tác khác sử dụng.');

  const resultCardId = insertCard(ctx.db, userId, generalId, resultLevel, nowIso);

  const upgradeId = insertUpgrade(ctx.db, {
    userId,
    inputCardIdsSnapshot: JSON.stringify(ids.map((id) => ({ id, generalId, level }))),
    inputGeneralId: generalId,
    inputLevel: level,
    resultCardId,
    resultLevel,
    successBps,
    failureBps,
    outcome: success ? 'success' : 'failure',
    failureDistributionSnapshot: failureDistribution,
    idempotencyKey: historyKey,
    createdAt: nowIso,
  });
  attachConsumedByUpgrade(ctx.db, upgradeId, ids);

  return {
    upgradeId,
    outcome: success ? 'success' : 'failure',
    inputCardIds: ids,
    inputLevel: level,
    resultCard: { id: resultCardId, generalId, level: resultLevel, createdAt: nowIso },
    successBps,
    failureBps,
    failureDistribution,
  };
}

/** Ghép UPGRADE_INPUT_COUNT thẻ — nguyên tử, idempotent (mục 5, 8.4). */
export function attemptUpgrade(ctx: GameContext, userId: number, cardIds: number[], idempotencyKey: string): UpgradeResultDto {
  const ids = normalizeIds(cardIds);
  const requestHash = sha256(JSON.stringify({ ids }));
  return tx(ctx.db, () => {
    const prev = findIdempotent<UpgradeResultDto>(ctx.db, userId, 'upgrade_attempt', idempotencyKey, requestHash);
    if (prev) return prev;
    const result = performUpgradeInTx(ctx, userId, ids, idempotencyKey);
    saveIdempotent(ctx.db, userId, 'upgrade_attempt', idempotencyKey, requestHash, result, iso(ctx.now()));
    return result;
  });
}

/**
 * Chuẩn hoá danh sách level đầu vào cho Nâng cấp nhanh.
 * Bỏ trống => mặc định Lv.1–QUICK_UPGRADE_MAX_LEVEL (Lv.5). Mọi level phải trong Lv.1–9 (Lv.10 không ghép tiếp).
 */
function normalizeQuickLevels(levels?: number[]): number[] {
  if (levels === undefined) return Array.from({ length: QUICK_UPGRADE_MAX_LEVEL }, (_, i) => i + 1);
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new AppError(400, 'INVALID_LEVELS', 'Cần chọn ít nhất một level để ghép nhanh.');
  }
  const uniq = [...new Set(levels)];
  if (!uniq.every((lv) => Number.isInteger(lv) && lv >= MIN_LEVEL && lv <= MAX_LEVEL - 1)) {
    throw new AppError(400, 'INVALID_LEVELS', `Level ghép nhanh phải trong khoảng Lv.${MIN_LEVEL}–${MAX_LEVEL - 1}.`);
  }
  return uniq.sort((a, b) => a - b);
}

/**
 * Nâng cấp nhanh (mục 5.5): tự ghép liên tục mọi nhóm UPGRADE_INPUT_COUNT thẻ cùng tướng, cùng level,
 * với level đầu vào NẰM TRONG danh sách `levels` người chơi chọn (mặc định Lv.1–QUICK_UPGRADE_MAX_LEVEL),
 * cho đến khi không còn cặp nào (hoặc chạm trần QUICK_UPGRADE_MAX_MERGES).
 * - Thứ tự: level thấp trước (để thẻ mới lên level có thể ghép tiếp), rồi theo tướng, rồi thẻ cũ trước.
 * - Mỗi lần ghép dùng đúng tỷ lệ & luật của ghép thường, ghi 1 dòng upgrade_history riêng.
 * - Toàn bộ trong MỘT transaction; một idempotency key cho cả thao tác.
 * - Không đụng thẻ có level NGOÀI danh sách đã chọn.
 */
export function quickUpgrade(ctx: GameContext, userId: number, idempotencyKey: string, levels?: number[]): QuickUpgradeResultDto {
  const selected = normalizeQuickLevels(levels);
  const levelSet = new Set(selected);
  const maxLevel = selected[selected.length - 1]!;
  const requestHash = sha256(JSON.stringify({ levels: selected, n: UPGRADE_INPUT_COUNT }));
  return tx(ctx.db, () => {
    const prev = findIdempotent<QuickUpgradeResultDto>(ctx.db, userId, 'upgrade_quick', idempotencyKey, requestHash);
    if (prev) return prev;

    // Hàng đợi thẻ theo (tướng, level), chỉ thẻ active và level nằm trong danh sách đã chọn
    const rows = listActiveCardsUpTo(ctx.db, userId, maxLevel).filter((r) => levelSet.has(r.level));
    const buckets = new Map<string, number[]>();
    const keyOf = (g: string, lv: number) => `${lv}|${g}`;
    for (const r of rows) {
      const k = keyOf(r.general_id, r.level);
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r.id);
    }
    const nextBucket = (): string | undefined =>
      [...buckets.entries()]
        .filter(([, ids]) => ids.length >= UPGRADE_INPUT_COUNT)
        .map(([k]) => k)
        .sort((a, b) => {
          const [la, ga] = a.split('|');
          const [lb, gb] = b.split('|');
          return Number(la) - Number(lb) || ga!.localeCompare(gb!);
        })[0];

    const results: QuickUpgradeResultDto['results'] = [];
    let k: string | undefined;
    while (results.length < QUICK_UPGRADE_MAX_MERGES && (k = nextBucket())) {
      const ids = buckets.get(k)!.splice(0, UPGRADE_INPUT_COUNT);
      const r = performUpgradeInTx(ctx, userId, [...ids].sort((a, b) => a - b), `${idempotencyKey}#${results.length + 1}`);
      results.push({
        upgradeId: r.upgradeId,
        generalId: r.resultCard.generalId,
        inputLevel: r.inputLevel,
        resultLevel: r.resultCard.level,
        resultCardId: r.resultCard.id,
        outcome: r.outcome,
      });
      // Thẻ mới vẫn thuộc level đã chọn thì đưa lại vào hàng đợi để có thể ghép tiếp
      if (levelSet.has(r.resultCard.level)) {
        const nk = keyOf(r.resultCard.generalId, r.resultCard.level);
        (buckets.get(nk) ?? buckets.set(nk, []).get(nk)!).push(r.resultCard.id);
      }
    }
    if (results.length === 0) {
      throw new AppError(409, 'NOTHING_TO_UPGRADE', `Không có cặp thẻ nào (Lv.${selected.join(', ')} đã chọn) để ghép.`);
    }

    const result: QuickUpgradeResultDto = {
      levels: selected,
      merges: results.length,
      successes: results.filter((r) => r.outcome === 'success').length,
      failures: results.filter((r) => r.outcome === 'failure').length,
      hasMore: nextBucket() !== undefined,
      results,
    };
    saveIdempotent(ctx.db, userId, 'upgrade_quick', idempotencyKey, requestHash, result, iso(ctx.now()));
    return result;
  });
}
