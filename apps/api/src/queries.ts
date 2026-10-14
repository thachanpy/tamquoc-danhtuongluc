import type { CardDto, GiftCardSnapshot, Faction, HistoryEntryDto, Page, TicketReason, TicketType, UpgradeOutcome, WeightEntry } from '@tq/shared';
import { ROSTER } from '@tq/game-config';
import type { GameContext } from './context.ts';

/** Bỏ dấu tiếng Việt để tìm kiếm tên không phân biệt dấu/hoa thường. */
export function foldVi(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

export interface CardsQuery {
  faction?: Faction;
  level?: number;
  generalId?: string;
  q?: string;
  sort?: 'newest' | 'level_desc' | 'level_asc' | 'name';
  page?: number;
  pageSize?: number;
}

export function listCards(ctx: GameContext, userId: number, query: CardsQuery): Page<CardDto> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 100;
  const where = ["c.user_id = ?", "c.status = 'active'"];
  const params: (string | number)[] = [userId];
  if (query.faction) {
    where.push('g.faction = ?');
    params.push(query.faction);
  }
  if (query.level) {
    where.push('c.level = ?');
    params.push(query.level);
  }
  if (query.generalId) {
    where.push('c.general_id = ?');
    params.push(query.generalId);
  }
  if (query.q && query.q.trim()) {
    const needle = foldVi(query.q.trim());
    const ids = ROSTER.filter((g) => foldVi(g.name).includes(needle) || g.id.includes(needle)).map((g) => g.id);
    if (ids.length === 0) return { items: [], page, pageSize, total: 0 };
    where.push(`c.general_id IN (${ids.map(() => '?').join(',')})`);
    params.push(...ids);
  }
  const order =
    query.sort === 'level_desc'
      ? 'c.level DESC, c.id DESC'
      : query.sort === 'level_asc'
        ? 'c.level ASC, c.id DESC'
        : query.sort === 'name'
          ? 'g.name ASC, c.level DESC, c.id ASC'
          : 'c.id DESC';
  const from = `FROM user_cards c JOIN generals g ON g.id = c.general_id WHERE ${where.join(' AND ')}`;
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as { n: number }).n;
  const rows = ctx.db
    .prepare(`SELECT c.id, c.general_id, c.level, c.created_at ${from} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as { id: number; general_id: string; level: number; created_at: string }[];
  return {
    items: rows.map((r) => ({ id: r.id, generalId: r.general_id, level: r.level, createdAt: r.created_at })),
    page,
    pageSize,
    total,
  };
}

export interface HistoryQuery {
  kind?: 'ticket' | 'gacha' | 'upgrade' | 'gift';
  page?: number;
  pageSize?: number;
}

/** Lịch sử phân trang gộp: ledger vé, gacha, nâng cấp (mục 6.4). */
export function listHistory(ctx: GameContext, userId: number, query: HistoryQuery): Page<HistoryEntryDto> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const parts: string[] = [];
  if (!query.kind || query.kind === 'ticket') parts.push(`SELECT 'ticket' AS kind, id, created_at FROM ticket_transactions WHERE user_id = $u`);
  if (!query.kind || query.kind === 'gacha') parts.push(`SELECT 'gacha' AS kind, id, created_at FROM gacha_history WHERE user_id = $u`);
  if (!query.kind || query.kind === 'upgrade') parts.push(`SELECT 'upgrade' AS kind, id, created_at FROM upgrade_history WHERE user_id = $u`);
  if (!query.kind || query.kind === 'gift') {
    parts.push(`SELECT 'gift' AS kind, id, created_at FROM card_gifts WHERE from_user_id = $u OR to_user_id = $u`);
  }
  const union = parts.join(' UNION ALL ');
  const total = (ctx.db.prepare(`SELECT COUNT(*) AS n FROM (${union})`).get({ u: userId }) as { n: number }).n;
  const refs = ctx.db
    .prepare(`SELECT kind, id, created_at FROM (${union}) ORDER BY created_at DESC, kind, id DESC LIMIT $l OFFSET $o`)
    .all({ u: userId, l: pageSize, o: (page - 1) * pageSize }) as { kind: HistoryEntryDto['kind']; id: number }[];

  const tStmt = ctx.db.prepare('SELECT * FROM ticket_transactions WHERE id = ?');
  const gStmt = ctx.db.prepare('SELECT * FROM gacha_history WHERE id = ?');
  const uStmt = ctx.db.prepare('SELECT * FROM upgrade_history WHERE id = ?');
  const giftStmt = ctx.db.prepare(
    `SELECT g.*, uf.username AS from_name, ut.username AS to_name FROM card_gifts g
     JOIN users uf ON uf.id = g.from_user_id JOIN users ut ON ut.id = g.to_user_id WHERE g.id = ?`,
  );

  const items: HistoryEntryDto[] = refs.map((ref) => {
    if (ref.kind === 'ticket') {
      const r = tStmt.get(ref.id) as Record<string, unknown>;
      return {
        kind: 'ticket',
        id: ref.id,
        ticketType: r.ticket_type as TicketType,
        amountDelta: r.amount_delta as number,
        reason: r.reason as TicketReason,
        referenceId: (r.reference_id as string | null) ?? null,
        createdAt: r.created_at as string,
      };
    }
    if (ref.kind === 'gacha') {
      const r = gStmt.get(ref.id) as Record<string, unknown>;
      return {
        kind: 'gacha',
        id: ref.id,
        ticketType: r.ticket_type as TicketType,
        generalId: r.general_id as string,
        cardId: r.card_id as number,
        cardLevel: r.card_level as number,
        createdAt: r.created_at as string,
      };
    }
    if (ref.kind === 'gift') {
      const r = giftStmt.get(ref.id) as Record<string, unknown>;
      const sent = r.from_user_id === userId;
      return {
        kind: 'gift',
        id: ref.id,
        direction: sent ? 'sent' : 'received',
        otherUsername: (sent ? r.to_name : r.from_name) as string,
        cards: JSON.parse(r.cards_snapshot as string) as GiftCardSnapshot[],
        createdAt: r.created_at as string,
      };
    }
    const r = uStmt.get(ref.id) as Record<string, unknown>;
    const inputs = JSON.parse(r.input_card_ids_snapshot as string) as { id: number }[];
    return {
      kind: 'upgrade',
      id: ref.id,
      generalId: r.input_general_id as string,
      inputCardIds: inputs.map((c) => c.id),
      inputLevel: r.input_level as number,
      resultCardId: r.result_card_id as number,
      resultLevel: r.result_level as number,
      outcome: r.outcome as UpgradeOutcome,
      successBps: r.success_chance as number,
      failureBps: r.failure_chance as number,
      failureDistribution: JSON.parse(r.failure_distribution_snapshot as string) as WeightEntry[],
      createdAt: r.created_at as string,
    };
  });
  return { items, page, pageSize, total };
}
