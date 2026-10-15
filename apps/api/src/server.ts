import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { AppError, type GameContext } from './context.ts';
import { registerAdminRoutes } from './controllers/admin.controller.ts';
import { registerAuthRoutes } from './controllers/auth.controller.ts';
import { registerCollectionRoutes } from './controllers/collection.controller.ts';
import { registerGachaRoutes } from './controllers/gacha.controller.ts';
import { registerGiftRoutes } from './controllers/gift.controller.ts';
import { registerGiftCodeRoutes } from './controllers/giftcode.controller.ts';
import { registerLeaderboardRoutes } from './controllers/leaderboard.controller.ts';
import { registerProfileRoutes } from './controllers/profile.controller.ts';
import { registerPvpRoutes } from './controllers/pvp.controller.ts';
import { registerQuestRoutes } from './controllers/quest.controller.ts';
import { registerTicketRoutes } from './controllers/ticket.controller.ts';
import { registerUpgradeRoutes } from './controllers/upgrade.controller.ts';

/**
 * Bootstrap HTTP: cấu hình Fastify, đăng ký plugin & error handler, rồi gắn các controller.
 * Toàn bộ logic nghiệp vụ nằm ở managers/, truy vấn SQL ở repositories/, guard/route ở controllers/.
 */
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

  registerAuthRoutes(app, ctx);
  registerProfileRoutes(app, ctx);
  registerCollectionRoutes(app, ctx);
  registerTicketRoutes(app, ctx);
  registerGachaRoutes(app, ctx);
  registerUpgradeRoutes(app, ctx);
  registerGiftRoutes(app, ctx);
  registerGiftCodeRoutes(app, ctx);
  registerQuestRoutes(app, ctx);
  registerLeaderboardRoutes(app, ctx);
  registerPvpRoutes(app, ctx);
  registerAdminRoutes(app, ctx);

  return app;
}
