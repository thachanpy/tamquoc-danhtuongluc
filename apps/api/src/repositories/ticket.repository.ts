import {
  TICKET_TYPES,
  type TicketBalances,
  type TicketReason,
  type TicketType,
} from '@tq/shared';
import { RECOVERY_INTERVAL_MS } from '@tq/game-config';
import type { DB } from '../db.ts';
import { AppError } from '../context.ts';

/** Truy vấn số dư vé, ledger vé và trạng thái hồi vé. */

const MAX_BALANCE = Number.MAX_SAFE_INTEGER;

export const floorToSlot = (ms: number) => Math.floor(ms / RECOVERY_INTERVAL_MS) * RECOVERY_INTERVAL_MS;

export const emptyBalances = (): TicketBalances =>
  Object.fromEntries(TICKET_TYPES.map((t) => [t, 0])) as TicketBalances;

export function readBalances(db: DB, userId: number): TicketBalances {
  const rows = db.prepare('SELECT ticket_type, balance FROM user_tickets WHERE user_id = ?').all(userId) as {
    ticket_type: TicketType;
    balance: number;
  }[];
  const b = emptyBalances();
  for (const r of rows) b[r.ticket_type] = r.balance;
  return b;
}

/**
 * Thay đổi số dư 1 loại vé + ghi ledger. PHẢI gọi bên trong transaction.
 * Chống số âm và overflow. Trả về id dòng ledger.
 */
export function applyTicketDelta(
  db: DB,
  userId: number,
  ticketType: TicketType,
  delta: number,
  reason: TicketReason,
  referenceId: string | null,
  idempotencyKey: string | null,
  nowIso: string,
): number {
  if (!Number.isSafeInteger(delta) || delta === 0) throw new AppError(500, 'INVALID_DELTA', 'Delta vé không hợp lệ.');
  const row = db.prepare('SELECT balance FROM user_tickets WHERE user_id = ? AND ticket_type = ?').get(userId, ticketType) as
    | { balance: number }
    | undefined;
  if (!row) throw new AppError(500, 'TICKET_ROW_MISSING', 'Thiếu dòng số dư vé.');
  const next = row.balance + delta;
  if (next < 0) throw new AppError(409, 'NO_TICKETS', 'Không đủ vé loại này.');
  if (next > MAX_BALANCE) throw new AppError(409, 'BALANCE_OVERFLOW', 'Số dư vé vượt giới hạn số học.');
  const upd = db
    .prepare('UPDATE user_tickets SET balance = ?, updated_at = ? WHERE user_id = ? AND ticket_type = ? AND balance = ?')
    .run(next, nowIso, userId, ticketType, row.balance);
  if (upd.changes !== 1) throw new AppError(409, 'CONCURRENT_UPDATE', 'Số dư vé vừa thay đổi, hãy thử lại.');
  const ins = db
    .prepare(
      `INSERT INTO ticket_transactions (user_id, ticket_type, amount_delta, reason, reference_id, idempotency_key, created_at)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(userId, ticketType, delta, reason, referenceId, idempotencyKey, nowIso);
  return Number(ins.lastInsertRowid);
}

/** Tạo 5 dòng số dư vé (mọi loại = 0) cho tài khoản mới. PHẢI gọi trong transaction. */
export function insertInitialTicketRows(db: DB, userId: number, nowIso: string): void {
  const ins = db.prepare('INSERT INTO user_tickets (user_id, ticket_type, balance, updated_at) VALUES (?,?,0,?)');
  for (const t of TICKET_TYPES) ins.run(userId, t, nowIso);
}

export function insertRecoveryState(db: DB, userId: number, lastProcessedIso: string, nowIso: string): void {
  db.prepare('INSERT INTO ticket_recovery_state (user_id, last_processed_recovery_at, updated_at) VALUES (?,?,?)').run(
    userId,
    lastProcessedIso,
    nowIso,
  );
}

export function findRecoveryState(db: DB, userId: number): { last_processed_recovery_at: string } | undefined {
  return db
    .prepare('SELECT last_processed_recovery_at FROM ticket_recovery_state WHERE user_id = ?')
    .get(userId) as { last_processed_recovery_at: string } | undefined;
}

/** Cập nhật mốc hồi có điều kiện (so sánh mốc cũ); trả về số dòng đổi được. */
export function advanceRecoveryState(db: DB, userId: number, newIso: string, prevIso: string, nowIso: string): number {
  return Number(
    db
      .prepare(
        `UPDATE ticket_recovery_state SET last_processed_recovery_at = ?, updated_at = ?
         WHERE user_id = ? AND last_processed_recovery_at = ?`,
      )
      .run(newIso, nowIso, userId, prevIso).changes,
  );
}
