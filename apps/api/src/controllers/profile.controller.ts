import type { FastifyInstance } from 'fastify';
import { schemas } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { changePassword, getProfile, updateProfile, type ProfilePatch } from '../managers/auth.manager.ts';
import { authGuard, LIMIT_20 } from '../middleware/guards.ts';

/** Routes hồ sơ người chơi (mục 3.11): xem/đổi tên hiển thị, ảnh đại diện và đổi mật khẩu. */
export function registerProfileRoutes(app: FastifyInstance, ctx: GameContext): void {
  // Đã đăng nhập là dùng được (quản trị viên cũng đổi được hồ sơ/mật khẩu của mình)
  const auth = authGuard(ctx);

  app.get('/api/me/profile', { preHandler: auth }, async (req) => getProfile(ctx, req.userId));
  app.post(
    '/api/me/profile',
    { preHandler: auth, schema: { body: schemas.profileBody }, config: LIMIT_20 },
    async (req) => updateProfile(ctx, req.userId, req.body as ProfilePatch),
  );
  app.post(
    '/api/me/password',
    { preHandler: auth, schema: { body: schemas.passwordBody }, config: LIMIT_20 },
    async (req) => {
      const { currentPassword, newPassword } = req.body as { currentPassword: string; newPassword: string };
      changePassword(ctx, req.userId, currentPassword, newPassword);
      return { ok: true };
    },
  );
}
