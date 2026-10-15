import type {
  GiftCardSnapshot,
  HistoryEntryDto,
  Page,
  TicketReason,
  TicketType,
  UpgradeOutcome,
  WeightEntry,
} from '@tq/shared';
import type { DB } from '../db.ts';

/** Truy vấn gộp lịch sử phân trang: ledger vé, gacha, nâng cấp, tặng thẻ, giftcode (mục 6.4). */

export interface HistoryQuery {
  kind?: 'ticket' | 'gacha' | 'upgrade' | 'gift' | 'giftcode';
  page?: number;
  pageSize?: number;
}

export function listHistory(db: DB, userId: number, query: HistoryQuery): Page<HistoryEntryDto> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  const parts: string[] = [];
  if (!query.kind || query.kind === 'ticket') parts.push(`SELECT 'ticket' AS kind, id, created_at FROM ticket_transactions WHERE user_id = $u`);
  if (!query.kind || query.kind === 'gacha') parts.push(`SELECT 'gacha' AS kind, id, created_at FROM gacha_history WHERE user_id = $u`);
  if (!query.kind || query.kind === 'upgrade') parts.push(`SELECT 'upgrade' AS kind, id, created_at FROM upgrade_history WHERE user_id = $u`);
  if (!query.kind || query.kind === 'gift') {
    parts.push(`SELECT 'gift' AS kind, id, created_at FROM card_gifts WHERE from_user_id = $u OR to_user_id = $u`);
  }
  if (!query.kind || query.kind === 'giftcode') {
    parts.push(`SELECT 'giftcode' AS kind, id, created_at FROM gift_code_redemptions WHERE user_id = $u`);
  }
  const union = parts.join(' UNION ALL ');
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${union})`).get({ u: userId }) as { n: number }).n;
  const refs = db
    .prepare(`SELECT kind, id, created_at FROM (${union}) ORDER BY created_at DESC, kind, id DESC LIMIT $l OFFSET $o`)
    .all({ u: userId, l: pageSize, o: (page - 1) * pageSize }) as { kind: HistoryEntryDto['kind']; id: number }[];

  const tStmt = db.prepare('SELECT * FROM ticket_transactions WHERE id = ?');
  const gStmt = db.prepare('SELECT * FROM gacha_history WHERE id = ?');
  const uStmt = db.prepare('SELECT * FROM upgrade_history WHERE id = ?');
  const giftStmt = db.prepare(
    `SELECT g.*, uf.username AS from_name, ut.username AS to_name FROM card_gifts g
     JOIN users uf ON uf.id = g.from_user_id JOIN users ut ON ut.id = g.to_user_id WHERE g.id = ?`,
  );

  const gcStmt = db.prepare(
    'SELECT r.*, g.code FROM gift_code_redemptions r JOIN gift_codes g ON g.id = r.code_id WHERE r.id = ?',
  );

  const items: HistoryEntryDto[] = refs.map((ref) => {
    if (ref.kind === 'giftcode') {
      const r = gcStmt.get(ref.id) as Record<string, unknown>;
      return {
        kind: 'giftcode',
        id: ref.id,
        code: r.code as string,
        cards: JSON.parse(r.cards_snapshot as string) as GiftCardSnapshot[],
        tickets: JSON.parse((r.tickets_snapshot as string) ?? '[]') as { pool: TicketType; count: number }[],
        createdAt: r.created_at as string,
      };
    }
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
