import type { AppSettingsDto } from '@tq/shared';
import { iso, type GameContext } from './context.ts';

/**
 * Cài đặt game lưu trong bảng app_settings, admin chỉnh trên trang Quản trị (mục 3.8).
 * - require_approval: '1' = tài khoản đăng ký mới phải chờ admin duyệt; '0' (mặc định) = được duyệt ngay.
 */
function read(ctx: GameContext, key: string): string | undefined {
  const row = ctx.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function getRequireApproval(ctx: GameContext): boolean {
  return read(ctx, 'require_approval') === '1';
}

export function getSettings(ctx: GameContext): AppSettingsDto {
  return { requireApproval: getRequireApproval(ctx) };
}

export function setRequireApproval(ctx: GameContext, value: boolean, adminId: number | null = null): AppSettingsDto {
  ctx.db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at, updated_by) VALUES ('require_approval', ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .run(value ? '1' : '0', iso(ctx.now()), adminId);
  return getSettings(ctx);
}
