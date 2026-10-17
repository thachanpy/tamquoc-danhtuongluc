import { FACTIONS, MAX_LEVEL, TICKET_TYPES, type TicketType } from '@tq/shared';
import { ROSTER_SIZE, GENERALS_PER_FACTION } from './roster.ts';

/**
 * Nhiệm vụ hằng ngày, thưởng reset và thành tựu (mục 3.10). Chỉ thưởng vé.
 *
 * Ngày game: reset lúc DAILY_RESET_HOUR giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7 cố định, không có giờ mùa hè).
 * Điểm danh theo ngày trong tháng dùng NGÀY DƯƠNG LỊCH Việt Nam (00:00).
 */
export const VN_UTC_OFFSET_MS = 7 * 3_600_000;
export const DAILY_RESET_HOUR = 5;

/** Thưởng reset hằng ngày: cộng khi người chơi vào game lần đầu trong ngày game (không cộng bù ngày vắng mặt). */
export const DAILY_RESET_BONUS: Record<TicketType, number> = { normal: 5, shu: 5, wei: 5, wu: 5, qun: 5 };

/** Chỉ số tính tiến trình nhiệm vụ trong ngày game. */
export type DailyMetric = 'login' | 'draws' | 'upgradeSuccess' | 'cardsReceived' | 'dailyDone';

export interface DailyMissionDef {
  id: string;
  name: string;
  desc: string;
  metric: DailyMetric;
  target: number;
  reward: number;
}

/** Nhiệm vụ chung — thưởng vé thường. */
export const DAILY_MISSIONS: DailyMissionDef[] = [
  { id: 'login', name: 'Đăng nhập mỗi ngày', desc: 'Đăng nhập game', metric: 'login', target: 1, reward: 4 },
  { id: 'draw10', name: 'Chiêu mộ tướng', desc: 'Quay 10 lần bằng bất kỳ loại vé nào', metric: 'draws', target: 10, reward: 6 },
  { id: 'draw30', name: 'Chiêu mộ chăm chỉ', desc: 'Quay 30 lần bằng bất kỳ loại vé nào', metric: 'draws', target: 30, reward: 10 },
  { id: 'up3', name: 'Nâng cấp tướng', desc: 'Nâng cấp thành công 3 lần', metric: 'upgradeSuccess', target: 3, reward: 6 },
  { id: 'up10', name: 'Nâng cấp chuyên cần', desc: 'Nâng cấp thành công 10 lần', metric: 'upgradeSuccess', target: 10, reward: 10 },
  { id: 'cards20', name: 'Thu thập thẻ', desc: 'Nhận 20 thẻ tướng, tính cả thẻ trùng', metric: 'cardsReceived', target: 20, reward: 6 },
  // Đếm số nhiệm vụ CHUNG khác (không tính chính nó, không tính nhiệm vụ phe) đã đạt điều kiện
  { id: 'done5', name: 'Hoàn thành nhiệm vụ', desc: 'Hoàn thành 5 nhiệm vụ hằng ngày khác', metric: 'dailyDone', target: 5, reward: 10 },
];

export type FactionMetric = 'factionDraws' | 'factionCards';

export interface FactionMissionDef {
  id: string;
  name: string;
  /** {f} được thay bằng tên phe khi hiển thị. */
  desc: string;
  metric: FactionMetric;
  target: number;
  reward: number;
}

/** Nhiệm vụ theo phe — áp dụng riêng cho từng phe, thưởng vé đúng phe. */
export const FACTION_MISSIONS: FactionMissionDef[] = [
  { id: 'fdraw5', name: 'Chiêu mộ tướng phe', desc: 'Quay 5 lần bằng Vé {f}', metric: 'factionDraws', target: 5, reward: 4 },
  { id: 'fdraw15', name: 'Chiêu mộ chuyên sâu', desc: 'Quay 15 lần bằng Vé {f}', metric: 'factionDraws', target: 15, reward: 6 },
  { id: 'fcards10', name: 'Thu thập tướng phe', desc: 'Nhận 10 thẻ phe {f}, tính cả thẻ trùng', metric: 'factionCards', target: 10, reward: 4 },
];

/** Mốc thành tựu: [ngưỡng, số vé]. */
export type Milestones = readonly (readonly [number, number])[];

// ======================= Nhiệm vụ đấu trường PvP =======================

/** Chỉ số tính tiến trình nhiệm vụ đấu trường trong ngày game. */
export type PvpMetric = 'pvpBattles' | 'pvpWins';

export interface PvpMissionDef {
  id: string;
  name: string;
  desc: string;
  metric: PvpMetric;
  target: number;
  reward: number;
}

/**
 * Nhiệm vụ đấu trường — thưởng vé thường.
 * Chỉ tính các trận người chơi CHỦ ĐỘNG khiêu chiến (không tính lúc bị người khác khiêu chiến).
 */
export const PVP_DAILY_MISSIONS: PvpMissionDef[] = [
  { id: 'pvp2', name: 'Ra trận', desc: 'Khiêu chiến 2 trận trong ngày', metric: 'pvpBattles', target: 2, reward: 4 },
  { id: 'pvp5', name: 'Giao chiến', desc: 'Khiêu chiến 5 trận trong ngày', metric: 'pvpBattles', target: 5, reward: 8 },
  { id: 'pvp10', name: 'Chinh chiến', desc: 'Khiêu chiến 10 trận trong ngày', metric: 'pvpBattles', target: 10, reward: 14 },
  { id: 'pvp20', name: 'Đại chiến', desc: 'Khiêu chiến 20 trận trong ngày', metric: 'pvpBattles', target: 20, reward: 24 },
  { id: 'pvpwin2', name: 'Thắng lợi', desc: 'Thắng 2 trận đấu trường trong ngày', metric: 'pvpWins', target: 2, reward: 6 },
  { id: 'pvpwin5', name: 'Bách chiến bách thắng', desc: 'Thắng 5 trận đấu trường trong ngày', metric: 'pvpWins', target: 5, reward: 12 },
  { id: 'pvpwin10', name: 'Vô địch đấu trường', desc: 'Thắng 10 trận đấu trường trong ngày', metric: 'pvpWins', target: 10, reward: 20 },
];

// ======================= Nhiệm vụ Ngọc Ngũ Hành =======================

/** Chỉ số tính tiến trình nhiệm vụ Ngọc trong ngày game. */
export type GemMetric = 'gemsReceived' | 'gemMerges' | 'gemMergeSuccess';

export interface GemMissionDef {
  id: string;
  name: string;
  desc: string;
  metric: GemMetric;
  target: number;
  reward: number;
}

/**
 * Nhiệm vụ Ngọc — thưởng vé thường. Ngọc chỉ đến từ 2 nguồn: rớt kèm khi chiêu mộ và tạo ra khi ghép
 * ("nhận Ngọc" chỉ tính nguồn rớt kèm; Ngọc tạo ra khi ghép vẫn cộng vào thành tựu sở hữu).
 */
export const GEM_DAILY_MISSIONS: GemMissionDef[] = [
  { id: 'gem3', name: 'Thu nhận Ngọc', desc: 'Nhận 3 viên Ngọc rớt kèm khi chiêu mộ', metric: 'gemsReceived', target: 3, reward: 6 },
  { id: 'gem10', name: 'Tích lũy Ngọc', desc: 'Nhận 10 viên Ngọc rớt kèm khi chiêu mộ', metric: 'gemsReceived', target: 10, reward: 12 },
  { id: 'gemmerge3', name: 'Ghép Ngọc', desc: 'Ghép Ngọc 3 lần (tính cả lần thất bại)', metric: 'gemMerges', target: 3, reward: 6 },
  { id: 'gemmerge10', name: 'Luyện Ngọc chuyên cần', desc: 'Ghép Ngọc 10 lần (tính cả lần thất bại)', metric: 'gemMerges', target: 10, reward: 12 },
  { id: 'gemsucc2', name: 'Ngọc kết tinh', desc: 'Ghép Ngọc thành công 2 lần', metric: 'gemMergeSuccess', target: 2, reward: 8 },
  { id: 'gemsucc5', name: 'Tay nghề luyện Ngọc', desc: 'Ghép Ngọc thành công 5 lần', metric: 'gemMergeSuccess', target: 5, reward: 16 },
];

/** Tổng số Ngọc đã NHẬN từ chiêu mộ (rớt kèm, toàn bộ lịch sử; không tính Ngọc tạo ra khi ghép) — vé thường. */
export const ACH_GEMS_RECEIVED: Milestones = [[5, 10], [25, 30], [100, 80], [500, 200], [2_000, 600], [10_000, 2_000]];
/** Tổng số lần ghép Ngọc (mọi kết quả, toàn bộ lịch sử) — vé thường. */
export const ACH_GEM_MERGES: Milestones = [[5, 10], [25, 30], [100, 60], [500, 150], [2_000, 400]];
/** Tổng số lần ghép Ngọc THÀNH CÔNG (toàn bộ lịch sử) — vé thường. */
export const ACH_GEM_MERGE_SUCCESS: Milestones = [[3, 10], [15, 25], [50, 50], [250, 120], [1_000, 300]];
/** Cấp cao nhất đạt được của MỘT loại Ngọc (xét kho Ngọc đang sở hữu) — vé thường. */
export const ACH_GEM_ELEMENT_LEVEL: Milestones = [[2, 5], [3, 10], [5, 20], [7, 40], [9, 80], [10, 150]];
/** Số viên Ngọc đang sở hữu (mọi loại, mọi cấp; tính cả Ngọc tạo ra khi ghép) — vé thường. */
export const ACH_GEM_OWN: Milestones = [[1, 5], [5, 15], [10, 25], [25, 50], [50, 100], [100, 200], [250, 400]];

/**
 * Số viên Ngọc đang sở hữu theo cấp: mỗi cấp 1–10 có `ACH_GEM_OWN_MAX` mốc (1…10 viên active cùng cấp).
 * Dùng CHUNG bảng thưởng `ownLevelReward` với thành tựu "Sở hữu thẻ cấp" (chỉ khác số mốc).
 */
export const ACH_GEM_OWN_MAX = 10;

/** Tổng số trận đã chủ động khiêu chiến (toàn bộ lịch sử) — vé thường. */
export const ACH_PVP_BATTLES: Milestones = [[10, 10], [50, 30], [100, 50], [500, 150], [1_000, 250], [5_000, 800]];
/** Tổng số trận đấu trường đã thắng khi chủ động khiêu chiến (toàn bộ lịch sử) — vé thường. */
export const ACH_PVP_WINS: Milestones = [[5, 10], [25, 30], [50, 60], [200, 150], [500, 300], [2_000, 800]];

/** Tổng số lần chiêu mộ (mọi loại vé, toàn bộ lịch sử) — vé thường. */
export const ACH_DRAWS: Milestones = [
  [10, 10], [50, 20], [100, 40], [500, 100], [1_000, 200], [5_000, 500], [10_000, 1_000], [50_000, 2_000],
];
/** Số tướng khác nhau đã thu thập (trên 100) — vé thường. */
export const ACH_COLLECT: Milestones = [[10, 20], [25, 50], [50, 100], [100, 250]];
/** Số tướng khác nhau đã thu thập trong mỗi phe (trên 25) — vé đúng phe. */
export const ACH_FACTION_COLLECT: Milestones = [[5, 5], [10, 10], [15, 20], [25, 50]];
/** Tổng số thẻ đã nhận (quay + giftcode thẻ cũ; không tính thẻ tạo ra khi ghép, không tính thẻ được tặng) — vé thường. */
export const ACH_CARDS_RECEIVED: Milestones = [[10, 5], [100, 15], [500, 40], [1_000, 100], [5_000, 250], [10_000, 500]];

/** Sở hữu thẻ cấp 1–10: mỗi cấp 25 mốc (sở hữu 1…25 thẻ đang active cùng cấp); thưởng vé thường theo khoảng. */
export const ACH_OWN_MAX = 25;
const OWN_BRACKETS: { from: number; rewards: number[] }[] = [
  //            Cấp:  1   2   3   4   5   6   7   8   9  10
  { from: 1, rewards: [3, 4, 5, 6, 8, 10, 12, 15, 18, 20] },
  { from: 5, rewards: [5, 6, 8, 10, 12, 15, 18, 20, 25, 30] },
  { from: 10, rewards: [8, 10, 12, 15, 18, 20, 25, 30, 35, 40] },
  { from: 15, rewards: [10, 12, 15, 18, 20, 25, 30, 35, 40, 50] },
  { from: 20, rewards: [12, 15, 18, 20, 25, 30, 35, 40, 50, 60] },
  { from: 25, rewards: [15, 18, 20, 25, 30, 35, 40, 50, 60, 80] },
];
/** Số vé thường của mốc "sở hữu `count` thẻ cấp `level`". */
export function ownLevelReward(level: number, count: number): number {
  let r = 0;
  for (const b of OWN_BRACKETS) if (count >= b.from) r = b.rewards[level - 1]!;
  return r;
}

/** Điểm danh theo ngày dương lịch trong tháng: ngày d nhận 9 + d vé thường (ngày 1 = 10 … ngày 31 = 40). */
export const loginDayReward = (dayOfMonth: number) => 9 + dayOfMonth;

/** Kiểm tra cấu hình nhiệm vụ/thành tựu (gọi trong validateGameConfig). */
export function validateQuestConfig(assert: (cond: unknown, msg: string) => void): void {
  assert(Number.isInteger(DAILY_RESET_HOUR) && DAILY_RESET_HOUR >= 0 && DAILY_RESET_HOUR <= 23, 'DAILY_RESET_HOUR phải 0–23');
  for (const t of TICKET_TYPES) {
    const n = DAILY_RESET_BONUS[t];
    assert(Number.isSafeInteger(n) && n >= 0, `DAILY_RESET_BONUS.${t} không hợp lệ`);
  }
  const ids = new Set<string>();
  for (const m of [...DAILY_MISSIONS, ...FACTION_MISSIONS, ...PVP_DAILY_MISSIONS, ...GEM_DAILY_MISSIONS]) {
    assert(!ids.has(m.id) && /^[a-z0-9]+$/.test(m.id), `id nhiệm vụ trùng/không hợp lệ: ${m.id}`);
    ids.add(m.id);
    assert(Number.isSafeInteger(m.target) && m.target >= 1, `target nhiệm vụ ${m.id} không hợp lệ`);
    assert(Number.isSafeInteger(m.reward) && m.reward >= 1, `thưởng nhiệm vụ ${m.id} không hợp lệ`);
  }
  const others = DAILY_MISSIONS.filter((m) => m.metric !== 'dailyDone').length;
  for (const m of DAILY_MISSIONS.filter((x) => x.metric === 'dailyDone')) {
    assert(m.target <= others, `nhiệm vụ ${m.id} cần nhiều hơn số nhiệm vụ chung khác`);
  }
  const checkMs = (name: string, ms: Milestones, max: number) => {
    let prev = 0;
    for (const [n, r] of ms) {
      assert(Number.isSafeInteger(n) && n > prev && n <= max, `${name}: ngưỡng ${n} không hợp lệ`);
      assert(Number.isSafeInteger(r) && r >= 1, `${name}: thưởng không hợp lệ`);
      prev = n;
    }
  };
  checkMs('ACH_DRAWS', ACH_DRAWS, Number.MAX_SAFE_INTEGER);
  checkMs('ACH_COLLECT', ACH_COLLECT, ROSTER_SIZE);
  checkMs('ACH_FACTION_COLLECT', ACH_FACTION_COLLECT, GENERALS_PER_FACTION);
  checkMs('ACH_CARDS_RECEIVED', ACH_CARDS_RECEIVED, Number.MAX_SAFE_INTEGER);
  checkMs('ACH_GEMS_RECEIVED', ACH_GEMS_RECEIVED, Number.MAX_SAFE_INTEGER);
  checkMs('ACH_GEM_MERGES', ACH_GEM_MERGES, Number.MAX_SAFE_INTEGER);
  checkMs('ACH_GEM_MERGE_SUCCESS', ACH_GEM_MERGE_SUCCESS, Number.MAX_SAFE_INTEGER);
  checkMs('ACH_GEM_ELEMENT_LEVEL', ACH_GEM_ELEMENT_LEVEL, MAX_LEVEL);
  checkMs('ACH_GEM_OWN', ACH_GEM_OWN, Number.MAX_SAFE_INTEGER);
  checkMs('ACH_PVP_BATTLES', ACH_PVP_BATTLES, Number.MAX_SAFE_INTEGER);
  checkMs('ACH_PVP_WINS', ACH_PVP_WINS, Number.MAX_SAFE_INTEGER);
  for (let lv = 1; lv <= MAX_LEVEL; lv++) {
    for (let n = 1; n <= ACH_OWN_MAX; n++) assert(ownLevelReward(lv, n) >= 1, `ownLevelReward(${lv}, ${n}) không hợp lệ`);
    for (let n = 1; n <= ACH_GEM_OWN_MAX; n++) assert(ownLevelReward(lv, n) >= 1, `ownLevelReward Ngọc (${lv}, ${n}) không hợp lệ`);
  }
  assert(FACTIONS.length === 4, 'cần đúng 4 phe');
}

/** Tổng thưởng tối đa mỗi ngày (để test/hiển thị). */
export const DAILY_MAX = {
  general: DAILY_MISSIONS.reduce((s, m) => s + m.reward, 0),
  perFaction: FACTION_MISSIONS.reduce((s, m) => s + m.reward, 0),
  pvp: PVP_DAILY_MISSIONS.reduce((s, m) => s + m.reward, 0),
  gem: GEM_DAILY_MISSIONS.reduce((s, m) => s + m.reward, 0),
};
