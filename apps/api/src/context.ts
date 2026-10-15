import { randomInt } from 'node:crypto';
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
  features?: {
    devTopup?: boolean;
    /** Tặng thẻ (mục 5.6) — chủ dự án yêu cầu tạm tắt; bật bằng ENABLE_GIFT. */
    gift?: boolean;
  };
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
