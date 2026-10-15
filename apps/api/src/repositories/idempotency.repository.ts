import type { DB } from '../db.ts';
import { AppError } from '../context.ts';

/**
 * Idempotency keys: mỗi (user, action, key) lưu request hash + response JSON.
 * Retry cùng request => trả lại đúng response đã lưu; cùng key nhưng request khác => 409.
 */

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
