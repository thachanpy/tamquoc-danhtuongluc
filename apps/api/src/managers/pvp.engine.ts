import type { PvpEventDto, PvpSide, PvpUnitStateDto, PvpWinner } from '@tq/shared';
import {
  BPS_SCALE,
  PVP_BACK_DAMAGE_BPS,
  PVP_CLEANSE_BPS_PER_LEVEL,
  PVP_CRIT_BPS_PER_LEVEL,
  PVP_CRIT_DAMAGE_BPS,
  PVP_FRONT_HP_BPS,
  PVP_MAX_ROUNDS,
  PVP_PASSIVE_EFFECT,
  PVP_SKILL_BUFF_CRIT_POINTS_BPS,
  PVP_SKILL_BUFF_DAMAGE_BPS,
  PVP_SKILL_DEF,
  pvpBaseDamage,
  pvpBaseHp,
  pvpLc,
  pvpProfile,
  type PvpProfile,
  type PvpTargeting,
  type RandomInt,
} from '@tq/game-config';

/**
 * Engine mô phỏng một trận PvP theo lượt (SKILLS.md). Hàm thuần: mọi ngẫu nhiên lấy từ `rand`
 * truyền vào nên kết quả tái dựng được từ cùng seed (mục 15).
 *
 * Server là nơi duy nhất quyết định thứ tự hành động, sát thương, chí mạng, choáng và thắng thua.
 * Trả về trạng thái đầu trận + danh sách sự kiện để client phát lại.
 */

export interface PvpUnitInput {
  slot: number;
  generalId: string;
  level: number;
}

export interface PvpSideInput {
  side: PvpSide;
  units: PvpUnitInput[];
}

export interface PvpSimResult {
  /** Trạng thái ĐẦU trận (hp = maxHp) để client dựng bàn đấu rồi áp sự kiện. */
  units: PvpUnitStateDto[];
  events: PvpEventDto[];
  winner: PvpWinner;
  rounds: number;
  reason: 'wipe' | 'timeout';
}

interface Unit {
  idx: number;
  side: PvpSide;
  slot: number;
  row: 'front' | 'back';
  lane: number;
  generalId: string;
  level: number;
  /** Hồ sơ chiến đấu (phong cách, kỹ năng, hệ số đã nhân hot) — SKILLS.md. */
  profile: PvpProfile;
  baseHp: number;
  baseDamage: number;
  maxHp: number;
  hp: number;
  /** Damage cơ bản sau khi cộng buff phần trăm (hệ số kỹ năng nhân sau). */
  damage: number;
  /** Damage cộng thẳng từ buff kỹ năng (percent_base_stat của chính mục tiêu). */
  flatBonus: number;
  critBps: number;
  stunBps: number;
  cleanseBps: number;
  lc: number;
  alive: boolean;
  stunned: boolean;
  /** Đã nhận buff kỹ năng đặc biệt — không cộng dồn lặp lại (mục 11.4). */
  buffed: boolean;
}

/** idx cố định theo slot để client đặt tướng vào lưới 3×2: A = 0–5, B = 6–11. */
const idxOf = (side: PvpSide, slot: number) => (side === 'a' ? slot - 1 : 6 + slot - 1);
const rowOf = (slot: number): 'front' | 'back' => (slot <= 3 ? 'front' : 'back');
const laneOf = (slot: number) => ((slot - 1) % 3) + 1;

export function simulatePvp(sides: PvpSideInput[], rand: RandomInt): PvpSimResult {
  const units: Unit[] = [];

  // 1) Khởi tạo chỉ số nền
  for (const s of sides) {
    for (const u of s.units) {
      const profile = pvpProfile(u.generalId);
      const baseHp = pvpBaseHp(u.level);
      const baseDamage = pvpBaseDamage(u.level);
      units.push({
        idx: idxOf(s.side, u.slot),
        side: s.side,
        slot: u.slot,
        row: rowOf(u.slot),
        lane: laneOf(u.slot),
        generalId: u.generalId,
        level: u.level,
        profile,
        baseHp,
        baseDamage,
        maxHp: baseHp,
        hp: baseHp,
        damage: baseDamage,
        flatBonus: 0,
        critBps: 0,
        stunBps: 0,
        cleanseBps: 0,
        lc: pvpLc(profile.style, u.level),
        alive: true,
        stunned: false,
        buffed: false,
      });
    }
  }

  // 2) Hiệu ứng nền theo KỸ NĂNG (SKILLS.md): tự buff bản thân (aura.*) + buff toàn đội (aura.team*)
  //    cho TẤT CẢ đồng minh gồm cả tướng sở hữu (không cộng dồn lặp lại — lấy giá trị lớn nhất);
  //    hàng trước +HP, hàng sau +damage (mục 2.3); nội tại tướng (mục 10.1).
  const auraOf = (u: Unit) => PVP_SKILL_DEF[u.profile.skill].aura;
  for (const side of ['a', 'b'] as const) {
    const mates = units.filter((u) => u.side === side);
    const teamDamageBps = Math.max(0, ...mates.map((u) => auraOf(u).teamDamageBps));
    const teamHpBps = Math.max(0, ...mates.map((u) => auraOf(u).teamHpBps));
    const teamCritPointsBps = Math.max(0, ...mates.map((u) => auraOf(u).teamCritPointsBps));
    for (const u of mates) {
      const aura = auraOf(u);
      const passiveEffect = PVP_PASSIVE_EFFECT[u.profile.passive];
      const damageBps =
        aura.damageBps +
        teamDamageBps +
        (u.row === 'back' ? PVP_BACK_DAMAGE_BPS : 0) +
        (passiveEffect.stat === 'damage' ? passiveEffect.bps : 0);
      const hpBps =
        aura.hpBps +
        teamHpBps +
        (u.row === 'front' ? PVP_FRONT_HP_BPS : 0) +
        (passiveEffect.stat === 'maxHp' ? passiveEffect.bps : 0);
      u.damage = Math.round(u.baseDamage * (1 + damageBps / BPS_SCALE));
      u.maxHp = Math.round(u.baseHp * (1 + hpBps / BPS_SCALE));
      u.hp = u.maxHp;
      u.critBps =
        u.level * PVP_CRIT_BPS_PER_LEVEL +
        teamCritPointsBps +
        (passiveEffect.stat === 'crit' ? passiveEffect.pointsBps : 0);
      u.stunBps = u.level * u.profile.stunPerLevelBps + (passiveEffect.stat === 'stun' ? passiveEffect.pointsBps : 0);
      u.cleanseBps = u.level * PVP_CLEANSE_BPS_PER_LEVEL + (passiveEffect.stat === 'cleanse' ? passiveEffect.pointsBps : 0);
    }
  }

  // Ảnh chụp đầu trận để client dựng giao diện.
  const snapshot: PvpUnitStateDto[] = units
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((u) => ({
      idx: u.idx,
      side: u.side,
      slot: u.slot,
      generalId: u.generalId,
      level: u.level,
      style: u.profile.style,
      skill: u.profile.skill,
      passive: u.profile.passive,
      maxHp: u.maxHp,
      hp: u.hp,
      lc: u.lc,
      critBps: u.critBps,
      stunBps: u.stunBps,
    }));

  const events: PvpEventDto[] = [];
  const aliveCount = (side: PvpSide) => units.reduce((n, u) => n + (u.side === side && u.alive ? 1 : 0), 0);
  const hpRatio = (side: PvpSide) => {
    const list = units.filter((u) => u.side === side);
    const max = list.reduce((s, u) => s + u.maxHp, 0);
    return max === 0 ? 0 : list.reduce((s, u) => s + u.hp, 0) / max;
  };

  // 3) Thứ tự hành động: LC giảm dần, bằng LC thì slot nhỏ trước, rồi phía A (mục 5.1, 5.2).
  const order = (list: Unit[]) =>
    list
      .slice()
      .sort((a, b) => b.lc - a.lc || a.slot - b.slot || (a.side === b.side ? 0 : a.side === 'a' ? -1 : 1));

  const enemiesOf = (u: Unit) => units.filter((x) => x.side !== u.side && x.alive).sort((a, b) => a.slot - b.slot);
  const alliesOf = (u: Unit) => units.filter((x) => x.side === u.side && x.alive).sort((a, b) => a.slot - b.slot);

  /** Chọn mục tiêu theo hệ tọa độ đội hình (mục 2.4, 13.1) — chỉ tướng còn sống. */
  function pickTargets(u: Unit, targeting: PvpTargeting): Unit[] {
    const enemies = enemiesOf(u);
    switch (targeting) {
      case 'single': {
        // Ưu tiên cùng lane (hàng trước trước), sau đó tới các lane khác theo slot.
        const sameLane = enemies.filter((e) => e.lane === u.lane);
        if (sameLane.length) return [sameLane[0]!];
        return enemies.length ? [enemies[0]!] : [];
      }
      case 'lane':
        return enemies.filter((e) => e.lane === u.lane);
      case 'row':
        return enemies.filter((e) => e.row === u.row);
      case 'back_row':
        return enemies.filter((e) => e.row === 'back');
      case 'all_enemies':
        return enemies;
      case 'all_allies':
        return alliesOf(u);
    }
  }

  function act(u: Unit): void {
    const def = PVP_SKILL_DEF[u.profile.skill];
    const targets = pickTargets(u, def.targeting);
    events.push({ t: 'act', idx: u.idx, skill: u.profile.skill, targets: targets.map((t) => t.idx) });

    // Kỹ năng buff (mục 11.2): không gây sát thương.
    if (def.buff) {
      for (const a of alliesOf(u)) {
        if (a.buffed) continue;
        a.buffed = true;
        a.flatBonus += Math.round((a.baseDamage * PVP_SKILL_BUFF_DAMAGE_BPS) / BPS_SCALE);
        a.critBps += PVP_SKILL_BUFF_CRIT_POINTS_BPS;
        events.push({ t: 'buff', idx: a.idx });
      }
      return;
    }

    // Sát thương (mục 6.2, 6.3): (damage cơ bản + buff) × hệ số kỹ năng (đã nhân hot), sau đó mới nhân chí mạng.
    if (def.damageBps > 0) {
      for (const t of targets) {
        const base = u.damage + u.flatBonus;
        let amount = Math.round((base * u.profile.damageBps) / BPS_SCALE);
        const crit = rand(BPS_SCALE) < u.critBps;
        if (crit) amount = Math.round((amount * (BPS_SCALE + PVP_CRIT_DAMAGE_BPS)) / BPS_SCALE);
        t.hp = Math.max(0, t.hp - amount);
        events.push({ t: 'damage', from: u.idx, idx: t.idx, amount, crit, hp: t.hp });
        if (t.hp === 0 && t.alive) {
          t.alive = false;
          events.push({ t: 'down', idx: t.idx });
        }
      }
    }

    // Hồi máu đồng minh (mục 6.4): không vượt HP tối đa. Hệ số đã nhân hot.
    if (def.healBps > 0) {
      for (const t of targets) {
        const heal = Math.round((u.damage * u.profile.healBps) / BPS_SCALE);
        const before = t.hp;
        t.hp = Math.min(t.maxHp, t.hp + heal);
        if (t.hp > before) events.push({ t: 'heal', from: u.idx, idx: t.idx, amount: t.hp - before, hp: t.hp });
      }
    }

    // Tự hồi máu cho bản thân theo HP tối đa (SELF_HEAL) — hệ số đã nhân hot.
    if (def.selfHealBps > 0) {
      const heal = Math.round((u.maxHp * u.profile.selfHealBps) / BPS_SCALE);
      const before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + heal);
      if (u.hp > before) events.push({ t: 'heal', from: u.idx, idx: u.idx, amount: u.hp - before, hp: u.hp });
    }

    // Choáng (mục 8.3): chỉ áp cho mục tiêu còn sống, kiểm tra riêng từng mục tiêu.
    if (def.stun !== 'none') {
      for (const t of targets) {
        if (!t.alive) continue;
        if (rand(BPS_SCALE) < u.stunBps) {
          t.stunned = true;
          events.push({ t: 'stun', idx: t.idx });
        }
      }
    }

    // Giải choáng (mục 9): kiểm tra riêng từng đồng minh đang bị choáng.
    if (def.cleanse) {
      for (const a of alliesOf(u)) {
        if (!a.stunned) continue;
        if (rand(BPS_SCALE) < u.cleanseBps) {
          a.stunned = false;
          events.push({ t: 'cleanse', idx: a.idx });
        }
      }
    }
  }

  // 4) Vòng đấu
  let rounds = 0;
  let reason: 'wipe' | 'timeout' = 'wipe';
  let winner: PvpWinner = 'draw';

  if (aliveCount('a') === 0 || aliveCount('b') === 0) {
    winner = aliveCount('a') === 0 && aliveCount('b') === 0 ? 'draw' : aliveCount('a') === 0 ? 'b' : 'a';
  } else {
    for (let r = 1; r <= PVP_MAX_ROUNDS; r++) {
      rounds = r;
      events.push({ t: 'round', round: r });
      for (const u of order(units.filter((x) => x.alive))) {
        if (aliveCount('a') === 0 || aliveCount('b') === 0) break;
        if (!u.alive) continue;
        if (u.stunned) {
          // Choáng một lượt: bỏ lượt này rồi hết hiệu lực (mục 5.3).
          u.stunned = false;
          events.push({ t: 'skip', idx: u.idx });
          continue;
        }
        act(u);
      }
      if (aliveCount('a') === 0 || aliveCount('b') === 0) break;
      if (r === PVP_MAX_ROUNDS) reason = 'timeout';
    }

    const aAlive = aliveCount('a');
    const bAlive = aliveCount('b');
    if (aAlive === 0 && bAlive === 0) winner = 'draw';
    else if (aAlive === 0) winner = 'b';
    else if (bAlive === 0) winner = 'a';
    else {
      // Quá số vòng: xét theo tổng % HP còn lại (mục 14).
      const ra = hpRatio('a');
      const rb = hpRatio('b');
      winner = ra > rb ? 'a' : rb > ra ? 'b' : 'draw';
    }
  }

  events.push({ t: 'end', winner, rounds, reason });
  return { units: snapshot, events, winner, rounds, reason };
}
