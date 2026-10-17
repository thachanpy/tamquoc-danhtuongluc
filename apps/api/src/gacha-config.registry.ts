import {
  BPS_SCALE,
  GACHA_LEVEL_SCALE,
  GACHA_MAX_LEVEL,
  PVP_GEM_ELEMENTS,
  setGachaLevelRatesOverride,
  setGemDropOverride,
} from '@tq/game-config';
import { MIN_LEVEL, type GemElement, type WeightEntry } from '@tq/shared';
import type { DB } from './db.ts';
import { findGachaConfigRow, type GachaConfigRow } from './repositories/gacha-config.repository.ts';

/**
 * Registry cấu hình TỈ LỆ QUAY (cấp tướng + rớt Ngọc) — SINGLETON trong tiến trình API.
 *
 * Vì sao cần: mỗi lượt quay đọc bảng tỉ lệ cấp và tỉ lệ rớt Ngọc; không thể truy vấn SQLite mỗi lần.
 * Registry nạp DB MỘT LẦN vào memory cache lúc khởi động rồi cài vào `@tq/game-config` qua provider
 * override (`setGachaLevelRatesOverride` / `setGemDropOverride`). Nhờ vậy Admin sửa tỉ lệ ⇒ gọi
 * `reload()` ⇒ lượt quay kế tiếp áp dụng NGAY, không cần restart API.
 */

/** Đọc bảng tỉ lệ cấp từ JSON; dữ liệu hỏng/không hợp lệ ⇒ trả `undefined` để rơi về bảng cứng. */
function parseLevelRates(row: GachaConfigRow): WeightEntry[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.level_rates);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return undefined;
  const seen = new Set<number>();
  let sum = 0;
  for (const e of parsed as WeightEntry[]) {
    if (!Number.isInteger(e?.level) || e.level < MIN_LEVEL || e.level > GACHA_MAX_LEVEL) return undefined;
    if (!Number.isInteger(e?.bps) || e.bps < 0) return undefined;
    if (seen.has(e.level)) return undefined;
    seen.add(e.level);
    sum += e.bps;
  }
  return sum === GACHA_LEVEL_SCALE ? parsed.map((e) => ({ level: e.level, bps: e.bps })) : undefined;
}

/** Đọc trọng số 5 hệ từ JSON; dữ liệu hỏng/tổng ≠ 100% ⇒ trả `undefined` để rơi về mặc định. */
function parseTypeWeights(row: GachaConfigRow): Record<GemElement, number> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.gem_type_weights);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const src = parsed as Record<string, unknown>;
  const out = {} as Record<GemElement, number>;
  let sum = 0;
  for (const e of PVP_GEM_ELEMENTS) {
    const v = src[e];
    if (!Number.isInteger(v) || (v as number) < 0) return undefined;
    out[e] = v as number;
    sum += v as number;
  }
  return sum === BPS_SCALE ? out : undefined;
}

export class GachaConfigRegistry {
  private readonly db: DB;
  private loadedAt = '';
  private hasRow = false;

  constructor(db: DB) {
    this.db = db;
    this.reload();
  }

  /** Đọc lại cấu hình từ DB và ghi đè memory cache + provider của game-config. */
  reload(): void {
    const row = findGachaConfigRow(this.db);
    const levelRates = row ? parseLevelRates(row) : undefined;
    const typeWeights = row ? parseTypeWeights(row) : undefined;
    const dropBps =
      row && Number.isInteger(row.gem_drop_bps) && row.gem_drop_bps >= 0 && row.gem_drop_bps <= BPS_SCALE ? row.gem_drop_bps : undefined;
    // Giá trị không hợp lệ ⇒ trả undefined để game-config rơi về bảng cứng (an toàn cho lượt quay đang chạy).
    setGachaLevelRatesOverride(levelRates);
    setGemDropOverride(dropBps !== undefined && typeWeights ? { dropBps, typeWeights } : undefined);
    this.hasRow = !!row;
    this.loadedAt = row?.updated_at ?? '';
  }

  /** Thời điểm cấu hình được lưu gần nhất (ISO); `null` nếu chưa từng có dòng trong DB. */
  get updatedAt(): string | null {
    return this.hasRow ? this.loadedAt : null;
  }
}

let active: GachaConfigRegistry | undefined;

/** Cài registry cho tiến trình hiện tại (gọi ngay sau khi mở/migrate/seed database). */
export function installGachaConfigRegistry(db: DB): GachaConfigRegistry {
  active = new GachaConfigRegistry(db);
  return active;
}

/** Registry đang hiệu lực. */
export function gachaConfigRegistry(): GachaConfigRegistry {
  if (!active) throw new Error('GachaConfigRegistry chưa được cài — gọi installGachaConfigRegistry(db) trước');
  return active;
}

/** Nạp lại cache sau khi Admin lưu tỉ lệ quay (không cần restart server). */
export function reloadGachaConfig(): void {
  active?.reload();
}
