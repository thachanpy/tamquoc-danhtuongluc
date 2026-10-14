import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.ts';
import { createContext } from '../src/context.ts';
import { buildServer } from '../src/server.ts';

/** Test HTTP thật qua Fastify inject (không mở cổng mạng). */
async function setup(devTopup: boolean) {
  process.env.LOG_LEVEL = 'silent';
  const app = await buildServer(createContext(openDatabase(':memory:'), { devTopup }));
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'tester', password: 'secret123' } });
  const token = reg.json().token as string;
  const auth = { authorization: `Bearer ${token}` };
  return { app, auth };
}

test('HTTP: dev-topup bật => +50 vé; /api/me báo tính năng bật', async () => {
  const { app, auth } = await setup(true);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  assert.deepEqual(me.features, { devTopup: true, devTopupAmount: 50 });
  assert.equal(me.tickets.total, 100);

  const r = await app.inject({ method: 'POST', url: '/api/tickets/dev-topup', headers: auth, payload: { idempotencyKey: 'http-topup-01' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().grantedTotal, 50);
  assert.equal(r.json().tickets.total, 150);

  // Retry cùng key
  const r2 = await app.inject({ method: 'POST', url: '/api/tickets/dev-topup', headers: auth, payload: { idempotencyKey: 'http-topup-01' } });
  assert.equal(r2.json().tickets.total, 150);
  await app.close();
});

test('HTTP: dev-topup tắt => 404, không cấp vé; client không gửi được số vé', async () => {
  const { app, auth } = await setup(false);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  assert.equal(me.features.devTopup, false);
  const r = await app.inject({ method: 'POST', url: '/api/tickets/dev-topup', headers: auth, payload: { idempotencyKey: 'http-topup-01' } });
  assert.equal(r.statusCode, 404);
  assert.equal(r.json().error.code, 'FEATURE_DISABLED');
  await app.close();

  // Bật nhưng client cố gửi "amount" => bị bỏ qua (schema additionalProperties:false), vẫn chỉ +50
  const on = await setup(true);
  const r2 = await on.app.inject({
    method: 'POST',
    url: '/api/tickets/dev-topup',
    headers: on.auth,
    payload: { idempotencyKey: 'http-topup-02', amount: 99999 },
  });
  assert.ok(r2.statusCode === 200 || r2.statusCode === 400);
  if (r2.statusCode === 200) assert.equal(r2.json().grantedTotal, 50);
  await on.app.close();
});

test('HTTP: chưa đăng nhập => 401', async () => {
  const { app } = await setup(true);
  const r = await app.inject({ method: 'POST', url: '/api/tickets/dev-topup', payload: { idempotencyKey: 'http-topup-01' } });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('HTTP: Vé Quần có trong config, quay ra đúng tướng phe Quần', async () => {
  const { app, auth } = await setup(true);
  const cfg = (await app.inject({ method: 'GET', url: '/api/gacha/config' })).json();
  const qun = (cfg.ticketTypes as { id: string; label: string; pool: string[] }[]).find((t) => t.id === 'qun')!;
  assert.equal(qun.label, 'Vé Quần');
  assert.equal(qun.pool.length, 25);
  assert.ok(qun.pool.includes('lu-bu'));
  // Cộng vé tới khi có Vé Quần rồi quay
  let i = 0;
  while ((await app.inject({ method: 'GET', url: '/api/tickets', headers: auth })).json().balances.qun < 1 && i < 5) {
    await app.inject({ method: 'POST', url: '/api/tickets/dev-topup', headers: auth, payload: { idempotencyKey: `http-topup-q${i++}` } });
  }
  const r = await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: auth, payload: { ticketType: 'qun', count: 10, idempotencyKey: 'http-draw-qun' } });
  assert.equal(r.statusCode, 200);
  const results = r.json().results as { general: { faction: string } }[];
  assert.ok(results.length >= 1);
  assert.ok(results.every((x) => x.general.faction === 'qun'));
  await app.close();
});

test('HTTP: quay ×10 sau khi topup chỉ ra level ≤ 9', async () => {
  const { app, auth } = await setup(true);
  await app.inject({ method: 'POST', url: '/api/tickets/dev-topup', headers: auth, payload: { idempotencyKey: 'http-topup-01' } });
  const t = (await app.inject({ method: 'GET', url: '/api/tickets', headers: auth })).json();
  const type = Object.entries(t.balances as Record<string, number>).sort((a, b) => b[1] - a[1])[0]![0];
  const r = await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: auth, payload: { ticketType: type, count: 10, idempotencyKey: 'http-draw-01' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().drawn, 10);
  assert.ok((r.json().results as { card: { level: number } }[]).every((x) => x.card.level <= 9));
  await app.close();
});

test('HTTP: Nâng cấp nhanh hoạt động qua API, chưa đăng nhập => 401', async () => {
  const { app, auth } = await setup(true);
  // Chưa có thẻ => 409 NOTHING_TO_UPGRADE
  const none = await app.inject({ method: 'POST', url: '/api/upgrades/quick', headers: auth, payload: { idempotencyKey: 'http-quick-00' } });
  assert.equal(none.statusCode, 409);
  assert.equal(none.json().error.code, 'NOTHING_TO_UPGRADE');
  // Quay hết vé quà đăng ký để có nhiều thẻ trùng
  const bal = (await app.inject({ method: 'GET', url: '/api/tickets', headers: auth })).json().balances as Record<string, number>;
  let k = 0;
  for (const [type, n] of Object.entries(bal)) {
    for (let i = 0; i < Math.ceil(n / 10); i++) {
      await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: auth, payload: { ticketType: type, count: 10, idempotencyKey: `http-q-draw-${k++}` } });
    }
  }
  const cfg = (await app.inject({ method: 'GET', url: '/api/gacha/config' })).json();
  assert.equal(cfg.quickUpgradeMaxLevel, 5);
  assert.equal(cfg.upgradeRates.length, 9);
  const r = await app.inject({ method: 'POST', url: '/api/upgrades/quick', headers: auth, payload: { idempotencyKey: 'http-quick-01' } });
  assert.ok(r.statusCode === 200 || r.statusCode === 409);
  if (r.statusCode === 200) {
    const body = r.json();
    assert.equal(body.merges, body.successes + body.failures);
    assert.ok((body.results as { inputLevel: number }[]).every((x) => x.inputLevel <= 5));
  }
  const unauth = await app.inject({ method: 'POST', url: '/api/upgrades/quick', payload: { idempotencyKey: 'http-quick-02' } });
  assert.equal(unauth.statusCode, 401);
  await app.close();
});

test('HTTP: tặng thẻ qua API; quá 20 thẻ bị chặn; người nhận thấy thẻ trong bộ sưu tập', async () => {
  const { app, auth } = await setup(true);
  const bobReg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob_http', password: 'secret123' } });
  const bobAuth = { authorization: `Bearer ${bobReg.json().token}` };
  // Quay để có thẻ
  const bal = (await app.inject({ method: 'GET', url: '/api/tickets', headers: auth })).json().balances as Record<string, number>;
  const type = Object.entries(bal).sort((a, b) => b[1] - a[1])[0]![0];
  for (let i = 0; i < 3; i++) {
    await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: auth, payload: { ticketType: type, count: 10, idempotencyKey: `http-g-draw-${i}` } });
  }
  const mine = (await app.inject({ method: 'GET', url: '/api/cards?pageSize=500', headers: auth })).json().items as { id: number }[];
  assert.ok(mine.length >= 21);
  const tooMany = await app.inject({ method: 'POST', url: '/api/gifts', headers: auth, payload: { toUsername: 'bob_http', cardIds: mine.slice(0, 21).map((c) => c.id), idempotencyKey: 'http-gift-01' } });
  assert.equal(tooMany.statusCode, 400);
  assert.equal(tooMany.json().error.code, 'GIFT_CARD_COUNT');
  const ok = await app.inject({ method: 'POST', url: '/api/gifts', headers: auth, payload: { toUsername: 'bob_http', cardIds: mine.slice(0, 20).map((c) => c.id), idempotencyKey: 'http-gift-02' } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().cards.length, 20);
  const bobCards = (await app.inject({ method: 'GET', url: '/api/cards?pageSize=500', headers: bobAuth })).json();
  assert.equal(bobCards.total, 20);
  const hist = (await app.inject({ method: 'GET', url: '/api/history?kind=gift', headers: bobAuth })).json();
  assert.equal(hist.items[0].direction, 'received');
  assert.equal((await app.inject({ method: 'GET', url: '/api/gacha/config' })).json().giftMaxCards, 20);
  await app.close();
});

test('HTTP: GET /api/users trả mọi người chơi trừ mình, người giao dịch gần nhất lên đầu, có tìm kiếm; cần đăng nhập', async () => {
  const { app, auth } = await setup(true);
  for (const n of ['zed_user', 'amy_user']) {
    await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: n, password: 'secret123' } });
  }
  let list = (await app.inject({ method: 'GET', url: '/api/users', headers: auth })).json().items as { username: string }[];
  assert.deepEqual(list.map((u) => u.username), ['amy_user', 'zed_user']);
  // Quay 1 thẻ rồi tặng zed => zed lên đầu
  const bal = (await app.inject({ method: 'GET', url: '/api/tickets', headers: auth })).json().balances as Record<string, number>;
  const type = Object.entries(bal).sort((a, b) => b[1] - a[1])[0]![0];
  const d = (await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: auth, payload: { ticketType: type, idempotencyKey: 'http-u-draw-1' } })).json();
  await app.inject({ method: 'POST', url: '/api/gifts', headers: auth, payload: { toUsername: 'zed_user', cardIds: [d.results[0].card.id], idempotencyKey: 'http-u-gift-1' } });
  list = (await app.inject({ method: 'GET', url: '/api/users', headers: auth })).json().items;
  assert.deepEqual(list.map((u) => u.username), ['zed_user', 'amy_user']);
  const found = (await app.inject({ method: 'GET', url: '/api/users?q=AMY', headers: auth })).json().items;
  assert.deepEqual(found.map((u: { username: string }) => u.username), ['amy_user']);
  assert.equal((await app.inject({ method: 'GET', url: '/api/users' })).statusCode, 401);
  await app.close();
});
