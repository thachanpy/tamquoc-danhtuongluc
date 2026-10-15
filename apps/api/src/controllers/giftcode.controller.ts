import type { FastifyInstance } from 'fastify';
import { schemas } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { listFeaturedGiftCodes, listMyRedemptions, redeemGiftCode } from '../managers/giftcode.manager.ts';
import { playerGuard, LIMIT_20 } from '../middleware/guards.ts';

/** Routes giftcode cho người chơi: danh sách gợi ý/đã nhập và nhập code (mục 3.9). */
export function registerGiftCodeRoutes(app: FastifyInstance, ctx: GameContext): void {
  const player = playerGuard(ctx);

  app.get('/api/giftcodes', { preHandler: player }, async (req) => ({
    featured: listFeaturedGiftCodes(ctx, req.userId),
    redeemed: listMyRedemptions(ctx, req.userId),
  }));
  app.post(
    '/api/giftcodes/redeem',
    { preHandler: player, schema: { body: schemas.giftCodeRedeemBody }, config: LIMIT_20 },
    async (req) => redeemGiftCode(ctx, req.userId, (req.body as { code: string }).code),
  );
}
