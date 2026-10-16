import type { FastifyInstance } from 'fastify';
import { schemas, type GiftCodeReward, type TicketType } from '@tq/shared';
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
import { adminGuard, LIMIT_120 } from '../middleware/guards.ts';

/** Routes trang quản trị (mục 3.7, 3.8, 3.9) — mọi route yêu cầu quyền admin. */
export function registerAdminRoutes(app: FastifyInstance, ctx: GameContext): void {
  const admin = adminGuard(ctx);

  app.get('/api/admin/users', { preHandler: admin, schema: { querystring: schemas.adminUsersQuery } }, async (req) =>
    adminListUsers(ctx, req.query as AdminUsersQuery),
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
    adminListCards(ctx, req.query as AdminCardsQuery),
  );
  app.get('/api/admin/gems', { preHandler: admin, schema: { querystring: schemas.adminGemsQuery } }, async (req) =>
    adminListGems(ctx, req.query as AdminGemsQuery),
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
}
