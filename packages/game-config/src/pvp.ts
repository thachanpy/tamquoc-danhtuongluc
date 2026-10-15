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
export const PVP_MAX_ROUNDS = 50;

// ===== Chỉ số nền theo cấp (cùng cấp => chỉ số nền tương đương) =====

/** Damage cơ bản nền theo cấp: 200 ở cấp 1, +50 mỗi cấp. */
export const pvpBaseDamage = (level: number) => 200 + 50 * (level - 1);
/** HP tối đa nền theo cấp: luôn gấp 10 lần sát thương nền (2000 ở cấp 1, +500 mỗi cấp). */
export const pvpBaseHp = (level: number) => 10 * pvpBaseDamage(level);

/**
 * LC (lực chiến từng tướng, dùng để cộng thành tổng LC của đội) theo phong cách + cấp.
 * Tấn công cao nhất, rồi Hỗ trợ, cuối là Phòng thủ.
 */
export const PVP_LC_BY_STYLE: Record<PvpStyle, number> = { attack: 130, support: 120, defense: 110 };
export const pvpLc = (style: PvpStyle, level: number) => PVP_LC_BY_STYLE[style] + (level - 1) * 2;

// ===== Hiệu ứng nền (aura) =====

/**
 * Hiệu ứng nền áp trước trận cho từng tướng theo KỸ NĂNG của tướng đó (SKILLS.md).
 * Phong cách chỉ còn quyết định lực chiến (LC) và nhãn hiển thị.
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
  // Sát thương đánh đơn/hàng được nâng để bù việc đánh diện rộng có tổng sát thương cao hơn:
  // đơn mục tiêu 250% (dứt điểm nhanh 1 mục tiêu), hàng ngang/dọc/hàng sau 180% × ~3 mục tiêu,
  // đánh toàn bộ giữ 100% × tối đa 6 mục tiêu. Kỹ năng kèm choáng hạ nhẹ (210%) vì đã có khống chế.
  SINGLE: { targeting: 'single', damageBps: 25000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  HORIZONTAL: { targeting: 'lane', damageBps: 18000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  VERTICAL: { targeting: 'row', damageBps: 18000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  BACK_ROW: { targeting: 'back_row', damageBps: 18000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  ALL_ENEMIES: { targeting: 'all_enemies', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  STUN_SINGLE: { targeting: 'single', damageBps: 21000, healBps: 0, selfHealBps: 0, stun: 'single', cleanse: false, buff: false, aura: PVP_NO_AURA },
  STUN_HORIZONTAL: { targeting: 'lane', damageBps: 18000, healBps: 0, selfHealBps: 0, stun: 'row', cleanse: false, buff: false, aura: PVP_NO_AURA },
  STUN_VERTICAL: { targeting: 'row', damageBps: 18000, healBps: 0, selfHealBps: 0, stun: 'row', cleanse: false, buff: false, aura: PVP_NO_AURA },
  STUN_ALL: { targeting: 'all_enemies', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'row', cleanse: false, buff: false, aura: PVP_NO_AURA },
  SELF_HEAL: { targeting: 'single', damageBps: 21000, healBps: 0, selfHealBps: 1000, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  // Cân bằng hồi máu: tính theo sát thương cơ bản của người thi triển × hệ số × số mục tiêu hồi.
  // Toàn đội (tối đa 6) hạ còn 110%; hàng trước/sau (tối đa 3) nâng lên 220%; 1 người thấp máu
  // nhất nâng lên 330% để đủ sức cứu nguy (tổng mỗi lần ~660% cho nhóm nhiều mục tiêu).
  ALL_ALLIES_HEAL: { targeting: 'all_allies', damageBps: 0, healBps: 11000, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  // Hồi máu chọn theo mục tiêu: 1 đồng minh thấp máu nhất / hàng trước / hàng sau (mục 6.4).
  ALLY_LOWEST_HEAL: { targeting: 'lowest_ally', damageBps: 0, healBps: 33000, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  FRONT_ROW_HEAL: { targeting: 'front_allies', damageBps: 0, healBps: 22000, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  BACK_ROW_HEAL: { targeting: 'back_allies', damageBps: 0, healBps: 22000, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  CLEANSE_ALL: { targeting: 'all_allies', damageBps: 0, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: true, buff: false, aura: PVP_NO_AURA },
  CLEANSE_DAMAGE_ALL: { targeting: 'all_enemies', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: true, buff: false, aura: PVP_NO_AURA },
  BUFF_ALLIES: { targeting: 'all_allies', damageBps: 0, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: true, aura: PVP_NO_AURA },
  // "Bản thân +25% HP tối đa" trong SKILLS.md nghĩa là HỒI 25% HP tối đa mỗi lượt ra đòn (kèm đánh thường 100%).
  SELF_HP: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 2500, stun: 'none', cleanse: false, buff: false, aura: PVP_NO_AURA },
  TEAM_DAMAGE: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, teamDamageBps: 1000 } },
  TEAM_HP: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, teamHpBps: 1000 } },
  TEAM_DAMAGE_HP: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, teamDamageBps: 1000, teamHpBps: 1000 } },
  TEAM_CRIT: { targeting: 'single', damageBps: 10000, healBps: 0, selfHealBps: 0, stun: 'none', cleanse: false, buff: false, aura: { ...PVP_NO_AURA, teamCritPointsBps: 500 } },
};

// ===== Tỉ lệ theo cấp =====

/** Chí mạng: Cấp độ × 3%. */
export const PVP_CRIT_BPS_PER_LEVEL = 300;
/** Choáng đơn mục tiêu: Cấp độ × 7% (tối đa 70% ở cấp 10) — đủ để khống chế chủ lực địch. */
export const PVP_STUN_SINGLE_BPS_PER_LEVEL = 700;
/** Choáng hàng ngang/dọc/diện rộng: Cấp độ × 3% (tối đa 30% ở cấp 10) — mặc định. */
export const PVP_STUN_ROW_BPS_PER_LEVEL = 300;
/**
 * Choáng kéo dài tối đa 2 lượt: gây choáng ở lượt nào thì mục tiêu bỏ lượt ở lượt đó (nếu chưa ra đòn)
 * và lượt kế tiếp, đầu lượt thứ ba thì hết choáng. Ví dụ: choáng ở hiệp 2 → đầu hiệp 4 đã hết.
 */
export const PVP_STUN_ROUNDS = 2;
/**
 * Giải choáng: cấp 1 = 30%, +5% mỗi cấp (cấp 10 = 75%) — dãy 30/35/40/45/50/55/60/65/70/75%.
 * Nội tại CLEANSE_10 (+10 điểm) cộng sẵn vào mốc nền nên vẫn cho ra đúng dãy trên.
 */
export const PVP_CLEANSE_BASE_BPS = 2000;
export const PVP_CLEANSE_BPS_PER_LEVEL = 500;

/** Damage chí mạng = damage trước chí mạng × 1.5 => cộng thêm 50%. */
export const PVP_CRIT_DAMAGE_BPS = 5000;

// ===== Hút máu theo sát thương gây ra (vài tướng riêng) =====

/** Hút máu: hồi cho bản thân 2% sát thương gây ra mỗi cấp (cấp 1 = 2% … cấp 10 = 20%). */
export const PVP_LIFESTEAL_BPS_PER_LEVEL = 200;
/** Tướng có hút máu bị giảm 10% hệ số sát thương kỹ năng để bù lại lượng máu hồi thêm. */
export const PVP_LIFESTEAL_DAMAGE_PENALTY_BPS = 1000;

// ===== Buff từ kỹ năng đặc biệt (BUFF_ALLIES) =====

/**
 * Buff chỉ số chủ động (BUFF_ALLIES) CỘNG DỒN được, mỗi lần thi triển có hiệu lực tối đa
 * `PVP_SKILL_BUFF_ROUNDS` lượt (kể cả lượt thi triển). Nhờ vậy tướng buff đánh liên tục sẽ
 * đạt tối đa 3 lớp chồng nhau rồi dừng (lớp cũ tự hết hạn).
 */
export const PVP_SKILL_BUFF_ROUNDS = 3;
/** Mỗi lớp buff: đồng minh còn sống nhận thêm damage bằng 10% damage cơ bản của chính mình. */
export const PVP_SKILL_BUFF_DAMAGE_BPS = 1000;
/** Mỗi lớp buff: đồng minh còn sống nhận thêm 5 điểm phần trăm chí mạng. */
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
  /** Tên kỹ năng hiển thị — lấy nguyên văn phần trước dấu hai chấm của SKILLS.md. */
  skillName: string;
  style: PvpStyle;
  skill: PvpSkill;
  /** Ghi đè hệ số sát thương kỹ năng (bps) — tướng có hệ số riêng trong SKILLS.md. */
  damageBps?: number;
  /** Ghi đè tỉ lệ choáng mỗi cấp (bps) cho kỹ năng choáng hàng/diện rộng. */
  stunPerLevelBps?: number;
  /** Hút máu: hồi bản thân theo % sát thương gây ra mỗi cấp (bps); có thì damage bị giảm nhẹ. */
  lifestealPerLevelBps?: number;
}

/** Tướng hút máu: hồi bản thân theo sát thương gây ra (mục 6.5 — SKILLS.md). */
const LIFESTEAL = PVP_LIFESTEAL_BPS_PER_LEVEL;

const WEI_PVP: RosterPvpRow[] = [
  { id: 'cao-cao', skillName: 'Hiệu lệnh thiên hạ', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'cao-pi', skillName: 'Đế vương trảm', style: 'attack', skill: 'SINGLE' },
  { id: 'cao-ren', skillName: 'Thiết bích', style: 'defense', skill: 'SELF_HP' },
  { id: 'cao-hong', skillName: 'Hộ chủ', style: 'defense', skill: 'SELF_HEAL' },
  { id: 'cao-zhen', skillName: 'Phá trận', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'xiahou-dun', skillName: 'Độc nhãn cuồng đao', style: 'attack', skill: 'STUN_SINGLE' },
  { id: 'xiahou-yuan', skillName: 'Thần tốc tập kích', style: 'attack', skill: 'BACK_ROW' },
  { id: 'zhang-liao', skillName: 'Uy chấn Tiêu Dao', style: 'attack', skill: 'HORIZONTAL', damageBps: 16000, lifestealPerLevelBps: LIFESTEAL },
  { id: 'yue-jin', skillName: 'Tiên phong phá địch', style: 'attack', skill: 'SINGLE', lifestealPerLevelBps: LIFESTEAL },
  { id: 'yu-jin', skillName: 'Nghiêm trận', style: 'defense', skill: 'SELF_HP', damageBps: 20000 },
  { id: 'zhang-he', skillName: 'Kỳ binh đột kích', style: 'attack', skill: 'BACK_ROW' },
  { id: 'xu-huang', skillName: 'Khai sơn phủ', style: 'attack', skill: 'SINGLE' },
  { id: 'dian-wei', skillName: 'Ác Lai hộ vệ', style: 'defense', skill: 'SELF_HP' },
  { id: 'xu-chu', skillName: 'Hổ si cuồng kích', style: 'defense', skill: 'SINGLE', lifestealPerLevelBps: LIFESTEAL },
  { id: 'guo-jia', skillName: 'Diệu kế thiên cơ', style: 'support', skill: 'BUFF_ALLIES' },
  { id: 'xun-yu', skillName: 'Vương tá chi sách', style: 'support', skill: 'TEAM_DAMAGE' },
  { id: 'xun-you', skillName: 'Liên hoàn kế', style: 'support', skill: 'STUN_VERTICAL' },
  { id: 'jia-xu', skillName: 'Độc kế', style: 'support', skill: 'STUN_SINGLE' },
  { id: 'sima-yi', skillName: 'Ẩn nhẫn phản kích', style: 'support', skill: 'ALL_ENEMIES' },
  { id: 'pang-de', skillName: 'Quan tài quyết chiến', style: 'attack', skill: 'SINGLE' },
  { id: 'zhen-ji', skillName: 'Lạc Thần', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'bian-yuer', skillName: 'Hậu cung an định', style: 'support', skill: 'TEAM_HP' },
  { id: 'cao-hua', skillName: 'Nhu tình hộ mệnh', style: 'support', skill: 'ALLY_LOWEST_HEAL' },
  { id: 'cao-jie', skillName: 'Trung trinh', style: 'support', skill: 'TEAM_CRIT' },
  { id: 'xin-xianying', skillName: 'Tuệ nhãn phá cục', style: 'support', skill: 'CLEANSE_DAMAGE_ALL' },
];

const SHU_PVP: RosterPvpRow[] = [
  { id: 'liu-bei', skillName: 'Nhân đức', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'guan-yu', skillName: 'Thanh Long Yển Nguyệt', style: 'attack', skill: 'SINGLE' },
  { id: 'zhang-fei', skillName: 'Hổ Khiếu Trường Bản', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'zhuge-liang', skillName: 'Bát trận đồ', style: 'support', skill: 'STUN_ALL' },
  { id: 'zhao-yun', skillName: 'Thất Tiến Thất Xuất', style: 'attack', skill: 'SINGLE', lifestealPerLevelBps: LIFESTEAL },
  { id: 'ma-chao', skillName: 'Cẩm Mã Siêu', style: 'attack', skill: 'BACK_ROW', lifestealPerLevelBps: LIFESTEAL },
  { id: 'huang-zhong', skillName: 'Lão Đương Ích Tráng', style: 'attack', skill: 'BACK_ROW' },
  { id: 'wei-yan', skillName: 'Kỳ phong đột kích', style: 'attack', skill: 'VERTICAL' },
  { id: 'jiang-wei', skillName: 'Kế thừa Khổng Minh', style: 'attack', skill: 'STUN_SINGLE' },
  { id: 'pang-tong', skillName: 'Phượng Sồ liên hoàn', style: 'support', skill: 'ALL_ENEMIES' },
  { id: 'fa-zheng', skillName: 'Tiên liệu chiến cơ', style: 'support', skill: 'BUFF_ALLIES' },
  { id: 'xu-shu', skillName: 'Kiếm hiệp phá trận', style: 'support', skill: 'STUN_HORIZONTAL' },
  { id: 'huang-yueying', skillName: 'Cơ quan bát quái', style: 'support', skill: 'ALL_ENEMIES' },
  { id: 'guan-ping', skillName: 'Thanh Long kế thừa', style: 'attack', skill: 'SINGLE', lifestealPerLevelBps: LIFESTEAL },
  { id: 'guan-xing', skillName: 'Hưng binh trảm tướng', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'ma-dai', skillName: 'Truy kích Tây Lương', style: 'attack', skill: 'BACK_ROW' },
  { id: 'wang-ping', skillName: 'Kiên thủ Hán Trung', style: 'defense', skill: 'SELF_HP' },
  { id: 'liao-hua', skillName: 'Lão tướng tiên phong', style: 'defense', skill: 'SINGLE' },
  { id: 'jian-yong', skillName: 'Du thuyết', style: 'support', skill: 'TEAM_HP' },
  { id: 'mi-zhu', skillName: 'Hậu cần vững chắc', style: 'support', skill: 'BACK_ROW_HEAL' },
  { id: 'guan-yinping', skillName: 'Nữ tướng phá quân', style: 'attack', skill: 'STUN_SINGLE' },
  { id: 'mi-zhen', skillName: 'Tương trợ', style: 'support', skill: 'TEAM_HP' },
  { id: 'zhuge-guo', skillName: 'Tiên thuật', style: 'support', skill: 'FRONT_ROW_HEAL' },
  { id: 'bao-sanniang', skillName: 'Hoa vũ song đao', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'wu-yi', skillName: 'Trấn thủ Ích Châu', style: 'defense', skill: 'SELF_HP' },
];

const WU_PVP: RosterPvpRow[] = [
  { id: 'sun-jian', skillName: 'Giang Đông mãnh hổ', style: 'attack', skill: 'HORIZONTAL', damageBps: 15500 },
  { id: 'sun-ce', skillName: 'Tiểu Bá Vương', style: 'attack', skill: 'SINGLE', damageBps: 22000, lifestealPerLevelBps: LIFESTEAL },
  { id: 'sun-quan', skillName: 'Đế nghiệp Giang Đông', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'zhou-yu', skillName: 'Hỏa thiêu Xích Bích', style: 'support', skill: 'ALL_ENEMIES', damageBps: 12000, lifestealPerLevelBps: LIFESTEAL },
  { id: 'lu-xun', skillName: 'Hỏa kế liên doanh', style: 'support', skill: 'HORIZONTAL' },
  { id: 'lu-meng', skillName: 'Bạch y độ giang', style: 'attack', skill: 'SINGLE' },
  { id: 'huang-gai', skillName: 'Khổ nhục kế', style: 'defense', skill: 'SELF_HP', lifestealPerLevelBps: LIFESTEAL },
  { id: 'cheng-pu', skillName: 'Lão tướng trấn quân', style: 'defense', skill: 'SELF_HP' },
  { id: 'han-dang', skillName: 'Cung kỵ hợp kích', style: 'attack', skill: 'BACK_ROW' },
  { id: 'taishi-ci', skillName: 'Thần xạ', style: 'attack', skill: 'SINGLE' },
  { id: 'gan-ning', skillName: 'Cẩm Phàm tập kích', style: 'attack', skill: 'BACK_ROW' },
  { id: 'ling-tong', skillName: 'Liên kích', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'zhou-tai', skillName: 'Hộ chủ bất khuất', style: 'defense', skill: 'SELF_HP' },
  { id: 'xu-sheng', skillName: 'Giang phòng thiết thủ', style: 'defense', skill: 'SELF_HP' },
  { id: 'ding-feng', skillName: 'Tuyết trung đột kích', style: 'attack', skill: 'SINGLE' },
  { id: 'zhu-huan', skillName: 'Hỏa công phá trận', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'zhang-zhao', skillName: 'Ổn định triều chính', style: 'support', skill: 'TEAM_DAMAGE' },
  { id: 'zhang-hong', skillName: 'Hoành sách', style: 'support', skill: 'BUFF_ALLIES' },
  { id: 'lu-su', skillName: 'Liên minh Tôn Lưu', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'sun-shangxiang', skillName: 'Kiêu cơ cung vũ', style: 'attack', skill: 'BACK_ROW' },
  { id: 'da-qiao', skillName: 'Quốc sắc', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'xiao-qiao', skillName: 'Thiên hương', style: 'support', skill: 'TEAM_CRIT' },
  { id: 'bu-lianshi', skillName: 'Hiền hậu hộ quân', style: 'support', skill: 'ALLY_LOWEST_HEAL' },
  { id: 'sun-luyu', skillName: 'Hòa giải', style: 'support', skill: 'CLEANSE_ALL' },
  { id: 'sun-luban', skillName: 'An định Giang Đông', style: 'support', skill: 'TEAM_HP' },
];

const QUN_PVP: RosterPvpRow[] = [
  { id: 'dong-zhuo', skillName: 'Bạo chúa', style: 'defense', skill: 'SELF_HP' },
  { id: 'lu-bu', skillName: 'Vô song', style: 'attack', skill: 'STUN_ALL', damageBps: 11500, stunPerLevelBps: 200, lifestealPerLevelBps: LIFESTEAL },
  { id: 'diao-chan', skillName: 'Bế nguyệt', style: 'support', skill: 'STUN_SINGLE' },
  { id: 'yuan-shao', skillName: 'Thế gia hào tộc', style: 'support', skill: 'TEAM_DAMAGE_HP' },
  { id: 'yuan-shu', skillName: 'Trọng thị đế nghiệp', style: 'support', skill: 'TEAM_DAMAGE' },
  { id: 'gongsun-zan', skillName: 'Bạch mã nghĩa tùng', style: 'attack', skill: 'BACK_ROW' },
  { id: 'zhang-jiao', skillName: 'Thái Bình đạo', style: 'support', skill: 'STUN_ALL' },
  { id: 'zhang-bao', skillName: 'Địa công tướng quân', style: 'support', skill: 'HORIZONTAL' },
  { id: 'zhang-liang', skillName: 'Nhân công tướng quân', style: 'support', skill: 'VERTICAL' },
  { id: 'hua-xiong', skillName: 'Uy chấn Hổ Lao', style: 'attack', skill: 'SINGLE', lifestealPerLevelBps: LIFESTEAL },
  { id: 'gao-shun', skillName: 'Hãm Trận Doanh', style: 'defense', skill: 'SELF_HP' },
  { id: 'chen-gong', skillName: 'Mưu định', style: 'support', skill: 'BUFF_ALLIES' },
  { id: 'yan-liang', skillName: 'Danh tướng Hà Bắc', style: 'attack', skill: 'SINGLE' },
  { id: 'wen-chou', skillName: 'Mãnh tướng Hà Bắc', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'tian-feng', skillName: 'Trực gián', style: 'support', skill: 'STUN_HORIZONTAL' },
  { id: 'meng-huo', skillName: 'Viễn mưu', style: 'support', skill: 'ALL_ENEMIES' },
  { id: 'ma-teng', skillName: 'Tây Lương thiết kỵ', style: 'attack', skill: 'BACK_ROW' },
  { id: 'han-sui', skillName: 'Liên hoành', style: 'support', skill: 'TEAM_DAMAGE' },
  { id: 'tao-qian', skillName: 'Nhân nghĩa Từ Châu', style: 'support', skill: 'ALL_ALLIES_HEAL' },
  { id: 'zhang-lu', skillName: 'Ngũ Đấu Mễ Đạo', style: 'support', skill: 'FRONT_ROW_HEAL' },
  { id: 'cai-wenji', skillName: 'Bi ca', style: 'support', skill: 'BACK_ROW_HEAL' },
  { id: 'zou-yu', skillName: 'Mị ảnh', style: 'support', skill: 'STUN_SINGLE' },
  { id: 'zhurong', skillName: 'Phi đao Nam Man', style: 'attack', skill: 'HORIZONTAL' },
  { id: 'dong-bai', skillName: 'Quý tộc tàn bạo', style: 'attack', skill: 'SINGLE' },
  { id: 'zhang-chunhua', skillName: 'Lãnh tâm', style: 'support', skill: 'STUN_SINGLE' },
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
  /** Tên kỹ năng hiển thị (nguyên văn SKILLS.md) — dùng cho nhãn "bay lên" khi tướng ra đòn. */
  skillName: string;
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
  /** Hút máu theo sát thương gây ra mỗi cấp (bps; 0 = không hút máu). */
  lifestealPerLevelBps: number;
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
  const lifestealPerLevelBps = row.lifestealPerLevelBps ?? 0;
  // Tướng hút máu bị giảm nhẹ hệ số sát thương kỹ năng để bù lượng máu hồi thêm mỗi lượt.
  const rawDamage = row.damageBps ?? def.damageBps;
  const damageWithPenalty = lifestealPerLevelBps
    ? Math.round((rawDamage * (BPS_SCALE - PVP_LIFESTEAL_DAMAGE_PENALTY_BPS)) / BPS_SCALE)
    : rawDamage;
  return {
    style: row.style,
    skill: row.skill,
    skillName: row.skillName,
    passive: passiveForSkill(row.skill),
    hot,
    damageBps: Math.round((damageWithPenalty * mul) / BPS_SCALE),
    healBps: Math.round((def.healBps * mul) / BPS_SCALE),
    selfHealBps: Math.round((def.selfHealBps * mul) / BPS_SCALE),
    stunPerLevelBps,
    lifestealPerLevelBps,
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
  const skillNames = new Set<string>();
  for (const row of PVP_ROSTER_ROWS) {
    assert(row.skillName.trim().length > 0, `Tướng ${row.id} thiếu tên kỹ năng`);
    assert(!skillNames.has(row.skillName), `Tên kỹ năng bị trùng: ${row.skillName}`);
    skillNames.add(row.skillName);
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
