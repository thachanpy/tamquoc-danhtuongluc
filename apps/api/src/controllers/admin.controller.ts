import type { FastifyInstance } from 'fastify';
import { schemas, type GiftCodeReward, type PvpGemAdminDto, type TicketType } from '@tq/shared';
import type { GameContext } from '../context.ts';
import {
  adminGrantTickets,
  adminListCards,
  adminListGems,
  adminListUsers,
  approveUser,
  rejectUser,
  setAdmin,
  type AdminCardsQuery,
  type AdminGemsQuery,
  type AdminUsersQuery,
} from '../managers/admin.manager.ts';
import { getSettings, setRequireApproval } from '../managers/settings.manager.ts';
import { adminCreateGiftCode, adminListGiftCodes, adminSetGiftCodeActive } from '../managers/giftcode.manager.ts';
import {
  adminCreatePvpHero,
  adminDeletePvpHero,
  adminListPvpHeroes,
  adminListPvpGems,
  adminUpdatePvpHero,
  adminUpdatePvpGem,
  type AdminPvpHeroCreateInput,
  type AdminPvpHeroUpdateInput,
  type AdminPvpHeroesQuery,
} from '../managers/admin-pvp.manager.ts';
import { adminGetGachaRates, adminUpdateGachaRates, type AdminGachaRatesUpdateInput } from '../managers/admin-gacha.manager.ts';
import { adminGuard, LIMIT_120 } from '../middleware/guards.ts';
import { PREFIX, TTL, queryKey } from '../cache.ts';

/** Routes trang quản trị (mục 3.7, 3.8, 3.9) — mọi route yêu cầu quyền admin. */
export function registerAdminRoutes(app: FastifyInstance, ctx: GameContext): void {
  const admin = adminGuard(ctx);
  // Danh sách Quản trị chỉ đổi khi có thao tác chơi/quản trị => cache ngắn 15s, xoá ngay ở các đường ghi.
  const list = <T>(kind: string, query: object, load: () => T): Promise<T> =>
    ctx.cache.readThrough(PREFIX.admin(kind, queryKey(query)), TTL.admin, load);

  app.get('/api/admin/users', { preHandler: admin, schema: { querystring: schemas.adminUsersQuery } }, async (req) =>
    list('users', req.query as AdminUsersQuery, () => adminListUsers(ctx, req.query as AdminUsersQuery)),
  );
  app.post('/api/admin/users/:id/approve', { preHandler: admin, schema: { params: schemas.idParams }, config: LIMIT_120 }, async (req) =>
    approveUser(ctx, (req.params as { id: number }).id),
  );
  app.post('/api/admin/users/:id/reject', { preHandler: admin, schema: { params: schemas.idParams }, config: LIMIT_120 }, async (req) =>
    rejectUser(ctx, (req.params as { id: number }).id),
  );
  app.post(
    '/api/admin/users/:id/admin',
    { preHandler: admin, schema: { params: schemas.idParams, body: schemas.adminSetAdminBody }, config: LIMIT_120 },
    async (req) => setAdmin(ctx, req.userId, (req.params as { id: number }).id, (req.body as { isAdmin: boolean }).isAdmin),
  );
  app.post('/api/admin/tickets/grant', { preHandler: admin, schema: { body: schemas.adminGrantBody }, config: LIMIT_120 }, async (req) => {
    const { userId, ticketType, amount, idempotencyKey } = req.body as {
      userId: number;
      ticketType: TicketType;
      amount: number;
      idempotencyKey: string;
    };
    return adminGrantTickets(ctx, req.userId, userId, ticketType, amount, idempotencyKey);
  });
  app.get('/api/admin/cards', { preHandler: admin, schema: { querystring: schemas.adminCardsQuery } }, async (req) =>
    list('cards', req.query as AdminCardsQuery, () => adminListCards(ctx, req.query as AdminCardsQuery)),
  );
  app.get('/api/admin/gems', { preHandler: admin, schema: { querystring: schemas.adminGemsQuery } }, async (req) =>
    list('gems', req.query as AdminGemsQuery, () => adminListGems(ctx, req.query as AdminGemsQuery)),
  );

  app.get('/api/admin/settings', { preHandler: admin }, async () => getSettings(ctx));
  app.post('/api/admin/settings', { preHandler: admin, schema: { body: schemas.adminSettingsBody }, config: LIMIT_120 }, async (req) =>
    setRequireApproval(ctx, (req.body as { requireApproval: boolean }).requireApproval, req.userId),
  );
  app.get('/api/admin/giftcodes', { preHandler: admin }, async () => ({ items: adminListGiftCodes(ctx) }));
  app.post('/api/admin/giftcodes', { preHandler: admin, schema: { body: schemas.adminGiftCodeCreateBody }, config: LIMIT_120 }, async (req) =>
    adminCreateGiftCode(ctx, req.userId, req.body as { code: string; rewards: Partial<GiftCodeReward>[]; expiresAt?: string | null; featured?: boolean }),
  );
  app.post(
    '/api/admin/giftcodes/:id/active',
    { preHandler: admin, schema: { params: schemas.idParams, body: schemas.adminGiftCodeActiveBody }, config: LIMIT_120 },
    async (req) => adminSetGiftCodeActive(ctx, (req.params as { id: number }).id, (req.body as { isActive: boolean }).isActive),
  );

  // ===== Cấu hình PvP: Tướng & Ngọc Ngũ Hành (mục 6.7) =====
  // Mọi route ghi đều bị giới hạn tần suất; manager lưu DB rồi reload() cache để engine áp dụng ngay.
  app.get('/api/admin/pvp/heroes', { preHandler: admin, schema: { querystring: schemas.adminPvpHeroesQuery } }, async (req) =>
    adminListPvpHeroes(ctx, req.query as AdminPvpHeroesQuery),
  );
  app.post(
    '/api/admin/pvp/heroes',
    { preHandler: admin, schema: { body: schemas.adminPvpHeroCreateBody }, config: LIMIT_120 },
    async (req) => adminCreatePvpHero(ctx, req.body as AdminPvpHeroCreateInput),
  );
  app.put(
    '/api/admin/pvp/heroes/:id',
    { preHandler: admin, schema: { params: schemas.pvpIdParams, body: schemas.adminPvpHeroUpdateBody }, config: LIMIT_120 },
    async (req) => adminUpdatePvpHero(ctx, (req.params as { id: string }).id, req.body as AdminPvpHeroUpdateInput),
  );
  app.delete(
    '/api/admin/pvp/heroes/:id',
    { preHandler: admin, schema: { params: schemas.pvpIdParams }, config: LIMIT_120 },
    async (req) => adminDeletePvpHero(ctx, (req.params as { id: string }).id),
  );

  app.get('/api/admin/pvp/gems', { preHandler: admin }, async () => adminListPvpGems(ctx));
  app.put(
    '/api/admin/pvp/gems',
    { preHandler: admin, schema: { body: schemas.adminPvpGemsUpdateBody }, config: LIMIT_120 },
    async (req) => adminUpdatePvpGem(ctx, req.body as PvpGemAdminDto),
  );

  // ===== Tỉ lệ quay: cấp tướng + rớt Ngọc =====
  // Server kiểm tra tổng mỗi bảng = 100%, lưu DB rồi reload cache ⇒ lượt quay kế tiếp áp dụng ngay.
  app.get('/api/admin/gacha/rates', { preHandler: admin }, async () => adminGetGachaRates());
  app.put(
    '/api/admin/gacha/rates',
    { preHandler: admin, schema: { body: schemas.adminGachaRatesUpdateBody }, config: LIMIT_120 },
    async (req) => adminUpdateGachaRates(ctx, req.body as AdminGachaRatesUpdateInput),
  );
}
