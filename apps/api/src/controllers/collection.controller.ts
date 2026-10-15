import type { FastifyInstance } from 'fastify';
import { schemas, type MeDto } from '@tq/shared';
import { DEV_TOPUP_TICKETS, ROSTER } from '@tq/game-config';
import type { GameContext } from '../context.ts';
import { getProfile, getUsername, isAdmin } from '../managers/auth.manager.ts';
import { getTickets, syncRecovery } from '../managers/ticket.manager.ts';
import { listCards, listHistory, type CardsQuery, type HistoryQuery } from '../managers/collection.manager.ts';
import { authGuard } from '../middleware/guards.ts';

/** Routes tài khoản, bộ sưu tập và lịch sử của người chơi (mục 6.3, 6.4). */
export function registerCollectionRoutes(app: FastifyInstance, ctx: GameContext): void {
  const auth = authGuard(ctx);

  app.get('/api/me', { preHandler: auth }, async (req): Promise<MeDto> => {
    // Admin không chơi game => không hồi vé
    if (!isAdmin(ctx, req.userId)) syncRecovery(ctx, req.userId);
    return {
      id: req.userId,
      username: getUsername(ctx, req.userId),
      ...getProfile(ctx, req.userId),
      isAdmin: isAdmin(ctx, req.userId),
      tickets: getTickets(ctx, req.userId),
      features: { devTopup: !!ctx.features?.devTopup, devTopupAmount: DEV_TOPUP_TICKETS, gift: !!ctx.features?.gift },
      ...(req.dailyEvents ? { dailyEvents: req.dailyEvents } : {}),
    };
  });
  app.get('/api/generals', async () => ({ items: ROSTER }));
  app.get('/api/cards', { preHandler: auth, schema: { querystring: schemas.cardsQuery } }, async (req) =>
    listCards(ctx, req.userId, req.query as CardsQuery),
  );
  app.get('/api/history', { preHandler: auth, schema: { querystring: schemas.historyQuery } }, async (req) =>
    listHistory(ctx, req.userId, req.query as HistoryQuery),
  );
}
