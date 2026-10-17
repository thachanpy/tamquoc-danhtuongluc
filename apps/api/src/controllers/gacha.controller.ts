import type { FastifyInstance } from 'fastify';
import { schemas, type TicketType } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { memoByConfig } from '../utils.ts';
import { gachaConfigRegistry } from '../gacha-config.registry.ts';
import { draw, getGachaConfig } from '../managers/gacha.manager.ts';
import { playerGuard, LIMIT_60 } from '../middleware/guards.ts';

/** Routes gacha: cấu hình tỷ lệ và quay thẻ (mục 4). */
export function registerGachaRoutes(app: FastifyInstance, ctx: GameContext): void {
  const player = playerGuard(ctx);

  // Cấu hình tỉ lệ dựng từ registry trong memory => nhớ đệm theo phiên bản (Admin sửa tỉ lệ là tính lại ngay).
  const config = memoByConfig(() => gachaConfigRegistry().updatedAt, getGachaConfig);
  app.get('/api/gacha/config', async () => config());
  app.post('/api/gacha/draw', { preHandler: player, schema: { body: schemas.drawBody }, config: LIMIT_60 }, async (req) => {
    const { ticketType, idempotencyKey, count } = req.body as { ticketType: TicketType; idempotencyKey: string; count?: number };
    return draw(ctx, req.userId, ticketType, idempotencyKey, count ?? 1);
  });
}
