import {
  MAX_LEVEL,
  MIN_LEVEL,
  type GemDto,
  type GemElement,
  type GemMergeResultDto,
  type GemsDto,
  type QuickGemMergeResultDto,
} from '@tq/shared';
import {
  QUICK_UPGRADE_MAX_LEVEL,
  QUICK_UPGRADE_MAX_MERGES,
  UPGRADE_INPUT_COUNT,
  pvpGemConfig,
  rollLevel,
  rollSuccess,
} from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso, sha256 } from '../utils.ts';
import { tx, type DB } from '../db.ts';
import {
  attachConsumedByMerge,
  consumeActiveGems,
  findGemsByIds,
  insertGem,
  insertGemMerge,
  listActiveGems,
  listActiveGemsUpTo,
  type GemRow,
} from '../repositories/gem.repository.ts';
import { findIdempotent, saveIdempotent } from '../repositories/idempotency.repository.ts';
import { upgradeRatesFor } from './upgrade.manager.ts';

/**
 * Hệ thống Ngọc Ngũ Hành (DESIGN PROMPT). Ngọc cộng Chỉ số Nền Ra Trận cho toàn đội (aura gốc).
 * Ghép Ngọc 2→1 dùng CHUNG công thức, tỷ lệ và tài nguyên với thẻ Tướng — xem `upgradeRatesFor`.
 */

const toGemDto = (r: GemRow): GemDto => ({ id: r.id, element: r.element, level: r.level, createdAt: r.created_at });

/** Toàn bộ Ngọc đang sở hữu + cấu hình công khai (tab Bộ sưu tập & Nâng cấp Ngọc). */
export function listGems(ctx: GameContext, userId: number): GemsDto {
  const rows = listActiveGems(ctx.db, userId);
  return { config: pvpGemConfig(), gems: rows.map(toGemDto), total: rows.length };
}

function normalizeIds(gemIds: number[]): number[] {
  const n = UPGRADE_INPUT_COUNT;
  if (!Array.isArray(gemIds) || gemIds.length !== n) {
    throw new AppError(400, 'WRONG_GEM_COUNT', `Cần chọn đúng ${n} viên Ngọc.`);
  }
  if (!gemIds.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new AppError(400, 'INVALID_GEM_ID', 'Gem ID không hợp lệ.');
  }
  if (new Set(gemIds).size !== n) throw new AppError(400, 'DUPLICATE_GEM', 'Không được chọn trùng một viên Ngọc.');
  return [...gemIds].sort((a, b) => a - b);
}

/** Kiểm tra 2 viên Ngọc đầu vào: cùng loại, cùng cấp, còn active và thuộc người chơi. Không ghi dữ liệu. */
function loadAndValidate(db: DB, userId: number, ids: number[]): { element: GemElement; level: number } {
  const rows = findGemsByIds(db, ids);
  // Không phân biệt "không tồn tại" và "của người khác" để tránh lộ thông tin.
  if (rows.length !== ids.length || rows.some((r) => r.user_id !== userId)) {
    throw new AppError(404, 'GEM_NOT_FOUND', 'Có viên Ngọc không tồn tại hoặc không thuộc về bạn.');
  }
  if (rows.some((r) => r.status !== 'active')) {
    throw new AppError(409, 'GEM_CONSUMED', 'Có viên Ngọc đã bị tiêu thụ.');
  }
  const first = rows[0]!;
  if (rows.some((r) => r.element !== first.element)) {
    throw new AppError(400, 'DIFFERENT_ELEMENT', 'Các viên Ngọc ghép phải cùng loại (Ngũ Hành).');
  }
  if (rows.some((r) => r.level !== first.level)) {
    throw new AppError(400, 'DIFFERENT_GEM_LEVEL', 'Các viên Ngọc ghép phải cùng cấp.');
  }
  if (first.level < MIN_LEVEL || first.level > MAX_LEVEL - 1) {
    throw new AppError(400, 'MAX_LEVEL', 'Ngọc cấp 10 không thể ghép tiếp.');
  }
  return { element: first.element, level: first.level };
}

/**
 * Lõi ghép Ngọc: validate, roll, tiêu thụ Ngọc đầu vào, tạo Ngọc kết quả, ghi lịch sử.
 * PHẢI gọi bên trong transaction. Dùng chung cho ghép thường và Ghép nhanh.
 */
function performMergeInTx(ctx: GameContext, userId: number, ids: number[], historyKey: string): GemMergeResultDto {
  const { element, level } = loadAndValidate(ctx.db, userId, ids);
  const { successBps, failureBps, failureDistribution } = upgradeRatesFor(level);

  // Roll thành công trước; chỉ roll bảng thất bại khi đã xác định thất bại.
  const success = rollSuccess(successBps, ctx.rand);
  const resultLevel = success ? level + 1 : rollLevel(failureDistribution, ctx.rand);
  if (resultLevel < MIN_LEVEL || resultLevel > MAX_LEVEL || (!success && resultLevel > level)) {
    throw new AppError(500, 'INVALID_RESULT', 'Kết quả ghép Ngọc không hợp lệ.');
  }

  const nowIso = iso(ctx.now());
  const consumed = consumeActiveGems(ctx.db, ids, userId, nowIso);
  if (consumed !== ids.length) throw new AppError(409, 'GEM_CONSUMED', 'Có viên Ngọc vừa bị thao tác khác sử dụng.');

  const resultGemId = insertGem(ctx.db, userId, element, resultLevel, nowIso);

  const mergeId = insertGemMerge(ctx.db, {
    userId,
    inputGemIdsSnapshot: JSON.stringify(ids.map((id) => ({ id, element, level }))),
    element,
    inputLevel: level,
    resultGemId,
    resultLevel,
    successBps,
    failureBps,
    outcome: success ? 'success' : 'failure',
    failureDistributionSnapshot: failureDistribution,
    idempotencyKey: historyKey,
    createdAt: nowIso,
  });
  attachConsumedByMerge(ctx.db, mergeId, ids);

  return {
    mergeId,
    outcome: success ? 'success' : 'failure',
    element,
    inputLevel: level,
    inputGemIds: ids,
    resultGem: { id: resultGemId, element, level: resultLevel, createdAt: nowIso },
    successBps,
    failureBps,
    failureDistribution,
  };
}

/** Ghép 2 viên Ngọc cùng loại & cùng cấp — nguyên tử, idempotent. */
export function attemptGemMerge(ctx: GameContext, userId: number, gemIds: number[], idempotencyKey: string): GemMergeResultDto {
  const ids = normalizeIds(gemIds);
  const requestHash = sha256(JSON.stringify({ ids }));
  return tx(ctx.db, () => {
    const prev = findIdempotent<GemMergeResultDto>(ctx.db, userId, 'gem_merge', idempotencyKey, requestHash);
    if (prev) return prev;
    const result = performMergeInTx(ctx, userId, ids, idempotencyKey);
    saveIdempotent(ctx.db, userId, 'gem_merge', idempotencyKey, requestHash, result, iso(ctx.now()));
    return result;
  });
}

/**
 * Chuẩn hoá danh sách level đầu vào cho Ghép nhanh Ngọc.
 * Bỏ trống => mặc định Lv.1–QUICK_UPGRADE_MAX_LEVEL (Lv.5). Mọi level phải trong Lv.1–9.
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
 * Ghép nhanh Ngọc: tự ghép liên tục mọi cặp Ngọc cùng loại & cùng cấp, với level đầu vào NẰM TRONG
 * danh sách `levels` người chơi chọn (mặc định Lv.1–QUICK_UPGRADE_MAX_LEVEL), đến khi hết cặp
 * (hoặc chạm trần QUICK_UPGRADE_MAX_MERGES). Toàn bộ trong MỘT transaction, một idempotency key.
 */
export function quickGemMerge(
  ctx: GameContext,
  userId: number,
  idempotencyKey: string,
  levels?: number[],
): QuickGemMergeResultDto {
  const selected = normalizeQuickLevels(levels);
  const levelSet = new Set(selected);
  const maxLevel = selected[selected.length - 1]!;
  const requestHash = sha256(JSON.stringify({ levels: selected, n: UPGRADE_INPUT_COUNT }));
  return tx(ctx.db, () => {
    const prev = findIdempotent<QuickGemMergeResultDto>(ctx.db, userId, 'gem_merge_quick', idempotencyKey, requestHash);
    if (prev) return prev;

    // Hàng đợi Ngọc theo (loại, cấp), chỉ Ngọc active và level nằm trong danh sách đã chọn
    const rows = listActiveGemsUpTo(ctx.db, userId, maxLevel).filter((r) => levelSet.has(r.level));
    const buckets = new Map<string, number[]>();
    const keyOf = (element: GemElement, lv: number) => `${lv}|${element}`;
    for (const r of rows) {
      const k = keyOf(r.element, r.level);
      (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(r.id);
    }
    const nextBucket = (): string | undefined =>
      [...buckets.entries()]
        .filter(([, ids]) => ids.length >= UPGRADE_INPUT_COUNT)
        .map(([k]) => k)
        .sort((a, b) => {
          const [la, ea] = a.split('|');
          const [lb, eb] = b.split('|');
          return Number(la) - Number(lb) || ea!.localeCompare(eb!);
        })[0];

    const results: QuickGemMergeResultDto['results'] = [];
    let k: string | undefined;
    while (results.length < QUICK_UPGRADE_MAX_MERGES && (k = nextBucket())) {
      const ids = buckets.get(k)!.splice(0, UPGRADE_INPUT_COUNT);
      const r = performMergeInTx(ctx, userId, [...ids].sort((a, b) => a - b), `${idempotencyKey}#${results.length + 1}`);
      results.push({
        mergeId: r.mergeId,
        element: r.element,
        inputLevel: r.inputLevel,
        resultLevel: r.resultGem.level,
        resultGemId: r.resultGem.id,
        outcome: r.outcome,
      });
      // Ngọc mới vẫn thuộc level đã chọn thì đưa lại vào hàng đợi để có thể ghép tiếp
      if (levelSet.has(r.resultGem.level)) {
        const nk = keyOf(r.resultGem.element, r.resultGem.level);
        (buckets.get(nk) ?? buckets.set(nk, []).get(nk)!).push(r.resultGem.id);
      }
    }
    if (results.length === 0) {
      throw new AppError(409, 'NOTHING_TO_MERGE', `Không có cặp Ngọc nào (Lv.${selected.join(', ')} đã chọn) để ghép.`);
    }

    const result: QuickGemMergeResultDto = {
      levels: selected,
      merges: results.length,
      successes: results.filter((r) => r.outcome === 'success').length,
      failures: results.filter((r) => r.outcome === 'failure').length,
      hasMore: nextBucket() !== undefined,
      results,
    };
    saveIdempotent(ctx.db, userId, 'gem_merge_quick', idempotencyKey, requestHash, result, iso(ctx.now()));
    return result;
  });
}
