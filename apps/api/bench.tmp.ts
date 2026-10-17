import { createContext } from './src/context.ts';
import { openDatabase } from './src/db.ts';
import { buildServer } from './src/server.ts';
import { setRequireApproval } from './src/managers/settings.manager.ts';
import { ROSTER } from '@tq/game-config';

process.env.LOG_LEVEL = 'silent';

function addCard(ctx: ReturnType<typeof createContext>, userId: number, generalId: string, level: number): void {
  ctx.db
    .prepare('INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(userId, generalId, level, 'x', 'x');
}

async function main() {
  const ctx = createContext(openDatabase(':memory:'), { devTopup: true, gift: true });
  setRequireApproval(ctx, false);
  const app = await buildServer(ctx);

  const boss = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'boss', password: 'secret123' } });
  const adminAuth = { authorization: `Bearer ${boss.json().token as string}` };
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'tester', password: 'secret123' } });
  const auth = { authorization: `Bearer ${reg.json().token as string}` };
  const testerId = reg.json().userId as number;

  // 6 tướng mỗi bên để đúng kịch bản thật (đội đầy).
  for (let i = 0; i < 8; i++) addCard(ctx, testerId, ROSTER[i]!.id, 9);

  const r2 = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'rival', password: 'secret123' } });
  await app.inject({ method: 'POST', url: `/api/admin/users/${r2.json().userId as number}/approve`, headers: adminAuth });
  const login2 = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'rival', password: 'secret123' } });
  const rivalId = r2.json().userId as number;
  for (let i = 0; i < 8; i++) addCard(ctx, rivalId, ROSTER[i + 20]!.id, 9);

  const call = () =>
    app.inject({ method: 'POST', url: '/api/pvp/challenge', headers: auth, payload: { opponentId: rivalId } });

  await call(); // warmup

  const N = 50;
  const t0 = performance.now();
  let bytes = 0;
  let events = 0;
  for (let i = 0; i < N; i++) {
    const res = await call();
    bytes += res.rawPayload.length;
    events += (res.json().events as unknown[]).length;
  }
  const t1 = performance.now();
  console.log(`challenge (HTTP inject): ${((t1 - t0) / N).toFixed(2)} ms/lần`);
  console.log(`response: ${(bytes / N / 1024).toFixed(1)} KB, events: ${(events / N).toFixed(1)}`);
  console.log(`DB size sau ${N} trận: ${(ctx.db.prepare('SELECT SUM(LENGTH(data)) AS n FROM pvp_battles').get() as { n: number }).n / 1024 | 0} KB`);

  await app.close();
}

main();
