import type { FastifyInstance } from 'fastify';
import { schemas } from '@tq/shared';
import type { GameContext } from '../context.ts';
import {
  buyListing,
  cancelListing,
  createListing,
  listHistory,
  listMarket,
  listMyListings,
  type MarketBrowseQuery,
  type MarketHistoryQuery,
  type MarketMineQuery,
} from '../managers/market.manager.ts';
import { playerGuard, LIMIT_20, LIMIT_60 } from '../middleware/guards.ts';

/**
 * Routes Chợ thẻ tướng: duyệt chợ + tin của tôi + lịch sử (đọc), và đăng bán / mua / huỷ tin (ghi).
 * Mọi thao tác ghi đều idempotent (client gửi idempotencyKey) và nằm trong transaction ở manager.
 */
export function registerMarketRoutes(app: FastifyInstance, ctx: GameContext): void {
  const player = playerGuard(ctx);

  app.get(
    '/api/market/listings',
    { preHandler: player, schema: { querystring: schemas.marketListingsQuery }, config: LIMIT_60 },
    async (req) => listMarket(ctx, req.userId, req.query as MarketBrowseQuery),
  );

  app.post(
    '/api/market/listings',
    { preHandler: player, schema: { body: schemas.marketCreateBody }, config: LIMIT_20 },
    async (req) => {
      const { cardId, idempotencyKey } = req.body as { cardId: number; idempotencyKey: string };
      return createListing(ctx, req.userId, cardId, idempotencyKey);
    },
  );

  app.get(
    '/api/market/mine',
    { preHandler: player, schema: { querystring: schemas.marketMineQuery }, config: LIMIT_60 },
    async (req) => listMyListings(ctx, req.userId, req.query as MarketMineQuery),
  );

  app.get(
    '/api/market/history',
    { preHandler: player, schema: { querystring: schemas.marketHistoryQuery }, config: LIMIT_60 },
    async (req) => listHistory(ctx, req.userId, req.query as MarketHistoryQuery),
  );

  app.post(
    '/api/market/listings/:id/buy',
    { preHandler: player, schema: { params: schemas.idParams, body: schemas.marketActionBody }, config: LIMIT_20 },
    async (req) => {
      const { id } = req.params as { id: number };
      const { idempotencyKey } = req.body as { idempotencyKey: string };
      return buyListing(ctx, req.userId, id, idempotencyKey);
    },
  );

  app.post(
    '/api/market/listings/:id/cancel',
    { preHandler: player, schema: { params: schemas.idParams, body: schemas.marketActionBody }, config: LIMIT_20 },
    async (req) => {
      const { id } = req.params as { id: number };
      const { idempotencyKey } = req.body as { idempotencyKey: string };
      return cancelListing(ctx, req.userId, id, idempotencyKey);
    },
  );
}
