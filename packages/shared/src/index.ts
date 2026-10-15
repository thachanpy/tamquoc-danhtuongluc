// ===== Enums (dùng const object + union type, không dùng TS enum) =====

export const FACTIONS = ['wei', 'shu', 'wu', 'qun'] as const;
export type Faction = (typeof FACTIONS)[number];

export const TICKET_TYPES = ['normal', 'shu', 'wei', 'wu', 'qun'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;

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

export interface MeDto {
  id: number;
  username: string;
  /** Quản trị viên: thấy tab Quản trị. */
  isAdmin: boolean;
  tickets: TicketsDto;
  /** Tính năng bật/tắt theo cấu hình server. */
  features: { devTopup: boolean; devTopupAmount: number };
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
  maxLevel: number;
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

// ===== JSON Schemas (Fastify validate) =====

const idempotencyKey = { type: 'string', minLength: 8, maxLength: 100, pattern: '^[A-Za-z0-9_-]+$' } as const;

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
    properties: { idempotencyKey },
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
} as const;

// ======================= Bảng xếp hạng (mục 6.6) =======================

export interface LeaderboardEntryDto {
  /** Hạng theo Lực chiến (đồng điểm => đồng hạng). null = chưa có thẻ nên chưa xếp hạng. */
  rank: number | null;
  username: string;
  power: number;
  cardCount: number;
  maxLevel: number | null;
  isMe: boolean;
}

export interface LeaderboardDto {
  metric: 'power';
  /** Điểm Lực chiến mỗi thẻ theo level (cấu hình server). */
  powerByLevel: Record<number, number>;
  /** Số hạng đầu được làm nổi bật (top 10). */
  top: number;
  /** Tối đa LEADERBOARD_SIZE người, đã sắp theo hạng. */
  items: LeaderboardEntryDto[];
  /** Hạng của người đang xem; null nếu là tài khoản quản trị (không tham gia xếp hạng). */
  me: LeaderboardEntryDto | null;
  /** Tổng số người chơi có thẻ được xếp hạng. */
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
