import type { Faction, PvpBuffScope, PvpPassive, PvpSkill, PvpStyle, PvpTargeting } from '@tq/shared';
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
 * - Mọi hệ số sát thương/hồi máu trong bảng dưới đây là GIÁ TRỊ CHỐT (đã gồm ưu đãi tướng hot ⭐).
 */

/** Số lane mỗi hàng và số hàng mỗi đội. */
export const PVP_LANES = 3;
export const PVP_ROWS = 2;
export { PVP_TEAM_SIZE };

/** Giới hạn số vòng để tránh trận bất tử. Quá số vòng mà chưa phân thắng bại thì hai đội hoà. */
export const PVP_MAX_ROUNDS = 50;

// ===== Chỉ số nền theo cấp (cùng cấp => chỉ số nền tương đương) =====

/** Damage cơ bản nền theo cấp: 200 ở cấp 1, +50 mỗi cấp. */
export const pvpBaseDamage = (level: number) => 200 + 50 * (level - 1);
/** HP tối đa nền theo cấp: luôn gấp 10 lần sát thương nền (2000 ở cấp 1, +500 mỗi cấp). */
export const pvpBaseHp = (level: number) => 10 * pvpBaseDamage(level);

/**
 * LC (lực chiến từng tướng, dùng để cộng thành tổng LC của đội) theo phong cách + cấp.
 * Tấn công cao nhất, rồi Hỗ trợ, cuối là Phòng thủ. Phong cách KHÔNG cộng chỉ số chiến đấu.
 */
export const PVP_LC_BY_STYLE: Record<PvpStyle, number> = { attack: 130, support: 120, defense: 110 };
export const pvpLc = (style: PvpStyle, level: number) => PVP_LC_BY_STYLE[style] + (level - 1) * 2;

// ===== Hiệu ứng có lợi (buff) phát cho bản thân/đồng minh =====

/**
 * Buff tăng sức mạnh mà kỹ năng phát cho phạm vi `buffScope` MỖI LẦN tướng tới lượt.
 * Mỗi lần thi triển cộng thêm MỘT lớp; các lớp cộng dồn tối đa `maxLayers` lớp,
 * mỗi lớp hiệu lực `rounds` lượt (mặc định 2 lượt, 3 lớp — SKILLS.md mục 1).
 */
export interface PvpBuff {
  /** % sát thương cộng mỗi lớp (theo sát thương nền của chính tướng nhận buff). */
  damageBps: number;
  /** % HP tối đa cộng mỗi lớp: tăng trần HP và hồi đúng lượng tăng. */
  hpBps: number;
  /** Điểm chí mạng cộng mỗi lớp (bps: 500 = +5 điểm phần trăm). */
  critBps: number;
  /** % sát thương chí mạng cộng mỗi lớp (mặc định ST chí mạng = 150%). */
  critDamageBps: number;
  /** % sát thương gánh chịu được giảm mỗi lớp (giảm ST nhận). */
  takenDownBps: number;
  /** Số lượt mỗi lớp còn hiệu lực. */
  rounds: number;
  /** Số lớp cộng dồn tối đa. */
  maxLayers: number;
}

/** Số lượt mỗi lớp buff còn hiệu lực (kể cả lượt thi triển). */
export const PVP_BUFF_ROUNDS = 2;
/** Số lớp buff cộng dồn tối đa (lớp mới nhất thay lớp cũ nhất khi vượt trần). */
export const PVP_BUFF_MAX_LAYERS = 3;

/** Không buff (mặc định cho kỹ năng sát thương/hồi máu/choáng...). */
export const PVP_NO_BUFF: PvpBuff = {
  damageBps: 0,
  hpBps: 0,
  critBps: 0,
  critDamageBps: 0,
  takenDownBps: 0,
  rounds: PVP_BUFF_ROUNDS,
  maxLayers: PVP_BUFF_MAX_LAYERS,
};

// ===== Hiệu ứng bất lợi (debuff) áp lên địch =====

/**
 * Hiệu ứng bất lợi mà kỹ năng áp lên mục tiêu địch. Mỗi lần thi triển cộng MỘT lớp; các lớp cộng dồn
 * tối đa `maxLayers`, mỗi lớp hiệu lực `rounds` lượt. Giá trị là MỨC GIẢM (dương).
 * Riêng thiêu đốt có vòng đời và trần lớp riêng (`burnRounds`, `burnMaxLayers`).
 */
export interface PvpDebuff {
  /** Giảm sát thương mục tiêu gây ra (bps theo sát thương nền của chính mục tiêu). */
  damageDownBps: number;
  /** Giảm HP tối đa của mục tiêu (bps theo HP nền). */
  hpDownBps: number;
  /** Giảm điểm chí mạng của mục tiêu (bps: 500 = −5 điểm phần trăm). */
  critDownBps: number;
  /** Giảm % sát thương chí mạng của mục tiêu. */
  critDamageDownBps: number;
  /** Thiêu đốt: mỗi lượt gây thêm % sát thương cơ bản của người thi triển (bps). */
  burnBps: number;
  /** Số lượt thiêu đốt còn hiệu lực. */
  burnRounds: number;
  /** Số lớp thiêu đốt cộng dồn tối đa từ chính tướng thi triển. */
  burnMaxLayers: number;
  /** Số lượt mỗi lớp hiệu ứng bất lợi còn hiệu lực. */
  rounds: number;
  /** Số lớp hiệu ứng bất lợi cộng dồn tối đa. */
  maxLayers: number;
  /** Xóa toàn bộ hiệu ứng có lợi (lớp buff) của mục tiêu. */
  dispel: boolean;
}

/** Số lượt mỗi lớp hiệu ứng bất lợi còn hiệu lực (kể cả lượt thi triển). */
export const PVP_DEBUFF_ROUNDS = 2;
/** Số lớp hiệu ứng bất lợi cộng dồn tối đa. */
export const PVP_DEBUFF_MAX_LAYERS = 3;

/** Thiêu đốt: mỗi lượt gây thêm 20% sát thương cơ bản của người thi triển. */
export const PVP_BURN_BPS = 2000;
/** Thiêu đốt thường duy trì 2 lượt, không cộng dồn. */
export const PVP_BURN_ROUNDS = 2;
/** Chu Du / Lục Tốn / Hoàng Cái: duy trì 3 lượt, cộng dồn tối đa 3 lớp. */
export const PVP_BURN_ROUNDS_LONG = 3;
export const PVP_BURN_MAX_LAYERS_LONG = 3;
/** Giới hạn toàn hệ thống: trên 1 mục tiêu tối đa 5 hiệu ứng Thiêu đốt cùng lúc. */
export const PVP_MAX_BURN_LAYERS = 5;

/** Không gây hiệu ứng bất lợi (mặc định cho kỹ năng sát thương/hồi máu/buff). */
export const PVP_NO_DEBUFF: PvpDebuff = {
  damageDownBps: 0,
  hpDownBps: 0,
  critDownBps: 0,
  critDamageDownBps: 0,
  burnBps: 0,
  burnRounds: 0,
  burnMaxLayers: 0,
  rounds: PVP_DEBUFF_ROUNDS,
  maxLayers: PVP_DEBUFF_MAX_LAYERS,
  dispel: false,
};

// ===== Phản kích (SKILLS.md mục 12) =====

/**
 * Phản kích: khi nhận sát thương chủ động (đánh thường/kỹ năng direct), có tỷ lệ đánh trả.
 * KHÔNG kích hoạt từ sát thương gián tiếp (Thiêu đốt, Giảm/Mất máu tối đa).
 */
export interface PvpCounter {
  /** Tỉ lệ phản kích mỗi cấp (bps): cấp × 3%, trần 30%. */
  perLevelBps: number;
  /** % sát thương cơ bản đánh trả (bps: 5000 = 50%). */
  damageBps: number;
  /** Số lượt hiệu lực. */
  rounds: number;
  /** 'single' = đánh trả kẻ vừa gây sát thương; 'all' = đánh trả toàn bộ địch. */
  scope: 'single' | 'all';
}

/** Phản kích đơn mục tiêu: 50% ST cơ bản. */
export const PVP_COUNTER_DAMAGE_BPS = 5000;
/** Phản kích diện rộng: 30% ST cơ bản. */
export const PVP_COUNTER_ALL_DAMAGE_BPS = 3000;
/** Tỉ lệ phản kích mỗi cấp (cấp × 3%, trần 30%). */
export const PVP_COUNTER_BPS_PER_LEVEL = 300;
/** Trần tỉ lệ phản kích (30%). */
export const PVP_COUNTER_MAX_BPS = 3000;
/** Số lượt hiệu lực của phản kích. */
export const PVP_COUNTER_ROUNDS = 2;

/** Không phản kích. */
export const PVP_NO_COUNTER: PvpCounter = { perLevelBps: 0, damageBps: 0, rounds: 0, scope: 'single' };

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

/** Định nghĩa kỹ năng hoàn chỉnh của MỘT tướng (đã gộp mọi hiệu ứng tường minh của SKILLS.md). */
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
  /** Tỉ lệ choáng mỗi cấp (bps; 0 = kỹ năng không choáng). Trần = perLevel × MAX_LEVEL. */
  stunPerLevelBps: number;
  /** Kỹ năng có kiểm tra giải choáng cho đồng minh. Tướng có giải choáng MIỄN NHIỄM choáng. */
  cleanse: boolean;
  /** Kỹ năng thanh tẩy hiệu ứng bất lợi cho đồng minh (trừ choáng và thiêu đốt). */
  purify: boolean;
  /** Xóa hiệu ứng có lợi (lớp buff) của đối thủ. */
  dispel: boolean;
  /** Xác suất xóa hiệu ứng có lợi thành công (bps; 10000 = chắc chắn). */
  dispelChanceBps: number;
  /** Buff tăng sức mạnh phát cho `buffScope` mỗi lần tướng tới lượt. */
  buff: PvpBuff;
  /** Phạm vi nhận buff. 'none' = kỹ năng không buff. */
  buffScope: PvpBuffScope;
  /** Hiệu ứng bất lợi áp lên địch. */
  debuff: PvpDebuff;
  /** Phản kích khi gánh chịu sát thương chủ động. */
  counter: PvpCounter;
  /** Kỹ năng tự gây thiêu đốt lên bản thân (Khổ nhục kế — Hoàng Cái). */
  selfBurn: boolean;
  /** Số lượt tự thiêu đốt. */
  selfBurnRounds: number;
}

/**
 * Danh mục 9 NHÓM kỹ năng (chỉ để phân loại/nhãn dự phòng trên UI). Mỗi tướng có bộ hiệu ứng
 * tường minh trong `PVP_ROSTER_ROWS`; bảng này là mẫu đại diện cho từng nhóm.
 */
export const PVP_SKILL_DEF: Record<PvpSkill, PvpSkillDef> = {
  ATTACK: { targeting: 'single', damageBps: 25000, healBps: 0, selfHealBps: 0, stun: 'none', stunPerLevelBps: 0, cleanse: false, purify: false, dispel: false, dispelChanceBps: 0, buff: PVP_NO_BUFF, buffScope: 'none', debuff: PVP_NO_DEBUFF, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
  STUN: { targeting: 'single', damageBps: 25000, healBps: 0, selfHealBps: 0, stun: 'single', stunPerLevelBps: 300, cleanse: false, purify: false, dispel: false, dispelChanceBps: 0, buff: PVP_NO_BUFF, buffScope: 'none', debuff: PVP_NO_DEBUFF, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
  BUFF: { targeting: 'all_allies', damageBps: 0, healBps: 0, selfHealBps: 0, stun: 'none', stunPerLevelBps: 0, cleanse: false, purify: false, dispel: false, dispelChanceBps: 0, buff: { ...PVP_NO_BUFF, damageBps: 1000 }, buffScope: 'all_allies', debuff: PVP_NO_DEBUFF, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
  HEAL: { targeting: 'all_allies', damageBps: 0, healBps: 11000, selfHealBps: 0, stun: 'none', stunPerLevelBps: 0, cleanse: false, purify: false, dispel: false, dispelChanceBps: 0, buff: PVP_NO_BUFF, buffScope: 'none', debuff: PVP_NO_DEBUFF, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
  DEBUFF: { targeting: 'single', damageBps: 25000, healBps: 0, selfHealBps: 0, stun: 'none', stunPerLevelBps: 0, cleanse: false, purify: false, dispel: false, dispelChanceBps: 0, buff: PVP_NO_BUFF, buffScope: 'none', debuff: { ...PVP_NO_DEBUFF, damageDownBps: 1500 }, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
  BURN: { targeting: 'all_enemies', damageBps: 8000, healBps: 0, selfHealBps: 0, stun: 'none', stunPerLevelBps: 0, cleanse: false, purify: false, dispel: false, dispelChanceBps: 0, buff: PVP_NO_BUFF, buffScope: 'none', debuff: { ...PVP_NO_DEBUFF, burnBps: PVP_BURN_BPS, burnRounds: PVP_BURN_ROUNDS }, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
  DISPEL: { targeting: 'single', damageBps: 25000, healBps: 0, selfHealBps: 0, stun: 'none', stunPerLevelBps: 0, cleanse: false, purify: false, dispel: true, dispelChanceBps: BPS_SCALE, buff: PVP_NO_BUFF, buffScope: 'none', debuff: PVP_NO_DEBUFF, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
  PURIFY: { targeting: 'all_allies', damageBps: 0, healBps: 0, selfHealBps: 0, stun: 'none', stunPerLevelBps: 0, cleanse: false, purify: true, dispel: false, dispelChanceBps: 0, buff: PVP_NO_BUFF, buffScope: 'none', debuff: PVP_NO_DEBUFF, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
  CLEANSE: { targeting: 'all_allies', damageBps: 0, healBps: 0, selfHealBps: 0, stun: 'none', stunPerLevelBps: 0, cleanse: true, purify: false, dispel: false, dispelChanceBps: 0, buff: PVP_NO_BUFF, buffScope: 'none', debuff: PVP_NO_DEBUFF, counter: PVP_NO_COUNTER, selfBurn: false, selfBurnRounds: 0 },
};

// ===== Tỉ lệ theo cấp =====

/** Chí mạng: Cấp độ × 3%. */
export const PVP_CRIT_BPS_PER_LEVEL = 300;
/**
 * Giải choáng: cấp 1 = 30%, +5% mỗi cấp (cấp 10 = 75%) — dãy 30/35/40/45/50/55/60/65/70/75%.
 * Nội tại CLEANSE_10 (+10 điểm) cộng sẵn vào mốc nền nên vẫn cho ra đúng dãy trên.
 */
export const PVP_CLEANSE_BASE_BPS = 2000;
export const PVP_CLEANSE_BPS_PER_LEVEL = 500;

/** Mặc định ST chí mạng = 150% (tức cộng thêm 50% khi chí mạng). Buff/debuff điều chỉnh quanh mốc này. */
export const PVP_CRIT_DAMAGE_BPS = 5000;

// ===== Hút máu (SKILLS.md mục 1.13) =====

/** Hút máu tướng tiêu chuẩn: hồi theo `cấp × 2%` sát thương gây ra (max 20%). */
export const PVP_LIFESTEAL_BPS_PER_LEVEL = 200;
/** Hút máu tướng Sát thủ/Bùng nổ cao: `cấp × 3%` (max 30%). */
export const PVP_LIFESTEAL_HIGH_BPS_PER_LEVEL = 300;
/** Hút máu mốc giữa (một số tướng đặc biệt): `cấp × 2.5%` (max 25%). */
export const PVP_LIFESTEAL_MID_BPS_PER_LEVEL = 250;

// ===== Tướng hot (SKILLS.md) =====

/**
 * Hệ số ưu đãi tướng hot. Trong SKILLS.md, mọi hệ số sát thương/hồi máu của bảng dưới đây ĐÃ là
 * giá trị chốt (đã bao gồm +10% cho tướng hot) nên hằng số này giữ lại chỉ để tra cứu/tài liệu.
 */
export const PVP_HOT_MULTIPLIER_BPS = 11000;

/** 10 tướng hot mỗi phe (theo độ nổi tiếng) — hệ số kỹ năng đã cộng sẵn +10%. */
const HOT_BY_FACTION: Record<Faction, readonly string[]> = {
  wei: ['cao-cao', 'cao-pi', 'xiahou-dun', 'xiahou-yuan', 'zhang-liao', 'xu-huang', 'dian-wei', 'xu-chu', 'sima-yi', 'guo-jia'],
  shu: ['liu-bei', 'guan-yu', 'zhang-fei', 'zhuge-liang', 'zhao-yun', 'ma-chao', 'huang-zhong', 'wei-yan', 'jiang-wei', 'pang-tong'],
  wu: ['sun-jian', 'sun-ce', 'sun-quan', 'zhou-yu', 'lu-xun', 'lu-meng', 'huang-gai', 'taishi-ci', 'gan-ning', 'lu-su'],
  qun: ['dong-zhuo', 'lu-bu', 'diao-chan', 'yuan-shao', 'zhang-jiao', 'gongsun-zan', 'hua-xiong', 'yan-liang', 'wen-chou', 'chen-gong'],
};

export const HOT_GENERALS: ReadonlySet<string> = new Set(FACTIONS.flatMap((f) => HOT_BY_FACTION[f]));
export const isHotGeneral = (generalId: string) => HOT_GENERALS.has(generalId);

// ===== Bảng hồ sơ chiến đấu tường minh theo SKILLS.md =====

/** Một dòng tướng: mã hoá tường minh bộ hiệu ứng kỹ năng theo SKILLS.md (đã gồm hot). */
interface RosterPvpRow {
  id: string;
  /** Tên kỹ năng hiển thị — nguyên văn phần trước dấu hai chấm của SKILLS.md. */
  skillName: string;
  style: PvpStyle;
  skill: PvpSkill;
  targeting: PvpTargeting;
  damageBps?: number;
  healBps?: number;
  selfHealBps?: number;
  stun?: 'none' | 'single' | 'row';
  stunPerLevelBps?: number;
  cleanse?: boolean;
  purify?: boolean;
  dispel?: boolean;
  /** Xác suất xóa hiệu ứng có lợi (bps); bỏ trống = chắc chắn (10000). */
  dispelChanceBps?: number;
  buff?: Partial<PvpBuff>;
  buffScope?: PvpBuffScope;
  debuff?: Partial<PvpDebuff>;
  counter?: Partial<PvpCounter>;
  /** Hút máu: hồi bản thân theo `cấp × hệ số` sát thương gây ra (bps mỗi cấp; 0 = không hút máu). */
  lifestealPerLevelBps?: number;
  selfBurn?: boolean;
  selfBurnRounds?: number;
}

// ----- Phe Ngụy: suy yếu, khống chế, xóa buff đối thủ, phản kích -----

const WEI_PVP: RosterPvpRow[] = [
  { id: 'cao-cao', skillName: 'Hiệu lệnh thiên hạ', style: 'support', skill: 'DISPEL', targeting: 'all_enemies', damageBps: 7500, dispel: true, dispelChanceBps: 3000, buff: { damageBps: 1500 }, buffScope: 'self' },
  { id: 'cao-pi', skillName: 'Đế vương trảm', style: 'attack', skill: 'ATTACK', targeting: 'single', damageBps: 29000, debuff: { critDownBps: 2000, critDamageDownBps: 2000 } },
  { id: 'cao-ren', skillName: 'Thiết bích', style: 'defense', skill: 'BUFF', targeting: 'all_allies', buff: { hpBps: 1500 }, buffScope: 'self', selfHealBps: 1500, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_ALL_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'all' } },
  { id: 'cao-hong', skillName: 'Hộ chủ', style: 'defense', skill: 'ATTACK', targeting: 'single', damageBps: 23000, selfHealBps: 1000, buff: { takenDownBps: 1500 }, buffScope: 'self' },
  { id: 'cao-zhen', skillName: 'Phá trận', style: 'attack', skill: 'DEBUFF', targeting: 'lane', damageBps: 20000, debuff: { damageDownBps: 1500 } },
  { id: 'xiahou-dun', skillName: 'Độc nhãn cuồng đao', style: 'attack', skill: 'STUN', targeting: 'single', damageBps: 28500, stun: 'single', stunPerLevelBps: 400, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'xiahou-yuan', skillName: 'Thần tốc tập kích', style: 'attack', skill: 'DEBUFF', targeting: 'back_row', damageBps: 22000, debuff: { critDownBps: 1500 } },
  { id: 'zhang-liao', skillName: 'Uy chấn Tiêu Dao', style: 'attack', skill: 'BUFF', targeting: 'lane', damageBps: 23000, debuff: { damageDownBps: 1000 }, buff: { damageBps: 1000 }, buffScope: 'self', lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_ALL_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'all' } },
  { id: 'yue-jin', skillName: 'Tiên phong phá địch', style: 'attack', skill: 'DISPEL', targeting: 'single', damageBps: 27000, dispel: true, lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'yu-jin', skillName: 'Nghiêm trận', style: 'defense', skill: 'BUFF', targeting: 'all_allies', selfHealBps: 2000, buff: { takenDownBps: 2000 }, buffScope: 'self', counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'zhang-he', skillName: 'Kỳ binh đột kích', style: 'attack', skill: 'STUN', targeting: 'back_row', damageBps: 20000, stun: 'single', stunPerLevelBps: 300 },
  { id: 'xu-huang', skillName: 'Khai sơn phủ', style: 'attack', skill: 'DEBUFF', targeting: 'single', damageBps: 30500, debuff: { damageDownBps: 2000 }, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'dian-wei', skillName: 'Ác Lai hộ vệ', style: 'defense', skill: 'BUFF', targeting: 'all_allies', buff: { hpBps: 2000 }, buffScope: 'self', selfHealBps: 1500, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'xu-chu', skillName: 'Hổ si cuồng kích', style: 'defense', skill: 'BUFF', targeting: 'single', damageBps: 29500, buff: { damageBps: 2000 }, buffScope: 'self', lifestealPerLevelBps: PVP_LIFESTEAL_MID_BPS_PER_LEVEL },
  { id: 'guo-jia', skillName: 'Diệu kế thiên cơ', style: 'support', skill: 'DISPEL', targeting: 'all_enemies', damageBps: 7000, dispel: true, debuff: { critDownBps: 1500 } },
  { id: 'xun-yu', skillName: 'Vương tá chi sách', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { damageBps: 1500, takenDownBps: 1000 }, buffScope: 'all_allies' },
  { id: 'xun-you', skillName: 'Liên hoàn kế', style: 'support', skill: 'STUN', targeting: 'row', damageBps: 12000, stun: 'row', stunPerLevelBps: 300 },
  { id: 'jia-xu', skillName: 'Độc kế', style: 'support', skill: 'STUN', targeting: 'single', damageBps: 12000, stun: 'single', stunPerLevelBps: 1000 },
  { id: 'sima-yi', skillName: 'Ẩn nhẫn phản kích', style: 'support', skill: 'DEBUFF', targeting: 'all_enemies', damageBps: 9000, debuff: { damageDownBps: 1500 } },
  { id: 'pang-de', skillName: 'Quan tài quyết chiến', style: 'attack', skill: 'BUFF', targeting: 'single', damageBps: 28000, lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, buff: { critBps: 2500, critDamageBps: 2500 }, buffScope: 'self' },
  { id: 'zhen-ji', skillName: 'Lạc Thần', style: 'support', skill: 'HEAL', targeting: 'all_allies', healBps: 11000, buff: { takenDownBps: 1000 }, buffScope: 'all_allies' },
  { id: 'bian-yuer', skillName: 'Hậu cung an định', style: 'support', skill: 'HEAL', targeting: 'all_allies', healBps: 8000, buff: { hpBps: 1000 }, buffScope: 'all_allies' },
  { id: 'cao-hua', skillName: 'Nhu tình hộ mệnh', style: 'support', skill: 'HEAL', targeting: 'lowest_ally', healBps: 33000, buff: { damageBps: 1500 }, buffScope: 'lowest_ally' },
  { id: 'cao-jie', skillName: 'Trung trinh', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { critBps: 1500, takenDownBps: 1000 }, buffScope: 'all_allies' },
  { id: 'xin-xianying', skillName: 'Tuệ nhãn phá cục', style: 'support', skill: 'CLEANSE', targeting: 'all_enemies', damageBps: 6500, cleanse: true },
];

// ----- Phe Thục: bùng nổ, chí mạng, phản kích -----

const SHU_PVP: RosterPvpRow[] = [
  { id: 'liu-bei', skillName: 'Nhân đức', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { damageBps: 1500, hpBps: 1000 }, buffScope: 'all_allies' },
  { id: 'guan-yu', skillName: 'Thanh Long Yển Nguyệt', style: 'attack', skill: 'ATTACK', targeting: 'single', damageBps: 32000, buff: { critBps: 3000, critDamageBps: 3000 }, buffScope: 'self' },
  { id: 'zhang-fei', skillName: 'Hổ Khiếu Trường Bản', style: 'attack', skill: 'BUFF', targeting: 'lane', damageBps: 22000, buff: { damageBps: 2000 }, buffScope: 'self', counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_ALL_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'all' } },
  { id: 'zhuge-liang', skillName: 'Bát trận đồ', style: 'support', skill: 'STUN', targeting: 'all_enemies', damageBps: 8000, stun: 'row', stunPerLevelBps: 200, buff: { damageBps: 1000 }, buffScope: 'all_allies' },
  { id: 'zhao-yun', skillName: 'Thất Tiến Thất Xuất', style: 'attack', skill: 'ATTACK', targeting: 'single', damageBps: 28000, buff: { critBps: 2000 }, buffScope: 'self', selfHealBps: 1500, lifestealPerLevelBps: PVP_LIFESTEAL_HIGH_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'ma-chao', skillName: 'Cẩm Mã Siêu', style: 'attack', skill: 'ATTACK', targeting: 'front_enemies', damageBps: 21000, lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, buff: { critBps: 2500, critDamageBps: 2000 }, buffScope: 'self' },
  { id: 'huang-zhong', skillName: 'Lão Đương Ích Tráng', style: 'attack', skill: 'ATTACK', targeting: 'back_row', damageBps: 21000, buff: { critBps: 3500 }, buffScope: 'self' },
  { id: 'wei-yan', skillName: 'Kỳ phong đột kích', style: 'attack', skill: 'BUFF', targeting: 'row', damageBps: 22000, buff: { damageBps: 2000 }, buffScope: 'self', counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'jiang-wei', skillName: 'Kế thừa Khổng Minh', style: 'attack', skill: 'STUN', targeting: 'single', damageBps: 26000, stun: 'single', stunPerLevelBps: 400, buff: { damageBps: 1500 }, buffScope: 'self' },
  { id: 'pang-tong', skillName: 'Phượng Sồ liên hoàn', style: 'support', skill: 'BUFF', targeting: 'all_enemies', damageBps: 8500, buff: { damageBps: 1500 }, buffScope: 'all_allies' },
  { id: 'fa-zheng', skillName: 'Tiên liệu chiến cơ', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { damageBps: 1500, critBps: 1500, critDamageBps: 2000 }, buffScope: 'all_allies' },
  { id: 'xu-shu', skillName: 'Kiếm hiệp phá trận', style: 'support', skill: 'STUN', targeting: 'lane', damageBps: 12000, stun: 'row', stunPerLevelBps: 300 },
  { id: 'huang-yueying', skillName: 'Cơ quan bát quái', style: 'support', skill: 'BUFF', targeting: 'all_enemies', damageBps: 7500, buff: { critBps: 1000 }, buffScope: 'all_allies' },
  { id: 'guan-ping', skillName: 'Thanh Long kế thừa', style: 'attack', skill: 'BUFF', targeting: 'single', damageBps: 26000, buff: { damageBps: 1500 }, buffScope: 'self', lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'guan-xing', skillName: 'Hưng binh trảm tướng', style: 'attack', skill: 'ATTACK', targeting: 'lane', damageBps: 20000, buff: { critBps: 1500 }, buffScope: 'self' },
  { id: 'ma-dai', skillName: 'Truy kích Tây Lương', style: 'attack', skill: 'BUFF', targeting: 'back_row', damageBps: 20000, buff: { damageBps: 1500 }, buffScope: 'self' },
  { id: 'wang-ping', skillName: 'Kiên thủ Hán Trung', style: 'defense', skill: 'BUFF', targeting: 'all_allies', buff: { takenDownBps: 2500 }, buffScope: 'self', selfHealBps: 1500, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'liao-hua', skillName: 'Lão tướng tiên phong', style: 'defense', skill: 'BUFF', targeting: 'single', damageBps: 27000, buff: { hpBps: 1500 }, buffScope: 'self', counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'jian-yong', skillName: 'Du thuyết', style: 'support', skill: 'PURIFY', targeting: 'all_allies', buff: { damageBps: 1000 }, buffScope: 'all_allies', purify: true },
  { id: 'mi-zhu', skillName: 'Hậu cần vững chắc', style: 'support', skill: 'HEAL', targeting: 'back_allies', healBps: 22000, buff: { damageBps: 1500 }, buffScope: 'back_allies' },
  { id: 'guan-yinping', skillName: 'Nữ tướng phá quân', style: 'attack', skill: 'STUN', targeting: 'single', damageBps: 25000, stun: 'single', stunPerLevelBps: 400 },
  { id: 'mi-zhen', skillName: 'Tương trợ', style: 'support', skill: 'HEAL', targeting: 'all_allies', healBps: 10000, buff: { hpBps: 1000 }, buffScope: 'all_allies' },
  { id: 'zhuge-guo', skillName: 'Tiên thuật', style: 'support', skill: 'HEAL', targeting: 'front_allies', healBps: 22000, buff: { takenDownBps: 1500 }, buffScope: 'front_allies' },
  { id: 'bao-sanniang', skillName: 'Hoa vũ song đao', style: 'attack', skill: 'ATTACK', targeting: 'lane', damageBps: 20000, buff: { critBps: 2000, critDamageBps: 2000 }, buffScope: 'self' },
  { id: 'wu-yi', skillName: 'Trấn thủ Ích Châu', style: 'defense', skill: 'BUFF', targeting: 'all_allies', buff: { takenDownBps: 2000 }, buffScope: 'self', selfHealBps: 1500, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
];

// ----- Phe Ngô: tấn công theo hàng, thiêu đốt, phòng thủ phản đòn -----

const WU_PVP: RosterPvpRow[] = [
  { id: 'sun-jian', skillName: 'Giang Đông mãnh hổ', style: 'attack', skill: 'DEBUFF', targeting: 'lane', damageBps: 20000, debuff: { damageDownBps: 1500 }, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'sun-ce', skillName: 'Tiểu Bá Vương', style: 'attack', skill: 'BUFF', targeting: 'single', damageBps: 28500, buff: { damageBps: 2000 }, buffScope: 'self', selfHealBps: 1500, lifestealPerLevelBps: PVP_LIFESTEAL_MID_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'sun-quan', skillName: 'Đế nghiệp Giang Đông', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { damageBps: 1500, takenDownBps: 1000 }, buffScope: 'all_allies' },
  { id: 'zhou-yu', skillName: 'Hỏa thiêu Xích Bích', style: 'support', skill: 'BURN', targeting: 'all_enemies', damageBps: 9000, debuff: { burnBps: PVP_BURN_BPS, burnRounds: PVP_BURN_ROUNDS_LONG, burnMaxLayers: PVP_BURN_MAX_LAYERS_LONG } },
  { id: 'lu-xun', skillName: 'Hỏa kế liên doanh', style: 'support', skill: 'BURN', targeting: 'lane', damageBps: 18000, debuff: { burnBps: PVP_BURN_BPS, burnRounds: PVP_BURN_ROUNDS_LONG, burnMaxLayers: PVP_BURN_MAX_LAYERS_LONG } },
  { id: 'lu-meng', skillName: 'Bạch y độ giang', style: 'attack', skill: 'DISPEL', targeting: 'single', damageBps: 29000, dispel: true },
  { id: 'huang-gai', skillName: 'Khổ nhục kế', style: 'defense', skill: 'BURN', targeting: 'all_allies', buff: { damageBps: 3000 }, buffScope: 'self', selfHealBps: 2000, lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_ALL_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'all' }, selfBurn: true, selfBurnRounds: PVP_BURN_ROUNDS_LONG },
  { id: 'cheng-pu', skillName: 'Lão tướng trấn quân', style: 'defense', skill: 'BUFF', targeting: 'all_allies', buff: { takenDownBps: 2000 }, buffScope: 'self', selfHealBps: 1500, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'han-dang', skillName: 'Cung kỵ hợp kích', style: 'attack', skill: 'ATTACK', targeting: 'back_row', damageBps: 20000, buff: { critBps: 2000, critDamageBps: 2000 }, buffScope: 'self' },
  { id: 'taishi-ci', skillName: 'Thần xạ', style: 'attack', skill: 'ATTACK', targeting: 'back_single', damageBps: 30000, buff: { critBps: 2500 }, buffScope: 'self' },
  { id: 'gan-ning', skillName: 'Cẩm Phàm tập kích', style: 'attack', skill: 'BUFF', targeting: 'back_row', damageBps: 22000, buff: { damageBps: 2000 }, buffScope: 'self', lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'ling-tong', skillName: 'Liên kích', style: 'attack', skill: 'BUFF', targeting: 'lane', damageBps: 20000, buff: { damageBps: 1500 }, buffScope: 'self' },
  { id: 'zhou-tai', skillName: 'Hộ chủ bất khuất', style: 'defense', skill: 'BUFF', targeting: 'all_allies', buff: { hpBps: 2000 }, buffScope: 'self', selfHealBps: 2000, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'xu-sheng', skillName: 'Giang phòng thiết thủ', style: 'defense', skill: 'BUFF', targeting: 'all_allies', buff: { takenDownBps: 2500 }, buffScope: 'self', selfHealBps: 1000, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'ding-feng', skillName: 'Tuyết trung đột kích', style: 'attack', skill: 'STUN', targeting: 'single', damageBps: 27000, stun: 'single', stunPerLevelBps: 400 },
  { id: 'zhu-huan', skillName: 'Hỏa công phá trận', style: 'attack', skill: 'BURN', targeting: 'lane', damageBps: 18000, debuff: { burnBps: PVP_BURN_BPS, burnRounds: PVP_BURN_ROUNDS } },
  { id: 'zhang-zhao', skillName: 'Ổn định triều chính', style: 'support', skill: 'HEAL', targeting: 'all_allies', healBps: 8000, buff: { takenDownBps: 1500 }, buffScope: 'all_allies' },
  { id: 'zhang-hong', skillName: 'Hoành sách', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { damageBps: 1000, critBps: 1000 }, buffScope: 'all_allies' },
  { id: 'lu-su', skillName: 'Liên minh Tôn Lưu', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { damageBps: 1500, hpBps: 1000 }, buffScope: 'all_allies' },
  { id: 'sun-shangxiang', skillName: 'Kiêu cơ cung vũ', style: 'attack', skill: 'ATTACK', targeting: 'back_row', damageBps: 20000, buff: { critBps: 2000 }, buffScope: 'self' },
  { id: 'da-qiao', skillName: 'Quốc sắc', style: 'support', skill: 'PURIFY', targeting: 'all_allies', healBps: 11000, purify: true },
  { id: 'xiao-qiao', skillName: 'Thiên hương', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { critBps: 1500, damageBps: 1000 }, buffScope: 'all_allies' },
  { id: 'bu-lianshi', skillName: 'Hiền hậu hộ quân', style: 'support', skill: 'HEAL', targeting: 'lowest_ally', healBps: 33000, buff: { takenDownBps: 2000 }, buffScope: 'lowest_ally' },
  { id: 'sun-luyu', skillName: 'Hòa giải', style: 'support', skill: 'CLEANSE', targeting: 'all_allies', healBps: 6000, cleanse: true },
  { id: 'sun-luban', skillName: 'An định Giang Đông', style: 'support', skill: 'DEBUFF', targeting: 'all_enemies', debuff: { hpDownBps: 1000 } },
];

// ----- Phe Quần Hùng: hỗ trợ, tăng trần HP, phản kích tự vệ, thanh tẩy -----

const QUN_PVP: RosterPvpRow[] = [
  { id: 'dong-zhuo', skillName: 'Bạo chúa', style: 'defense', skill: 'DEBUFF', targeting: 'all_enemies', debuff: { hpDownBps: 1000 }, selfHealBps: 2000, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_ALL_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'all' } },
  { id: 'lu-bu', skillName: 'Vô song', style: 'attack', skill: 'STUN', targeting: 'all_enemies', damageBps: 9000, stun: 'row', stunPerLevelBps: 200, buff: { critBps: 2000, critDamageBps: 2000 }, buffScope: 'self', lifestealPerLevelBps: PVP_LIFESTEAL_HIGH_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_ALL_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'all' } },
  { id: 'diao-chan', skillName: 'Bế nguyệt', style: 'support', skill: 'STUN', targeting: 'single', damageBps: 11000, stun: 'single', stunPerLevelBps: 800, debuff: { damageDownBps: 2000 } },
  { id: 'yuan-shao', skillName: 'Thế gia hào tộc', style: 'support', skill: 'BUFF', targeting: 'all_allies', buff: { hpBps: 1500, damageBps: 1000 }, buffScope: 'all_allies' },
  { id: 'yuan-shu', skillName: 'Trọng thị đế nghiệp', style: 'support', skill: 'DEBUFF', targeting: 'front_enemies', debuff: { hpDownBps: 1500 } },
  { id: 'gongsun-zan', skillName: 'Bạch mã nghĩa tùng', style: 'attack', skill: 'ATTACK', targeting: 'back_row', damageBps: 22000, buff: { critBps: 2000 }, buffScope: 'self', counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'zhang-jiao', skillName: 'Thái Bình đạo', style: 'support', skill: 'STUN', targeting: 'all_enemies', damageBps: 8500, stun: 'row', stunPerLevelBps: 200, debuff: { burnBps: PVP_BURN_BPS, burnRounds: PVP_BURN_ROUNDS } },
  { id: 'zhang-bao', skillName: 'Địa công tướng quân', style: 'support', skill: 'DEBUFF', targeting: 'lane', damageBps: 13000, debuff: { critDownBps: 1500, critDamageDownBps: 2000 } },
  { id: 'zhang-liang', skillName: 'Nhân công tướng quân', style: 'support', skill: 'DEBUFF', targeting: 'row', damageBps: 13000, debuff: { damageDownBps: 1500 } },
  { id: 'hua-xiong', skillName: 'Uy chấn Hổ Lao', style: 'attack', skill: 'BUFF', targeting: 'single', damageBps: 29500, buff: { damageBps: 2500 }, buffScope: 'self', lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'gao-shun', skillName: 'Hãm Trận Doanh', style: 'defense', skill: 'BUFF', targeting: 'all_allies', buff: { takenDownBps: 2500, hpBps: 1500 }, buffScope: 'self', counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_ALL_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'all' } },
  { id: 'chen-gong', skillName: 'Mưu định', style: 'support', skill: 'DISPEL', targeting: 'all_allies', dispel: true, buff: { damageBps: 1000, critBps: 1000 }, buffScope: 'all_allies' },
  { id: 'yan-liang', skillName: 'Danh tướng Hà Bắc', style: 'attack', skill: 'ATTACK', targeting: 'single', damageBps: 30500, lifestealPerLevelBps: PVP_LIFESTEAL_BPS_PER_LEVEL, buff: { critBps: 2000, critDamageBps: 2500 }, buffScope: 'self', counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'wen-chou', skillName: 'Mãnh tướng Hà Bắc', style: 'attack', skill: 'BUFF', targeting: 'lane', damageBps: 22000, buff: { damageBps: 2000 }, buffScope: 'self', counter: { perLevelBps: PVP_COUNTER_BPS_PER_LEVEL, damageBps: PVP_COUNTER_DAMAGE_BPS, rounds: PVP_COUNTER_ROUNDS, scope: 'single' } },
  { id: 'tian-feng', skillName: 'Trực gián', style: 'support', skill: 'DISPEL', targeting: 'lane', damageBps: 12000, dispel: true },
  { id: 'meng-huo', skillName: 'Viễn mưu', style: 'support', skill: 'BUFF', targeting: 'all_enemies', damageBps: 8000, buff: { hpBps: 2000 }, buffScope: 'self', selfHealBps: 1500 },
  { id: 'ma-teng', skillName: 'Tây Lương thiết kỵ', style: 'attack', skill: 'BUFF', targeting: 'back_row', damageBps: 20000, buff: { damageBps: 1500 }, buffScope: 'self' },
  { id: 'han-sui', skillName: 'Liên hoành', style: 'support', skill: 'PURIFY', targeting: 'all_allies', purify: true, buff: { takenDownBps: 1000 }, buffScope: 'all_allies' },
  { id: 'tao-qian', skillName: 'Nhân nghĩa Từ Châu', style: 'support', skill: 'HEAL', targeting: 'all_allies', healBps: 11000, buff: { hpBps: 1000 }, buffScope: 'all_allies' },
  { id: 'zhang-lu', skillName: 'Ngũ Đấu Mễ Đạo', style: 'support', skill: 'PURIFY', targeting: 'front_allies', healBps: 22000, purify: true },
  { id: 'cai-wenji', skillName: 'Bi ca', style: 'support', skill: 'HEAL', targeting: 'all_allies', healBps: 11000, buff: { damageBps: 1000 }, buffScope: 'all_allies' },
  { id: 'zou-yu', skillName: 'Mị ảnh', style: 'support', skill: 'STUN', targeting: 'single', damageBps: 12000, stun: 'single', stunPerLevelBps: 1000 },
  { id: 'zhurong', skillName: 'Phi đao Nam Man', style: 'attack', skill: 'BURN', targeting: 'lane', damageBps: 18000, debuff: { burnBps: PVP_BURN_BPS, burnRounds: PVP_BURN_ROUNDS } },
  { id: 'dong-bai', skillName: 'Quý tộc tàn bạo', style: 'attack', skill: 'DEBUFF', targeting: 'single', damageBps: 28000, debuff: { hpDownBps: 1500 } },
  { id: 'zhang-chunhua', skillName: 'Lãnh tâm', style: 'support', skill: 'DISPEL', targeting: 'single', damageBps: 14000, dispel: true, debuff: { damageDownBps: 2000 } },
];

/** Toàn bộ bảng phong cách + kỹ năng tường minh của roster (SKILLS.md). */
export const PVP_ROSTER_ROWS: readonly RosterPvpRow[] = [...WEI_PVP, ...SHU_PVP, ...WU_PVP, ...QUN_PVP];

/** Targeting nhắm vào ĐỊCH (cho hiệu ứng bất lợi/thiêu đốt/xóa buff). */
const ENEMY_TARGETINGS: readonly PvpTargeting[] = ['single', 'lane', 'row', 'back_row', 'back_single', 'front_enemies', 'all_enemies'];
/** Targeting nhắm vào ĐỒNG MINH (cho hồi máu/thanh tẩy/buff đồng minh). */
const ALLY_TARGETINGS: readonly PvpTargeting[] = ['all_allies', 'lowest_ally', 'front_allies', 'back_allies'];
export const isEnemyTargeting = (t: PvpTargeting) => ENEMY_TARGETINGS.includes(t);
export const isAllyTargeting = (t: PvpTargeting) => ALLY_TARGETINGS.includes(t);

/** Có ít nhất một hiệu ứng buff dương hay không. */
const hasBuffEffect = (b: PvpBuff) =>
  b.damageBps > 0 || b.hpBps > 0 || b.critBps > 0 || b.critDamageBps > 0 || b.takenDownBps > 0;

/** Kỹ năng có phát buff tăng sức mạnh cho ĐỒNG MINH (không tính tự buff) hay không. */
const buffsAllies = (def: PvpSkillDef) =>
  def.buffScope !== 'none' && def.buffScope !== 'self' && hasBuffEffect(def.buff);

/**
 * Nội tại suy ra từ kỹ năng (SKILLS.md không quy định nội tại riêng): tướng có choáng thiên về choáng,
 * tướng hồi/giải/thanh tẩy thiên về phòng thủ, tướng buff đồng minh thiên về sát thương, còn lại thiên
 * về chí mạng.
 */
function passiveForDef(def: PvpSkillDef): PvpPassive {
  if (def.stun !== 'none') return 'STUN_5';
  if (def.cleanse || def.purify) return 'CLEANSE_10';
  if (def.healBps > 0 || def.selfHealBps > 0) return 'HP_10';
  if (buffsAllies(def)) return 'DAMAGE_10';
  return 'CRIT_5';
}

export interface PvpProfile {
  style: PvpStyle;
  skill: PvpSkill;
  /** Tên kỹ năng hiển thị (nguyên văn SKILLS.md) — dùng cho nhãn "bay lên" khi tướng ra đòn. */
  skillName: string;
  passive: PvpPassive;
  /** Tướng hot (hệ số kỹ năng trong bảng đã cộng sẵn +10%). */
  hot: boolean;
  /** Hút máu: hồi bản thân theo `cấp × hệ số` sát thương gây ra (bps mỗi cấp; 0 = không hút máu). */
  lifestealPerLevelBps: number;
  /** Định nghĩa kỹ năng tường minh (hệ số sát thương/hồi máu là giá trị chốt, đã gồm hot). */
  def: PvpSkillDef;
}

function buildProfile(row: RosterPvpRow): PvpProfile {
  const buff: PvpBuff = { ...PVP_NO_BUFF, ...row.buff };
  const debuff: PvpDebuff = { ...PVP_NO_DEBUFF, ...row.debuff };
  const def: PvpSkillDef = {
    targeting: row.targeting,
    damageBps: row.damageBps ?? 0,
    healBps: row.healBps ?? 0,
    selfHealBps: row.selfHealBps ?? 0,
    stun: row.stun ?? 'none',
    stunPerLevelBps: row.stunPerLevelBps ?? 0,
    cleanse: row.cleanse ?? false,
    purify: row.purify ?? false,
    dispel: row.dispel ?? false,
    dispelChanceBps: row.dispel ? (row.dispelChanceBps ?? BPS_SCALE) : 0,
    buff,
    buffScope: hasBuffEffect(buff) ? (row.buffScope ?? 'all_allies') : 'none',
    debuff,
    counter: row.counter ? { ...PVP_NO_COUNTER, ...row.counter } : PVP_NO_COUNTER,
    selfBurn: row.selfBurn ?? false,
    selfBurnRounds: row.selfBurn ? (row.selfBurnRounds ?? PVP_BURN_ROUNDS) : 0,
  };
  return {
    style: row.style,
    skill: row.skill,
    skillName: row.skillName,
    passive: passiveForDef(def),
    hot: HOT_GENERALS.has(row.id),
    lifestealPerLevelBps: row.lifestealPerLevelBps ?? 0,
    def,
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
    assert(PVP_SKILL_DEF[id], `Thiếu định nghĩa nhóm kỹ năng ${id}`);
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
    const def = PROFILES.get(row.id)!.def;
    assert(row.skillName.trim().length > 0, `Tướng ${row.id} thiếu tên kỹ năng`);
    assert(!skillNames.has(row.skillName), `Tên kỹ năng bị trùng: ${row.skillName}`);
    skillNames.add(row.skillName);
    // Hiệu ứng bất lợi (suy yếu/giảm HP/giảm chí mạng/thiêu đốt) phải nhắm vào ĐỊCH.
    const db = def.debuff;
    const hasDebuffEffect =
      db.damageDownBps > 0 || db.hpDownBps > 0 || db.critDownBps > 0 || db.critDamageDownBps > 0 || db.burnBps > 0;
    if (hasDebuffEffect) assert(isEnemyTargeting(def.targeting), `Tướng ${row.id}: hiệu ứng bất lợi phải nhắm vào địch`);
    // Xóa hiệu ứng có lợi (dispel) cũng nhắm vào địch (trừ tướng vừa buff đồng minh vừa dispel: dùng toàn bộ địch).
    if (def.dispel) assert(!isAllyTargeting(def.targeting) || def.buffScope !== 'none', `Tướng ${row.id}: dispel cần nhắm địch`);
    // Thanh tẩy phải nhắm vào ĐỒNG MINH.
    if (def.purify) assert(isAllyTargeting(def.targeting), `Tướng ${row.id}: thanh tẩy phải nhắm vào đồng minh`);
    // Choáng phải có tỉ lệ theo cấp.
    if (def.stun !== 'none') assert(def.stunPerLevelBps > 0, `Tướng ${row.id}: choáng phải có stunPerLevelBps > 0`);
    // Buff phải có hiệu ứng tăng sức mạnh khi đã khai phạm vi phát buff.
    if (def.buffScope !== 'none') {
      assert(hasBuffEffect(def.buff), `Tướng ${row.id}: buff phải có hiệu ứng tăng sức mạnh`);
    }
    // Phản kích diện rộng dùng 30% ST cơ bản; đơn mục tiêu dùng 50%.
    if (def.counter.damageBps > 0) assert(def.counter.rounds > 0, `Tướng ${row.id}: phản kích phải có số lượt`);
    // Tự thiêu đốt chỉ dùng cho Hoàng Cái.
    if (def.selfBurn) assert(def.selfBurnRounds > 0, `Tướng ${row.id}: tự thiêu đốt phải có số lượt`);
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