import type { FastifyInstance } from 'fastify';
import { schemas } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { claimRecovery, devTopup, getTickets } from '../managers/ticket.manager.ts';
import { authGuard, playerGuard, LIMIT_20 } from '../middleware/guards.ts';

/** Routes vé: xem số dư, nhận vé hồi, nút cộng vé thử nghiệm (mục 3.6, 3.7). */
export function registerTicketRoutes(app: FastifyInstance, ctx: GameContext): void {
  const auth = authGuard(ctx);
  const player = playerGuard(ctx);

  app.get('/api/tickets', { preHandler: auth }, async (req) => getTickets(ctx, req.userId));
  app.post('/api/tickets/claim-recovery', { preHandler: player }, async (req) => ({
    ...claimRecovery(ctx, req.userId),
    ...(req.dailyEvents ? { dailyEvents: req.dailyEvents } : {}),
  }));
  // Nút cộng vé thử nghiệm — chỉ hoạt động khi ENABLE_DEV_TOPUP bật (manager trả 404 nếu tắt)
  app.post(
    '/api/tickets/dev-topup',
    { preHandler: player, schema: { body: schemas.devTopupBody }, config: LIMIT_20 },
    async (req) => devTopup(ctx, req.userId, (req.body as { idempotencyKey: string }).idempotencyKey),
  );
}
