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
  PVP_BURN_CRIT_MUL_BPS,
  PVP_BURN_HEAL_DOWN_BPS,
  PVP_DEBUFF_ROUNDS,
  PVP_DEF_BPS,
  PVP_DEF_MAX_BPS,
  PVP_DISPEL_BPS_PER_LEVEL,
  PVP_FACTION_HP_BPS,
  PVP_FRONT_HP_BPS,
  PVP_BACK_DAMAGE_BPS,
  PVP_MAXHP_GAIN_HEAL_BPS,
  PVP_MAX_ROUNDS,
  PVP_PASSIVE_EFFECT,
  PVP_PURIFY_BPS_PER_LEVEL,
  PVP_REVIVE_DAMAGE_DOWN_BPS,
  PVP_REVIVE_HP_BPS_PER_LEVEL,
  PVP_SHIELD_BREAK,
  PVP_SKILL_BUFF_BURN_UP_BPS,
  PVP_SKILL_BUFF_BURN_UP_MAX_LAYERS,
  PVP_SKILL_BUFF_BURN_UP_ROUNDS,
  PVP_SKILL_BUFF_LIFESTEAL_BPS,
  PVP_TEAM_LIFESTEAL_BPS_PER_LEVEL,
  PVP_SKILL_DEF,
  PVP_VS_DEBUFF_BONUS_BPS,
  ROSTER,
  pvpBaseDamage,
  pvpBaseHp,
  pvpCritDamageBps,
  pvpDispelBps,
  pvpEffectBps,
  pvpFactionBonus,
  pvpPerLevelEffectBps,
  pvpPreBattleBonus,
  pvpProfile,
  pvpPurifyBps,
  pvpRealHitBps,
  pvpSkillDefAtLevel,
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
/**
 * Luôn trả 5000 → LUÔN TRÚNG (Trúng thực tế thấp nhất trong mọi cặp chỉ số là ≈82% > 50%) nhưng KHÔNG
 * chí mạng / choáng / phản kích (mọi tỉ lệ này đều dưới 50%: trần Choáng − Phản kích ≤ 30%, Chí mạng ≤ 35%).
 */
const never: RandomInt = () => 5000;

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

/**
 * Phòng thủ hiệu dụng của mục tiêu sau khi trừ Xuyên giáp của người tấn công, kẹp trần 75%
 * (SKILLS.md mục 18 — BƯỚC 2: Xuyên giáp ăn theo % của Giáp địch). Đọc chỉ số từ ảnh chụp đầu
 * trận: đúng cho các tình huống test không làm thay đổi Phòng thủ/Xuyên giáp giữa trận.
 */
const defFinalBps = (res: ReturnType<typeof simulatePvp>, attackerIdx: number, defenderIdx: number) => {
  const atk = res.units.find((u) => u.idx === attackerIdx)!;
  const dfn = res.units.find((u) => u.idx === defenderIdx)!;
  const effDef = Math.round((dfn.defBps * (BPS_SCALE - atk.defPenBps)) / BPS_SCALE);
  return Math.min(PVP_DEF_MAX_BPS, Math.max(0, effDef));
};

/** Sát thương sau khi áp Phòng thủ (SKILLS.md mục 18 — BƯỚC 2): Raw × (1 − Def_Final). */
const mitigated = (raw: number, defFinal: number) => Math.round((raw * (BPS_SCALE - defFinal)) / BPS_SCALE);

/** Tập id tướng có kỹ năng không gây sát thương (không thể kết liễu ai). */
const peacefulIds = () => ROSTER.filter((g) => isPeaceful(g.id)).map((g) => g.id);

test('engine: cùng seed cho ra cùng trận (tất định — mục 15)', () => {
  const sides = () => [one('a', [{ slot: 1, generalId: ROSTER[0]!.id, level: 5 }]), one('b', [{ slot: 1, generalId: ROSTER[1]!.id, level: 5 }])];
  const a = simulatePvp(sides(), seeded(2026));
  const b = simulatePvp(sides(), seeded(2026));
  assert.deepEqual(a, b);
  assert.equal(a.events[a.events.length - 1]!.t, 'end');
});

test('engine: idx theo slot (A=0–5, B=6–11) và hàng trước +5% HP (mục 2.2, 2.3)', () => {
  const g = ROSTER[0]!.id;
  const res = simulatePvp([one('a', [{ slot: 1, generalId: g, level: 5 }]), one('b', [{ slot: 4, generalId: g, level: 5 }])], never);
  // Cùng tướng, cùng cấp: slot 1 (hàng trước) +5% HP; slot 4 (hàng sau) không có buff HP.
  const front = res.units.find((u) => u.idx === 0)!;
  const back = res.units.find((u) => u.idx === 9)!;
  assert.equal(front.slot, 1);
  assert.equal(back.slot, 4);
  assert.ok(front.maxHp > back.maxHp, 'hàng trước phải nhiều HP hơn hàng sau');
});

test('engine: hàng sau +5% damage so với hàng trước (mục 2.3)', () => {
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

test('config: bảng Cổng Đồng Phe đúng mốc 2–6 tướng và kẹp trần (mục 1)', () => {
  assert.deepEqual(pvpFactionBonus(0), { hpBps: 0, damageBps: 0 });
  assert.deepEqual(pvpFactionBonus(1), { hpBps: 0, damageBps: 0 }, '1 tướng chưa đủ mốc cộng hưởng');
  assert.deepEqual(pvpFactionBonus(2), { hpBps: 200, damageBps: 0 });
  assert.deepEqual(pvpFactionBonus(3), { hpBps: 400, damageBps: 200 });
  assert.deepEqual(pvpFactionBonus(4), { hpBps: 600, damageBps: 400 });
  assert.deepEqual(pvpFactionBonus(5), { hpBps: 800, damageBps: 600 });
  assert.deepEqual(pvpFactionBonus(6), { hpBps: 1000, damageBps: 800 });
  assert.deepEqual(pvpFactionBonus(9), pvpFactionBonus(6), 'vượt 6 tướng kẹp về mốc 6');
});

test('config: pvpPreBattleBonus tổng hợp Vị trí + Phong cách + Cổng Đồng Phe (mục 1)', () => {
  // Tấn công hàng trước đơn độc (1 tướng, không Hỗ trợ): +5% Máu (vị trí) + 8% ST bản thân.
  assert.deepEqual(pvpPreBattleBonus('attack', 0, 1, 'front'), {
    rowHpBps: 500,
    rowDamageBps: 0,
    attackDamageBps: 800,
    defenseHpBps: 0,
    supportHpBps: 0,
    supportDamageBps: 0,
    factionHpBps: 0,
    factionDamageBps: 0,
    hpBps: 500,
    damageBps: 800,
  });
  // Phòng thủ hàng sau đơn độc: +5% ST (vị trí) + 8% Máu bản thân.
  assert.deepEqual(pvpPreBattleBonus('defense', 0, 1, 'back'), {
    rowHpBps: 0,
    rowDamageBps: 500,
    attackDamageBps: 0,
    defenseHpBps: 800,
    supportHpBps: 0,
    supportDamageBps: 0,
    factionHpBps: 0,
    factionDamageBps: 0,
    hpBps: 800,
    damageBps: 500,
  });
  // Hỗ trợ 2 lớp + 4 tướng cùng phe, hàng trước: 5% vị trí + 2%×2 Hỗ trợ (400) + mốc 4 (600 HP / 400 ST).
  const b = pvpPreBattleBonus('support', 2, 4, 'front');
  assert.equal(b.rowHpBps, 500);
  assert.equal(b.supportHpBps, 400);
  assert.equal(b.supportDamageBps, 400);
  assert.equal(b.factionHpBps, 600);
  assert.equal(b.factionDamageBps, 400);
  assert.equal(b.hpBps, 1500);
  assert.equal(b.damageBps, 800);
  // Trần aura Hỗ trợ 6 lớp = +12% (1200 bps).
  assert.equal(pvpPreBattleBonus('support', 9, 0, 'back').supportHpBps, 1200);
  assert.equal(pvpPreBattleBonus('support', 9, 0, 'back').supportDamageBps, 1200);
});

test('engine: Vị trí đội hình +5% Máu (hàng trước) / +5% Sát thương (hàng sau) (mục 1)', () => {
  const level = 5;
  const base = pvpBaseHp(level);
  const baseDmg = pvpBaseDamage(level);
  // Tướng Tấn công, không nội tại tăng HP/ST → chỉ số nền chỉ gồm phong cách + vị trí.
  const atk = findGeneral((id) => {
    const p = pvpProfile(id);
    const eff = PVP_PASSIVE_EFFECT[p.passive];
    return p.style === 'attack' && eff.stat !== 'damage' && eff.stat !== 'maxHp';
  });
  // Solo để không có aura Hỗ trợ / cổng đồng phe; so hàng trước (slot 2) với hàng sau (slot 5).
  const run = (slot: number) => simulatePvp([one('a', [{ slot, generalId: atk, level }])], never).units[0]!;
  // Tướng Tấn công vẫn nhận +8% ST theo phong cách, nên phần ST nền = phong cách + vị trí; HP chỉ có vị trí.
  const styleDmgBps = pvpStyleBonus('attack', 0).damageBps;
  const front = run(2);
  const back = run(5);
  assert.equal(front.slot, 2);
  assert.equal(back.slot, 5);
  assert.equal(front.maxHp, Math.round(base * (1 + PVP_FRONT_HP_BPS / BPS_SCALE)), 'hàng trước +5% Máu');
  assert.equal(back.maxHp, base, 'hàng sau không cộng Máu');
  assert.equal(back.damage, Math.round(baseDmg * (1 + (styleDmgBps + PVP_BACK_DAMAGE_BPS) / BPS_SCALE)), 'hàng sau +5% Sát thương');
  assert.equal(front.damage, Math.round(baseDmg * (1 + styleDmgBps / BPS_SCALE)), 'hàng trước không cộng Sát thương vị trí');
});

test('engine: Cổng Đồng Phe chỉ cộng cho tướng CÙNG PHE trong đội (mục 1)', () => {
  const level = 5;
  const base = pvpBaseHp(level);
  // Tướng khảo sát: Thục, không Hỗ trợ, nội tại không tăng HP tối đa → cọc Máu chỉ gồm phong cách + cổng đồng phe.
  const neutral = (id: string) =>
    pvpProfile(id).style !== 'support' && PVP_PASSIVE_EFFECT[pvpProfile(id).passive].stat !== 'maxHp';
  const shu = ROSTER.filter((g) => g.faction === 'shu' && neutral(g.id)).map((g) => g.id);
  const wei = ROSTER.filter((g) => g.faction === 'wei' && neutral(g.id)).map((g) => g.id);
  assert.ok(shu.length >= 4, 'roster phải có đủ 4 tướng Thục không Hỗ trợ để test');
  assert.ok(wei.length >= 4, 'roster phải có đủ 4 tướng Ngụy không Hỗ trợ để test');
  const x = shu[0]!;
  const styleHp = pvpStyleBonus(pvpProfile(x).style, 0).hpBps; // không có tướng Hỗ trợ → 0 lớp aura
  const hpWith = (factionHpBps: number) => Math.round(base * (1 + (styleHp + factionHpBps) / BPS_SCALE));
  // Tướng khảo sát ở slot 4 (hàng sau → không buff HP theo hàng); đồng đội xếp slot 1–3.
  const run = (mates: string[]) =>
    simulatePvp(
      [
        one('a', [{ slot: 4, generalId: x, level }, ...mates.map((g, i) => ({ slot: i + 1, generalId: g, level }))]),
        one('b', [{ slot: 1, generalId: wei[0]!, level }]),
      ],
      never,
    ).units.find((u) => u.side === 'a' && u.slot === 4)!.maxHp;

  assert.equal(run([]), hpWith(0), 'đội 1 tướng: chưa kích hoạt cộng hưởng phe');
  assert.equal(run(wei.slice(1, 4)), hpWith(0), 'đồng đội KHÁC PHE không kích hoạt cộng hưởng cho tướng Thục');
  assert.equal(run(shu.slice(1, 4)), hpWith(PVP_FACTION_HP_BPS[4]!), 'tổng 4 tướng Thục → mốc cộng hưởng 4');
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

test('engine: chí mạng theo RNG; crit damage = đòn thường × (1 + ST chí mạng theo cấp) (mục 6.3, 7)', () => {
  // Lữ Mông: đánh đơn, không tự buff/hút máu/đối kháng → sát thương thuần.
  const attacker = 'lu-meng';
  const target = 'da-qiao';
  const sides = () => [one('a', [{ slot: 1, generalId: attacker, level: 4 }]), one('b', [{ slot: 1, generalId: target, level: 4 }])];

  const plainRes = simulatePvp(sides(), never);
  const plainHits = plainRes.events.filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage');
  assert.ok(plainHits.length > 0, 'phải có ít nhất một đòn đánh');
  assert.ok(plainHits.every((e) => !e.crit));

  const critHits = simulatePvp(sides(), always0).events.filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage');
  assert.ok(critHits.length > 0);
  assert.ok(critHits.every((e) => e.crit));
  const plain = plainHits[0]!;
  const crit = critHits.find((e) => e.from === plain.from && e.idx === plain.idx)!;
  // Sát thương gốc suy từ chỉ số tướng, rồi áp đúng quy trình Xuyên giáp/Phòng thủ (mục 18 — BƯỚC 2)
  // cho cả đòn thường và đòn chí mạng để so sánh hệ số chí mạng trên cùng một nền.
  const u = plainRes.units.find((x) => x.idx === plain.from)!;
  const defFinal = defFinalBps(plainRes, plain.from, plain.idx);
  const raw = Math.round((u.damage * skillDef(attacker).damageBps) / BPS_SCALE);
  assert.equal(plain.amount, mitigated(raw, defFinal), 'đòn thường = sát thương gốc sau Phòng thủ');
  // Hệ số chí mạng = 1 + ST chí mạng TẠI CẤP của người tấn công (cấp 4 → +40%).
  const mul = (BPS_SCALE + pvpCritDamageBps(4)) / BPS_SCALE;
  assert.equal(crit.amount, mitigated(Math.round(raw * mul), defFinal));
});

test('engine: hồi máu cũng chí mạng; crit heal = hồi thường × (1 + ST chí mạng theo cấp) (mục 6.3, 6.4)', () => {
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
  // Hệ số chí mạng của NGƯỜI HỒI máu (cấp 3).
  const mul = (BPS_SCALE + pvpCritDamageBps(3)) / BPS_SCALE;
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

test('engine: tướng hỗ trợ ban hút máu 15% cho đồng đội — mỗi phe 1 tướng (mục 1.13)', () => {
  // Mỗi phe đúng MỘT tướng hỗ trợ ban hút máu: Lưu Bị (Thục) · Tuân Úc (Ngụy) · Lỗ Túc (Ngô) · Viên Thiệu (Quần).
  for (const id of ['liu-bei', 'xun-yu', 'lu-su', 'yuan-shao']) {
    const ls = skillDef(id).buffs.find((e) => e.buff.lifestealBps > 0);
    assert.ok(ls, `${id} phải có kênh buff hút máu`);
    assert.equal(ls.scope, 'all_allies', `${id}: hút máu ban cho toàn đội`);
    assert.equal(ls.buff.lifestealBps, PVP_SKILL_BUFF_LIFESTEAL_BPS, `${id}: trần hút máu 15%`);
    assert.equal(ls.buff.rounds, 2, `${id}: chỉ kéo dài 2 lượt`);
    assert.equal(ls.buff.maxLayers, 1, `${id}: không cộng dồn lớp để giữ trần 15%`);
  }
  // Hành vi: đồng minh KHÔNG có hút máu gốc vẫn hồi máu nhờ hút máu được ban.
  // Lưu Bị (tổng LC cao) đi trước nên đồng minh đã có buff hút máu khi tới lượt ở ngay vòng 1.
  const res = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: 'liu-bei', level: 10 },
        { slot: 2, generalId: 'xu-huang', level: 10 },
      ]),
      one('b', [{ slot: 1, generalId: 'xin-xianying', level: 10 }]),
    ],
    never,
  );
  const ally = res.units.find((x) => x.idx === 1)!;
  assert.equal(ally.lifestealBps, 0, 'tiền đề: Xu Hoảng không có hút máu gốc');
  assert.ok(
    res.events.some((e) => e.t === 'buff' && e.idx === 1 && e.lifestealBps === PVP_SKILL_BUFF_LIFESTEAL_BPS),
    'đồng minh nhận lớp buff hút máu',
  );
  // Sự kiện hồi máu đánh dấu `lifesteal` để client chọn đúng âm thanh.
  assert.ok(
    res.events.some((e) => e.t === 'heal' && e.from === 1 && e.idx === 1 && e.lifesteal === true),
    'đồng minh hồi máu nhờ hút máu được ban',
  );
});

test('engine: Quan Vũ nhắm tướng địch có sát thương cao nhất (mục 2.4, 6.2)', () => {
  // Cùng cấp nên sát thương nền bằng nhau; tướng Tấn công (+25% ST) mạnh hơn tướng Phòng thủ (+25% HP).
  // Địch: slot 1 = Phòng thủ (idx 6), slot 2 = Tấn công (idx 7) → Quan Vũ (idx 0) phải nhắm idx 7.
  const atk = findGeneral((id) => id !== 'guan-yu' && pvpProfile(id).style === 'attack' && skillDef(id).stun === 'none');
  const def = findGeneral((id) => pvpProfile(id).style === 'defense' && skillDef(id).stun === 'none');
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'guan-yu', level: 5 }]), one('b', [{ slot: 1, generalId: def, level: 5 }, { slot: 2, generalId: atk, level: 5 }])],
    never,
  );
  // Bảo đảm tiền đề test: tướng Tấn công địch đúng là mạnh hơn tướng Phòng thủ.
  const dmgOf = (idx: number) => res.units.find((u) => u.idx === idx)!.damage;
  assert.ok(dmgOf(7) > dmgOf(6), 'tướng Tấn công phải có sát thương cao hơn tướng Phòng thủ');
  const act = res.events.find((e): e is Extract<PvpEventDto, { t: 'act' }> => e.t === 'act' && e.idx === 0)!;
  assert.deepEqual(act.targets, [7], 'phải nhắm tướng Tấn công (sát thương cao nhất)');
});

test('engine: Điêu Thuyền choáng đúng tướng địch có sát thương cao nhất (mục 2.4, 6.2)', () => {
  // Cùng cấp nên sát thương nền bằng nhau; tướng Tấn công (+25% ST) mạnh hơn tướng Phòng thủ (+25% HP).
  // Địch: slot 1 = Phòng thủ (idx 6), slot 2 = Tấn công (idx 7) → Điêu Thuyền (idx 0) phải nhắm idx 7.
  const atk = findGeneral((id) => id !== 'diao-chan' && pvpProfile(id).style === 'attack' && skillDef(id).stun === 'none');
  const def = findGeneral((id) => pvpProfile(id).style === 'defense' && skillDef(id).stun === 'none');
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'diao-chan', level: 10 }]), one('b', [{ slot: 1, generalId: def, level: 10 }, { slot: 2, generalId: atk, level: 10 }])],
    never,
  );
  const dmgOf = (idx: number) => res.units.find((u) => u.idx === idx)!.damage;
  assert.ok(dmgOf(7) > dmgOf(6), 'tướng Tấn công phải có sát thương cao hơn tướng Phòng thủ');
  const act = res.events.find((e): e is Extract<PvpEventDto, { t: 'act' }> => e.t === 'act' && e.idx === 0)!;
  assert.deepEqual(act.targets, [7], 'phải nhắm tướng Tấn công (sát thương cao nhất)');
});

test('engine: hồi sinh một lần/trận — sống lại theo cấp và giảm 50% sát thương tới hết trận (mục 1.14)', () => {
  // Danh sách tướng có Hồi sinh: Triệu Vân (Thục · Tấn công), Tào Nhân (Ngụy · Phòng thủ),
  // Hoàng Cái (Ngô · Phòng thủ), Văn Súy (Quần · Tấn công). Các tướng khác không có.
  for (const id of ['zhao-yun', 'cao-ren', 'huang-gai', 'wen-chou']) assert.equal(skillDef(id).revive, true, `${id} phải có hồi sinh`);
  assert.equal(skillDef('liu-bei').revive, false, 'tướng không nằm trong danh sách thì không hồi sinh');

  // Triệu Vân cấp 1 gặp Quan Vũ cấp 10 đánh đơn: bị hạ ngay lượt đầu nhưng không gục.
  const reviver = 'zhao-yun';
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: reviver, level: 1 }]), one('b', [{ slot: 1, generalId: 'guan-yu', level: 10 }])],
    never,
  );
  const u = res.units.find((x) => x.idx === 0)!;

  // Chỉ hồi sinh MỘT lần mỗi trận, hồi đúng `cấp × 5%` HP tối đa (cấp 1 → 5%).
  const revives = res.events.filter((e): e is Extract<PvpEventDto, { t: 'revive' }> => e.t === 'revive' && e.idx === 0);
  assert.equal(revives.length, 1, 'chỉ hồi sinh một lần trong trận');
  const rev = revives[0]!;
  assert.equal(rev.damageDownBps, PVP_REVIVE_DAMAGE_DOWN_BPS, 'đổi lại bằng việc giảm 50% sát thương gây ra');
  const wantHp = Math.min(u.maxHp, Math.max(1, Math.round((u.maxHp * Math.min(BPS_SCALE, 1 * PVP_REVIVE_HP_BPS_PER_LEVEL)) / BPS_SCALE)));
  assert.equal(rev.hp, wantHp, 'hồi đúng cấp × 5% HP tối đa');
  assert.ok(rev.hp > 0 && rev.hp < u.maxHp, 'sống lại với một phần máu, không đầy');

  // Hồi sinh xảy ra trước khi gục thật (lần chết thứ hai mới thực sự gục).
  const reviveAt = res.events.indexOf(rev);
  const downAt = res.events.findIndex((e) => e.t === 'down' && e.idx === 0);
  assert.ok(downAt > reviveAt, 'hồi sinh rồi mới gục thật ở lần chết sau');

  // Đòn đánh của Triệu Vân chỉ còn MỘT NỬA (kỹ năng đánh đơn, không tự buff sát thương nên không nhiễu).
  const hit = res.events.find((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && e.from === 0);
  assert.ok(hit, 'Triệu Vân phải ra được một đòn sau khi hồi sinh');
  const skillMul = skillDef(reviver).damageBps / BPS_SCALE;
  const defFinal = defFinalBps(res, 0, 6);
  const halfRaw = Math.round((u.damage * (BPS_SCALE - PVP_REVIVE_DAMAGE_DOWN_BPS)) / BPS_SCALE);
  assert.equal(hit.amount, mitigated(Math.round(halfRaw * skillMul), defFinal), 'sát thương gây ra giảm đúng 50% sau Hồi sinh');
  // So với đòn bình thường (chưa hồi sinh): chỉ còn khoảng một nửa (lệch tối đa 1 đơn vị do làm tròn).
  const fullRaw = Math.round(u.damage * skillMul);
  assert.ok(Math.abs(hit.amount * 2 - mitigated(fullRaw, defFinal)) <= 1, 'bằng nửa sát thương bình thường');
});

test('engine: tướng cộng thêm 30% sát thương khi đánh mục tiêu đang chịu hiệu ứng bất lợi (mục 1.17)', () => {
  // Danh sách 6 tướng "đao phủ": 3 Ngụy (Tào Phi, Tào Chân, Từ Hoảng) + 1 mỗi phe khác
  // (Mã Đại — Thục, Đinh Phụng — Ngô, Trương Bảo — Quần). Tướng ngoài danh sách không có cơ chế này.
  for (const id of ['cao-pi', 'cao-zhen', 'xu-huang', 'ma-dai', 'ding-feng', 'zhang-bao'])
    assert.equal(skillDef(id).vsDebuffBonusBps, PVP_VS_DEBUFF_BONUS_BPS, `${id} phải cộng thêm sát thương lên mục tiêu đang debuff`);
  assert.equal(skillDef('guan-yu').vsDebuffBonusBps, 0, 'tướng ngoài danh sách không có cơ chế này');

  // Cao Chân (Ngụy) vừa gây suy yếu vừa có cơ chế: vòng 1 đánh mục tiêu SẠCH (hiệu ứng bất lợi được áp
  // SAU đòn đánh trong cùng lượt), vòng 2 mục tiêu mới dính 1 lớp suy yếu (CHƯA đủ ngưỡng ≥2 lớp "đao phủ"),
  // từ vòng 3 mục tiêu đã dính 2 lớp suy yếu nên đòn đánh được cộng thêm 30%.
  // Mục tiêu phải là tướng ôn hoà KHÔNG thanh tẩy/suy yếu/giảm ST nhận (nếu không debuff bị gỡ hoặc
  // sát thương nhận vào bị lệch giữa các vòng), cấp 10 để sống qua nhiều vòng.
  const victim = findGeneral((id) => {
    const d = skillDef(id);
    return isPeaceful(id) && !d.purify && !d.cleanse && d.counter.damageBps === 0 && d.buffs.every((e) => e.buff.takenDownBps === 0);
  });
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'cao-zhen', level: 1 }]), one('b', [{ slot: 1, generalId: victim, level: 10 }])],
    never,
  );
  const hits = res.events
    .filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && e.from === 0)
    .map((e) => e.amount);
  assert.ok(hits.length >= 3, 'phải có ít nhất ba đòn đánh để so sánh');
  // Cao Chân ở cấp 1 nên hệ số "đao phủ" đã quy theo cấp (cấp 1 = giá trị chốt − 10 điểm %).
  const mul = (BPS_SCALE + pvpEffectBps(PVP_VS_DEBUFF_BONUS_BPS, 1)) / BPS_SCALE;
  assert.equal(hits[1], hits[0], '1 lớp suy yếu chưa đủ ngưỡng → chưa cộng thêm sát thương');
  assert.equal(hits[2], Math.round(hits[1]! * mul), 'mục tiêu đang chịu ≥2 lớp suy yếu → đòn đánh được cộng thêm 30%');
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
  // Trương Hợp: choáng đơn (hàng sau), không hút máu/tự hồi/giải choáng. Mỗi lượt tốn 4 lượt RNG:
  // 1 lớp buff bản thân (Kỳ binh đột kích +Chính xác) + Chính xác + Chí mạng + Choáng (mục 18).
  const stunner = 'zhang-he';
  // Nạn nhân: phong cách Phòng thủ, cấp 10 để sống qua nhiều lượt. Hai tướng CÙNG cấp 10 nên LC quyết
  // bởi hệ số phong cách: Tấn công (Trương Hợp) > Phòng thủ (Cao Hồng) → tổng LC đội A cao hơn, A đi trước.
  const victim = 'cao-hong';
  // Bốn lần gọi RNG đầu của lượt A1 (lớp buff + Chính xác + Chí mạng + Choáng) trả 0 → choáng ngay vòng 1;
  // các lần sau trả 5000 (luôn TRÚNG nhưng không chí mạng/choáng) để trận tiếp diễn bình thường.
  let calls = 0;
  const stunOnce: RandomInt = () => (calls++ < 4 ? 0 : 5000);
  const res = simulatePvp([one('a', [{ slot: 1, generalId: stunner, level: 10 }]), one('b', [{ slot: 4, generalId: victim, level: 10 }])], stunOnce);
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
  // Hệ số buff đã quy theo cấp của Lưu Bị (cấp 6) nên lấy định nghĩa kỹ năng TẠI CẤP.
  const b = pvpSkillDefAtLevel(skillDef(buffer), 6).buffs[0]!.buff;
  const u0 = res.units.find((x) => x.idx === buffEvs[0]!.idx)!;
  assert.equal(buffEvs[0]!.damageFlat, Math.round((u0.damage * b.damageBps) / BPS_SCALE));
  assert.equal(buffEvs[0]!.hpFlat, Math.round((u0.maxHp * b.hpBps) / BPS_SCALE));
  assert.equal(buffEvs[0]!.critBps, b.critBps);
  assert.equal(buffEvs[0]!.crit, false, 'không chí mạng khi RNG luôn trả max-1');
  assert.equal(buffEvs[0]!.expiresRound, 1 + b.rounds - 1, 'lớp buff sống đúng PVP_BUFF_ROUNDS lượt');
  assert.equal(buffEvs[0]!.maxLayers, PVP_BUFF_MAX_LAYERS);
});

test('engine: buff %HP của kỹ năng chỉ hồi 1/4 lượng trần tăng, không hồi đầy (mục 1)', () => {
  // Lưu Bị (Hỗ trợ, tổng LC cao hơn) đi trước → tự buff +10% HP tối đa ngay vòng 1 khi còn đầy máu;
  // Lữ Mông đánh đơn ngay sau nên `hp` trong sự kiện sát thương phản ánh đúng lượng máu đã hồi thêm.
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'liu-bei', level: 10 }]), one('b', [{ slot: 1, generalId: 'lu-meng', level: 10 }])],
    never,
  );
  const u = res.units.find((x) => x.idx === 0)!;
  const b = skillDef('liu-bei').buffs[0]!.buff;
  const hpFlat = Math.round((u.maxHp * b.hpBps) / BPS_SCALE);
  const gain = Math.round((hpFlat * PVP_MAXHP_GAIN_HEAL_BPS) / BPS_SCALE);
  assert.ok(gain < hpFlat, 'máu hồi phải ít hơn phần trần HP tăng thêm');
  const hit = res.events.find((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && e.idx === 0)!;
  assert.ok(hit, 'phải có đòn đánh vào tướng được buff');
  assert.equal(hit.hp, u.maxHp + gain - hit.amount, 'máu = trần cũ + 1/4 lượng trần tăng − sát thương nhận vào');
});

test('engine: chí mạng nhân hệ số %HP và %sát thương của buff — một roll chung cho cả lớp (mục 11.2)', () => {
  const buffer = 'liu-bei';
  const b = pvpSkillDefAtLevel(skillDef(buffer), 6).buffs[0]!.buff;
  const res = simulatePvp([one('a', [{ slot: 1, generalId: buffer, level: 6 }]), one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }])], always0);
  const ev = res.events.find((e): e is Extract<PvpEventDto, { t: 'buff' }> => e.t === 'buff');
  assert.ok(ev, 'phải có ít nhất một lớp buff');
  const mul = (BPS_SCALE + pvpCritDamageBps(6)) / BPS_SCALE;
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

test('engine: Lục Tốn đánh hàng TRƯỚC (front_enemies) chứ không phải hàng ngang (mục 13.2)', () => {
  assert.equal(skillDef('lu-xun').targeting, 'front_enemies');
});

test('engine: đánh "hàng trước" luôn nhắm 3 tướng hàng trước của địch, không phụ thuộc vị trí người thi triển (mục 2.4)', () => {
  // Giả Hủ đứng ở hàng SAU (slot 4) nhưng kỹ năng chỉ đánh 3 tướng ở hàng TRƯỚC của địch (idx 6-8).
  const res = simulatePvp(
    [
      one('a', [{ slot: 4, generalId: 'jia-xu', level: 10 }]),
      one('b', [
        { slot: 1, generalId: 'da-qiao', level: 10 },
        { slot: 2, generalId: 'zhu-huan', level: 10 },
        { slot: 3, generalId: 'taishi-ci', level: 10 },
        { slot: 4, generalId: 'yuan-shu', level: 10 },
      ]),
    ],
    never,
  );
  const act = res.events.find((e): e is Extract<PvpEventDto, { t: 'act' }> => e.t === 'act' && e.idx === 3)!;
  assert.deepEqual(act.targets, [6, 7, 8], 'chỉ đánh 3 tướng ở cột trước của địch');
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

test('engine: đánh hàng ngang quét theo thứ tự gần mình nhất (ô 1 → 1 2 3, ô 2 → 2 1 3, ô 3 → 3 2 1), luôn ưu tiên hàng TRƯỚC (mục 2.4)', () => {
  const firstActOf = (res: ReturnType<typeof simulatePvp>, idx: number) =>
    res.events.find((e): e is Extract<PvpEventDto, { t: 'act' }> => e.t === 'act' && e.idx === idx)!;
  /** Triệu Vân (kỹ năng hàng ngang) đứng ở `slot` đánh đội địch chỉ còn hàng trước ở `frontSlots`. */
  const actOf = (slot: number, frontSlots: number[]) =>
    firstActOf(
      simulatePvp(
        [
          one('a', [{ slot, generalId: 'zhao-yun', level: 10 }]),
          one('b', [
            ...frontSlots.map((s) => ({ slot: s, generalId: 'da-qiao', level: 1 })),
            { slot: 4, generalId: 'yuan-shu', level: 1 },
            { slot: 5, generalId: 'taishi-ci', level: 1 },
            { slot: 6, generalId: 'jia-xu', level: 1 },
          ]),
        ],
        never,
      ),
      slot - 1,
    );
  // Ô 1 → quét 1 2 3: thiếu ô 1 thì dạt sang 2-5 (KHÔNG đánh trơ ô 4), đủ ô 1 thì đánh 1-4.
  assert.deepEqual(actOf(1, [2, 3]).targets, [7, 10], 'ô 1: thiếu ô 1 → dạt sang hàng ngang 2-5');
  assert.deepEqual(actOf(1, [1, 2, 3]).targets, [6, 9], 'ô 1: còn ô 1 → đánh đúng hàng ngang 1-4');
  // Ô 2 → quét 2 1 3: thiếu ô 2 thì ưu tiên ô 1 (gần bằng nhau, chọn hàng nhỏ hơn).
  assert.deepEqual(actOf(2, [1, 3]).targets, [6, 9], 'ô 2: thiếu ô 2 → dạt sang hàng ngang 1-4');
  assert.deepEqual(actOf(2, [2, 3]).targets, [7, 10], 'ô 2: còn ô 2 → đánh đúng hàng ngang 2-5');
  // Ô 3 → quét 3 2 1: thiếu ô 3 thì ưu tiên ô 2 (gần hơn ô 1).
  assert.deepEqual(actOf(3, [1, 2]).targets, [7, 10], 'ô 3: thiếu ô 3 → dạt sang hàng ngang 2-5 (gần hơn ô 1)');
  // Hàng trước địch sạch hoàn toàn → mới đánh hàng sau: hàng ngang của mình (ô 1 → còn mỗi ô 4).
  assert.deepEqual(actOf(1, []).targets, [9], 'hàng trước sạch → quay về hàng ngang của mình (chỉ còn ô 4)');
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
    // Lớp thiêu đốt = ST hiệu dụng × hệ số thiêu đốt TẠI CẤP (cấp 5); sát thương thiêu đốt =
    // lớp đó × (1 + ST chí mạng × hệ số riêng).
    const burnBps = pvpSkillDefAtLevel(skillDef(id), 5).debuff.burnBps;
    const flat = Math.round((res.units[0]!.damage * burnBps) / BPS_SCALE);
    return { amount: e.amount, flat };
  };
  const normal = firstBurn('zhu-huan'); // Chu Hoàn: không có hệ số riêng cho thiêu đốt.
  const zhouYu = firstBurn('zhou-yu'); // Chu Du: ×1.3 tỷ lệ chí mạng & ST chí mạng cho thiêu đốt.
  assert.equal(
    normal.amount,
    Math.round((normal.flat * (BPS_SCALE + pvpCritDamageBps(5))) / BPS_SCALE),
    'thiêu đốt thường dùng ST chí mạng theo cấp (cấp 5)',
  );
  const burnCritDamageBps = Math.round((pvpCritDamageBps(5) * PVP_BURN_CRIT_MUL_BPS) / BPS_SCALE);
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
  const b = pvpSkillDefAtLevel(skillDef(id), 4).buffs.find((e) => e.buff.hpBps > 0)!.buff;
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

test('engine: hồi máu theo lượt (HoT) — Cát Huyền hồi cả đội vào ĐẦU mỗi lượt (mục 3)', () => {
  // Cát Huyền: "Đan đạo huyền công" — Buff ST toàn đội 10% VÀ Hồi máu theo lượt 50% ST cơ bản (3 lượt).
  const def = skillDef('ge-xuan');
  assert.equal(def.healBps, 0, 'không hồi máu tức thời');
  const hot = def.buffs.find((e) => e.buff.hotBps > 0);
  assert.ok(hot, 'phải có kênh HoT');
  assert.equal(hot!.buff.hotBps, 5000);
  assert.equal(hot!.buff.maxLayers, 1, 'HoT không cộng dồn lớp (chỉ làm mới)');
  assert.equal(hot!.scope, 'all_allies');

  // Đặt 1 tướng sát thương để địch tập trung đánh → có máu mất mà hồi.
  const ally = 'zhao-yun';
  const res = simulatePvp(
    [
      one('a', [{ slot: 4, generalId: ally, level: 10 }, { slot: 1, generalId: 'ge-xuan', level: 10 }]),
      one('b', [{ slot: 1, generalId: 'guan-yu', level: 10 }]),
    ],
    never,
  );
  const casterIdx = res.units.find((u) => u.generalId === 'ge-xuan')!.idx;
  const allyIdx = res.units.find((u) => u.generalId === ally)!.idx;
  const heals = res.events.filter((e): e is Extract<PvpEventDto, { t: 'heal' }> => e.t === 'heal' && e.from === casterIdx);
  assert.ok(heals.some((h) => h.idx === allyIdx), 'Cát Huyền phải hồi máu cho đồng minh trong đội');
  assert.ok(heals.every((h) => h.crit === false && !h.lifesteal), 'HoT không ăn chí mạng và không phải hút máu');

  // Tick ở ĐẦU lượt: từ mốc "round" gần nhất tới lần hồi KHÔNG có lượt hành động nào của Cát Huyền.
  const firstHealAt = res.events.findIndex((e) => e.t === 'heal' && e.from === casterIdx && e.idx === allyIdx);
  assert.ok(firstHealAt > 0);
  let roundIdx = -1;
  for (let i = firstHealAt - 1; i >= 0; i--) {
    if (res.events[i]!.t === 'round') {
      roundIdx = i;
      break;
    }
  }
  assert.ok(roundIdx >= 0, 'phải có mốc bắt đầu lượt trước lần hồi');
  const actedInBetween = res.events.slice(roundIdx + 1, firstHealAt).some((e) => e.t === 'act' && e.idx === casterIdx);
  assert.equal(actedInBetween, false, 'HoT phải hồi ngay đầu lượt, trước khi tướng ra đòn');

  // Lượng hồi không vượt 50% sát thương của người thi triển.
  const castDamage = res.units.find((u) => u.idx === casterIdx)!.damage;
  assert.ok(heals.every((h) => h.amount <= Math.round((castDamage * 5000) / BPS_SCALE) + 1), 'lượng hồi vượt hệ số HoT');
});

test('config: Cố Ung xóa hiệu ứng bất lợi (kể cả Thiêu đốt) + Giảm 10% ST nhận toàn đội', () => {
  // SKILLS.md: "Vận Trù Trợ Hỏa" — Xóa hiệu ứng bất lợi và Giảm 10% sát thương nhận vào toàn đội (3 lượt),
  // kèm buff +10% sát thương Thiêu đốt (2 lượt, cộng dồn tối đa 2 lớp) cho các đồng minh biết thiêu đốt.
  const def = skillDef('gu-yong');
  assert.equal(pvpProfile('gu-yong').skill, 'PURIFY');
  assert.equal(def.purify, true);
  assert.equal(def.healBps, 0, 'kỹ năng không hồi máu');
  assert.equal(def.buffs[0]!.scope, 'all_allies');
  assert.equal(def.buffs[0]!.buff.takenDownBps, 1000);
  assert.equal(def.buffs[0]!.buff.hpBps, 0, 'không còn tăng HP tối đa');
  assert.equal(def.buffs[1]!.scope, 'burn_allies');
  assert.equal(def.buffs[1]!.buff.burnUpBps, PVP_SKILL_BUFF_BURN_UP_BPS);
  assert.equal(def.buffs[1]!.buff.rounds, PVP_SKILL_BUFF_BURN_UP_ROUNDS, 'mỗi lớp hiệu lực 2 lượt');
  assert.equal(def.buffs[1]!.buff.maxLayers, PVP_SKILL_BUFF_BURN_UP_MAX_LAYERS, 'cộng dồn tối đa 2 lớp');
  assert.equal(PVP_SKILL_BUFF_BURN_UP_MAX_LAYERS, 2);
  assert.ok(
    PVP_SKILL_BUFF_BURN_UP_ROUNDS >= 2,
    'trần 2 lớp chỉ có nghĩa khi mỗi lớp sống ≥ 2 lượt (nếu không 2 lớp không bao giờ cùng tồn tại)',
  );
});

test('engine: buff tăng sát thương Thiêu đốt của Cố Ung cộng dồn 2 lớp (+20%)', () => {
  // Cố Ung (slot 1) đi trước Chu Hoàn (slot 4) trong cùng đội: lượt 1 phát 1 lớp (+10%), lượt 2 phát
  // thêm 1 lớp (lớp cũ còn sống vì hiệu lực 2 lượt) → đòn Thiêu đốt tạo ở lượt 2 hưởng đủ 2 lớp (+20%).
  const res = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: 'gu-yong', level: 10 },
        { slot: 4, generalId: 'zhu-huan', level: 10 },
      ]),
      one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }]),
    ],
    never,
  );
  const zhu = res.units.find((u) => u.generalId === 'zhu-huan')!;
  const burnBps = skillDef('zhu-huan').debuff.burnBps;
  // Sát thương thiêu đốt = ST hiệu dụng × burnBps × (100% + số lớp × 10%) — Cố Ung không ban buff ST
  // nên ST hiệu dụng của Chu Hoàn không đổi giữa các lượt, chỉ hệ số lớp tăng.
  const flat = (layers: number) =>
    Math.round((zhu.damage * burnBps * (BPS_SCALE + layers * PVP_SKILL_BUFF_BURN_UP_BPS)) / (BPS_SCALE * BPS_SCALE));
  const flats = res.events
    .filter(
      (e): e is Extract<PvpEventDto, { t: 'debuff' }> => e.t === 'debuff' && e.from === zhu.idx && e.burnFlat > 0,
    )
    .map((e) => e.burnFlat);
  assert.deepEqual(flats.slice(0, 2), [flat(1), flat(2)], 'lượt 1 = 1 lớp (+10%), lượt 2 = 2 lớp (+20%)');
});

test('config: Hoa Đà giải khống đặc thù 55% (cấp 1) → 100% (cấp 10)', () => {
  // SKILLS.md mục 1.7: Hoa Đà là ngoại lệ — tỷ lệ giải Choáng/Thiêu đốt dùng span riêng,
  // không dùng mặc định `PVP_CLEANSE_CHAMP_BPS` (75% ở cấp 10).
  const def = skillDef('hua-tuo');
  assert.equal(def.cleanse, true);
  assert.equal(def.purify, true, 'vẫn thanh tẩy debuff chỉ số (giữ choáng/thiêu đốt cho cleanse)');
  assert.equal(def.cleanseMinBps, 5500);
  assert.equal(def.cleanseMaxBps, 10000);
});

test('config: Thanh tẩy gỡ TỪNG lớp debuff theo tỉ lệ cấp × 7.5% (cấp 10 = 75%)', () => {
  // SKILLS.md mục 15: "gỡ lớp debuff theo tỉ lệ purifyBps" — trước đây gỡ 100% nên quá mạnh.
  const def = skillDef('zhang-lu');
  assert.equal(def.purify, true);
  assert.equal(pvpPurifyBps(def, 1), PVP_PURIFY_BPS_PER_LEVEL, 'cấp 1 = 7.5%');
  assert.equal(pvpPurifyBps(def, 10), 7500, 'cấp 10 = 75%');
  assert.equal(pvpPurifyBps(skillDef('guan-yu'), 10), 0, 'tướng không thanh tẩy thì tỉ lệ 0');
});

test('engine: Thanh tẩy gỡ debuff theo tỉ lệ — cấp 1 (7.5%) hụt, cấp 10 (75%) thành công (mục 15)', () => {
  // `never` luôn roll 5000 (50%): thấp hơn 75% nên cấp 10 gỡ được, nhưng cao hơn 7.5% nên cấp 1 hụt.
  const setup = (level: number) =>
    simulatePvp(
      [
        one('a', [
          { slot: 1, generalId: 'zhang-lu', level },
          { slot: 2, generalId: 'guan-yu', level: 10 },
        ]),
        one('b', [{ slot: 4, generalId: 'lu-xun', level: 10 }]),
      ],
      never,
    );
  const low = setup(1);
  assert.ok(low.events.some((e) => e.t === 'debuff' && e.hpFlat > 0), 'địch phải giảm HP tối đa đồng minh ta');
  assert.equal(low.events.some((e) => e.t === 'purify'), false, 'cấp 1 (7.5%) không gỡ được lớp nào khi roll 50%');
  const high = setup(10);
  assert.ok(high.events.some((e) => e.t === 'purify'), 'cấp 10 (75%) gỡ được khi roll 50% < 75%');
});

test('config: Xóa buff địch (dispel) theo tỉ lệ cấp × 7.5% (cấp 10 = 75%) — mục 14', () => {
  const def = skillDef('cao-cao');
  assert.equal(def.dispel, true);
  assert.equal(pvpDispelBps(def, 1), PVP_DISPEL_BPS_PER_LEVEL, 'cấp 1 = 7.5%');
  assert.equal(pvpDispelBps(def, 10), 7500, 'cấp 10 = 75%');
  assert.equal(pvpDispelBps(skillDef('guan-yu'), 10), 0, 'tướng không xóa buff thì tỉ lệ 0');
});

test('engine: hút máu — tướng hồi bản thân theo % sát thương gây ra (mục 6.5)', () => {
  // Dùng tướng hút máu MỐC CHUẨN (Tào Phi, 2%/cấp) — các tướng signature hút máu rất cao
  // (85%–100%) nên lượng hồi thường bị chặn bởi máu đã mất, không kiểm tra được đúng hệ số.
  const lsId = 'cao-pi';
  const foe = 'guan-yu';
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
  // Quan Vũ: đánh TƯỚNG ĐỊCH CÓ SÁT THƯƠNG CAO NHẤT 320%, tự buff +30 điểm chí mạng và +30% ST chí mạng.
  const gy = pvpProfile('guan-yu');
  assert.equal(gy.def.damageBps, 32000);
  assert.equal(gy.def.targeting, 'highest_damage_enemy');
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
  // Tôn Sách: AoE 105%, hút máu ĐỘI 1.5%/cấp (max 15%), tự giảm ST nhận 15%, phản kích đơn.
  const sc = pvpProfile('sun-ce');
  assert.equal(sc.def.damageBps, 10500);
  assert.equal(sc.def.targeting, 'all_enemies');
  assert.equal(sc.lifestealPerLevelBps, 0, 'Tôn Sách không còn hút máu cá nhân');
  assert.equal(sc.teamLifestealPerLevelBps, PVP_TEAM_LIFESTEAL_BPS_PER_LEVEL);
  assert.equal(sc.def.selfHealBps, 0);
  assert.equal(sc.def.buffs[0]!.buff.takenDownBps, 1500);
  assert.equal(sc.def.buffs[0]!.buff.damageBps, 0);
  assert.equal(sc.def.buffs[0]!.buff.defPenBps, 0);
  assert.equal(sc.def.counter.damageBps, 10000, 'phản kích đơn: 100% ST cơ bản');
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
  // Tào Tháo: AoE 75%, xóa buff địch theo tỉ lệ cấp (mục 14), buff ST toàn đội 20%, 5%-50% xóa khiên.
  const cc = pvpProfile('cao-cao');
  assert.equal(cc.def.damageBps, 7500);
  assert.equal(cc.def.dispel, true);
  assert.equal(pvpDispelBps(cc.def, 10), 7500);
  assert.equal(cc.def.buffs[0]!.buff.damageBps, 2000);
  assert.equal(cc.def.debuff.shieldBreakPerLevelBps, PVP_SHIELD_BREAK);
  // Trương Liêu: hàng ngang 225%, giảm ST địch 20%, hút máu 3%/cấp (max 30%), phản kích đơn (100% ST, không tự buff ST).
  const zl = pvpProfile('zhang-liao');
  assert.equal(zl.def.damageBps, 22500);
  assert.equal(zl.def.targeting, 'lane');
  assert.equal(zl.def.debuff.damageDownBps, 2000);
  assert.equal(zl.def.debuff.rounds, PVP_DEBUFF_ROUNDS, 'debuff không ghi số lượt mặc định 3 lượt');
  assert.equal(PVP_DEBUFF_ROUNDS, 3);
  assert.equal(zl.lifestealPerLevelBps, 300);
  assert.equal(zl.def.buffs.length, 0);
  assert.equal(zl.def.counter.scope, 'single');
  assert.equal(zl.def.counter.damageBps, 10000);
  // Lữ Bố: AoE 127%, tự buff chí mạng 20% + 20% ST chí mạng, hút máu 3%/cấp, phản kích đơn — KHÔNG còn choáng.
  const lb = pvpProfile('lu-bu');
  assert.equal(lb.def.damageBps, 12700);
  assert.equal(lb.def.targeting, 'all_enemies');
  assert.equal(lb.def.stun, 'none');
  assert.equal(lb.def.stunPerLevelBps, 0);
  assert.equal(lb.lifestealPerLevelBps, 300);
  assert.equal(lb.def.counter.scope, 'single');
  // Nhạc Tiến (Ngụy): signature hút máu — đánh đơn 270%, hút máu 8.5%/cấp (max 85%), tự tăng 10% HP tối đa.
  const yj = pvpProfile('yue-jin');
  assert.equal(yj.def.damageBps, 27000);
  assert.equal(yj.def.targeting, 'single');
  assert.equal(yj.lifestealPerLevelBps, 850);
  assert.equal(yj.def.dispel, false, 'Nhạc Tiến không còn xóa buff địch');
  assert.equal(yj.def.buffs[0]!.buff.hpBps, 1000);
  // Cam Ninh (Ngô): signature hút máu — đánh đơn 265%, hút máu 9.5%/cấp (max 95%), tự tăng 10% HP tối đa.
  const gn = pvpProfile('gan-ning');
  assert.equal(gn.def.damageBps, 26500);
  assert.equal(gn.def.targeting, 'single');
  assert.equal(gn.lifestealPerLevelBps, 950);
  assert.equal(gn.def.buffs[0]!.buff.hpBps, 1000);
  // Hoa Hùng (Quần): signature hút máu — đánh đơn 290%, hút máu 9%/cấp (max 90%), tự tăng 10% HP tối đa.
  const hx = pvpProfile('hua-xiong');
  assert.equal(hx.def.damageBps, 29000);
  assert.equal(hx.def.targeting, 'single');
  assert.equal(hx.lifestealPerLevelBps, 900);
  assert.equal(hx.def.buffs[0]!.buff.hpBps, 1000);
  // Tân Hiến Anh: AoE 55% + giải choáng & thiêu đốt.
  const xx = pvpProfile('xin-xianying');
  assert.equal(xx.def.damageBps, 5500);
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
  // Điêu Thuyền: đánh đơn 120%, choáng 10%/cấp (max 100%), kèm giảm sát thương địch 20%; nhắm tướng địch có sát thương cao nhất.
  const dc = pvpProfile('diao-chan');
  assert.equal(dc.def.damageBps, 12000);
  assert.equal(dc.def.targeting, 'highest_damage_enemy');
  assert.equal(dc.def.stunPerLevelBps, 1000);
  assert.equal(dc.def.debuff.damageDownBps, 2000);
  // Tào Hoa: đánh đơn hàng sau 110% + choáng 10%/cấp (max 100%).
  const ch = pvpProfile('cao-hua');
  assert.equal(ch.def.targeting, 'back_single');
  assert.equal(ch.def.damageBps, 11000);
  assert.equal(ch.def.stun, 'single');
  assert.equal(ch.def.stunPerLevelBps, 1000);
  assert.equal(ch.def.healBps, 0, 'không còn hồi máu');
  // Quách Gia: AoE 85% + giảm ST địch 10% + tăng 15% HP tối đa toàn đội.
  const gj = pvpProfile('guo-jia');
  assert.equal(gj.def.damageBps, 8500);
  assert.equal(gj.def.dispel, false);
  assert.equal(gj.def.buffs[0]!.buff.hpBps, 1500);
  assert.equal(gj.def.buffs[0]!.scope, 'all_allies');
  // Phản kích: Điển Vi đánh trả đơn 100% ST cơ bản, tỉ lệ 5%/cấp (trần 50% ở cấp 10).
  const dw = pvpProfile('dian-wei');
  assert.equal(dw.def.counter.damageBps, 10000);
  assert.equal(dw.def.counter.perLevelBps, 500);
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
    ['cao-cao', 7500],
    ['sima-yi', 12500],
    ['xin-xianying', 5500],
    ['zhuge-liang', 11000],
    ['sun-ce', 10500],
    ['zhou-yu', 11700],
    ['lu-bu', 12700],
    ['zhang-jiao', 10500],
    ['meng-huo', 10400],
    ['guo-jia', 8500],
    ['pang-tong', 8500],
    ['huang-yueying', 7500],
    ['zhong-hui', 10200],
    ['jiang-wei', 10200],
    ['ji-ling', 10000],
  ];
  for (const [id, bps] of aoes) {
    const d = skillDef(id);
    assert.equal(d.targeting, 'all_enemies', `${id} phải đánh toàn bộ địch`);
    assert.equal(d.damageBps, bps, `${id}: hệ số AoE chốt`);
  }
});

// ===================== Khiên (mục 16), Xóa Khiên (mục 17), Thiêu đốt (mục 8) =====================

type ShieldEv = Extract<PvpEventDto, { t: 'shield' }>;
const shieldEvents = (r: ReturnType<typeof simulatePvp>) => r.events.filter((e): e is ShieldEv => e.t === 'shield');

test('engine: Tôn Quyền tạo Khiên cho toàn đội bằng % HP tối đa (mục 16)', () => {
  const res = simulatePvp(
    [
      one('a', [
        { slot: 1, generalId: 'sun-quan', level: 10 },
        { slot: 2, generalId: 'cheng-pu', level: 10 },
      ]),
      one('b', [{ slot: 5, generalId: 'cheng-pu', level: 1 }]),
    ],
    never,
  );
  const aIdxs = res.units.filter((u) => u.side === 'a').map((u) => u.idx);
  const foeIdx = res.units.find((u) => u.side === 'b')!.idx;
  const evs = shieldEvents(res);
  for (const idx of aIdxs) {
    const mine = evs.filter((e) => e.idx === idx);
    assert.ok(mine.length > 0, `ô ${idx} phải được Tôn Quyền cấp Khiên`);
    assert.ok(mine.every((e) => e.from === res.units.find((u) => u.side === 'a' && u.slot === 1)!.idx), 'Khiên do chính Tôn Quyền tạo');
    assert.ok(mine[0]!.amount > 0, 'lượng Khiên phải > 0');
  }
  assert.ok(!evs.some((e) => e.idx === foeIdx), 'không cấp Khiên cho địch');
});

test('engine: Khiên hấp thụ sát thương trước khi trừ HP (mục 16)', () => {
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'sun-quan', level: 10 }]), one('b', [{ slot: 1, generalId: 'cao-pi', level: 10 }])],
    never,
  );
  const absorbed = res.events.filter((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && (e.absorbed ?? 0) > 0);
  assert.ok(absorbed.length > 0, 'phải có đòn bị Khiên hấp thụ');
  assert.ok(absorbed.every((e) => e.absorbed! <= e.amount), 'phần hấp thụ không vượt quá sát thương');
});

test('engine: Xóa Khiên bẻ gãy Khiên của mục tiêu trúng đòn (mục 17)', () => {
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'sun-quan', level: 10 }]), one('b', [{ slot: 1, generalId: 'xu-you', level: 10 }])],
    always0,
  );
  const aIdx = res.units.find((u) => u.side === 'a')!.idx;
  const bIdx = res.units.find((u) => u.side === 'b')!.idx;
  const broke = res.events.filter((e): e is Extract<PvpEventDto, { t: 'shieldBreak' }> => e.t === 'shieldBreak');
  assert.ok(broke.length > 0, 'Hứa Du phải phá được Khiên của Tôn Quyền');
  assert.ok(broke.every((e) => e.from === bIdx && e.idx === aIdx));
});

test('engine: mục tiêu đang Thiêu đốt chỉ hồi được 50% máu (mục 8)', () => {
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'cheng-pu', level: 10 }]), one('b', [{ slot: 1, generalId: 'zhou-yu', level: 10 }])],
    never,
  );
  const aIdx = res.units.find((u) => u.side === 'a')!.idx;
  const maxHp = res.units.find((u) => u.idx === aIdx)!.maxHp;
  // Trình Phổ tự hồi 15% HP tối đa mỗi lượt (hệ số chốt ở cấp 10) → bị Thiêu đốt cắt còn 50%.
  const raw = Math.round((maxHp * 1500) / BPS_SCALE);
  const cap = Math.round((raw * (BPS_SCALE - PVP_BURN_HEAL_DOWN_BPS)) / BPS_SCALE);
  const heals = res.events.filter((e): e is Extract<PvpEventDto, { t: 'heal' }> => e.t === 'heal' && e.from === aIdx);
  assert.ok(heals.length > 0, 'Trình Phổ phải tự hồi máu trong trận');
  assert.ok(heals.every((e) => e.amount <= cap), 'máu hồi khi bị Thiêu đốt không vượt 50% lượng hồi gốc');
  assert.ok(heals.some((e) => e.amount === cap), 'phải có lượt hồi chạm đúng mức 50%');
});

// ===================== Hệ thống Combat: Chính xác / Né tránh / Phòng thủ / Xuyên giáp (mục 18) =====================

/** RNG cố định: mọi lần gọi đều trả cùng giá trị `v` (kẹp < max) để kiểm tra đúng một ngưỡng. */
const fixedBelow = (v: number): RandomInt => (max) => Math.min(max - 1, v);

/** Tướng `idx` có gây được sát thương trực tiếp (đòn đánh / phản kích) trong trận hay không. */
const dealtDamage = (res: ReturnType<typeof simulatePvp>, idx: number) =>
  res.events.some((e) => (e.t === 'damage' || e.t === 'counter') && e.from === idx);

test('engine: BƯỚC 1 — Né thành công thì TRƯỢT: 0 sát thương, giữ nguyên Khiên & Máu (mục 18)', () => {
  // Lữ Mông đánh đơn, Tôn Quyền tạo Khiên cho toàn đội. RNG 9600 > 92.81% Trúng
  // (Chính xác 100% vs Né 20%, K = 3) nên mọi đòn TRƯỢT → không sát thương, Khiên lẫn Máu nguyên vẹn.
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'lu-meng', level: 10 }]), one('b', [{ slot: 1, generalId: 'sun-quan', level: 10 }])],
    fixedBelow(9600),
  );
  assert.ok(res.events.some((e) => e.t === 'miss'), 'phải phát sinh sự kiện TRƯỢT');
  assert.ok(res.events.some((e) => e.t === 'shield'), 'tiền đề: phe bị đánh đã được cấp Khiên');
  assert.ok(!res.events.some((e) => e.t === 'damage' || e.t === 'counter'), 'TRƯỢT thì không có sát thương nào');
  assert.ok(
    !res.events.some((e) => (e.t === 'damage' || e.t === 'counter') && (e.absorbed ?? 0) > 0),
    'TRƯỢT thì Khiên cũng không bị tiêu hao',
  );
});

test('engine: Né thành công thì miễn nhiễm CẢ choáng của chiêu (mục 18)', () => {
  // Cao Hoa: choáng đơn 100% ở cấp 10 (`stunPerLevelBps` 1000). Nếu engine roll choáng ĐỘC LẬP với
  // bước Trúng/Trượt thì RNG 96% luôn choáng. Nhưng Trúng thực tế chỉ ~92.8% (Chính xác 100% vs Né
  // 20%) nên đòn TRƯỢT → mục tiêu phải miễn nhiễm cả choáng (hết cảnh "né rồi mà vẫn bị choáng").
  const def = skillDef('cao-hua');
  assert.equal(def.stun, 'single');
  assert.equal(pvpPerLevelEffectBps(def.stunPerLevelBps, 10), 10000, 'tiền đề: choáng 100% ở cấp 10');
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'cao-hua', level: 10 }]), one('b', [{ slot: 4, generalId: 'sun-quan', level: 10 }])],
    fixedBelow(9600),
  );
  assert.ok(res.events.some((e) => e.t === 'miss'), 'đòn phải TRƯỢT');
  assert.equal(res.events.some((e) => e.t === 'stun'), false, 'TRƯỢT thì không được dính choáng');
});

test('engine: Né thành công thì miễn nhiễm mọi hiệu ứng bất lợi của chiêu — suy yếu & Thiêu đốt (mục 18)', () => {
  // Trương Giác (toàn bộ địch): suy yếu (giảm Chí mạng) + Thiêu đốt. Trước đây 2 hiệu ứng này được áp
  // KHÔNG qua bước Trúng/Trượt nên né được sát thương vẫn dính debuff; nay phải sạch hoàn toàn.
  const res = simulatePvp(
    [one('a', [{ slot: 1, generalId: 'zhang-jiao', level: 10 }]), one('b', [{ slot: 1, generalId: 'sun-quan', level: 10 }])],
    fixedBelow(9600),
  );
  const zj = res.units.find((u) => u.generalId === 'zhang-jiao')!.idx;
  assert.ok(res.events.some((e) => e.t === 'miss' && e.from === zj), 'đòn của Trương Giác phải TRƯỢT');
  assert.equal(
    res.events.some((e) => e.t === 'debuff' && e.from === zj),
    false,
    'TRƯỢT thì không dính suy yếu lẫn Thiêu đốt',
  );
  assert.equal(res.events.some((e) => e.t === 'burn'), false, 'TRƯỢT thì không có sát thương Thiêu đốt nào');
});

test('engine: BƯỚC 2 — Xuyên giáp triệt tiêu Phòng thủ; Phòng thủ cấp 10 (30%) giảm 30% sát thương (mục 18)', () => {
  // Đại Kiều không tự buff Phòng thủ → Phòng thủ nền theo cấp (cấp 10 = 30%); hai tướng cùng cấp 10 để so sánh công bằng.
  const target = 'da-qiao';
  const firstHit = (attacker: string, selfDamageBps = 0) => {
    const res = simulatePvp(
      [one('a', [{ slot: 1, generalId: attacker, level: 10 }]), one('b', [{ slot: 1, generalId: target, level: 10 }])],
      never,
    );
    const hit = res.events.find((e): e is Extract<PvpEventDto, { t: 'damage' }> => e.t === 'damage' && e.from === 0)!;
    const u = res.units.find((x) => x.idx === 0)!;
    // Sát thương hiệu dụng gồm cả lớp buff %ST do chính kỹ năng tự phát (lớp cộng thẳng theo damage nền).
    const dmg = u.damage + Math.round((u.damage * selfDamageBps) / BPS_SCALE);
    return { hit, raw: Math.round((dmg * skillDef(attacker).damageBps) / BPS_SCALE) };
  };
  // Hứa Chử: tự buff +20% sát thương và +20% Xuyên giáp (cấp 10) → Xuyên giáp ăn theo % của Giáp địch:
  // Phòng thủ 30% còn 30% × (1 − 20%) = 24% → nhận 76% sát thương gốc.
  const xu = firstHit('xu-chu', 2000);
  const xuDefFinal = Math.round((PVP_DEF_BPS * (BPS_SCALE - 2000)) / BPS_SCALE);
  assert.equal(xu.hit.amount, mitigated(xu.raw, xuDefFinal), 'Xuyên giáp 20% ăn theo % Giáp: Phòng thủ 30% còn 24%');
  assert.equal(xu.hit.mitigated, xu.raw - xu.hit.amount, 'hiệu số ghi vào sự kiện đúng bằng phần bị Phòng thủ cản lại');
  // Lữ Mông: Xuyên giáp 0% → giữ nguyên Phòng thủ 30% → chỉ nhận 70% sát thương gốc.
  const lu = firstHit('lu-meng');
  assert.ok(lu.hit.amount < lu.raw, 'Phòng thủ mặc định phải cản lại một phần sát thương');
  assert.equal(lu.hit.amount, Math.round((lu.raw * (BPS_SCALE - PVP_DEF_BPS)) / BPS_SCALE), 'chỉ nhận 70% sát thương gốc');
  assert.equal(lu.hit.mitigated, lu.raw - lu.hit.amount, 'hiệu số ghi vào sự kiện đúng bằng phần bị cản lại');
});

test('engine: BƯỚC 1 — Trúng/Né theo công thức chia trọng số K = 1.85, kẹp biên [69%, 99%] (mục 18)', () => {
  // Bảng tham chiếu: Hit_Real = clamp((Chính xác × 1.85) / (Chính xác × 1.85 + Né tránh) × 99%, 69%, 99%).
  assert.equal(pvpRealHitBps(8000, 200), 9768, 'cấp 1 cơ bản: 80% vs 2% → Trúng 97.68%');
  assert.equal(pvpRealHitBps(10000, 2000), 8934, 'cấp 10 bình thường: 100% vs 20% → Trúng 89.34%');
  assert.equal(pvpRealHitBps(10000, 3000), 8519, 'Hit Chuẩn vs Né Vừa: 100% vs 30% → Trúng 85.19%');
  assert.equal(pvpRealHitBps(12000, 5000), 8080, 'Hit Vừa vs Max Né: 120% vs 50% → Trúng 80.80%');
  assert.equal(pvpRealHitBps(15000, 200), 9829, 'Max Chính xác vs Né thường: 150% vs 2% → Trúng 98.29%');
  assert.equal(pvpRealHitBps(15000, 5000), 8389, 'Max Hit khắc chế Max Né: 150% vs 50% → Trúng 83.89%');
  assert.equal(pvpRealHitBps(10000, 5000), 7794, 'Max Né trừng phạt kẻ không build Chính xác: 100% vs 50% → Trúng 77.94%');
  assert.equal(pvpRealHitBps(10000, 0), 9900, 'Né 0 → trần Trúng 99%, vẫn luôn chừa 1% Né may mắn');
  assert.equal(pvpRealHitBps(4000, 5000), 6900, 'Chính xác bị Suy yếu nặng → chạm sàn Trúng 69% (Né thực tế ≤ 31%)');
  assert.equal(pvpRealHitBps(0, 0), 9900, 'cả hai bằng 0 → mặc định trần Trúng');

  // Engine thật: Lữ Mông (Chính xác 100%) vs Đại Kiều (Né 20%) ở cấp 10 → ngưỡng 8934 bps.
  const run = (r: number) =>
    dealtDamage(
      simulatePvp(
        [one('a', [{ slot: 1, generalId: 'lu-meng', level: 10 }]), one('b', [{ slot: 1, generalId: 'da-qiao', level: 10 }])],
        fixedBelow(r),
      ),
      0,
    );
  assert.equal(run(8933), true, '8933 < 8934 → TRÚNG');
  assert.equal(run(8934), false, '8934 ≥ 8934 → TRƯỢT (rơi vào vùng Né)');
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
  assert.ok(ov.team.lc > 0);
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
  // Hút máu khai báo dạng "mỗi cấp" nên quy theo cấp bằng công thức chung.
  assert.equal(c.self.lifestealBps, pvpPerLevelEffectBps(profile.lifestealPerLevelBps, 5));
  // ST chí mạng scale theo cấp (mục 7) — buff/debuff kỹ năng điều chỉnh quanh mốc này khi vào trận.
  assert.equal(c.self.critDamageBps, pvpCritDamageBps(5));
  assert.equal(c.bpsScale, BPS_SCALE);
  // Không truyền đội → không có Chỉ số Nền Ra Trận (Bộ Sưu Tập/Lobby giữ chỉ số gốc).
  assert.equal(c.preBattle, null);
  await app.close();
});

test('HTTP: chi tiết chiến đấu theo ĐỘI trả Chỉ số Nền Ra Trận preBattle (mục 1)', async () => {
  const { app, auth } = await setup();
  const g = ROSTER.find((x) => x.faction === 'shu' && pvpProfile(x.id).style !== 'support')!;
  const mates = ROSTER.filter((x) => x.id !== g.id && x.faction === 'shu').slice(0, 3).map((x) => x.id);
  const squad = [g.id, ...mates];
  const r = await app.inject({
    method: 'GET',
    url: `/api/pvp/generals/${g.id}/combat?level=5&squad=${squad.join(',')}`,
    headers: auth,
  });
  assert.equal(r.statusCode, 200);
  const c = r.json();
  assert.ok(c.preBattle, 'có đội thì phải trả Chỉ số Nền Ra Trận');
  assert.equal(c.preBattle.bonus.factionCount, 4, 'đếm đúng số tướng cùng phe');
  assert.equal(c.preBattle.bonus.factionHpBps, PVP_FACTION_HP_BPS[4]!);
  assert.equal(c.preBattle.bonus.rowHpBps, PVP_FRONT_HP_BPS, 'tướng ở vị trí đầu → hàng trước +5% Máu');
  assert.ok(c.preBattle.maxHp > c.base.maxHp, 'cọc Máu ra trận cao hơn chỉ số gốc');
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
  // Hệ số buff đã quy theo cấp của tướng (cấp 5) nên lấy định nghĩa kỹ năng TẠI CẤP.
  const b = pvpSkillDefAtLevel(skillDef(id), 5).buffs.find((e) => e.buff.hpBps > 0 && e.buff.damageBps > 0)!.buff;
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
  assert.ok(ok.json().lc > 0);
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
