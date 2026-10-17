import type { FastifyInstance } from 'fastify';
import { schemas, type GemsDto } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { PREFIX, TTL } from '../cache.ts';
import { attemptGemMerge, listGems, quickGemMerge } from '../managers/gem.manager.ts';
import { authGuard, playerGuard, LIMIT_20, LIMIT_60 } from '../middleware/guards.ts';

/** Routes Ngọc Ngũ Hành: bộ sưu tập, ghép 2→1 và ghép nhanh (DESIGN PROMPT — tab Ngọc ở Bộ sưu tập/Nâng cấp). */
export function registerGemRoutes(app: FastifyInstance, ctx: GameContext): void {
  const auth = authGuard(ctx);
  const player = playerGuard(ctx);

  app.get('/api/gems', { preHandler: auth }, async (req): Promise<GemsDto> =>
    // Bộ sưu tập Ngọc đổi khi quay thẻ/ghép Ngọc => cache 30s, xoá ngay ở các thao tác đó.
    ctx.cache.readThrough(PREFIX.collection(req.userId, 'gems'), TTL.collection, () => listGems(ctx, req.userId)),
  );
  app.post(
    '/api/gems/merge',
    { preHandler: player, schema: { body: schemas.gemMergeAttemptBody }, config: LIMIT_60 },
    async (req) => {
      const { gemIds, idempotencyKey } = req.body as { gemIds: number[]; idempotencyKey: string };
      return attemptGemMerge(ctx, req.userId, gemIds, idempotencyKey);
    },
  );
  app.post(
    '/api/gems/merge/quick',
    { preHandler: player, schema: { body: schemas.gemMergeQuickBody }, config: LIMIT_20 },
    async (req) => {
      const { idempotencyKey, levels } = req.body as { idempotencyKey: string; levels?: number[] };
      return quickGemMerge(ctx, req.userId, idempotencyKey, levels);
    },
  );
}
