import { resolve } from 'node:path';
import { validateGameConfig } from '@tq/game-config';
import { openDatabase } from './db.ts';
import { createContext } from './context.ts';
import { createCacheFromEnv } from './cache.ts';
import { buildServer } from './server.ts';

// Validate mọi bảng tỷ lệ trước khi nhận request.
validateGameConfig();

const dbPath = process.env.DB_PATH ?? resolve(import.meta.dirname, '../../../data/tamquoc.db');
const db = openDatabase(dbPath);
// Nút cộng vé thử nghiệm: chỉ bật khi ENABLE_DEV_TOPUP=1 (script `pnpm dev` bật sẵn).
const devTopup = ['1', 'true', 'yes'].includes((process.env.ENABLE_DEV_TOPUP ?? '').toLowerCase());
// Duyệt tài khoản đăng ký: bật/tắt ở trang Quản trị (bảng app_settings), không dùng biến môi trường.
// Tặng thẻ: tạm tắt theo yêu cầu chủ dự án; chỉ bật khi ENABLE_GIFT=1.
const gift = ['1', 'true', 'yes'].includes((process.env.ENABLE_GIFT ?? '').toLowerCase());
// Cache: mặc định Redis/Dragonfly ở REDIS_URL (không đặt thì redis://127.0.0.1:6379); REDIS_URL=off để tắt.
const cache = await createCacheFromEnv((err) => console.error('[cache] lỗi Redis:', err instanceof Error ? err.message : err));
const app = await buildServer(createContext(db, { devTopup, gift }, cache));
if (devTopup) app.log.warn('ENABLE_DEV_TOPUP đang BẬT — người chơi có thể tự cộng vé. Tắt khi chạy thật.');
app.log.info(cache.enabled ? 'Cache Redis đang BẬT.' : 'Cache Redis TẮT (đặt REDIS_URL=off hoặc kết nối lỗi) — đọc thẳng database.');

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });

// Tắt êm: đóng kết nối Redis trước khi thoát.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void Promise.allSettled([app.close(), cache.close()]).then(() => process.exit(0));
  });
}
