import type { AppSettingsDto } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { iso } from '../utils.ts';
import { getSetting, upsertSetting } from '../repositories/settings.repository.ts';

/**
 * Cài đặt game lưu trong bảng app_settings, admin chỉnh trên trang Quản trị (mục 3.8).
 * - require_approval: '1' = tài khoản đăng ký mới phải chờ admin duyệt; '0' (mặc định) = được duyệt ngay.
 */

export function getRequireApproval(ctx: GameContext): boolean {
  return getSetting(ctx.db, 'require_approval') === '1';
}

export function getSettings(ctx: GameContext): AppSettingsDto {
  return { requireApproval: getRequireApproval(ctx) };
}

export function setRequireApproval(ctx: GameContext, value: boolean, adminId: number | null = null): AppSettingsDto {
  upsertSetting(ctx.db, 'require_approval', value ? '1' : '0', iso(ctx.now()), adminId);
  return getSettings(ctx);
}
