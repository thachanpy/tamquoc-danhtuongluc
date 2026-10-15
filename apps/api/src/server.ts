import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { schemas, type TicketType, type MeDto, type DailyEventsDto } from '@tq/shared';
import { ROSTER, DEV_TOPUP_TICKETS } from '@tq/game-config';
import { AppError, type GameContext } from './context.ts';
import { register, login, logout, authenticate, getUsername, isAdmin } from './auth.ts';
import {
  adminListUsers,
  adminListCards,
  approveUser,
  rejectUser,
  setAdmin,
  adminGrantTickets,
  type AdminUsersQuery,
  type AdminCardsQuery,
} from './admin.ts';
import { claimRecovery, devTopup, getTickets, syncRecovery } from './tickets.ts';
import { draw, getGachaConfig } from './gacha.ts';
import { previewUpgrade, attemptUpgrade, quickUpgrade } from './upgrade.ts';
import { giftCards, listRecipients } from './gift.ts';
import {
  redeemGiftCode,
  listFeaturedGiftCodes,
  listMyRedemptions,
  adminListGiftCodes,
  adminCreateGiftCode,
  adminSetGiftCodeActive,
} from './giftcode.ts';
import type { GiftCodeReward } from '@tq/shared';
import { getSettings, setRequireApproval } from './settings.ts';
import { getLeaderboard } from './leaderboard.ts';
import { touchDaily, getQuests, claimQuests } from './quests.ts';
import { listCards, listHistory, type CardsQuery, type HistoryQuery } from './queries.ts';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
    /** Sự kiện ngày mới (thưởng reset 05:00, nhiệm vụ ngày cũ tự nhận) xử lý trong request này. */
    dailyEvents: DailyEventsDto | null;
  }
}

function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

export async function buildServer(ctx: GameContext): Promise<FastifyInstance> {
  const app = Fastify({
    // Chạy sau nginx: tin header X-Forwarded-For từ proxy cục bộ để rate limit theo IP thật của người chơi.
    // Đổi bằng TRUST_PROXY (VD "10.0.0.5") nếu proxy ở máy khác; "false" để tắt.
    trustProxy: process.env.TRUST_PROXY === 'false' ? false : (process.env.TRUST_PROXY ?? '127.0.0.1,::1'),
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      // Không ghi token/mật khẩu vào log
      redact: ['req.headers.authorization', 'req.body.password'],
    },
  });

  await app.register(rateLimit, { global: false });
  app.decorateRequest('userId', 0);

  // Định dạng lỗi thống nhất: { error: { code, message } }
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    const e = err as { validation?: unknown; statusCode?: number; message: string };
    if (e.validation) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: e.message } });
    }
    if (e.statusCode === 429) {
      return reply.status(429).send({ error: { code: 'RATE_LIMITED', message: 'Thao tác quá nhanh, thử lại sau.' } });
    }
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'INTERNAL', message: 'Lỗi máy chủ.' } });
  });

  const auth = async (req: FastifyRequest) => {
    req.userId = authenticate(ctx, bearer(req));
    req.dailyEvents = null;
    // Tài khoản quản trị không chơi game (chủ dự án yêu cầu): không ghi đăng nhập/thưởng ngày/nhiệm vụ
    if (isAdmin(ctx, req.userId)) return;
    // Ngày mới: ghi nhận đăng nhập, thưởng reset 05:00, tự nhận nhiệm vụ ngày cũ (mục 3.10).
    // Lỗi ở đây không được chặn thao tác chính của người chơi; lần request sau sẽ xử lý lại.
    try {
      req.dailyEvents = touchDaily(ctx, req.userId);
    } catch (err) {
      req.dailyEvents = null;
      req.log.error(err);
    }
  };
  // Thao tác chơi game (quay, ghép, tặng, giftcode, nhiệm vụ, hồi vé): admin bị chặn 403 ADMIN_NOT_PLAYER.
  const playerAuth = async (req: FastifyRequest) => {
    await auth(req);
    if (isAdmin(ctx, req.userId)) {
      throw new AppError(403, 'ADMIN_NOT_PLAYER', 'Tài khoản quản trị chỉ dùng để quản trị, không tham gia chơi game.');
    }
  };
  // Chỉ admin (users.is_admin = 1). Kiểm tra ở server cho mọi route /api/admin/*.
  const adminAuth = async (req: FastifyRequest) => {
    req.userId = authenticate(ctx, bearer(req));
    if (!isAdmin(ctx, req.userId)) throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên mới thực hiện được thao tác này.');
  };
  const strictLimit = { rateLimit: { max: 60, timeWindow: '1 minute' } };
  const authLimit = { rateLimit: { max: 20, timeWindow: '1 minute' } };

  // ---------- Auth ----------
  app.post('/api/auth/register', { schema: { body: schemas.credentials }, config: authLimit }, async (req) => {
    const { username, password } = req.body as { username: string; password: string };
    return register(ctx, username, password);
  });
  app.post('/api/auth/login', { schema: { body: schemas.credentials }, config: authLimit }, async (req) => {
    const { username, password } = req.body as { username: string; password: string };
    return login(ctx, username, password);
  });
  app.post('/api/auth/logout', { preHandler: auth }, async (req) => {
    const t = bearer(req);
    if (t) logout(ctx, t);
    return { ok: true };
  });

  // ---------- Tài khoản & bộ sưu tập ----------
  app.get('/api/me', { preHandler: auth }, async (req): Promise<MeDto> => {
    // Admin không chơi game => không hồi vé
    if (!isAdmin(ctx, req.userId)) syncRecovery(ctx, req.userId);
    return {
      id: req.userId,
      username: getUsername(ctx, req.userId),
      isAdmin: isAdmin(ctx, req.userId),
      tickets: getTickets(ctx, req.userId),
      features: { devTopup: !!ctx.features?.devTopup, devTopupAmount: DEV_TOPUP_TICKETS },
      ...(req.dailyEvents ? { dailyEvents: req.dailyEvents } : {}),
    };
  });
  app.get('/api/generals', async () => ({ items: ROSTER }));
  app.get('/api/cards', { preHandler: auth, schema: { querystring: schemas.cardsQuery } }, async (req) =>
    listCards(ctx, req.userId, req.query as CardsQuery),
  );

  // ---------- Vé ----------
  app.get('/api/tickets', { preHandler: auth }, async (req) => getTickets(ctx, req.userId));
  app.post('/api/tickets/claim-recovery', { preHandler: playerAuth }, async (req) => ({
    ...claimRecovery(ctx, req.userId),
    ...(req.dailyEvents ? { dailyEvents: req.dailyEvents } : {}),
  }));
  // Nút cộng vé thử nghiệm — chỉ hoạt động khi ENABLE_DEV_TOPUP bật (service trả 404 nếu tắt)
  app.post(
    '/api/tickets/dev-topup',
    { preHandler: playerAuth, schema: { body: schemas.devTopupBody }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => devTopup(ctx, req.userId, (req.body as { idempotencyKey: string }).idempotencyKey),
  );

  // ---------- Gacha ----------
  app.get('/api/gacha/config', async () => getGachaConfig());
  app.post('/api/gacha/draw', { preHandler: playerAuth, schema: { body: schemas.drawBody }, config: strictLimit }, async (req) => {
    const { ticketType, idempotencyKey, count } = req.body as { ticketType: TicketType; idempotencyKey: string; count?: number };
    return draw(ctx, req.userId, ticketType, idempotencyKey, count ?? 1);
  });

  // ---------- Nâng cấp ----------
  app.post(
    '/api/upgrades/preview',
    { preHandler: playerAuth, schema: { body: schemas.upgradePreviewBody }, config: strictLimit },
    async (req) => previewUpgrade(ctx, req.userId, (req.body as { cardIds: number[] }).cardIds),
  );
  app.post(
    '/api/upgrades/attempt',
    { preHandler: playerAuth, schema: { body: schemas.upgradeAttemptBody }, config: strictLimit },
    async (req) => {
      const { cardIds, idempotencyKey } = req.body as { cardIds: number[]; idempotencyKey: string };
      return attemptUpgrade(ctx, req.userId, cardIds, idempotencyKey);
    },
  );

  app.post(
    '/api/upgrades/quick',
    { preHandler: playerAuth, schema: { body: schemas.quickUpgradeBody }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => quickUpgrade(ctx, req.userId, (req.body as { idempotencyKey: string }).idempotencyKey),
  );

  // ---------- Tặng thẻ ----------
  app.get('/api/users', { preHandler: playerAuth, schema: { querystring: schemas.usersQuery } }, async (req) => {
    const { q, limit } = req.query as { q?: string; limit?: number };
    return { items: listRecipients(ctx, req.userId, q ?? '', limit ?? 200) };
  });
  app.post(
    '/api/gifts',
    { preHandler: playerAuth, schema: { body: schemas.giftBody }, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req) => {
      const { toUsername, cardIds, idempotencyKey } = req.body as { toUsername: string; cardIds: number[]; idempotencyKey: string };
      return giftCards(ctx, req.userId, toUsername, cardIds, idempotencyKey);
    },
  );

  // ---------- Giftcode (mục 3.9) ----------
  app.get('/api/giftcodes', { preHandler: playerAuth }, async (req) => ({
    featured: listFeaturedGiftCodes(ctx, req.userId),
    redeemed: listMyRedemptions(ctx, req.userId),
  }));
  app.post(
    '/api/giftcodes/redeem',
    { preHandler: playerAuth, schema: { body: schemas.giftCodeRedeemBody }, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => redeemGiftCode(ctx, req.userId, (req.body as { code: string }).code),
  );

  // ---------- Quản trị (mục 3.8) ----------
  const adminLimit = { rateLimit: { max: 120, timeWindow: '1 minute' } };
  app.get('/api/admin/users', { preHandler: adminAuth, schema: { querystring: schemas.adminUsersQuery } }, async (req) =>
    adminListUsers(ctx, req.query as AdminUsersQuery),
  );
  app.post('/api/admin/users/:id/approve', { preHandler: adminAuth, schema: { params: schemas.idParams }, config: adminLimit }, async (req) =>
    approveUser(ctx, (req.params as { id: number }).id),
  );
  app.post('/api/admin/users/:id/reject', { preHandler: adminAuth, schema: { params: schemas.idParams }, config: adminLimit }, async (req) =>
    rejectUser(ctx, (req.params as { id: number }).id),
  );
  app.post(
    '/api/admin/users/:id/admin',
    { preHandler: adminAuth, schema: { params: schemas.idParams, body: schemas.adminSetAdminBody }, config: adminLimit },
    async (req) => setAdmin(ctx, req.userId, (req.params as { id: number }).id, (req.body as { isAdmin: boolean }).isAdmin),
  );
  app.post('/api/admin/tickets/grant', { preHandler: adminAuth, schema: { body: schemas.adminGrantBody }, config: adminLimit }, async (req) => {
    const { userId, ticketType, amount, idempotencyKey } = req.body as {
      userId: number;
      ticketType: TicketType;
      amount: number;
      idempotencyKey: string;
    };
    return adminGrantTickets(ctx, req.userId, userId, ticketType, amount, idempotencyKey);
  });
  app.get('/api/admin/cards', { preHandler: adminAuth, schema: { querystring: schemas.adminCardsQuery } }, async (req) =>
    adminListCards(ctx, req.query as AdminCardsQuery),
  );

  app.get('/api/admin/settings', { preHandler: adminAuth }, async () => getSettings(ctx));
  app.post('/api/admin/settings', { preHandler: adminAuth, schema: { body: schemas.adminSettingsBody }, config: adminLimit }, async (req) =>
    setRequireApproval(ctx, (req.body as { requireApproval: boolean }).requireApproval, req.userId),
  );
  app.get('/api/admin/giftcodes', { preHandler: adminAuth }, async () => ({ items: adminListGiftCodes(ctx) }));
  app.post('/api/admin/giftcodes', { preHandler: adminAuth, schema: { body: schemas.adminGiftCodeCreateBody }, config: adminLimit }, async (req) =>
    adminCreateGiftCode(ctx, req.userId, req.body as { code: string; rewards: Partial<GiftCodeReward>[]; expiresAt?: string | null; featured?: boolean }),
  );
  app.post(
    '/api/admin/giftcodes/:id/active',
    { preHandler: adminAuth, schema: { params: schemas.idParams, body: schemas.adminGiftCodeActiveBody }, config: adminLimit },
    async (req) => adminSetGiftCodeActive(ctx, (req.params as { id: number }).id, (req.body as { isActive: boolean }).isActive),
  );

  // ---------- Nhiệm vụ & thành tựu (mục 3.10) ----------
  app.get('/api/quests', { preHandler: playerAuth, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) =>
    getQuests(ctx, req.userId),
  );
  app.post(
    '/api/quests/claim',
    { preHandler: playerAuth, schema: { body: schemas.questClaimBody }, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req) => claimQuests(ctx, req.userId, (req.body as { keys?: string[] } | undefined)?.keys),
  );

  // ---------- Bảng xếp hạng (mục 6.6) ----------
  app.get('/api/leaderboard', { preHandler: auth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) =>
    getLeaderboard(ctx, req.userId),
  );

  // ---------- Lịch sử ----------
  app.get('/api/history', { preHandler: auth, schema: { querystring: schemas.historyQuery } }, async (req) =>
    listHistory(ctx, req.userId, req.query as HistoryQuery),
  );

  return app;
}
