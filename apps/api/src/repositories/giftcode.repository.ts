import type { DB } from '../db.ts';

/** Truy vấn bảng gift_codes + gift_code_redemptions. */

export interface GiftCodeRow {
  id: number;
  code: string;
  rewards: string;
  total_cards: number;
  total_tickets: number;
  expires_at: string | null;
  is_active: number;
  featured: number;
  created_by: number | null;
  created_at: string;
}

export interface AdminGiftCodeRow extends GiftCodeRow {
  redemption_count: number;
  creator: string | null;
}

const ADMIN_SELECT = `SELECT g.*, (SELECT COUNT(*) FROM gift_code_redemptions r WHERE r.code_id = g.id) AS redemption_count,
  u.username AS creator FROM gift_codes g LEFT JOIN users u ON u.id = g.created_by`;

export function findGiftCodeByCode(db: DB, code: string): GiftCodeRow | undefined {
  return db.prepare('SELECT * FROM gift_codes WHERE code = ?').get(code) as GiftCodeRow | undefined;
}

export function findGiftCodeRewards(db: DB, id: number): { rewards: string } | undefined {
  return db.prepare('SELECT rewards FROM gift_codes WHERE id = ?').get(id) as { rewards: string } | undefined;
}

export function giftCodeExists(db: DB, code: string): boolean {
  return !!db.prepare('SELECT 1 FROM gift_codes WHERE code = ?').get(code);
}

export function hasRedemption(db: DB, codeId: number, userId: number): boolean {
  return !!db.prepare('SELECT 1 FROM gift_code_redemptions WHERE code_id = ? AND user_id = ?').get(codeId, userId);
}

export function insertRedemption(
  db: DB,
  p: { codeId: number; userId: number; ticketsSnapshot: string; createdAt: string },
): void {
  db.prepare(
    'INSERT INTO gift_code_redemptions (code_id, user_id, cards_snapshot, card_count, tickets_snapshot, created_at) VALUES (?,?,?,?,?,?)',
  ).run(p.codeId, p.userId, '[]', 0, p.ticketsSnapshot, p.createdAt);
}

/** Giftcode gợi ý (featured, đang bật) kèm trạng thái đã nhập của người chơi. */
export function listFeaturedGiftCodes(db: DB, userId: number): (GiftCodeRow & { redeemed: number })[] {
  return db
    .prepare(
      `SELECT g.*, EXISTS(SELECT 1 FROM gift_code_redemptions r WHERE r.code_id = g.id AND r.user_id = ?) AS redeemed
         FROM gift_codes g WHERE g.featured = 1 AND g.is_active = 1 ORDER BY g.id`,
    )
    .all(userId) as unknown as (GiftCodeRow & { redeemed: number })[];
}

export function listUserRedemptions(
  db: DB,
  userId: number,
): { code: string; card_count: number; tickets_snapshot: string; created_at: string }[] {
  return db
    .prepare(
      `SELECT g.code, r.card_count, r.tickets_snapshot, r.created_at FROM gift_code_redemptions r JOIN gift_codes g ON g.id = r.code_id
        WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 200`,
    )
    .all(userId) as { code: string; card_count: number; tickets_snapshot: string; created_at: string }[];
}

export function insertGiftCode(
  db: DB,
  p: {
    code: string;
    rewards: string;
    totalTickets: number;
    expiresAt: string | null;
    featured: boolean;
    createdBy: number | null;
    createdAt: string;
  },
): number {
  const r = db
    .prepare(
      `INSERT INTO gift_codes (code, rewards, total_cards, total_tickets, expires_at, is_active, featured, created_by, created_at)
       VALUES (?,?,?,?,?,1,?,?,?)`,
    )
    .run(p.code, p.rewards, 0, p.totalTickets, p.expiresAt, p.featured ? 1 : 0, p.createdBy, p.createdAt);
  return Number(r.lastInsertRowid);
}

export function setGiftCodeActive(db: DB, id: number, isActive: boolean): number {
  return Number(db.prepare('UPDATE gift_codes SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id).changes);
}

export function listAdminGiftCodes(db: DB): AdminGiftCodeRow[] {
  return db.prepare(`${ADMIN_SELECT} ORDER BY g.id DESC`).all() as unknown as AdminGiftCodeRow[];
}

export function findAdminGiftCode(db: DB, id: number): AdminGiftCodeRow | undefined {
  return db.prepare(`${ADMIN_SELECT} WHERE g.id = ?`).get(id) as AdminGiftCodeRow | undefined;
}
