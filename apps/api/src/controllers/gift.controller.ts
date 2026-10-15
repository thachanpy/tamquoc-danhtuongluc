import type { FastifyInstance } from 'fastify';
import { schemas } from '@tq/shared';
import { AppError, type GameContext } from '../context.ts';
import { giftCards, listRecipients } from '../managers/gift.manager.ts';
import { playerGuard, LIMIT_30 } from '../middleware/guards.ts';

/** Routes tặng thẻ (mục 5.6) — tạm tắt theo yêu cầu chủ dự án; bật bằng ENABLE_GIFT. */
export function registerGiftRoutes(app: FastifyInstance, ctx: GameContext): void {
  const player = playerGuard(ctx);

  // Tặng thẻ đang tạm tắt: cả 2 route trả 404 FEATURE_DISABLED khi ENABLE_GIFT tắt.
  const requireGift = () => {
    if (!ctx.features?.gift) throw new AppError(404, 'FEATURE_DISABLED', 'Tính năng tặng thẻ đang tạm tắt.');
  };

  app.get('/api/users', { preHandler: player, schema: { querystring: schemas.usersQuery } }, async (req) => {
    requireGift();
    const { q, limit } = req.query as { q?: string; limit?: number };
    return { items: listRecipients(ctx, req.userId, q ?? '', limit ?? 200) };
  });
  app.post(
    '/api/gifts',
    { preHandler: player, schema: { body: schemas.giftBody }, config: LIMIT_30 },
    async (req) => {
      requireGift();
      const { toUsername, cardIds, idempotencyKey } = req.body as { toUsername: string; cardIds: number[]; idempotencyKey: string };
      return giftCards(ctx, req.userId, toUsername, cardIds, idempotencyKey);
    },
  );
}
