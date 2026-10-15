import type { PvpEventDto, PvpSide, PvpSkill, PvpUnitStateDto, PvpWinner } from '@tq/shared';
import {
  BPS_SCALE,
  PVP_BACK_DAMAGE_BPS,
  PVP_CLEANSE_BASE_BPS,
  PVP_CLEANSE_BPS_PER_LEVEL,
  PVP_CRIT_BPS_PER_LEVEL,
  PVP_CRIT_DAMAGE_BPS,
  PVP_FRONT_HP_BPS,
  PVP_MAX_ROUNDS,
  PVP_PASSIVE_EFFECT,
  PVP_SKILL_BUFF_MAX_LAYERS,
  PVP_SKILL_BUFF_ROUNDS,
  PVP_SKILL_DEF,
  PVP_STUN_ROUNDS,
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
  /** Trần HP cố định khi vào trận (nền × hệ số hàng/nội tại) — buff HP sẽ cộng thêm lên trên. */
  maxHpStatic: number;
  maxHp: number;
  hp: number;
  /** Damage cơ bản sau khi cộng hệ số hàng/nội tại (hệ số kỹ năng nhân sau). */
  damage: number;
  critBps: number;
  stunBps: number;
  cleanseBps: number;
  /** Hút máu: hồi bản thân theo % sát thương gây ra ở cấp hiện tại (bps; 0 = không hút máu). */
  lifestealBps: number;
  lc: number;
  alive: boolean;
  stunned: boolean;
  /** Lượt cuối còn bị choáng (0 = không bị choáng); đầu lượt sau mốc này thì tự hết (mục 5.3). */
  stunnedUntil: number;
  /** Các lớp buff tăng sức mạnh đang hiệu lực — cộng dồn, hết hạn sau vài lượt. */
  buffs: BuffInstance[];
}

/**
 * Một lớp buff tăng sức mạnh do kỹ năng phát cho đồng minh, sống tới hết `expiresRound`:
 * cộng thẳng sát thương, tăng trần HP (đồng thời hồi lượng tăng) và điểm chí mạng.
 */
interface BuffInstance {
  /** Damage cộng thẳng (theo damage nền của chính tướng được buff). */
  damageFlat: number;
  /** Trần HP cộng thẳng (theo HP nền của chính tướng được buff); cũng là lượng hồi khi nhận lớp. */
  hpFlat: number;
  /** Điểm chí mạng cộng thêm (bps). */
  critBps: number;
  /** Lượt cuối còn hiệu lực (tính theo số vòng). */
  expiresRound: number;
}

/** idx cố định theo slot để client đặt tướng vào lưới 3×2: A = 0–5, B = 6–11. */
const idxOf = (side: PvpSide, slot: number) => (side === 'a' ? slot - 1 : 6 + slot - 1);
const rowOf = (slot: number): 'front' | 'back' => (slot <= 3 ? 'front' : 'back');
const laneOf = (slot: number) => ((slot - 1) % 3) + 1;

/** DTO buff tăng sức mạnh của một kỹ năng (kèm số lượt/số lớp) để client mô tả khi tướng thi triển. */
const teamBuffDtoOf = (skill: PvpSkill) => {
  const tb = PVP_SKILL_DEF[skill].teamBuff;
  return { damageBps: tb.damageBps, hpBps: tb.hpBps, critPointsBps: tb.critPointsBps, rounds: PVP_SKILL_BUFF_ROUNDS, maxLayers: PVP_SKILL_BUFF_MAX_LAYERS };
};
/** Kỹ năng có phát buff tăng sức mạnh cho đồng minh hay không. */
const hasTeamBuff = (skill: PvpSkill) => {
  const tb = PVP_SKILL_DEF[skill].teamBuff;
  return tb.damageBps > 0 || tb.hpBps > 0 || tb.critPointsBps > 0;
};
/** Tướng sở hữu kỹ năng giải choáng thì MIỄN NHIỄM choáng (không bao giờ bị choáng). */
const isStunImmune = (skill: PvpSkill) => PVP_SKILL_DEF[skill].cleanse;

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
        maxHpStatic: baseHp,
        maxHp: baseHp,
        hp: baseHp,
        damage: baseDamage,
        critBps: 0,
        stunBps: 0,
        cleanseBps: 0,
        lifestealBps: 0,
        lc: pvpLc(profile.style, u.level),
        alive: true,
        stunned: false,
        stunnedUntil: 0,
        buffs: [],
      });
    }
  }

  // 2) Chỉ số cố định khi vào trận: hàng trước +HP, hàng sau +damage (mục 2.3); nội tại tướng (mục 10.1).
  //    Buff tăng sức mạnh theo kỹ năng (TEAM_*/BUFF_ALLIES) KHÔNG còn áp trước trận mà phát dần mỗi lượt
  //    trong act() dưới dạng các lớp cộng dồn.
  for (const u of units) {
    const passiveEffect = PVP_PASSIVE_EFFECT[u.profile.passive];
    const damageBps = (u.row === 'back' ? PVP_BACK_DAMAGE_BPS : 0) + (passiveEffect.stat === 'damage' ? passiveEffect.bps : 0);
    const hpBps = (u.row === 'front' ? PVP_FRONT_HP_BPS : 0) + (passiveEffect.stat === 'maxHp' ? passiveEffect.bps : 0);
    u.damage = Math.round(u.baseDamage * (1 + damageBps / BPS_SCALE));
    u.maxHpStatic = Math.round(u.baseHp * (1 + hpBps / BPS_SCALE));
    u.maxHp = u.maxHpStatic;
    u.hp = u.maxHp;
    u.critBps = u.level * PVP_CRIT_BPS_PER_LEVEL + (passiveEffect.stat === 'crit' ? passiveEffect.pointsBps : 0);
    u.stunBps = u.level * u.profile.stunPerLevelBps + (passiveEffect.stat === 'stun' ? passiveEffect.pointsBps : 0);
    // Hút máu theo cấp (mục 6.5): cấp × hệ số mỗi cấp.
    u.lifestealBps = u.level * u.profile.lifestealPerLevelBps;
    // Giải choáng theo cấp: mốc nền 30% + 5%/cấp (kể cả nội tại CLEANSE_10 đã gộp vào mốc nền).
    u.cleanseBps = PVP_CLEANSE_BASE_BPS + (u.level - 1) * PVP_CLEANSE_BPS_PER_LEVEL + (passiveEffect.stat === 'cleanse' ? passiveEffect.pointsBps : 0);
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
      skillName: u.profile.skillName,
      passive: u.profile.passive,
      maxHp: u.maxHp,
      hp: u.hp,
      damage: u.damage,
      lc: u.lc,
      critBps: u.critBps,
      stunBps: u.stunBps,
      lifestealBps: u.lifestealBps,
      // Buff tăng sức mạnh theo kỹ năng (client hiện lượng tăng khi tướng thi triển, mục 6.7).
      teamBuff: teamBuffDtoOf(u.profile.skill),
    }));

  const events: PvpEventDto[] = [];
  const aliveCount = (side: PvpSide) => units.reduce((n, u) => n + (u.side === side && u.alive ? 1 : 0), 0);

  // 3) Thứ tự hành động (mục 5.1): hai đội LUÂN PHIÊN nhau, bên có TỔNG lực chiến cao hơn đi trước.
  //    Trong một vòng, bên đi trước mở màn bằng tướng CÒN SỐNG gần nhất của mình, rồi hai bên
  //    luân phiên nhau theo danh sách tướng còn sống (xếp theo vị trí tăng dần).
  //    Đủ 6 vs 6: A1, B1, A2, B2… tới A6, B6. Nếu A1 đã gục thì vòng đó là A2, B1, A3, B2…
  //    (bên đi trước giữ quyền mở màn, không bị đối thủ chen lên vì một vị trí đã mất).
  const totalLc = (side: PvpSide) => units.reduce((s, u) => s + (u.side === side ? u.lc : 0), 0);
  const firstSide: PvpSide = totalLc('b') > totalLc('a') ? 'b' : 'a';
  const order = (list: Unit[]) => {
    const bySide = (side: PvpSide) => list.filter((u) => u.side === side).sort((a, b) => a.slot - b.slot);
    const lead = bySide(firstSide);
    const other = bySide(firstSide === 'a' ? 'b' : 'a');
    const out: Unit[] = [];
    for (let i = 0; i < Math.max(lead.length, other.length); i++) {
      const a = lead[i];
      const b = other[i];
      if (a) out.push(a);
      if (b) out.push(b);
    }
    return out;
  };

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
      case 'lowest_ally': {
        // Đồng minh thấp máu nhất theo tỉ lệ HP hiện tại (bằng nhau thì slot nhỏ trước).
        const mates = alliesOf(u);
        if (!mates.length) return [];
        return [mates.reduce((lo, m) => (m.hp / m.maxHp < lo.hp / lo.maxHp ? m : lo))];
      }
      case 'front_allies':
        return alliesOf(u).filter((a) => a.row === 'front');
      case 'back_allies':
        return alliesOf(u).filter((a) => a.row === 'back');
    }
  }

  /** Damage cộng thẳng từ các lớp buff đang hiệu lực (theo damage nền của chính tướng). */
  const buffDamage = (u: Unit) => u.buffs.reduce((s, b) => s + b.damageFlat, 0);
  /** Điểm chí mạng cộng thêm từ các lớp buff đang hiệu lực. */
  const critBpsOf = (u: Unit) => u.critBps + u.buffs.reduce((s, b) => s + b.critBps, 0);
  /**
   * Đồng bộ trần HP động theo các lớp buff đang hiệu lực: trần = trần tĩnh + tổng HP cộng thêm.
   * Trần tăng thì HỒI đúng lượng tăng; trần giảm thì kẹp máu hiện tại xuống trần mới.
   * Trả về lượng máu hồi thêm (>0 khi trần tăng).
   */
  const syncMaxHp = (u: Unit): number => {
    const before = u.maxHp;
    u.maxHp = u.maxHpStatic + u.buffs.reduce((s, b) => s + b.hpFlat, 0);
    const delta = u.maxHp - before;
    if (delta > 0) u.hp = Math.min(u.maxHp, u.hp + delta);
    else if (delta < 0) u.hp = Math.min(u.hp, u.maxHp);
    return Math.max(0, delta);
  };

  function act(u: Unit, round: number): void {
    const def = PVP_SKILL_DEF[u.profile.skill];
    const targets = pickTargets(u, def.targeting);
    events.push({ t: 'act', idx: u.idx, skill: u.profile.skill, targets: targets.map((t) => t.idx) });

    // Buff tăng sức mạnh (mục 11.2): mỗi lần tới lượt phát MỘT lớp cho mọi đồng minh còn sống (kể cả
    // bản thân). Các lớp cộng dồn tối đa PVP_SKILL_BUFF_MAX_LAYERS (lớp mới nhất thay lớp cũ nhất),
    // mỗi lớp hiệu lực PVP_SKILL_BUFF_ROUNDS lượt. % HP và % sát thương ăn chí mạng (×1.5) theo MỘT
    // lần roll chung cho cả lớp; điểm chí mạng giữ nguyên. Tướng nhóm TEAM_* sau đó vẫn đánh thường.
    if (hasTeamBuff(u.profile.skill)) {
      const tb = def.teamBuff;
      const crit = rand(BPS_SCALE) < critBpsOf(u);
      const critMul = crit ? (BPS_SCALE + PVP_CRIT_DAMAGE_BPS) / BPS_SCALE : 1;
      const damageBps = Math.round(tb.damageBps * critMul);
      const hpBps = Math.round(tb.hpBps * critMul);
      const expiresRound = round + PVP_SKILL_BUFF_ROUNDS - 1;
      for (const a of alliesOf(u)) {
        // Lượng cộng thẳng tính theo chỉ số nền của CHÍNH tướng được buff (khớp buffDamage()).
        const damageFlat = Math.round((a.damage * damageBps) / BPS_SCALE);
        const hpFlat = Math.round((a.maxHpStatic * hpBps) / BPS_SCALE);
        a.buffs.push({ damageFlat, hpFlat, critBps: tb.critPointsBps, expiresRound });
        if (a.buffs.length > PVP_SKILL_BUFF_MAX_LAYERS) a.buffs.shift();
        syncMaxHp(a);
        events.push({
          t: 'buff',
          idx: a.idx,
          damageBps,
          hpBps,
          critPointsBps: tb.critPointsBps,
          damageFlat,
          hpFlat,
          crit,
          expiresRound,
          maxLayers: PVP_SKILL_BUFF_MAX_LAYERS,
        });
      }
    }

    // Sát thương (mục 6.2, 6.3): (damage cơ bản + buff) × hệ số kỹ năng (đã nhân hot), sau đó mới nhân chí mạng.
    let dealt = 0;
    if (def.damageBps > 0) {
      for (const t of targets) {
        const base = u.damage + buffDamage(u);
        let amount = Math.round((base * u.profile.damageBps) / BPS_SCALE);
        const crit = rand(BPS_SCALE) < critBpsOf(u);
        if (crit) amount = Math.round((amount * (BPS_SCALE + PVP_CRIT_DAMAGE_BPS)) / BPS_SCALE);
        t.hp = Math.max(0, t.hp - amount);
        dealt += amount;
        events.push({ t: 'damage', from: u.idx, idx: t.idx, amount, crit, hp: t.hp });
        if (t.hp === 0 && t.alive) {
          t.alive = false;
          events.push({ t: 'down', idx: t.idx });
        }
      }
    }

    // Hút máu (mục 6.5): vài tướng hồi cho bản thân theo % tổng sát thương vừa gây ra. Cũng có chí mạng.
    if (u.lifestealBps > 0 && dealt > 0) {
      let heal = Math.round((dealt * u.lifestealBps) / BPS_SCALE);
      const crit = rand(BPS_SCALE) < critBpsOf(u);
      if (crit) heal = Math.round((heal * (BPS_SCALE + PVP_CRIT_DAMAGE_BPS)) / BPS_SCALE);
      const before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + heal);
      if (u.hp > before) events.push({ t: 'heal', from: u.idx, idx: u.idx, amount: u.hp - before, crit, hp: u.hp });
    }

    // Hồi máu đồng minh (mục 6.4): không vượt HP tối đa. Hệ số đã nhân hot.
    // Hồi máu cũng có thể chí mạng (×1.5) theo tỉ lệ chí mạng của người thi triển.
    if (def.healBps > 0) {
      for (const t of targets) {
        let heal = Math.round((u.damage * u.profile.healBps) / BPS_SCALE);
        const crit = rand(BPS_SCALE) < critBpsOf(u);
        if (crit) heal = Math.round((heal * (BPS_SCALE + PVP_CRIT_DAMAGE_BPS)) / BPS_SCALE);
        const before = t.hp;
        t.hp = Math.min(t.maxHp, t.hp + heal);
        if (t.hp > before) events.push({ t: 'heal', from: u.idx, idx: t.idx, amount: t.hp - before, crit, hp: t.hp });
      }
    }

    // Tự hồi máu cho bản thân theo HP tối đa (SELF_HEAL) — hệ số đã nhân hot; cũng có chí mạng.
    if (def.selfHealBps > 0) {
      let heal = Math.round((u.maxHp * u.profile.selfHealBps) / BPS_SCALE);
      const crit = rand(BPS_SCALE) < critBpsOf(u);
      if (crit) heal = Math.round((heal * (BPS_SCALE + PVP_CRIT_DAMAGE_BPS)) / BPS_SCALE);
      const before = u.hp;
      u.hp = Math.min(u.maxHp, u.hp + heal);
      if (u.hp > before) events.push({ t: 'heal', from: u.idx, idx: u.idx, amount: u.hp - before, crit, hp: u.hp });
    }

    // Choáng (mục 8.3): chỉ áp cho mục tiêu còn sống, kiểm tra riêng từng mục tiêu.
    // Tướng có kỹ năng giải choáng MIỄN NHIỄM choáng nên bị bỏ qua (mục 9).
    // Choáng kéo dài PVP_STUN_ROUNDS lượt kể cả lượt thi triển (gây ở lượt r → tới hết lượt r+1).
    // Mục tiêu đang choáng thì KHÔNG choáng chồng, nhờ vậy không bao giờ bị choáng quá 2 lượt liên tiếp.
    if (def.stun !== 'none') {
      for (const t of targets) {
        if (!t.alive || t.stunned || isStunImmune(t.profile.skill)) continue;
        if (rand(BPS_SCALE) < u.stunBps) {
          t.stunned = true;
          t.stunnedUntil = round + PVP_STUN_ROUNDS - 1;
          events.push({ t: 'stun', idx: t.idx, untilRound: t.stunnedUntil });
        }
      }
    }

    // Giải choáng (mục 9): kiểm tra riêng từng đồng minh đang bị choáng.
    if (def.cleanse) {
      for (const a of alliesOf(u)) {
        if (!a.stunned) continue;
        if (rand(BPS_SCALE) < u.cleanseBps) {
          a.stunned = false;
          a.stunnedUntil = 0;
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
      // Hết hạn buff chủ động của lượt trước (lớp buff sống đúng PVP_SKILL_BUFF_ROUNDS lượt).
      // Lớp hết hạn làm trần HP tụt xuống nên phải đồng bộ lại (kẹp máu hiện tại theo trần mới).
      for (const u of units) {
        if (!u.buffs.length) continue;
        const kept = u.buffs.filter((b) => b.expiresRound >= r);
        if (kept.length === u.buffs.length) continue;
        u.buffs = kept;
        syncMaxHp(u);
      }
      // Hết hạn choáng ở ĐẦU lượt: choáng gây ở lượt r sống tới hết lượt r+1, sang lượt r+2 là hết (mục 5.3).
      for (const u of units) if (u.stunned && r > u.stunnedUntil) u.stunned = false;
      events.push({ t: 'round', round: r });
      for (const u of order(units.filter((x) => x.alive))) {
        if (aliveCount('a') === 0 || aliveCount('b') === 0) break;
        if (!u.alive) continue;
        if (u.stunned) {
          // Đang choáng: bỏ lượt này; choáng tự hết ở đầu lượt sau mốc `stunnedUntil` (mục 5.3).
          events.push({ t: 'skip', idx: u.idx });
          continue;
        }
        act(u, r);
      }
      if (aliveCount('a') === 0 || aliveCount('b') === 0) break;
      if (r === PVP_MAX_ROUNDS) reason = 'timeout';
    }

    const aAlive = aliveCount('a');
    const bAlive = aliveCount('b');
    if (aAlive === 0 && bAlive === 0) winner = 'draw';
    else if (aAlive === 0) winner = 'b';
    else if (bAlive === 0) winner = 'a';
    // Hết PVP_MAX_ROUNDS mà chưa bên nào bị xóa sổ (timeout) → hai đội hoà nhau (mục 14).
    else winner = 'draw';
  }

  events.push({ t: 'end', winner, rounds, reason });
  return { units: snapshot, events, winner, rounds, reason };
}
