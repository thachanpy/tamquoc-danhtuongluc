import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.ts';
import { createContext } from '../src/context.ts';
import { buildServer } from '../src/server.ts';
import { setRequireApproval } from '../src/settings.ts';

/** Test HTTP thật qua Fastify inject (không mở cổng mạng). */
/** Các test duyệt tài khoản chạy với cài đặt "Duyệt tài khoản" bật; mặc định thật của server là tắt. */
async function setup(devTopup: boolean, requireApproval = true) {
  process.env.LOG_LEVEL = 'silent';
  const ctx = createContext(openDatabase(':memory:'), { devTopup });
  setRequireApproval(ctx, requireApproval);
  const app = await buildServer(ctx);
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'tester', password: 'secret123' } });
  const token = reg.json().token as string;
  const auth = { authorization: `Bearer ${token}` };
  return { app, auth };
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
  const bobAuth = await regApproved(app, auth, 'bob_http');
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
  for (const n of ['zed_user', 'amy_user']) await regApproved(app, auth, n);
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
  const { app, auth } = await setup(false);
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
  assert.equal(nMe.tickets.total, 100);
  await app.close();
});

test('HTTP: từ chối đăng ký xoá tài khoản chờ duyệt, tên dùng lại được; không từ chối tài khoản đã duyệt', async () => {
  const { app, auth } = await setup(false);
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
  const { app, auth } = await setup(false);
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
  const { app, auth } = await setup(false);
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
  const { app, auth } = await setup(false);
  const pAuth = await regApproved(app, auth, 'player_c');
  for (const [a, k] of [[auth, 'adm-draw-1'], [pAuth, 'pc-draw-1']] as const) {
    const bal = (await app.inject({ method: 'GET', url: '/api/tickets', headers: a })).json().balances as Record<string, number>;
    const type = Object.entries(bal).sort((x, y) => y[1] - x[1])[0]![0];
    await app.inject({ method: 'POST', url: '/api/gacha/draw', headers: a, payload: { ticketType: type, count: 10, idempotencyKey: k } });
  }
  const all = (await app.inject({ method: 'GET', url: '/api/admin/cards?pageSize=500', headers: auth })).json();
  assert.equal(all.total, 20);
  assert.deepEqual([...new Set((all.items as { username: string }[]).map((c) => c.username))].sort(), ['player_c', 'tester']);
  const pId = (await app.inject({ method: 'GET', url: '/api/me', headers: pAuth })).json().id;
  const mine = (await app.inject({ method: 'GET', url: `/api/admin/cards?userId=${pId}&sort=level_desc`, headers: auth })).json();
  assert.equal(mine.total, 10);
  assert.ok((mine.items as { username: string }[]).every((c) => c.username === 'player_c'));
  const users = (await app.inject({ method: 'GET', url: '/api/admin/users?status=approved', headers: auth })).json();
  const pc = (users.items as { username: string; cardCount: number; ticketTotal: number }[]).find((u) => u.username === 'player_c')!;
  assert.equal(pc.cardCount, 10);
  assert.equal(pc.ticketTotal, 90);
  await app.close();
});

test('HTTP: giftcode — người chơi nhập code, admin tạo/tắt code; người thường không vào được route admin', async () => {
  const { app, auth } = await setup(false);
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
  assert.equal(me.tickets.total, 100);
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'quick_user', password: 'secret123' } });
  assert.equal(login.statusCode, 200);
  await app.close();
});

test('HTTP: admin bật/tắt Duyệt tài khoản trên trang Quản trị; mặc định tắt; người thường bị 403', async () => {
  const { app, auth } = await setup(false, false);
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
