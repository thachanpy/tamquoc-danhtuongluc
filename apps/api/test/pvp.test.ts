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
  PVP_MAX_ROUNDS,
  PVP_PASSIVE_EFFECT,
  PVP_SKILL_DEF,
  PVP_SKILL_BUFF_CRIT_POINTS_BPS,
  PVP_SKILL_BUFF_DAMAGE_BPS,
  PVP_STUN_ROUNDS,
  ROSTER,
  pvpBaseDamage,
  pvpBaseHp,
  pvpProfile,
  type RandomInt,
} from '@tq/game-config';
import type { PvpEventDto, PvpSkill } from '@tq/shared';

/**
 * Test Đấu trường PvP (mục 6.7 — PVP.md):
 * - Engine tất định theo seed: chỉ số nền, buff vị trí, thứ tự theo tổng LC + vị trí 1→6, chí mạng, choáng, buff, kết thúc.
 * - HTTP qua Fastify inject: tổng quan, lưu đội, xem đối thủ, khiêu chiến, lịch sử, xem lại trận.
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

/** Luôn trả 0 → luôn chí mạng, luôn choáng (giá trị < mọi tỉ lệ > 0). */
const always0: RandomInt = () => 0;
/** Luôn trả max-1 → không bao giờ chí mạng/choáng. */
const never: RandomInt = (max) => max - 1;

const skillDef = (id: string) => PVP_SKILL_DEF[pvpProfile(id).skill];
const findGeneral = (pred: (id: string) => boolean): string => {
  const id = ROSTER.find((g) => pred(g.id))?.id;
  assert.ok(id, 'roster phải có tướng thoả điều kiện test');
  return id;
};

type Input = { slot: number; generalId: string; level: number };
const one = (side: 'a' | 'b', units: Input[]): PvpSideInput => ({ side, units });

/** Tập id tướng có kỹ năng không gây sát thương (không thể kết liễu ai). */
const peacefulIds = () => ROSTER.filter((g) => skillDef(g.id).damageBps === 0 && !skillDef(g.id).buff).map((g) => g.id);

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
  const g = findGeneral((id) => skillDef(id).damageBps > 0);
  const target = ROSTER.find((x) => x.id !== g)!.id;
  const run = (slot: number) => simulatePvp([one('a', [{ slot, generalId: g, level: 6 }]), one('b', [{ slot: 1, generalId: target, level: 1 }])], never);
  const dmgOf = (r: ReturnType<typeof simulatePvp>) =>
    (r.events.find((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && e.from === r.units[0]!.idx)?.amount ?? 0);
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
  // Tướng đánh đơn mục tiêu để dễ dựng cảnh: A1 cấp 1 chết sớm còn A2 cấp 10; B1 cấp 10, B2 cấp 1.
  const singles = ROSTER.filter((g) => skillDef(g.id).targeting === 'single' && skillDef(g.id).damageBps > 0);
  const res = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: singles[0]!.id, level: 1 },
        { slot: 2, generalId: singles[1]!.id, level: 10 },
      ]),
      one('b', [
        { slot: 1, generalId: singles[2]!.id, level: 10 },
        { slot: 2, generalId: singles[3]!.id, level: 1 },
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
  const attacker = findGeneral((id) => skillDef(id).damageBps > 0);
  const target = ROSTER.find((g) => g.id !== attacker)!.id;
  const sides = () => [one('a', [{ slot: 1, generalId: attacker, level: 4 }]), one('b', [{ slot: 1, generalId: target, level: 4 }])];

  const plainHits = simulatePvp(sides(), never).events.filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage');
  assert.ok(plainHits.length > 0, 'phải có ít nhất một đòn đánh');
  assert.ok(plainHits.every((e) => !e.crit));

  const critHits = simulatePvp(sides(), always0).events.filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage');
  assert.ok(critHits.every((e) => e.crit));
  const plain = plainHits[0]!;
  const crit = critHits.find((e) => e.from === plain.from && e.idx === plain.idx)!;
  assert.equal(crit.amount, Math.round((plain.amount * 15000) / 10000));
});

test('engine: hồi máu cũng chí mạng; crit heal = hồi thường × 1.5 (mục 6.3, 6.4)', () => {
  // Tướng hồi máu toàn đội, solo nên hồi cho chính mình; địch đánh đơn mục tiêu để gây thương tích.
  const healer = findGeneral((id) => pvpProfile(id).skill === 'ALL_ALLIES_HEAL');
  const foe = findGeneral((id) => id !== healer && skillDef(id).targeting === 'single' && skillDef(id).damageBps > 0);
  const sides = () => [one('a', [{ slot: 1, generalId: healer, level: 3 }]), one('b', [{ slot: 1, generalId: foe, level: 3 }])];
  const healsOf = (r: ReturnType<typeof simulatePvp>) => r.events.filter((e): e is Extract<PvpEventDto, { t: 'heal' }> => e.t === 'heal');

  const plain = healsOf(simulatePvp(sides(), never));
  const crit = healsOf(simulatePvp(sides(), always0));
  assert.ok(plain.length > 0 && crit.length > 0, 'trận phải phát sinh sự kiện hồi máu');
  assert.ok(plain.every((e) => !e.crit), 'RNG luôn trả max → không chí mạng');
  assert.ok(crit.every((e) => e.crit), 'RNG luôn trả 0 → luôn chí mạng');
  const p = plain[0]!;
  const c = crit.find((e) => e.from === p.from && e.idx === p.idx)!;
  assert.equal(c.amount, Math.round((p.amount * 15000) / 10000));
});

test('engine: hồi máu chọn đúng mục tiêu — hàng trước / hàng sau / 1 người thấp máu nhất (mục 6.4)', () => {
  const isPeaceful = (id: string) => skillDef(id).damageBps === 0 && !skillDef(id).buff;
  const firstAct = (res: ReturnType<typeof simulatePvp>, idx: number) =>
    res.events.find((e): e is Extract<PvpEventDto, { t: 'act' }> => e.t === 'act' && e.idx === idx)!;

  // Hàng trước: tướng hồi (slot 5) chỉ nhắm 2 đồng minh hàng trước (slot 1,2 → idx 0,1).
  const front = findGeneral((id) => pvpProfile(id).skill === 'FRONT_ROW_HEAL');
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
  const back = findGeneral((id) => pvpProfile(id).skill === 'BACK_ROW_HEAL');
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
  const low = findGeneral((id) => pvpProfile(id).skill === 'ALLY_LOWEST_HEAL');
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
  // Tướng choáng thuộc phong cách Phòng thủ (LC thấp nhất); nạn nhân chọn Tấn công (LC cao hơn)
  // để chắc chắn hành động trước — khi đó lượt bị choáng rơi vào vòng 2.
  const stunner = findGeneral((id) => skillDef(id).stun !== 'none');
  const victim = findGeneral((id) => id !== stunner && pvpProfile(id).style === 'attack' && skillDef(id).stun === 'none');
  const res = simulatePvp([one('a', [{ slot: 1, generalId: stunner, level: 10 }]), one('b', [{ slot: 1, generalId: victim, level: 10 }])], always0);
  const victimIdx = 6;
  assert.ok(res.events.some((e) => e.t === 'stun' && e.idx === victimIdx), 'mục tiêu phải bị choáng');
  assert.ok(res.events.some((e) => e.t === 'skip' && e.idx === victimIdx), 'mục tiêu bị choáng phải bỏ lượt');
});

test('engine: choáng chỉ kéo dài PVP_STUN_ROUNDS lượt rồi tự hết (mục 5.3, 8)', () => {
  // Tướng choáng "thuần": chỉ 1 lượt roll chí mạng + 1 lượt roll choáng mỗi lần ra đòn
  // (không hút máu, không hồi máu, không giải choáng) để điều khiển RNG theo số lần gọi.
  const stunner = findGeneral((id) => {
    const d = skillDef(id);
    return d.stun === 'single' && d.damageBps > 0 && d.healBps === 0 && d.selfHealBps === 0 && !d.cleanse && !d.buff && pvpProfile(id).lifestealPerLevelBps === 0;
  });
  // Nạn nhân: phong cách Phòng thủ để tổng LC của đội B thấp hơn đội A (bên A đánh trước),
  // cấp 10 để đủ máu sống qua 2 lượt bị choáng và còn lượt đánh ở vòng 3.
  const victim = findGeneral((id) => id !== stunner && skillDef(id).stun === 'none' && pvpProfile(id).style === 'defense');
  // Hai lần gọi RNG đầu trả 0 (chí mạng + choáng ở vòng 1), các lần sau trả max-1 (không chí mạng/choáng nữa).
  let calls = 0;
  const stunOnce: RandomInt = (max) => (calls++ < 2 ? 0 : max - 1);
  const res = simulatePvp([one('a', [{ slot: 1, generalId: stunner, level: 1 }]), one('b', [{ slot: 1, generalId: victim, level: 10 }])], stunOnce);
  const victimIdx = 6;

  const stunEvents = res.events.flatMap((e) => (e.t === 'stun' && e.idx === victimIdx ? [e] : []));
  assert.equal(stunEvents.length, 1, 'chỉ choáng một lần trong tình huống này');
  assert.equal(stunEvents[0]!.untilRound, 1 + PVP_STUN_ROUNDS - 1, 'choáng gây ở vòng 1 sống hết vòng 2');
  // Bỏ lượt đúng 2 vòng (vòng 1 và vòng 2) rồi vòng 3 đánh lại bình thường.
  const skips = res.events.flatMap((e) => (e.t === 'skip' && e.idx === victimIdx ? [e] : []));
  assert.equal(skips.length, PVP_STUN_ROUNDS, 'bị choáng thì chỉ bỏ lượt đúng PVP_STUN_ROUNDS lượt');
  const firstActAfter = res.events.findIndex((e) => e.t === 'act' && e.idx === victimIdx);
  const thirdRound = res.events.findIndex((e) => e.t === 'round' && e.round === 3);
  assert.ok(thirdRound > 0 && firstActAfter > thirdRound, 'đầu vòng 3 đã hết choáng nên đánh lại được');
});


test('engine: kỹ năng buff cộng sát thương/chí mạng cho đồng minh còn sống (mục 11.2)', () => {
  const buffer = findGeneral((id) => skillDef(id).buff);
  const ally = findGeneral((id) => id !== buffer && skillDef(id).damageBps === 0 && !skillDef(id).buff);
  const foe = findGeneral((id) => id !== buffer && id !== ally && skillDef(id).damageBps === 0 && !skillDef(id).buff);
  const res = simulatePvp([one('a', [{ slot: 1, generalId: buffer, level: 6 }, { slot: 2, generalId: ally, level: 6 }]), one('b', [{ slot: 1, generalId: foe, level: 6 }])], seeded(3));
  const buffEvs = res.events.filter((e): e is Extract<PvpEventDto, { t: 'buff' }> => e.t === 'buff');
  const buffed = buffEvs.map((e) => e.idx);
  assert.ok(buffed.includes(0) && buffed.includes(1), 'cả hai đồng minh đều nhận buff');
  // Sự kiện buff mang lượng tăng cụ thể để client hiện ở Diễn biến chi tiết (mục 6.7).
  assert.equal(buffEvs[0]!.damageBps, PVP_SKILL_BUFF_DAMAGE_BPS);
  assert.equal(buffEvs[0]!.critPointsBps, PVP_SKILL_BUFF_CRIT_POINTS_BPS);
  // `damageFlat` = lượng sát thương cộng thẳng tính theo damage NỀN của tướng được buff; `expiresRound` để client tự bỏ buff hết hạn.
  assert.equal(buffEvs[0]!.damageFlat, Math.round((pvpBaseDamage(6) * PVP_SKILL_BUFF_DAMAGE_BPS) / BPS_SCALE));
  assert.ok(buffEvs[0]!.expiresRound >= 1, 'sự kiện buff phải cho biết lượt hết hạn');
});

test('engine: buff chỉ số cộng dồn và mỗi lớp kéo dài tối đa 3 lượt (mục 11.2)', () => {
  const buffer = findGeneral((id) => skillDef(id).buff);
  // Đồng minh Hỗ trợ có sát thương, không mang hiệu ứng nền, xếp sau tướng buff (cùng LC, slot lớn hơn)
  // nên hưởng lớp buff ngay trong lượt thi triển.
  const ally = findGeneral(
    (id) =>
      id !== buffer &&
      pvpProfile(id).style === 'support' &&
      skillDef(id).damageBps > 0 &&
      skillDef(id).stun === 'none' &&
      Object.values(skillDef(id).aura).every((v) => v === 0),
  );
  // Địch là tướng hồi máu cấp cao để trận đủ dài cho buff chồng lớp và hết hạn.
  const healer = findGeneral((id) => pvpProfile(id).skill === 'ALL_ALLIES_HEAL');
  const res = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: buffer, level: 6 },
        { slot: 2, generalId: ally, level: 6 },
      ]),
      one('b', [{ slot: 1, generalId: healer, level: 10 }]),
    ],
    never,
  );
  const dmg = res.events
    .filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && e.from === 1)
    .map((e) => e.amount);
  assert.ok(dmg.length >= 4, 'đồng minh phải ra đòn ít nhất 4 lượt');
  // Mỗi lượt thêm một lớp buff nên sát thương tăng dần...
  assert.ok(dmg[1]! > dmg[0]!, 'lớp buff thứ hai phải tăng sát thương');
  assert.ok(dmg[2]! > dmg[1]!, 'lớp buff thứ ba phải tăng sát thương');
  // ...nhưng chỉ giữ tối đa 3 lớp nên từ lớp thứ tư trở đi sát thương không tăng nữa (lớp cũ hết hạn).
  assert.equal(dmg[3]!, dmg[2]!, 'đạt tối đa 3 lớp rồi dừng tăng');
  const buffOfAlly = res.events.filter((e) => e.t === 'buff' && e.idx === 1).length;
  assert.ok(buffOfAlly >= 3, 'đồng minh nhận nhiều lớp buff qua các lượt');
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

test('engine: quá số vòng thì xét % HP còn lại (timeout — mục 14)', () => {
  const peaceful = peacefulIds();
  assert.ok(peaceful.length >= 2, 'roster phải có ít nhất 2 tướng kỹ năng không gây sát thương');
  const res = simulatePvp([one('a', [{ slot: 1, generalId: peaceful[0]!, level: 3 }]), one('b', [{ slot: 1, generalId: peaceful[1]!, level: 3 }])], seeded(11));
  assert.equal(res.rounds, PVP_MAX_ROUNDS);
  assert.equal(res.reason, 'timeout');
  assert.equal(res.winner, 'draw');
});

test('engine: mọi kỹ năng của roster đều có định nghĩa trong PVP_SKILL_DEF', () => {
  const skills = new Set<PvpSkill>(ROSTER.map((g) => pvpProfile(g.id).skill));
  for (const s of skills) assert.ok(PVP_SKILL_DEF[s], `thiếu định nghĩa kỹ năng ${s}`);
});

test('engine: tướng có hiệu ứng toàn đội tự hưởng buff của chính mình (mục 4.3)', () => {
  const auraOfId = (id: string) => PVP_SKILL_DEF[pvpProfile(id).skill].aura;
  const id = findGeneral((gid) => auraOfId(gid).teamHpBps > 0);
  const p = PVP_PASSIVE_EFFECT[pvpProfile(id).passive];
  // Solo ở hàng sau: không có buff HP theo hàng nên maxHp = nền × (1 + aura tự HP + aura toàn đội + nội tại HP nếu có).
  const res = simulatePvp([one('a', [{ slot: 4, generalId: id, level: 4 }])], never);
  const aura = auraOfId(id);
  const hpBps = aura.hpBps + aura.teamHpBps + (p.stat === 'maxHp' ? p.bps : 0);
  assert.equal(res.units[0]!.maxHp, Math.round(pvpBaseHp(4) * (1 + hpBps / BPS_SCALE)));
  assert.ok(aura.teamHpBps > 0);
  // Snapshot mang aura để client hiện LƯỢNG tăng khi tướng thi triển kỹ năng (mục 6.7).
  assert.deepEqual(res.units[0]!.aura, aura);
});

test('engine: ảnh chụp đầu trận mang tên kỹ năng thật của từng tướng (mục 6.7)', () => {
  const res = simulatePvp([one('a', [{ slot: 1, generalId: ROSTER[0]!.id, level: 3 }]), one('b', [{ slot: 1, generalId: ROSTER[1]!.id, level: 3 }])], never);
  for (const u of res.units) assert.equal(u.skillName, pvpProfile(u.generalId).skillName);
  assert.ok(res.units[0]!.skillName.length > 0, 'tên kỹ năng không được rỗng');
});

test('engine: SELF_HP — hồi 25% HP tối đa mỗi lượt ra đòn, không còn cộng trần HP (mục 6.4)', () => {
  const def = PVP_SKILL_DEF.SELF_HP;
  // "Bản thân +25% HP tối đa" trong SKILLS.md nghĩa là TỰ HỒI 25% HP tối đa mỗi lượt, không phải tăng trần HP.
  assert.equal(def.selfHealBps, 2500);
  assert.equal(def.aura.hpBps, 0);
  const id = findGeneral((gid) => pvpProfile(gid).skill === 'SELF_HP');
  const foe = findGeneral((x) => x !== id && skillDef(x).damageBps > 0);
  const res = simulatePvp([one('a', [{ slot: 1, generalId: id, level: 10 }]), one('b', [{ slot: 1, generalId: foe, level: 10 }])], never);
  const u = res.units.find((x) => x.idx === 0)!;
  assert.equal(u.aura?.hpBps ?? 0, 0, 'SELF_HP không còn tăng HP tối đa');
  const heals = res.events.filter((e): e is Extract<PvpEventDto, { t: 'heal' }> => e.t === 'heal' && e.from === 0 && e.idx === 0);
  assert.ok(heals.length > 0, 'phải tự hồi máu mỗi lượt ra đòn khi đã mất máu');
  const expected = Math.round((u.maxHp * pvpProfile(id).selfHealBps) / BPS_SCALE);
  assert.ok(heals.every((e) => !e.crit && e.amount <= expected), 'lượng hồi không vượt 25% HP tối đa');
});

test('engine: hút máu — tướng hồi bản thân theo % sát thương gây ra (mục 6.5)', () => {
  const lsId = findGeneral((id) => pvpProfile(id).lifestealPerLevelBps > 0 && skillDef(id).targeting === 'single' && skillDef(id).selfHealBps === 0);
  const foe = findGeneral((id) => id !== lsId && skillDef(id).targeting === 'single' && skillDef(id).damageBps > 0 && pvpProfile(id).lifestealPerLevelBps === 0);
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
  const dealt = hit.t === 'damage' ? hit.amount : 0;
  assert.equal(heal.amount, Math.round((dealt * u.lifestealBps) / BPS_SCALE));
});

test('engine: tướng hút máu bị giảm 10% hệ số sát thương kỹ năng (mục 6.5)', () => {
  // Nhạc Tiến: đánh đơn (SINGLE 250%), không phải tướng hot → chỉ chịu phạt hút máu 10%.
  assert.equal(pvpProfile('yue-jin').lifestealPerLevelBps, 200);
  assert.equal(PVP_SKILL_DEF.SINGLE.damageBps, 25000);
  assert.equal(pvpProfile('yue-jin').damageBps, 22500);
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
  assert.equal(c.bpsScale, BPS_SCALE);
  await app.close();
});

test('HTTP: chi tiết chiến đấu — tướng có hiệu ứng toàn đội tự hưởng (mục 4.3)', async () => {
  const { app, auth } = await setup();
  const id = findGeneral((gid) => {
    const a = PVP_SKILL_DEF[pvpProfile(gid).skill].aura;
    return a.teamHpBps > 0 && a.teamDamageBps > 0;
  });
  const r = await app.inject({ method: 'GET', url: `/api/pvp/generals/${id}/combat?level=5`, headers: auth });
  assert.equal(r.statusCode, 200);
  const c = r.json();
  const a = c.aura;
  assert.ok(a.teamHpBps > 0 && a.teamDamageBps > 0, 'tướng này phải có hiệu ứng toàn đội');
  const hpBps = a.hpBps + a.teamHpBps + (c.passiveEffect.stat === 'maxHp' ? c.passiveEffect.bps : 0);
  const dmgBps = a.damageBps + a.teamDamageBps + (c.passiveEffect.stat === 'damage' ? c.passiveEffect.bps : 0);
  assert.equal(c.self.maxHp, Math.round((c.base.maxHp * (c.bpsScale + hpBps)) / c.bpsScale));
  assert.equal(c.self.damage, Math.round((c.base.damage * (c.bpsScale + dmgBps)) / c.bpsScale));
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
