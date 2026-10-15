import type { FastifyInstance } from 'fastify';
import { schemas } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { attemptUpgrade, previewUpgrade, quickUpgrade } from '../managers/upgrade.manager.ts';
import { playerGuard, LIMIT_20, LIMIT_60 } from '../middleware/guards.ts';

/** Routes nâng cấp thẻ: xem trước, ghép, nâng cấp nhanh (mục 5). */
export function registerUpgradeRoutes(app: FastifyInstance, ctx: GameContext): void {
  const player = playerGuard(ctx);

  app.post(
    '/api/upgrades/preview',
    { preHandler: player, schema: { body: schemas.upgradePreviewBody }, config: LIMIT_60 },
    async (req) => previewUpgrade(ctx, req.userId, (req.body as { cardIds: number[] }).cardIds),
  );
  app.post(
    '/api/upgrades/attempt',
    { preHandler: player, schema: { body: schemas.upgradeAttemptBody }, config: LIMIT_60 },
    async (req) => {
      const { cardIds, idempotencyKey } = req.body as { cardIds: number[]; idempotencyKey: string };
      return attemptUpgrade(ctx, req.userId, cardIds, idempotencyKey);
    },
  );
  app.post(
    '/api/upgrades/quick',
    { preHandler: player, schema: { body: schemas.quickUpgradeBody }, config: LIMIT_20 },
    async (req) => quickUpgrade(ctx, req.userId, (req.body as { idempotencyKey: string }).idempotencyKey),
  );
}
