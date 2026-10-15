import type { DB } from '../db.ts';

/** Truy vấn bảng card_gifts (lịch sử tặng thẻ). */

export function insertGift(
  db: DB,
  p: {
    fromUserId: number;
    toUserId: number;
    cardsSnapshot: string;
    cardCount: number;
    idempotencyKey: string;
    createdAt: string;
  },
): number {
  const r = db
    .prepare(
      `INSERT INTO card_gifts (from_user_id, to_user_id, cards_snapshot, card_count, idempotency_key, created_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .run(p.fromUserId, p.toUserId, p.cardsSnapshot, p.cardCount, p.idempotencyKey, p.createdAt);
  return Number(r.lastInsertRowid);
}

/**
 * Danh sách người nhận cho dropdown tặng thẻ: mọi người chơi trừ chính mình.
 * Sắp xếp: người có giao dịch tặng/nhận thẻ với mình gần nhất lên đầu; người chưa từng giao dịch xếp sau theo tên A→Z.
 */
export function listGiftRecipients(
  db: DB,
  userId: number,
  needleLike: string,
  limit: number,
): { username: string; last_gift_at: string | null }[] {
  return db
    .prepare(
      `SELECT u.username,
              (SELECT MAX(g.created_at) FROM card_gifts g
                WHERE (g.from_user_id = $me AND g.to_user_id = u.id) OR (g.from_user_id = u.id AND g.to_user_id = $me)) AS last_gift_at
         FROM users u
        WHERE u.id <> $me AND u.status = 'approved' AND u.is_admin = 0 AND u.username LIKE $q ESCAPE '\\'
        ORDER BY last_gift_at IS NULL, last_gift_at DESC, u.username COLLATE NOCASE ASC
        LIMIT $limit`,
    )
    .all({ me: userId, q: needleLike, limit }) as { username: string; last_gift_at: string | null }[];
}
