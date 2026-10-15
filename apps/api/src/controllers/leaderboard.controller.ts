import type { FastifyInstance } from 'fastify';
import type { GameContext } from '../context.ts';
import { getLeaderboard } from '../managers/leaderboard.manager.ts';
import { authGuard, LIMIT_60 } from '../middleware/guards.ts';

/** Route bảng xếp hạng Lực chiến (mục 6.6). */
export function registerLeaderboardRoutes(app: FastifyInstance, ctx: GameContext): void {
  const auth = authGuard(ctx);

  app.get('/api/leaderboard', { preHandler: auth, config: LIMIT_60 }, async (req) => getLeaderboard(ctx, req.userId));
}
