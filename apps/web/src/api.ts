import type {
  CardDto,
  ClaimRecoveryDto,
  DevTopupDto,
  DrawResultDto,
  GachaConfigDto,
  GeneralDto,
  GiftResultDto,
  HistoryEntryDto,
  MeDto,
  Page,
  QuickUpgradeResultDto,
  RecipientDto,
  TicketBalances,
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
    call<{ token: string; signupBonus: TicketBalances }>('POST', '/api/auth/register', { username, password }),
  login: (username: string, password: string) => call<{ token: string }>('POST', '/api/auth/login', { username, password }),
  logout: () => call<{ ok: true }>('POST', '/api/auth/logout'),
  me: () => call<MeDto>('GET', '/api/me'),
  generals: () => call<{ items: GeneralDto[] }>('GET', '/api/generals'),
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
  upgradeQuick: (idempotencyKey: string) => call<QuickUpgradeResultDto>('POST', '/api/upgrades/quick', { idempotencyKey }),
  upgradeAttempt: (cardIds: number[], idempotencyKey: string) =>
    call<UpgradeResultDto>('POST', '/api/upgrades/attempt', { cardIds, idempotencyKey }),
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
