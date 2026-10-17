import type { DB } from '../db.ts';

/**
 * Truy vấn bảng CẤU HÌNH TỈ LỆ QUAY (`gacha_config`) — một dòng duy nhất (id = 1) lưu bảng tỉ lệ
 * cấp tướng và cấu hình rớt Ngọc do Admin chỉnh. Đây là nguồn dữ liệu cho `GachaConfigRegistry`
 * (đọc vào memory cache để lượt quay không phải truy vấn DB mỗi lần).
 */
export interface GachaConfigRow {
  /** Bảng tỉ lệ cấp tướng dạng JSON `[{ level, bps } × N]`. */
  level_rates: string;
  /** Tỉ lệ rớt Ngọc mỗi lượt quay (bps, 10000 = 100%). */
  gem_drop_bps: number;
  /** Trọng số chọn hệ Ngọc dạng JSON `{ kim, moc, thuy, hoa, tho }` (bps). */
  gem_type_weights: string;
  updated_at: string;
}

const COLS = 'level_rates, gem_drop_bps, gem_type_weights, updated_at';

export function findGachaConfigRow(db: DB): GachaConfigRow | undefined {
  return db.prepare(`SELECT ${COLS} FROM gacha_config WHERE id = 1`).get() as unknown as GachaConfigRow | undefined;
}

/** Ghi (upsert) dòng cấu hình duy nhất — tạo dòng id = 1 nếu chưa có. */
export function upsertGachaConfigRow(db: DB, r: GachaConfigRow): void {
  db.prepare(`
    INSERT INTO gacha_config (id, ${COLS}) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      level_rates=excluded.level_rates, gem_drop_bps=excluded.gem_drop_bps,
      gem_type_weights=excluded.gem_type_weights, updated_at=excluded.updated_at
  `).run(r.level_rates, r.gem_drop_bps, r.gem_type_weights, r.updated_at);
}
