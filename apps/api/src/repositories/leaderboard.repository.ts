import { LEADERBOARD_POWER_BY_LEVEL } from '@tq/game-config';
import type { DB } from '../db.ts';

/**
 * Truy vấn bảng xếp hạng Lực chiến (mục 6.6) — tính trực tiếp từ thẻ đang active.
 * Lực chiến = tổng điểm theo LEADERBOARD_POWER_BY_LEVEL của các cặp (tướng, cấp) KHÁC NHAU đang có.
 */

export interface RankedRow {
  id: number;
  username: string;
  display_name: string | null;
  avatar: string | null;
  power: number;
  card_count: number;
  max_level: number;
  rnk: number;
}

/** CASE level WHEN 1 THEN 1 ... — điểm lấy từ cấu hình (số nguyên đã validate), không nhận dữ liệu client. */
const POWER_CASE = `CASE c.level ${Object.entries(LEADERBOARD_POWER_BY_LEVEL)
  .map(([lv, p]) => `WHEN ${Number(lv)} THEN ${Number(p)}`)
  .join(' ')} ELSE 0 END`;

const RANKED = `WITH g AS (
    SELECT c.user_id, c.general_id, c.level, COUNT(*) AS n
      FROM user_cards c WHERE c.status = 'active'
     GROUP BY c.user_id, c.general_id, c.level
  ), s AS (
    SELECT u.id, u.username, u.display_name, u.avatar, SUM(${POWER_CASE}) AS power, SUM(c.n) AS card_count, MAX(c.level) AS max_level
      FROM users u JOIN g c ON c.user_id = u.id
     WHERE u.status = 'approved' AND u.is_admin = 0
     GROUP BY u.id
  ), r AS (
    SELECT s.*, RANK() OVER (ORDER BY power DESC) AS rnk FROM s
  )`;
const ORDER = 'ORDER BY rnk ASC, max_level DESC, username COLLATE NOCASE ASC';

export function listRanked(db: DB, limit: number): RankedRow[] {
  return db.prepare(`${RANKED} SELECT * FROM r ${ORDER} LIMIT ?`).all(limit) as unknown as RankedRow[];
}

export function countRanked(db: DB): number {
  return (db.prepare(`${RANKED} SELECT COUNT(*) AS n FROM r`).get() as { n: number }).n;
}

export function findRanked(db: DB, userId: number): RankedRow | undefined {
  return db.prepare(`${RANKED} SELECT * FROM r WHERE id = ?`).get(userId) as RankedRow | undefined;
}
