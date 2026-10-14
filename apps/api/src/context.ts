import { randomInt, createHash } from 'node:crypto';
import type { RandomInt } from '@tq/game-config';
import type { DB } from './db.ts';

/** Phụ thuộc có thể thay thế khi test: database, đồng hồ server, RNG. */
export interface GameContext {
  db: DB;
  /** Thời gian server, epoch ms (UTC). */
  now: () => number;
  /** RNG phía server — số nguyên trong [0, max). */
  rand: RandomInt;
  /** Tính năng bật theo cấu hình server. Mặc định tắt. */
  features?: { devTopup?: boolean };
}

export function createContext(db: DB, features: GameContext['features'] = {}): GameContext {
  return { db, now: () => Date.now(), rand: (max) => randomInt(max), features };
}

export class AppError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const iso = (ms: number) => new Date(ms).toISOString();

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Đọc bản ghi idempotency. Nếu key đã dùng cho request khác => 409. */
export function findIdempotent<T>(
  db: DB,
  userId: number,
  action: string,
  key: string,
  requestHash: string,
): T | null {
  const row = db
    .prepare('SELECT request_hash, response_json FROM idempotency_keys WHERE user_id = ? AND action = ? AND key = ?')
    .get(userId, action, key) as { request_hash: string; response_json: string } | undefined;
  if (!row) return null;
  if (row.request_hash !== requestHash) {
    throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key đã dùng cho một yêu cầu khác.');
  }
  return JSON.parse(row.response_json) as T;
}

export function saveIdempotent(
  db: DB,
  userId: number,
  action: string,
  key: string,
  requestHash: string,
  response: unknown,
  nowIso: string,
): void {
  db.prepare(
    'INSERT INTO idempotency_keys (user_id, action, key, request_hash, response_json, created_at) VALUES (?,?,?,?,?,?)',
  ).run(userId, action, key, requestHash, JSON.stringify(response), nowIso);
}
