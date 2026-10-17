import { createClient, type RedisClientType } from 'redis';

/**
 * Lớp đệm cache cho API (Redis/Dragonfly) — giảm tải truy vấn nặng cho SQLite.
 * - Mặc định dùng Redis ở `REDIS_URL` (không đặt thì `redis://127.0.0.1:6379`); đặt `REDIS_URL=off` để tắt hẳn.
 * - Kết nối lỗi => noop (đọc thẳng DB như trước).
 * - MỌI lỗi Redis đều bị nuốt: cache hỏng không được làm hỏng request (đọc coi như trượt, ghi bỏ qua).
 * - Giá trị lưu dạng JSON; mọi key đều có TTL nên dữ liệu cũ tự hết hạn kể cả khi quên xoá.
 */

export interface CacheStore {
  /** false = noop (không có Redis) — dùng để log/kiểm tra. */
  readonly enabled: boolean;
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  /** Xoá best-effort ĐÚNG các key này. Không await — gọi được ở đường ghi trong transaction. */
  del(keys: string[]): void;
  /** Xoá best-effort mọi key khớp tiền tố. Không await — gọi được ở đường ghi trong transaction. */
  drop(prefixes: string[]): void;
  /** Đọc qua cache: có sẵn thì trả về; chưa có thì gọi `load` rồi lưu với TTL. */
  readThrough<T>(key: string, ttlSeconds: number, load: () => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Tiền tố key (namespace `tq:` tránh đụng dữ liệu khác trên cùng Redis). */
export const PREFIX = {
  /** Bảng xếp hạng Lực chiến — một key chung cho toàn hệ thống. */
  leaderboard: 'tq:lb',
  /** Hồ sơ + cờ admin của một người chơi. */
  user: (userId: number) => `tq:usr:${userId}`,
  /** Phiên đăng nhập theo hash token. */
  session: (tokenHash: string) => `tq:sess:${tokenHash}`,
  /** Cài đặt game (bảng app_settings). */
  settings: 'tq:set',
  /** Bộ sưu tập của một người chơi (thẻ hoặc Ngọc) theo tham số truy vấn. */
  collection: (userId: number, kind: string, query = '') => `tq:col:${userId}:${kind}:${query}`,
  /** Đội hình PvP + chỉ số của một người chơi. */
  pvp: (userId: number) => `tq:pvp:${userId}`,
  /** Nhiệm vụ/thành tựu của một người chơi (truy vấn tổng hợp nặng). */
  quests: (userId: number) => `tq:qst:${userId}`,
  /** Lịch sử phân trang của một người chơi (gộp nhiều bảng) theo tham số truy vấn. */
  history: (userId: number, query = '') => `tq:his:${userId}:${query}`,
  /** Nhật ký trận PvP phân trang của một người chơi; chi tiết một trận dùng thêm khoá phụ `id=<id>`. */
  battles: (userId: number, query = '') => `tq:btl:${userId}:${query}`,
  /** Đội hình của một người chơi khi người khác xem trước khi khiêu chiến (không phụ thuộc người xem). */
  opponent: (userId: number) => `tq:opp:${userId}`,
  /** Chỉ số chiến đấu của một tướng theo (cấp, đội, Ngọc) — client gọi theo lô cho cả 2 đội. */
  combat: (userId: number, query = '') => `tq:cbt:${userId}:${query}`,
  /** Danh sách ở trang Quản trị (mọi phân trang/lọc). */
  admin: (kind: string, query = '') => `tq:adm:${kind}:${query}`,
} as const;

/** Key dùng khi xoá cache: `del` cần key đúng, `drop` cần tiền tố (khớp cả key con). */
export const DROP = {
  leaderboard: 'tq:lb',
  user: (userId: number) => `tq:usr:${userId}`,
  session: (tokenHash: string) => `tq:sess:${tokenHash}`,
  settings: 'tq:set',
  pvp: (userId: number) => `tq:pvp:${userId}`,
  quests: (userId: number) => `tq:qst:${userId}`,
  opponent: (userId: number) => `tq:opp:${userId}`,
  collection: (userId: number) => `tq:col:${userId}:`,
  history: (userId: number) => `tq:his:${userId}:`,
  battles: (userId: number) => `tq:btl:${userId}:`,
  combat: (userId: number) => `tq:cbt:${userId}:`,
  admin: 'tq:adm:',
} as const;

/** Thời gian sống của từng nhóm cache (giây). Ngắn cho dữ liệu hay đổi, dài cho dữ liệu ít đổi. */
export const TTL = {
  leaderboard: 5 * 60,
  user: 60,
  session: 60,
  settings: 5 * 60,
  collection: 30,
  pvp: 30,
  quests: 15,
  history: 30,
  battles: 15,
  battleDetail: 7 * 24 * 60 * 60,
  opponent: 30,
  combat: 60,
  admin: 15,
} as const;

/** Khoá phụ từ tham số truy vấn — sắp xếp theo tên để cùng truy vấn luôn ra cùng khoá. */
export function queryKey(query: object): string {
  const record = query as Record<string, unknown>;
  return Object.keys(record)
    .filter((k) => record[k] !== undefined)
    .sort()
    .map((k) => `${k}=${String(record[k])}`)
    .join('&');
}

/**
 * Xoá cache phụ thuộc dữ liệu của người chơi: BXH, hồ sơ/cờ admin, bộ sưu tập, đội hình, nhiệm vụ,
 * lịch sử, nhật ký trận, đội hình khi người khác xem và danh sách Quản trị (có số thẻ/vé).
 * Gọi ở mọi đường ghi.
 *
 * Key đúng được xoá bằng `del` (1 lệnh DEL), key con (theo trang/lọc) xoá theo tiền tố bằng `drop`
 * (`SCAN`) — chỉ dùng `SCAN` cho những nhóm thật sự có nhiều key con.
 */
export function invalidatePlayers(cache: CacheStore, ...userIds: number[]): void {
  cache.del([
    DROP.leaderboard,
    ...userIds.flatMap((id) => [DROP.user(id), DROP.pvp(id), DROP.quests(id), DROP.opponent(id)]),
  ]);
  cache.drop([
    DROP.admin,
    ...userIds.flatMap((id) => [DROP.collection(id), DROP.history(id), DROP.battles(id), DROP.combat(id)]),
  ]);
}

/** Cache rỗng — mọi lượt đọc đều đi thẳng vào DB. */
export function createNoopCache(): CacheStore {
  return {
    enabled: false,
    get: async () => null,
    set: async () => {},
    del: () => {},
    drop: () => {},
    readThrough: async (_key, _ttl, load) => load(),
    close: async () => {},
  };
}

/**
 * Kết nối Redis theo URL. Không kết nối được (chưa bật Redis, sai URL, timeout) => trả noop
 * để API vẫn chạy bình thường; lỗi sau đó chỉ được log, không ném ra ngoài.
 */
export async function createRedisCache(url: string, onError?: (err: unknown) => void): Promise<CacheStore> {
  const client: RedisClientType = createClient({
    url,
    socket: {
      connectTimeout: 3_000,
      // Thử lại vài lần rồi dừng hẳn (tránh log spam khi Redis tắt lâu dài).
      reconnectStrategy: (retries) => (retries > 5 ? false : Math.min(retries * 200, 2_000)),
    },
  });
  client.on('error', (err) => onError?.(err));
  try {
    await client.connect();
  } catch (err) {
    onError?.(err);
    client.destroy();
    return createNoopCache();
  }

  const usable = () => client.isReady;
  // Mọi thao tác bọc try/catch: Redis trục trặc => coi như trượt cache, không làm hỏng request.
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    if (!usable()) return fallback;
    try {
      return await fn();
    } catch (err) {
      onError?.(err);
      return fallback;
    }
  };

  return {
    enabled: true,
    get: <T>(key: string) =>
      safe<T | null>(async () => {
        const raw = await client.get(key);
        return raw === null ? null : (JSON.parse(raw) as T);
      }, null),
    set: async (key, value, ttlSeconds) => {
      await safe(async () => {
        await client.set(key, JSON.stringify(value), { expiration: { type: 'EX', value: ttlSeconds } });
      }, undefined);
    },
    del: (keys) => {
      if (!keys.length) return;
      // Không await: giống `drop`, chỉ cần xoá best-effort.
      void safe(async () => {
        await client.del(keys);
      }, undefined);
    },
    drop: (prefixes) => {
      // Cố ý không await: đường ghi nằm trong transaction đồng bộ nên chỉ cần xoá best-effort.
      void (async () => {
        for (const prefix of prefixes) {
          await safe(async () => {
            for await (const keys of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 200 })) {
              if (keys.length > 0) await client.del(keys);
            }
          }, undefined);
        }
      })();
    },
    readThrough: async <T>(key: string, ttlSeconds: number, load: () => T | Promise<T>): Promise<T> => {
      const cached = await safe<T | null>(async () => {
        const raw = await client.get(key);
        return raw === null ? null : (JSON.parse(raw) as T);
      }, null);
      if (cached !== null) return cached;
      const value = await load();
      await safe(async () => {
        await client.set(key, JSON.stringify(value), { expiration: { type: 'EX', value: ttlSeconds } });
      }, undefined);
      return value;
    },
    close: async () => {
      try {
        await client.close();
      } catch {
        client.destroy();
      }
    },
  };
}

/** URL Redis mặc định khi không đặt `REDIS_URL` (Redis/Dragonfly trên cùng máy). */
export const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6379';

/** Giá trị `REDIS_URL` để tắt hẳn cache (đặt rỗng cũng tắt). */
const CACHE_OFF = new Set(['off', '0', 'false', 'none']);

/**
 * Chọn URL Redis từ biến môi trường.
 * - Chưa đặt `REDIS_URL` => dùng `DEFAULT_REDIS_URL`.
 * - Đặt rỗng/`off`/`0`/`false`/`none` => null (tắt cache).
 */
export function resolveRedisUrl(raw = process.env.REDIS_URL): string | null {
  if (raw === undefined) return DEFAULT_REDIS_URL;
  const value = raw.trim();
  if (value === '' || CACHE_OFF.has(value.toLowerCase())) return null;
  return value;
}

/** Chọn cache theo biến môi trường REDIS_URL (tắt cache => noop; lỗi kết nối => noop). */
export async function createCacheFromEnv(onError?: (err: unknown) => void): Promise<CacheStore> {
  const url = resolveRedisUrl();
  if (!url) return createNoopCache();
  return createRedisCache(url, onError);
}
