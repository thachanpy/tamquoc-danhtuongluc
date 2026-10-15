import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, type GameContext } from '../src/context.ts';
import { openDatabase } from '../src/db.ts';
import { buildServer } from '../src/server.ts';
import { setRequireApproval } from '../src/managers/settings.manager.ts';
import { simulatePvp, type PvpSideInput } from '../src/managers/pvp.engine.ts';
import { getCombatStats } from '../src/managers/pvp.manager.ts';
import {
  BPS_SCALE,
  PVP_BUFF_MAX_LAYERS,
  PVP_BUFF_ROUNDS,
  PVP_BURN_BPS,
  PVP_BURN_CRIT_MUL_BPS,
  PVP_DEBUFF_ROUNDS,
  PVP_CRIT_DAMAGE_BPS,
  PVP_MAX_ROUNDS,
  PVP_PASSIVE_EFFECT,
  PVP_SKILL_DEF,
  ROSTER,
  pvpBaseHp,
  pvpProfile,
  pvpStyleBonus,
  type RandomInt,
} from '@tq/game-config';
import type { PvpEventDto, PvpSkill } from '@tq/shared';

/**
 * Test Đấu trường PvP (mục 6.7 — PVP.md):
 * - Engine tất định theo seed: chỉ số nền, buff vị trí, thứ tự theo tổng LC + vị trí 1→6, chí mạng, choáng, buff, kết thúc.
 * - HTTP qua Fastify inject: tổng quan, lưu đội, xem đối thủ, khiêu chiến, lịch sử, xem lại trận.
 *
 * SKILLS.md là bản chốt cuối: mỗi tướng có bộ hiệu ứng tường minh trong `pvpProfile(id).def`.
 */

// ===================== Engine =====================

/** RNG tất định (LCG) để cùng seed cho ra cùng kết quả. */
function seeded(seed: number): RandomInt {
  let s = seed >>> 0;
  return (max: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % max;
  };
}

/** Luôn trả 0 → luôn chí mạng, luôn choáng, luôn phản kích (giá trị < mọi tỉ lệ > 0). */
const always0: RandomInt = () => 0;
/** Luôn trả max-1 → không bao giờ chí mạng/choáng/phản kích. */
const never: RandomInt = (max) => max - 1;

/** Định nghĩa kỹ năng tường minh của tướng (SKILLS.md). */
const skillDef = (id: string) => pvpProfile(id).def;

/** Kỹ năng có phát buff tăng sức mạnh cho ĐỒNG MINH (không tính tự buff) hay không. */
const hasAllyBuffOf = (id: string) => skillDef(id).buffs.some((e) => e.scope !== 'none' && e.scope !== 'self');

/** Tướng "ôn hoà": không gây sát thương, không áp suy yếu/thiêu đốt, không tự thiêu — hai tướng như vậy đánh nhau sẽ hoà. */
const isPeaceful = (id: string) => {
  const d = skillDef(id);
  const db = d.debuff;
  const weakenOrBurn = db.damageDownBps > 0 || db.hpDownBps > 0 || db.critDownBps > 0 || db.critDamageDownBps > 0 || db.burnBps > 0;
  return d.damageBps === 0 && !weakenOrBurn && !d.selfBurn;
};

const findGeneral = (pred: (id: string) => boolean): string => {
  const id = ROSTER.find((g) => pred(g.id))?.id;
  assert.ok(id, 'roster phải có tướng thoả điều kiện test');
  return id;
};

type Input = { slot: number; generalId: string; level: number };
const one = (side: 'a' | 'b', units: Input[]): PvpSideInput => ({ side, units });

/** Tập id tướng có kỹ năng không gây sát thương (không thể kết liễu ai). */
const peacefulIds = () => ROSTER.filter((g) => isPeaceful(g.id)).map((g) => g.id);

test('engine: cùng seed cho ra cùng trận (tất định — mục 15)', () => {
  const sides = () => [one('a', [{ slot: 1, generalId: ROSTER[0]!.id, level: 5 }]), one('b', [{ slot: 1, generalId: ROSTER[1]!.id, level: 5 }])];
  const a = simulatePvp(sides(), seeded(2026));
  const b = simulatePvp(sides(), seeded(2026));
  assert.deepEqual(a, b);
  assert.equal(a.events[a.events.length - 1]!.t, 'end');
});

test('engine: idx theo slot (A=0–5, B=6–11) và hàng trước +10% HP (mục 2.2, 2.3)', () => {
  const g = ROSTER[0]!.id;
  const res = simulatePvp([one('a', [{ slot: 1, generalId: g, level: 5 }]), one('b', [{ slot: 4, generalId: g, level: 5 }])], never);
  // Cùng tướng, cùng cấp: slot 1 (hàng trước) +10% HP; slot 4 (hàng sau) không có buff HP.
  const front = res.units.find((u) => u.idx === 0)!;
  const back = res.units.find((u) => u.idx === 9)!;
  assert.equal(front.slot, 1);
  assert.equal(back.slot, 4);
  assert.ok(front.maxHp > back.maxHp, 'hàng trước phải nhiều HP hơn hàng sau');
});

test('engine: hàng sau +10% damage so với hàng trước (mục 2.3)', () => {
  // Tào Phi: đánh đơn, không tự buff sát thương → so sánh sát thương thuần theo vị trí.
  const attacker = 'cao-pi';
  const target = 'da-qiao';
  const run = (slot: number) => simulatePvp([one('a', [{ slot, generalId: attacker, level: 6 }]), one('b', [{ slot: 1, generalId: target, level: 1 }])], never);
  const dmgOf = (r: ReturnType<typeof simulatePvp>) => {
    const hit = r.events.find((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && e.from === r.units[0]!.idx);
    return hit?.amount ?? 0;
  };
  assert.ok(dmgOf(run(5)) > dmgOf(run(2)), 'tướng hàng sau gây nhiều sát thương hơn tướng hàng trước');
});

test('engine: hai đội ra đòn luân phiên theo vị trí, bên tổng LC cao hơn đi trước (mục 5.1)', () => {
  // Tướng đánh đơn mục tiêu + cấp 1 để các lượt trong vòng 1 không bị nhiễu do AoE/hồi máu/ai đó gục.
  const singles = ROSTER.filter((g) => skillDef(g.id).targeting === 'single' && skillDef(g.id).damageBps > 0);
  const pick = (i: number) => ({ slot: (i % 2) + 1, generalId: singles[i]!.id, level: 1 });
  const res = simulatePvp([one('a', [pick(0), pick(1)]), one('b', [pick(2), pick(3)])], never);
  // Bên đi trước = bên có TỔNG LC cao hơn; bằng nhau thì A (bên khiêu chiến).
  const lcOf = (side: 'a' | 'b') => res.units.reduce((s, u) => s + (u.side === side ? u.lc : 0), 0);
  const first: 'a' | 'b' = lcOf('b') > lcOf('a') ? 'b' : 'a';
  const second: 'a' | 'b' = first === 'a' ? 'b' : 'a';
  // Lấy các lượt hành động của vòng 1 theo đúng thứ tự engine sinh ra.
  const round1: string[] = [];
  let round = 0;
  for (const e of res.events) {
    if (e.t === 'round') round = e.round;
    if (round !== 1) continue;
    if (e.t !== 'act' && e.t !== 'skip') continue;
    const u = res.units.find((x) => x.idx === e.idx)!;
    round1.push(`${u.side}${u.slot}`);
  }
  // Kỳ vọng: A1, B1, A2, B2 (A là bên đi trước) — hai đội luân phiên nhau theo vị trí.
  assert.deepEqual(round1.slice(0, 4), [`${first}1`, `${second}1`, `${first}2`, `${second}2`]);
});

test('engine: vị trí 1 của bên đi trước đã gục thì bên đó vẫn mở màn vòng bằng vị trí kế tiếp (mục 5.1)', () => {
  // A1 cấp 1 (chết sớm) + A2 cấp 10; B1/B2 là tướng Phòng thủ để tổng LC của A cao hơn.
  const res = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: 'cao-pi', level: 1 },
        { slot: 2, generalId: 'xiahou-dun', level: 10 },
      ]),
      one('b', [
        { slot: 1, generalId: 'cao-hong', level: 10 },
        { slot: 2, generalId: 'xu-chu', level: 1 },
      ]),
    ],
    never,
  );
  const lc = (side: 'a' | 'b') => res.units.reduce((s, u) => s + (u.side === side ? u.lc : 0), 0);
  assert.ok(lc('a') > lc('b'), 'A phải là bên đi trước (tổng LC cao hơn)');
  const a1 = res.units.find((u) => u.side === 'a' && u.slot === 1)!;
  // Gom các lượt hành động của những vòng SAU vòng mà A1 gục.
  let round = 0;
  let deadRound = 0;
  const acts: { round: number; key: string }[] = [];
  for (const e of res.events) {
    if (e.t === 'round') round = e.round;
    if (e.t === 'down' && e.idx === a1.idx) deadRound = round;
    if ((e.t === 'act' || e.t === 'skip') && deadRound > 0 && round > deadRound) {
      const u = res.units.find((x) => x.idx === e.idx)!;
      acts.push({ round, key: `${u.side}${u.slot}` });
    }
  }
  assert.ok(acts.length > 0, 'phải có vòng diễn ra sau khi A1 gục');
  const nextRound = acts[0]!.round;
  // Bên A giữ quyền mở màn: A2 đánh trước rồi mới tới B1 (không để B1 chen lên vì A1 đã mất).
  assert.deepEqual(
    acts.filter((x) => x.round === nextRound).slice(0, 2).map((x) => x.key),
    ['a2', 'b1'],
  );
});

test('engine: chí mạng theo RNG; crit damage = đòn thường × 1.5 (mục 6.3, 7)', () => {
  // Lữ Mông: đánh đơn, không tự buff/hút máu/đối kháng → sát thương thuần.
  const attacker = 'lu-meng';
  const target = 'da-qiao';
  const sides = () => [one('a', [{ slot: 1, generalId: attacker, level: 4 }]), one('b', [{ slot: 1, generalId: target, level: 4 }])];

  const plainHits = simulatePvp(sides(), never).events.filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage');
  assert.ok(plainHits.length > 0, 'phải có ít nhất một đòn đánh');
  assert.ok(plainHits.every((e) => !e.crit));

  const critHits = simulatePvp(sides(), always0).events.filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage');
  assert.ok(critHits.length > 0);
  assert.ok(critHits.every((e) => e.crit));
  const plain = plainHits[0]!;
  const crit = critHits.find((e) => e.from === plain.from && e.idx === plain.idx)!;
  const mul = (BPS_SCALE + PVP_CRIT_DAMAGE_BPS) / BPS_SCALE;
  assert.equal(crit.amount, Math.round((plain.amount * mul)));
});

test('engine: hồi máu cũng chí mạng; crit heal = hồi thường × 1.5 (mục 6.3, 6.4)', () => {
  // Đại Kiều: hồi máu toàn đội (solo nên hồi chính mình); Lữ Mông đánh đơn để gây thương tích.
  // (Không dùng Cao Phi vì debuff giảm chí mạng của hắn sẽ kéo chí mạng người hồi về 0.)
  const healer = findGeneral((id) => skillDef(id).targeting === 'all_allies' && skillDef(id).healBps > 0 && skillDef(id).buffs.length === 0);
  const foe = 'lu-meng';
  const sides = () => [one('a', [{ slot: 1, generalId: healer, level: 3 }]), one('b', [{ slot: 1, generalId: foe, level: 3 }])];
  const healsOf = (r: ReturnType<typeof simulatePvp>) => r.events.filter((e): e is Extract<PvpEventDto, { t: 'heal' }> => e.t === 'heal');

  const plain = healsOf(simulatePvp(sides(), never));
  const crit = healsOf(simulatePvp(sides(), always0));
  assert.ok(plain.length > 0 && crit.length > 0, 'trận phải phát sinh sự kiện hồi máu');
  assert.ok(plain.every((e) => !e.crit), 'RNG luôn trả max → không chí mạng');
  assert.ok(crit.every((e) => e.crit), 'RNG luôn trả 0 → luôn chí mạng');
  const p = plain[0]!;
  const c = crit.find((e) => e.from === p.from && e.idx === p.idx)!;
  const mul = (BPS_SCALE + PVP_CRIT_DAMAGE_BPS) / BPS_SCALE;
  assert.equal(c.amount, Math.round(p.amount * mul));
});

test('engine: hồi máu chọn đúng mục tiêu — hàng trước / hàng sau / 1 người thấp máu nhất (mục 6.4)', () => {
  const firstAct = (res: ReturnType<typeof simulatePvp>, idx: number) =>
    res.events.find((e): e is Extract<PvpEventDto, { t: 'act' }> => e.t === 'act' && e.idx === idx)!;

  // Hàng trước: tướng hồi (slot 5) chỉ nhắm 2 đồng minh hàng trước (slot 1,2 → idx 0,1).
  const front = findGeneral((id) => skillDef(id).targeting === 'front_allies' && skillDef(id).healBps > 0);
  const fF = findGeneral((id) => id !== front && isPeaceful(id));
  const rF = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: fF, level: 3 },
        { slot: 2, generalId: fF, level: 3 },
        { slot: 5, generalId: front, level: 3 },
        { slot: 6, generalId: fF, level: 3 },
      ]),
      one('b', [{ slot: 1, generalId: fF, level: 3 }]),
    ],
    never,
  );
  assert.deepEqual(firstAct(rF, 4).targets, [0, 1]);

  // Hàng sau: tướng hồi (slot 2) chỉ nhắm đồng minh hàng sau (slot 4,5 → idx 3,4).
  const back = findGeneral((id) => skillDef(id).targeting === 'back_allies' && skillDef(id).healBps > 0);
  const fB = findGeneral((id) => id !== back && isPeaceful(id));
  const rB = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: fB, level: 3 },
        { slot: 2, generalId: back, level: 3 },
        { slot: 4, generalId: fB, level: 3 },
        { slot: 5, generalId: fB, level: 3 },
      ]),
      one('b', [{ slot: 1, generalId: fB, level: 3 }]),
    ],
    never,
  );
  assert.deepEqual(firstAct(rB, 1).targets, [3, 4]);

  // 1 người thấp máu nhất: địch không gây sát thương nên mọi đồng minh đầy máu → chọn slot nhỏ nhất (idx 0).
  const low = findGeneral((id) => skillDef(id).targeting === 'lowest_ally' && skillDef(id).healBps > 0);
  const fL = findGeneral((id) => id !== low && isPeaceful(id));
  const rL = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: fL, level: 3 },
        { slot: 2, generalId: low, level: 3 },
        { slot: 5, generalId: fL, level: 3 },
      ]),
      one('b', [{ slot: 1, generalId: fL, level: 3 }]),
    ],
    never,
  );
  assert.deepEqual(firstAct(rL, 1).targets, [0]);
});

test('engine: choáng làm mục tiêu bỏ lượt (mục 5.3, 8)', () => {
  // Hạ Hầu Đôn (choáng đơn) đánh Tào Phi; cả hai cùng LC nên A đi trước → nạn nhân bị choáng ngay vòng 1.
  const stunner = findGeneral((id) => skillDef(id).stun !== 'none' && skillDef(id).targeting === 'single');
  const victim = findGeneral((id) => id !== stunner && skillDef(id).stun === 'none' && skillDef(id).counter.damageBps === 0 && pvpProfile(id).style === 'attack');
  const res = simulatePvp([one('a', [{ slot: 1, generalId: stunner, level: 10 }]), one('b', [{ slot: 1, generalId: victim, level: 10 }])], always0);
  const victimIdx = 6;
  assert.ok(res.events.some((e) => e.t === 'stun' && e.idx === victimIdx), 'mục tiêu phải bị choáng');
  assert.ok(res.events.some((e) => e.t === 'skip' && e.idx === victimIdx), 'mục tiêu bị choáng phải bỏ lượt');
});

test('engine: choáng kết thúc khi tướng gây choáng ra skill ở lượt kế (mục 6)', () => {
  // Trương Hợp: choáng đơn (hàng sau), không buff/hút máu/tự hồi/giải choáng — mỗi lượt chỉ tốn 2 lượt RNG (chí mạng, choáng).
  const stunner = 'zhang-he';
  // Nạn nhân: phong cách Phòng thủ (tổng LC của đội B thấp hơn → A đi trước), cấp 10 để sống qua các lượt.
  const victim = 'cao-hong';
  // Hai lần gọi RNG đầu trả 0 (chí mạng + choáng ở vòng 1), các lần sau trả max-1 (không chí mạng/choáng nữa).
  let calls = 0;
  const stunOnce: RandomInt = (max) => (calls++ < 2 ? 0 : max - 1);
  const res = simulatePvp([one('a', [{ slot: 1, generalId: stunner, level: 1 }]), one('b', [{ slot: 4, generalId: victim, level: 10 }])], stunOnce);
  const victimIdx = 9; // B đứng slot 4 (hàng sau) → idx 9

  const stunEvents = res.events.flatMap((e) => (e.t === 'stun' && e.idx === victimIdx ? [e] : []));
  assert.equal(stunEvents.length, 1, 'chỉ choáng một lần trong tình huống này');
  assert.equal(stunEvents[0]!.byIdx, 0, 'ghi nhận đúng tướng gây choáng');
  // Nguồn gây choáng (A1) ra skill ở lượt kế (đầu vòng 2) → choáng tan; nạn nhân chỉ bỏ đúng 1 lượt.
  const skips = res.events.flatMap((e) => (e.t === 'skip' && e.idx === victimIdx ? [e] : []));
  assert.equal(skips.length, 1, 'chỉ bỏ đúng một lượt rồi tự hết khi nguồn gây choáng ra skill lượt kế');
  const firstActAfter = res.events.findIndex((e) => e.t === 'act' && e.idx === victimIdx);
  const round2 = res.events.findIndex((e) => e.t === 'round' && e.round === 2);
  assert.ok(round2 > 0 && firstActAfter > round2, 'sang vòng 2 nạn nhân đánh lại bình thường');
});

test('engine: kỹ năng buff cộng HP tối đa + sát thương cho đồng minh còn sống (mục 11.2)', () => {
  const buffer = 'liu-bei'; // Buff toàn đội: +10% sát thương, +10% HP tối đa
  const ally = 'cao-pi';
  const res = simulatePvp([one('a', [{ slot: 1, generalId: buffer, level: 6 }, { slot: 2, generalId: ally, level: 6 }]), one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }])], never);
  const buffEvs = res.events.filter((e): e is Extract<PvpEventDto, { t: 'buff' }> => e.t === 'buff');
  const buffed = buffEvs.map((e) => e.idx);
  assert.ok(buffed.includes(0) && buffed.includes(1), 'cả hai đồng minh đều nhận buff');
  // Sự kiện buff mang lượng tăng cụ thể để client hiện ở Diễn biến chi tiết (mục 6.7).
  const b = skillDef(buffer).buffs[0]!.buff;
  const u0 = res.units.find((x) => x.idx === buffEvs[0]!.idx)!;
  assert.equal(buffEvs[0]!.damageFlat, Math.round((u0.damage * b.damageBps) / BPS_SCALE));
  assert.equal(buffEvs[0]!.hpFlat, Math.round((u0.maxHp * b.hpBps) / BPS_SCALE));
  assert.equal(buffEvs[0]!.critBps, b.critBps);
  assert.equal(buffEvs[0]!.crit, false, 'không chí mạng khi RNG luôn trả max-1');
  assert.equal(buffEvs[0]!.expiresRound, 1 + b.rounds - 1, 'lớp buff sống đúng PVP_BUFF_ROUNDS lượt');
  assert.equal(buffEvs[0]!.maxLayers, PVP_BUFF_MAX_LAYERS);
});

test('engine: chí mạng nhân hệ số %HP và %sát thương của buff — một roll chung cho cả lớp (mục 11.2)', () => {
  const buffer = 'liu-bei';
  const b = skillDef(buffer).buffs[0]!.buff;
  const res = simulatePvp([one('a', [{ slot: 1, generalId: buffer, level: 6 }]), one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }])], always0);
  const ev = res.events.find((e): e is Extract<PvpEventDto, { t: 'buff' }> => e.t === 'buff');
  assert.ok(ev, 'phải có ít nhất một lớp buff');
  const mul = (BPS_SCALE + PVP_CRIT_DAMAGE_BPS) / BPS_SCALE;
  const u0 = res.units.find((x) => x.idx === ev!.idx)!;
  assert.equal(ev!.crit, true, 'RNG luôn 0 nên lớp buff chí mạng');
  assert.equal(ev!.damageFlat, Math.round((u0.damage * Math.round(b.damageBps * mul)) / BPS_SCALE));
  assert.equal(ev!.hpFlat, Math.round((u0.maxHp * Math.round(b.hpBps * mul)) / BPS_SCALE));
});

test('engine: buff chỉ số cộng dồn, giữ tối đa PVP_BUFF_MAX_LAYERS lớp (mục 11.2)', () => {
  const buffer = 'liu-bei';
  const ally = 'cao-pi';
  const res = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: buffer, level: 6 },
        { slot: 2, generalId: ally, level: 6 },
      ]),
      one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }]),
    ],
    never,
  );
  const dmg = res.events.filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && e.from === 1).map((e) => e.amount);
  assert.ok(dmg.length >= 5, 'đồng minh phải ra đòn ít nhất 5 lượt');
  // Mỗi lượt thêm một lớp buff nên sát thương tăng ở các vòng đầu...
  assert.ok(dmg[1]! > dmg[0]!, 'lớp buff thứ hai phải tăng sát thương');
  assert.ok(dmg[2]! > dmg[1]!, 'lớp buff thứ ba phải tăng sát thương');
  // ...nhưng mỗi lớp chỉ sống PVP_BUFF_ROUNDS (3) lượt nên từ vòng 4 sát thương ổn định (không chồng vô hạn).
  assert.equal(dmg[3]!, dmg[2]!, 'số lớp hiệu lực ổn định nên sát thương không tăng mãi');
  const buffOfAlly = res.events.filter((e) => e.t === 'buff' && e.idx === 1).length;
  assert.ok(buffOfAlly >= 3, 'đồng minh nhận lớp buff mới qua các lượt');
});

test('engine: Lục Tốn đánh hàng DỌC (row) chứ không phải hàng ngang (mục 13.2)', () => {
  assert.equal(skillDef('lu-xun').targeting, 'row');
});

test('engine: hàng mục tiêu trống thì quay sang hàng còn lại (mục 2.4)', () => {
  // Thái Sử Từ đánh một tướng hàng SAU; địch chỉ có hàng TRƯỚC → vẫn phải đánh được sang hàng trước.
  const backSniper = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'taishi-ci', level: 3 }]), one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }])],
    never,
  );
  assert.ok(backSniper.events.some((e) => e.t === 'damage' && e.from === 0), 'hàng sau địch trống → đánh sang hàng trước');
  // Viên Thuật giảm máu tối đa HÀNG TRƯỚC; địch chỉ có hàng SAU → vẫn phải áp được hiệu ứng sang hàng sau.
  const frontDebuff = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'yuan-shu', level: 3 }]), one('b', [{ slot: 4, generalId: 'da-qiao', level: 10 }])],
    never,
  );
  assert.ok(frontDebuff.events.some((e) => e.t === 'debuff' && e.hpFlat > 0), 'hàng trước địch trống → áp hiệu ứng sang hàng sau');
});

test('engine: Thiêu đốt vẫn ăn chí mạng (mục 8)', () => {
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'zhu-huan', level: 5 }]), one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }])],
    always0,
  );
  const burns = res.events.filter((e): e is Extract<PvpEventDto, { t: 'burn' }> => e.t === 'burn');
  assert.ok(burns.length > 0, 'phải có sát thương thiêu đốt');
  assert.ok(burns.every((e) => e.crit), 'RNG luôn 0 → thiêu đốt chí mạng');
});

test('engine: Chu Du tăng thêm 30% tỷ lệ chí mạng và ST chí mạng cho riêng đòn Thiêu đốt (mục 8)', () => {
  // always0 → mọi đòn thiêu đốt đều chí mạng, nên so sánh được hệ số ST chí mạng giữa hai tướng.
  const firstBurn = (id: string) => {
    const res = simulatePvp(
      [one('a', [{ slot: 1, generalId: id, level: 5 }]), one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }])],
      always0,
    );
    const e = res.events.find((x): x is Extract<PvpEventDto, { t: 'burn' }> => x.t === 'burn');
    assert.ok(e, `${id} phải gây thiêu đốt`);
    // Lớp thiêu đốt = ST hiệu dụng × PVP_BURN_BPS; sát thương thiêu đốt = lớp đó × (1 + ST chí mạng × hệ số riêng).
    const flat = Math.round((res.units[0]!.damage * PVP_BURN_BPS) / BPS_SCALE);
    return { amount: e.amount, flat };
  };
  const normal = firstBurn('zhu-huan'); // Chu Hoàn: không có hệ số riêng cho thiêu đốt.
  const zhouYu = firstBurn('zhou-yu'); // Chu Du: ×1.3 tỷ lệ chí mạng & ST chí mạng cho thiêu đốt.
  assert.equal(
    normal.amount,
    Math.round((normal.flat * (BPS_SCALE + PVP_CRIT_DAMAGE_BPS)) / BPS_SCALE),
    'thiêu đốt thường dùng ST chí mạng nền 150%',
  );
  const burnCritDamageBps = Math.round((PVP_CRIT_DAMAGE_BPS * PVP_BURN_CRIT_MUL_BPS) / BPS_SCALE);
  assert.equal(
    zhouYu.amount,
    Math.round((zhouYu.flat * (BPS_SCALE + burnCritDamageBps)) / BPS_SCALE),
    'thiêu đốt của Chu Du mạnh hơn nhờ ×1.3 ST chí mạng',
  );
});

test('engine: Lục Tốn hút máu từ cả sát thương Thiêu đốt và giảm HP tối đa địch (mục 8, 13)', () => {
  const res = simulatePvp(
    [one('a', [{ slot: 4, generalId: 'lu-xun', level: 10 }]), one('b', [{ slot: 4, generalId: 'zhu-huan', level: 10 }])],
    always0,
  );
  const lx = res.units.find((u) => u.generalId === 'lu-xun')!.idx;
  const ev = res.events;
  // Sát thương thiêu đốt lên địch, kèm giảm HP tối đa.
  assert.ok(ev.some((e) => e.t === 'burn'), 'phải có sát thương thiêu đốt');
  assert.ok(ev.some((e) => e.t === 'debuff' && e.hpFlat > 0), 'Lục Tốn phải giảm HP tối đa của địch');
  // Hút máu từ thiêu đốt: ngay sau đòn thiêu đốt đầu tiên, Lục Tốn được hồi máu TRƯỚC lượt hành động kế tiếp của mình.
  const burnAt = ev.findIndex((e) => e.t === 'burn');
  const healAt = ev.findIndex((e, i) => i > burnAt && e.t === 'heal' && e.from === lx);
  const nextActAt = ev.findIndex((e, i) => i > burnAt && e.t === 'act' && e.idx === lx);
  assert.ok(healAt >= 0, 'Lục Tốn phải hồi máu từ sát thương thiêu đốt');
  assert.ok(nextActAt < 0 || healAt < nextActAt, 'hồi máu thiêu đốt phải xảy ra ở đầu vòng, trước lượt hành động');
});

test('engine: một bên bị xóa sổ thì kết thúc ngay (wipe — mục 14)', () => {
  const strong = [1, 2, 3, 4, 5, 6].map((slot) => ({ slot, generalId: ROSTER[slot]!.id, level: 10 }));
  const res = simulatePvp([one('a', strong), one('b', [{ slot: 1, generalId: ROSTER[40]!.id, level: 1 }])], seeded(9));
  assert.equal(res.winner, 'a');
  assert.equal(res.reason, 'wipe');
  const end = res.events[res.events.length - 1]!;
  assert.equal(end.t, 'end');
  if (end.t === 'end') assert.equal(end.winner, 'a');
});

test('engine: hết PVP_MAX_ROUNDS mà chưa phân thắng bại thì hai đội hoà (timeout — mục 14)', () => {
  const peaceful = peacefulIds();
  assert.ok(peaceful.length >= 2, 'roster phải có ít nhất 2 tướng kỹ năng không gây sát thương');
  const res = simulatePvp([one('a', [{ slot: 1, generalId: peaceful[0]!, level: 3 }]), one('b', [{ slot: 1, generalId: peaceful[1]!, level: 3 }])], seeded(11));
  assert.equal(res.rounds, PVP_MAX_ROUNDS);
  assert.equal(res.reason, 'timeout');
  assert.equal(res.winner, 'draw');
});

test('engine: tướng có kỹ năng giải choáng miễn nhiễm choáng (mục 9)', () => {
  const stunner = findGeneral((id) => skillDef(id).stun === 'single' && skillDef(id).targeting === 'single');
  const target = (id: string) => {
    const res = simulatePvp([one('a', [{ slot: 1, generalId: stunner, level: 10 }]), one('b', [{ slot: 1, generalId: id, level: 10 }])], always0);
    const idx = res.units.find((u) => u.generalId === id)!.idx;
    return res.events.some((e) => e.t === 'stun' && e.idx === idx);
  };
  // always0 → luôn trúng choáng nếu mục tiêu không miễn nhiễm.
  const immune = findGeneral((id) => skillDef(id).cleanse);
  assert.equal(target(immune), false, 'tướng giải choáng không bao giờ bị choáng');
  const normal = findGeneral((id) => !skillDef(id).cleanse);
  assert.equal(target(normal), true, 'đối thủ không miễn nhiễm vẫn bị choáng');
});

test('engine: mọi nhóm kỹ năng của roster đều có định nghĩa trong PVP_SKILL_DEF', () => {
  const skills = new Set<PvpSkill>(ROSTER.map((g) => pvpProfile(g.id).skill));
  for (const s of skills) assert.ok(PVP_SKILL_DEF[s], `thiếu định nghĩa kỹ năng ${s}`);
});

test('engine: buff %HP chỉ phát khi tới lượt, không cộng sẵn ở ảnh chụp đầu trận (mục 11.2)', () => {
  const id = findGeneral((gid) => skillDef(gid).buffs.some((e) => e.scope !== 'none' && e.buff.hpBps > 0));
  const profile = pvpProfile(id);
  const p = PVP_PASSIVE_EFFECT[profile.passive];
  // Solo ở hàng sau: không có buff HP theo hàng, nhưng có chỉ số theo phong cách của chính tướng.
  const style = pvpStyleBonus(profile.style, profile.style === 'support' ? 1 : 0);
  const hpBps = (p.stat === 'maxHp' ? p.bps : 0) + style.hpBps;
  const res = simulatePvp([one('a', [{ slot: 4, generalId: id, level: 4 }])], never);
  assert.equal(res.units[0]!.maxHp, Math.round(pvpBaseHp(4) * (1 + hpBps / BPS_SCALE)), 'ảnh chụp đầu trận chỉ gồm chỉ số tĩnh');
  // Snapshot mang DTO các KÊNH buff để client mô tả LƯỢNG tăng khi tướng thi triển kỹ năng (mục 6.7).
  const entries = res.units[0]!.buffs ?? [];
  const b = skillDef(id).buffs.find((e) => e.buff.hpBps > 0)!.buff;
  assert.ok(entries.some((e) => e.buff.hpBps === b.hpBps), 'ảnh chụp mang kênh buff tăng HP');
  assert.ok(entries.every((e) => e.buff.rounds === PVP_BUFF_ROUNDS));
  assert.ok(entries.every((e) => e.buff.maxLayers === PVP_BUFF_MAX_LAYERS));
});

test('engine: ảnh chụp đầu trận mang tên kỹ năng thật của từng tướng (mục 6.7)', () => {
  const res = simulatePvp([one('a', [{ slot: 1, generalId: ROSTER[0]!.id, level: 3 }]), one('b', [{ slot: 1, generalId: ROSTER[1]!.id, level: 3 }])], never);
  for (const u of res.units) assert.equal(u.skillName, pvpProfile(u.generalId).skillName);
  assert.ok(res.units[0]!.skillName.length > 0, 'tên kỹ năng không được rỗng');
});

test('engine: tướng tự hồi máu theo % HP tối đa mỗi lượt ra đòn (mục 6.4)', () => {
  // Đổng Trác: tự hồi 20% HP tối đa, không cộng trần HP.
  const id = findGeneral((gid) => skillDef(gid).selfHealBps > 0 && skillDef(gid).buffs.length === 0);
  const def = skillDef(id);
  assert.ok(def.selfHealBps > 0);
  assert.equal(def.buffs.length, 0, 'kỹ năng này không tăng trần HP');
  const foe = 'cao-pi';
  const res = simulatePvp([one('a', [{ slot: 1, generalId: id, level: 10 }]), one('b', [{ slot: 1, generalId: foe, level: 10 }])], never);
  const u = res.units.find((x) => x.idx === 0)!;
  assert.ok(!u.buffs?.length, 'không tăng HP tối đa');
  const heals = res.events.filter((e): e is Extract<PvpEventDto, { t: 'heal' }> => e.t === 'heal' && e.from === 0 && e.idx === 0);
  assert.ok(heals.length > 0, 'phải tự hồi máu mỗi lượt ra đòn khi đã mất máu');
  const expected = Math.round((u.maxHp * def.selfHealBps) / BPS_SCALE);
  assert.ok(heals.every((e) => !e.crit && e.amount <= expected), 'lượng hồi không vượt hệ số tự hồi');
});

test('engine: hút máu — tướng hồi bản thân theo % sát thương gây ra (mục 6.5)', () => {
  const lsId = 'yue-jin';
  const foe = 'cao-pi';
  const res = simulatePvp([one('a', [{ slot: 1, generalId: lsId, level: 10 }]), one('b', [{ slot: 1, generalId: foe, level: 10 }])], never);
  const profile = pvpProfile(lsId);
  const u = res.units.find((x) => x.idx === 0)!;
  assert.equal(u.lifestealBps, 10 * profile.lifestealPerLevelBps);
  // Hút máu phát ra ngay sau đòn đánh trong cùng một lượt hành động (RNG không chí mạng).
  const hi = res.events.findIndex((e) => e.t === 'heal' && e.from === 0 && e.idx === 0);
  assert.ok(hi > 0, 'tướng hút máu phải tự hồi khi gây sát thương và đã mất máu');
  const hit = res.events[hi - 1]!;
  assert.equal(hit.t, 'damage');
  const heal = res.events[hi] as Extract<PvpEventDto, { t: 'heal' }>;
  assert.equal(heal.crit, false);
  // Đánh dấu là hút máu để client phát đúng âm thanh (khác hồi máu bằng kỹ năng).
  assert.equal(heal.lifesteal, true);
  const dealt = hit.t === 'damage' ? hit.amount : 0;
  assert.equal(heal.amount, Math.round((dealt * u.lifestealBps) / BPS_SCALE));
});

test('engine: hồ sơ tướng khớp hệ số chốt trong SKILLS.md', () => {
  // Quan Vũ: đánh đơn 320%, tự buff +30 điểm chí mạng và +30% ST chí mạng.
  const gy = pvpProfile('guan-yu');
  assert.equal(gy.def.damageBps, 32000);
  assert.equal(gy.def.buffs[0]!.buff.critBps, 3000);
  assert.equal(gy.def.buffs[0]!.buff.critDamageBps, 3000);
  assert.equal(gy.def.buffs[0]!.scope, 'self');
  // Triệu Vân: hàng ngang 200%, tự buff chí mạng 20% + giảm ST nhận 20%, hút máu 3%/cấp.
  const zy = pvpProfile('zhao-yun');
  assert.equal(zy.def.damageBps, 20000);
  assert.equal(zy.def.targeting, 'lane');
  assert.equal(zy.lifestealPerLevelBps, 300);
  assert.equal(zy.def.selfHealBps, 0);
  assert.equal(zy.def.buffs[0]!.buff.critBps, 2000);
  assert.equal(zy.def.buffs[0]!.buff.takenDownBps, 2000);
  assert.equal(zy.def.counter.damageBps, 0, 'Triệu Vân không còn phản kích');
  // Tôn Sách: AoE 123.5% (đã +30%), tự buff ST 20%, hút máu 2.5%/cấp, phản kích đơn.
  const sc = pvpProfile('sun-ce');
  assert.equal(sc.def.damageBps, 12350);
  assert.equal(sc.def.targeting, 'all_enemies');
  assert.equal(sc.lifestealPerLevelBps, 250);
  assert.equal(sc.def.selfHealBps, 0);
  assert.equal(sc.def.counter.damageBps, 5000);
  // Mã Siêu: đánh đơn 280%, hút máu 10%/cấp (max 100%), tự tăng 10% HP tối đa.
  const mc = pvpProfile('ma-chao');
  assert.equal(mc.def.damageBps, 28000);
  assert.equal(mc.def.targeting, 'single');
  assert.equal(mc.lifestealPerLevelBps, 1000);
  assert.equal(mc.def.buffs[0]!.buff.hpBps, 1000);
  // Lữ Mông: đánh đơn 290% + tăng 10% HP tối đa toàn đội (không còn xóa buff địch).
  const lm = pvpProfile('lu-meng');
  assert.equal(lm.def.damageBps, 29000);
  assert.equal(lm.def.buffs[0]!.buff.hpBps, 1000);
  assert.equal(lm.def.buffs[0]!.scope, 'all_allies');
  assert.equal(lm.def.dispel, false);
  // Tào Tháo: AoE 110%, 100% xóa 1 buff địch, buff ST toàn đội 20%.
  const cc = pvpProfile('cao-cao');
  assert.equal(cc.def.damageBps, 11000);
  assert.equal(cc.def.dispelChanceBps, BPS_SCALE);
  assert.equal(cc.def.buffs[0]!.buff.damageBps, 2000);
  // Trương Liêu: hàng ngang 225%, giảm ST địch 10%, hút máu 3%/cấp (max 30%), phản kích đơn (50% ST, không tự buff ST).
  const zl = pvpProfile('zhang-liao');
  assert.equal(zl.def.damageBps, 22500);
  assert.equal(zl.def.targeting, 'lane');
  assert.equal(zl.def.debuff.damageDownBps, 1000);
  assert.equal(zl.def.debuff.rounds, PVP_DEBUFF_ROUNDS, 'debuff không ghi số lượt mặc định 3 lượt');
  assert.equal(PVP_DEBUFF_ROUNDS, 3);
  assert.equal(zl.lifestealPerLevelBps, 300);
  assert.equal(zl.def.buffs.length, 0);
  assert.equal(zl.def.counter.scope, 'single');
  assert.equal(zl.def.counter.damageBps, 5000);
  // Lữ Bố: AoE 127%, tự buff chí mạng 20% + 20% ST chí mạng, hút máu 3%/cấp, phản kích đơn — KHÔNG còn choáng.
  const lb = pvpProfile('lu-bu');
  assert.equal(lb.def.damageBps, 12700);
  assert.equal(lb.def.targeting, 'all_enemies');
  assert.equal(lb.def.stun, 'none');
  assert.equal(lb.def.stunPerLevelBps, 0);
  assert.equal(lb.lifestealPerLevelBps, 300);
  assert.equal(lb.def.counter.scope, 'single');
  // Nhạc Tiến: đánh đơn 290%, xóa buff địch.
  const yj = pvpProfile('yue-jin');
  assert.equal(yj.def.damageBps, 29000);
  assert.ok(yj.def.dispel);
  // Tân Hiến Anh: AoE 75% + giải choáng & thiêu đốt.
  const xx = pvpProfile('xin-xianying');
  assert.equal(xx.def.damageBps, 7500);
  assert.ok(xx.def.cleanse);
  // Gia Cát Quả: giảm ST nhận toàn đội 10% + giải choáng (không hồi máu).
  const zg = pvpProfile('zhuge-guo');
  assert.equal(zg.def.healBps, 0);
  assert.equal(zg.def.buffs[0]!.buff.takenDownBps, 1000);
  assert.equal(zg.def.buffs[0]!.scope, 'all_allies');
  assert.ok(zg.def.cleanse);
  // Trần Cung: buff ST 15% + chí mạng 15% toàn đội + giải choáng (không xóa buff địch).
  const cg = pvpProfile('chen-gong');
  assert.equal(cg.def.buffs[0]!.buff.damageBps, 1500);
  assert.equal(cg.def.buffs[0]!.buff.critBps, 1500);
  assert.ok(cg.def.cleanse);
  assert.equal(cg.def.dispel, false);
  // Điêu Thuyền: đánh đơn 120%, choáng 8%/cấp, kèm giảm sát thương địch 20%.
  const dc = pvpProfile('diao-chan');
  assert.equal(dc.def.damageBps, 12000);
  assert.equal(dc.def.stunPerLevelBps, 800);
  assert.equal(dc.def.debuff.damageDownBps, 2000);
  // Quách Gia: AoE 85% + giảm ST địch 10% + tăng 15% HP tối đa toàn đội.
  const gj = pvpProfile('guo-jia');
  assert.equal(gj.def.damageBps, 8500);
  assert.equal(gj.def.dispel, false);
  assert.equal(gj.def.buffs[0]!.buff.hpBps, 1500);
  assert.equal(gj.def.buffs[0]!.scope, 'all_allies');
  // Phản kích: Điển Vi đánh trả đơn 50% ST cơ bản, tỉ lệ 3%/cấp.
  const dw = pvpProfile('dian-wei');
  assert.equal(dw.def.counter.damageBps, 5000);
  assert.equal(dw.def.counter.perLevelBps, 300);
  assert.equal(dw.def.counter.scope, 'single');
  // Hoả công: Chu Du thiêu đốt 50% ST, 4 lượt, cộng dồn 3 lớp; AoE 117% (đã +30%).
  const zyu = pvpProfile('zhou-yu');
  assert.equal(zyu.def.damageBps, 11700);
  assert.equal(zyu.def.debuff.burnBps, 5000);
  assert.equal(zyu.def.debuff.burnRounds, 4);
  assert.equal(zyu.def.debuff.burnMaxLayers, 3);
  // Chu Du: riêng đòn thiêu đốt được ×1.3 tỷ lệ chí mạng VÀ ST chí mạng.
  assert.equal(zyu.def.burnCritMulBps, PVP_BURN_CRIT_MUL_BPS);
  // Lục Tốn: hút máu cả từ thiêu đốt + giảm HP tối đa địch.
  const lx = pvpProfile('lu-xun');
  assert.equal(lx.def.burnLifesteal, true);
  assert.equal(lx.def.debuff.hpDownBps, 1000);
  assert.ok(lx.lifestealPerLevelBps > 0, 'Lục Tốn phải có hút máu theo cấp');
  // Thiêu đốt thường (Chu Hoàn): 4 lượt.
  const zh = pvpProfile('zhu-huan');
  assert.equal(zh.def.debuff.burnBps, 5000);
  assert.equal(zh.def.debuff.burnRounds, 4);
  // Bảng AoE: hệ số chốt trong SKILLS.md (nhóm thuần buff đồng đội như Quách Gia/Bàng Thống/Hoàng Nguyệt Anh vẫn gây sát thương AoE).
  const aoes: [string, number][] = [
    ['cao-cao', 11000],
    ['sima-yi', 12500],
    ['xin-xianying', 7500],
    ['zhuge-liang', 10400],
    ['sun-ce', 12350],
    ['zhou-yu', 11700],
    ['lu-bu', 12700],
    ['zhang-jiao', 11500],
    ['meng-huo', 10400],
    ['guo-jia', 8500],
    ['pang-tong', 8500],
    ['huang-yueying', 7500],
  ];
  for (const [id, bps] of aoes) {
    const d = skillDef(id);
    assert.equal(d.targeting, 'all_enemies', `${id} phải đánh toàn bộ địch`);
    assert.equal(d.damageBps, bps, `${id}: hệ số AoE chốt`);
  }
});

// ===================== HTTP =====================

type App = Awaited<ReturnType<typeof buildServer>>;

async function setup() {
  process.env.LOG_LEVEL = 'silent';
  const ctx = createContext(openDatabase(':memory:'), { devTopup: true, gift: true });
  setRequireApproval(ctx, false);
  const app = await buildServer(ctx);
  // Tài khoản đầu tiên tự thành admin (chỉ quản trị); 'tester' là người chơi.
  const boss = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'boss', password: 'secret123' } });
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'tester', password: 'secret123' } });
  setRequireApproval(ctx, true);
  return {
    ctx,
    app,
    adminAuth: { authorization: `Bearer ${boss.json().token as string}` },
    auth: { authorization: `Bearer ${reg.json().token as string}` },
    testerId: reg.json().userId as number,
  };
}

/** Đăng ký + admin duyệt + đăng nhập; trả header auth cùng userId. */
async function regApproved(app: App, adminAuth: Record<string, string>, username: string) {
  const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } });
  await app.inject({ method: 'POST', url: `/api/admin/users/${reg.json().userId as number}/approve`, headers: adminAuth });
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'secret123' } });
  return { auth: { authorization: `Bearer ${login.json().token as string}` }, userId: reg.json().userId as number };
}

/** Cấp thẻ trực tiếp vào DB (bỏ qua gacha) để dựng đội hình cho test. */
function addCard(ctx: GameContext, userId: number, generalId: string, level: number): void {
  ctx.db
    .prepare('INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(userId, generalId, level, 'x', 'x');
}

test('HTTP: chưa đăng nhập => 401; admin không chơi game => 403', async () => {
  const { app, adminAuth } = await setup();
  assert.equal((await app.inject({ method: 'GET', url: '/api/pvp' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'GET', url: '/api/pvp', headers: adminAuth })).statusCode, 403);
  await app.close();
});

test('HTTP: tổng quan tự xếp đội gợi ý từ thẻ mạnh nhất khi chưa lưu (mục 6.7)', async () => {
  const { ctx, app, auth, testerId } = await setup();
  addCard(ctx, testerId, ROSTER[0]!.id, 3);
  addCard(ctx, testerId, ROSTER[1]!.id, 5);
  const r = await app.inject({ method: 'GET', url: '/api/pvp', headers: auth });
  assert.equal(r.statusCode, 200);
  const ov = r.json();
  assert.equal(ov.saved, false);
  assert.equal(ov.team.units.length, 2);
  assert.equal(ov.me.id, testerId);
  assert.deepEqual([ov.wins, ov.losses, ov.draws], [0, 0, 0]);
  assert.ok(ov.powerByLevel[5] > 0);
  assert.equal(ov.maxRounds, PVP_MAX_ROUNDS);
  // Bảng chọn tướng hiện chỉ số + kỹ năng chi tiết ngay: chi tiết chỉ có ở tướng ĐANG SỞ HỮU, ở cấp cao nhất.
  assert.deepEqual(Object.keys(ov.ownedCombat).sort(), [ROSTER[0]!.id, ROSTER[1]!.id].sort());
  const c0 = ov.ownedCombat[ROSTER[0]!.id];
  assert.equal(c0.level, 3);
  assert.equal(c0.skillName, pvpProfile(ROSTER[0]!.id).skillName);
  assert.equal(c0.self.maxHp, getCombatStats(ROSTER[0]!.id, 3).self.maxHp);
  assert.equal(ov.ownedCombat[ROSTER[1]!.id].level, 5);
  await app.close();
});

test('HTTP: /api/generals trả phong cách chiến đấu của mọi tướng (mục 6.7)', async () => {
  const { app } = await setup();
  const r = await app.inject({ method: 'GET', url: '/api/generals' });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.items.length, ROSTER.length);
  // Client hiện nhãn Tấn công/Phòng thủ/Hỗ trợ trên mọi thẻ tướng từ bảng này.
  assert.deepEqual(Object.keys(body.styles).sort(), ROSTER.map((g) => g.id).sort());
  for (const g of ROSTER) assert.equal(body.styles[g.id], pvpProfile(g.id).style);
  // Kèm kỹ năng từng tướng để client hiện kỹ năng khi chọn tướng vào đội (mục 6.7).
  assert.deepEqual(Object.keys(body.skills).sort(), ROSTER.map((g) => g.id).sort());
  for (const g of ROSTER) assert.equal(body.skills[g.id], pvpProfile(g.id).skill);
  // Tên chiêu thật để client hiện thay cho nhãn chung (mục 6.7).
  assert.deepEqual(Object.keys(body.skillNames).sort(), ROSTER.map((g) => g.id).sort());
  for (const g of ROSTER) assert.equal(body.skillNames[g.id], pvpProfile(g.id).skillName);
  await app.close();
});

test('HTTP: chi tiết chiến đấu của một tướng — chỉ số, kỹ năng, nội tại (mục 6.7)', async () => {
  const { app, auth } = await setup();
  const g = ROSTER[0]!;
  const r = await app.inject({ method: 'GET', url: `/api/pvp/generals/${g.id}/combat?level=5`, headers: auth });
  assert.equal(r.statusCode, 200);
  const c = r.json();
  const profile = pvpProfile(g.id);
  assert.equal(c.generalId, g.id);
  assert.equal(c.level, 5);
  assert.equal(c.style, profile.style);
  assert.equal(c.skill, profile.skill);
  assert.equal(c.skillName, profile.skillName);
  assert.equal(c.passive, profile.passive);
  assert.ok(c.base.maxHp > 0 && c.base.damage > 0);
  // HP nền luôn gấp 10 lần sát thương nền (cân bằng mục 5.1: máu 1000 ↔ sát thương 100).
  assert.equal(c.base.maxHp, 10 * c.base.damage);
  assert.ok(c.self.maxHp > 0 && c.self.damage > 0 && c.self.lc > 0);
  // Hút máu ở cấp hiện tại (0 với tướng không hút máu) — client hiện dòng "Hút máu" khi > 0.
  assert.equal(c.self.lifestealBps, 5 * profile.lifestealPerLevelBps);
  // ST chí mạng nền = 150% (mục 7) — buff/debuff kỹ năng điều chỉnh quanh mốc này khi vào trận.
  assert.equal(c.self.critDamageBps, PVP_CRIT_DAMAGE_BPS);
  assert.equal(c.bpsScale, BPS_SCALE);
  await app.close();
});

test('HTTP: chi tiết chiến đấu — tướng có buff toàn đội mang đúng chỉ số (mục 11.2)', async () => {
  const { app, auth } = await setup();
  const id = findGeneral((gid) => {
    const d = skillDef(gid);
    return d.buffs.some((e) => e.scope === 'all_allies' && e.buff.hpBps > 0 && e.buff.damageBps > 0);
  });
  const r = await app.inject({ method: 'GET', url: `/api/pvp/generals/${id}/combat?level=5`, headers: auth });
  assert.equal(r.statusCode, 200);
  const c = r.json();
  const b = skillDef(id).buffs.find((e) => e.buff.hpBps > 0 && e.buff.damageBps > 0)!.buff;
  const entry = c.buffs.find((e: { scope: string; buff: { hpBps: number } }) => e.scope === 'all_allies' && e.buff.hpBps === b.hpBps);
  assert.ok(entry, 'chi tiết mang kênh buff toàn đội đúng chỉ số');
  assert.equal(entry.buff.damageBps, b.damageBps);
  assert.equal(entry.buff.rounds, PVP_BUFF_ROUNDS);
  assert.equal(entry.buff.maxLayers, PVP_BUFF_MAX_LAYERS);
  // Chỉ số của riêng tướng chỉ gồm nội tại (buff đồng minh + styleBonus phát dần khi vào trận, không cộng sẵn).
  const hpBps = c.passiveEffect.stat === 'maxHp' ? c.passiveEffect.bps : 0;
  assert.equal(c.self.maxHp, Math.round((c.base.maxHp * (c.bpsScale + hpBps)) / c.bpsScale));
  await app.close();
});

test('HTTP: chi tiết chiến đấu — chưa đăng nhập 401, tướng không tồn tại 404', async () => {
  const { app, auth } = await setup();
  assert.equal((await app.inject({ method: 'GET', url: `/api/pvp/generals/${ROSTER[0]!.id}/combat?level=1` })).statusCode, 401);
  const missing = await app.inject({ method: 'GET', url: '/api/pvp/generals/khong-ton-tai/combat?level=1', headers: auth });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'GENERAL_NOT_FOUND');
  await app.close();
});

test('HTTP: lưu đội hình — xác thực slot/tướng/quyền sở hữu', async () => {
  const { ctx, app, auth, testerId } = await setup();
  addCard(ctx, testerId, ROSTER[0]!.id, 3);
  addCard(ctx, testerId, ROSTER[1]!.id, 5);

  const ok = await app.inject({
    method: 'POST',
    url: '/api/pvp/team',
    headers: auth,
    payload: { units: [{ slot: 4, generalId: ROSTER[1]!.id, level: 5 }, { slot: 1, generalId: ROSTER[0]!.id, level: 3 }] },
  });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().units.map((u: { slot: number }) => u.slot), [1, 4]);
  assert.ok(ok.json().power > 0);
  assert.equal((await app.inject({ method: 'GET', url: '/api/pvp', headers: auth })).json().saved, true);

  const notOwned = await app.inject({ method: 'POST', url: '/api/pvp/team', headers: auth, payload: { units: [{ slot: 1, generalId: ROSTER[0]!.id, level: 9 }] } });
  assert.equal(notOwned.statusCode, 400);
  assert.equal(notOwned.json().error.code, 'CARD_NOT_OWNED');

  const dupGeneral = await app.inject({
    method: 'POST',
    url: '/api/pvp/team',
    headers: auth,
    payload: { units: [{ slot: 1, generalId: ROSTER[0]!.id, level: 3 }, { slot: 2, generalId: ROSTER[0]!.id, level: 3 }] },
  });
  assert.equal(dupGeneral.json().error.code, 'DUPLICATE_GENERAL');

  const dupSlot = await app.inject({
    method: 'POST',
    url: '/api/pvp/team',
    headers: auth,
    payload: { units: [{ slot: 1, generalId: ROSTER[0]!.id, level: 3 }, { slot: 1, generalId: ROSTER[1]!.id, level: 5 }] },
  });
  assert.equal(dupSlot.json().error.code, 'DUPLICATE_SLOT');

  const badGeneral = await app.inject({ method: 'POST', url: '/api/pvp/team', headers: auth, payload: { units: [{ slot: 1, generalId: 'khong-ton-tai', level: 3 }] } });
  assert.equal(badGeneral.json().error.code, 'INVALID_GENERAL');
  await app.close();
});

test('HTTP: xem đối thủ — chặn tự khiêu chiến và đối thủ không tồn tại', async () => {
  const { ctx, app, auth, adminAuth, testerId } = await setup();
  addCard(ctx, testerId, ROSTER[0]!.id, 3);
  const rival = await regApproved(app, adminAuth, 'rival');
  addCard(ctx, rival.userId, ROSTER[2]!.id, 4);

  const self = await app.inject({ method: 'GET', url: `/api/pvp/opponent/${testerId}`, headers: auth });
  assert.equal(self.statusCode, 400);
  assert.equal(self.json().error.code, 'SELF_CHALLENGE');

  const missing = await app.inject({ method: 'GET', url: '/api/pvp/opponent/999999', headers: auth });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error.code, 'OPPONENT_NOT_FOUND');

  const view = await app.inject({ method: 'GET', url: `/api/pvp/opponent/${rival.userId}`, headers: auth });
  assert.equal(view.statusCode, 200);
  assert.equal(view.json().opponent.id, rival.userId);
  assert.equal(view.json().team.units.length, 1);
  await app.close();
});

test('HTTP: khiêu chiến mô phỏng trọn trận, lưu lịch sử và xem lại được (mục 15)', async () => {
  const { ctx, app, auth, adminAuth, testerId } = await setup();
  addCard(ctx, testerId, ROSTER[0]!.id, 6);
  addCard(ctx, testerId, ROSTER[1]!.id, 2);
  const rival = await regApproved(app, adminAuth, 'rival');
  addCard(ctx, rival.userId, ROSTER[2]!.id, 6);

  const fight = await app.inject({ method: 'POST', url: '/api/pvp/challenge', headers: auth, payload: { opponentId: rival.userId } });
  assert.equal(fight.statusCode, 200);
  const battle = fight.json();
  assert.equal(battle.mySide, 'a');
  assert.ok(['win', 'loss', 'draw'].includes(battle.result));
  assert.equal(battle.units.length, 3); // 2 tướng mình + 1 tướng đối thủ
  assert.equal(battle.events[battle.events.length - 1].t, 'end');
  // Ảnh chụp đầu trận: mọi tướng còn sống, hp = maxHp (client dựng bàn rồi áp sự kiện).
  assert.ok(battle.units.every((u: { hp: number; maxHp: number }) => u.hp === u.maxHp));

  const hist = (await app.inject({ method: 'GET', url: '/api/pvp/battles?pageSize=10', headers: auth })).json();
  assert.equal(hist.total, 1);
  assert.equal(hist.items[0].role, 'attack');
  assert.equal(hist.items[0].opponent.id, rival.userId);
  assert.equal(hist.items[0].id, battle.id);

  // Cả hai bên xem lại được trận; người ngoài thì không.
  const mine = await app.inject({ method: 'GET', url: `/api/pvp/battles/${battle.id}`, headers: auth });
  assert.equal(mine.statusCode, 200);
  const theirs = await app.inject({ method: 'GET', url: `/api/pvp/battles/${battle.id}`, headers: rival.auth });
  assert.equal(theirs.statusCode, 200);
  assert.equal(theirs.json().mySide, 'b');

  const third = await regApproved(app, adminAuth, 'third');
  const outsider = await app.inject({ method: 'GET', url: `/api/pvp/battles/${battle.id}`, headers: third.auth });
  assert.equal(outsider.statusCode, 404);

  // Thành tích cập nhật đối xứng theo góc nhìn mỗi bên.
  const ovMe = (await app.inject({ method: 'GET', url: '/api/pvp', headers: auth })).json();
  const ovFoe = (await app.inject({ method: 'GET', url: '/api/pvp', headers: rival.auth })).json();
  assert.equal(ovMe.wins + ovMe.losses + ovMe.draws, 1);
  assert.equal(ovFoe.wins + ovFoe.losses + ovFoe.draws, 1);
  if (battle.result === 'win') {
    assert.equal(ovMe.wins, 1);
    assert.equal(ovFoe.losses, 1);
  } else if (battle.result === 'loss') {
    assert.equal(ovMe.losses, 1);
    assert.equal(ovFoe.wins, 1);
  } else {
    assert.equal(ovMe.draws, 1);
    assert.equal(ovFoe.draws, 1);
  }
  await app.close();
});

test('HTTP: khiêu chiến khi thiếu tướng => TEAM_EMPTY / OPPONENT_NO_TEAM', async () => {
  const { ctx, app, auth, adminAuth, testerId } = await setup();
  addCard(ctx, testerId, ROSTER[0]!.id, 3);
  const empty = await regApproved(app, adminAuth, 'empty');

  const oppEmpty = await app.inject({ method: 'POST', url: '/api/pvp/challenge', headers: auth, payload: { opponentId: empty.userId } });
  assert.equal(oppEmpty.statusCode, 400);
  assert.equal(oppEmpty.json().error.code, 'OPPONENT_NO_TEAM');

  const meEmpty = await app.inject({ method: 'POST', url: '/api/pvp/challenge', headers: empty.auth, payload: { opponentId: testerId } });
  assert.equal(meEmpty.statusCode, 400);
  assert.equal(meEmpty.json().error.code, 'TEAM_EMPTY');
  await app.close();
});
