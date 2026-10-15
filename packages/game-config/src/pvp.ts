import type { Faction, PvpPassive, PvpSkill, PvpStyle, PvpTargeting } from '@tq/shared';
import { FACTIONS, PVP_PASSIVES, PVP_SKILLS, PVP_STYLES, PVP_TEAM_SIZE, MAX_LEVEL } from '@tq/shared';
import { BPS_SCALE } from './rates.ts';
import { ROSTER } from './roster.ts';

/**
 * Cấu hình chiến đấu PvP theo SKILLS.md. Toàn bộ hệ số ở đây là dữ liệu cân bằng:
 * đổi số trong file này, KHÔNG sửa logic engine (xem apps/api/src/managers/pvp.engine.ts).
 *
 * Quy ước đơn vị:
 * - Tỉ lệ/hệ số dùng bps (BPS_SCALE = 10000 = 100%), ví dụ 2500 = 25%.
 * - "điểm phần trăm" (nội tại CRIT_5, buff chí mạng) cũng quy ra bps: 500 = +5 điểm phần trăm.
 */

/** Số lane mỗi hàng và số hàng mỗi đội. */
export const PVP_LANES = 3;
export const PVP_ROWS = 2;
export { PVP_TEAM_SIZE };

/** Giới hạn số vòng để tránh trận bất tử. Quá số vòng: xét theo tổng % HP còn lại. */
export const PVP_MAX_ROUNDS = 30;

// ===== Chỉ số nền theo cấp (cùng cấp => chỉ số nền tương đương) =====

/** HP tối đa nền theo cấp: 1000 ở cấp 1, +250 mỗi cấp. */
export const pvpBaseHp = (level: number) => 1000 + 250 * (level - 1);
/** Damage cơ bản nền theo cấp: 200 ở cấp 1, +50 mỗi cấp. */
export const pvpBaseDamage = (level: number) => 200 + 50 * (level - 1);

/**
 * LC (chỉ số xác định thứ tự hành động) theo phong cách + cấp.
 * Tấn công nhanh nhất, rồi Hỗ trợ, cuối là Phòng thủ; bằng LC thì xét slot rồi tới phía A.
 */
export const PVP_LC_BY_STYLE: Record<PvpStyle, number> = { attack: 130, support: 120, defense: 110 };
export const pvpLc = (style: PvpStyle, level: number) => PVP_LC_BY_STYLE[style] + (level - 1) * 2;

// ===== Hiệu ứng nền (aura) =====

/**
 * Hiệu ứng nền áp trước trận cho từng tướng theo KỸ NĂNG của tướng đó (SKILLS.md).
 * Phong cách chỉ còn quyết định thứ tự hành động (LC) và nhãn hiển thị.
 */
export interface PvpAura {
  /** Tăng sát thương của chính tướng. */
  damageBps: number;
  /** Tăng HP tối đa của chính tướng. */
  hpBps: number;
  /** Tăng sát thương cho toàn bộ đồng minh, kể cả chính tướng (không cộng dồn lặp lại). */
  teamDamageBps: number;
  /** Tăng HP tối đa cho toàn bộ đồng minh, kể cả chính tướng. */
  teamHpBps: number;
  /** Cộng điểm chí mạng cho toàn bộ đồng minh (bps: 500 = +5 điểm phần trăm). */
  teamCritPointsBps: number;
}

export const PVP_NO_AURA: PvpAura = { damageBps: 0, hpBps: 0, teamDamageBps: 0, teamHpBps: 0, teamCritPointsBps: 0 };

// ===== Buff theo vị trí =====

/** Hàng trước: +10% HP tối đa. Hàng sau: +10% damage. */
export const PVP_FRONT_HP_BPS = 1000;
export const PVP_BACK_DAMAGE_BPS = 1000;

// ===== Nội tại tướng =====

export interface PvpPassiveEffect {
  /** Chỉ số chịu tác động. */
  stat: 'crit' | 'damage' | 'maxHp' | 'stun' | 'cleanse';
  /** Với 'damage'/'maxHp': phần trăm của chỉ số nền (bps). */
  bps: number;
  /** Với 'crit'/'stun'/'cleanse': điểm phần trăm (bps). */
  pointsBps: number;
}

export const PVP_PASSIVE_EFFECT: Record<PvpPassive, PvpPassiveEffect> = {
  CRIT_5: { stat: 'crit', bps: 0, pointsBps: 500 },
  DAMAGE_10: { stat: 'damage', bps: 1000, pointsBps: 0 },
  HP_10: { stat: 'maxHp', bps: 1000, pointsBps: 0 },
  STUN_5: { stat: 'stun', bps: 0, pointsBps: 500 },
  STUN_10: { stat: 'stun', bps: 0, pointsBps: 1000 },
  CLEANSE_10: { stat: 'cleanse', bps: 0, pointsBps: 1000 },
};

// ===== Kỹ năng =====

/** Cách chọn mục tiêu theo hệ tọa độ đội hình — không phụ thuộc đội A nằm trái hay phải. */
export type { PvpTargeting };

export interface PvpSkillDef {
  targeting: PvpTargeting;
  /** Hệ số sát thương theo damage cơ bản (bps). 0 = không gây sát thương. */
  damageBps: number;
  /** Hệ số hồi máu cho đồng minh theo damage cơ bản của người thi triển (bps). 0 = không hồi. */
  healBps: number;
  /** Hồi máu cho bản thân theo HP tối đa (bps). 0 = không tự hồi. */
  selfHealBps: number;
  /** Choáng: 'single' dùng bảng đơn mục tiêu, 'row' dùng bảng hàng ngang/dọc/diện rộng. */
  stun: 'none' | 'single' | 'row';
  /** Kỹ năng có kiểm tra giải choáng cho đồng minh. */
  cleanse: boolean;
  /** Kỹ năng buff damage + chí mạng cho đồng minh. */
  buff: boolean;
  /** Hiệu ứng nền áp trước trận (kể cả bản thân tướng sở hữu). */
  aura: PvpAura;
}

/**
 * Bảng định nghĩa kỹ năng. Các kỹ năng nhóm "hiệu ứng nền" (SELF_HP/TEAM_*) không có chiêu chủ động
 * nên khi tới lượt sẽ đánh thường đơn mục tiêu 100% (damageBps = 10000).
 */
export const PVP_SKILL_DEF: Record<PvpSkill, PvpSkillDef> = {
  SINGLE: { targeting: 'single', damageBps: 20000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  HORIZONTAL: { targeting: 'lane', damageBps: 15000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  VERTICAL: { targeting: 'row', damageBps: 15000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  BACK_ROW: { targeting: 'back_row', damageBps: 15000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  ALL_ENEMIES: { targeting: 'all_enemies', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  STUN_SINGLE: { targeting: 'single', damageBps: 20000, healBps: 0, selfHealBps: 0, stun: 'single', cleanse: false, buff: false, aura: PVP_NO_AURA },
  STUN_HORIZONTAL: { targeting: 'lane', damageBps: 15000, healBps: 0, selfHealBps: 0, stun: 'row', cleanse: false, buff: false, aura: PVP_NO_AURA },
  STUN_VERTICAL: { targeting: 'row', damageBps: 15000, healBps: 0, selfHealBps: 0, stun: 'row', cleanse: false, buff: false, aura: PVP_NO_AURA },
  STUN_ALL: { targeting: 'all_enemies', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'row', cleanse: false, buff: false, aura: PVP_NO_AURA },
  SELF_HEAL: { targeting: 'single', damageBps: 20000, healBps: 0, selfHealBps: 1000, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  ALL_ALLIES_HEAL: { targeting: 'all_allies', damageBps: 0, healBps: 15000, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  CLEANSE_ALL: { targeting: 'all_allies', damageBps: 0, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: true, buff: false, aura: PVP_NO_AURA },
  CLEANSE_DAMAGE_ALL: { targeting: 'all_enemies', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: true, buff: false, aura: PVP_NO_AURA },
  BUFF_ALLIES: { targeting: 'all_allies', damageBps: 0, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: true, aura: PVP_NO_AURA },
  SELF_HP: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, hpBps: 2500 } },
  TEAM_DAMAGE: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, teamDamageBps: 1000 } },
  TEAM_HP: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, teamHpBps: 1000 } },
  TEAM_DAMAGE_HP: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, teamDamageBps: 1000, teamHpBps: 1000 } },
  TEAM_CRIT: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, teamCritPointsBps: 500 } },
};

// ===== Tỉ lệ theo cấp =====

/** Chí mạng: Cấp độ × 3%. */
export const PVP_CRIT_BPS_PER_LEVEL = 300;
/** Choáng đơn mục tiêu: Cấp độ × 5% (tối đa 50% ở cấp 10). */
export const PVP_STUN_SINGLE_BPS_PER_LEVEL = 500;
/** Choáng hàng ngang/dọc/diện rộng: Cấp độ × 3% (tối đa 30% ở cấp 10) — mặc định. */
export const PVP_STUN_ROW_BPS_PER_LEVEL = 300;
/** Giải choáng: Cấp độ × 4%. */
export const PVP_CLEANSE_BPS_PER_LEVEL = 400;

/** Damage chí mạng = damage trước chí mạng × 1.5 => cộng thêm 50%. */
export const PVP_CRIT_DAMAGE_BPS = 5000;

// ===== Buff từ kỹ năng đặc biệt (BUFF_ALLIES) =====

/** Mỗi đồng minh còn sống nhận thêm damage bằng 10% damage cơ bản của chính mình. */
export const PVP_SKILL_BUFF_DAMAGE_BPS = 1000;
/** Mỗi đồng minh còn sống nhận thêm 5 điểm phần trăm chí mạng. */
export const PVP_SKILL_BUFF_CRIT_POINTS_BPS = 500;

// ===== Tướng hot (SKILLS.md) =====

/** Hệ số tăng thêm cho tướng hot: 110% = +10% chỉ số kỹ năng (sát thương/hồi máu). */
export const PVP_HOT_MULTIPLIER_BPS = 11000;

/** 10 tướng hot mỗi phe (theo độ nổi tiếng) — nhận +10% hệ số kỹ năng. */
const HOT_BY_FACTION: Record<Faction, readonly string[]> = {
  wei: ['cao-cao', 'cao-pi', 'xiahou-dun', 'xiahou-yuan', 'zhang-liao', 'xu-huang', 'dian-wei', 'xu-chu', 'sima-yi', 'guo-jia'],
  shu: ['liu-bei', 'guan-yu', 'zhang-fei', 'zhuge-liang', 'zhao-yun', 'ma-chao', 'huang-zhong', 'wei-yan', 'jiang-wei', 'pang-tong'],
  wu: ['sun-jian', 'sun-ce', 'sun-quan', 'zhou-yu', 'lu-xun', 'lu-meng', 'huang-gai', 'taishi-ci', 'gan-ning', 'lu-su'],
  qun: ['dong-zhuo', 'lu-bu', 'diao-chan', 'yuan-shao', 'zhang-jiao', 'gongsun-zan', 'hua-xiong', 'yan-liang', 'wen-chou', 'chen-gong'],
};

export const HOT_GENERALS: ReadonlySet<string> = new Set(FACTIONS.flatMap((f) => HOT_BY_FACTION[f]));
export const isHotGeneral = (generalId: string) => HOT_GENERALS.has(generalId);

// ===== Bảng hồ sơ chiến đấu tường minh theo SKILLS.md =====

interface RosterPvpRow {
  id: string;
  style: PvpStyle;
  skill: PvpSkill;
  /** Ghi đè hệ số sát thương kỹ năng (bps) — tướng có hệ số riêng trong SKILLS.md. */
  damageBps?: number;
  /** Ghi đè tỉ lệ choáng mỗi cấp (bps) cho kỹ năng choáng hàng/diện rộng. */
  stunPerLevelBps?: number;
}

const WEI_PVP: RosterPvpRow[] = [
  { id: 'cao-cao', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'cao-pi', style: 'attack', skill: 'SINGLE' },
  { id: 'cao-ren', style: 'defense', skill: 'SELF_HP' },
  { id: 'cao-hong', style: 'defense', skill: 'SELF_HEAL' },
  { id: 'cao-zhen', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'xiahou-dun', style: 'attack', skill: 'STUN_SINGLE' },
  { id: 'xiahou-yuan', style: 'attack', skill: 'BACK_ROW' },
  { id: 'zhang-liao', style: 'attack', skill: 'HORIZONTAL', damageBps: 16000 },
  { id: 'yue-jin', style: 'attack', skill: 'SINGLE' },
  { id: 'yu-jin', style: 'defense', skill: 'SELF_HP', damageBps: 20000 },
  { id: 'zhang-he', style: 'attack', skill: 'BACK_ROW' },
  { id: 'xu-huang', style: 'attack', skill: 'SINGLE' },
  { id: 'dian-wei', style: 'defense', skill: 'SELF_HP' },
  { id: 'xu-chu', style: 'defense', skill: 'SINGLE' },
  { id: 'guo-jia', style: 'support', skill: 'BUFF_ALLIES' },
  { id: 'xun-yu', style: 'support', skill: 'TEAM_DAMAGE' },
  { id: 'xun-you', style: 'support', skill: 'STUN_VERTICAL' },
  { id: 'jia-xu', style: 'support', skill: 'STUN_SINGLE' },
  { id: 'sima-yi', style: 'support', skill: 'ALL_ENEMIES' },
  { id: 'pang-de', style: 'attack', skill: 'SINGLE' },
  { id: 'zhen-ji', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'bian-yuer', style: 'support', skill: 'TEAM_HP' },
  { id: 'cao-hua', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'cao-jie', style: 'support', skill: 'TEAM_CRIT' },
  { id: 'xin-xianying', style: 'support', skill: 'CLEANSE_DAMAGE_ALL' },
];

const SHU_PVP: RosterPvpRow[] = [
  { id: 'liu-bei', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'guan-yu', style: 'attack', skill: 'SINGLE' },
  { id: 'zhang-fei', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'zhuge-liang', style: 'support', skill: 'STUN_ALL' },
  { id: 'zhao-yun', style: 'attack', skill: 'SINGLE' },
  { id: 'ma-chao', style: 'attack', skill: 'BACK_ROW' },
  { id: 'huang-zhong', style: 'attack', skill: 'BACK_ROW' },
  { id: 'wei-yan', style: 'attack', skill: 'VERTICAL' },
  { id: 'jiang-wei', style: 'attack', skill: 'STUN_SINGLE' },
  { id: 'pang-tong', style: 'support', skill: 'ALL_ENEMIES' },
  { id: 'fa-zheng', style: 'support', skill: 'BUFF_ALLIES' },
  { id: 'xu-shu', style: 'support', skill: 'STUN_HORIZONTAL' },
  { id: 'huang-yueying', style: 'support', skill: 'ALL_ENEMIES' },
  { id: 'guan-ping', style: 'attack', skill: 'SINGLE' },
  { id: 'guan-xing', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'ma-dai', style: 'attack', skill: 'BACK_ROW' },
  { id: 'wang-ping', style: 'defense', skill: 'SELF_HP' },
  { id: 'liao-hua', style: 'defense', skill: 'SINGLE' },
  { id: 'jian-yong', style: 'support', skill: 'TEAM_HP' },
  { id: 'mi-zhu', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'guan-yinping', style: 'attack', skill: 'STUN_SINGLE' },
  { id: 'mi-zhen', style: 'support', skill: 'TEAM_HP' },
  { id: 'zhuge-guo', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'bao-sanniang', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'wu-yi', style: 'defense', skill: 'SELF_HP' },
];

const WU_PVP: RosterPvpRow[] = [
  { id: 'sun-jian', style: 'attack', skill: 'HORIZONTAL', damageBps: 15500 },
  { id: 'sun-ce', style: 'attack', skill: 'SINGLE', damageBps: 22000 },
  { id: 'sun-quan', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'zhou-yu', style: 'support', skill: 'ALL_ENEMIES', damageBps: 12000 },
  { id: 'lu-xun', style: 'support', skill: 'HORIZONTAL' },
  { id: 'lu-meng', style: 'attack', skill: 'SINGLE' },
  { id: 'huang-gai', style: 'defense', skill: 'SELF_HP' },
  { id: 'cheng-pu', style: 'defense', skill: 'SELF_HP' },
  { id: 'han-dang', style: 'attack', skill: 'BACK_ROW' },
  { id: 'taishi-ci', style: 'attack', skill: 'SINGLE' },
  { id: 'gan-ning', style: 'attack', skill: 'BACK_ROW' },
  { id: 'ling-tong', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'zhou-tai', style: 'defense', skill: 'SELF_HP' },
  { id: 'xu-sheng', style: 'defense', skill: 'SELF_HP' },
  { id: 'ding-feng', style: 'attack', skill: 'SINGLE' },
  { id: 'zhu-huan', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'zhang-zhao', style: 'support', skill: 'TEAM_DAMAGE' },
  { id: 'zhang-hong', style: 'support', skill: 'BUFF_ALLIES' },
  { id: 'lu-su', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'sun-shangxiang', style: 'attack', skill: 'BACK_ROW' },
  { id: 'da-qiao', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'xiao-qiao', style: 'support', skill: 'TEAM_CRIT' },
  { id: 'bu-lianshi', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'sun-luyu', style: 'support', skill: 'CLEANSE_ALL' },
  { id: 'sun-luban', style: 'support', skill: 'TEAM_HP' },
];

const QUN_PVP: RosterPvpRow[] = [
  { id: 'dong-zhuo', style: 'defense', skill: 'SELF_HP' },
  { id: 'lu-bu', style: 'attack', skill: 'STUN_ALL', damageBps: 11500, stunPerLevelBps: 200 },
  { id: 'diao-chan', style: 'support', skill: 'STUN_SINGLE' },
  { id: 'yuan-shao', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'yuan-shu', style: 'support', skill: 'TEAM_DAMAGE' },
  { id: 'gongsun-zan', style: 'attack', skill: 'BACK_ROW' },
  { id: 'zhang-jiao', style: 'support', skill: 'STUN_ALL' },
  { id: 'zhang-bao', style: 'support', skill: 'HORIZONTAL' },
  { id: 'zhang-liang', style: 'support', skill: 'VERTICAL' },
  { id: 'hua-xiong', style: 'attack', skill: 'SINGLE' },
  { id: 'gao-shun', style: 'defense', skill: 'SELF_HP' },
  { id: 'chen-gong', style: 'support', skill: 'BUFF_ALLIES' },
  { id: 'yan-liang', style: 'attack', skill: 'SINGLE' },
  { id: 'wen-chou', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'tian-feng', style: 'support', skill: 'STUN_HORIZONTAL' },
  { id: 'meng-huo', style: 'support', skill: 'ALL_ENEMIES' },
  { id: 'ma-teng', style: 'attack', skill: 'BACK_ROW' },
  { id: 'han-sui', style: 'support', skill: 'TEAM_DAMAGE' },
  { id: 'tao-qian', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'zhang-lu', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'cai-wenji', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'zou-yu', style: 'support', skill: 'STUN_SINGLE' },
  { id: 'zhurong', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'dong-bai', style: 'attack', skill: 'SINGLE' },
  { id: 'zhang-chunhua', style: 'support', skill: 'STUN_SINGLE' },
];

/** Toàn bộ bảng phong cách + kỹ năng tường minh của roster (SKILLS.md). */
export const PVP_ROSTER_ROWS: readonly RosterPvpRow[] = [...WEI_PVP, ...SHU_PVP, ...WU_PVP, ...QUN_PVP];

/**
 * Nội tại suy ra từ kỹ năng (SKILLS.md không quy định nội tại riêng): tướng có choáng thiên về choáng,
 * tướng hồi/giải thiên về phòng thủ, còn lại thiên về chí mạng.
 */
function passiveForSkill(skill: PvpSkill): PvpPassive {
  const def = PVP_SKILL_DEF[skill];
  if (def.stun !== 'none') return 'STUN_5';
  if (def.cleanse) return 'CLEANSE_10';
  if (def.healBps > 0 || def.selfHealBps > 0) return 'HP_10';
  if (def.buff) return 'DAMAGE_10';
  return 'CRIT_5';
}

export interface PvpProfile {
  style: PvpStyle;
  skill: PvpSkill;
  passive: PvpPassive;
  /** Tướng hot: hệ số kỹ năng đã nhân +10%. */
  hot: boolean;
  /** Hệ số sát thương kỹ năng đã nhân hot (bps). */
  damageBps: number;
  /** Hệ số hồi máu đồng minh đã nhân hot (bps). */
  healBps: number;
  /** Hệ số tự hồi máu theo HP tối đa đã nhân hot (bps). */
  selfHealBps: number;
  /** Tỉ lệ choáng mỗi cấp của kỹ năng (bps; 0 = kỹ năng không choáng). */
  stunPerLevelBps: number;
}

function buildProfile(row: RosterPvpRow): PvpProfile {
  const def = PVP_SKILL_DEF[row.skill];
  const hot = HOT_GENERALS.has(row.id);
  const mul = hot ? PVP_HOT_MULTIPLIER_BPS : BPS_SCALE;
  const stunPerLevelBps =
    def.stun === 'single'
      ? PVP_STUN_SINGLE_BPS_PER_LEVEL
      : def.stun === 'row'
        ? (row.stunPerLevelBps ?? PVP_STUN_ROW_BPS_PER_LEVEL)
        : 0;
  return {
    style: row.style,
    skill: row.skill,
    passive: passiveForSkill(row.skill),
    hot,
    damageBps: Math.round(((row.damageBps ?? def.damageBps) * mul) / BPS_SCALE),
    healBps: Math.round((def.healBps * mul) / BPS_SCALE),
    selfHealBps: Math.round((def.selfHealBps * mul) / BPS_SCALE),
    stunPerLevelBps,
  };
}

const PROFILES = new Map<string, PvpProfile>(PVP_ROSTER_ROWS.map((row) => [row.id, buildProfile(row)]));

/** Hồ sơ chiến đấu của tướng theo bảng tường minh (SKILLS.md). */
export function pvpProfile(generalId: string): PvpProfile {
  const p = PROFILES.get(generalId);
  if (!p) throw new Error(`pvpProfile: không có hồ sơ cho tướng ${generalId}`);
  return p;
}

/** Kiểm tra cấu hình PvP tự nhất quán (gọi trong validate.ts / test). */
export function validatePvpConfig(assert: (cond: unknown, msg: string) => void): void {
  for (const id of PVP_SKILLS) {
    assert(PVP_SKILL_DEF[id], `Thiếu định nghĩa kỹ năng ${id}`);
  }
  for (const s of PVP_STYLES) {
    assert(s in PVP_LC_BY_STYLE, `Thiếu LC cho phong cách ${s}`);
  }
  for (const p of PVP_PASSIVES) {
    assert(PVP_PASSIVE_EFFECT[p], `Thiếu hiệu ứng nội tại ${p}`);
  }
  for (const g of ROSTER) {
    assert(PROFILES.has(g.id), `Tướng ${g.id} chưa có hồ sơ PvP trong SKILLS.md`);
  }
  for (const f of FACTIONS) {
    const ids = HOT_BY_FACTION[f] ?? [];
    assert(ids.length === 10, `Phe ${f} phải có 10 tướng hot, đang có ${ids.length}`);
    for (const id of ids) {
      assert(PROFILES.has(id), `Tướng hot ${id} không có trong roster`);
    }
  }
  assert(pvpBaseHp(MAX_LEVEL) > 0 && pvpBaseDamage(MAX_LEVEL) > 0, 'Chỉ số nền PvP theo cấp phải > 0');
}

/** Toàn bộ hồ sơ chiến đấu của roster — dùng cho test cân bằng và hiển thị. */
export function pvpRosterProfiles(): { id: string; profile: PvpProfile }[] {
  return ROSTER.map((g) => ({ id: g.id, profile: pvpProfile(g.id) }));
}
