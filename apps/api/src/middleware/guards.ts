import type { FastifyRequest } from 'fastify';
import type { DailyEventsDto } from '@tq/shared';
import { AppError, type GameContext } from '../context.ts';
import { authenticate, isAdmin } from '../managers/auth.manager.ts';
import { touchDaily } from '../managers/quest.manager.ts';

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
    /** Sự kiện ngày mới (thưởng reset 05:00, nhiệm vụ ngày cũ tự nhận) xử lý trong request này. */
    dailyEvents: DailyEventsDto | null;
  }
}

/** Cấu hình giới hạn tần suất dùng lại cho các route (đăng ký plugin rate-limit với global: false). */
export const LIMIT_20 = { rateLimit: { max: 20, timeWindow: '1 minute' } };
export const LIMIT_30 = { rateLimit: { max: 30, timeWindow: '1 minute' } };
export const LIMIT_60 = { rateLimit: { max: 60, timeWindow: '1 minute' } };
export const LIMIT_120 = { rateLimit: { max: 120, timeWindow: '1 minute' } };

export function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/** Xác thực + ghi nhận sự kiện ngày mới (admin không chơi game nên bỏ qua). */
async function doAuth(ctx: GameContext, req: FastifyRequest): Promise<void> {
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
}

/** preHandler: đã đăng nhập. */
export const authGuard = (ctx: GameContext) => (req: FastifyRequest) => doAuth(ctx, req);

/** preHandler: người chơi — thao tác chơi game (admin bị chặn 403 ADMIN_NOT_PLAYER). */
export const playerGuard = (ctx: GameContext) => async (req: FastifyRequest) => {
  await doAuth(ctx, req);
  if (isAdmin(ctx, req.userId)) {
    throw new AppError(403, 'ADMIN_NOT_PLAYER', 'Tài khoản quản trị chỉ dùng để quản trị, không tham gia chơi game.');
  }
};

/** preHandler: chỉ admin (users.is_admin = 1). Dùng cho mọi route /api/admin/*. */
export const adminGuard = (ctx: GameContext) => async (req: FastifyRequest) => {
  req.userId = authenticate(ctx, bearer(req));
  if (!isAdmin(ctx, req.userId)) throw new AppError(403, 'FORBIDDEN', 'Chỉ quản trị viên mới thực hiện được thao tác này.');
};
