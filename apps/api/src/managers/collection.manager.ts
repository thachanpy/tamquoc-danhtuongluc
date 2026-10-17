import type { CardDto, Faction, HistoryEntryDto, Page } from '@tq/shared';
import type { GameContext } from '../context.ts';
import { searchGeneralIds } from '../utils.ts';
import { listOwnedCards as repoListOwnedCards, listUserCards, type UserCardsFilter } from '../repositories/card.repository.ts';
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

/**
 * Toàn bộ thẻ người chơi sở hữu trong một lượt (`/api/cards/all`) — mới nhất trước.
 * Client tải cả bộ sưu tập một lần thay vì lặp qua từng trang: mỗi vòng request phải chờ thêm
 * một lượt mạng, mà trình duyệt chỉ mở tối đa 6 kết nối/origin (HTTP/1.1) nên số vòng càng ít càng tốt.
 */
export function listOwnedCards(ctx: GameContext, userId: number): CardDto[] {
  return repoListOwnedCards(ctx.db, userId).map((r) => ({
    id: r.id,
    generalId: r.general_id,
    level: r.level,
    createdAt: r.created_at,
  }));
}

/** Lịch sử phân trang gộp: ledger vé, gacha, nâng cấp, tặng thẻ, giftcode (mục 6.4). */
export function listHistory(ctx: GameContext, userId: number, query: HistoryQuery): Page<HistoryEntryDto> {
  return repoListHistory(ctx.db, userId, query);
}
