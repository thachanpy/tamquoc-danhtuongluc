import type { TicketType } from '@tq/shared';
import type { DB } from '../db.ts';

/** Truy vấn bảng gacha_history (lịch sử quay thẻ). */

export function insertGacha(
  db: DB,
  p: {
    userId: number;
    ticketType: TicketType;
    generalId: string;
    cardId: number;
    cardLevel: number;
    ticketTransactionId: number;
    idempotencyKey: string;
    createdAt: string;
  },
): number {
  const r = db
    .prepare(
      `INSERT INTO gacha_history (user_id, ticket_type, general_id, card_id, card_level, ticket_transaction_id, idempotency_key, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(p.userId, p.ticketType, p.generalId, p.cardId, p.cardLevel, p.ticketTransactionId, p.idempotencyKey, p.createdAt);
  return Number(r.lastInsertRowid);
}
