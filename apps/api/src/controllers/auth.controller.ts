import type { FastifyInstance } from 'fastify';
import { schemas } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { register, login, logout } from '../managers/auth.manager.ts';
import { authGuard, bearer, LIMIT_20 } from '../middleware/guards.ts';

/** Routes xác thực: đăng ký, đăng nhập, đăng xuất (mục 3.8). */
export function registerAuthRoutes(app: FastifyInstance, ctx: GameContext): void {
  const auth = authGuard(ctx);

  app.post('/api/auth/register', { schema: { body: schemas.credentials }, config: LIMIT_20 }, async (req) => {
    const { username, password } = req.body as { username: string; password: string };
    return register(ctx, username, password);
  });
  app.post('/api/auth/login', { schema: { body: schemas.credentials }, config: LIMIT_20 }, async (req) => {
    const { username, password } = req.body as { username: string; password: string };
    return login(ctx, username, password);
  });
  app.post('/api/auth/logout', { preHandler: auth }, async (req) => {
    const t = bearer(req);
    if (t) logout(ctx, t);
    return { ok: true };
  });
}
