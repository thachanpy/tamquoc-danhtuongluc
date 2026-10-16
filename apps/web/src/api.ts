import type {
  AppSettingsDto,
  AdminGiftCodeDto,
  GiftCodePublicDto,
  GiftCodeRedemptionDto,
  LeaderboardDto,
  QuestsDto,
  QuestClaimResultDto,
  GiftCodeReward,
  AdminApproveDto,
  AdminCardDto,
  AdminGemDto,
  AdminGrantDto,
  AdminUserDto,
  AdminUsersPage,
  RegisterResultDto,
  CardDto,
  ClaimRecoveryDto,
  DevTopupDto,
  DrawResultDto,
  GachaConfigDto,
  GemElement,
  GemMergeResultDto,
  GemsDto,
  GeneralDto,
  GiftResultDto,
  QuickGemMergeResultDto,
  HistoryEntryDto,
  MeDto,
  Page,
  ProfileDto,
  PvpBattleDto,
  PvpBattleSummaryDto,
  PvpCombatDto,
  PvpOpponentDto,
  PvpOverviewDto,
  PvpSkill,
  PvpStyle,
  PvpTeamDto,
  PvpUnitDto,
  QuickUpgradeResultDto,
  RecipientDto,
  TicketType,
  TicketsDto,
  UpgradePreviewDto,
  UpgradeResultDto,
  Faction,
} from '@tq/shared';

const TOKEN_KEY = 'tq.token';

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
let token: string | null = readToken();

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bỏ qua: trình duyệt chặn storage */
  }
}
export const hasToken = () => !!token;

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Không kết nối được máy chủ.');
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } } | null)?.error;
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? 'Lỗi không xác định.');
  }
  return data as T;
}

/** Idempotency key sinh 1 lần cho mỗi thao tác người dùng; retry dùng lại cùng key. */
export const newKey = () => crypto.randomUUID();

const qs = (o: Record<string, unknown>) =>
  new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();

export const api = {
  register: (username: string, password: string) =>
    call<RegisterResultDto>('POST', '/api/auth/register', { username, password }),
  login: (username: string, password: string) => call<{ token: string }>('POST', '/api/auth/login', { username, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  me: () => call<MeDto>('GET', '/api/me'),
  profile: () => call<ProfileDto>('GET', '/api/me/profile'),
  updateProfile: (patch: { displayName?: string; avatar?: string | null }) => call<ProfileDto>('POST', '/api/me/profile', patch),
  changePassword: (currentPassword: string, newPassword: string) =>
    call<{ ok: true }>('POST', '/api/me/password', { currentPassword, newPassword }),
  generals: () =>
    call<{ items: GeneralDto[]; styles: Record<string, PvpStyle>; skills: Record<string, PvpSkill>; skillNames: Record<string, string> }>(
      'GET',
      '/api/generals',
    ),
  cards: (q: { faction?: Faction; level?: number; q?: string; sort?: string; page?: number; pageSize?: number }) =>
    call<Page<CardDto>>('GET', '/api/cards?' + qs(q)),
  tickets: () => call<TicketsDto>('GET', '/api/tickets'),
  claimRecovery: () => call<ClaimRecoveryDto>('POST', '/api/tickets/claim-recovery'),
  devTopup: (idempotencyKey: string) => call<DevTopupDto>('POST', '/api/tickets/dev-topup', { idempotencyKey }),
  gachaConfig: () => call<GachaConfigDto>('GET', '/api/gacha/config'),
  draw: (ticketType: TicketType, count: number, idempotencyKey: string) =>
    call<DrawResultDto>('POST', '/api/gacha/draw', { ticketType, count, idempotencyKey }),
  upgradePreview: (cardIds: number[]) => call<UpgradePreviewDto>('POST', '/api/upgrades/preview', { cardIds }),
  users: (q = '') => call<{ items: RecipientDto[] }>('GET', '/api/users?' + qs({ q, limit: 500 })),
  gift: (toUsername: string, cardIds: number[], idempotencyKey: string) =>
    call<GiftResultDto>('POST', '/api/gifts', { toUsername, cardIds, idempotencyKey }),
  upgradeQuick: (idempotencyKey: string, levels: number[]) =>
    call<QuickUpgradeResultDto>('POST', '/api/upgrades/quick', { idempotencyKey, levels }),
  upgradeAttempt: (cardIds: number[], idempotencyKey: string) =>
    call<UpgradeResultDto>('POST', '/api/upgrades/attempt', { cardIds, idempotencyKey }),
  giftcodes: () =>
    call<{ featured: GiftCodePublicDto[]; redeemed: { code: string; cardCount: number; ticketCount: number; createdAt: string }[] }>('GET', '/api/giftcodes'),
  redeemGiftCode: (code: string) => call<GiftCodeRedemptionDto>('POST', '/api/giftcodes/redeem', { code }),
  admin: {
    settings: () => call<AppSettingsDto>('GET', '/api/admin/settings'),
    setSettings: (body: AppSettingsDto) => call<AppSettingsDto>('POST', '/api/admin/settings', body),
    giftcodes: () => call<{ items: AdminGiftCodeDto[] }>('GET', '/api/admin/giftcodes'),
    createGiftCode: (body: { code: string; rewards: GiftCodeReward[]; expiresAt: string | null; featured: boolean }) =>
      call<AdminGiftCodeDto>('POST', '/api/admin/giftcodes', body),
    setGiftCodeActive: (id: number, isActive: boolean) =>
      call<AdminGiftCodeDto>('POST', `/api/admin/giftcodes/${id}/active`, { isActive }),
    users: (q: { q?: string; status?: string; page?: number; pageSize?: number }) =>
      call<AdminUsersPage>('GET', '/api/admin/users?' + qs(q)),
    approve: (id: number) => call<AdminApproveDto>('POST', `/api/admin/users/${id}/approve`),
    reject: (id: number) => call<{ ok: true; username: string }>('POST', `/api/admin/users/${id}/reject`),
    setAdmin: (id: number, isAdmin: boolean) => call<AdminUserDto>('POST', `/api/admin/users/${id}/admin`, { isAdmin }),
    grant: (userId: number, ticketType: TicketType, amount: number, idempotencyKey: string) =>
      call<AdminGrantDto>('POST', '/api/admin/tickets/grant', { userId, ticketType, amount, idempotencyKey }),
    cards: (q: { userId?: number; faction?: Faction; level?: number; q?: string; sort?: string; page?: number; pageSize?: number }) =>
      call<Page<AdminCardDto>>('GET', '/api/admin/cards?' + qs(q)),
    gems: (q: { userId?: number; element?: GemElement; level?: number; sort?: string; page?: number; pageSize?: number }) =>
      call<Page<AdminGemDto>>('GET', '/api/admin/gems?' + qs(q)),
  },
  quests: () => call<QuestsDto>('GET', '/api/quests'),
  claimQuests: (keys?: string[]) => call<QuestClaimResultDto>('POST', '/api/quests/claim', keys ? { keys } : {}),
  leaderboard: () => call<LeaderboardDto>('GET', '/api/leaderboard'),
  // Ngọc Ngũ Hành — bộ sưu tập + ghép 2→1 + ghép nhanh (tab Ngọc ở Bộ sưu tập/Nâng cấp).
  gems: () => call<GemsDto>('GET', '/api/gems'),
  gemMerge: (gemIds: number[], idempotencyKey: string) =>
    call<GemMergeResultDto>('POST', '/api/gems/merge', { gemIds, idempotencyKey }),
  gemMergeQuick: (idempotencyKey: string, levels?: number[]) =>
    call<QuickGemMergeResultDto>('POST', '/api/gems/merge/quick', levels ? { idempotencyKey, levels } : { idempotencyKey }),
  // Đấu trường PvP (mục 6.7) — server mô phỏng trận, client chỉ phát lại.
  pvp: () => call<PvpOverviewDto>('GET', '/api/pvp'),
  pvpSaveTeam: (units: PvpUnitDto[], gems: GemElement[] = []) => call<PvpTeamDto>('POST', '/api/pvp/team', { units, gems }),
  pvpOpponent: (id: number) => call<PvpOpponentDto>('GET', `/api/pvp/opponent/${id}`),
  pvpChallenge: (opponentId: number) => call<PvpBattleDto>('POST', '/api/pvp/challenge', { opponentId }),
  pvpBattles: (q: { page?: number; pageSize?: number }) => call<Page<PvpBattleSummaryDto>>('GET', '/api/pvp/battles?' + qs(q)),
  pvpBattle: (id: number) => call<PvpBattleDto>('GET', `/api/pvp/battles/${id}`),
  /**
   * Kỹ năng + chỉ số chi tiết của một tướng ở một cấp (mục 6.7) — modal xem thẻ.
   * `squad` (nếu có) = danh sách generalId trong đội để server tính Chỉ số Nền Ra Trận
   * (aura Hỗ trợ + Cổng Đồng Phe) — dùng cho màn chuẩn bị khiêu chiến.
   * `gems` (nếu có) = danh sách LOẠI Ngọc đã gắn cho đội (tối đa PVP_TEAM_GEM_COUNT) để chỉ số khớp khi vào trận.
   */
  generalCombat: (generalId: string, level: number, squad?: string[], gems?: GemElement[]) =>
    call<PvpCombatDto>(
      'GET',
      `/api/pvp/generals/${encodeURIComponent(generalId)}/combat?` +
        qs({ level, squad: squad?.length ? squad.join(',') : undefined, gems: gems?.length ? gems.join(',') : undefined }),
    ),
  history: (q: { kind?: string; page?: number; pageSize?: number }) => call<Page<HistoryEntryDto>>('GET', '/api/history?' + qs(q)),
};

/** Tải toàn bộ thẻ đang sở hữu (lặp qua các trang). */
export async function fetchAllCards(): Promise<CardDto[]> {
  const out: CardDto[] = [];
  for (let page = 1; ; page++) {
    const p = await api.cards({ page, pageSize: 500, sort: 'newest' });
    out.push(...p.items);
    if (out.length >= p.total || p.items.length === 0) return out;
  }
}
