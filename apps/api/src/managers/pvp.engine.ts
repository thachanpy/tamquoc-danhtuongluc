import type { PvpBuffScope, PvpEventDto, PvpSide, PvpUnitStateDto, PvpWinner } from '@tq/shared';
import {
  BPS_SCALE,
  PVP_BACK_DAMAGE_BPS,
  PVP_BURN_BPS,
  PVP_BURN_LIFESTEAL_BPS,
  PVP_BURN_MAX_LAYERS_LONG,
  PVP_CLEANSE_CHAMP_BPS,
  PVP_COUNTER_MAX_BPS,
  PVP_CRIT_BPS_PER_LEVEL,
  PVP_CRIT_DAMAGE_BPS,
  PVP_FRONT_HP_BPS,
  PVP_MAXHP_GAIN_HEAL_BPS,
  PVP_MAX_ROUNDS,
  PVP_PASSIVE_EFFECT,
  PVP_REVIVE_DAMAGE_DOWN_BPS,
  PVP_REVIVE_HP_BPS_PER_LEVEL,
  isAllyTargeting,
  pvpBaseDamage,
  pvpBaseHp,
  pvpEffectBps,
  pvpLc,
  pvpPerLevelEffectBps,
  pvpProfile,
  pvpSkillDefAtLevel,
  pvpStyleBonus,
  type PvpProfile,
  type PvpSkillDef,
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
  /** Định nghĩa kỹ năng TẠI CẤP của tướng: mọi hệ số hiệu ứng (buff/hồi/debuff/…) đã quy theo cấp. */
  def: PvpSkillDef;
  baseHp: number;
  baseDamage: number;
  /** Trần HP cố định khi vào trận (nền × hệ số hàng/nội tại) — buff HP sẽ cộng thêm lên trên. */
  maxHpStatic: number;
  maxHp: number;
  hp: number;
  /** Damage cơ bản sau khi cộng hệ số hàng/nội tại (hệ số kỹ năng nhân sau). */
  damage: number;
  critBps: number;
  /** ST chí mạng nền (bps cộng thêm khi chí mạng; mặc định 5000 = 150%). */
  critDamageBps: number;
  stunBps: number;
  cleanseBps: number;
  /** Hút máu: hồi bản thân theo % sát thương gây ra ở cấp hiện tại (bps; 0 = không hút máu). */
  lifestealBps: number;
  /** Đã dùng lượt Hồi sinh chưa (chỉ 1 lần/trận). */
  reviveUsed: boolean;
  /** Hệ số nhân sát thương gây ra (bps): 10000 bình thường, giảm còn 5000 sau khi Hồi sinh. */
  damageMulBps: number;
  lc: number;
  alive: boolean;
  /**
   * Choáng: idx của tướng gây choáng GẦN NHẤT (null = không bị choáng). Choáng duy trì tới khi
   * chính tướng đó ra skill ở lượt kế tiếp; choáng mới của tướng khác sẽ đè/nối tiếp (mục 6).
   */
  stunnedByIdx: number | null;
  /** Các lớp buff tăng sức mạnh đang hiệu lực — cộng dồn, hết hạn sau vài lượt. */
  buffs: BuffInstance[];
  /** Các lớp hiệu ứng suy yếu đang chịu — cộng dồn, hết hạn sau vài lượt (phe Ngụy). */
  debuffs: DebuffInstance[];
  /** Các lớp Thiêu đốt đang chịu — trần cộng dồn tính riêng theo TỪNG nguồn, không có trần toàn hệ thống (mục 8). */
  burns: BurnInstance[];
}

/**
 * Một lớp buff tăng sức mạnh do kỹ năng phát cho đồng minh, sống tới hết `expiresRound`:
 * cộng thẳng sát thương, tăng trần HP (đồng thời hồi lượng tăng), điểm chí mạng, ST chí mạng
 * và giảm sát thương gánh chịu.
 */
interface BuffInstance {
  /** idx của tướng phát lớp buff — dùng để giới hạn số lớp cộng dồn theo TỪNG nguồn. */
  sourceIdx: number;
  /**
   * Chỉ số KÊNH buff trong kỹ năng của nguồn (0, 1, …). Trần `maxLayers` tính riêng cho từng
   * (nguồn, kênh) nên tướng có nhiều kênh (vừa buff chỉ số vừa ban hút máu) không đè lớp của nhau.
   */
  channel: number;
  /** Damage cộng thẳng (theo damage nền của chính tướng được buff). */
  damageFlat: number;
  /** Trần HP cộng thẳng (theo HP nền của chính tướng được buff); cũng là lượng hồi khi nhận lớp. */
  hpFlat: number;
  /** Điểm chí mạng cộng thêm (bps). */
  critBps: number;
  /** ST chí mạng cộng thêm (bps). */
  critDamageBps: number;
  /** % sát thương gánh chịu được giảm (bps). */
  takenDownBps: number;
  /** % hút máu cộng thêm (bps): hồi bản thân theo sát thương gây ra (đoàn buff hỗ trợ). */
  lifestealBps: number;
  /** Lượt cuối còn hiệu lực (tính theo số vòng). */
  expiresRound: number;
}

/**
 * Một lớp hiệu ứng suy yếu do kỹ năng áp lên mục tiêu địch, sống tới hết `expiresRound`:
 * giảm sát thương mục tiêu gây ra, giảm trần HP, giảm điểm chí mạng và/hoặc giảm ST chí mạng.
 */
interface DebuffInstance {
  /** idx của tướng áp lớp suy yếu — dùng để giới hạn số lớp cộng dồn theo TỪNG nguồn. */
  sourceIdx: number;
  /** Giảm sát thương mục tiêu gây ra (cộng thẳng, tính theo damage nền của chính mục tiêu). */
  damageDownFlat: number;
  /** Trần HP bị giảm (cộng thẳng, tính theo HP nền của chính mục tiêu). */
  hpDownFlat: number;
  /** Điểm chí mạng bị giảm (bps). */
  critDownBps: number;
  /** ST chí mạng bị giảm (bps). */
  critDamageDownBps: number;
  /** Lượt cuối còn hiệu lực (tính theo số vòng). */
  expiresRound: number;
}

/** Một lớp Thiêu đốt: gây `amount` sát thương vào đầu mỗi lượt của mục tiêu. */
interface BurnInstance {
  /** idx của tướng gây thiêu đốt — dùng để giới hạn số lớp cộng dồn theo TỪNG nguồn. */
  sourceIdx: number;
  /** Sát thương mỗi lượt (cộng thẳng). */
  amount: number;
  /** Lượt cuối còn hiệu lực (tính theo số vòng). */
  expiresRound: number;
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
        def: pvpSkillDefAtLevel(profile.def, u.level),
        baseHp,
        baseDamage,
        maxHpStatic: baseHp,
        maxHp: baseHp,
        hp: baseHp,
        damage: baseDamage,
        critBps: 0,
        critDamageBps: PVP_CRIT_DAMAGE_BPS,
        stunBps: 0,
        cleanseBps: 0,
        lifestealBps: 0,
        reviveUsed: false,
        damageMulBps: BPS_SCALE,
        lc: pvpLc(profile.style, u.level),
        alive: true,
        stunnedByIdx: null,
        buffs: [],
        debuffs: [],
        burns: [],
      });
    }
  }

  // 2) Chỉ số cố định khi vào trận: hàng trước +HP, hàng sau +damage (mục 2.3); nội tại tướng (mục 10.1);
  //    nội tại theo phong cách (mục 1): Tấn công +25% ST bản thân, Phòng thủ +25% HP bản thân,
  //    Hỗ trợ phát aura +10% HP & +10% ST cho TOÀN ĐỘI mỗi tướng Hỗ trợ (trần 3 lớp).
  //    Buff tăng sức mạnh theo kỹ năng KHÔNG áp trước trận mà phát dần mỗi lượt trong act().
  const supportLayersOf = (side: PvpSide) =>
    units.reduce((n, x) => n + (x.side === side && x.profile.style === 'support' ? 1 : 0), 0);
  for (const u of units) {
    const passiveEffect = PVP_PASSIVE_EFFECT[u.profile.passive];
    const style = pvpStyleBonus(u.profile.style, supportLayersOf(u.side));
    const damageBps =
      (u.row === 'back' ? PVP_BACK_DAMAGE_BPS : 0) +
      (passiveEffect.stat === 'damage' ? passiveEffect.bps : 0) +
      style.damageBps;
    const hpBps =
      (u.row === 'front' ? PVP_FRONT_HP_BPS : 0) + (passiveEffect.stat === 'maxHp' ? passiveEffect.bps : 0) + style.hpBps;
    u.damage = Math.round(u.baseDamage * (1 + damageBps / BPS_SCALE));
    u.maxHpStatic = Math.round(u.baseHp * (1 + hpBps / BPS_SCALE));
    // Vào trận máu LUÔN đầy 100% (kể cả phần trần tăng nhờ aura Hỗ trợ — mục 1).
    u.maxHp = u.maxHpStatic;
    u.hp = u.maxHp;
    // Chí mạng: giá trị chốt 30% ở cấp 10, quy theo cấp (cấp 1 = 20%) + nội tại.
    u.critBps = pvpPerLevelEffectBps(PVP_CRIT_BPS_PER_LEVEL, u.level) + (passiveEffect.stat === 'crit' ? passiveEffect.pointsBps : 0);
    // Choáng: tỉ lệ chốt ở cấp 10, quy theo cấp + nội tại.
    u.stunBps = pvpPerLevelEffectBps(u.def.stunPerLevelBps, u.level) + (passiveEffect.stat === 'stun' ? passiveEffect.pointsBps : 0);
    // Hút máu: chốt ở cấp 10 (mục 13), quy theo cấp.
    u.lifestealBps = pvpPerLevelEffectBps(u.profile.lifestealPerLevelBps, u.level);
    // Giải choáng: chốt ở cấp 10 = 75%, quy theo cấp (cấp 1 = 65%).
    u.cleanseBps = u.def.cleanse ? pvpEffectBps(PVP_CLEANSE_CHAMP_BPS, u.level) : 0;
  }

  // Ảnh chụp đầu trận để client dựng giao diện.
  const snapshot: PvpUnitStateDto[] = units
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((u) => {
      const def = u.def;
      const db = def.debuff;
      const hasBuff = def.buffs.length > 0;
      const hasDebuff = db.damageDownBps > 0 || db.hpDownBps > 0 || db.critDownBps > 0 || db.critDamageDownBps > 0 || db.burnBps > 0;
      return {
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
        critDamageBps: u.critDamageBps,
        stunBps: u.stunBps,
        lifestealBps: u.lifestealBps,
        // Hiệu ứng có lợi / bất lợi / phản kích / tự thiêu đốt của kỹ năng (client mô tả khi thi triển).
        buffs: hasBuff ? def.buffs : undefined,
        debuff: hasDebuff ? db : undefined,
        counter: def.counter.damageBps > 0 ? def.counter : undefined,
        selfBurn: def.selfBurn || undefined,
      };
    });

  const events: PvpEventDto[] = [];
  const aliveCount = (side: PvpSide) => units.reduce((n, u) => n + (u.side === side && u.alive ? 1 : 0), 0);

  // 3) Thứ tự hành động (mục 5.1): hai đội LUÂN PHIÊN nhau, bên có TỔNG lực chiến cao hơn đi trước.
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
  const lowestOf = (list: Unit[]) => (list.length ? [list.reduce((lo, m) => (m.hp / m.maxHp < lo.hp / lo.maxHp ? m : lo))] : []);

  /** Chọn mục tiêu theo hệ tọa độ đội hình (mục 2.4, 13.1) — chỉ tướng còn sống. */
  function pickTargets(u: Unit, targeting: PvpTargeting): Unit[] {
    const enemies = enemiesOf(u);
    const front = enemies.filter((e) => e.row === 'front');
    const back = enemies.filter((e) => e.row === 'back');
    switch (targeting) {
      case 'single': {
        // Ưu tiên cùng lane (hàng ngang), sau đó tới các lane khác theo slot.
        const sameLane = enemies.filter((e) => e.lane === u.lane);
        return sameLane.length ? [sameLane[0]!] : enemies.length ? [enemies[0]!] : [];
      }
      case 'lane': {
        // Hàng ngang: nếu cả cặp trước/sau ở lane này đã chết hết thì quay sang toàn bộ địch còn lại.
        const sameLane = enemies.filter((e) => e.lane === u.lane);
        return sameLane.length ? sameLane : enemies;
      }
      case 'row': {
        // Hàng dọc: đánh hàng của bản thân; nếu hàng đó đã sạch thì quay sang hàng còn lại.
        const sameRow = enemies.filter((e) => e.row === u.row);
        if (sameRow.length) return sameRow;
        return u.row === 'front' ? back : front;
      }
      case 'back_row':
        // Đánh hàng sau: nếu hàng sau chết hết thì quay ra đánh hàng trước.
        return back.length ? back : front;
      case 'back_single': {
        // Một tướng hàng sau: ưu tiên cùng lane, rồi tới hàng sau; nếu hàng sau sạch thì đánh hàng trước.
        const sameLane = back.filter((e) => e.lane === u.lane);
        if (sameLane.length) return [sameLane[0]!];
        if (back.length) return [back[0]!];
        return front.length ? [front[0]!] : [];
      }
      case 'highest_damage_enemy': {
        // Nhắm tướng địch có sát thương hiệu dụng cao nhất (đã tính buff/debuff đang hiệu lực).
        // Bằng nhau thì chọn tướng slot nhỏ hơn (reduce giữ phần tử đầu) cho tất định.
        if (!enemies.length) return [];
        const top = enemies.reduce((hi, e) => (effectiveDamage(e) > effectiveDamage(hi) ? e : hi));
        return [top];
      }
      case 'front_enemies':
        // Đánh hàng trước: nếu hàng trước chết hết thì quay ra đánh hàng sau.
        return front.length ? front : back;
      case 'all_enemies':
        return enemies;
      case 'all_allies':
        return alliesOf(u);
      case 'lowest_ally':
        return lowestOf(alliesOf(u));
      case 'front_allies':
        return alliesOf(u).filter((a) => a.row === 'front');
      case 'back_allies':
        return alliesOf(u).filter((a) => a.row === 'back');
    }
  }

  /** Đồng minh nhận buff theo phạm vi phát (mục 1 — buff scope). */
  function buffTargetsOf(u: Unit, scope: PvpBuffScope): Unit[] {
    switch (scope) {
      case 'self':
        return u.alive ? [u] : [];
      case 'all_allies':
        return alliesOf(u);
      case 'same_row_allies':
        // Đồng minh cùng hàng với bản thân (hàng trước đi với hàng trước, hàng sau đi với hàng sau).
        return alliesOf(u).filter((a) => a.row === u.row);
      case 'lowest_ally':
        return lowestOf(alliesOf(u));
      case 'front_allies':
        return alliesOf(u).filter((a) => a.row === 'front');
      case 'back_allies':
        return alliesOf(u).filter((a) => a.row === 'back');
      case 'none':
        return [];
    }
  }

  /** Damage cộng thẳng từ các lớp buff đang hiệu lực (theo damage nền của chính tướng). */
  const buffDamage = (u: Unit) => u.buffs.reduce((s, b) => s + b.damageFlat, 0);
  /** Trần HP cộng thẳng từ các lớp buff đang hiệu lực. */
  const buffHp = (u: Unit) => u.buffs.reduce((s, b) => s + b.hpFlat, 0);
  /** Điểm chí mạng cộng thêm từ các lớp buff đang hiệu lực. */
  const buffCrit = (u: Unit) => u.buffs.reduce((s, b) => s + b.critBps, 0);
  /** ST chí mạng cộng thêm từ các lớp buff đang hiệu lực. */
  const buffCritDamage = (u: Unit) => u.buffs.reduce((s, b) => s + b.critDamageBps, 0);
  /** % sát thương gánh chịu được giảm nhờ các lớp buff đang hiệu lực. */
  const buffTakenDown = (u: Unit) => u.buffs.reduce((s, b) => s + b.takenDownBps, 0);
  /** % hút máu cộng thêm từ các lớp buff đang hiệu lực (kỹ năng hỗ trợ ban hút máu cho đồng minh). */
  const buffLifesteal = (u: Unit) => u.buffs.reduce((s, b) => s + b.lifestealBps, 0);
  /** Sát thương bị giảm bởi các lớp suy yếu đang chịu. */
  const debuffDamageDown = (u: Unit) => u.debuffs.reduce((s, d) => s + d.damageDownFlat, 0);
  /** Trần HP bị giảm bởi các lớp suy yếu đang chịu. */
  const debuffHpDown = (u: Unit) => u.debuffs.reduce((s, d) => s + d.hpDownFlat, 0);
  /** Điểm chí mạng bị giảm bởi các lớp suy yếu đang chịu. */
  const debuffCritDown = (u: Unit) => u.debuffs.reduce((s, d) => s + d.critDownBps, 0);
  /** ST chí mạng bị giảm bởi các lớp suy yếu đang chịu. */
  const debuffCritDamageDown = (u: Unit) => u.debuffs.reduce((s, d) => s + d.critDamageDownBps, 0);
  /**
   * Sát thương Thiêu đốt mỗi lượt: gom các lớp theo TỪNG nguồn, mỗi nguồn roll chí mạng RIÊNG theo
   * chỉ số của người thi triển (mục 8 — thiêu đốt vẫn ăn chí mạng như các đòn sát thương khác).
   * Chu Du (`burnCritMulBps`) được nhân thêm tỷ lệ chí mạng VÀ ST chí mạng cho riêng đòn thiêu đốt.
   * Trả về cả chi tiết từng nguồn để tính hút máu thiêu đốt (Lục Tốn).
   */
  function rollBurnTotal(u: Unit): { amount: number; crit: boolean; parts: { src: Unit | undefined; damage: number; crit: boolean }[] } {
    const bySource = new Map<number, number>();
    for (const b of u.burns) bySource.set(b.sourceIdx, (bySource.get(b.sourceIdx) ?? 0) + b.amount);
    let amount = 0;
    let crit = false;
    const parts: { src: Unit | undefined; damage: number; crit: boolean }[] = [];
    for (const [sourceIdx, sum] of bySource) {
      const src = units.find((x) => x.idx === sourceIdx);
      const mul = src && src.def.burnCritMulBps > 0 ? src.def.burnCritMulBps : BPS_SCALE;
      let dmg = sum;
      let c = false;
      if (src && rand(BPS_SCALE) < Math.round((critBpsOf(src) * mul) / BPS_SCALE)) {
        const cdBps = Math.round((critDamageBpsOf(src) * mul) / BPS_SCALE);
        dmg = Math.round((dmg * (BPS_SCALE + cdBps)) / BPS_SCALE);
        c = true;
        crit = true;
      }
      amount += dmg;
      parts.push({ src, damage: dmg, crit: c });
    }
    return { amount, crit, parts };
  }

  /** Sát thương hiệu dụng khi ra đòn = nền + buff − suy yếu (không âm), nhân thêm hệ số Hồi sinh. */
  const effectiveDamage = (u: Unit) =>
    Math.round(Math.max(0, u.damage + buffDamage(u) - debuffDamageDown(u)) * (u.damageMulBps / BPS_SCALE));
  /** Điểm chí mạng hiệu dụng = nền + buff − giảm chí mạng (không âm). */
  const critBpsOf = (u: Unit) => Math.max(0, u.critBps + buffCrit(u) - debuffCritDown(u));
  /** ST chí mạng hiệu dụng = nền + buff − giảm (không âm). */
  const critDamageBpsOf = (u: Unit) => Math.max(0, u.critDamageBps + buffCritDamage(u) - debuffCritDamageDown(u));
  /** Hệ số nhân sát thương gánh chịu sau khi trừ lớp buff giảm ST nhận (không âm, tối đa 0). */
  const takenMulBps = (u: Unit) => Math.max(0, BPS_SCALE - buffTakenDown(u));
  /**
   * Hút máu hiệu dụng = hút máu theo cấp của bản thân + hút máu do kỹ năng hỗ trợ đồng minh ban
   * (kênh buff `lifestealBps`, trần 20% nên `maxLayers: 1`). Tướng hỗ trợ không tự hút máu.
   */
  const lifestealBpsOf = (u: Unit) => Math.max(0, u.lifestealBps + buffLifesteal(u));

  /**
   * Mục tiêu có đang chịu hiệu ứng bất lợi hay không (mục 1.17): có lớp SUY YẾU, đang bị THIÊU ĐỐT,
   * hoặc đang bị CHOÁNG. Dùng cho cơ chế cộng thêm sát thương của một số tướng (đao phủ).
   */
  const hasDebuff = (u: Unit) => u.debuffs.length > 0 || u.burns.length > 0 || u.stunnedByIdx !== null;

  /**
   * Đồng bộ trần HP động theo các lớp buff/debuff đang hiệu lực:
   * trần = trần tĩnh + tổng HP cộng thêm − tổng HP bị giảm (không âm).
   * Trần tăng thì CHỈ HỒI 1/4 lượng tăng (buff %HP của kỹ năng không phải đòn hồi máu đầy);
   * trần giảm thì kẹp máu hiện tại xuống trần mới.
   * Trả về lượng máu hồi thêm (>0 khi trần tăng).
   */
  const syncMaxHp = (u: Unit): number => {
    const before = u.maxHp;
    u.maxHp = Math.max(0, u.maxHpStatic - debuffHpDown(u)) + buffHp(u);
    const delta = u.maxHp - before;
    if (delta > 0) {
      const gain = Math.round((delta * PVP_MAXHP_GAIN_HEAL_BPS) / BPS_SCALE);
      u.hp = Math.min(u.maxHp, u.hp + gain);
      return gain;
    }
    if (delta < 0) u.hp = Math.min(u.hp, u.maxHp);
    return 0;
  };

  /**
   * Xử lý khi máu tướng về 0 (mục 1.14): nếu kỹ năng có HỒI SINH và chưa dùng lượt nào trong trận thì
   * tướng KHÔNG gục mà hồi lại `cấp × PVP_REVIVE_HP_BPS_PER_LEVEL` (bps của HP tối đa) và bị giảm
   * sát thương gây ra `PVP_REVIVE_DAMAGE_DOWN_BPS` vĩnh viễn tới hết trận. Trả về true nếu tướng gục thật.
   */
  function fell(u: Unit): boolean {
    if (u.hp > 0 || !u.alive) return false;
    if (u.def.revive && !u.reviveUsed) {
      u.reviveUsed = true;
      u.damageMulBps = Math.max(0, BPS_SCALE - PVP_REVIVE_DAMAGE_DOWN_BPS);
      const healBps = Math.min(BPS_SCALE, u.level * PVP_REVIVE_HP_BPS_PER_LEVEL);
      // Hồi tối thiểu 1 máu để tướng chắc chắn sống lại (trường hợp cấp 0 hiếm gặp).
      u.hp = Math.min(u.maxHp, Math.max(1, Math.round((u.maxHp * healBps) / BPS_SCALE)));
      events.push({ t: 'revive', idx: u.idx, hp: u.hp, damageDownBps: PVP_REVIVE_DAMAGE_DOWN_BPS });
      return false;
    }
    u.alive = false;
    events.push({ t: 'down', idx: u.idx });
    return true;
  }

  /**
   * Phản kích (mục 12): khi gánh sát thương TRỰC TIẾP, nạn nhân có tỷ lệ đánh trả.
   * KHÔNG kích hoạt từ sát thương gián tiếp (Thiêu đốt / Giảm-Mất máu tối đa) và không kích
   * dây chuyền (đòn phản kích không lại kích phản kích).
   */
  function tryCounter(victim: Unit, attacker: Unit): void {
    const c = victim.def.counter;
    if (c.damageBps <= 0 || !victim.alive) return;
    const chance = Math.min(pvpPerLevelEffectBps(c.perLevelBps, victim.level), PVP_COUNTER_MAX_BPS);
    if (chance <= 0 || rand(BPS_SCALE) >= chance) return;
    const victims = c.scope === 'all' ? enemiesOf(victim) : attacker.alive ? [attacker] : [];
    if (!victims.length) return;
    const base = Math.round((effectiveDamage(victim) * c.damageBps) / BPS_SCALE);
    for (const v of victims) {
      if (!v.alive) continue;
      let amount = base;
      const crit = rand(BPS_SCALE) < critBpsOf(victim);
      if (crit) amount = Math.round((amount * (BPS_SCALE + critDamageBpsOf(victim))) / BPS_SCALE);
      amount = Math.round((amount * takenMulBps(v)) / BPS_SCALE);
      v.hp = Math.max(0, v.hp - amount);
      events.push({ t: 'counter', from: victim.idx, idx: v.idx, amount, crit, hp: v.hp });
      fell(v);
    }
  }

  /** Gây sát thương TRỰC TIẾP (đánh thường/kỹ năng) — cập nhật HP, đẩy sự kiện, xử lý gục/hồi sinh, kích phản kích. */
  function damageDirect(from: Unit, to: Unit, amount: number, crit: boolean): void {
    to.hp = Math.max(0, to.hp - amount);
    events.push({ t: 'damage', from: from.idx, idx: to.idx, amount, crit, hp: to.hp });
    if (fell(to)) return;
    tryCounter(to, from);
  }

  /** Hồi máu (không vượt trần); đẩy sự kiện khi có hồi thực tế. */
  function healUnit(from: Unit, to: Unit, amount: number, crit: boolean, lifesteal = false): void {
    const before = to.hp;
    to.hp = Math.min(to.maxHp, to.hp + amount);
    if (to.hp > before) events.push({ t: 'heal', from: from.idx, idx: to.idx, amount: to.hp - before, crit, hp: to.hp, ...(lifesteal ? { lifesteal: true } : {}) });
  }

  /** Sát thương (có thể ăn chí mạng) của người thi triển với hệ số cho trước.
   *  `target` (nếu có) đang bị Thiêu đốt thì cộng thêm `burnCritDamageBps` của người thi triển vào
   *  % ST chí mạng (Lăng Thống — mục 8). */
  function rollDamage(source: Unit, damageBps: number, target?: Unit): { amount: number; crit: boolean } {
    let amount = Math.round((effectiveDamage(source) * damageBps) / BPS_SCALE);
    const crit = rand(BPS_SCALE) < critBpsOf(source);
    if (crit) {
      const burnBonus = target && target.burns.length > 0 ? source.def.burnCritDamageBps : 0;
      amount = Math.round((amount * (BPS_SCALE + critDamageBpsOf(source) + burnBonus)) / BPS_SCALE);
    }
    return { amount, crit };
  }

  /**
   * Thêm một lớp Thiêu đốt từ `source` lên `target`.
   * Trần `maxLayers` chỉ áp dụng theo TỪNG nguồn (từng tướng): mỗi tướng gây tối đa `maxLayers` lớp,
   * nhưng NHIỀU tướng cùng thiêu đốt một mục tiêu thì các lớp vẫn cộng dồn (không có trần toàn hệ thống).
   */
  function addBurn(target: Unit, source: Unit, amount: number, rounds: number, maxLayers: number): void {
    const expiresRound = currentRound + rounds - 1;
    const sameCount = target.burns.filter((b) => b.sourceIdx === source.idx).length;
    for (let i = 0; i < sameCount - maxLayers + 1; i++) {
      const at = target.burns.findIndex((b) => b.sourceIdx === source.idx);
      if (at >= 0) target.burns.splice(at, 1);
    }
    target.burns.push({ sourceIdx: source.idx, amount, expiresRound });
  }

  let currentRound = 0;

  function act(u: Unit, round: number): void {
    const def = u.def;
    // Choáng do chính u gây ra kết thúc khi u ra skill ở lượt kế tiếp (mục 6).
    for (const x of units) if (x.stunnedByIdx === u.idx) x.stunnedByIdx = null;

    const targets = pickTargets(u, def.targeting);
    events.push({ t: 'act', idx: u.idx, skill: u.profile.skill, targets: targets.map((t) => t.idx) });

    // Buff tăng sức mạnh (mục 1): mỗi lần tới lượt phát MỘT lớp cho mỗi KÊNH buff của kỹ năng
    // (một số kỹ năng vừa tự buff vừa buff đồng minh nên có nhiều kênh). Các lớp cộng dồn tối đa
    // `maxLayers` (tính theo TỪNG nguồn), mỗi lớp hiệu lực `rounds` lượt. % ST và % HP ăn chí mạng
    // theo MỘT lần roll chung cho cả lớp; điểm chí mạng/ST chí mạng/giảm ST nhận giữ nguyên.
    for (const [channel, entry] of def.buffs.entries()) {
      if (entry.scope === 'none') continue;
      const b = entry.buff;
      const targets = buffTargetsOf(u, entry.scope);
      if (!targets.length) continue;
      const crit = rand(BPS_SCALE) < critBpsOf(u);
      const critMul = crit ? (BPS_SCALE + critDamageBpsOf(u)) / BPS_SCALE : 1;
      const damageBps = Math.round(b.damageBps * critMul);
      const hpBps = Math.round(b.hpBps * critMul);
      const expiresRound = round + b.rounds - 1;
      for (const a of targets) {
        // Lượng cộng thẳng tính theo chỉ số nền của CHÍNH tướng được buff.
        const damageFlat = Math.round((a.damage * damageBps) / BPS_SCALE);
        const hpFlat = Math.round((a.maxHpStatic * hpBps) / BPS_SCALE);
        a.buffs.push({
          sourceIdx: u.idx,
          channel,
          damageFlat,
          hpFlat,
          critBps: b.critBps,
          critDamageBps: b.critDamageBps,
          takenDownBps: b.takenDownBps,
          // Hút máu không ăn chí mạng (chỉ % sát thương/HP của lớp buff mới nhân ST chí mạng).
          lifestealBps: b.lifestealBps,
          expiresRound,
        });
        // Trần `maxLayers` tính theo TỪNG (nguồn, kênh): mỗi kênh buff của tướng tối đa `maxLayers` lớp,
        // nhiều tướng/kênh khác nhau vẫn cộng dồn.
        const mine = a.buffs.filter((x) => x.sourceIdx === u.idx && x.channel === channel);
        if (mine.length > b.maxLayers) {
          const at = a.buffs.indexOf(mine[0]!);
          if (at >= 0) a.buffs.splice(at, 1);
        }
        syncMaxHp(a);
        events.push({
          t: 'buff',
          from: u.idx,
          channel,
          idx: a.idx,
          damageFlat,
          hpFlat,
          critBps: b.critBps,
          critDamageBps: b.critDamageBps,
          takenDownBps: b.takenDownBps,
          lifestealBps: b.lifestealBps,
          crit,
          expiresRound,
          maxLayers: b.maxLayers,
        });
      }
    }

    // Sát thương (mục 6.2, 6.3): (damage cơ bản + buff) × hệ số kỹ năng (đã nhân hot) × chí mạng,
    // sau đó trừ % sát thương gánh chịu của mục tiêu (buff giảm ST nhận).
    let dealt = 0;
    if (def.damageBps > 0) {
      for (const t of targets) {
        if (!u.alive) break;
        const { amount: raw, crit } = rollDamage(u, def.damageBps, t);
        // Cộng thêm % sát thương khi đánh trúng mục tiêu đang chịu hiệu ứng bất lợi (mục 1.17).
        const boosted =
          def.vsDebuffBonusBps > 0 && hasDebuff(t)
            ? Math.round((raw * (BPS_SCALE + def.vsDebuffBonusBps)) / BPS_SCALE)
            : raw;
        const amount = Math.round((boosted * takenMulBps(t)) / BPS_SCALE);
        dealt += amount;
        damageDirect(u, t, amount, crit);
      }
    }

    // Hút máu (mục 13): hồi cho bản thân theo % tổng sát thương trực tiếp vừa gây ra. Cũng có chí mạng.
    const lsBps = lifestealBpsOf(u);
    if (lsBps > 0 && dealt > 0) {
      let heal = Math.round((dealt * lsBps) / BPS_SCALE);
      const crit = rand(BPS_SCALE) < critBpsOf(u);
      if (crit) heal = Math.round((heal * (BPS_SCALE + critDamageBpsOf(u))) / BPS_SCALE);
      healUnit(u, u, heal, crit, true);
    }

    // Hồi máu đồng minh (mục 3): không vượt HP tối đa, có thể chí mạng theo tỉ lệ chí mạng người thi triển.
    if (def.healBps > 0) {
      for (const t of targets) {
        let heal = Math.round((u.damage * def.healBps) / BPS_SCALE);
        const crit = rand(BPS_SCALE) < critBpsOf(u);
        if (crit) heal = Math.round((heal * (BPS_SCALE + critDamageBpsOf(u))) / BPS_SCALE);
        healUnit(u, t, heal, crit);
      }
    }

    // Tự hồi máu theo HP tối đa — hệ số đã nhân hot; cũng có chí mạng.
    if (def.selfHealBps > 0) {
      let heal = Math.round((u.maxHp * def.selfHealBps) / BPS_SCALE);
      const crit = rand(BPS_SCALE) < critBpsOf(u);
      if (crit) heal = Math.round((heal * (BPS_SCALE + critDamageBpsOf(u))) / BPS_SCALE);
      healUnit(u, u, heal, crit);
    }

    // Choáng (mục 6): chỉ áp cho mục tiêu còn sống; tướng có kỹ năng giải choáng MIỄN NHIỄM choáng.
    // Choáng được đè/nối tiếp: nguồn mới nhất ghi vào `stunnedByIdx`.
    if (def.stun !== 'none') {
      for (const t of targets) {
        if (!t.alive || t.def.cleanse) continue;
        if (rand(BPS_SCALE) < u.stunBps) {
          t.stunnedByIdx = u.idx;
          events.push({ t: 'stun', idx: t.idx, byIdx: u.idx });
        }
      }
    }

    // Giải choáng & Thiêu đốt (mục 7): kiểm tra riêng từng đồng minh đang bị choáng HOẶC thiêu đốt.
    // Giải thành công thì gỡ cả choáng lẫn mọi lớp thiêu đốt đang chịu.
    if (def.cleanse) {
      for (const a of alliesOf(u)) {
        const hasStun = a.stunnedByIdx !== null;
        const hasBurn = a.burns.length > 0;
        if (!hasStun && !hasBurn) continue;
        if (rand(BPS_SCALE) < u.cleanseBps) {
          a.stunnedByIdx = null;
          a.burns = [];
          events.push({ t: 'cleanse', idx: a.idx });
        }
      }
    }

    // Xóa hiệu ứng có lợi của địch (dispel — mục 14): gỡ toàn bộ lớp buff đang có, trần HP tụt theo.
    // Tướng vừa buff đồng minh vừa dispel (Trần Cung) nhắm dispel vào toàn bộ ĐỊCH.
    if (def.dispel) {
      const dispelTargets = isAllyTargeting(def.targeting) ? enemiesOf(u) : targets;
      for (const t of dispelTargets) {
        if (!t.alive || !t.buffs.length) continue;
        if (rand(BPS_SCALE) >= def.dispelChanceBps) continue;
        t.buffs = [];
        syncMaxHp(t);
        events.push({ t: 'dispel', idx: t.idx });
      }
    }

    // Hiệu ứng bất lợi lên địch: suy yếu (mục 2/5/10/11) và Thiêu đốt (mục 8) tính RIÊNG vòng đời.
    const db = def.debuff;
    const weaken = db.damageDownBps > 0 || db.hpDownBps > 0 || db.critDownBps > 0 || db.critDamageDownBps > 0;
    if (weaken || db.burnBps > 0) {
      const expiresRound = round + db.rounds - 1;
      for (const t of targets) {
        if (!t.alive) continue;
        let damageDownFlat = 0;
        let hpDownFlat = 0;
        if (weaken) {
          damageDownFlat = Math.round((t.damage * db.damageDownBps) / BPS_SCALE);
          hpDownFlat = Math.round((t.baseHp * db.hpDownBps) / BPS_SCALE);
          t.debuffs.push({ sourceIdx: u.idx, damageDownFlat, hpDownFlat, critDownBps: db.critDownBps, critDamageDownBps: db.critDamageDownBps, expiresRound });
          // Trần `maxLayers` tính theo TỪNG nguồn: mỗi tướng tối đa `maxLayers` lớp, nhiều tướng vẫn cộng dồn.
          const mine = t.debuffs.filter((x) => x.sourceIdx === u.idx);
          if (mine.length > db.maxLayers) {
            const at = t.debuffs.indexOf(mine[0]!);
            if (at >= 0) t.debuffs.splice(at, 1);
          }
          syncMaxHp(t);
        }
        let burnFlat = 0;
        if (db.burnBps > 0) {
          burnFlat = Math.round((effectiveDamage(u) * db.burnBps) / BPS_SCALE);
          addBurn(t, u, burnFlat, db.burnRounds, db.burnMaxLayers > 0 ? db.burnMaxLayers : 1);
        }
        events.push({ t: 'debuff', from: u.idx, idx: t.idx, damageFlat: damageDownFlat, hpFlat: hpDownFlat, critBps: db.critDownBps, critDamageBps: db.critDamageDownBps, burnFlat, expiresRound, maxLayers: db.maxLayers });
      }
    }

    // Tự gây Thiêu đốt lên bản thân (Khổ nhục kế — Hoàng Cái, mục 8): dồn tối đa 3 lớp từ chính mình.
    if (def.selfBurn) {
      const burnFlat = Math.round((effectiveDamage(u) * PVP_BURN_BPS) / BPS_SCALE);
      addBurn(u, u, burnFlat, def.selfBurnRounds, PVP_BURN_MAX_LAYERS_LONG);
      events.push({ t: 'debuff', from: u.idx, idx: u.idx, damageFlat: 0, hpFlat: 0, critBps: 0, critDamageBps: 0, burnFlat, expiresRound: round + def.selfBurnRounds - 1, maxLayers: PVP_BURN_MAX_LAYERS_LONG });
    }

    // Thanh tẩy hiệu ứng bất lợi cho đồng minh (mục 15): gỡ toàn bộ lớp suy yếu nhưng GIỮ LẠI
    // choáng và thiêu đốt (hai hiệu ứng này không bị thanh tẩy).
    if (def.purify) {
      for (const a of alliesOf(u)) {
        if (!a.debuffs.length) continue;
        a.debuffs = [];
        syncMaxHp(a);
        events.push({ t: 'purify', idx: a.idx });
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
      currentRound = r;
      // Hết hạn buff chủ động của lượt trước: lớp hết hạn làm trần HP tụt nên phải đồng bộ lại.
      for (const u of units) {
        if (!u.buffs.length) continue;
        const kept = u.buffs.filter((b) => b.expiresRound >= r);
        if (kept.length === u.buffs.length) continue;
        u.buffs = kept;
        syncMaxHp(u);
      }
      // Hết hạn lớp suy yếu: trần HP có thể hồi lại nên phải đồng bộ.
      for (const u of units) {
        if (!u.debuffs.length) continue;
        const kept = u.debuffs.filter((d) => d.expiresRound >= r);
        if (kept.length === u.debuffs.length) continue;
        u.debuffs = kept;
        syncMaxHp(u);
      }
      // Hết hạn lớp Thiêu đốt.
      for (const u of units) {
        if (!u.burns.length) continue;
        const kept = u.burns.filter((b) => b.expiresRound >= r);
        if (kept.length !== u.burns.length) u.burns = kept;
      }
      // Choáng của tướng đã gục không bao giờ được giải (nguồn không còn ra skill) → gỡ ở đầu lượt.
      for (const x of units) {
        if (x.stunnedByIdx === null) continue;
        const src = units.find((s) => s.idx === x.stunnedByIdx);
        if (!src || !src.alive) x.stunnedByIdx = null;
      }
      events.push({ t: 'round', round: r });
      // Thiêu đốt: gây sát thương vào ĐẦU mỗi lượt (sát thương gián tiếp — KHÔNG kích phản kích).
      for (const u of units) {
        if (!u.alive) continue;
        const burn = rollBurnTotal(u);
        if (burn.amount <= 0) continue;
        u.hp = Math.max(0, u.hp - burn.amount);
        events.push({ t: 'burn', idx: u.idx, amount: burn.amount, crit: burn.crit, hp: u.hp });
        // Hút máu từ chính sát thương THIÊU ĐỐT (Lục Tốn): hồi cho nguồn theo % ST gây ra, ăn chí mạng
        // của đòn thiêu đốt đó. Chỉ áp cho tướng có `burnLifesteal` và CHỈ đạt 50% hiệu suất hút máu gốc.
        for (const p of burn.parts) {
          if (!p.src || !p.src.alive || p.damage <= 0) continue;
          const srcLsBps = lifestealBpsOf(p.src);
          if (!p.src.def.burnLifesteal || srcLsBps <= 0) continue;
          const burnLifestealBps = Math.round((srcLsBps * PVP_BURN_LIFESTEAL_BPS) / BPS_SCALE);
          let heal = Math.round((p.damage * burnLifestealBps) / BPS_SCALE);
          if (p.crit) heal = Math.round((heal * (BPS_SCALE + critDamageBpsOf(p.src))) / BPS_SCALE);
          healUnit(p.src, p.src, heal, p.crit, true);
        }
        if (u.hp === 0 && u.alive) fell(u);
      }
      if (aliveCount('a') === 0 || aliveCount('b') === 0) break;
      for (const u of order(units.filter((x) => x.alive))) {
        if (aliveCount('a') === 0 || aliveCount('b') === 0) break;
        if (!u.alive) continue;
        if (u.stunnedByIdx !== null) {
          // Đang choáng: bỏ lượt này; choáng kết thúc khi nguồn gây choáng ra skill ở lượt kế (mục 6).
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
