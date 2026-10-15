import type { LeaderboardDto, LeaderboardEntryDto } from '@tq/shared';
import { LEADERBOARD_POWER_BY_LEVEL, LEADERBOARD_SIZE, LEADERBOARD_TOP } from '@tq/game-config';
import { iso, type GameContext } from './context.ts';

/**
 * Bảng xếp hạng Lực chiến (mục 6.6) — chỉ đọc, tính trực tiếp từ thẻ đang active.
 * - Lực chiến = tổng điểm theo LEADERBOARD_POWER_BY_LEVEL (Lv.n = 2^(n-1)) của các cặp (tướng, cấp) KHÁC NHAU đang có:
 *   mỗi tướng + cấp chỉ tính 1 lần (chủ dự án yêu cầu) — VD 5 thẻ Tào Tháo Lv.5 tính 1 lần,
 *   nhưng Tào Tháo Lv.5 và Lưu Bị Lv.5 tính riêng. Số thẻ (cardCount) vẫn là tổng thẻ đang có.
 * - Chỉ xếp hạng tài khoản đã duyệt, KHÔNG phải admin, và có ít nhất 1 thẻ.
 * - Đồng Lực chiến => đồng hạng (RANK). Trong cùng hạng: level cao nhất giảm dần, rồi tên A→Z.
 */

/** CASE level WHEN 1 THEN 1 ... — điểm lấy từ cấu hình (số nguyên đã validate), không nhận dữ liệu client. */
const POWER_CASE = `CASE c.level ${Object.entries(LEADERBOARD_POWER_BY_LEVEL)
  .map(([lv, p]) => `WHEN ${Number(lv)} THEN ${Number(p)}`)
  .join(' ')} ELSE 0 END`;

const RANKED = `WITH g AS (
    SELECT c.user_id, c.general_id, c.level, COUNT(*) AS n
      FROM user_cards c WHERE c.status = 'active'
     GROUP BY c.user_id, c.general_id, c.level
  ), s AS (
    SELECT u.id, u.username, SUM(${POWER_CASE}) AS power, SUM(c.n) AS card_count, MAX(c.level) AS max_level
      FROM users u JOIN g c ON c.user_id = u.id
     WHERE u.status = 'approved' AND u.is_admin = 0
     GROUP BY u.id
  ), r AS (
    SELECT s.*, RANK() OVER (ORDER BY power DESC) AS rnk FROM s
  )`;
const ORDER = 'ORDER BY rnk ASC, max_level DESC, username COLLATE NOCASE ASC';

interface Row {
  id: number;
  username: string;
  power: number;
  card_count: number;
  max_level: number;
  rnk: number;
}

const toEntry = (r: Row, meId: number): LeaderboardEntryDto => ({
  rank: r.rnk,
  username: r.username,
  power: r.power,
  cardCount: r.card_count,
  maxLevel: r.max_level,
  isMe: r.id === meId,
});

export function getLeaderboard(ctx: GameContext, userId: number): LeaderboardDto {
  const rows = ctx.db.prepare(`${RANKED} SELECT * FROM r ${ORDER} LIMIT ?`).all(LEADERBOARD_SIZE) as unknown as Row[];
  const totalRanked = (ctx.db.prepare(`${RANKED} SELECT COUNT(*) AS n FROM r`).get() as { n: number }).n;

  const user = ctx.db.prepare('SELECT username, is_admin FROM users WHERE id = ?').get(userId) as
    | { username: string; is_admin: number }
    | undefined;
  let me: LeaderboardEntryDto | null = null;
  if (user && user.is_admin === 0) {
    const mine = ctx.db.prepare(`${RANKED} SELECT * FROM r WHERE id = ?`).get(userId) as Row | undefined;
    me = mine
      ? toEntry(mine, userId)
      : { rank: null, username: user.username, power: 0, cardCount: 0, maxLevel: null, isMe: true };
  }

  return {
    metric: 'power',
    powerByLevel: { ...LEADERBOARD_POWER_BY_LEVEL },
    top: LEADERBOARD_TOP,
    items: rows.map((r) => toEntry(r, userId)),
    me,
    totalRanked,
    generatedAt: iso(ctx.now()),
  };
}
