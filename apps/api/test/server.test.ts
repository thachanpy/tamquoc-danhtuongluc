import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.ts';
import { createContext } from '../src/context.ts';
import { buildServer } from '../src/server.ts';
import { setRequireApproval } from '../src/managers/settings.manager.ts';
import { insertGem } from '../src/repositories/gem.repository.ts';
import { DAILY_RESET_BONUS } from '@tq/game-config';

/** Thưởng reset 05:00 (mục 3.10) được cộng ở request đầu tiên trong ngày của mỗi người chơi. */
const RESET = Object.values(DAILY_RESET_BONUS).reduce((s, n) => s + n, 0);

/** Test HTTP thật qua Fastify inject (không mở cổng mạng). */
/** Các test duyệt tài khoản chạy với cài đặt "Duyệt tài khoản" bật; mặc định thật của server là tắt. */
async function setup(devTopup: boolean, requireApproval = true, gift = true) {
  process.env.LOG_LEVEL = 'silent';
  const ctx = createContext(openDatabase(':memory:'), { devTopup, gift });
  setRequireApproval(ctx, false);
  const app = await buildServer(ctx);
  // Tài khoản đầu tiên tự thành admin (chỉ quản trị, không chơi game); 'tester' là người chơi thường.
  const boss = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'boss', password: 'secret123' } });
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'tester', password: 'secret123' } });
  setRequireApproval(ctx, requireApproval);
  const adminAuth = { authorization: `Bearer ${boss.json().token as string}` };
  const auth = { authorization: `Bearer ${reg.json().token as string}` };
  return { app, auth, adminAuth, ctx };
}

type App = Awaited<ReturnType<typeof setup>>['app'];

/** Đăng ký qua HTTP (=> chờ duyệt), admin duyệt qua API, rồi đăng nhập. Trả header auth của người chơi mới. */
async function regApproved(app: App, adminAuth: Record<string, string>, username: string) {
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  assert.equal(reg.json().status, 'pending');
  const ok = await app.inject({ method: 'POST', url: `/api/admin/users/${reg.json().userId}/approve`, headers: adminAuth });
  assert.equal(ok.statusCode, 200);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'secret123' } });
  return { authorization: `Bearer ${login.json().token}` };
}

test('HTTP: dev-topup bật => +50 vé; /api/me báo tính năng bật', async () => {
  const { app, auth } = await setup(true);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  assert.deepEqual(me.features, { devTopup: true, devTopupAmount: 50, gift: true });
  assert.equal(me.tickets.total, 100 + RESET);

  const r = await app.inject({ method: 'POST', url: '/api/tickets/dev-topup', headers: auth, payload: { idempotencyKey: 'http-topup-01' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().grantedTotal, 50);
  assert.equal(r.json().tickets.total, 150 + RESET);

  // Retry cùng key
  const r2 = await app.inject({ method: 'POST', url: '/api/tickets/dev-topup', headers: auth, payload: { idempotencyKey: 'http-topup-01' } });
  assert.equal(r2.json().tickets.total, 150 + RESET);
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
  assert.equal(qun.pool.length, 35);
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
    assert.deepEqual(body.levels, [1, 2, 3, 4, 5]); // bỏ trống levels => mặc định Lv.1–5
    assert.ok((body.results as { inputLevel: number }[]).every((x) => x.inputLevel <= 5));
  }
  // Level ngoài khoảng Lv.1–9 bị schema chặn
  const bad = await app.inject({ method: 'POST', url: '/api/upgrades/quick', headers: auth, payload: { idempotencyKey: 'http-quick-03', levels: [10] } });
  assert.equal(bad.statusCode, 400);
  const unauth = await app.inject({ method: 'POST', url: '/api/upgrades/quick', payload: { idempotencyKey: 'http-quick-02' } });
  assert.equal(unauth.statusCode, 401);
  await app.close();
});

test('HTTP: tặng thẻ qua API; quá 20 thẻ bị chặn; người nhận thấy thẻ trong bộ sưu tập', async () => {
  const { app, auth, adminAuth } = await setup(true);
  const bobAuth = await regApproved(app, adminAuth, 'bob_http');
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
  const { app, auth, adminAuth } = await setup(true);
  for (const n of ['zed_user', 'amy_user']) await regApproved(app, adminAuth, n);
  // Tài khoản chờ duyệt không xuất hiện trong danh sách người nhận
  await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'pend_user', password: 'secret123' } });
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

test('HTTP: đăng ký mới => chờ duyệt, không token, không đăng nhập được; admin duyệt => nhận 100 vé quà', async () => {
  const { app, adminAuth: auth } = await setup(false);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  assert.equal(me.isAdmin, true); // tài khoản đầu tiên tự thành admin
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'newbie', password: 'secret123' } });
  assert.equal(reg.statusCode, 200);
  assert.equal(reg.json().status, 'pending');
  assert.equal(reg.json().token, undefined);
  const denied = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'newbie', password: 'secret123' } });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().error.code, 'ACCOUNT_PENDING');
  // Sai mật khẩu vẫn là INVALID_CREDENTIALS (không lộ trạng thái)
  const wrong = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'newbie', password: 'wrongpass' } });
  assert.equal(wrong.json().error.code, 'INVALID_CREDENTIALS');
  // Danh sách: pending lên đầu, chưa có vé
  const list = (await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth })).json();
  assert.equal(list.pendingCount, 1);
  assert.equal(list.items[0].username, 'newbie');
  assert.equal(list.items[0].status, 'pending');
  assert.equal(list.items[0].ticketTotal, 0);
  // Duyệt
  const ap = await app.inject({ method: 'POST', url: `/api/admin/users/${reg.json().userId}/approve`, headers: auth });
  assert.equal(ap.statusCode, 200);
  assert.equal(ap.json().user.status, 'approved');
  assert.equal(ap.json().user.ticketTotal, 100);
  // Duyệt lần 2 => 409, không cấp thêm
  const again = await app.inject({ method: 'POST', url: `/api/admin/users/${reg.json().userId}/approve`, headers: auth });
  assert.equal(again.json().error.code, 'ALREADY_APPROVED');
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'newbie', password: 'secret123' } });
  assert.equal(login.statusCode, 200);
  const nAuth = { authorization: `Bearer ${login.json().token}` };
  const nMe = (await app.inject({ method: 'GET', url: '/api/me', headers: nAuth })).json();
  assert.equal(nMe.isAdmin, false);
  assert.equal(nMe.tickets.total, 100 + RESET);
  await app.close();
});

test('HTTP: từ chối đăng ký xoá tài khoản chờ duyệt, tên dùng lại được; không từ chối tài khoản đã duyệt', async () => {
  const { app, adminAuth: auth } = await setup(false);
  const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'spam_user', password: 'secret123' } })).json();
  const rj = await app.inject({ method: 'POST', url: `/api/admin/users/${reg.userId}/reject`, headers: auth });
  assert.equal(rj.statusCode, 200);
  const re = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'spam_user', password: 'secret123' } });
  assert.equal(re.json().status, 'pending');
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  const bad = await app.inject({ method: 'POST', url: `/api/admin/users/${me.id}/reject`, headers: auth });
  assert.equal(bad.json().error.code, 'NOT_PENDING');
  await app.close();
});

test('HTTP: route admin chặn người không phải admin (403) và chưa đăng nhập (401)', async () => {
  const { app, adminAuth: auth } = await setup(false);
  const pAuth = await regApproved(app, auth, 'player_a');
  for (const [method, url] of [
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/cards'],
    ['POST', '/api/admin/users/1/approve'],
    ['POST', '/api/admin/users/1/reject'],
  ] as const) {
    assert.equal((await app.inject({ method, url, headers: pAuth })).statusCode, 403, url);
    assert.equal((await app.inject({ method, url })).statusCode, 401, url);
  }
  const g = await app.inject({
    method: 'POST',
    url: '/api/admin/tickets/grant',
    headers: pAuth,
    payload: { userId: 1, ticketType: 'normal', amount: 5, idempotencyKey: 'grant-forbid-1' },
  });
  assert.equal(g.statusCode, 403);
  // Cấp quyền admin => truy cập được; không tự thu quyền của chính mình
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: pAuth })).json();
  const up = await app.inject({ method: 'POST', url: `/api/admin/users/${me.id}/admin`, headers: auth, payload: { isAdmin: true } });
  assert.equal(up.json().isAdmin, true);
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/users', headers: pAuth })).statusCode, 200);
  const self = await app.inject({ method: 'POST', url: `/api/admin/users/${me.id}/admin`, headers: pAuth, payload: { isAdmin: false } });
  assert.equal(self.json().error.code, 'ADMIN_SELF');
  await app.close();
});

test('HTTP: admin cộng vé đúng loại + số lượng, ledger admin_grant khớp; retry cùng key không cộng thêm', async () => {
  const { app, adminAuth: auth } = await setup(false);
  const pAuth = await regApproved(app, auth, 'player_b');
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: pAuth })).json();
  const before = me.tickets.balances.shu as number;
  const body = { userId: me.id, ticketType: 'shu', amount: 37, idempotencyKey: 'grant-key-0001' };
  const r = await app.inject({ method: 'POST', url: '/api/admin/tickets/grant', headers: auth, payload: body });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().balances.shu, before + 37);
  const r2 = await app.inject({ method: 'POST', url: '/api/admin/tickets/grant', headers: auth, payload: body });
  assert.equal(r2.json().balances.shu, before + 37);
  // Cùng key, yêu cầu khác => 409
  const r3 = await app.inject({ method: 'POST', url: '/api/admin/tickets/grant', headers: auth, payload: { ...body, amount: 38 } });
  assert.equal(r3.json().error.code, 'IDEMPOTENCY_KEY_REUSED');
  // Quá trần mỗi lần / số âm bị chặn
  const big = await app.inject({ method: 'POST', url: '/api/admin/tickets/grant', headers: auth, payload: { ...body, amount: 10001, idempotencyKey: 'grant-key-0002' } });
  assert.equal(big.json().error.code, 'INVALID_AMOUNT');
  const neg = await app.inject({ method: 'POST', url: '/api/admin/tickets/grant', headers: auth, payload: { ...body, amount: -5, idempotencyKey: 'grant-key-0003' } });
  assert.equal(neg.statusCode, 400);
  // Người chơi thấy trong lịch sử
  const hist = (await app.inject({ method: 'GET', url: '/api/history?kind=ticket', headers: pAuth })).json();
  const grant = (hist.items as { reason: string; amountDelta: number; ticketType: string }[]).filter((x) => x.reason === 'admin_grant');
  assert.deepEqual(grant.map((x) => [x.ticketType, x.amountDelta]), [['shu', 37]]);
  // Không cộng cho tài khoản chờ duyệt
  const pend = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'pend_b', password: 'secret123' } })).json();
  const np = await app.inject({ method: 'POST', url: '/api/admin/tickets/grant', headers: auth, payload: { ...body, userId: pend.userId, idempotencyKey: 'grant-key-0004' } });
  assert.equal(np.json().error.code, 'NOT_APPROVED');
  await app.close();
});

test('HTTP: admin xem thẻ của mọi người chơi, lọc theo người chơi', async () => {
  const { app, auth, adminAuth } = await setup(false);
  const pAuth = await regApproved(app, adminAuth, 'player_c');
  for (const [a, k] of [[auth, 'tester-draw-1'], [pAuth, 'pc-draw-1']] as const) {
    const bal = (await app.inject({ method: 'GET', url: '/api/tickets', headers: a })).json().balances as Record<string, number>;
    const type = Object.entries(bal).sort((x, y) => y[1] - x[1])[0]![0];
    await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: a, payload: { ticketType: type, count: 10, idempotencyKey: k } });
  }
  const all = (await app.inject({ method: 'GET', url: '/api/admin/cards?pageSize=500', headers: adminAuth })).json();
  assert.equal(all.total, 20);
  assert.deepEqual([...new Set((all.items as { username: string }[]).map((c) => c.username))].sort(), ['player_c', 'tester']);
  const pId = (await app.inject({ method: 'GET', url: '/api/me', headers: pAuth })).json().id;
  const mine = (await app.inject({ method: 'GET', url: `/api/admin/cards?userId=${pId}&sort=level_desc`, headers: adminAuth })).json();
  assert.equal(mine.total, 10);
  assert.ok((mine.items as { username: string }[]).every((c) => c.username === 'player_c'));
  const users = (await app.inject({ method: 'GET', url: '/api/admin/users?status=approved', headers: adminAuth })).json();
  const pc = (users.items as { username: string; cardCount: number; ticketTotal: number }[]).find((u) => u.username === 'player_c')!;
  assert.equal(pc.cardCount, 10);
  assert.equal(pc.ticketTotal, 90 + RESET);
  await app.close();
});

test('HTTP: admin xem Ngọc của mọi người chơi, lọc theo người chơi/loại/cấp; chặn người thường', async () => {
  const { app, ctx, auth, adminAuth } = await setup(false);
  const pAuth = await regApproved(app, adminAuth, 'player_gm');
  const tId = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json().id as number;
  const pId = (await app.inject({ method: 'GET', url: '/api/me', headers: pAuth })).json().id as number;
  const at = new Date().toISOString();
  // Chèn Ngọc trực tiếp để kiểm thử tất định (không phụ thuộc tỉ lệ rớt khi quay).
  insertGem(ctx.db, tId, 'kim', 3, at);
  insertGem(ctx.db, tId, 'kim', 5, at);
  insertGem(ctx.db, tId, 'moc', 2, at);
  insertGem(ctx.db, pId, 'hoa', 7, at);
  insertGem(ctx.db, pId, 'tho', 1, at);

  const all = (await app.inject({ method: 'GET', url: '/api/admin/gems?pageSize=500', headers: adminAuth })).json();
  assert.equal(all.total, 5);
  assert.deepEqual([...new Set((all.items as { username: string }[]).map((g) => g.username))].sort(), ['player_gm', 'tester']);

  const mine = (await app.inject({ method: 'GET', url: `/api/admin/gems?userId=${pId}&sort=level_desc`, headers: adminAuth })).json();
  assert.equal(mine.total, 2);
  assert.ok((mine.items as { username: string }[]).every((g) => g.username === 'player_gm'));
  assert.deepEqual((mine.items as { level: number }[]).map((g) => g.level), [7, 1]);

  const kim = (await app.inject({ method: 'GET', url: '/api/admin/gems?element=kim', headers: adminAuth })).json();
  assert.equal(kim.total, 2);
  const lv3 = (await app.inject({ method: 'GET', url: '/api/admin/gems?level=3', headers: adminAuth })).json();
  assert.equal(lv3.total, 1);
  assert.equal((lv3.items as { element: string }[])[0]!.element, 'kim');

  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/gems', headers: pAuth })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/gems' })).statusCode, 401);
  await app.close();
});

test('HTTP: giftcode — người chơi nhập code, admin tạo/tắt code; người thường không vào được route admin', async () => {
  const { app, adminAuth: auth } = await setup(false);
  const pAuth = await regApproved(app, auth, 'player_gc');
  const list = (await app.inject({ method: 'GET', url: '/api/giftcodes', headers: pAuth })).json();
  assert.equal(list.featured.length, 4);
  const qun0 = (await app.inject({ method: 'GET', url: '/api/tickets', headers: pAuth })).json().balances.qun as number;
  const r = await app.inject({ method: 'POST', url: '/api/giftcodes/redeem', headers: pAuth, payload: { code: 'quanquoc' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().balances.balances.qun, qun0 + 200);
  const again = await app.inject({ method: 'POST', url: '/api/giftcodes/redeem', headers: pAuth, payload: { code: 'QUANQUOC' } });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'GIFTCODE_ALREADY_REDEEMED');
  assert.equal((await app.inject({ method: 'GET', url: '/api/tickets', headers: pAuth })).json().balances.qun, qun0 + 200);

  // Admin
  const forbid = await app.inject({ method: 'POST', url: '/api/admin/giftcodes', headers: pAuth, payload: { code: 'HACK', rewards: [{ pool: 'shu', count: 5 }] } });
  assert.equal(forbid.statusCode, 403);
  const created = await app.inject({
    method: 'POST',
    url: '/api/admin/giftcodes',
    headers: auth,
    payload: { code: 'TET2027', rewards: [{ kind: 'ticket', pool: 'shu', count: 10 }, { pool: 'wei', count: 20 }], expiresAt: null },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().totalTickets, 30);
  const cardCode = await app.inject({ method: 'POST', url: '/api/admin/giftcodes', headers: auth, payload: { code: 'THE01', rewards: [{ kind: 'card', pool: 'shu', count: 1 }] } });
  assert.equal(cardCode.statusCode, 400);
  const adminList = (await app.inject({ method: 'GET', url: '/api/admin/giftcodes', headers: auth })).json().items as { code: string; redemptionCount: number }[];
  assert.equal(adminList.find((c) => c.code === 'QUANQUOC')!.redemptionCount, 1);
  const off = await app.inject({ method: 'POST', url: `/api/admin/giftcodes/${created.json().id}/active`, headers: auth, payload: { isActive: false } });
  assert.equal(off.json().isActive, false);
  const r2 = await app.inject({ method: 'POST', url: '/api/giftcodes/redeem', headers: pAuth, payload: { code: 'TET2027' } });
  assert.equal(r2.json().error.code, 'GIFTCODE_NOT_FOUND');
  const hist = (await app.inject({ method: 'GET', url: '/api/history?kind=giftcode', headers: pAuth })).json();
  assert.equal(hist.items[0].code, 'QUANQUOC');
  assert.equal((await app.inject({ method: 'GET', url: '/api/giftcodes' })).statusCode, 401);
  await app.close();
});

test('HTTP: cài đặt Duyệt tài khoản tắt (mặc định) => đăng ký là được duyệt ngay, có token, nhận 100 vé, không phải admin', async () => {
  const { app } = await setup(false, false);
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'quick_user', password: 'secret123' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().status, 'approved');
  assert.equal(r.json().isAdmin, false);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${r.json().token}` } })).json();
  assert.equal(me.isAdmin, false);
  assert.equal(me.tickets.total, 100 + RESET);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'quick_user', password: 'secret123' } });
  assert.equal(login.statusCode, 200);
  await app.close();
});

test('HTTP: admin bật/tắt Duyệt tài khoản trên trang Quản trị; mặc định tắt; người thường bị 403', async () => {
  const { app, adminAuth: auth } = await setup(false, false);
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/admin/settings', headers: auth })).json(), { requireApproval: false });
  const on = await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth, payload: { requireApproval: true } });
  assert.deepEqual(on.json(), { requireApproval: true });
  const p = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'wait_user', password: 'secret123' } });
  assert.equal(p.json().status, 'pending');
  await app.inject({ method: 'POST', url: '/api/admin/settings', headers: auth, payload: { requireApproval: false } });
  const q = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'free_user', password: 'secret123' } });
  assert.equal(q.json().status, 'approved');
  // Tài khoản đã chờ trước đó vẫn chờ (admin duyệt tay)
  const w = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'wait_user', password: 'secret123' } });
  assert.equal(w.json().error.code, 'ACCOUNT_PENDING');
  const uAuth = { authorization: `Bearer ${q.json().token}` };
  assert.equal((await app.inject({ method: 'POST', url: '/api/admin/settings', headers: uAuth, payload: { requireApproval: true } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: '/api/admin/settings' })).statusCode, 401);
  await app.close();
});

test('HTTP: phiên đăng nhập lưu SQLite — khởi động lại server vẫn còn, không hết hạn; đăng xuất xoá phiên', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  process.env.LOG_LEVEL = 'silent';
  const dir = mkdtempSync(join(tmpdir(), 'tq-sess-'));
  const dbPath = join(dir, 'game.db');
  try {
    // Lần chạy 1: đăng ký => có token
    let db = openDatabase(dbPath);
    let app = await buildServer(createContext(db));
    const token = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'persist_u', password: 'secret123' } })).json().token as string;
    const row = db.prepare('SELECT expires_at FROM sessions').get() as { expires_at: string | null };
    assert.equal(row.expires_at, null); // không hết hạn
    await app.close();
    db.close();

    // "Khởi động lại": mở lại file DB, token cũ vẫn dùng được (kể cả rất lâu sau)
    db = openDatabase(dbPath);
    const ctx = createContext(db);
    ctx.now = () => Date.now() + 10 * 365 * 24 * 3600 * 1000;
    app = await buildServer(ctx);
    const auth = { authorization: `Bearer ${token}` };
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().username, 'persist_u');

    // Đăng xuất => xoá phiên khỏi DB, token không dùng được nữa
    assert.equal((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: auth })).statusCode, 200);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n, 0);
    assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: auth })).statusCode, 401);
    await app.close();
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('HTTP: /api/leaderboard cần đăng nhập; admin không có hạng', async () => {
  const { app, adminAuth } = await setup(false, false);
  assert.equal((await app.inject({ method: 'GET', url: '/api/leaderboard' })).statusCode, 401);
  const r = await app.inject({ method: 'GET', url: '/api/leaderboard', headers: adminAuth });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.metric, 'lc');
  assert.equal(body.me, null); // boss là tài khoản đầu tiên => admin
  assert.ok(!body.items.some((e: { username: string }) => e.username === 'boss'));

  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'player_lb', password: 'secret123' } });
  const pAuth = { authorization: `Bearer ${reg.json().token}` };
  await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: pAuth, payload: { ticketType: 'normal', count: 1, idempotencyKey: 'lb-draw-0001' } });
  const mine = (await app.inject({ method: 'GET', url: '/api/leaderboard', headers: pAuth })).json();
  assert.equal(mine.me.rank, 1);
  assert.equal(mine.me.username, 'player_lb');
  assert.equal(mine.me.displayName, 'player_lb'); // tên hiển thị mặc định = tên đăng nhập (mục 3.11)
  assert.equal(mine.me.avatar, null);
  assert.ok(mine.me.lc >= 1);
});

test('HTTP: nhiệm vụ — /api/me báo thưởng reset; /api/quests + nhận tất cả; nhận lại => 409', async () => {
  const { app, auth } = await setup(false, false);
  assert.equal((await app.inject({ method: 'GET', url: '/api/quests' })).statusCode, 401);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  assert.equal(Object.values(me.dailyEvents.resetBonus as Record<string, number>).reduce((s, n) => s + n, 0), RESET);
  const me2 = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  assert.equal(me2.dailyEvents, undefined);

  const q = (await app.inject({ method: 'GET', url: '/api/quests', headers: auth })).json();
  assert.equal(q.resetBonus.granted, true);
  assert.equal(q.daily.find((d: { key: string }) => d.key.endsWith(':login')).status, 'claimable');
  assert.ok(q.claimable >= 2); // đăng nhập + điểm danh hôm nay

  const r = await app.inject({ method: 'POST', url: '/api/quests/claim', headers: auth, payload: {} });
  assert.equal(r.statusCode, 200);
  const keys = r.json().claimed.map((c: { key: string }) => c.key);
  assert.ok(keys.some((k: string) => k.endsWith(':login')));
  assert.ok(keys.some((k: string) => k.startsWith('login:')));
  const again = await app.inject({ method: 'POST', url: '/api/quests/claim', headers: auth, payload: {} });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'NOTHING_TO_CLAIM');
  const bad = await app.inject({ method: 'POST', url: '/api/quests/claim', headers: auth, payload: { keys: ['a:draws:999999'] } });
  assert.equal(bad.statusCode, 409);
});

test('HTTP: admin không chơi game — chặn thao tác người chơi, không nhận vé/thẻ, không có trong danh sách người nhận', async () => {
  const { app, auth, adminAuth } = await setup(true, false);
  const adminMe = (await app.inject({ method: 'GET', url: '/api/me', headers: adminAuth })).json();
  assert.equal(adminMe.isAdmin, true);
  assert.equal(adminMe.dailyEvents, undefined); // không có thưởng reset/nhiệm vụ
  for (const [url, payload] of [
    ['/api/gacha/draw', { ticketType: 'normal', count: 1, idempotencyKey: 'adm-play-001' }],
    ['/api/tickets/claim-recovery', {}],
    ['/api/tickets/dev-topup', { idempotencyKey: 'adm-play-002' }],
    ['/api/upgrades/quick', { idempotencyKey: 'adm-play-003' }],
    ['/api/quests/claim', {}],
    ['/api/giftcodes/redeem', { code: 'THUCQUOC' }],
  ] as const) {
    const r = await app.inject({ method: 'POST', url, headers: adminAuth, payload });
    assert.equal(r.statusCode, 403, url);
    assert.equal(r.json().error.code, 'ADMIN_NOT_PLAYER', url);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/api/quests', headers: adminAuth })).statusCode, 403);

  // Không cộng vé cho admin
  const g = await app.inject({
    method: 'POST',
    url: '/api/admin/tickets/grant',
    headers: adminAuth,
    payload: { userId: adminMe.id, ticketType: 'normal', amount: 5, idempotencyKey: 'grant-admin-01' },
  });
  assert.equal(g.statusCode, 409);
  assert.equal(g.json().error.code, 'TARGET_IS_ADMIN');

  // Người chơi không thấy admin trong danh sách người nhận và không tặng thẻ cho admin được
  const list = (await app.inject({ method: 'GET', url: '/api/users', headers: auth })).json().items as { username: string }[];
  assert.ok(!list.some((u) => u.username === 'boss'));
  const d = (await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: auth, payload: { ticketType: 'normal', idempotencyKey: 'tester-d-01' } })).json();
  const gift = await app.inject({ method: 'POST', url: '/api/gifts', headers: auth, payload: { toUsername: 'BOSS', cardIds: [d.results[0].card.id], idempotencyKey: 'gift-admin-01' } });
  assert.equal(gift.statusCode, 400);
  assert.equal(gift.json().error.code, 'RECIPIENT_IS_ADMIN');
  await app.close();
});

test('HTTP: hồ sơ — đổi tên hiển thị (mặc định = tên đăng nhập), đặt/xoá ảnh đại diện, chặn dữ liệu sai', async () => {
  const { app, auth } = await setup(false, false);
  const me0 = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  assert.equal(me0.displayName, 'tester');
  assert.equal(me0.avatar, null);

  // Đổi tên hiển thị: cắt khoảng trắng hai đầu
  const r = await app.inject({ method: 'POST', url: '/api/me/profile', headers: auth, payload: { displayName: '  Quan Vũ  ' } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().displayName, 'Quan Vũ');
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json().displayName, 'Quan Vũ');

  // Ảnh gợi ý (chân dung tướng) và ảnh tự tải (data URL đã thu nhỏ)
  const portrait = await app.inject({ method: 'POST', url: '/api/me/profile', headers: auth, payload: { avatar: '/generals/cao-cao.webp' } });
  assert.equal(portrait.json().avatar, '/generals/cao-cao.webp');
  const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const uploaded = await app.inject({ method: 'POST', url: '/api/me/profile', headers: auth, payload: { avatar: dataUrl } });
  assert.equal(uploaded.json().avatar, dataUrl);
  // Xoá ảnh
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/profile', headers: auth, payload: { avatar: null } })).json().avatar, null);

  const bad = await app.inject({ method: 'POST', url: '/api/me/profile', headers: auth, payload: { avatar: 'https://example.com/x.png' } });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, 'INVALID_AVATAR');
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/profile', headers: auth, payload: { displayName: '   ' } })).json().error.code, 'INVALID_DISPLAY_NAME');
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/profile', headers: auth, payload: {} })).json().error.code, 'NOTHING_TO_UPDATE');
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/profile', payload: { displayName: 'ai_do' } })).statusCode, 401);
  await app.close();
});

test('HTTP: đổi mật khẩu — sai mật khẩu hiện tại bị chặn; đổi xong chỉ mật khẩu mới đăng nhập được', async () => {
  const { app, auth } = await setup(false, false);
  const wrong = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: auth,
    payload: { currentPassword: 'wrongpass', newPassword: 'newsecret123' },
  });
  assert.equal(wrong.statusCode, 400);
  assert.equal(wrong.json().error.code, 'INVALID_PASSWORD');

  const ok = await app.inject({
    method: 'POST',
    url: '/api/me/password',
    headers: auth,
    payload: { currentPassword: 'secret123', newPassword: 'newsecret123' },
  });
  assert.equal(ok.statusCode, 200);
  // Phiên đang dùng vẫn hoạt động, mật khẩu cũ không dùng được nữa
  assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: auth })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tester', password: 'secret123' } })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'tester', password: 'newsecret123' } })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/api/me/password', payload: { currentPassword: 'newsecret123', newPassword: 'othersecret123' } })).statusCode, 401);
  await app.close();
});

test('HTTP: tặng thẻ tạm tắt (ENABLE_GIFT tắt) => /api/gifts và /api/users trả 404, không chuyển thẻ', async () => {
  const { app, auth } = await setup(false, false, false);
  const me = (await app.inject({ method: 'GET', url: '/api/me', headers: auth })).json();
  assert.equal(me.features.gift, false);
  const d = (await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: auth, payload: { ticketType: 'normal', idempotencyKey: 'off-draw-01' } })).json();
  const u = await app.inject({ method: 'GET', url: '/api/users', headers: auth });
  assert.equal(u.statusCode, 404);
  assert.equal(u.json().error.code, 'FEATURE_DISABLED');
  await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob_off', password: 'secret123' } });
  const g = await app.inject({ method: 'POST', url: '/api/gifts', headers: auth, payload: { toUsername: 'bob_off', cardIds: [d.results[0].card.id], idempotencyKey: 'off-gift-01' } });
  assert.equal(g.statusCode, 404);
  assert.equal(g.json().error.code, 'FEATURE_DISABLED');
  const mine = (await app.inject({ method: 'GET', url: '/api/cards?pageSize=500', headers: auth })).json();
  assert.ok((mine.items as { id: number }[]).some((c) => c.id === d.results[0].card.id));
  await app.close();
});

test('HTTP: GET /api/cards/all trả cả bộ sưu tập trong 1 request; cần đăng nhập', async () => {
  const { app, auth } = await setup(false, false, false);
  for (let i = 0; i < 12; i++) {
    await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: auth, payload: { ticketType: 'normal', idempotencyKey: `all-draw-${i}` } });
  }
  const paged = (await app.inject({ method: 'GET', url: '/api/cards?pageSize=1', headers: auth })).json();
  assert.ok(paged.total > 1);
  // Một request trả đủ số thẻ mà bản phân trang phải chia nhiều trang
  const all = await app.inject({ method: 'GET', url: '/api/cards/all', headers: auth });
  assert.equal(all.statusCode, 200);
  const items = all.json().items as { id: number; generalId: string; level: number }[];
  assert.equal(items.length, paged.total);
  // Thẻ mới nhất đứng đầu (khớp `sort=newest` của bản phân trang)
  assert.equal(items[0]!.id, Math.max(...items.map((c) => c.id)));
  assert.ok(items.every((c) => typeof c.generalId === 'string' && c.level >= 1));
  const unauth = await app.inject({ method: 'GET', url: '/api/cards/all' });
  assert.equal(unauth.statusCode, 401);
  await app.close();
});
