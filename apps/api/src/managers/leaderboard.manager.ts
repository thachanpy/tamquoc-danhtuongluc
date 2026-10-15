import type { LeaderboardDto, LeaderboardEntryDto } from '@tq/shared';
import { LEADERBOARD_POWER_BY_LEVEL, LEADERBOARD_SIZE, LEADERBOARD_TOP } from '@tq/game-config';
import type { GameContext } from '../context.ts';
import { iso } from '../utils.ts';
import { listRanked, countRanked, findRanked, type RankedRow } from '../repositories/leaderboard.repository.ts';
import { findUserRow } from '../repositories/user.repository.ts';

/**
 * Bảng xếp hạng Lực chiến (mục 6.6) — chỉ đọc, tính trực tiếp từ thẻ đang active.
 * - Lực chiến = tổng điểm theo LEADERBOARD_POWER_BY_LEVEL của các cặp (tướng, cấp) KHÁC NHAU đang có.
 * - Chỉ xếp hạng tài khoản đã duyệt, KHÔNG phải admin, và có ít nhất 1 thẻ.
 * - Đồng Lực chiến => đồng hạng (RANK). Trong cùng hạng: level cao nhất giảm dần, rồi tên A→Z.
 */

const toEntry = (r: RankedRow, meId: number): LeaderboardEntryDto => ({
  id: r.id,
  rank: r.rnk,
  username: r.username,
  displayName: r.display_name ?? r.username,
  avatar: r.avatar,
  power: r.power,
  cardCount: r.card_count,
  maxLevel: r.max_level,
  isMe: r.id === meId,
});

export function getLeaderboard(ctx: GameContext, userId: number): LeaderboardDto {
  const rows = listRanked(ctx.db, LEADERBOARD_SIZE);
  const totalRanked = countRanked(ctx.db);

  const user = findUserRow(ctx.db, userId);
  let me: LeaderboardEntryDto | null = null;
  if (user && user.is_admin === 0) {
    const mine = findRanked(ctx.db, userId);
    me = mine
      ? toEntry(mine, userId)
      : {
          id: userId,
          rank: null,
          username: user.username,
          displayName: user.display_name ?? user.username,
          avatar: user.avatar,
          power: 0,
          cardCount: 0,
          maxLevel: null,
          isMe: true,
        };
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
