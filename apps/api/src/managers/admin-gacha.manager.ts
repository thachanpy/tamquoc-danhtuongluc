import {
  BPS_SCALE,
  GACHA_LEVEL_SCALE,
  GACHA_MAX_LEVEL,
  PVP_GEM_ELEMENTS,
  gachaLevelRates,
  gemDropConfig,
} from '@tq/game-config';
import { MIN_LEVEL, type GemElement, type GachaRatesAdminDto, type WeightEntry } from '@tq/shared';
import { AppError, type GameContext } from '../context.ts';
import { tx } from '../db.ts';
import { iso } from '../utils.ts';
import { reloadGachaConfig, gachaConfigRegistry } from '../gacha-config.registry.ts';
import { upsertGachaConfigRow } from '../repositories/gacha-config.repository.ts';

/**
 * Quản trị TỈ LỆ QUAY trên trang Quản trị: bảng tỉ lệ cấp tướng (Lv1–Lv9) và cấu hình rớt Ngọc
 * (tỉ lệ rớt mỗi lượt + trọng số 5 hệ). Thao tác ghi: (1) lưu DB trong 1 transaction,
 * (2) gọi `reloadGachaConfig()` để `GachaConfigRegistry` đọc lại ⇒ lượt quay kế tiếp áp dụng NGAY.
 *
 * Ràng buộc: tổng tỉ lệ cấp phải bằng `GACHA_LEVEL_SCALE` (100%) và tổng trọng số 5 hệ phải bằng
 * `BPS_SCALE` (100%) — sai ⇒ từ chối lưu (INVALID_RATES_SUM / INVALID_GEM_WEIGHTS_SUM).
 */

export type AdminGachaRatesUpdateInput = {
  levelRates: WeightEntry[];
  gemDropBps: number;
  gemTypeWeights: Record<GemElement, number>;
};

/** Chuẩn hoá bảng tỉ lệ cấp: bắt buộc đủ Lv1–Lv9, mỗi cấp đúng 1 lần, sắp tăng dần. */
function normalizeLevelRates(input: WeightEntry[]): WeightEntry[] {
  const byLevel = new Map<number, number>();
  for (const e of input) {
    if (!Number.isInteger(e.level) || e.level < MIN_LEVEL || e.level > GACHA_MAX_LEVEL) {
      throw new AppError(400, 'INVALID_LEVEL', `Cấp tướng phải trong khoảng Lv${MIN_LEVEL}–Lv${GACHA_MAX_LEVEL}.`);
    }
    if (!Number.isInteger(e.bps) || e.bps < 0) {
      throw new AppError(400, 'INVALID_LEVEL_RATE', `Tỉ lệ của Lv${e.level} phải là số nguyên không âm.`);
    }
    if (byLevel.has(e.level)) throw new AppError(400, 'DUPLICATE_LEVEL', `Cấp Lv${e.level} bị khai báo trùng.`);
    byLevel.set(e.level, e.bps);
  }
  const out: WeightEntry[] = [];
  for (let lv = MIN_LEVEL; lv <= GACHA_MAX_LEVEL; lv++) {
    const bps = byLevel.get(lv);
    if (bps === undefined) throw new AppError(400, 'MISSING_LEVEL', `Thiếu tỉ lệ cho Lv${lv}.`);
    out.push({ level: lv, bps });
  }
  const sum = out.reduce((s, e) => s + e.bps, 0);
  if (sum !== GACHA_LEVEL_SCALE) {
    throw new AppError(400, 'INVALID_RATES_SUM', `Tổng tỉ lệ cấp phải bằng 100% (hiện là ${(sum / GACHA_LEVEL_SCALE * 100).toFixed(3)}%).`);
  }
  return out;
}

/** Chuẩn hoá trọng số 5 hệ: đủ 5 hệ, số nguyên không âm, tổng bằng 100%. */
function normalizeGemWeights(input: Record<GemElement, number>): Record<GemElement, number> {
  const out = {} as Record<GemElement, number>;
  let sum = 0;
  for (const e of PVP_GEM_ELEMENTS) {
    const v = input?.[e];
    if (!Number.isInteger(v) || v < 0) throw new AppError(400, 'INVALID_GEM_WEIGHT', `Trọng số hệ ${e} phải là số nguyên không âm.`);
    out[e] = v;
    sum += v;
  }
  if (sum !== BPS_SCALE) {
    throw new AppError(400, 'INVALID_GEM_WEIGHTS_SUM', `Tổng trọng số 5 hệ phải bằng 100% (hiện là ${(sum / BPS_SCALE * 100).toFixed(2)}%).`);
  }
  return out;
}

/** Cấu hình tỉ lệ quay đang áp dụng (đọc từ memory cache của game-config). */
export function adminGetGachaRates(): GachaRatesAdminDto {
  const drop = gemDropConfig();
  return {
    levelRates: gachaLevelRates().map((e) => ({ ...e })),
    levelScale: GACHA_LEVEL_SCALE,
    gemDropBps: drop.dropBps,
    gemTypeWeights: { ...drop.typeWeights },
    bpsScale: BPS_SCALE,
    updatedAt: gachaConfigRegistry().updatedAt,
  };
}

/** Lưu tỉ lệ quay: kiểm tra hợp lệ, ghi DB rồi nạp lại cache để áp dụng ngay. */
export function adminUpdateGachaRates(ctx: GameContext, body: AdminGachaRatesUpdateInput): GachaRatesAdminDto {
  if (!Number.isInteger(body.gemDropBps) || body.gemDropBps < 0 || body.gemDropBps > BPS_SCALE) {
    throw new AppError(400, 'INVALID_GEM_DROP', `Tỉ lệ rớt Ngọc phải trong 0–100%.`);
  }
  const levelRates = normalizeLevelRates(body.levelRates);
  const typeWeights = normalizeGemWeights(body.gemTypeWeights);
  tx(ctx.db, () =>
    upsertGachaConfigRow(ctx.db, {
      level_rates: JSON.stringify(levelRates),
      gem_drop_bps: body.gemDropBps,
      gem_type_weights: JSON.stringify(typeWeights),
      updated_at: iso(ctx.now()),
    }),
  );
  reloadGachaConfig();
  return adminGetGachaRates();
}
