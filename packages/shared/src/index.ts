// ===== Enums (dùng const object + union type, không dùng TS enum) =====

export const FACTIONS = ['wei', 'shu', 'wu', 'qun'] as const;
export type Faction = (typeof FACTIONS)[number];

/** Loại vé quay thẻ: vé thường (mọi phe) rồi tới 4 vé phe, xếp theo thứ tự hiển thị
 *  Thường → Ngụy → Thục → Ngô → Quần (trùng thứ tự `FACTIONS`) — dùng luôn cho mọi UI liệt kê vé. */
export const TICKET_TYPES = ['normal', 'wei', 'shu', 'wu', 'qun'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** Ngũ hành của Ngọc: Kim / Mộc / Thủy / Hỏa / Thổ. */
export const GEM_ELEMENTS = ['kim', 'moc', 'thuy', 'hoa', 'tho'] as const;
export type GemElement = (typeof GEM_ELEMENTS)[number];

export const GEM_ELEMENT_LABELS: Record<GemElement, string> = {
  kim: 'Kim',
  moc: 'Mộc',
  thuy: 'Thủy',
  hoa: 'Hỏa',
  tho: 'Thổ',
};

/**
 * Chỉ số Ngọc Ngũ Hành cộng cho TOÀN ĐỘI khi vào trận (Chỉ số Nền Ra Trận — aura gốc, không thể bị Xóa Buff).
 * Đơn vị bps: 10000 = 100%. Mỗi loại Ngọc chỉ dùng ĐÚNG 2 trường (xem `GemConfigDto.table`).
 */
export interface PvpGemStats {
  damageBps: number;
  takenDownBps: number;
  hpBps: number;
  lifestealBps: number;
  hitBps: number;
  dodgeBps: number;
  critBps: number;
  critDamageBps: number;
  defArmor: number;
  defPenBps: number;
}

/** Nhãn tiếng Việt của từng chỉ số Ngọc (UI dựng bảng chỉ số). */
export const GEM_STAT_LABELS: Record<keyof PvpGemStats, string> = {
  damageBps: 'Sát thương',
  takenDownBps: 'Giảm sát thương',
  hpBps: 'HP tối đa',
  lifestealBps: 'Hút máu',
  hitBps: 'Chính xác',
  dodgeBps: 'Né tránh',
  critBps: 'Chí mạng',
  critDamageBps: 'ST chí mạng',
  defArmor: 'Phòng thủ',
  defPenBps: 'Xuyên giáp',
};

/** Danh sách khóa chỉ số Ngọc hợp lệ (dùng cho schema + dropdown Admin). */
export const PVP_GEM_STAT_KEYS = [
  'damageBps',
  'takenDownBps',
  'hpBps',
  'lifestealBps',
  'hitBps',
  'dodgeBps',
  'critBps',
  'critDamageBps',
  'defArmor',
  'defPenBps',
] as const;

/** Một viên Ngọc Ngũ Hành người chơi đang sở hữu (vật phẩm rời theo loại + cấp). */
export interface GemDto {
  id: number;
  element: GemElement;
  level: number;
  createdAt: string;
}

/** Một loại Ngọc gắn vào đội hình, kèm cấp cao nhất đang sở hữu của loại đó. */
export interface PvpTeamGemDto {
  element: GemElement;
  level: number;
}

/** Cấu hình công khai của hệ thống Ngọc: bảng chỉ số + tỷ lệ ghép/rớt. */
export interface GemConfigDto {
  bpsScale: number;
  /** Số Ngọc tối đa một đội hình được gắn (không trùng loại). */
  teamGemCount: number;
  /** Tỉ lệ rớt Ngọc đính kèm mỗi Tướng quay ra (bps). */
  dropBps: number;
  /** Trọng số chọn hệ Ngọc khi trúng rớt (bps) — tổng bằng `bpsScale`. */
  typeWeights: Record<GemElement, number>;
  /** Loại Ngọc theo thứ tự hiển thị. */
  elements: GemElement[];
  /** Bảng chỉ số: loại → 10 cấp (index 0 = cấp 1); mỗi cấp chỉ 2 chỉ số khác 0. */
  table: Record<GemElement, PvpGemStats[]>;
  /** Tỷ lệ ghép theo level đầu vào — dùng chung công thức với thẻ Tướng. */
  rates: { level: number; successBps: number; failureDistribution: WeightEntry[] }[];
}

/** Tổng quan Ngọc của người chơi (tab Ngọc ở Nâng cấp & Bộ sưu tập). */
export interface GemsDto {
  config: GemConfigDto;
  /** Mọi viên Ngọc đang sở hữu (chưa tiêu hao), mới nhất trước. */
  gems: GemDto[];
  total: number;
}

/** Kết quả một lần ghép 2 viên Ngọc cùng loại & cùng cấp. */
export interface GemMergeResultDto {
  mergeId: number;
  outcome: UpgradeOutcome;
  element: GemElement;
  inputLevel: number;
  inputGemIds: number[];
  resultGem: GemDto;
  successBps: number;
  failureBps: number;
  failureDistribution: WeightEntry[];
}

/** Kết quả Ghép nhanh Ngọc: danh sách các lần ghép theo thứ tự thực hiện. */
export interface QuickGemMergeResultDto {
  /** Các level đầu vào (đã sắp tăng dần) người chơi chọn cho lần ghép nhanh này. */
  levels: number[];
  merges: number;
  successes: number;
  failures: number;
  /** Chạm trần số lần ghép mỗi lần bấm nhưng vẫn còn cặp ghép được. */
  hasMore: boolean;
  results: {
    mergeId: number;
    element: GemElement;
    inputLevel: number;
    resultLevel: number;
    resultGemId: number;
    outcome: UpgradeOutcome;
  }[];
}

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;

/** Số tướng tối đa mỗi đội PvP (PVP.md mục 2.1). */
export const PVP_TEAM_SIZE = 6;

/** Số Ngọc Ngũ Hành tối đa gắn cho một đội hình PvP (không trùng loại). */
export const PVP_TEAM_GEM_COUNT = 3;

export const FACTION_LABELS: Record<Faction, string> = {
  wei: 'Ngụy',
  shu: 'Thục',
  wu: 'Ngô',
  qun: 'Quần',
};

export const TICKET_LABELS: Record<TicketType, string> = {
  normal: 'Vé Thường',
  shu: 'Vé Thục',
  wei: 'Vé Ngụy',
  wu: 'Vé Ngô',
  qun: 'Vé Quần',
};

export const TICKET_REASONS = [
  'time_recovery',
  'signup_bonus',
  'dev_topup',
  'admin_grant',
  'giftcode',
  'gacha_draw',
  'daily_reset',
  'mission',
  'achievement',
] as const;
export type TicketReason = (typeof TICKET_REASONS)[number];

export type UpgradeOutcome = 'success' | 'failure';

// ===== DTO =====

export interface GeneralDto {
  id: string;
  name: string;
  faction: Faction;
  artKey: string;
}

export interface CardDto {
  id: number;
  generalId: string;
  level: number;
  createdAt: string;
}

export type TicketBalances = Record<TicketType, number>;

export interface TicketsDto {
  balances: TicketBalances;
  total: number;
  lastProcessedRecoveryAt: string;
  nextRecoveryAt: string;
  serverNow: string;
  msUntilNextRecovery: number;
  /** Trần vé hồi theo thời gian theo từng loại (VD thường 1000, phe 500); vé từ nguồn khác vẫn có thể vượt. */
  recoveryCap: TicketBalances;
}

export interface ClaimRecoveryDto extends TicketsDto {
  granted: TicketBalances;
  grantedTotal: number;
  /** Số mốc hồi bị bỏ vì cả 5 loại vé đã đạt trần. */
  skippedFull: number;
  dailyEvents?: DailyEventsDto;
}

// ===== Hồ sơ người chơi (mục 3.11) =====

export const DISPLAY_NAME_MAX = 36;

/** Giới hạn độ dài chuỗi ảnh đại diện lưu ở server (data URL ảnh đã thu nhỏ, hoặc đường dẫn chân dung tướng). */
export const AVATAR_MAX_LENGTH = 200_000;

/** Hồ sơ người chơi: tên hiển thị + ảnh đại diện. */
export interface ProfileDto {
  /** Tên hiển thị; mặc định bằng tên đăng nhập. */
  displayName: string;
  /**
   * Ảnh đại diện: data URL ảnh tự tải (client đã thu nhỏ) hoặc đường dẫn chân dung tướng
   * `/generals/{artKey}.webp`; null = dùng ảnh mặc định (chữ cái đầu của tên hiển thị).
   */
  avatar: string | null;
}

export interface MeDto extends ProfileDto {
  id: number;
  username: string;
  /** Quản trị viên: thấy tab Quản trị. */
  isAdmin: boolean;
  tickets: TicketsDto;
  /** Tính năng bật/tắt theo cấu hình server. */
  features: { devTopup: boolean; devTopupAmount: number; gift: boolean };
  /** Sự kiện ngày mới vừa xử lý trong request này (thưởng reset 05:00, nhiệm vụ ngày cũ tự nhận). */
  dailyEvents?: DailyEventsDto;
}

/** Kết quả bấm nút cộng vé thử nghiệm. */
export interface DevTopupDto {
  granted: TicketBalances;
  grantedTotal: number;
  tickets: TicketsDto;
}

/** Tỷ lệ dạng basis points: 10000 = 100% */
export interface WeightEntry {
  level: number;
  bps: number;
}

export interface GachaConfigDto {
  ticketTypes: { id: TicketType; label: string; pool: string[] }[];
  levelRates: WeightEntry[];
  /** Đơn vị của `levelRates` (100000 = 100%) — chi tiết hơn `bpsScale` để biểu diễn Lv9 = 0.005%. */
  levelScale: number;
  bpsScale: number;
  /** Các lựa chọn số lần quay mỗi request, VD [1, 10]. */
  drawCountOptions: number[];
  /** Nút "Mở tất cả": số lượt tối đa mỗi lần bấm (gửi count = drawAllMax). */
  drawAllMax: number;
  /** Số thẻ cùng tướng, cùng level cần cho mỗi lần ghép (hiện là 2). */
  upgradeInputCount: number;
  /** Số thẻ tối đa mỗi lần tặng. */
  giftMaxCards: number;
  /** Tổng số vé tối đa của một giftcode. */
  giftCodeMaxTickets: number;
  /** Nâng cấp nhanh áp dụng cho thẻ có level ≤ mức này. */
  quickUpgradeMaxLevel: number;
  /** Tỷ lệ ghép công khai theo level đầu vào (để UI hiển thị trước khi xác nhận). */
  upgradeRates: { level: number; successBps: number; failureDistribution: WeightEntry[] }[];
}

export interface DrawnCardDto {
  drawId: number;
  card: CardDto;
  general: GeneralDto;
  /** Ngọc Ngũ Hành rớt đính kèm (tỉ lệ + trọng số hệ do Admin cấu hình, cùng cấp với Tướng); null = lượt này không rớt Ngọc. */
  gem: GemDto | null;
}

/**
 * Kết quả quay. requested = số lần người chơi chọn (1 hoặc 10);
 * drawn = số lần thực sự quay = min(requested, số vé loại đó đang có).
 */
export interface DrawResultDto {
  ticketType: TicketType;
  requested: number;
  drawn: number;
  results: DrawnCardDto[];
  tickets: TicketsDto;
}

export interface UpgradePreviewDto {
  generalId: string;
  inputLevel: number;
  successLevel: number;
  successBps: number;
  failureBps: number;
  failureDistribution: WeightEntry[];
  bpsScale: number;
}

export interface UpgradeResultDto {
  upgradeId: number;
  outcome: UpgradeOutcome;
  inputCardIds: number[];
  inputLevel: number;
  resultCard: CardDto;
  successBps: number;
  failureBps: number;
  failureDistribution: WeightEntry[];
}

/** Kết quả Nâng cấp nhanh: danh sách các lần ghép theo thứ tự thực hiện. */
export interface QuickUpgradeResultDto {
  /** Các level đầu vào (đã sắp tăng dần) được người chơi chọn cho lần ghép nhanh này. */
  levels: number[];
  merges: number;
  successes: number;
  failures: number;
  /** Chạm trần số lần ghép mỗi lần bấm nhưng vẫn còn cặp ghép được. */
  hasMore: boolean;
  results: {
    upgradeId: number;
    generalId: string;
    inputLevel: number;
    resultLevel: number;
    resultCardId: number;
    outcome: UpgradeOutcome;
  }[];
}

/** Một thẻ trong giao dịch tặng (snapshot tại thời điểm tặng). */
export interface GiftCardSnapshot {
  id: number;
  generalId: string;
  level: number;
}

/** Người nhận có thể chọn khi tặng thẻ. lastGiftAt = lần tặng/nhận thẻ gần nhất giữa 2 người (null nếu chưa có). */
export interface RecipientDto {
  username: string;
  lastGiftAt: string | null;
}

export interface GiftResultDto {
  giftId: number;
  toUsername: string;
  cards: GiftCardSnapshot[];
  createdAt: string;
}

export type HistoryEntryDto =
  | {
      kind: 'ticket';
      id: number;
      ticketType: TicketType;
      amountDelta: number;
      reason: TicketReason;
      referenceId: string | null;
      createdAt: string;
    }
  | {
      kind: 'gacha';
      id: number;
      ticketType: TicketType;
      generalId: string;
      cardId: number;
      cardLevel: number;
      createdAt: string;
    }
  | {
      kind: 'upgrade';
      id: number;
      generalId: string;
      inputCardIds: number[];
      inputLevel: number;
      resultCardId: number;
      resultLevel: number;
      outcome: UpgradeOutcome;
      successBps: number;
      failureBps: number;
      failureDistribution: WeightEntry[];
      createdAt: string;
    }
  | {
      kind: 'giftcode';
      id: number;
      code: string;
      cards: GiftCardSnapshot[];
      /** Vé quay nhận được (dòng phần thưởng loại 'ticket'). */
      tickets: { pool: TicketType; count: number }[];
      createdAt: string;
    }
  | {
      kind: 'gift';
      id: number;
      direction: 'sent' | 'received';
      /** Người nhận (nếu mình gửi) hoặc người gửi (nếu mình nhận). */
      otherUsername: string;
      cards: GiftCardSnapshot[];
      createdAt: string;
    };

// ===== Tài khoản & Quản trị =====

export type UserStatus = 'pending' | 'approved';

/**
 * Kết quả đăng ký. Tài khoản mới ở trạng thái 'pending' (chờ admin duyệt, chưa có token, chưa có vé).
 * Riêng tài khoản đầu tiên của hệ thống tự thành admin, được duyệt ngay và nhận quà đăng ký.
 */
export type RegisterResultDto =
  | { status: 'pending'; userId: number }
  | { status: 'approved'; userId: number; token: string; isAdmin: boolean; signupBonus: TicketBalances };

export interface AdminUserDto {
  id: number;
  username: string;
  status: UserStatus;
  isAdmin: boolean;
  createdAt: string;
  approvedAt: string | null;
  tickets: TicketBalances;
  ticketTotal: number;
  cardCount: number;
  maxLevel: number | null;
}

/** Cài đặt game admin chỉnh trên trang Quản trị. */
export interface AppSettingsDto {
  /** Tài khoản đăng ký mới phải chờ admin duyệt. */
  requireApproval: boolean;
}

export interface AdminUsersPage extends Page<AdminUserDto> {
  pendingCount: number;
  /** Số vé tối đa mỗi lần admin cộng (ADMIN_GRANT_MAX_TICKETS). */
  grantMaxTickets: number;
}

export interface AdminCardDto extends CardDto {
  userId: number;
  username: string;
}

/** Một viên Ngọc của bất kỳ người chơi nào (tab Ngọc ở trang Quản trị). */
export interface AdminGemDto extends GemDto {
  userId: number;
  username: string;
}

export interface AdminApproveDto {
  user: AdminUserDto;
  signupBonus: TicketBalances;
}

export interface AdminGrantDto {
  userId: number;
  username: string;
  ticketType: TicketType;
  amount: number;
  balances: TicketBalances;
}

// ===== Giftcode (mục 3.9) =====

/**
 * Một dòng phần thưởng giftcode: cộng `count` vé quay loại `pool`.
 * Giftcode CHỈ tặng vé quay (chủ dự án yêu cầu). `kind = 'card'` chỉ còn ở dữ liệu cũ (code thẻ đã bị tắt ở migration v9).
 */
export type GiftRewardKind = 'ticket' | 'card';

export interface GiftCodeReward {
  kind: GiftRewardKind;
  pool: TicketType;
  count: number;
}

/** Giftcode gợi ý cho người chơi (popup lần đầu + trang Giftcode). */
export interface GiftCodePublicDto {
  code: string;
  rewards: GiftCodeReward[];
  expiresAt: string | null;
  redeemed: boolean;
}

export interface GiftCodeRedemptionDto {
  code: string;
  rewards: GiftCodeReward[];
  /** Vé quay đã cộng (theo loại). */
  tickets: { pool: TicketType; count: number }[];
  /** Số dư vé sau khi nhập (để UI cập nhật thanh vé). */
  balances: TicketsDto;
  createdAt: string;
}

export interface AdminGiftCodeDto {
  id: number;
  code: string;
  rewards: GiftCodeReward[];
  /** Tổng số thẻ / tổng số vé của code. */
  totalCards: number;
  totalTickets: number;
  expiresAt: string | null;
  isActive: boolean;
  featured: boolean;
  redemptionCount: number;
  createdBy: string | null;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

// ===== Danh mục hiệu ứng kỹ năng PvP (trang Admin — SKILLS.md "Danh mục 20 Hiệu ứng") =====
//
// Mỗi hiệu ứng là một dòng dữ liệu cấu hình được; `PvpConfigRegistry` (apps/api) dựng lại
// `PvpSkillDef` của engine từ danh sách này nên Admin sửa là trận PvP áp dụng ngay.

/** Phạm vi nhận hiệu ứng có lợi (buff/hồi máu) của kỹ năng. */
export const PVP_BUFF_SCOPES = ['none', 'self', 'all_allies', 'same_row_allies', 'lowest_ally', 'front_allies', 'back_allies', 'burn_allies'] as const;
export type PvpBuffScope = (typeof PVP_BUFF_SCOPES)[number];

export const PVP_BUFF_SCOPE_LABELS: Record<PvpBuffScope, string> = {
  none: 'không nhắm ai',
  self: 'bản thân',
  all_allies: 'toàn bộ đồng minh (kể cả bản thân)',
  same_row_allies: 'đồng minh cùng hàng (kể cả bản thân)',
  lowest_ally: 'đồng minh thấp máu nhất',
  front_allies: 'các tướng hàng trước',
  back_allies: 'các tướng hàng sau',
  burn_allies: 'các đồng minh có khả năng Thiêu đốt',
};

/** Hiệu ứng tăng sức mạnh phát cho bản thân/đồng minh (mục 1, 4, 9, 11, 13, 16, 20). */
export const PVP_BUFF_EFFECT_TYPES = [
  'BUFF_DAMAGE',
  'BUFF_HP',
  'BUFF_CRIT',
  'BUFF_CRIT_DAMAGE',
  'BUFF_TAKEN_DOWN',
  'BUFF_LIFESTEAL',
  'BUFF_SHIELD',
  'BUFF_HIT',
  'BUFF_DODGE',
  'BUFF_DEF_ARMOR',
  'BUFF_DEF_PEN',
  'BUFF_HOT',
  'BUFF_BURN_UP',
] as const;

/** Hiệu ứng bất lợi áp lên địch (mục 2, 5, 8, 10, 11, 17, 20). */
export const PVP_DEBUFF_EFFECT_TYPES = [
  'DEBUFF_DAMAGE_DOWN',
  'DEBUFF_HP_DOWN',
  'DEBUFF_CRIT_DOWN',
  'DEBUFF_CRIT_DAMAGE_DOWN',
  'DEBUFF_HIT_DOWN',
  'DEBUFF_DODGE_DOWN',
  'DEBUFF_DEF_ARMOR_DOWN',
  'DEBUFF_DEF_PEN_DOWN',
  'DEBUFF_BURN',
] as const;

/**
 * Hiệu ứng tức thì / cờ kỹ năng / nội tại bị động (mục 3, 6, 7, 12, 13, 14, 15, 17, 18, 19).
 * LƯU Ý: "Sát thương kỹ năng" (mục 1) KHÔNG nằm trong danh mục này — nó dùng riêng ô `damage_rate`
 * của Tướng để tránh trùng lặp dữ liệu.
 */
export const PVP_ACTIVE_EFFECT_TYPES = [
  'HEAL',
  'HEAL_SELF',
  'STUN',
  'CLEANSE',
  'PURIFY',
  'DISPEL',
  'LIFESTEAL',
  'TEAM_LIFESTEAL',
  'COUNTER',
  'SHIELD_BREAK',
  'REVIVE',
  'VS_DEBUFF_BONUS',
  'SELF_BURN',
  'BURN_CRIT_MUL',
  'BURN_CRIT_DAMAGE',
  'BURN_LIFESTEAL',
  'DODGE_REACT_COUNTER',
  'DODGE_REACT_CRIT_DAMAGE',
  'GUARANTEED_HIT_BELOW_HP',
] as const;

export const PVP_EFFECT_TYPES = [
  ...PVP_ACTIVE_EFFECT_TYPES,
  ...PVP_BUFF_EFFECT_TYPES,
  ...PVP_DEBUFF_EFFECT_TYPES,
] as const;
export type PvpEffectType = (typeof PVP_EFFECT_TYPES)[number];

export const PVP_EFFECT_LABELS: Record<PvpEffectType, string> = {
  HEAL: 'Hồi máu đồng minh',
  HEAL_SELF: 'Tự hồi máu',
  STUN: 'Choáng',
  CLEANSE: 'Giải choáng & Thiêu đốt',
  PURIFY: 'Thanh tẩy hiệu ứng bất lợi',
  DISPEL: 'Xóa hiệu ứng có lợi của địch',
  LIFESTEAL: 'Hút máu (bản thân)',
  TEAM_LIFESTEAL: 'Hút máu đội',
  COUNTER: 'Phản kích',
  SHIELD_BREAK: 'Xóa Khiên',
  REVIVE: 'Hồi sinh',
  VS_DEBUFF_BONUS: 'Đao phủ (tăng ST lên mục tiêu Debuff)',
  SELF_BURN: 'Tự thiêu đốt',
  BURN_CRIT_MUL: 'Nhân chí mạng cho đòn Thiêu đốt',
  BURN_CRIT_DAMAGE: 'ST chí mạng thêm khi đánh mục tiêu cháy',
  BURN_LIFESTEAL: 'Hút máu từ đòn Thiêu đốt',
  DODGE_REACT_COUNTER: 'Né thành công → phản kích',
  DODGE_REACT_CRIT_DAMAGE: 'Né thành công → tích ST chí mạng',
  GUARANTEED_HIT_BELOW_HP: 'Chắc chắn trúng khi mục tiêu thấp máu',
  BUFF_DAMAGE: 'Buff sát thương',
  BUFF_HP: 'Tăng máu tối đa',
  BUFF_CRIT: 'Tăng tỷ lệ chí mạng',
  BUFF_CRIT_DAMAGE: 'Tăng sát thương chí mạng',
  BUFF_TAKEN_DOWN: 'Giảm sát thương nhận',
  BUFF_LIFESTEAL: 'Ban Hút máu cho đồng minh',
  BUFF_SHIELD: 'Tạo Khiên',
  BUFF_HIT: 'Tăng Chính xác',
  BUFF_DODGE: 'Tăng Né tránh',
  BUFF_DEF_ARMOR: 'Tăng Giáp',
  BUFF_DEF_PEN: 'Tăng Xuyên giáp',
  BUFF_HOT: 'Hồi máu theo lượt (HoT)',
  BUFF_BURN_UP: 'Tăng sát thương Thiêu đốt',
  DEBUFF_DAMAGE_DOWN: 'Giảm sát thương địch gây ra',
  DEBUFF_HP_DOWN: 'Giảm máu tối đa địch',
  DEBUFF_CRIT_DOWN: 'Giảm tỷ lệ chí mạng địch',
  DEBUFF_CRIT_DAMAGE_DOWN: 'Giảm ST chí mạng địch',
  DEBUFF_HIT_DOWN: 'Giảm Chính xác địch',
  DEBUFF_DODGE_DOWN: 'Giảm Né tránh địch',
  DEBUFF_DEF_ARMOR_DOWN: 'Giảm Giáp địch',
  DEBUFF_DEF_PEN_DOWN: 'Giảm Xuyên giáp địch',
  DEBUFF_BURN: 'Thiêu đốt',
};

/** Công thức quy đổi giá trị hiệu ứng theo CẤP của tướng (khớp `packages/game-config/src/pvp.ts`). */
export const PVP_FORMULA_TYPES = [
  'FIXED',
  'FIXED_CAP_MINUS_10',
  'PER_LEVEL_LINEAR',
  'LEVEL_SPAN',
  'DEF_ARMOR_RAMP',
] as const;
export type PvpFormulaType = (typeof PVP_FORMULA_TYPES)[number];

export const PVP_FORMULA_LABELS: Record<PvpFormulaType, string> = {
  FIXED: 'Cố định (không đổi theo cấp)',
  FIXED_CAP_MINUS_10: 'Chốt cấp 10 − 10 điểm % tại Cấp 1',
  PER_LEVEL_LINEAR: 'Tuyến tính (Cấp × X%)',
  LEVEL_SPAN: 'Nội suy Cấp 1 → Cấp 10',
  DEF_ARMOR_RAMP: 'Thang dốc Giáp nguyên (Cấp 1 = 10%)',
};

/** Phong cách chiến đấu (PVP.md mục 4). */
export const PVP_STYLES = ['attack', 'defense', 'support'] as const;
export type PvpStyle = (typeof PVP_STYLES)[number];

export const PVP_STYLE_LABELS: Record<PvpStyle, string> = {
  attack: 'Tấn công',
  defense: 'Phòng thủ',
  support: 'Hỗ trợ',
};

/** Cách chọn mục tiêu của kỹ năng (PVP.md mục 2.4). */
export const PVP_TARGETINGS = ['single', 'lane', 'back_row', 'back_single', 'highest_damage_enemy', 'front_enemies', 'all_enemies', 'all_allies', 'lowest_ally', 'front_allies', 'back_allies'] as const;
export type PvpTargeting = (typeof PVP_TARGETINGS)[number];

export const PVP_TARGETING_LABELS: Record<PvpTargeting, string> = {
  single: 'một mục tiêu (ưu tiên hàng trước)',
  lane: 'toàn bộ hàng ngang',
  back_row: 'các tướng ở hàng sau',
  back_single: 'một tướng ở hàng sau',
  highest_damage_enemy: 'tướng địch có sát thương cao nhất',
  front_enemies: 'các tướng ở hàng trước',
  all_enemies: 'toàn bộ tướng địch',
  all_allies: 'toàn bộ đồng minh',
  lowest_ally: 'đồng minh thấp máu nhất',
  front_allies: 'các tướng hàng trước',
  back_allies: 'các tướng hàng sau',
};

/**
 * Nội tại tướng (SKILLS.md — mục "Nội tại tướng"). Chỉ có 4 nội tại và được RẢI ĐỀU trên toàn roster
 * (mỗi nội tại ~1/4 số tướng); tướng được gán theo hướng kỹ năng nhưng luôn giữ số lượng cân bằng.
 */
export const PVP_PASSIVES = ['CRIT_5', 'DAMAGE_10', 'HP_10', 'DEF_5'] as const;
export type PvpPassive = (typeof PVP_PASSIVES)[number];

export const PVP_PASSIVE_LABELS: Record<PvpPassive, string> = {
  CRIT_5: '+5% tỷ lệ chí mạng',
  DAMAGE_10: '+10% sát thương',
  HP_10: '+10% HP tối đa',
  DEF_5: '+20 Giáp',
};

// ===== DTO cấu hình PvP cho trang Admin =====

/** Một dòng hiệu ứng kỹ năng (lưu JSON trong `pvp_heroes.skill_effects`). */
export interface PvpSkillEffectDto {
  type: PvpEffectType;
  /** Giá trị CHỐT (bps hoặc điểm Giáp) hoặc hệ số mỗi cấp khi `formulaType = PER_LEVEL_LINEAR`. */
  value: number;
  /** Giá trị tại Cấp 1 (chỉ dùng cho `LEVEL_SPAN`). */
  minValue?: number;
  /** Số lượt duy trì. */
  duration: number;
  /** Số lớp cộng dồn tối đa. */
  maxLayers: number;
  /** Tỉ lệ kích hoạt (bps) hoặc hệ số phụ. */
  rate: number;
  formulaType: PvpFormulaType;
  /** Phạm vi nhận hiệu ứng (buff). */
  scope?: PvpBuffScope;
  /** Hình dạng hiệu ứng: đơn mục tiêu / hàng / toàn bộ. */
  mode?: 'single' | 'row' | 'all';
}

/** Cấu hình đầy đủ của MỘT tướng PvP trong Admin. */
export interface PvpHeroAdminDto {
  id: string;
  name: string;
  faction: Faction;
  isHot: boolean;
  style: PvpStyle;
  passiveType: PvpPassive;
  baseHp: number;
  baseAtk: number;
  baseDef: number;
  skillName: string;
  skillDescription: string;
  targetType: PvpTargeting;
  damageRate: number;
  skillEffects: PvpSkillEffectDto[];
}

export interface PvpHeroesAdminDto {
  items: PvpHeroAdminDto[];
  total: number;
}

/** Cấu hình MỘT hệ Ngọc Ngũ Hành trong Admin (2 chỉ số × Cấp 1/Cấp 10). */
export interface PvpGemAdminDto {
  element: GemElement;
  stat1Type: keyof PvpGemStats;
  stat1Min: number;
  stat1Max: number;
  stat2Type: keyof PvpGemStats;
  stat2Min: number;
  stat2Max: number;
}

export interface PvpGemsAdminDto {
  items: PvpGemAdminDto[];
}

/** Tầng cấp cao nhất được quay trực tiếp (khớp `GACHA_MAX_LEVEL` bên game-config). */
export const GACHA_ADMIN_MAX_LEVEL = 9;
/** Thang riêng của bảng tỉ lệ level quay: 100000 = 100% (đủ chi tiết để biểu diễn Lv9 = 0.005%). */
export const GACHA_LEVEL_SCALE_ADMIN = 100_000;

/**
 * Tỉ lệ quay chỉnh trên trang Quản trị: bảng tỉ lệ cấp tướng (Lv1–Lv9) + cấu hình rớt Ngọc
 * (tỉ lệ rớt mỗi lượt và trọng số 5 hệ). Tổng mỗi bảng BẮT BUỘC = 100% khi lưu.
 */
export interface GachaRatesAdminDto {
  /** Bảng tỉ lệ cấp tướng khi quay — tổng `bps` phải bằng `levelScale`. */
  levelRates: WeightEntry[];
  /** Đơn vị của `levelRates` (100000 = 100%). */
  levelScale: number;
  /** Tỉ lệ rớt Ngọc đính kèm mỗi lượt quay (bps, 10000 = 100%). */
  gemDropBps: number;
  /** Trọng số chọn hệ Ngọc khi trúng rớt (bps) — tổng bằng `bpsScale`. */
  gemTypeWeights: Record<GemElement, number>;
  /** Đơn vị của `gemDropBps`/`gemTypeWeights` (10000 = 100%). */
  bpsScale: number;
  /** Lần chỉnh gần nhất (ISO) — null nếu chưa từng lưu từ trang Quản trị. */
  updatedAt: string | null;
}

// ===== JSON Schemas (Fastify validate) =====

const idempotencyKey = { type: 'string', minLength: 8, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' } as const;

/** Schema một dòng hiệu ứng kỹ năng (dùng chung cho create/update Tướng PvP). */
const pvpSkillEffect = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'value'],
  properties: {
    type: { type: 'string', enum: [...PVP_EFFECT_TYPES] },
    /** Giá trị CHỐT (cap): bps (10000 = 100%) hoặc điểm Giáp nguyên. */
    value: { type: 'integer', minimum: 0, maximum: 1000000 },
    /** Chỉ dùng cho LEVEL_SPAN: giá trị tại Cấp 1 (bỏ trống = suy từ `value`). */
    minValue: { type: 'integer', minimum: 0, maximum: 1000000 },
    /** Số lượt duy trì (buff/debuff/thiêu đốt/phản kích). */
    duration: { type: 'integer', minimum: 0, maximum: 50, default: 3 },
    /** Số lớp cộng dồn tối đa. */
    maxLayers: { type: 'integer', minimum: 1, maximum: 10, default: 3 },
    /** Tỉ lệ kích hoạt (bps) hoặc hệ số mỗi cấp của hiệu ứng. */
    rate: { type: 'integer', minimum: 0, maximum: 1000000, default: 0 },
    formulaType: { type: 'string', enum: [...PVP_FORMULA_TYPES], default: 'FIXED_CAP_MINUS_10' },
    scope: { type: 'string', enum: [...PVP_BUFF_SCOPES] },
    mode: { type: 'string', enum: ['single', 'row', 'all'] },
  },
} as const;

export const schemas = {
  credentials: {
    type: 'object',
    additionalProperties: false,
    required: ['username', 'password'],
    properties: {
      username: { type: 'string', minLength: 3, maxLength: 32, pattern: '^[A-Za-z0-9_]+$' },
      password: { type: 'string', minLength: 6, maxLength: 128 },
    },
  },
  drawBody: {
    type: 'object',
    additionalProperties: false,
    required: ['ticketType', 'idempotencyKey'],
    properties: {
      ticketType: { type: 'string', enum: [...TICKET_TYPES] },
      // Giá trị hợp lệ cụ thể (1, 10 hoặc DRAW_ALL_MAX = "Mở tất cả") do server kiểm tra theo game-config.
      count: { type: 'integer', minimum: 1, maximum: 5000, default: 1 },
      idempotencyKey,
    },
  },
  usersQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', maxLength: 32 },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
    },
  },
  giftBody: {
    type: 'object',
    additionalProperties: false,
    required: ['toUsername', 'cardIds', 'idempotencyKey'],
    properties: {
      toUsername: { type: 'string', minLength: 3, maxLength: 32, pattern: '^[A-Za-z0-9_]+$' },
      // Giới hạn chính xác (20) do server kiểm tra theo GIFT_MAX_CARDS
      cardIds: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'integer', minimum: 1 } },
      idempotencyKey,
    },
  },
  quickUpgradeBody: {
    type: 'object',
    additionalProperties: false,
    required: ['idempotencyKey'],
    properties: {
      idempotencyKey,
      // Level đầu vào tham gia ghép nhanh; bỏ trống = mặc định Lv.1–QUICK_UPGRADE_MAX_LEVEL (Lv.5).
      levels: { type: 'array', minItems: 1, maxItems: 9, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 9 } },
    },
  },
  devTopupBody: {
    type: 'object',
    additionalProperties: false,
    required: ['idempotencyKey'],
    properties: { idempotencyKey },
  },
  upgradePreviewBody: {
    type: 'object',
    additionalProperties: false,
    required: ['cardIds'],
    properties: {
      // Số lượng chính xác do server kiểm tra theo UPGRADE_INPUT_COUNT
      cardIds: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'integer', minimum: 1 } },
    },
  },
  upgradeAttemptBody: {
    type: 'object',
    additionalProperties: false,
    required: ['cardIds', 'idempotencyKey'],
    properties: {
      // Số lượng chính xác do server kiểm tra theo UPGRADE_INPUT_COUNT
      cardIds: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'integer', minimum: 1 } },
      idempotencyKey,
    },
  },
  cardsQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      faction: { type: 'string', enum: [...FACTIONS] },
      level: { type: 'integer', minimum: MIN_LEVEL, maximum: MAX_LEVEL },
      generalId: { type: 'string', maxLength: 64 },
      q: { type: 'string', maxLength: 64 },
      sort: { type: 'string', enum: ['newest', 'level_desc', 'level_asc', 'name'] },
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
    },
  },
  idParams: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', minimum: 1 } },
  },
  /** Định danh tướng PvP (khoá chữ) dùng trên đường dẫn Admin. */
  pvpIdParams: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9_-]+$' } },
  },
  adminUsersQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      q: { type: 'string', maxLength: 32 },
      status: { type: 'string', enum: ['pending', 'approved'] },
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
    },
  },
  adminSetAdminBody: {
    type: 'object',
    additionalProperties: false,
    required: ['isAdmin'],
    properties: { isAdmin: { type: 'boolean' } },
  },
  adminGrantBody: {
    type: 'object',
    additionalProperties: false,
    required: ['userId', 'ticketType', 'amount', 'idempotencyKey'],
    properties: {
      userId: { type: 'integer', minimum: 1 },
      ticketType: { type: 'string', enum: [...TICKET_TYPES] },
      // Trần chính xác (ADMIN_GRANT_MAX_TICKETS) do server kiểm tra theo game-config
      amount: { type: 'integer', minimum: 1, maximum: 1000000 },
      idempotencyKey,
    },
  },
  adminCardsQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      userId: { type: 'integer', minimum: 1 },
      faction: { type: 'string', enum: [...FACTIONS] },
      level: { type: 'integer', minimum: MIN_LEVEL, maximum: MAX_LEVEL },
      q: { type: 'string', maxLength: 64 },
      sort: { type: 'string', enum: ['newest', 'level_desc', 'level_asc', 'name', 'owner'] },
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 60 },
    },
  },
  adminGemsQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      userId: { type: 'integer', minimum: 1 },
      element: { type: 'string', enum: [...GEM_ELEMENTS] },
      level: { type: 'integer', minimum: MIN_LEVEL, maximum: MAX_LEVEL },
      sort: { type: 'string', enum: ['newest', 'level_desc', 'level_asc', 'owner'] },
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 500, default: 60 },
    },
  },
  adminPvpHeroesQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      faction: { type: 'string', enum: [...FACTIONS] },
      style: { type: 'string', enum: [...PVP_STYLES] },
      q: { type: 'string', maxLength: 64 },
    },
  },
  /** Tạo Tướng PvP: chỉ cần Tên + Phe (mọi cấu hình khác lấy mặc định mức sàn ở server). */
  adminPvpHeroCreateBody: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'faction'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 64 },
      faction: { type: 'string', enum: [...FACTIONS] },
      id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9_-]+$' },
    },
  },
  adminPvpHeroUpdateBody: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'faction', 'style', 'passiveType', 'baseHp', 'baseAtk', 'baseDef', 'skillName', 'targetType', 'damageRate', 'skillEffects'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 64 },
      faction: { type: 'string', enum: [...FACTIONS] },
      isHot: { type: 'boolean', default: false },
      style: { type: 'string', enum: [...PVP_STYLES] },
      passiveType: { type: 'string', enum: [...PVP_PASSIVES] },
      baseHp: { type: 'integer', minimum: 1, maximum: 10000000 },
      baseAtk: { type: 'integer', minimum: 1, maximum: 10000000 },
      baseDef: { type: 'integer', minimum: 0, maximum: 100000 },
      skillName: { type: 'string', minLength: 1, maxLength: 64 },
      skillDescription: { type: 'string', maxLength: 1000, default: '' },
      targetType: { type: 'string', enum: [...PVP_TARGETINGS] },
      /** % Sát thương kỹ năng gốc, đơn vị bps (10000 = 100%). */
      damageRate: { type: 'integer', minimum: 0, maximum: 1000000 },
      skillEffects: { type: 'array', maxItems: 40, items: pvpSkillEffect },
    },
  },
  /** Cập nhật bảng Ngọc Ngũ Hành: chỉ 2 chỉ số × (Cấp 1, Cấp 10) cho từng hệ. */
  adminPvpGemsUpdateBody: {
    type: 'object',
    additionalProperties: false,
    required: ['element', 'stat1Type', 'stat1Min', 'stat1Max', 'stat2Type', 'stat2Min', 'stat2Max'],
    properties: {
      element: { type: 'string', enum: [...GEM_ELEMENTS] },
      stat1Type: { type: 'string', enum: [...PVP_GEM_STAT_KEYS] },
      stat1Min: { type: 'integer', minimum: 0, maximum: 1000000 },
      stat1Max: { type: 'integer', minimum: 0, maximum: 1000000 },
      stat2Type: { type: 'string', enum: [...PVP_GEM_STAT_KEYS] },
      stat2Min: { type: 'integer', minimum: 0, maximum: 1000000 },
      stat2Max: { type: 'integer', minimum: 0, maximum: 1000000 },
    },
  },
  /** Cập nhật tỉ lệ quay (cấp tướng + rớt Ngọc) — server kiểm tra tổng mỗi bảng = 100%. */
  adminGachaRatesUpdateBody: {
    type: 'object',
    additionalProperties: false,
    required: ['levelRates', 'gemDropBps', 'gemTypeWeights'],
    properties: {
      levelRates: {
        type: 'array',
        minItems: 1,
        maxItems: GACHA_ADMIN_MAX_LEVEL,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['level', 'bps'],
          properties: {
            level: { type: 'integer', minimum: MIN_LEVEL, maximum: GACHA_ADMIN_MAX_LEVEL },
            bps: { type: 'integer', minimum: 0, maximum: GACHA_LEVEL_SCALE_ADMIN },
          },
        },
      },
      gemDropBps: { type: 'integer', minimum: 0, maximum: 10000 },
      gemTypeWeights: {
        type: 'object',
        additionalProperties: false,
        required: [...GEM_ELEMENTS],
        properties: Object.fromEntries(GEM_ELEMENTS.map((e) => [e, { type: 'integer', minimum: 0, maximum: 10000 }])),
      },
    },
  },
  questClaimBody: {
    type: 'object',
    additionalProperties: false,
    properties: {
      /** Bỏ trống = nhận tất cả phần thưởng đang nhận được. */
      keys: { type: 'array', minItems: 1, maxItems: 500, items: { type: 'string', minLength: 1, maxLength: 64 } },
    },
  },
  giftCodeRedeemBody: {
    type: 'object',
    additionalProperties: false,
    required: ['code'],
    properties: { code: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  adminGiftCodeCreateBody: {
    type: 'object',
    additionalProperties: false,
    required: ['code', 'rewards'],
    properties: {
      code: { type: 'string', minLength: 3, maxLength: 32, pattern: '^[A-Za-z0-9_-]+$' },
      rewards: {
        type: 'array',
        minItems: 1,
        maxItems: TICKET_TYPES.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['pool', 'count'],
          properties: {
            kind: { type: 'string', enum: ['ticket'], default: 'ticket' },
            pool: { type: 'string', enum: [...TICKET_TYPES] },
            // Trần tổng (GIFT_CODE_MAX_TICKETS) do server kiểm tra theo game-config
            count: { type: 'integer', minimum: 1, maximum: 10000 },
          },
        },
      },
      expiresAt: { anyOf: [{ type: 'string', maxLength: 40 }, { type: 'null' }] },
      featured: { type: 'boolean' },
    },
  },
  adminSettingsBody: {
    type: 'object',
    additionalProperties: false,
    required: ['requireApproval'],
    properties: { requireApproval: { type: 'boolean' } },
  },
  adminGiftCodeActiveBody: {
    type: 'object',
    additionalProperties: false,
    required: ['isActive'],
    properties: { isActive: { type: 'boolean' } },
  },
  historyQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: ['ticket', 'gacha', 'upgrade', 'gift', 'giftcode'] },
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
  },
  pvpTeamBody: {
    type: 'object',
    additionalProperties: false,
    required: ['units'],
    properties: {
      // Số tướng tối đa do PVP_TEAM_SIZE quyết định; server kiểm tra trùng slot/trùng tướng và quyền sở hữu.
      units: {
        type: 'array',
        maxItems: PVP_TEAM_SIZE,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['slot', 'generalId', 'level'],
          properties: {
            slot: { type: 'integer', minimum: 1, maximum: PVP_TEAM_SIZE },
            generalId: { type: 'string', minLength: 1, maxLength: 64 },
            level: { type: 'integer', minimum: MIN_LEVEL, maximum: MAX_LEVEL },
          },
        },
      },
      // Ngọc gắn cho đội: tối đa PVP_TEAM_GEM_COUNT loại KHÁC nhau. Bỏ trống = gỡ hết Ngọc.
      gems: {
        type: 'array',
        maxItems: PVP_TEAM_GEM_COUNT,
        uniqueItems: true,
        items: { type: 'string', enum: [...GEM_ELEMENTS] },
      },
    },
  },
  gemMergeAttemptBody: {
    type: 'object',
    additionalProperties: false,
    required: ['gemIds', 'idempotencyKey'],
    properties: {
      // Đúng UPGRADE_INPUT_COUNT (2) viên cùng loại & cùng cấp; server kiểm tra lại.
      gemIds: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'integer', minimum: 1 } },
      idempotencyKey,
    },
  },
  gemMergeQuickBody: {
    type: 'object',
    additionalProperties: false,
    required: ['idempotencyKey'],
    properties: {
      idempotencyKey,
      // Level đầu vào tham gia ghép nhanh; bỏ trống = mặc định Lv.1–QUICK_UPGRADE_MAX_LEVEL (Lv.5).
      levels: { type: 'array', minItems: 1, maxItems: 9, uniqueItems: true, items: { type: 'integer', minimum: 1, maximum: 9 } },
    },
  },
  pvpChallengeBody: {
    type: 'object',
    additionalProperties: false,
    required: ['opponentId'],
    properties: { opponentId: { type: 'integer', minimum: 1 } },
  },
  pvpBattlesQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      pageSize: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
    },
  },
  /** Chi tiết chiến đấu của một tướng: id là slug tướng (không phải số). */
  generalCombatParams: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  generalCombatQuery: {
    type: 'object',
    additionalProperties: false,
    properties: {
      level: { type: 'integer', minimum: MIN_LEVEL, maximum: MAX_LEVEL, default: MIN_LEVEL },
      // Danh sách generalId trong đội (phân tách bằng dấu phẩy) — để tính Chỉ số Nền Ra Trận
      // (aura Hỗ trợ + Cổng Đồng Phe). Bỏ trống = xem tự do, không cộng chỉ số nền đội.
      squad: { type: 'string', maxLength: 512 },
      // Danh sách LOẠI Ngọc đã gắn cho đội (phân tách bằng dấu phẩy) — để Chỉ số Nền khớp khi vào trận.
      gems: { type: 'string', maxLength: 128 },
    },
  },
  profileBody: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // Bỏ trống = giữ nguyên. Server kiểm tra tên sau khi cắt khoảng trắng và giới hạn ảnh đại diện.
      displayName: { type: 'string', minLength: 1, maxLength: DISPLAY_NAME_MAX },
      // Dùng mảng type thay vì anyOf: ajv của Fastify (coerceTypes) sẽ ép null thành '' nếu đi qua anyOf.
      avatar: { type: ['string', 'null'], maxLength: AVATAR_MAX_LENGTH },
    },
  },
  passwordBody: {
    type: 'object',
    additionalProperties: false,
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string', minLength: 6, maxLength: 128 },
      newPassword: { type: 'string', minLength: 6, maxLength: 128 },
    },
  },
} as const;

// ======================= Bảng xếp hạng (mục 6.6) =======================

export interface LeaderboardEntryDto {
  /** Id người chơi (dùng để mời thi đấu PvP, mục 6.7). */
  id: number;
  /** Hạng theo Lực chiến của đội hình (đồng LC => đồng hạng). null = chưa có tướng nên chưa xếp hạng. */
  rank: number | null;
  /** Tên đăng nhập (dùng phân định nội bộ / sắp xếp). */
  username: string;
  /** Tên hiển thị (mặc định = tên đăng nhập; xem mục 3.11). */
  displayName: string;
  /** Ảnh đại diện (xem mục 3.11); null = dùng ảnh mặc định. */
  avatar: string | null;
  /** Tổng Lực chiến (LC) của đội hình đang dùng (đội đã lưu, hoặc đội tự động nếu chưa lưu). */
  lc: number;
  isMe: boolean;
}

export interface LeaderboardDto {
  metric: 'lc';
  /** Số hạng đầu được làm nổi bật (top 10). */
  top: number;
  /** Tối đa LEADERBOARD_SIZE người, đã sắp theo hạng. */
  items: LeaderboardEntryDto[];
  /** Hạng của người đang xem; null nếu là tài khoản quản trị (không tham gia xếp hạng). */
  me: LeaderboardEntryDto | null;
  /** Tổng số người chơi có tướng trong đội được xếp hạng (LC > 0). */
  totalRanked: number;
  generatedAt: string;
}

// ======================= Nhiệm vụ & thành tựu (mục 3.10) =======================

export interface QuestRewardDto {
  pool: TicketType;
  count: number;
}

/** progress: chưa đạt; claimable: đạt, chờ bấm Nhận; claimed: đã nhận (bấm tay hoặc tự nhận khi qua ngày). */
export type QuestStatus = 'progress' | 'claimable' | 'claimed';

export interface QuestItemDto {
  /** Khoá phần thưởng duy nhất, gửi lên khi bấm Nhận. */
  key: string;
  name: string;
  desc: string;
  progress: number;
  target: number;
  reward: QuestRewardDto;
  status: QuestStatus;
}

export interface AchievementGroupDto {
  id: string;
  title: string;
  desc: string;
  progress: number;
  items: QuestItemDto[];
}

export interface LoginDayDto {
  date: string; // YYYY-MM-DD (lịch Việt Nam)
  day: number;
  reward: number;
  /** missed: đã qua mà không đăng nhập; future: chưa tới. */
  status: 'missed' | 'future' | QuestStatus;
}

export interface QuestsDto {
  /** Ngày game hiện tại (reset 05:00 giờ Việt Nam), YYYY-MM-DD. */
  gameDay: string;
  nextResetAt: string;
  /** Ngày dương lịch Việt Nam hiện tại. */
  calendarDate: string;
  resetBonus: { tickets: TicketBalances; granted: boolean };
  daily: QuestItemDto[];
  faction: Record<Faction, QuestItemDto[]>;
  /** Nhiệm vụ đấu trường PvP trong ngày (chỉ tính trận người chơi chủ động khiêu chiến). */
  pvp: QuestItemDto[];
  /** Nhiệm vụ Ngọc Ngũ Hành trong ngày (nhận Ngọc khi chiêu mộ, ghép Ngọc). */
  gem: QuestItemDto[];
  login: { month: string; days: LoginDayDto[] };
  achievements: AchievementGroupDto[];
  /** Số phần thưởng đang chờ bấm Nhận (badge tab). */
  claimable: number;
}

export interface QuestClaimedDto {
  key: string;
  name: string;
  pool: TicketType;
  count: number;
}

export interface QuestClaimResultDto {
  claimed: QuestClaimedDto[];
  balances: TicketsDto;
}

export interface DailyEventsDto {
  /** Thưởng reset vừa cộng (null nếu không có). */
  resetBonus: TicketBalances | null;
  /** Nhiệm vụ ngày cũ đạt nhưng chưa nhận, server đã tự cộng. */
  autoClaimed: QuestClaimedDto[];
}

// ======================= Đấu trường PvP (mục 6.7 — PVP.md) =======================

/** Hai phía trên chiến trường: A (bên trái) và B (bên phải) theo PVP.md mục 2.2. */
export const PVP_SIDES = ['a', 'b'] as const;
export type PvpSide = (typeof PVP_SIDES)[number];

/**
 * Nhóm kỹ năng chiến đấu (SKILLS.md — mỗi tướng có một bộ hiệu ứng tường minh trong game-config).
 * Nhóm chỉ dùng để phân loại/nhãn dự phòng trên UI; tên chiêu thật hiển thị qua `skillName`.
 */
export const PVP_SKILLS = ['ATTACK', 'STUN', 'BUFF', 'HEAL', 'DEBUFF', 'BURN', 'DISPEL', 'PURIFY', 'CLEANSE'] as const;
export type PvpSkill = (typeof PVP_SKILLS)[number];

export const PVP_SKILL_LABELS: Record<PvpSkill, string> = {
  ATTACK: 'Sát thương',
  STUN: 'Khống chế (Choáng)',
  BUFF: 'Tăng cường đồng đội',
  HEAL: 'Hồi máu',
  DEBUFF: 'Suy yếu đối thủ',
  BURN: 'Hỏa công (Thiêu đốt)',
  DISPEL: 'Xóa hiệu ứng có lợi',
  PURIFY: 'Thanh tẩy hiệu ứng bất lợi',
  CLEANSE: 'Giải choáng',
};

/** Một tướng trong đội hình: slot 1–3 hàng trước (trên → dưới), slot 4–6 hàng sau. */
export interface PvpUnitDto {
  slot: number;
  generalId: string;
  level: number;
  /** Lực chiến (LC) của tướng ở cấp này — cộng lại thành Lực chiến của đội. */
  lc: number;
}

/** Đội hình PvP đã lưu. units rỗng = chưa xếp; lc = TỔNG Lực chiến của đội (mục 6.7). */
export interface PvpTeamDto {
  units: PvpUnitDto[];
  /** Ngọc Ngũ Hành đã gắn (tối đa PVP_TEAM_GEM_COUNT loại khác nhau; cấp = cấp cao nhất đang sở hữu). */
  gems: PvpTeamGemDto[];
  lc: number;
}

/** Người chơi trong trận (thông tin hiển thị). */
export interface PvpFighterDto extends ProfileDto {
  id: number;
}

/** Kết quả theo góc nhìn của người đang xem. */
export type PvpOutcome = 'win' | 'loss' | 'draw';
/** Người thắng trận: 'a' (đội tấn công) / 'b' (đội phòng thủ) / 'draw' (hòa). */
export type PvpWinner = PvpSide | 'draw';

/** Trạng thái đầu trận của một tướng — client dùng để dựng bàn đấu trước khi phát lại. */
export interface PvpUnitStateDto {
  /** 0–5 = đội A (theo slot 1–6); 6–11 = đội B. Vị trí trống thì không có phần tử. */
  idx: number;
  side: PvpSide;
  slot: number;
  generalId: string;
  level: number;
  style: PvpStyle;
  skill: PvpSkill;
  /** Tên kỹ năng thật lấy từ SKILLS.md (ví dụ "Hiệu lệnh thiên hạ") — client hiện khi tướng ra đòn. */
  skillName: string;
  passive: PvpPassive;
  maxHp: number;
  hp: number;
  /** Sát thương cơ bản sau hiệu ứng nền/hàng/nội tại (đã gồm hot). Client hiện ở ô tướng khi phát lại. */
  damage: number;
  lc: number;
  /** Tỉ lệ chí mạng cuối cùng (bps, 10000 = 100%). */
  critBps: number;
  /** ST chí mạng nền theo cấp (bps; cấp 1 = 3000 → ×1,30, cấp 10 = 6000 → ×1,60). Client hiện ở ô tướng khi phát lại. */
  critDamageBps: number;
  /** Tỉ lệ choáng cuối cùng của kỹ năng (bps). */
  stunBps: number;
  /** Hút máu ở cấp hiện tại: hồi bản thân theo % sát thương thực tế gây ra (bps; 0 = không hút máu). */
  lifestealBps: number;
  /**
   * Hút máu ĐỘI ở cấp hiện tại: hồi BẢN THÂN và MỌI ĐỒNG MINH còn sống theo % TỔNG sát thương đòn
   * đánh gây ra (bps; 0 = không có). Khác `lifestealBps` (chỉ hồi bản thân).
   */
  teamLifestealBps?: number;
  /** Chính xác khi vào trận theo cấp (bps; cấp 1 = 8000 = 80% → cấp 10 = 10000 = 100%, trần 15000 — SKILLS.md mục 18). */
  hitBps: number;
  /** Né tránh khi vào trận theo cấp (bps; cấp 1 = 200 = 2% → cấp 10 = 2000 = 20%, trần 5000 — SKILLS.md mục 18). */
  dodgeBps: number;
  /** Giáp khi vào trận (số nguyên điểm; `DR = Giáp / (Giáp + 100)`, trần 75% — SKILLS.md mục 18). */
  defArmor: number;
  /** Xuyên giáp khi vào trận: % bỏ qua Phòng thủ của địch (mặc định 0, trần 5000 — mục 18). */
  defPenBps: number;
  /** Các kênh buff có lợi mà kỹ năng của tướng phát (client mô tả khi thi triển). Rỗng = không buff. */
  buffs?: PvpBuffEntryDto[];
  /** Hiệu ứng bất lợi mà kỹ năng của tướng áp lên địch (client mô tả khi thi triển). */
  debuff?: PvpDebuffDto;
  /** Phản kích của tướng khi gánh sát thương chủ động (rỗng = không phản kích). */
  counter?: PvpCounterDto;
  /** Kỹ năng tự gây thiêu đốt lên bản thân (Khổ nhục kế — Hoàng Cái). */
  selfBurn?: boolean;
}

/**
 * Sự kiện trong trận, theo thứ tự phát lại.
 *
 * Quy ước truyền tải: các field SỐ mang giá trị MẶC ĐỊNH 0 của sự kiện `buff`/`debuff` sẽ
 * BỊ LƯỢC BỎ khỏi JSON (hai loại này chiếm ~70% dung lượng phát lại nhưng mỗi lớp thường chỉ
 * cộng 1–2 chỉ số, phần còn lại bằng 0). Client đọc field thiếu như giá trị 0.
 */
export type PvpEventDto =
  | { t: 'round'; round: number }
  | { t: 'act'; idx: number; skill: PvpSkill; targets: number[] }
  | { t: 'skip'; idx: number }
  /**
   * Trượt (SKILLS.md mục 18 — BƯỚC 1): đòn bị Né, KHÔNG gây sát thương, giữ nguyên Khiên & Máu,
   * không kích phản kích. `from` = người ra đòn, `idx` = người né được.
   */
  | { t: 'miss'; from: number; idx: number }
  /**
   * Nội tại "Né thành công → tích lũy" (Mã Siêu — SKILLS.md mục 18): mỗi lần Né thành công cộng dồn
   * VĨNH VIỄN `critDamageBps` ST chí mạng cho `idx`, hiện đang có `layers`/`maxLayers` lớp.
   */
  | { t: 'dodgeReact'; idx: number; layers: number; maxLayers: number; critDamageBps: number }
  /**
   * Sát thương trực tiếp. `amount` = sát thương sau khi Phòng thủ đã cản (`mitigated` = phần bị Phòng
   * thủ giảm đi, mục 18 BƯỚC 2), TRƯỚC khi trừ Khiên; `absorbed` = phần Khiên đã hấp thụ (BƯỚC 3).
   */
  | { t: 'damage'; from: number; idx: number; amount: number; crit: boolean; hp: number; mitigated?: number; absorbed?: number }
  /** Hồi máu. `lifesteal` = hồi nhờ Hút máu (từ đòn đánh hoặc từ Thiêu đốt) để client chọn âm thanh đúng. */
  | { t: 'heal'; from: number; idx: number; amount: number; crit: boolean; hp: number; lifesteal?: boolean }
  /** Phản kích: `from` đánh trả `idx` (kẻ vừa gây sát thương cho `from`). Có thể Chí mạng. */
  | { t: 'counter'; from: number; idx: number; amount: number; crit: boolean; hp: number; mitigated?: number; absorbed?: number }
  /**
   * Choáng: mục tiêu bỏ lượt cho tới khi TƯỚNG GÂY CHOÁNG ra skill ở lượt kế tiếp (`byIdx` = idx
   * của tướng đó). Choáng đè/nối tiếp được: nguồn mới nhất ghi vào `byIdx`.
   */
  | { t: 'stun'; idx: number; byIdx: number }
  | { t: 'cleanse'; idx: number }
  /**
   * Buff có lợi phát cho đồng minh: mỗi lần tướng tới lượt cộng MỘT lớp. Các giá trị `*Flat` là lượng
   * cộng thẳng của lớp này theo chỉ số nền của CHÍNH tướng nhận (client tự cộng vào chỉ số hiển thị).
   * `crit` = lớp này ăn chí mạng (×ST chí mạng cho % sát thương/HP). `expiresRound` = lượt cuối hiệu lực;
   * `from` = idx người thi triển; `channel` = kênh buff trong kỹ năng của nguồn (trần `maxLayers` tính
   * riêng theo từng (nguồn, kênh)). `maxLayers` = số lớp cộng dồn tối đa THEO TỪNG (nguồn, kênh) (client
   * bỏ lớp cũ nhất cùng `from` + `channel` khi vượt trần; nguồn/kênh khác vẫn cộng dồn).
   * Mọi field số ở đây đều là TUỲ CHỌN: bằng 0 thì bị lược bỏ khỏi JSON (đọc thiếu = 0).
   */
  | { t: 'buff'; from: number; channel: number; idx: number; damageFlat?: number; hpFlat?: number; critBps?: number; critDamageBps?: number; takenDownBps?: number; lifestealBps?: number; hitBps?: number; dodgeBps?: number; defArmor?: number; defPenBps?: number; burnUpBps?: number; crit: boolean; expiresRound: number; maxLayers: number }
  /**
   * Áp một lớp hiệu ứng bất lợi lên mục tiêu địch: giảm sát thương gây ra (`damageFlat`),
   * giảm trần HP (`hpFlat`), giảm chí mạng (`critBps`), giảm ST chí mạng (`critDamageBps`),
   * giảm Chính xác/Né tránh/Giáp/Xuyên giáp (`hitDownBps`/`dodgeDownBps`/`defArmorDown`/`defPenDownBps`)
   * và/hoặc thiêu đốt mỗi lượt (`burnFlat`). `from` = idx người thi triển;
   * `maxLayers` = số lớp cộng dồn tối đa THEO TỪNG nguồn.
   * Mọi field số ở đây đều là TUỲ CHỌN: bằng 0 thì bị lược bỏ khỏi JSON (đọc thiếu = 0).
   */
  | { t: 'debuff'; from: number; idx: number; damageFlat?: number; hpFlat?: number; critBps?: number; critDamageBps?: number; hitDownBps?: number; dodgeDownBps?: number; defArmorDown?: number; defPenDownBps?: number; burnFlat?: number; expiresRound: number; maxLayers: number }
  /**
   * Thiêu đốt: gây sát thương vào đầu mỗi lượt cho tướng đang bị thiêu đốt (có thể ăn chí mạng).
   * `amount` = sát thương THỰC nhận sau Phòng thủ; `mitigated` = phần bị Phòng thủ cản lại (mục 18).
   */
  | { t: 'burn'; idx: number; amount: number; crit: boolean; hp: number; absorbed?: number; mitigated?: number }
  /**
   * Tạo Khiên (SKILLS.md mục 16): cộng MỘT lớp khiên hấp thụ sát thương cho `idx`. `amount` = lượng
   * hấp thụ của lớp này (theo % HP tối đa của chính tướng nhận). Client cộng dồn các lớp còn hiệu lực.
   */
  | { t: 'shield'; from: number; idx: number; channel: number; amount: number; expiresRound: number; maxLayers: number }
  /** Xóa Khiên (SKILLS.md mục 17): bẻ gãy và loại bỏ TOÀN BỘ lớp khiên hiện có của `idx`. */
  | { t: 'shieldBreak'; from: number; idx: number }
  /** Xóa toàn bộ hiệu ứng có lợi (lớp buff) của mục tiêu. */
  | { t: 'dispel'; idx: number }
  /** Thanh tẩy hiệu ứng bất lợi của đồng minh (trừ choáng và thiêu đốt). */
  | { t: 'purify'; idx: number }
  /**
   * Hồi sinh (mục 1.14): máu về 0 lần đầu trong trận nhưng tướng KHÔNG gục — hồi lại `hp` và bị
   * giảm sát thương gây ra `damageDownBps` (bps) VĨNH VIỄN tới hết trận. Chỉ hiệu lực MỘT lần/trận.
   */
  | { t: 'revive'; idx: number; hp: number; damageDownBps: number }
  | { t: 'down'; idx: number }
  | { t: 'end'; winner: PvpWinner; rounds: number; reason: 'wipe' | 'timeout' };

/** Bản ghi một trận đấu — đủ dữ liệu để phát lại (mục 15: kết quả tái dựng được từ dữ liệu server). */
export interface PvpBattleDto {
  id: number;
  createdAt: string;
  attacker: PvpFighterDto;
  defender: PvpFighterDto;
  /** Phía của người đang xem (luôn 'a' nếu mình là người khiêu chiến). */
  mySide: PvpSide;
  winner: PvpWinner;
  result: PvpOutcome;
  rounds: number;
  units: PvpUnitStateDto[];
  events: PvpEventDto[];
}

/** Một dòng lịch sử trận đấu. */
export interface PvpBattleSummaryDto {
  id: number;
  createdAt: string;
  /** Vai của mình trong trận: khiêu chiến hay bị khiêu chiến. */
  role: 'attack' | 'defense';
  opponent: PvpFighterDto;
  winner: PvpWinner;
  result: PvpOutcome;
  rounds: number;
  /** Lực chiến (LC) của đội mình / đội đối thủ trong trận này. */
  myLc: number;
  opponentLc: number;
}

/** Tổng quan trang Đấu trường. */
export interface PvpOverviewDto {
  me: PvpFighterDto;
  team: PvpTeamDto;
  /** true = đội hình do người chơi tự lưu; false = server tự xếp từ thẻ mạnh nhất. */
  saved: boolean;
  wins: number;
  losses: number;
  draws: number;
  maxRounds: number;
  /**
   * Chi tiết chiến đấu của từng tướng ĐANG SỞ HỮU ở cấp cao nhất (mục 6.7) — bảng chọn tướng
   * hiện chỉ số + kỹ năng chi tiết mà không phải gọi thêm API. Khoá = generalId.
   */
  ownedCombat: Record<string, PvpCombatDto>;
}

/** Xem trước đối thủ trước khi khiêu chiến. */
export interface PvpOpponentDto {
  opponent: PvpFighterDto;
  team: PvpTeamDto;
  saved: boolean;
}

/**
 * Buff có lợi mà một kỹ năng phát cho bản thân/đồng minh (SKILLS.md). Đơn vị bps: 10000 = 100%.
 * Tất cả bằng 0 = kỹ năng không buff.
 */
export interface PvpBuffDto {
  /** % sát thương cộng mỗi lớp (theo sát thương nền của chính tướng nhận). */
  damageBps: number;
  /** % HP tối đa cộng mỗi lớp (tăng trần HP và hồi đúng lượng tăng). */
  hpBps: number;
  /** Điểm chí mạng cộng mỗi lớp (bps: 500 = +5 điểm phần trăm). */
  critBps: number;
  /** % sát thương chí mạng cộng mỗi lớp (ST chí mạng nền theo cấp: cấp 1 = 130%, cấp 10 = 160%). */
  critDamageBps: number;
  /** % sát thương gánh chịu được giảm mỗi lớp. */
  takenDownBps: number;
  /** % hút máu cộng mỗi lớp (hồi bản thân theo sát thương gây ra; 2000 = +20%). */
  lifestealBps: number;
  /** % HP tối đa tạo Khiên mỗi lớp (SKILLS.md mục 16). 0 = không tạo khiên. */
  shieldBps: number;
  /** % Chính xác cộng mỗi lớp (nền theo cấp cấp 1 = 80% → cấp 10 = 100%, trần 150% — SKILLS.md mục 18). */
  hitBps: number;
  /** % Né tránh cộng mỗi lớp (nền theo cấp cấp 1 = 1% → cấp 10 = 10%, trần 50% — SKILLS.md mục 18). */
  dodgeBps: number;
  /** ĐIỂM GIÁP cộng mỗi lớp (số nguyên; `DR = Giáp / (Giáp + 100)`, trần 75% — mục 18). */
  defArmor: number;
  /** % Xuyên giáp cộng mỗi lớp: bỏ qua Phòng thủ của địch (trần 50% — mục 18). */
  defPenBps: number;
  /** Hồi máu theo lượt (HoT): mỗi lớp hồi % sát thương nền của người thi triển vào đầu mỗi lượt. 0 = không có. */
  hotBps: number;
  /**
   * % sát thương Thiêu đốt cộng thêm cho đồng minh CÓ khả năng thiêu đốt (bps; 0 = không có).
   * Lớp thiêu đốt của tướng được buff vẫn giữ nguyên cộng dồn như thường, chỉ đòn thiêu đốt
   * gây ra trong thời gian hiệu lực mạnh hơn.
   */
  burnUpBps: number;
  /** Số lượt mỗi lớp còn hiệu lực. */
  rounds: number;
  /** Số lớp cộng dồn tối đa. */
  maxLayers: number;
}

/**
 * Một kênh buff của kỹ năng: phát hiệu ứng `buff` cho phạm vi `scope` mỗi lần tướng tới lượt.
 * Một kỹ năng có thể có NHIỀU kênh (ví dụ vừa tự buff lấy mình vừa buff đồng minh cùng hàng).
 */
export interface PvpBuffEntryDto {
  scope: PvpBuffScope;
  buff: PvpBuffDto;
}

/**
 * Hiệu ứng bất lợi mà một kỹ năng áp lên mục tiêu địch (SKILLS.md). Giá trị là MỨC GIẢM (dương).
 * Tất cả bằng 0 = kỹ năng không gây hiệu ứng bất lợi.
 */
export interface PvpDebuffDto {
  /** Giảm sát thương mục tiêu gây ra (bps theo sát thương nền của mục tiêu). */
  damageDownBps: number;
  /** Giảm HP tối đa của mục tiêu (bps theo HP nền). */
  hpDownBps: number;
  /** Giảm điểm chí mạng của mục tiêu (bps: 500 = −5 điểm phần trăm). */
  critDownBps: number;
  /** Giảm % sát thương chí mạng của mục tiêu. */
  critDamageDownBps: number;
  /** Giảm % Chính xác của mục tiêu (mục 18). */
  hitDownBps: number;
  /** Giảm % Né tránh của mục tiêu (mục 18). */
  dodgeDownBps: number;
  /** Giảm GIÁP của mục tiêu (số nguyên điểm; mục 18) — sát thương nhận vào tăng lên. */
  defArmorDown: number;
  /** Giảm % Xuyên giáp của mục tiêu (mục 18). */
  defPenDownBps: number;
  /** Thiêu đốt: mỗi lượt gây thêm % sát thương cơ bản của người thi triển (bps). */
  burnBps: number;
  /** Số lượt thiêu đốt còn hiệu lực. */
  burnRounds: number;
  /** Số lớp thiêu đốt cộng dồn tối đa từ chính tướng thi triển. */
  burnMaxLayers: number;
  /** Số lượt mỗi lớp còn hiệu lực. */
  rounds: number;
  /** Số lớp cộng dồn tối đa. */
  maxLayers: number;
  /** Xóa toàn bộ hiệu ứng có lợi (lớp buff) của mục tiêu. */
  dispel: boolean;
  /** Cờ Xóa Khiên: `> 0` = kỹ năng bẻ gãy Khiên địch (SKILLS.md mục 17). */
  shieldBreakPerLevelBps: number;
  /** Tỉ lệ bẻ gãy Khiên TẠI CẤP (bps) — mọi tướng dùng chung span cấp 1 = 20% → cấp 10 = 80%; `0` = không phá Khiên. */
  shieldBreakBps: number;
  /** % Khiên hiện có bị phá mỗi lần bẻ gãy thành công (bps; 7000 = phá 70%). */
  shieldBreakRemoveBps: number;
}

/** Phản kích (SKILLS.md #12). Tất cả bằng 0 = kỹ năng không phản kích. */
export interface PvpCounterDto {
  /** Tỉ lệ phản kích mỗi cấp (bps; cấp × 5%, trần 50% ở cấp 10). */
  perLevelBps: number;
  /** Tỉ lệ phản kích TẠI CẤP, đã kẹp trần 50% (bps) — con số hiển thị trên UI. */
  chanceBps: number;
  /** % sát thương cơ bản đánh trả (bps: 10000 = 100% đòn đánh thường). */
  damageBps: number;
  /** Số lượt hiệu lực. */
  rounds: number;
  /** 'single' = đánh trả kẻ vừa gây sát thương; 'all' = đánh trả toàn bộ địch. */
  scope: 'single' | 'all';
}

/** Nội tại phản ứng khi NÉ THÀNH CÔNG (SKILLS.md mục 18). Tất cả bằng 0 = không có nội tại. */
export interface PvpDodgeReactDto {
  /** % ST cơ bản đánh trả NGAY kẻ vừa ra đòn trượt (bps; 5000 = 50%). 0 = không phản kích. */
  counterDamageBps: number;
  /** ST chí mạng cộng dồn VĨNH VIỄN mỗi lần Né thành công (bps mỗi lớp; 1000 = +10%). */
  critDamageBps: number;
  /** Số lớp cộng dồn tối đa của `critDamageBps`. */
  maxLayers: number;
}

/** Hiệu ứng nội tại tướng (SKILLS.md). */
export interface PvpPassiveEffectDto {
  stat: 'crit' | 'damage' | 'maxHp' | 'def';
  /** Với damage/maxHp: phần trăm của chỉ số nền. */
  bps: number;
  /** Với crit: điểm chí mạng cộng thẳng (bps). */
  pointsBps: number;
  /** Với def: ĐIỂM GIÁP cộng thẳng (số nguyên; mục 18). */
  armor: number;
}

/** Định nghĩa kỹ năng chiến đấu đầy đủ của một tướng (SKILLS.md). */
export interface PvpSkillDefDto {
  /** Nhóm kỹ năng — chỉ dùng phân loại/nhãn dự phòng trên UI. */
  skill: PvpSkill;
  targeting: PvpTargeting;
  /** Hệ số sát thương theo damage cơ bản (bps). 0 = không gây sát thương. */
  damageBps: number;
  /** Hệ số hồi máu cho đồng minh theo damage cơ bản của người thi triển (bps). 0 = không hồi. */
  healBps: number;
  /** Hồi máu cho bản thân theo HP tối đa (bps). 0 = không tự hồi. */
  selfHealBps: number;
  stun: 'none' | 'single' | 'row';
  /** Tỉ lệ choáng mỗi cấp (bps; 0 = kỹ năng không choáng). Trần = perLevel × MAX_LEVEL. */
  stunPerLevelBps: number;
  /** Kỹ năng có kiểm tra giải choáng cho đồng minh. */
  cleanse: boolean;
  /** Kỹ năng thanh tẩy hiệu ứng bất lợi cho đồng minh (trừ choáng và thiêu đốt). */
  purify: boolean;
  /** Xóa hiệu ứng có lợi (lớp buff) của đối thủ. */
  dispel: boolean;
  /** Tỉ lệ xóa hiệu ứng có lợi của địch tại cấp (bps) — cấp × 7.5%, cấp 10 = 75% (mục 14). */
  dispelBps: number;
  /** Các kênh buff tăng sức mạnh phát mỗi lần tướng tới lượt (rỗng = không buff). */
  buffs: PvpBuffEntryDto[];
  /** Hiệu ứng bất lợi áp lên địch (rỗng = không có). */
  debuff: PvpDebuffDto;
  /** Phản kích của bản thân khi gánh chịu sát thương (rỗng = không phản kích). */
  counter: PvpCounterDto;
  /** Nội tại phản ứng khi Né thành công (Triệu Vân phản kích / Mã Siêu tích lũy ST chí mạng). */
  dodgeReact?: PvpDodgeReactDto;
  /**
   * Ngưỡng HP mục tiêu (bps của HP tối đa) mà từ đó kỹ năng CHẮC CHẮN TRÚNG — bỏ qua hẳn bước roll
   * Trúng/Trượt (Hoàng Trung). 0 = không có.
   */
  guaranteedHitBelowHpBps: number;
  /** Kỹ năng có Hồi sinh: máu về 0 lần đầu thì không gục mà hồi lại rồi giảm sát thương (mục 1.14). */
  revive: boolean;
  /** Hồi sinh: % HP tối đa được hồi lại TẠI CẤP (bps; cấp × 5%, trần 100%) — con số hiển thị trên UI. */
  reviveHpBps: number;
  /** Cộng thêm % sát thương kỹ năng khi đánh trúng mục tiêu đang chịu hiệu ứng bất lợi (mục 1.17). */
  vsDebuffBonusBps: number;
  /** Kỹ năng tự gây thiêu đốt lên bản thân (Khổ nhục kế — Hoàng Cái). */
  selfBurn: boolean;
  /** Số lượt tự thiêu đốt. */
  selfBurnRounds: number;
  /** Hệ số nhân tỷ lệ chí mạng & ST chí mạng riêng cho đòn thiêu đốt (bps; 10000 = không đổi). */
  burnCritMulBps: number;
  /** Hút máu cả từ sát thương thiêu đốt gây ra (không chỉ đòn đánh trực tiếp). */
  burnLifesteal: boolean;
  /** Cộng thêm % ST chí mạng khi đánh trúng mục tiêu ĐANG bị Thiêu đốt (Lăng Thống). */
  burnCritDamageBps: number;
}

/**
 * Chỉ số Nền Ra Trận của MỘT tướng trong ngữ cảnh một đội (màn chuẩn bị khiêu chiến) — SKILLS.md mục 1.
 * Là chỉ số bổ trợ cộng thẳng vào cọc Máu/Sát thương gốc, KHÔNG phải buff trong trận.
 */
export interface PvpPreBattleBonusDto {
  /** Số tướng CÙNG PHE trong đội (2–6 tướng mới có hiệu lực cổng đồng phe). */
  factionCount: number;
  /** Số lớp aura Hỗ trợ trong đội. */
  supportLayers: number;
  /** Vị trí đội hình: hàng trước (1-2-3) +% máu cơ bản bản thân (bps). */
  rowHpBps: number;
  /** Vị trí đội hình: hàng sau (4-5-6) +% sát thương cơ bản bản thân (bps). */
  rowDamageBps: number;
  /** Tấn công: +% sát thương cơ bản bản thân (bps). */
  attackDamageBps: number;
  /** Phòng thủ: +% máu cơ bản bản thân (bps). */
  defenseHpBps: number;
  /** Hỗ trợ: +% máu cơ bản toàn đội (bps). */
  supportHpBps: number;
  /** Hỗ trợ: +% sát thương cơ bản toàn đội (bps). */
  supportDamageBps: number;
  /** Cổng Đồng Phe: +% máu theo số tướng cùng phe (bps). */
  factionHpBps: number;
  /** Cổng Đồng Phe: +% sát thương theo số tướng cùng phe (bps). */
  factionDamageBps: number;
  /** Ngọc Ngũ Hành đang gắn: chỉ số cộng cho TOÀN ĐỘI (aura gốc, bps). */
  gem: PvpGemStats;
  /** Tổng % cộng vào Máu (vị trí + phong cách + cổng đồng phe + ngọc). */
  hpBps: number;
  /** Tổng % cộng vào Sát thương (vị trí + phong cách + cổng đồng phe + ngọc). */
  damageBps: number;
}

/**
 * Chi tiết chiến đấu của một tướng ở một cấp — modal xem thẻ ở Bộ sưu tập.
 * Chỉ số là CỦA RIÊNG tướng (đã gồm nội tại của tướng);
 * khi vào trận còn cộng buff theo vị trí (hàng trước/sau) và buff đồng minh phát mỗi lượt.
 */
export interface PvpCombatDto {
  generalId: string;
  level: number;
  style: PvpStyle;
  skill: PvpSkill;
  /** Tên kỹ năng thật lấy từ SKILLS.md (ví dụ "Hiệu lệnh thiên hạ"). */
  skillName: string;
  passive: PvpPassive;
  /** Chỉ số nền theo cấp — chưa tính hiệu ứng kỹ năng, nội tại, vị trí. */
  base: { maxHp: number; damage: number };
  /** Chỉ số của riêng tướng sau khi áp nội tại. */
  self: { maxHp: number; damage: number; lc: number; critBps: number; critDamageBps: number; stunBps: number; cleanseBps: number; purifyBps: number; heal: number; lifestealBps: number; teamLifestealBps: number; hitBps: number; dodgeBps: number; defArmor: number; defPenBps: number };
  passiveEffect: PvpPassiveEffectDto;
  skillDef: PvpSkillDefDto;
  /** Các kênh buff tăng sức mạnh kỹ năng phát mỗi lượt; rỗng = kỹ năng không buff. */
  buffs: PvpBuffEntryDto[];
  /** Chỉ số cộng thêm theo phong cách của chính tướng (Tấn công/Phòng thủ/Hỗ trợ). */
  styleBonus: { damageBps: number; hpBps: number };
  /** Buff theo vị trí khi vào trận. */
  rowBonus: { frontHpBps: number; backDamageBps: number };
  bpsScale: number;
  /**
   * Chỉ số Nền Ra Trận khi tướng nằm trong ngữ cảnh một đội (màn chuẩn bị khiêu chiến): HP/ST đã
   * cộng toàn bộ % nền (nội tại + phong cách + cổng đồng phe). `null`/thiếu = xem tự do (Bộ sưu tập/Lobby).
   */
  preBattle?: { maxHp: number; damage: number; bonus: PvpPreBattleBonusDto } | null;
}

