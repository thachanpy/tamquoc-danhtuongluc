import type { DB } from '../db.ts';

/**
 * Cài đặt game lưu trong bảng app_settings, admin chỉnh trên trang Quản trị (mục 3.8).
 * - require_approval: '1' = tài khoản đăng ký mới phải chờ admin duyệt; '0' (mặc định) = được duyệt ngay.
 */

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function upsertSetting(db: DB, key: string, value: string, nowIso: string, updatedBy: number | null): void {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(key, value, nowIso, updatedBy);
}
