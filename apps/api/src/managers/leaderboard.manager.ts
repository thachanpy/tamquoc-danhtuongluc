import type { GemElement, LeaderboardDto, LeaderboardEntryDto, PvpGemStats } from '@tq/shared';
import { LEADERBOARD_SIZE, LEADERBOARD_TOP, PVP_TEAM_SIZE, autoTeamGemElements, pvpGemTeamStats, pvpTeamLc, pvpUnitLc } from '@tq/game-config';
import type { GameContext } from '../context.ts';
import { iso } from '../utils.ts';
import {
  listBestPairsForAutoTeams,
  listEligibleUsers,
  listOwnedGems,
  listTeamGemElements,
  listValidTeams,
} from '../repositories/leaderboard.repository.ts';
import { findUserRow } from '../repositories/user.repository.ts';
import { resolveTeamGems } from './pvp.manager.ts';

/**
 * Bảng xếp hạng Lực chiến (mục 6.6) — chỉ đọc.
 * - Lực chiến = TỔNG LC của ĐỘI HÌNH đang dùng: đội đã lưu (còn hợp lệ), hoặc đội tự động
 *   (6 tướng LC cao nhất) nếu chưa lưu. Không còn tính theo số thẻ / cấp thẻ đang có.
 * - Ngọc Ngũ Hành gắn kèm đội cũng cộng vào LC — khớp `effectiveTeam` ở pvp.manager.
 * - Chỉ xếp hạng tài khoản đã duyệt, KHÔNG phải admin, và có ít nhất 1 tướng trong đội.
 * - Đồng Lực chiến => đồng hạng (RANK). Trong cùng hạng: tên A→Z.
 */

interface RankedRow {
  id: number;
  username: string;
  display_name: string | null;
  avatar: string | null;
  lc: number;
  rnk: number;
}

/** So tên không phân biệt hoa/thường — khớp COLLATE NOCASE trước đây. */
const byName = (a: string, b: string) => a.localeCompare(b, 'vi', { sensitivity: 'base' });

/** Tổng LC đội hình của mọi người chơi đủ điều kiện, khoá theo user id. */
function lcOfEveryone(ctx: GameContext): Map<number, number> {
  const out = new Map<number, number>();
  // Ngọc: loại đã gắn của đội đã lưu, và (loại, cấp) đang sở hữu để chọn Ngọc cho đội tự động.
  const teamGems = new Map<number, GemElement[]>();
  for (const r of listTeamGemElements(ctx.db)) {
    const list = teamGems.get(r.user_id);
    if (list) list.push(r.element);
    else teamGems.set(r.user_id, [r.element]);
  }
  const ownedGems = new Map<number, { element: GemElement; level: number }[]>();
  for (const r of listOwnedGems(ctx.db)) {
    const list = ownedGems.get(r.user_id);
    if (list) list.push({ element: r.element, level: r.level });
    else ownedGems.set(r.user_id, [{ element: r.element, level: r.level }]);
  }
  const gemStatsOf = (id: number, elements: GemElement[]): PvpGemStats =>
    pvpGemTeamStats(resolveTeamGems(elements, ownedGems.get(id) ?? []));

  // 1) Đội đã lưu còn hợp lệ — cộng LC từng slot kèm Ngọc đã gắn.
  const saved = new Map<number, { generalId: string; level: number }[]>();
  for (const r of listValidTeams(ctx.db)) {
    const list = saved.get(r.user_id);
    if (list) list.push({ generalId: r.general_id, level: r.level });
    else saved.set(r.user_id, [{ generalId: r.general_id, level: r.level }]);
  }
  for (const [id, units] of saved) out.set(id, pvpTeamLc(units, gemStatsOf(id, teamGems.get(id) ?? [])));

  // 2) Chưa có slot hợp lệ: dựng đội tự động = 6 tướng LC cao nhất (khớp `autoTeam` ở pvp.manager).
  const auto = new Map<number, { generalId: string; level: number }[]>();
  for (const p of listBestPairsForAutoTeams(ctx.db)) {
    const unit = { generalId: p.general_id, level: p.level };
    const list = auto.get(p.user_id);
    if (list) list.push(unit);
    else auto.set(p.user_id, [unit]);
  }
  for (const [id, pairs] of auto) {
    const gem = gemStatsOf(id, autoTeamGemElements(ownedGems.get(id) ?? []));
    pairs.sort(
      (a, b) =>
        pvpUnitLc(b.generalId, b.level, gem) - pvpUnitLc(a.generalId, a.level, gem) ||
        b.level - a.level ||
        a.generalId.localeCompare(b.generalId),
    );
    out.set(id, pvpTeamLc(pairs.slice(0, PVP_TEAM_SIZE), gem));
  }
  return out;
}

/** Xếp hạng mọi người chơi có đội hình: LC giảm dần, đồng LC đồng hạng, cùng hạng thì tên A→Z. */
function rankAll(ctx: GameContext): RankedRow[] {
  const lcByUser = lcOfEveryone(ctx);
  const rows: RankedRow[] = [];
  for (const u of listEligibleUsers(ctx.db)) {
    const lc = lcByUser.get(u.id) ?? 0;
    if (lc <= 0) continue; // chưa có tướng nào => chưa xếp hạng
    rows.push({ id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar, lc, rnk: 0 });
  }
  rows.sort((a, b) => b.lc - a.lc || byName(a.username, b.username));
  let rank = 0;
  let prev: number | null = null;
  rows.forEach((r, i) => {
    if (prev === null || r.lc !== prev) rank = i + 1;
    prev = r.lc;
    r.rnk = rank;
  });
  return rows;
}

const toEntry = (r: RankedRow, meId: number): LeaderboardEntryDto => ({
  id: r.id,
  rank: r.rnk,
  username: r.username,
  displayName: r.display_name ?? r.username,
  avatar: r.avatar,
  lc: r.lc,
  isMe: r.id === meId,
});

export function getLeaderboard(ctx: GameContext, userId: number): LeaderboardDto {
  const rows = rankAll(ctx);

  const user = findUserRow(ctx.db, userId);
  let me: LeaderboardEntryDto | null = null;
  if (user && user.is_admin === 0) {
    const mine = rows.find((r) => r.id === userId);
    me = mine
      ? toEntry(mine, userId)
      : {
          id: userId,
          rank: null,
          username: user.username,
          displayName: user.display_name ?? user.username,
          avatar: user.avatar,
          lc: 0,
          isMe: true,
        };
  }

  return {
    metric: 'lc',
    top: LEADERBOARD_TOP,
    items: rows.slice(0, LEADERBOARD_SIZE).map((r) => toEntry(r, userId)),
    me,
    totalRanked: rows.length,
    generatedAt: iso(ctx.now()),
  };
}
