import type { FastifyInstance } from 'fastify';
import { schemas } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { claimQuests, getQuests } from '../managers/quest.manager.ts';
import { playerGuard, LIMIT_60, LIMIT_120 } from '../middleware/guards.ts';

/** Routes nhiệm vụ, điểm danh và thành tựu (mục 3.10). */
export function registerQuestRoutes(app: FastifyInstance, ctx: GameContext): void {
  const player = playerGuard(ctx);

  app.get('/api/quests', { preHandler: player, config: LIMIT_120 }, async (req) => getQuests(ctx, req.userId));
  app.post(
    '/api/quests/claim',
    { preHandler: player, schema: { body: schemas.questClaimBody }, config: LIMIT_60 },
    async (req) => claimQuests(ctx, req.userId, (req.body as { keys?: string[] } | undefined)?.keys),
  );
}
