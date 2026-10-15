import type { CardDto, Faction, HistoryEntryDto, Page } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { searchGeneralIds } from '../utils.ts';
import { listUserCards, type UserCardsFilter } from '../repositories/card.repository.ts';
import { listHistory as repoListHistory, type HistoryQuery } from '../repositories/history.repository.ts';

/** Bộ sưu tập & lịch sử của người chơi (mục 6.3, 6.4). */

export interface CardsQuery {
  faction?: Faction;
  level?: number;
  generalId?: string;
  q?: string;
  sort?: 'newest' | 'level_desc' | 'level_asc' | 'name';
  page?: number;
  pageSize?: number;
}

export type { HistoryQuery };

export function listCards(ctx: GameContext, userId: number, query: CardsQuery): Page<CardDto> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 100;
  const filter: UserCardsFilter = {
    userId,
    faction: query.faction,
    level: query.level,
    generalId: query.generalId,
    generalIds: query.q && query.q.trim() ? searchGeneralIds(query.q) : undefined,
    sort: query.sort,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  };
  const { rows, total } = listUserCards(ctx.db, filter);
  return {
    items: rows.map((r) => ({ id: r.id, generalId: r.general_id, level: r.level, createdAt: r.created_at })),
    page,
    pageSize,
    total,
  };
}

/** Lịch sử phân trang gộp: ledger vé, gacha, nâng cấp, tặng thẻ, giftcode (mục 6.4). */
export function listHistory(ctx: GameContext, userId: number, query: HistoryQuery): Page<HistoryEntryDto> {
  return repoListHistory(ctx.db, userId, query);
}
