import type { FastifyInstance } from 'fastify';
import { schemas, type MeDto } from '@tq/shared';
import { DEV_TOPUP_TICKETS, ROSTER } from '@tq/game-config';
import type { GameContext } from '../context.ts';
import { PREFIX, TTL, queryKey } from '../cache.ts';
import { getProfile, getUsername, isAdmin } from '../managers/auth.manager.ts';
import { getTickets, syncRecovery } from '../managers/ticket.manager.ts';
import { listCards, listHistory, type CardsQuery, type HistoryQuery } from '../managers/collection.manager.ts';
import { rosterSkillNames, rosterSkills, rosterStyles } from '../managers/pvp.manager.ts';
import { authGuard } from '../middleware/guards.ts';

/** Routes tài khoản, bộ sưu tập và lịch sử của người chơi (mục 6.3, 6.4). */
export function registerCollectionRoutes(app: FastifyInstance, ctx: GameContext): void {
  const auth = authGuard(ctx);

  app.get('/api/me', { preHandler: auth }, async (req): Promise<MeDto> => {
    // Admin không chơi game => không hồi vé
    const admin = await isAdmin(ctx, req.userId);
    if (!admin) syncRecovery(ctx, req.userId);
    return {
      id: req.userId,
      username: getUsername(ctx, req.userId),
      ...getProfile(ctx, req.userId),
      isAdmin: admin,
      tickets: getTickets(ctx, req.userId),
      features: { devTopup: !!ctx.features?.devTopup, devTopupAmount: DEV_TOPUP_TICKETS, gift: !!ctx.features?.gift },
      ...(req.dailyEvents ? { dailyEvents: req.dailyEvents } : {}),
    };
  });
  // styles/skills/skillNames: phong cách + kỹ năng chiến đấu + tên chiêu thật từng tướng (mục 6.7).
  // Client hiện nhãn Tấn công/Phòng thủ/Hỗ trợ trên mọi thẻ, hiện kỹ năng khi chọn tướng PvP,
  // và hiện tên chiêu thay cho nhãn chung (ví dụ "Hiệu lệnh thiên hạ").
  app.get('/api/generals', async () => ({ items: ROSTER, styles: rosterStyles(), skills: rosterSkills(), skillNames: rosterSkillNames() }));
  app.get('/api/cards', { preHandler: auth, schema: { querystring: schemas.cardsQuery } }, async (req) => {
    const query = req.query as CardsQuery;
    // Bộ sưu tập đổi khi quay thẻ/ghép/tặng => cache 30s, xoá ngay ở các thao tác đó.
    return ctx.cache.readThrough(PREFIX.collection(req.userId, 'cards', queryKey(query)), TTL.collection, () =>
      listCards(ctx, req.userId, query),
    );
  });
  app.get('/api/history', { preHandler: auth, schema: { querystring: schemas.historyQuery } }, async (req) => {
    const query = req.query as HistoryQuery;
    // Lịch sử gộp 5 bảng bằng UNION ALL nên nặng; cache 30s, xoá ở mọi thao tác ghi (vé, quay, ghép, tặng).
    return ctx.cache.readThrough(PREFIX.history(req.userId, queryKey(query)), TTL.history, () =>
      listHistory(ctx, req.userId, query),
    );
  });
}
