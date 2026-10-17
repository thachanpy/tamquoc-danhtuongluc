import type { FastifyInstance } from 'fastify';
import { schemas, type GemElement, type PvpUnitDto } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { PREFIX, TTL, queryKey } from '../cache.ts';
import {
  challenge,
  getBattle,
  getCombatStats,
  getOpponent,
  getOverview,
  listBattleHistory,
  ownedGemStats,
  saveTeam,
} from '../managers/pvp.manager.ts';
import { LIMIT_20, LIMIT_60, LIMIT_120, authGuard, playerGuard } from '../middleware/guards.ts';

/** Route Đấu trường PvP (mục 6.7). Mọi thao tác đều là người chơi (admin không tham gia). */
export function registerPvpRoutes(app: FastifyInstance, ctx: GameContext): void {
  const player = playerGuard(ctx);
  const auth = authGuard(ctx);

  // Chi tiết chiến đấu (kỹ năng, chỉ số) của một tướng ở một cấp — modal xem thẻ ở Bộ sưu tập
  // và dòng chỉ số dưới mỗi ô tướng trong màn chuẩn bị khiêu chiến.
  // Client gọi endpoint này theo LÔ (mỗi tướng trong đội 1 request) mỗi lần đổi đội/Ngọc
  // => cache 60s theo (người chơi, tướng, cấp, đội, Ngọc). Phần phụ thuộc người chơi là kho Ngọc
  // đang sở hữu nên xoá cùng nhóm khi quay thẻ/ghép Ngọc (invalidatePlayers).
  app.get(
    '/api/pvp/generals/:id/combat',
    { preHandler: auth, schema: { params: schemas.generalCombatParams, querystring: schemas.generalCombatQuery }, config: LIMIT_120 },
    async (req) => {
      const { id } = req.params as { id: string };
      const { level, squad, gems } = req.query as { level: number; squad?: string; gems?: string };
      // `squad` (nếu có) = danh sách generalId trong đội để tính Chỉ số Nền Ra Trận (aura Hỗ trợ + Cổng Đồng Phe).
      const squadIds = squad ? squad.split(',').filter(Boolean) : undefined;
      // `gems` (nếu có) = danh sách LOẠI Ngọc đã gắn cho đội — quy ra chỉ số cộng toàn đội để hiển thị khớp khi vào trận.
      const gemElements = gems ? (gems.split(',').filter(Boolean) as GemElement[]) : [];
      // Sắp xếp để hai lần gọi cùng nội dung (khác thứ tự) dùng chung một key cache.
      const key = queryKey({
        id,
        level,
        squad: squadIds?.slice().sort().join(','),
        gems: gemElements.slice().sort().join(','),
      });
      return ctx.cache.readThrough(PREFIX.combat(req.userId, key), TTL.combat, () => {
        const gem = gemElements.length ? ownedGemStats(ctx, req.userId, gemElements) : undefined;
        return getCombatStats(id, level, squadIds, gem);
      });
    },
  );

  // Tổng quan Đấu trường (đội hình + chỉ số): nặng nên cache 30s, xoá khi lưu đội/quay thẻ/ghép.
  app.get('/api/pvp', { preHandler: player, config: LIMIT_60 }, async (req) =>
    ctx.cache.readThrough(PREFIX.pvp(req.userId), TTL.pvp, () => getOverview(ctx, req.userId)),
  );

  app.post('/api/pvp/team', { preHandler: player, schema: { body: schemas.pvpTeamBody }, config: LIMIT_20 }, async (req) => {
    const { units, gems } = req.body as { units: PvpUnitDto[]; gems?: GemElement[] };
    return saveTeam(ctx, req.userId, units, gems ?? []);
  });

  app.get('/api/pvp/opponent/:id', { preHandler: player, schema: { params: schemas.idParams }, config: LIMIT_60 }, async (req) => {
    const opponentId = (req.params as { id: number }).id;
    // Dữ liệu đội hình đối thủ chỉ phụ thuộc người bị xem (không phụ thuộc người xem) => cache theo id đối thủ.
    // Lỗi (tự khiêu chiến chính mình, không tìm thấy) ném ra trước khi lưu cache nên không bị cache lại.
    return ctx.cache.readThrough(PREFIX.opponent(opponentId), TTL.opponent, () => getOpponent(ctx, req.userId, opponentId));
  });

  // Khiêu chiến: server mô phỏng trọn trận rồi trả dữ liệu phát lại (không phần thưởng).
  app.post('/api/pvp/challenge', { preHandler: player, schema: { body: schemas.pvpChallengeBody }, config: LIMIT_20 }, async (req) =>
    challenge(ctx, req.userId, (req.body as { opponentId: number }).opponentId),
  );

  app.get(
    '/api/pvp/battles',
    { preHandler: player, schema: { querystring: schemas.pvpBattlesQuery }, config: LIMIT_60 },
    async (req) => {
      const { page, pageSize } = req.query as { page: number; pageSize: number };
      return ctx.cache.readThrough(PREFIX.battles(req.userId, queryKey({ page, pageSize })), TTL.battles, () =>
        listBattleHistory(ctx, req.userId, page, pageSize),
      );
    },
  );

  app.get('/api/pvp/battles/:id', { preHandler: player, schema: { params: schemas.idParams }, config: LIMIT_60 }, async (req) => {
    const id = (req.params as { id: number }).id;
    // Trận đã lưu là BẤT BIẾN (chỉ INSERT, không sửa) nên TTL dài hơn nhật ký; key vẫn kèm người xem
    // vì vai trò công/thủ lật theo người xem. Phần duy nhất có thể đổi là tên/ảnh đối thủ (lấy từ `users`)
    // và đã được xoá sẵn qua DROP.battles khi đổi hồ sơ.
    return ctx.cache.readThrough(PREFIX.battles(req.userId, `id=${id}`), TTL.battleDetail, () =>
      getBattle(ctx, req.userId, id),
    );
  });
}
