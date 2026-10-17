import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { openDatabase } from '../src/db.ts';
import { AppError, type GameContext } from '../src/context.ts';
import { register as rawRegister } from '../src/managers/auth.manager.ts';
import { approveUser } from '../src/managers/admin.manager.ts';
import { applyTicketDelta, readBalances } from '../src/repositories/ticket.repository.ts';
import { claimRecovery, devTopup, getTickets, syncRecovery } from '../src/managers/ticket.manager.ts';
import { draw } from '../src/managers/gacha.manager.ts';
import { attemptUpgrade, previewUpgrade, quickUpgrade } from '../src/managers/upgrade.manager.ts';
import { giftCards, listRecipients } from '../src/managers/gift.manager.ts';
import { listCards, listHistory } from '../src/managers/collection.manager.ts';
import { seedGenerals } from '../src/seed.ts';
import { getLeaderboard } from '../src/managers/leaderboard.manager.ts';
import { runMigrations } from '../src/migrations.ts';
import { DatabaseSync } from 'node:sqlite';
import { RECOVERY_CAP_PER_TYPE, DRAW_ALL_MAX, ROSTER, pvpUnitLc } from '@tq/game-config';
import { SIGNUP_BONUS_TICKETS as BONUS, DEV_TOPUP_TICKETS, UPGRADE_INPUT_COUNT, RECOVERY_INTERVAL_MS, GIFT_MAX_CARDS } from '@tq/game-config';

/** Đăng ký + duyệt ngay (tài khoản đầu tiên tự được duyệt; các tài khoản sau được admin duyệt). */
function register(ctx: GameContext, username: string, password: string) {
  const r = rawRegister(ctx, username, password);
  if (r.status === 'approved') return { userId: r.userId, signupBonus: r.signupBonus };
  return { userId: r.userId, signupBonus: approveUser(ctx, r.userId).signupBonus };
}

/** Một mốc hồi vé (hiện là 5 phút) — lấy từ cấu hình. */
const SLOT = RECOVERY_INTERVAL_MS;
const T0 = Date.UTC(2026, 9, 14, 10, 3, 0); // 10:03 UTC

function makeCtx(start = T0) {
  let now = start;
  const queue: number[] = [];
  const ctx: GameContext = {
    db: openDatabase(':memory:'),
    now: () => now,
    rand: (max) => (queue.length ? queue.shift()! % max : randomInt(max)),
  };
  return {
    ctx,
    setNow: (t: number) => (now = t),
    advance: (ms: number) => (now += ms),
    pushRand: (...v: number[]) => queue.push(...v),
  };
}

function insertCard(ctx: GameContext, userId: number, generalId: string, level: number): number {
  const r = ctx.db
    .prepare('INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(userId, generalId, level, 'x', 'x');
  return Number(r.lastInsertRowid);
}

function ledgerSum(ctx: GameContext, userId: number): Record<string, number> {
  const rows = ctx.db
    .prepare('SELECT ticket_type, SUM(amount_delta) AS s FROM ticket_transactions WHERE user_id = ? GROUP BY ticket_type')
    .all(userId) as { ticket_type: string; s: number }[];
  const out: Record<string, number> = { normal: 0, shu: 0, wei: 0, wu: 0, qun: 0 };
  for (const r of rows) out[r.ticket_type] = r.s;
  return out;
}

const errCode = (code: string) => (e: unknown) => e instanceof AppError && e.code === code;

// ================= Database =================

test('migration + seed chạy lặp an toàn, đúng 140 tướng', () => {
  const { ctx } = makeCtx();
  runMigrations(ctx.db);
  seedGenerals(ctx.db);
  seedGenerals(ctx.db);
  const n = (ctx.db.prepare('SELECT COUNT(*) AS n FROM generals').get() as { n: number }).n;
  assert.equal(n, 140);
  const fk = ctx.db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
  assert.equal(fk.foreign_keys, 1);
});

test('seed xóa tướng bị bỏ khỏi roster nếu không còn tham chiếu, giữ lại nếu còn thẻ', () => {
  const { ctx } = makeCtx();
  const { userId } = register(ctx, 'alice', 'secret123');
  const ins = ctx.db.prepare("INSERT INTO generals (id, name, faction, art_key) VALUES (?, ?, 'wu', ?)");
  ins.run('old-free', 'Cũ 1', 'old-free');
  ins.run('old-used', 'Cũ 2', 'old-used');
  ctx.db
    .prepare("INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?, 'old-used', 1, 'x', 'x')")
    .run(userId);
  seedGenerals(ctx.db);
  const ids = new Set((ctx.db.prepare('SELECT id FROM generals').all() as { id: string }[]).map((r) => r.id));
  assert.ok(!ids.has('old-free'));
  assert.ok(ids.has('old-used'));
  assert.equal(ids.size, 141);
});

test('foreign key & check constraint hoạt động', () => {
  const { ctx } = makeCtx();
  const { userId } = register(ctx, 'alice', 'secret123');
  assert.throws(() => insertCard(ctx, userId, 'khong-ton-tai', 1));
  assert.throws(() => insertCard(ctx, userId, 'cao-cao', 11));
  assert.throws(() => ctx.db.prepare("UPDATE user_tickets SET balance = -1 WHERE user_id = ?").run(userId));
});

// ================= Quà đăng ký =================

test('đăng ký: nhận đúng 100 vé, loại vé roll độc lập, ledger khớp số dư', () => {
  assert.equal(BONUS, 100);
  const h = makeCtx();
  // 20 vé mỗi loại theo RNG điều khiển (thang 10000, mỗi loại 2000):
  // 0 -> normal, 2500 -> shu, 5000 -> wei, 7500 -> wu, 9000 -> qun
  h.pushRand(...Array(20).fill(0), ...Array(20).fill(2500), ...Array(20).fill(5000), ...Array(20).fill(7500), ...Array(20).fill(9000));
  const { userId, signupBonus } = register(h.ctx, 'alice', 'secret123');
  assert.deepEqual(signupBonus, { normal: 20, shu: 20, wei: 20, wu: 20, qun: 20 });
  assert.deepEqual(readBalances(h.ctx.db, userId), { normal: 20, shu: 20, wei: 20, wu: 20, qun: 20 });
  assert.deepEqual(ledgerSum(h.ctx, userId), readBalances(h.ctx.db, userId));
  const rows = h.ctx.db
    .prepare("SELECT COUNT(*) AS n FROM ticket_transactions WHERE user_id = ? AND reason = 'signup_bonus'")
    .get(userId) as { n: number };
  assert.equal(rows.n, 5); // 1 dòng ledger mỗi loại
});

test('quà đăng ký chỉ 1 lần: đăng nhập lại không cấp thêm; unique index chặn cấp lần 2', async () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const { login } = await import('../src/managers/auth.manager.ts');
  login(h.ctx, 'alice', 'secret123');
  login(h.ctx, 'alice', 'secret123');
  assert.equal(getTickets(h.ctx, userId).total, BONUS);
  const anyType = (h.ctx.db
    .prepare("SELECT ticket_type FROM ticket_transactions WHERE user_id = ? AND reason = 'signup_bonus' LIMIT 1")
    .get(userId) as { ticket_type: string }).ticket_type;
  assert.throws(() =>
    h.ctx.db
      .prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (?, ?, 5, 'signup_bonus', 'signup', 'x')")
      .run(userId, anyType),
  );
});

test('đăng ký trùng tên => lỗi, không cấp thêm vé', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  assert.throws(() => register(h.ctx, 'ALICE', 'secret123'), errCode('USERNAME_TAKEN'));
  assert.equal(getTickets(h.ctx, userId).total, BONUS);
  assert.equal((h.ctx.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n, 1);
});

test('migration v2 giữ nguyên dữ liệu ledger & lịch sử gacha cũ', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, 1);
  seedGenerals(db);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'old', 'x', 'x')").run();
  db.prepare("INSERT INTO user_tickets (user_id, ticket_type, balance, updated_at) VALUES (1, 'normal', 0, 'x')").run();
  db.prepare("INSERT INTO ticket_transactions (id, user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (7, 1, 'normal', 1, 'time_recovery', 'slot-a', 'x')").run();
  db.prepare("INSERT INTO ticket_transactions (id, user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (8, 1, 'normal', -1, 'gacha_draw', 'g', 'x')").run();
  db.prepare("INSERT INTO user_cards (id, user_id, general_id, level, created_at, updated_at) VALUES (1, 1, 'cao-cao', 1, 'x', 'x')").run();
  db.prepare("INSERT INTO gacha_history (user_id, ticket_type, general_id, card_id, card_level, ticket_transaction_id, idempotency_key, created_at) VALUES (1, 'normal', 'cao-cao', 1, 1, 8, 'k', 'x')").run();

  runMigrations(db);
  const ids = (db.prepare('SELECT id FROM ticket_transactions ORDER BY id').all() as { id: number }[]).map((r) => r.id);
  assert.deepEqual(ids, [7, 8]);
  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  // Unique mốc hồi vẫn hoạt động sau khi dựng lại bảng
  assert.throws(() =>
    db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (1, 'shu', 1, 'time_recovery', 'slot-a', 'x')").run(),
  );
  // Reason mới hợp lệ, reason lạ vẫn bị chặn
  db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (1, 'normal', 3, 'signup_bonus', 'signup', 'x')").run();
  assert.throws(() =>
    db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, created_at) VALUES (1, 'normal', 20, 'daily_claim', 'x')").run(),
  );
});

// ================= Nút cộng vé thử nghiệm =================

test('dev-topup: tắt mặc định => FEATURE_DISABLED, không cấp vé', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  assert.throws(() => devTopup(h.ctx, userId, 'topup-000001'), errCode('FEATURE_DISABLED'));
  assert.equal(getTickets(h.ctx, userId).total, BONUS);
});

test('dev-topup: mỗi lần bấm +50 vé, loại roll độc lập, ledger khớp; retry cùng key không cộng thêm', () => {
  const h = makeCtx();
  h.ctx.features = { devTopup: true };
  const { userId } = register(h.ctx, 'alice', 'secret123');
  assert.equal(DEV_TOPUP_TICKETS, 50);
  // 50 vé: 10 mỗi loại (thường, Thục, Ngụy, Ngô, Quần)
  h.pushRand(...Array(10).fill(0), ...Array(10).fill(2500), ...Array(10).fill(5000), ...Array(10).fill(7500), ...Array(10).fill(9000));
  const before = readBalances(h.ctx.db, userId);
  const r = devTopup(h.ctx, userId, 'topup-000001');
  assert.deepEqual(r.granted, { normal: 10, shu: 10, wei: 10, wu: 10, qun: 10 });
  assert.equal(r.grantedTotal, 50);
  assert.equal(r.tickets.total, BONUS + 50);
  assert.equal(r.tickets.balances.normal, before.normal + 10);
  assert.equal(r.tickets.balances.qun, before.qun + 10);
  // Retry cùng key => trả kết quả cũ
  const again = devTopup(h.ctx, userId, 'topup-000001');
  assert.deepEqual(again.granted, r.granted);
  assert.equal(getTickets(h.ctx, userId).total, BONUS + 50);
  // Bấm lần nữa (key mới) => cộng tiếp, không giới hạn số lần
  devTopup(h.ctx, userId, 'topup-000002');
  devTopup(h.ctx, userId, 'topup-000003');
  assert.equal(getTickets(h.ctx, userId).total, BONUS + 150);
  assert.deepEqual(ledgerSum(h.ctx, userId), readBalances(h.ctx.db, userId));
  const hist = listHistory(h.ctx, userId, { kind: 'ticket', pageSize: 100 });
  assert.ok(hist.items.some((e) => e.kind === 'ticket' && e.reason === 'dev_topup'));
});

test('dev-topup nguyên tử: lỗi giữa chừng => không cấp vé nào', () => {
  const h = makeCtx();
  h.ctx.features = { devTopup: true };
  const { userId } = register(h.ctx, 'alice', 'secret123');
  let calls = 0;
  h.ctx.rand = (max) => {
    if (++calls === 30) throw new Error('crash giả lập');
    return randomInt(max);
  };
  assert.throws(() => devTopup(h.ctx, userId, 'topup-000001'));
  assert.equal(getTickets(h.ctx, userId).total, BONUS);
});

test('migration v3 giữ nguyên dữ liệu ledger cũ và cho phép reason dev_topup', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, 2);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'old', 'x', 'x')").run();
  db.prepare("INSERT INTO ticket_transactions (id, user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (5, 1, 'shu', 7, 'signup_bonus', 'signup', 'x')").run();
  runMigrations(db);
  const row = db.prepare('SELECT * FROM ticket_transactions WHERE id = 5').get() as { amount_delta: number; reason: string };
  assert.equal(row.amount_delta, 7);
  assert.equal(row.reason, 'signup_bonus');
  db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (1, 'wu', 3, 'dev_topup', 'devtopup:k', 'x')").run();
  // unique: cùng reference + cùng loại vé không được ghi 2 lần
  assert.throws(() =>
    db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (1, 'wu', 3, 'dev_topup', 'devtopup:k', 'x')").run(),
  );
  // unique quà đăng ký vẫn còn
  assert.throws(() =>
    db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (1, 'shu', 1, 'signup_bonus', 'signup', 'x')").run(),
  );
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('migration v4: thêm Vé Quần, giữ nguyên số dư & ledger cũ, tài khoản cũ có số dư Vé Quần = 0', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, 3);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'old', 'x', 'x')").run();
  for (const [t, b] of [['normal', 3], ['shu', 4], ['wei', 5], ['wu', 6]] as const) {
    db.prepare('INSERT INTO user_tickets (user_id, ticket_type, balance, updated_at) VALUES (1, ?, ?, ?)').run(t, b, 'x');
  }
  db.prepare("INSERT INTO ticket_transactions (id, user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (9, 1, 'wu', 6, 'signup_bonus', 'signup', 'x')").run();
  // Trước v4: chưa có loại vé qun
  assert.throws(() => db.prepare("INSERT INTO user_tickets (user_id, ticket_type, balance, updated_at) VALUES (1, 'qun', 0, 'x')").run());

  runMigrations(db);
  const bal = Object.fromEntries(
    (db.prepare('SELECT ticket_type, balance FROM user_tickets WHERE user_id = 1').all() as { ticket_type: string; balance: number }[]).map(
      (r) => [r.ticket_type, r.balance],
    ),
  );
  assert.deepEqual(bal, { normal: 3, shu: 4, wei: 5, wu: 6, qun: 0 });
  assert.equal((db.prepare('SELECT amount_delta FROM ticket_transactions WHERE id = 9').get() as { amount_delta: number }).amount_delta, 6);
  db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (1, 'qun', 1, 'time_recovery', 'slot-q', 'x')").run();
  assert.throws(() =>
    db.prepare("INSERT INTO user_tickets (user_id, ticket_type, balance, updated_at) VALUES (1, 'xyz', 0, 'x')").run(),
  );
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('migration v6: tài khoản cũ được coi là đã duyệt, id nhỏ nhất thành admin, ledger giữ nguyên, có reason admin_grant', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, 5);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (3, 'first', 'x', '2026-01-01T00:00:00.000Z')").run();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (7, 'second', 'x', '2026-01-02T00:00:00.000Z')").run();
  db.prepare("INSERT INTO user_tickets (user_id, ticket_type, balance, updated_at) VALUES (7, 'wu', 6, 'x')").run();
  db.prepare("INSERT INTO ticket_transactions (id, user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (11, 7, 'wu', 6, 'signup_bonus', 'signup', 'x')").run();
  assert.throws(() =>
    db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, created_at) VALUES (7, 'wu', 1, 'admin_grant', 'x')").run(),
  );
  runMigrations(db);
  const users = db.prepare('SELECT id, status, is_admin, approved_at FROM users ORDER BY id').all() as {
    id: number; status: string; is_admin: number; approved_at: string;
  }[];
  assert.deepEqual(users.map((u) => [u.id, u.status, u.is_admin]), [[3, 'approved', 1], [7, 'approved', 0]]);
  assert.equal(users[1]!.approved_at, '2026-01-02T00:00:00.000Z');
  assert.equal((db.prepare('SELECT amount_delta FROM ticket_transactions WHERE id = 11').get() as { amount_delta: number }).amount_delta, 6);
  db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (7, 'wu', 5, 'admin_grant', 'admin:3:k', 'x')").run();
  assert.throws(() => db.prepare("UPDATE users SET status = 'banned' WHERE id = 7").run());
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('đăng ký: tài khoản đầu tiên là admin & được duyệt; tài khoản sau chờ duyệt, chưa có vé, chưa đăng nhập được', async () => {
  const h = makeCtx();
  (await import('../src/managers/settings.manager.ts')).setRequireApproval(h.ctx, true);
  const { login } = await import('../src/managers/auth.manager.ts');
  const first = rawRegister(h.ctx, 'boss', 'secret123');
  assert.equal(first.status, 'approved');
  const second = rawRegister(h.ctx, 'newbie', 'secret123');
  assert.equal(second.status, 'pending');
  assert.deepEqual(readBalances(h.ctx.db, second.userId), { normal: 0, shu: 0, wei: 0, wu: 0, qun: 0 });
  assert.throws(() => login(h.ctx, 'newbie', 'secret123'), errCode('ACCOUNT_PENDING'));
  // Duyệt lúc 10:23 => mốc hồi đã xử lý là 10:20, quà 100 vé tính từ lúc duyệt
  h.advance(20 * 60 * 1000);
  const { signupBonus } = approveUser(h.ctx, second.userId);
  assert.equal(Object.values(signupBonus).reduce((a, b) => a + b, 0), BONUS);
  const t = getTickets(h.ctx, second.userId);
  assert.equal(t.total, BONUS);
  assert.equal(t.lastProcessedRecoveryAt, new Date(Date.UTC(2026, 9, 14, 10, 20)).toISOString());
  assert.ok(login(h.ctx, 'newbie', 'secret123').token);
  assert.throws(() => approveUser(h.ctx, second.userId), errCode('ALREADY_APPROVED'));
  assert.equal(getTickets(h.ctx, second.userId).total, BONUS);
});

test('migration v8: lượt nhập giftcode cũ (thẻ) giữ nguyên; code tân thủ đổi thành vé; ledger có reason giftcode', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, 7);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'old', 'x', 'x')").run();
  db.prepare("INSERT INTO gift_code_redemptions (code_id, user_id, cards_snapshot, card_count, created_at) SELECT id, 1, '[]', 200, 'x' FROM gift_codes WHERE code = 'THUCQUOC'").run();
  runMigrations(db);
  const thuc = db.prepare("SELECT rewards, total_cards, total_tickets FROM gift_codes WHERE code = 'THUCQUOC'").get() as Record<string, unknown>;
  assert.deepEqual(JSON.parse(thuc.rewards as string), [{ kind: 'ticket', pool: 'shu', count: 200 }]);
  assert.equal(thuc.total_tickets, 200);
  const red = db.prepare('SELECT card_count, tickets_snapshot FROM gift_code_redemptions WHERE user_id = 1').get() as Record<string, unknown>;
  assert.deepEqual([red.card_count, red.tickets_snapshot], [200, '[]']);
  db.prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, created_at) VALUES (1, 'shu', 200, 'giftcode', 'giftcode:1', 'x')").run();
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('migration v11: phiên cũ giữ nguyên token, bỏ hạn (không hết hạn)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, 10);
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (1, 'old', 'x', 'x')").run();
  db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h1', 1, 'x', '2000-01-01T00:00:00.000Z')").run();
  runMigrations(db);
  assert.deepEqual({ ...(db.prepare('SELECT token_hash, expires_at FROM sessions').get() as object) }, { token_hash: 'h1', expires_at: null });
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('tài khoản mới có đủ 5 loại vé, gồm Vé Quần', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  assert.deepEqual(Object.keys(readBalances(h.ctx.db, userId)).sort(), ['normal', 'qun', 'shu', 'wei', 'wu']);
});

// ================= Hồi vé =================

test('mốc hồi là 5 phút; tài khoản mới (10:03) chỉ có vé quà đăng ký, mốc kế tiếp là 10:05', () => {
  assert.equal(RECOVERY_INTERVAL_MS, 5 * 60 * 1000);
  const { ctx } = makeCtx();
  const { userId } = register(ctx, 'alice', 'secret123');
  const t = getTickets(ctx, userId);
  assert.equal(t.total, BONUS);
  assert.equal(t.lastProcessedRecoveryAt, '2026-10-14T10:00:00.000Z');
  assert.equal(t.nextRecoveryAt, '2026-10-14T10:05:00.000Z');
  assert.equal(t.msUntilNextRecovery, 2 * 60 * 1000);
});

test('không hồi sớm hơn mốc; đúng mốc thì cấp 1 vé', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  h.setNow(Date.UTC(2026, 9, 14, 10, 4, 59, 999));
  assert.equal(claimRecovery(h.ctx, userId).grantedTotal, 0);
  h.setNow(Date.UTC(2026, 9, 14, 10, 5, 0, 0));
  const r = claimRecovery(h.ctx, userId);
  assert.equal(r.grantedTotal, 1);
  assert.equal(r.total, BONUS + 1);
});

test('ví dụ đặc tả: xử lý 10:00, offline đến 10:30 => đúng 6 vé (mốc 5 phút); retry không cấp thêm', () => {
  const h = makeCtx(Date.UTC(2026, 9, 14, 10, 0, 0));
  const { userId } = register(h.ctx, 'alice', 'secret123');
  h.setNow(Date.UTC(2026, 9, 14, 10, 30, 0));
  assert.equal(claimRecovery(h.ctx, userId).grantedTotal, 6);
  assert.equal(claimRecovery(h.ctx, userId).grantedTotal, 0);
  assert.equal(getTickets(h.ctx, userId).total, BONUS + 6);
  const slots = (h.ctx.db
    .prepare("SELECT reference_id FROM ticket_transactions WHERE reason = 'time_recovery' ORDER BY id")
    .all() as { reference_id: string }[]).map((r) => r.reference_id);
  assert.deepEqual(slots, ['05', '10', '15', '20', '25', '30'].map((m) => `2026-10-14T10:${m}:00.000Z`));
});

test('qua giờ mới / ngày mới / offline dài (30 ngày, nhiều batch): vé hồi lấp đầy tới trần 500 mỗi loại rồi dừng', () => {
  const h = makeCtx(Date.UTC(2026, 9, 14, 23, 55, 0));
  const { userId } = register(h.ctx, 'alice', 'secret123');
  h.setNow(Date.UTC(2026, 9, 15, 0, 2, 0));
  assert.equal(claimRecovery(h.ctx, userId).grantedTotal, 1); // 00:00 ngày mới
  h.advance(30 * 24 * 60 * 60 * 1000); // 30 ngày = 8640 mốc 5 phút
  const r = claimRecovery(h.ctx, userId);
  const cap = Object.values(RECOVERY_CAP_PER_TYPE).reduce((s, n) => s + n, 0); // 1000 + 4×500
  assert.equal(r.grantedTotal, cap - BONUS - 1); // chỉ lấp tới trần
  assert.equal(r.skippedFull, 8640 - r.grantedTotal); // các mốc còn lại bỏ, không cộng bù
  assert.deepEqual(readBalances(h.ctx.db, userId), { normal: 1000, shu: 500, wei: 500, wu: 500, qun: 500 });
  assert.deepEqual(r.recoveryCap, RECOVERY_CAP_PER_TYPE);
  assert.deepEqual(ledgerSum(h.ctx, userId), readBalances(h.ctx.db, userId));
  // Đã xử lý hết các mốc (không xử lý lại khi gọi tiếp)
  assert.equal(claimRecovery(h.ctx, userId).grantedTotal, 0);
});

test('trần vé hồi theo loại (thường 1000, phe 500): chỉ random trong loại còn dưới trần; vé vượt trần từ nguồn khác được giữ', () => {
  const h = makeCtx(Date.UTC(2026, 9, 14, 10, 0, 0));
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const nowIso = () => new Date(h.ctx.now()).toISOString();
  // Mọi RNG trả 0 => nếu không lọc thì luôn ra Vé thường
  h.ctx.rand = () => 0;
  // Vé thường 600 (> 500 nhưng < trần 1000) vẫn được hồi
  const b0 = readBalances(h.ctx.db, userId);
  applyTicketDelta(h.ctx.db, userId, 'normal', 600 - b0.normal, 'admin_grant', 'admin:test:0', null, nowIso());
  h.advance(SLOT);
  assert.equal(claimRecovery(h.ctx, userId).granted.normal, 1);
  // Đưa Vé thường lên 1010 bằng nguồn không bị trần (admin cộng)
  applyTicketDelta(h.ctx.db, userId, 'normal', 1010 - readBalances(h.ctx.db, userId).normal, 'admin_grant', 'admin:test:1', null, nowIso());
  h.advance(20 * SLOT);
  const r = claimRecovery(h.ctx, userId);
  assert.equal(r.granted.normal, 0);
  assert.equal(r.grantedTotal, 20);
  assert.equal(readBalances(h.ctx.db, userId).normal, 1010); // giữ nguyên 1010, không bị cắt
  // Cả 5 loại đầy => mốc không cấp vé, không ghi ledger
  for (const t of ['shu', 'wei', 'wu', 'qun'] as const) {
    const cur = readBalances(h.ctx.db, userId)[t];
    applyTicketDelta(h.ctx.db, userId, t, 500 - cur, 'admin_grant', `admin:test:${t}`, null, nowIso());
  }
  const before = (h.ctx.db.prepare("SELECT COUNT(*) AS n FROM ticket_transactions WHERE reason='time_recovery'").get() as { n: number }).n;
  h.advance(5 * SLOT);
  const full = claimRecovery(h.ctx, userId);
  assert.equal(full.grantedTotal, 0);
  assert.equal(full.skippedFull, 5);
  const after = (h.ctx.db.prepare("SELECT COUNT(*) AS n FROM ticket_transactions WHERE reason='time_recovery'").get() as { n: number }).n;
  assert.equal(after, before);
  // Dùng bớt 1 Vé Thục => mốc kế tiếp cấp đúng Vé Thục (loại duy nhất còn chỗ)
  applyTicketDelta(h.ctx.db, userId, 'shu', -1, 'gacha_draw', null, null, nowIso());
  h.advance(SLOT);
  assert.deepEqual(claimRecovery(h.ctx, userId).granted, { normal: 0, shu: 1, wei: 0, wu: 0, qun: 0 });
  assert.deepEqual(ledgerSum(h.ctx, userId), readBalances(h.ctx.db, userId));
});

test('loại vé roll độc lập theo RNG server cho từng mốc', () => {
  const h = makeCtx(Date.UTC(2026, 9, 14, 10, 0, 0));
  const { userId } = register(h.ctx, 'alice', 'secret123');
  // 5 mốc: r=0 => normal, 2500 => shu, 5000 => wei, 7500 => wu, 9000 => qun
  h.pushRand(0, 2500, 5000, 7500, 9000);
  h.setNow(Date.UTC(2026, 9, 14, 10, 25, 0));
  const r = claimRecovery(h.ctx, userId);
  assert.deepEqual(r.granted, { normal: 1, shu: 1, wei: 1, wu: 1, qun: 1 });
});

test('unique index chặn cấp trùng mốc kể cả khi state bị lùi', () => {
  const h = makeCtx(Date.UTC(2026, 9, 14, 10, 0, 0));
  const { userId } = register(h.ctx, 'alice', 'secret123');
  h.setNow(Date.UTC(2026, 9, 14, 10, 10, 0));
  syncRecovery(h.ctx, userId);
  // Giả lập lỗi: lùi state về 10:00 => lần sync tiếp phải lỗi (rollback), không cấp trùng
  h.ctx.db.prepare("UPDATE ticket_recovery_state SET last_processed_recovery_at = '2026-10-14T10:00:00.000Z'").run();
  assert.throws(() => syncRecovery(h.ctx, userId));
  assert.equal(getTickets(h.ctx, userId).total, BONUS + 2);
});

test('batch lỗi giữa chừng: batch đã commit giữ nguyên, lần sau tiếp tục không mất/không trùng', () => {
  const h = makeCtx(Date.UTC(2026, 9, 14, 10, 0, 0));
  const { userId } = register(h.ctx, 'alice', 'secret123');
  h.advance(1800 * SLOT); // 1800 mốc => 2 batch (1000/800); tổng vẫn dưới trần 500×5
  let calls = 0;
  const realRand = h.ctx.rand;
  h.ctx.rand = (max) => {
    calls++;
    if (calls === 1500) throw new Error('crash giả lập');
    return realRand(max);
  };
  assert.throws(() => syncRecovery(h.ctx, userId));
  assert.equal(getTickets(h.ctx, userId).total, BONUS + 1000); // batch 1 đã commit, batch 2 rollback
  h.ctx.rand = realRand;
  syncRecovery(h.ctx, userId);
  assert.equal(getTickets(h.ctx, userId).total, BONUS + 1800);
  const distinct = (h.ctx.db.prepare("SELECT COUNT(DISTINCT reference_id) AS n FROM ticket_transactions WHERE reason='time_recovery'").get() as { n: number }).n;
  assert.equal(distinct, 1800);
});

test('khởi động lại server (mở lại file DB) không mất mốc, không reset dữ liệu', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'tq-'));
  const path = join(dir, 'test.db');
  let now = Date.UTC(2026, 9, 14, 10, 0, 0);
  const mk = (): GameContext => ({ db: openDatabase(path), now: () => now, rand: (m) => randomInt(m) });
  let ctx = mk();
  const { userId } = register(ctx, 'alice', 'secret123');
  now += 3 * SLOT;
  syncRecovery(ctx, userId);
  ctx.db.close();
  now += 2 * SLOT;
  ctx = mk(); // "restart"
  assert.equal(getTickets(ctx, userId).total, BONUS + 3);
  syncRecovery(ctx, userId);
  assert.equal(getTickets(ctx, userId).total, BONUS + 5);
  ctx.db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('không có reason daily_claim trong schema', () => {
  const { ctx } = makeCtx();
  const { userId } = register(ctx, 'alice', 'secret123');
  assert.throws(() =>
    ctx.db
      .prepare("INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, created_at) VALUES (?, 'normal', 20, 'daily_claim', 'x')")
      .run(userId),
  );
});

// ================= Gacha =================

function userWithTickets(slots: number, rands: number[] = []) {
  const h = makeCtx(Date.UTC(2026, 9, 14, 10, 0, 0));
  const { userId } = register(h.ctx, 'alice', 'secret123');
  h.pushRand(...rands);
  h.advance(slots * SLOT);
  syncRecovery(h.ctx, userId);
  return { ...h, userId };
}

test('hết vé => NO_TICKETS, không tạo thẻ, không mất gì', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  // Dùng hết 100 vé quà đăng ký
  let k = 0;
  for (const t of ['normal', 'shu', 'wei', 'wu', 'qun'] as const) {
    while (readBalances(h.ctx.db, userId)[t] > 0) draw(h.ctx, userId, t, `drain-${String(k++).padStart(8, '0')}`);
  }
  assert.equal(k, BONUS);
  assert.throws(() => draw(h.ctx, userId, 'normal', 'key-final-0001'), errCode('NO_TICKETS'));
  assert.equal(listCards(h.ctx, userId, {}).total, BONUS);
  assert.equal(getTickets(h.ctx, userId).total, 0);
  assert.deepEqual(ledgerSum(h.ctx, userId), readBalances(h.ctx.db, userId));
});

test('quay: tiêu đúng 1 vé, tạo 1 thẻ, ledger khớp; retry cùng key trả kết quả cũ', () => {
  const h = userWithTickets(2, [0, 0]); // +2 vé thường
  const before = readBalances(h.ctx.db, h.userId).normal;
  const r1 = draw(h.ctx, h.userId, 'normal', 'key-00000001');
  assert.equal(r1.tickets.balances.normal, before - 1);
  const r2 = draw(h.ctx, h.userId, 'normal', 'key-00000001');
  assert.equal(r1.drawn, 1);
  assert.deepEqual(r2.results, r1.results);
  assert.equal(r2.tickets.balances.normal, before - 1);
  assert.equal(listCards(h.ctx, h.userId, {}).total, 1);
  assert.deepEqual(ledgerSum(h.ctx, h.userId), readBalances(h.ctx.db, h.userId));
  // Cùng key nhưng request khác => từ chối
  assert.throws(() => draw(h.ctx, h.userId, 'shu', 'key-00000001'), errCode('IDEMPOTENCY_KEY_REUSED'));
});

test('vé phe (Thục/Ngụy/Ngô/Quần) chỉ ra tướng đúng phe; vé thường phủ 140 tướng', () => {
  const h = userWithTickets(700, [
    ...Array(140).fill(2500), // 140 vé Thục
    ...Array(140).fill(5000), // 140 vé Ngụy
    ...Array(140).fill(7500), // 140 vé Ngô
    ...Array(140).fill(9000), // 140 vé Quần
    ...Array(140).fill(0), // 140 vé thường
  ]);
  const factionOf = new Map(
    (h.ctx.db.prepare('SELECT id, faction FROM generals').all() as { id: string; faction: string }[]).map((r) => [r.id, r.faction]),
  );
  let k = 0;
  for (const t of ['shu', 'wei', 'wu', 'qun'] as const) {
    for (let i = 0; i < 140; i++) {
      const { card } = draw(h.ctx, h.userId, t, `key-${String(k++).padStart(8, '0')}`).results[0]!;
      assert.equal(factionOf.get(card.generalId), t);
      assert.ok(card.level >= 1 && card.level <= 9, 'quay thẻ chỉ ra level 1–9');
    }
  }
  // Vé thường: điều khiển RNG để chọn index 0..139 => phủ đủ 140 tướng
  const seen = new Set<string>();
  for (let i = 0; i < 140; i++) {
    h.pushRand(i, 0);
    seen.add(draw(h.ctx, h.userId, 'normal', `key-${String(k++).padStart(8, '0')}`).results[0]!.card.generalId);
  }
  assert.equal(seen.size, 140);
});

test('có thể sở hữu nhiều bản sao cùng tướng', () => {
  const h = userWithTickets(3, [0, 0, 0]);
  for (let i = 0; i < 3; i++) {
    h.pushRand(0, 0); // tướng index 0, level 1
    draw(h.ctx, h.userId, 'normal', `dup-key-${i}0000`);
  }
  const cards = listCards(h.ctx, h.userId, {}).items;
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => c.generalId === 'cao-cao' && c.level === 1));
});

test('quay thẻ tối đa level 9: RNG cao nhất ra Lv.9, không bao giờ ra Lv.10', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const type = (['normal', 'shu', 'wei', 'wu', 'qun'] as const).find((t) => readBalances(h.ctx.db, userId)[t] >= 1)!;
  h.pushRand(0, 99999); // tướng index 0, r level = 99999 (giá trị cao nhất của thang GACHA_LEVEL_SCALE)
  const r = draw(h.ctx, userId, type, 'maxlv-0000001');
  assert.equal(r.results[0]!.card.level, 9);
  // Thực tế: dùng hết 100 vé quà, không thẻ nào ra Lv.10
  let k = 0;
  for (const t of ['normal', 'shu', 'wei', 'wu', 'qun'] as const) {
    while (readBalances(h.ctx.db, userId)[t] > 0) {
      const res = draw(h.ctx, userId, t, `maxlv-${String(k++).padStart(8, '0')}`, 10);
      assert.ok(res.results.every((x) => x.card.level <= 9));
    }
  }
  const max = (h.ctx.db.prepare('SELECT MAX(card_level) AS m FROM gacha_history').get() as { m: number }).m;
  assert.ok(max <= 9);
});

// ================= Quay ×10 =================

test('quay ×10: đủ vé => quay đúng 10, tiêu 10 vé, 10 thẻ, 10 dòng ledger + 10 dòng lịch sử', () => {
  const h = makeCtx();
  h.pushRand(...Array(100).fill(0)); // 100 vé quà đều là vé thường
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const r = draw(h.ctx, userId, 'normal', 'multi-0000001', 10);
  assert.equal(r.requested, 10);
  assert.equal(r.drawn, 10);
  assert.equal(r.results.length, 10);
  assert.equal(new Set(r.results.map((x) => x.card.id)).size, 10);
  assert.equal(r.tickets.balances.normal, BONUS - 10);
  assert.equal(listCards(h.ctx, userId, {}).total, 10);
  assert.equal(listHistory(h.ctx, userId, { kind: 'gacha' }).total, 10);
  const used = (h.ctx.db.prepare("SELECT COUNT(*) AS n FROM ticket_transactions WHERE reason = 'gacha_draw'").get() as { n: number }).n;
  assert.equal(used, 10);
  assert.deepEqual(ledgerSum(h.ctx, userId), readBalances(h.ctx.db, userId));
});

test('quay ×10 khi còn ít hơn 10 vé => quay hết số vé còn lại', () => {
  const h = makeCtx();
  // 3 vé Thục, 97 vé thường
  h.pushRand(2500, 2500, 2500, ...Array(97).fill(0));
  const { userId } = register(h.ctx, 'alice', 'secret123');
  assert.equal(readBalances(h.ctx.db, userId).shu, 3);
  const r = draw(h.ctx, userId, 'shu', 'multi-0000001', 10);
  assert.equal(r.requested, 10);
  assert.equal(r.drawn, 3);
  assert.equal(r.results.length, 3);
  assert.ok(r.results.every((x) => x.general.faction === 'shu'));
  assert.equal(r.tickets.balances.shu, 0);
  assert.equal(r.tickets.balances.normal, 97); // loại vé khác không bị đụng
  // Hết vé Thục => lần sau báo NO_TICKETS
  assert.throws(() => draw(h.ctx, userId, 'shu', 'multi-0000002', 10), errCode('NO_TICKETS'));
  assert.deepEqual(ledgerSum(h.ctx, userId), readBalances(h.ctx.db, userId));
});

test('quay ×10: retry cùng key trả kết quả cũ; cùng key khác count => 409', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const type = (['normal', 'shu', 'wei', 'wu', 'qun'] as const).find((t) => readBalances(h.ctx.db, userId)[t] >= 10)!;
  const before = readBalances(h.ctx.db, userId)[type];
  const a = draw(h.ctx, userId, type, 'multi-0000001', 10);
  const b = draw(h.ctx, userId, type, 'multi-0000001', 10);
  assert.deepEqual(b.results, a.results);
  assert.equal(b.tickets.balances[type], before - 10);
  assert.equal(listCards(h.ctx, userId, {}).total, 10);
  assert.throws(() => draw(h.ctx, userId, type, 'multi-0000001', 1), errCode('IDEMPOTENCY_KEY_REUSED'));
});

test('quay ×10 nguyên tử: lỗi ở lượt thứ 4 => không mất vé, không tạo thẻ nào', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const type = (['normal', 'shu', 'wei', 'wu', 'qun'] as const).find((t) => readBalances(h.ctx.db, userId)[t] >= 10)!;
  const before = readBalances(h.ctx.db, userId);
  let calls = 0;
  h.ctx.rand = (max) => {
    if (++calls === 7) throw new Error('crash giả lập'); // mỗi lượt gọi rand 2 lần => lượt 4
    return randomInt(max);
  };
  assert.throws(() => draw(h.ctx, userId, type, 'multi-0000001', 10));
  assert.deepEqual(readBalances(h.ctx.db, userId), before);
  assert.equal(listCards(h.ctx, userId, {}).total, 0);
  assert.equal(listHistory(h.ctx, userId, { kind: 'gacha' }).total, 0);
});

test('số lần quay không hợp lệ (không thuộc [1, 10]) => 400', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  for (const n of [0, 2, 5, 11, 999, 1001]) {
    assert.throws(() => draw(h.ctx, userId, 'normal', `bad-count-${n}000`, n), errCode('INVALID_DRAW_COUNT'));
  }
  assert.equal(getTickets(h.ctx, userId).total, BONUS);
});

test('Mở tất cả (count = DRAW_ALL_MAX): quay hết vé loại đã chọn, tối đa 1000 lượt mỗi lần, nguyên tử, retry trả kết quả cũ', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const nowIso = new Date(h.ctx.now()).toISOString();
  // 1200 Vé Thục (vượt trần mỗi lần bấm)
  const b0 = readBalances(h.ctx.db, userId);
  applyTicketDelta(h.ctx.db, userId, 'shu', 1200 - b0.shu, 'admin_grant', 'admin:test:all', null, nowIso);
  const before = readBalances(h.ctx.db, userId);
  const r = draw(h.ctx, userId, 'shu', 'open-all-00001', DRAW_ALL_MAX);
  assert.equal(r.requested, DRAW_ALL_MAX);
  assert.equal(r.drawn, 1000);
  assert.equal(r.results.length, 1000);
  assert.ok(r.results.every((x) => x.general.faction === 'shu'));
  const after = readBalances(h.ctx.db, userId);
  assert.equal(after.shu, 200);
  assert.equal(after.normal, before.normal); // không đụng loại vé khác
  assert.equal(listHistory(h.ctx, userId, { kind: 'gacha' }).total, 1000);
  // Retry cùng key: trả kết quả cũ, không tiêu thêm
  const again = draw(h.ctx, userId, 'shu', 'open-all-00001', DRAW_ALL_MAX);
  assert.equal(again.drawn, 1000);
  assert.equal(readBalances(h.ctx.db, userId).shu, 200);
  // Bấm lại: quay nốt 200 vé còn lại
  assert.equal(draw(h.ctx, userId, 'shu', 'open-all-00002', DRAW_ALL_MAX).drawn, 200);
  assert.equal(readBalances(h.ctx.db, userId).shu, 0);
  assert.deepEqual(ledgerSum(h.ctx, userId), readBalances(h.ctx.db, userId));
});

// ================= Nâng cấp =================

function upgradeSetup(level: number, generals = ['cao-cao', 'cao-cao'], levels?: number[]) {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const ids = generals.map((g, i) => insertCard(h.ctx, userId, g, levels?.[i] ?? level));
  return { ...h, userId, ids };
}

test('preview trả đúng tỷ lệ & phân phối thất bại', () => {
  const h = upgradeSetup(3);
  const p = previewUpgrade(h.ctx, h.userId, h.ids);
  assert.equal(p.successBps, 7000);
  assert.equal(p.failureBps, 3000);
  assert.deepEqual(p.failureDistribution, [{ level: 2, bps: 2000 }, { level: 3, bps: 8000 }]);
});

test('thành công: tiêu 2 thẻ, tạo 1 thẻ level+1 cùng tướng', () => {
  const h = upgradeSetup(1);
  h.pushRand(0); // < 9000 => thành công
  const r = attemptUpgrade(h.ctx, h.userId, h.ids, 'upg-00000001');
  assert.equal(r.outcome, 'success');
  assert.equal(r.resultCard.level, 2);
  assert.equal(r.resultCard.generalId, 'cao-cao');
  const cards = listCards(h.ctx, h.userId, {}).items;
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.level, 2);
});

test('thất bại: roll bảng thất bại, không vượt level đầu vào; snapshot lưu lịch sử', () => {
  const h = upgradeSetup(5);
  h.pushRand(5000, 0); // 5000 >= 5000 => thất bại; r=0 => tụt 1 bậc về Lv4
  const r = attemptUpgrade(h.ctx, h.userId, h.ids, 'upg-00000001');
  assert.equal(r.outcome, 'failure');
  assert.equal(r.resultCard.level, 4);
  const hist = listHistory(h.ctx, h.userId, { kind: 'upgrade' }).items[0]!;
  assert.equal(hist.kind, 'upgrade');
  if (hist.kind === 'upgrade') {
    assert.deepEqual(hist.inputCardIds, h.ids);
    assert.equal(hist.failureDistribution.length, 2);
    assert.equal(hist.successBps, 5000);
  }
});

test('thất bại level 1 luôn giữ level 1; phân phối thất bại không bao giờ vượt đầu vào (quét RNG)', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  let k = 0;
  for (let lv = 1; lv <= 9; lv++) {
    for (let r = 0; r < 10000; r += 37) {
      const ids = [1, 2].map(() => insertCard(h.ctx, userId, 'cao-cao', lv));
      h.pushRand(9999, r); // 9999 luôn thất bại (mọi tỷ lệ <= 8000)
      const res = attemptUpgrade(h.ctx, userId, ids, `upg-${String(k++).padStart(8, '0')}`);
      assert.equal(res.outcome, 'failure');
      assert.ok(res.resultCard.level >= 1 && res.resultCard.level <= lv);
      if (lv === 1) assert.equal(res.resultCard.level, 1);
    }
  }
});

test('retry cùng key không tiêu thụ lại thẻ', () => {
  const h = upgradeSetup(1);
  const a = attemptUpgrade(h.ctx, h.userId, h.ids, 'upg-00000001');
  const b = attemptUpgrade(h.ctx, h.userId, h.ids, 'upg-00000001');
  assert.deepEqual(a, b);
  assert.equal((h.ctx.db.prepare('SELECT COUNT(*) AS n FROM upgrade_history').get() as { n: number }).n, 1);
});

test('từ chối: sai số thẻ (1 hoặc 3), trùng ID, khác tướng, khác level, level 10, thẻ người khác, thẻ đã tiêu thụ', () => {
  let h = upgradeSetup(1, ['cao-cao', 'cao-cao', 'cao-cao']);
  assert.equal(UPGRADE_INPUT_COUNT, 2);
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, h.ids.slice(0, 1), 'k-00000001'), errCode('WRONG_CARD_COUNT'));
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, h.ids, 'k-0000001b'), errCode('WRONG_CARD_COUNT')); // 3 thẻ không còn hợp lệ
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, [h.ids[0]!, h.ids[0]!], 'k-00000002'), errCode('DUPLICATE_CARD'));
  assert.equal(listCards(h.ctx, h.userId, {}).total, 3); // không thẻ nào bị tiêu thụ

  h = upgradeSetup(1, ['cao-cao', 'liu-bei']);
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, h.ids, 'k-00000003'), errCode('DIFFERENT_GENERAL'));

  h = upgradeSetup(1, undefined, [1, 2]);
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, h.ids, 'k-00000004'), errCode('DIFFERENT_LEVEL'));

  h = upgradeSetup(10);
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, h.ids, 'k-00000005'), errCode('MAX_LEVEL'));

  h = upgradeSetup(1);
  const bob = register(h.ctx, 'bob', 'secret123').userId;
  assert.throws(() => attemptUpgrade(h.ctx, bob, h.ids, 'k-00000006'), errCode('CARD_NOT_FOUND'));
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, [h.ids[0]!, 99999], 'k-00000007'), errCode('CARD_NOT_FOUND'));

  attemptUpgrade(h.ctx, h.userId, h.ids, 'k-00000008');
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, h.ids, 'k-00000009'), errCode('CARD_CONSUMED'));
  // Thất bại validate không tiêu thụ thẻ nào
  assert.equal(listCards(h.ctx, h.userId, {}).total, 1);
});

test('lỗi giữa transaction nâng cấp => rollback, thẻ không bị tiêu thụ', () => {
  const h = upgradeSetup(2);
  h.ctx.rand = () => {
    throw new Error('crash giả lập');
  };
  assert.throws(() => attemptUpgrade(h.ctx, h.userId, h.ids, 'k-00000001'));
  assert.equal(listCards(h.ctx, h.userId, {}).total, 2);
});

// ================= Nâng cấp nhanh =================

function quickSetup(cards: [string, number][]) {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const ids = cards.map(([g, lv]) => insertCard(h.ctx, userId, g, lv));
  const levels = () =>
    (listCards(h.ctx, userId, { sort: 'level_desc', pageSize: 500 }).items.map((c) => `${c.generalId}:${c.level}`)).sort();
  return { ...h, userId, ids, levels };
}

test('nâng cấp nhanh: ghép liên tục (dây chuyền) mọi cặp ≤ Lv5, mỗi lần ghi 1 dòng lịch sử', () => {
  // 4 thẻ Tào Tháo Lv1 + 2 Lưu Bị Lv3 + 1 Lữ Bố Lv2 (lẻ, không ghép)
  const h = quickSetup([['cao-cao', 1], ['cao-cao', 1], ['cao-cao', 1], ['cao-cao', 1], ['liu-bei', 3], ['liu-bei', 3], ['lu-bu', 2]]);
  h.ctx.rand = () => 0; // luôn thành công
  const r = quickUpgrade(h.ctx, h.userId, 'quick-000001');
  // Lv1+Lv1 -> Lv2 (×2) rồi Lv2+Lv2 -> Lv3; Lưu Bị Lv3+Lv3 -> Lv4
  assert.equal(r.merges, 4);
  assert.equal(r.successes, 4);
  assert.equal(r.failures, 0);
  assert.equal(r.hasMore, false);
  assert.deepEqual(h.levels(), ['cao-cao:3', 'liu-bei:4', 'lu-bu:2']);
  assert.equal(listHistory(h.ctx, h.userId, { kind: 'upgrade' }).total, 4);
  // level thấp được xử lý trước
  assert.deepEqual(r.results.map((x) => x.inputLevel), [1, 1, 2, 3]);
});

test('nâng cấp nhanh: không đụng thẻ có level > 5; thẻ lên Lv6 không ghép tiếp', () => {
  const h = quickSetup([['cao-cao', 5], ['cao-cao', 5], ['cao-cao', 6], ['liu-bei', 7], ['liu-bei', 7]]);
  h.ctx.rand = () => 0;
  const r = quickUpgrade(h.ctx, h.userId, 'quick-000001');
  assert.equal(r.merges, 1);
  assert.deepEqual(h.levels(), ['cao-cao:6', 'cao-cao:6', 'liu-bei:7', 'liu-bei:7']);
});

test('nâng cấp nhanh: chỉ ghép các level được chọn; chọn tới Lv9 ghép được lên Lv10', () => {
  // Chỉ chọn Lv3: 2 thẻ Lv3 ghép, 2 thẻ Lv1 để nguyên.
  let h = quickSetup([['cao-cao', 3], ['cao-cao', 3], ['cao-cao', 1], ['cao-cao', 1]]);
  h.ctx.rand = () => 0;
  const r = quickUpgrade(h.ctx, h.userId, 'quick-000001', [3]);
  assert.equal(r.merges, 1);
  assert.deepEqual(r.levels, [3]);
  assert.deepEqual(h.levels(), ['cao-cao:1', 'cao-cao:1', 'cao-cao:4']);

  // Chọn tới Lv9: 2 thẻ Lv9 ghép thành Lv10 (Lv10 không ghép tiếp).
  h = quickSetup([['cao-cao', 9], ['cao-cao', 9]]);
  h.ctx.rand = () => 0;
  const r2 = quickUpgrade(h.ctx, h.userId, 'quick-000002', [9]);
  assert.equal(r2.merges, 1);
  assert.deepEqual(h.levels(), ['cao-cao:10']);
});

test('nâng cấp nhanh: danh sách level rỗng hoặc ngoài khoảng Lv.1–9 bị chặn', () => {
  const h = quickSetup([['cao-cao', 1], ['cao-cao', 1]]);
  assert.throws(() => quickUpgrade(h.ctx, h.userId, 'quick-000001', []), errCode('INVALID_LEVELS'));
  assert.throws(() => quickUpgrade(h.ctx, h.userId, 'quick-000002', [10]), errCode('INVALID_LEVELS'));
  assert.throws(() => quickUpgrade(h.ctx, h.userId, 'quick-000003', [0]), errCode('INVALID_LEVELS'));
});

test('nâng cấp nhanh: thất bại tụt level vẫn được ghép lại nếu còn cặp; kết thúc khi hết cặp', () => {
  const h = quickSetup([['cao-cao', 3], ['cao-cao', 3], ['cao-cao', 2]]);
  // Lần 1 (Lv3): r=9999 thất bại, r=0 -> tụt về Lv2 => có cặp Lv2; lần 2 (Lv2): r=0 thành công -> Lv3
  h.pushRand(9999, 0, 0);
  const r = quickUpgrade(h.ctx, h.userId, 'quick-000001');
  assert.equal(r.merges, 2);
  assert.deepEqual(r.results.map((x) => [x.inputLevel, x.outcome, x.resultLevel]), [[3, 'failure', 2], [2, 'success', 3]]);
  assert.deepEqual(h.levels(), ['cao-cao:3']);
});

test('nâng cấp nhanh: retry cùng key trả kết quả cũ; không có cặp => NOTHING_TO_UPGRADE', () => {
  const h = quickSetup([['cao-cao', 1], ['cao-cao', 1]]);
  const a = quickUpgrade(h.ctx, h.userId, 'quick-000001');
  const b = quickUpgrade(h.ctx, h.userId, 'quick-000001');
  assert.deepEqual(a, b);
  assert.equal(listCards(h.ctx, h.userId, {}).total, 1);
  assert.throws(() => quickUpgrade(h.ctx, h.userId, 'quick-000002'), errCode('NOTHING_TO_UPGRADE'));
});

test('nâng cấp nhanh nguyên tử: lỗi giữa chừng => không thẻ nào bị tiêu thụ, không lịch sử', () => {
  const h = quickSetup([['cao-cao', 1], ['cao-cao', 1], ['liu-bei', 1], ['liu-bei', 1]]);
  let calls = 0;
  h.ctx.rand = () => {
    if (++calls === 2) throw new Error('crash giả lập'); // lần ghép thứ 2
    return 0;
  };
  assert.throws(() => quickUpgrade(h.ctx, h.userId, 'quick-000001'));
  assert.equal(listCards(h.ctx, h.userId, {}).total, 4);
  assert.equal(listHistory(h.ctx, h.userId, { kind: 'upgrade' }).total, 0);
});

test('nâng cấp nhanh chỉ dùng thẻ của chính người chơi', () => {
  const h = quickSetup([['cao-cao', 1]]);
  const bob = register(h.ctx, 'bob', 'secret123').userId;
  insertCard(h.ctx, bob, 'cao-cao', 1);
  assert.throws(() => quickUpgrade(h.ctx, h.userId, 'quick-000001'), errCode('NOTHING_TO_UPGRADE'));
  assert.equal(listCards(h.ctx, bob, {}).total, 1);
});

// ================= Tặng thẻ =================

function giftSetup(n: number, level = 1) {
  const h = makeCtx();
  register(h.ctx, 'boss', 'secret123'); // tài khoản đầu tiên = admin (không chơi game)
  const alice = register(h.ctx, 'alice', 'secret123').userId;
  const bob = register(h.ctx, 'bob', 'secret123').userId;
  const ids = Array.from({ length: n }, (_, i) => insertCard(h.ctx, alice, i % 2 ? 'liu-bei' : 'cao-cao', level + (i % 3)));
  return { ...h, alice, bob, ids };
}

test('tặng thẻ: chuyển đúng thẻ sang người nhận, giữ nguyên tướng/level, ghi lịch sử cả 2 phía', () => {
  const h = giftSetup(3);
  const r = giftCards(h.ctx, h.alice, 'BOB', h.ids, 'gift-000001'); // tên không phân biệt hoa thường
  assert.equal(r.toUsername, 'bob');
  assert.equal(r.cards.length, 3);
  assert.equal(listCards(h.ctx, h.alice, {}).total, 0);
  const bobCards = listCards(h.ctx, h.bob, {}).items;
  assert.deepEqual(bobCards.map((c) => c.id).sort(), [...h.ids].sort());
  assert.deepEqual(
    bobCards.sort((a, b) => a.id - b.id).map((c) => [c.generalId, c.level]),
    r.cards.map((c) => [c.generalId, c.level]),
  );
  const sent = listHistory(h.ctx, h.alice, { kind: 'gift' }).items[0]!;
  const recv = listHistory(h.ctx, h.bob, { kind: 'gift' }).items[0]!;
  assert.ok(sent.kind === 'gift' && sent.direction === 'sent' && sent.otherUsername === 'bob');
  assert.ok(recv.kind === 'gift' && recv.direction === 'received' && recv.otherUsername === 'alice');
});

test('tặng thẻ: tối đa 20 thẻ mỗi lần; 21 thẻ bị từ chối, không chuyển thẻ nào', () => {
  assert.equal(GIFT_MAX_CARDS, 20);
  const h = giftSetup(21);
  assert.throws(() => giftCards(h.ctx, h.alice, 'bob', h.ids, 'gift-000001'), errCode('GIFT_CARD_COUNT'));
  assert.equal(listCards(h.ctx, h.bob, {}).total, 0);
  const ok = giftCards(h.ctx, h.alice, 'bob', h.ids.slice(0, 20), 'gift-000002');
  assert.equal(ok.cards.length, 20);
  assert.equal(listCards(h.ctx, h.bob, {}).total, 20);
  assert.throws(() => giftCards(h.ctx, h.alice, 'bob', [], 'gift-000003'), errCode('GIFT_CARD_COUNT'));
});

test('tặng thẻ: từ chối tặng chính mình, người nhận không tồn tại, thẻ người khác, thẻ đã tiêu thụ, trùng ID', () => {
  const h = giftSetup(4);
  assert.throws(() => giftCards(h.ctx, h.alice, 'alice', h.ids, 'g-00000001'), errCode('GIFT_TO_SELF'));
  assert.throws(() => giftCards(h.ctx, h.alice, 'nobody', h.ids, 'g-00000002'), errCode('RECIPIENT_NOT_FOUND'));
  assert.throws(() => giftCards(h.ctx, h.alice, 'boss', h.ids, 'g-00000006'), errCode('RECIPIENT_IS_ADMIN'));
  assert.throws(() => giftCards(h.ctx, h.bob, 'alice', h.ids, 'g-00000003'), errCode('CARD_NOT_FOUND'));
  assert.throws(() => giftCards(h.ctx, h.alice, 'bob', [h.ids[0]!, h.ids[0]!], 'g-00000004'), errCode('DUPLICATE_CARD'));
  // Thẻ đã bị ghép (tiêu thụ) thì không tặng được; cả giao dịch bị huỷ
  const pair = [insertCard(h.ctx, h.alice, 'lu-bu', 1), insertCard(h.ctx, h.alice, 'lu-bu', 1)];
  attemptUpgrade(h.ctx, h.alice, pair, 'upg-0000001');
  assert.throws(() => giftCards(h.ctx, h.alice, 'bob', [h.ids[0]!, pair[0]!], 'g-00000005'), errCode('CARD_CONSUMED'));
  assert.equal(listCards(h.ctx, h.bob, {}).total, 0);
});

test('tặng thẻ: retry cùng key trả kết quả cũ, không chuyển lần 2; người nhận dùng được thẻ để ghép', () => {
  const h = giftSetup(0);
  const ids = [insertCard(h.ctx, h.alice, 'cao-cao', 2), insertCard(h.ctx, h.alice, 'cao-cao', 2)];
  const a = giftCards(h.ctx, h.alice, 'bob', ids, 'gift-000001');
  const b = giftCards(h.ctx, h.alice, 'bob', ids, 'gift-000001');
  assert.deepEqual(a, b);
  assert.equal((h.ctx.db.prepare('SELECT COUNT(*) AS n FROM card_gifts').get() as { n: number }).n, 1);
  // Người gửi không còn dùng được thẻ; người nhận ghép được
  assert.throws(() => attemptUpgrade(h.ctx, h.alice, ids, 'upg-alice-01'), errCode('CARD_NOT_FOUND'));
  h.pushRand(0);
  assert.equal(attemptUpgrade(h.ctx, h.bob, ids, 'upg-bob-0001').resultCard.level, 3);
});

test('danh sách người nhận: mọi người trừ mình, người giao dịch gần nhất lên đầu, còn lại A→Z, có tìm kiếm', () => {
  const h = makeCtx();
  register(h.ctx, 'boss', 'secret123'); // admin: không có trong danh sách người nhận
  const me = register(h.ctx, 'me_user', 'secret123').userId;
  for (const n of ['zoe', 'anna', 'bob', 'carl']) register(h.ctx, n, 'secret123');
  const carl = (h.ctx.db.prepare("SELECT id FROM users WHERE username = 'carl'").get() as { id: number }).id;
  // Chưa giao dịch: A→Z, không có chính mình
  assert.deepEqual(listRecipients(h.ctx, me).map((r) => r.username), ['anna', 'bob', 'carl', 'zoe']);
  // 10:03 tặng zoe; 10:13 nhận từ carl => carl gần nhất, rồi zoe, rồi phần còn lại A→Z
  giftCards(h.ctx, me, 'zoe', [insertCard(h.ctx, me, 'cao-cao', 1)], 'rcp-gift-01');
  h.advance(10 * 60 * 1000);
  giftCards(h.ctx, carl, 'me_user', [insertCard(h.ctx, carl, 'lu-bu', 1)], 'rcp-gift-02');
  const list = listRecipients(h.ctx, me);
  assert.deepEqual(list.map((r) => r.username), ['carl', 'zoe', 'anna', 'bob']);
  assert.ok(list[0]!.lastGiftAt && list[2]!.lastGiftAt === null);
  // Tìm kiếm không phân biệt hoa thường; ký tự % không thành wildcard
  assert.deepEqual(listRecipients(h.ctx, me, 'O').map((r) => r.username), ['zoe', 'bob']);
  assert.deepEqual(listRecipients(h.ctx, me, '%'), []);
});

// ================= Bộ sưu tập & lịch sử =================

test('lọc bộ sưu tập theo phe/level/tên không dấu', () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  insertCard(h.ctx, userId, 'cao-cao', 1);
  insertCard(h.ctx, userId, 'liu-bei', 3);
  insertCard(h.ctx, userId, 'lu-bu', 3);
  assert.equal(listCards(h.ctx, userId, { faction: 'shu' }).total, 1);
  assert.equal(listCards(h.ctx, userId, { level: 3 }).total, 2);
  assert.equal(listCards(h.ctx, userId, { q: 'lu bo' }).total, 1);
  assert.equal(listCards(h.ctx, userId, { q: 'Lữ Bố' }).total, 1);
  assert.equal(listCards(h.ctx, userId, { q: 'tao thao' }).total, 1);
});

test('lịch sử gồm vé hồi, vé đã dùng, gacha', () => {
  const h = userWithTickets(2, [0, 0]);
  draw(h.ctx, h.userId, 'normal', 'key-00000001');
  const signupRows = (h.ctx.db
    .prepare("SELECT COUNT(*) AS n FROM ticket_transactions WHERE reason = 'signup_bonus'")
    .get() as { n: number }).n;
  const all = listHistory(h.ctx, h.userId, { pageSize: 50 });
  assert.equal(all.total, signupRows + 4); // quà đăng ký + 2 vé hồi + 1 vé dùng + 1 gacha
  assert.ok(all.items.some((e) => e.kind === 'ticket' && e.reason === 'signup_bonus'))
  assert.equal(listHistory(h.ctx, h.userId, { kind: 'gacha' }).total, 1);
});

// ================= Giftcode (mục 3.9) =================

test('giftcode: 4 code tân thủ là 200 VÉ mỗi loại, không hạn, featured', async () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const { listFeaturedGiftCodes } = await import('../src/managers/giftcode.manager.ts');
  const list = listFeaturedGiftCodes(h.ctx, userId);
  assert.deepEqual(
    list.map((c) => [c.code, c.rewards, c.expiresAt, c.redeemed]),
    [
      ['THUCQUOC', [{ kind: 'ticket', pool: 'shu', count: 200 }], null, false],
      ['NGUYQUOC', [{ kind: 'ticket', pool: 'wei', count: 200 }], null, false],
      ['NGOQUOC', [{ kind: 'ticket', pool: 'wu', count: 200 }], null, false],
      ['QUANQUOC', [{ kind: 'ticket', pool: 'qun', count: 200 }], null, false],
    ],
  );
});

test('giftcode: nhập THUCQUOC => +200 Vé Thục (ledger giftcode), không tạo thẻ; nhập lần 2 bị chặn', async () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const { redeemGiftCode, listFeaturedGiftCodes } = await import('../src/managers/giftcode.manager.ts');
  const before = readBalances(h.ctx.db, userId);
  const r = redeemGiftCode(h.ctx, userId, ' thucquoc ');
  assert.equal(r.code, 'THUCQUOC');
  assert.deepEqual(r.tickets, [{ pool: 'shu', count: 200 }]);
  const after = readBalances(h.ctx.db, userId);
  assert.equal(after.shu, before.shu + 200);
  assert.equal(after.normal, before.normal);
  assert.equal(r.balances.balances.shu, after.shu);
  assert.deepEqual(ledgerSum(h.ctx, userId), after);
  assert.equal(listCards(h.ctx, userId, {}).total, 0);
  assert.throws(() => redeemGiftCode(h.ctx, userId, 'THUCQUOC'), errCode('GIFTCODE_ALREADY_REDEEMED'));
  assert.equal(readBalances(h.ctx.db, userId).shu, after.shu);
  assert.equal(listFeaturedGiftCodes(h.ctx, userId).find((c) => c.code === 'THUCQUOC')!.redeemed, true);
  const hist = listHistory(h.ctx, userId, { kind: 'giftcode' });
  assert.equal(hist.total, 1);
  assert.deepEqual((hist.items[0] as { tickets: unknown }).tickets, [{ pool: 'shu', count: 200 }]);
  // Người chơi khác vẫn nhập được; nhập cả 4 code => +200 mỗi loại phe
  const bob = register(h.ctx, 'bob', 'secret123').userId;
  const b0 = readBalances(h.ctx.db, bob);
  for (const c of ['THUCQUOC', 'NGUYQUOC', 'NGOQUOC', 'QUANQUOC']) redeemGiftCode(h.ctx, bob, c);
  const b1 = readBalances(h.ctx.db, bob);
  assert.deepEqual(
    [b1.shu - b0.shu, b1.wei - b0.wei, b1.wu - b0.wu, b1.qun - b0.qun, b1.normal - b0.normal],
    [200, 200, 200, 200, 0],
  );
});

test('giftcode chỉ tặng vé: tạo code có thẻ bị từ chối; code nhiều loại vé, hạn sử dụng, tắt code, code sai', async () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const { redeemGiftCode, adminCreateGiftCode, adminSetGiftCodeActive } = await import('../src/managers/giftcode.manager.ts');
  assert.throws(() => adminCreateGiftCode(h.ctx, userId, { code: 'THE', rewards: [{ kind: 'card', pool: 'shu', count: 5 }] }), errCode('INVALID_REWARDS'));
  const c = adminCreateGiftCode(h.ctx, userId, {
    code: 'mix-01',
    rewards: [{ pool: 'shu', count: 10 }, { kind: 'ticket', pool: 'wei', count: 20 }, { pool: 'shu', count: 5 }],
    expiresAt: new Date(T0 + 60 * 60 * 1000).toISOString(),
  });
  assert.equal(c.code, 'MIX-01');
  assert.deepEqual(c.rewards, [{ kind: 'ticket', pool: 'shu', count: 15 }, { kind: 'ticket', pool: 'wei', count: 20 }]);
  assert.equal(c.totalTickets, 35);
  assert.equal(c.totalCards, 0);
  assert.throws(() => adminCreateGiftCode(h.ctx, userId, { code: 'MIX-01', rewards: [{ pool: 'wu', count: 1 }] }), errCode('GIFTCODE_EXISTS'));
  assert.throws(() => adminCreateGiftCode(h.ctx, userId, { code: 'MANYT', rewards: [{ pool: 'wu', count: 10001 }] }), errCode('INVALID_REWARDS'));
  assert.throws(() => adminCreateGiftCode(h.ctx, userId, { code: 'OLD', rewards: [{ pool: 'wu', count: 1 }], expiresAt: new Date(T0 - 1000).toISOString() }), errCode('INVALID_EXPIRY'));
  assert.throws(() => redeemGiftCode(h.ctx, userId, 'KHONGCO'), errCode('GIFTCODE_NOT_FOUND'));

  const bob = register(h.ctx, 'bob', 'secret123').userId;
  const b0 = readBalances(h.ctx.db, bob);
  const r = redeemGiftCode(h.ctx, bob, 'MIX-01');
  assert.deepEqual(r.tickets, [{ pool: 'shu', count: 15 }, { pool: 'wei', count: 20 }]);
  const b1 = readBalances(h.ctx.db, bob);
  assert.deepEqual([b1.shu - b0.shu, b1.wei - b0.wei], [15, 20]);
  assert.deepEqual(ledgerSum(h.ctx, bob), b1);
  assert.equal(listCards(h.ctx, bob, {}).total, 0);

  // Hết hạn
  const carl = register(h.ctx, 'carl', 'secret123').userId;
  const c0 = getTickets(h.ctx, carl).total;
  h.advance(60 * 60 * 1000);
  assert.throws(() => redeemGiftCode(h.ctx, carl, 'MIX-01'), errCode('GIFTCODE_EXPIRED'));
  // Tắt code
  const t = adminCreateGiftCode(h.ctx, userId, { code: 'OFF', rewards: [{ pool: 'normal', count: 3 }] });
  adminSetGiftCodeActive(h.ctx, t.id, false);
  assert.throws(() => redeemGiftCode(h.ctx, carl, 'OFF'), errCode('GIFTCODE_NOT_FOUND'));
  assert.equal(getTickets(h.ctx, carl).total, c0); // code hết hạn / đã tắt không cộng vé
  adminSetGiftCodeActive(h.ctx, t.id, true);
  assert.deepEqual(redeemGiftCode(h.ctx, carl, 'OFF').tickets, [{ pool: 'normal', count: 3 }]);
});

test('giftcode thẻ cũ: bị tắt, không nhập được, không bật lại được', async () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const { redeemGiftCode, adminSetGiftCodeActive } = await import('../src/managers/giftcode.manager.ts');
  // Code thẻ cũ (dữ liệu trước v9) — giả lập bằng cách ghi trực tiếp
  const id = Number(
    h.ctx.db
      .prepare("INSERT INTO gift_codes (code, rewards, total_cards, total_tickets, is_active, created_at) VALUES ('THECU', '[{\"pool\":\"shu\",\"count\":5}]', 5, 0, 1, 'x')")
      .run().lastInsertRowid,
  );
  assert.throws(() => redeemGiftCode(h.ctx, userId, 'THECU'), errCode('GIFTCODE_NOT_FOUND'));
  assert.equal(listCards(h.ctx, userId, {}).total, 0);
  adminSetGiftCodeActive(h.ctx, id, false);
  assert.throws(() => adminSetGiftCodeActive(h.ctx, id, true), errCode('GIFTCODE_LEGACY'));
});

test('giftcode nguyên tử: lỗi giữa chừng => không cộng vé nào, chưa tính là đã nhập', async () => {
  const h = makeCtx();
  const { userId } = register(h.ctx, 'alice', 'secret123');
  const { redeemGiftCode, adminCreateGiftCode } = await import('../src/managers/giftcode.manager.ts');
  adminCreateGiftCode(h.ctx, userId, { code: 'ATOM', rewards: [{ pool: 'wu', count: 50 }, { pool: 'qun', count: 50 }] });
  const b0 = readBalances(h.ctx.db, userId);
  // Ép lỗi ở bước ghi lượt nhập (sau khi đã cộng vé) bằng trigger
  h.ctx.db.exec("CREATE TEMP TRIGGER boom BEFORE INSERT ON gift_code_redemptions BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  assert.throws(() => redeemGiftCode(h.ctx, userId, 'ATOM'), /boom/);
  assert.deepEqual(readBalances(h.ctx.db, userId), b0);
  h.ctx.db.exec('DROP TRIGGER boom');
  redeemGiftCode(h.ctx, userId, 'ATOM');
  const b1 = readBalances(h.ctx.db, userId);
  assert.deepEqual([b1.wu - b0.wu, b1.qun - b0.qun], [50, 50]);
});

// ======================= Bảng xếp hạng =======================

test('leaderboard: xếp theo TỔNG LC đội hình (đội tự động), đồng LC đồng hạng, ẩn admin, bỏ thẻ đã tiêu thụ', () => {
  const { ctx } = makeCtx();
  const admin = register(ctx, 'boss', 'secret123').userId; // tài khoản đầu tiên = admin
  const a = register(ctx, 'alice', 'secret123').userId;
  const b = register(ctx, 'bob', 'secret123').userId;
  const c = register(ctx, 'carol', 'secret123').userId;
  const d = register(ctx, 'dave', 'secret123').userId;
  register(ctx, 'nocards', 'secret123');
  insertCard(ctx, admin, 'cao-cao', 10); // admin không được xếp hạng
  // alice: 2 tướng => đội tự động gồm 2 tướng (chưa đủ 6)
  insertCard(ctx, a, 'cao-cao', 10);
  insertCard(ctx, a, 'liu-bei', 1);
  // bob: 3 tướng nhưng 1 thẻ đã tiêu thụ => chỉ còn 2 tướng được tính LC
  insertCard(ctx, b, 'liu-bei', 9);
  insertCard(ctx, b, 'cao-cao', 9);
  const used = insertCard(ctx, b, 'zhao-yun', 10);
  ctx.db.prepare("UPDATE user_cards SET status = 'consumed', consumed_at = 'x' WHERE id = ?").run(used);
  // carol: 5 thẻ CÙNG tướng => đội tự động chỉ gồm 1 tướng (mỗi tướng tính một lần).
  // dave cũng 1 tướng đó cùng cấp => đồng LC => đồng hạng.
  for (let i = 0; i < 5; i++) insertCard(ctx, c, 'sun-quan', 10);
  insertCard(ctx, d, 'sun-quan', 10);
  // Hồ sơ (mục 3.11): bob đổi tên hiển thị + ảnh đại diện => bảng xếp hạng trả về cả hai
  ctx.db.prepare("UPDATE users SET display_name = 'Lưu Bị', avatar = '/generals/liu-bei.jpg' WHERE id = ?").run(b);

  const lcAlice = pvpUnitLc('cao-cao', 10) + pvpUnitLc('liu-bei', 1);
  const lcBob = pvpUnitLc('liu-bei', 9) + pvpUnitLc('cao-cao', 9); // KHÔNG gồm zhao-yun (đã tiêu thụ)
  const lcCarol = pvpUnitLc('sun-quan', 10);
  const lcDave = pvpUnitLc('sun-quan', 10);

  const lb = getLeaderboard(ctx, b);
  assert.equal(lb.metric, 'lc');
  assert.equal(lb.totalRanked, 4); // alice, bob, carol, dave (admin & nocards không tính)
  const byUser = Object.fromEntries(lb.items.map((e) => [e.username, e]));
  assert.equal(byUser['alice']!.lc, lcAlice);
  assert.equal(byUser['bob']!.lc, lcBob);
  assert.equal(byUser['carol']!.lc, lcCarol);
  assert.equal(byUser['dave']!.lc, lcDave);
  // carol và dave cùng đội => đồng LC => đồng hạng
  assert.equal(byUser['carol']!.rank, byUser['dave']!.rank);
  // Hạng 1 thuộc người có LC cao nhất
  assert.equal(lb.items[0]!.rank, 1);
  assert.equal(lb.items[0]!.lc, Math.max(lcAlice, lcBob, lcCarol));
  // Tên hiển thị mặc định = tên đăng nhập, ảnh mặc định = null
  assert.equal(byUser['alice']!.displayName, 'alice');
  assert.equal(byUser['alice']!.avatar, null);
  assert.equal(lb.items.find((e) => e.isMe)?.username, 'bob');
  assert.deepEqual(lb.me, {
    id: b,
    rank: byUser['bob']!.rank,
    username: 'bob',
    displayName: 'Lưu Bị',
    avatar: '/generals/liu-bei.jpg',
    lc: lcBob,
    isMe: true,
  });

  // Admin xem: không có hạng của mình, không xuất hiện trong bảng
  const asAdmin = getLeaderboard(ctx, admin);
  assert.equal(asAdmin.me, null);
  assert.ok(!asAdmin.items.some((e) => e.username === 'boss'));

  // Người chưa có tướng: chưa xếp hạng
  const nocards = Number((ctx.db.prepare("SELECT id FROM users WHERE username='nocards'").get() as { id: number }).id);
  const none = getLeaderboard(ctx, nocards);
  assert.deepEqual(none.me, {
    id: nocards,
    rank: null,
    username: 'nocards',
    displayName: 'nocards',
    avatar: null,
    lc: 0,
    isMe: true,
  });
});

test('leaderboard: tối đa 100 người, hạng của mình ngoài top vẫn trả về', () => {
  const { ctx } = makeCtx();
  register(ctx, 'boss', 'secret123');
  // 100 người đầu xếp đội 6 tướng Lv.1 (LC cao), 5 người cuối xếp 5 tướng Lv.1 (LC thấp hơn)
  // => hai nhóm đồng hạng: nhóm mạnh hạng 1, nhóm yếu hạng 101.
  const strong = ROSTER.slice(0, 6).map((g) => g.id);
  const weak = ROSTER.slice(0, 5).map((g) => g.id);
  let last = 0;
  for (let i = 0; i < 105; i++) {
    const id = register(ctx, `p${String(i).padStart(3, '0')}`, 'secret123').userId;
    for (const g of i < 100 ? strong : weak) insertCard(ctx, id, g, 1);
    last = id;
  }
  const lb = getLeaderboard(ctx, last);
  assert.equal(lb.items.length, 100);
  assert.equal(lb.totalRanked, 105);
  assert.equal(lb.items[0]!.username, 'p000');
  assert.equal(lb.me?.rank, 101);
  assert.ok(!lb.items.some((e) => e.isMe));
});
