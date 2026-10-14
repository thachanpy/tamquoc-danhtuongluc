import { resolve } from 'node:path';
import { validateGameConfig } from '@tq/game-config';
import { openDatabase } from './db.ts';
import { createContext } from './context.ts';
import { buildServer } from './server.ts';

// Validate mọi bảng tỷ lệ trước khi nhận request.
validateGameConfig();

const dbPath = process.env.DB_PATH ?? resolve(import.meta.dirname, '../../../data/tamquoc.db');
const db = openDatabase(dbPath);
// Nút cộng vé thử nghiệm: chỉ bật khi ENABLE_DEV_TOPUP=1 (script `pnpm dev` bật sẵn).
const devTopup = ['1', 'true', 'yes'].includes((process.env.ENABLE_DEV_TOPUP ?? '').toLowerCase());
const app = await buildServer(createContext(db, { devTopup }));
if (devTopup) app.log.warn('ENABLE_DEV_TOPUP đang BẬT — người chơi có thể tự cộng vé. Tắt khi chạy thật.');

const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: process.env.HOST ?? '127.0.0.1' });
