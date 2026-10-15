import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { openDatabase } from '../src/db.ts';
import { AppError, type GameContext } from '../src/context.ts';
import { register as rawRegister } from '../src/auth.ts';
import { approveUser } from '../src/admin.ts';
import { applyTicketDelta, readBalances } from '../src/tickets.ts';
import { draw } from '../src/gacha.ts';
import { touchDaily, getQuests, claimQuests, gameDayOf, calendarDateOf } from '../src/quests.ts';
import { DAILY_MAX, DAILY_RESET_BONUS } from '@tq/game-config';

/** 10:00 giờ Việt Nam ngày 14/10/2026 (= 03:00 UTC). */
const T0 = Date.UTC(2026, 9, 14, 3, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function makeCtx(start = T0) {
  let now = start;
  const ctx: GameContext = { db: openDatabase(':memory:'), now: () => now, rand: (max) => randomInt(max) };
  return { ctx, setNow: (t: number) => (now = t), advance: (ms: number) => (now += ms) };
}

function newUser(ctx: GameContext, name: string): number {
  const r = rawRegister(ctx, name, 'secret123');
  if (r.status !== 'approved') approveUser(ctx, r.userId);
  return r.userId;
}

let refSeq = 0;
function giveTickets(ctx: GameContext, userId: number, type: 'normal' | 'shu' | 'wei' | 'wu' | 'qun', n: number) {
  applyTicketDelta(ctx.db, userId, type, n, 'admin_grant', `test:${++refSeq}`, null, new Date(ctx.now()).toISOString());
}

function addUpgradeSuccess(ctx: GameContext, userId: number, n: number) {
  for (let i = 0; i < n; i++) {
    const card = ctx.db
      .prepare(`INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?, 'cao-cao', 2, 'x', 'x')`)
      .run(userId);
    ctx.db
      .prepare(
        `INSERT INTO upgrade_history (user_id, input_card_ids_snapshot, input_general_id, input_level, result_card_id, result_level,
           success_chance, failure_chance, outcome, failure_distribution_snapshot, idempotency_key, created_at)
         VALUES (?, '[]', 'cao-cao', 1, ?, 2, 9000, 1000, 'success', '[]', ?, ?)`,
      )
      .run(userId, Number(card.lastInsertRowid), `up-${++refSeq}`, new Date(ctx.now()).toISOString());
  }
}

const ledger = (ctx: GameContext, userId: number, reason: string) =>
  (ctx.db.prepare('SELECT COALESCE(SUM(amount_delta),0) AS s FROM ticket_transactions WHERE user_id = ? AND reason = ?').get(userId, reason) as {
    s: number;
  }).s;
const total = (b: Record<string, number>) => Object.values(b).reduce((s, n) => s + n, 0);
const RESET = total(DAILY_RESET_BONUS);

test('quests: ngày game reset lúc 05:00 giờ Việt Nam; ngày dương lịch theo 00:00 VN', () => {
  // 04:59 VN ngày 15 vẫn là ngày game 14; 05:00 VN ngày 15 là ngày game 15
  assert.equal(gameDayOf(Date.UTC(2026, 9, 14, 21, 59)), '2026-10-14');
  assert.equal(gameDayOf(Date.UTC(2026, 9, 14, 22, 0)), '2026-10-15');
  // 00:30 VN ngày 15 = 17:30 UTC ngày 14
  assert.equal(calendarDateOf(Date.UTC(2026, 9, 14, 17, 30)), '2026-10-15');
  assert.equal(gameDayOf(Date.UTC(2026, 9, 14, 17, 30)), '2026-10-14');
  assert.equal(DAILY_MAX.general, 52);
  assert.equal(DAILY_MAX.perFaction, 14);
  assert.equal(RESET, 25);
});

test('quests: thưởng reset 25 vé chỉ 1 lần mỗi ngày game, không cộng bù ngày vắng mặt', () => {
  const { ctx, advance } = makeCtx();
  const u = newUser(ctx, 'alice');
  const before = total(readBalances(ctx.db, u));
  const ev = touchDaily(ctx, u);
  assert.deepEqual(ev?.resetBonus, DAILY_RESET_BONUS);
  assert.equal(total(readBalances(ctx.db, u)), before + RESET);
  assert.equal(touchDaily(ctx, u), null); // cùng ngày => không cộng thêm
  advance(3 * DAY); // vắng 2 ngày, quay lại ngày thứ 3
  touchDaily(ctx, u);
  assert.equal(ledger(ctx, u, 'daily_reset'), 2 * RESET);
  assert.equal(getQuests(ctx, u).resetBonus.granted, true);
});

test('quests: nhiệm vụ chung — quay 30 lần hoàn thành cả quay 10; "Hoàn thành 5 nhiệm vụ" không tự tính chính nó', () => {
  const { ctx } = makeCtx();
  const u = newUser(ctx, 'bob');
  touchDaily(ctx, u);
  giveTickets(ctx, u, 'normal', 30);
  for (let i = 0; i < 3; i++) draw(ctx, u, 'normal', `d-${i}`, 10);
  let q = getQuests(ctx, u);
  const st = (id: string) => q.daily.find((d) => d.key.endsWith(`:${id}`))!;
  assert.equal(st('login').status, 'claimable');
  assert.equal(st('draw10').status, 'claimable');
  assert.equal(st('draw30').status, 'claimable');
  assert.equal(st('cards20').status, 'claimable');
  assert.equal(st('up3').status, 'progress');
  assert.equal(st('done5').progress, 4);
  assert.equal(st('done5').status, 'progress');
  addUpgradeSuccess(ctx, u, 3);
  q = getQuests(ctx, u);
  assert.equal(st('up3').status, 'claimable');
  assert.equal(st('up10').progress, 3);
  assert.equal(st('done5').status, 'claimable');

  const keys = q.daily.filter((d) => d.status === 'claimable').map((d) => d.key);
  const normalBefore = readBalances(ctx.db, u).normal;
  const r = claimQuests(ctx, u, keys);
  assert.equal(r.claimed.length, 6);
  assert.equal(readBalances(ctx.db, u).normal - normalBefore, 4 + 6 + 10 + 6 + 6 + 10);
  assert.equal(ledger(ctx, u, 'mission'), 42);
  // Nhận lại => không có gì
  assert.throws(() => claimQuests(ctx, u, keys), (e: AppError) => e.code === 'NOTHING_TO_CLAIM');
  assert.equal(getQuests(ctx, u).daily.find((d) => d.key.endsWith(':draw30'))!.status, 'claimed');
});

test('quests: nhiệm vụ phe tính đúng loại vé/phe và thưởng vé đúng phe', () => {
  const { ctx } = makeCtx();
  const u = newUser(ctx, 'carol');
  touchDaily(ctx, u);
  giveTickets(ctx, u, 'shu', 15);
  draw(ctx, u, 'shu', 's1', 10);
  for (let i = 0; i < 5; i++) draw(ctx, u, 'shu', `s2-${i}`, 1);
  const q = getQuests(ctx, u);
  assert.deepEqual(
    q.faction.shu.map((i) => [i.key.split(':').pop(), i.status, i.reward.pool]),
    [
      ['fdraw5', 'claimable', 'shu'],
      ['fdraw15', 'claimable', 'shu'],
      ['fcards10', 'claimable', 'shu'], // 15 thẻ Thục từ vé Thục
    ],
  );
  assert.ok(q.faction.wei.every((i) => i.status === 'progress' && i.progress === 0));
  const shuBefore = readBalances(ctx.db, u).shu;
  claimQuests(ctx, u, q.faction.shu.map((i) => i.key));
  assert.equal(readBalances(ctx.db, u).shu - shuBefore, 14);
});

test('quests: qua ngày mới tự nhận nhiệm vụ ngày cũ đã đạt mà chưa bấm nhận', () => {
  const { ctx, advance } = makeCtx();
  const u = newUser(ctx, 'dave');
  touchDaily(ctx, u);
  giveTickets(ctx, u, 'normal', 10);
  draw(ctx, u, 'normal', 'x', 10);
  const day1 = getQuests(ctx, u).gameDay;
  claimQuests(ctx, u, [`d:${day1}:login`]); // đã tự bấm nhận nhiệm vụ đăng nhập
  advance(DAY);
  const ev = touchDaily(ctx, u)!;
  assert.deepEqual(ev.autoClaimed.map((a) => a.key), [`d:${day1}:draw10`]); // 10 thẻ < 20 nên chưa xong "Thu thập thẻ"
  assert.equal(ledger(ctx, u, 'mission'), 4 + 6);
  // Ngày mới: nhiệm vụ reset (chỉ còn đăng nhập)
  const q = getQuests(ctx, u);
  assert.notEqual(q.gameDay, day1);
  assert.equal(q.daily.find((d) => d.key.endsWith(':draw10'))!.progress, 0);
  const autoRows = (ctx.db.prepare('SELECT COUNT(*) AS n FROM reward_claims WHERE user_id = ? AND auto = 1 AND reward_key LIKE ?').get(u, `d:${day1}:%`) as {
    n: number;
  }).n;
  assert.equal(autoRows, 1);
});

test('quests: thành tựu sở hữu thẻ — mỗi mốc nhận 1 lần, bỏ thẻ ra rồi đưa lại không nhận lần nữa', () => {
  const { ctx } = makeCtx();
  const u = newUser(ctx, 'erin');
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) {
    ids.push(
      Number(
        ctx.db.prepare(`INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?, 'liu-bei', 3, 'x', 'x')`).run(u)
          .lastInsertRowid,
      ),
    );
  }
  const g = getQuests(ctx, u).achievements.find((a) => a.id === 'own-3')!;
  const claimable = g.items.filter((i) => i.status === 'claimable');
  assert.deepEqual(claimable.map((i) => i.reward.count), [5, 5, 5, 5, 8]); // Lv.3: mốc 1–4 = 5 vé, mốc 5 = 8 vé
  claimQuests(ctx, u, claimable.map((i) => i.key));
  // Dùng 1 thẻ (tiêu thụ) rồi có lại thẻ thứ 5 => mốc 5 đã nhận, không nhận lại
  ctx.db.prepare(`UPDATE user_cards SET status = 'consumed', consumed_at = 'x' WHERE id = ?`).run(ids[0]!);
  ctx.db.prepare(`INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?, 'liu-bei', 3, 'x', 'x')`).run(u);
  const again = getQuests(ctx, u).achievements.find((a) => a.id === 'own-3')!;
  assert.equal(again.items.filter((i) => i.status === 'claimable').length, 0);
  assert.equal(ledger(ctx, u, 'achievement'), 28);
});

test('quests: thành tựu chiêu mộ/tổng thẻ tính cả lịch sử cũ; sưu tầm đếm tướng khác nhau', () => {
  const { ctx } = makeCtx();
  const u = newUser(ctx, 'fay');
  giveTickets(ctx, u, 'normal', 50);
  for (let i = 0; i < 5; i++) draw(ctx, u, 'normal', `h-${i}`, 10); // "lịch sử cũ": chưa từng mở nhiệm vụ
  const q = getQuests(ctx, u);
  const draws = q.achievements.find((a) => a.id === 'draws')!;
  assert.equal(draws.progress, 50);
  assert.deepEqual(draws.items.filter((i) => i.status === 'claimable').map((i) => i.target), [10, 50]);
  const cards = q.achievements.find((a) => a.id === 'cards')!;
  assert.deepEqual(cards.items.filter((i) => i.status === 'claimable').map((i) => i.target), [10]);
  const distinct = (ctx.db.prepare('SELECT COUNT(DISTINCT general_id) AS n FROM gacha_history WHERE user_id = ?').get(u) as { n: number }).n;
  assert.equal(q.achievements.find((a) => a.id === 'collect')!.progress, distinct);
  const perFaction = q.achievements.filter((a) => a.id.startsWith('fcollect-')).reduce((s, a) => s + a.progress, 0);
  assert.equal(perFaction, distinct);
});

test('quests: điểm danh theo ngày trong tháng; sang tháng mới tự nhận ngày chưa nhận', () => {
  // 30/10/2026 10:00 VN
  const { ctx, setNow } = makeCtx(Date.UTC(2026, 9, 30, 3, 0));
  const u = newUser(ctx, 'gus');
  touchDaily(ctx, u);
  let q = getQuests(ctx, u);
  assert.equal(q.login.month, '2026-10');
  assert.equal(q.login.days.length, 31);
  const d30 = q.login.days[29]!;
  assert.deepEqual([d30.date, d30.reward, d30.status], ['2026-10-30', 39, 'claimable']);
  assert.equal(q.login.days[28]!.status, 'missed');
  assert.equal(q.login.days[30]!.status, 'future');
  // Không bấm nhận; sang tháng 11
  setNow(Date.UTC(2026, 10, 2, 3, 0));
  const ev = touchDaily(ctx, u)!;
  assert.ok(ev.autoClaimed.some((a) => a.key === 'login:2026-10-30' && a.count === 39));
  q = getQuests(ctx, u);
  assert.equal(q.login.month, '2026-11');
  assert.equal(q.login.days.length, 30);
  assert.equal(q.login.days[1]!.reward, 11);
  assert.equal(q.login.days[1]!.status, 'claimable');
});
