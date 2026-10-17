import type { AppSettingsDto } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { iso } from '../utils.ts';
import { DROP, PREFIX, TTL } from '../cache.ts';
import { getSetting, upsertSetting } from '../repositories/settings.repository.ts';

/**
 * Cài đặt game lưu trong bảng app_settings, admin chỉnh trên trang Quản trị (mục 3.8).
 * - require_approval: '1' = tài khoản đăng ký mới phải chờ admin duyệt; '0' (mặc định) = được duyệt ngay.
 */

/** Đọc thẳng DB — dùng ở luồng đăng ký (đồng bộ, 1 truy vấn nhỏ). */
export function getRequireApproval(ctx: GameContext): boolean {
  return getSetting(ctx.db, 'require_approval') === '1';
}

/** Bản có cache (5 phút) cho trang Quản trị; xoá cache ngay khi admin đổi cài đặt. */
export async function getSettings(ctx: GameContext): Promise<AppSettingsDto> {
  return ctx.cache.readThrough(PREFIX.settings, TTL.settings, () => ({ requireApproval: getRequireApproval(ctx) }));
}

export function setRequireApproval(ctx: GameContext, value: boolean, adminId: number | null = null): AppSettingsDto {
  upsertSetting(ctx.db, 'require_approval', value ? '1' : '0', iso(ctx.now()), adminId);
  ctx.cache.del([DROP.settings]);
  return { requireApproval: value };
}
