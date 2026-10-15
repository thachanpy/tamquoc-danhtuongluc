import type { FastifyInstance } from 'fastify';
import { schemas, type PvpUnitDto } from '@tq/shared';
import type { GameContext } from '../context.ts';
import {
  challenge,
  getBattle,
  getCombatStats,
  getOpponent,
  getOverview,
  listBattleHistory,
  saveTeam,
} from '../managers/pvp.manager.ts';
import { LIMIT_20, LIMIT_60, LIMIT_120, authGuard, playerGuard } from '../middleware/guards.ts';

/** Route Đấu trường PvP (mục 6.7). Mọi thao tác đều là người chơi (admin không tham gia). */
export function registerPvpRoutes(app: FastifyInstance, ctx: GameContext): void {
  const player = playerGuard(ctx);
  const auth = authGuard(ctx);

  // Chi tiết chiến đấu (kỹ năng, chỉ số) của một tướng ở một cấp — modal xem thẻ ở Bộ sưu tập.
  // Chỉ là dữ liệu cấu hình nên chỉ cần đăng nhập, không phải thao tác chơi.
  app.get(
    '/api/pvp/generals/:id/combat',
    { preHandler: auth, schema: { params: schemas.generalCombatParams, querystring: schemas.generalCombatQuery }, config: LIMIT_120 },
    async (req) => {
      const { id } = req.params as { id: string };
      const { level } = req.query as { level: number };
      return getCombatStats(id, level);
    },
  );

  app.get('/api/pvp', { preHandler: player, config: LIMIT_60 }, async (req) => getOverview(ctx, req.userId));

  app.post('/api/pvp/team', { preHandler: player, schema: { body: schemas.pvpTeamBody }, config: LIMIT_20 }, async (req) =>
    saveTeam(ctx, req.userId, (req.body as { units: PvpUnitDto[] }).units),
  );

  app.get('/api/pvp/opponent/:id', { preHandler: player, schema: { params: schemas.idParams }, config: LIMIT_60 }, async (req) =>
    getOpponent(ctx, req.userId, (req.params as { id: number }).id),
  );

  // Khiêu chiến: server mô phỏng trọn trận rồi trả dữ liệu phát lại (không phần thưởng).
  app.post('/api/pvp/challenge', { preHandler: player, schema: { body: schemas.pvpChallengeBody }, config: LIMIT_20 }, async (req) =>
    challenge(ctx, req.userId, (req.body as { opponentId: number }).opponentId),
  );

  app.get(
    '/api/pvp/battles',
    { preHandler: player, schema: { querystring: schemas.pvpBattlesQuery }, config: LIMIT_60 },
    async (req) => {
      const { page, pageSize } = req.query as { page: number; pageSize: number };
      return listBattleHistory(ctx, req.userId, page, pageSize);
    },
  );

  app.get('/api/pvp/battles/:id', { preHandler: player, schema: { params: schemas.idParams }, config: LIMIT_60 }, async (req) =>
    getBattle(ctx, req.userId, (req.params as { id: number }).id),
  );
}
