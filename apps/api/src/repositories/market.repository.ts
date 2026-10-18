import type { Faction } from '@tq/shared';
import type { DB } from '../db.ts';

/** Truy vấn bảng market_listings (Chợ thẻ tướng). */

export type MarketStatus = 'active' | 'sold' | 'cancelled';

export interface MarketListingRow {
  id: number;
  seller_id: number;
  general_id: string;
  level: number;
  price: number;
  status: MarketStatus;
  buyer_id: number | null;
  created_at: string;
  sold_at: string | null;
  cancelled_at: string | null;
}

/** Dòng đọc cho UI: kèm tên hiển thị của người bán / người mua. */
export interface MarketListingView extends MarketListingRow {
  seller_name: string;
  buyer_name: string | null;
}

/**
 * Câu SELECT dùng chung: nối tên người bán (bắt buộc) và người mua (chỉ có khi đã bán).
 * Tên hiển thị = display_name, chưa đổi thì lấy tên đăng nhập.
 */
const VIEW_SELECT = `
  SELECT m.id, m.seller_id, m.general_id, m.level, m.price, m.status, m.buyer_id,
         m.created_at, m.sold_at, m.cancelled_at,
         COALESCE(s.display_name, s.username) AS seller_name,
         COALESCE(b.display_name, b.username) AS buyer_name
  FROM market_listings m
  JOIN users s ON s.id = m.seller_id
  LEFT JOIN users b ON b.id = m.buyer_id`;

/** Tạo tin đăng bán mới (trạng thái 'active'). Trả về id tin. */
export function insertListing(
  db: DB,
  p: { sellerId: number; generalId: string; level: number; price: number; idempotencyKey: string; nowIso: string },
): number {
  const r = db
    .prepare(
      `INSERT INTO market_listings (seller_id, general_id, level, price, status, idempotency_key, created_at, updated_at)
       VALUES (?,?,?,?,'active',?,?,?)`,
    )
    .run(p.sellerId, p.generalId, p.level, p.price, p.idempotencyKey, p.nowIso, p.nowIso);
  return Number(r.lastInsertRowid);
}

export function findListingView(db: DB, id: number): MarketListingView | undefined {
  return db.prepare(`${VIEW_SELECT} WHERE m.id = ?`).get(id) as MarketListingView | undefined;
}

/** Số tin đang bán (active) của một người chơi — chặn spam chợ. */
export function countActiveListings(db: DB, sellerId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM market_listings WHERE seller_id = ? AND status = 'active'").get(sellerId) as {
    n: number;
  }).n;
}

export interface MarketBrowseFilter {
  faction?: Faction;
  level?: number;
  /** Danh sách id tướng khớp tìm kiếm tên; [] = không khớp tướng nào. */
  generalIds?: string[];
  /** Bỏ qua tin của người chơi này (ẩn tin của chính mình). */
  excludeSellerId?: number;
  sort?: 'newest' | 'level_desc' | 'level_asc' | 'name';
  limit: number;
  offset: number;
}

/** Duyệt chợ: các tin đang bán, kèm bộ lọc + sắp xếp. */
export function listActiveListings(
  db: DB,
  f: MarketBrowseFilter,
): { rows: MarketListingView[]; total: number } {
  const where = ["m.status = 'active'"];
  const params: (string | number)[] = [];
  const joinGeneral = f.faction !== undefined || f.generalIds !== undefined;
  if (f.faction) {
    where.push('g.faction = ?');
    params.push(f.faction);
  }
  if (f.level) {
    where.push('m.level = ?');
    params.push(f.level);
  }
  if (f.generalIds !== undefined) {
    if (f.generalIds.length === 0) return { rows: [], total: 0 };
    where.push(`m.general_id IN (${f.generalIds.map(() => '?').join(',')})`);
    params.push(...f.generalIds);
  }
  if (f.excludeSellerId !== undefined) {
    where.push('m.seller_id <> ?');
    params.push(f.excludeSellerId);
  }
  // Chỉ nối generals khi cần lọc theo phe/tên; ORDER BY theo tên vẫn cần bảng này nên join luôn.
  const generalJoin = joinGeneral || f.sort === 'name' ? ' JOIN generals g ON g.id = m.general_id' : '';
  const order =
    f.sort === 'level_desc'
      ? 'm.level DESC, m.id DESC'
      : f.sort === 'level_asc'
        ? 'm.level ASC, m.id DESC'
        : f.sort === 'name'
          ? 'g.name ASC, m.level DESC, m.id DESC'
          : 'm.id DESC';
  const from = `${VIEW_SELECT}${generalJoin} WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM market_listings m${generalJoin} WHERE ${where.join(' AND ')}`).get(...params) as {
    n: number;
  }).n;
  const rows = db
    .prepare(`${from} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, f.limit, f.offset) as unknown as MarketListingView[];
  return { rows, total };
}

/** Tin đăng bán của chính mình, lọc theo trạng thái (bỏ trống = tất cả). */
export function listSellerListings(
  db: DB,
  sellerId: number,
  status: MarketStatus | undefined,
  limit: number,
  offset: number,
): { rows: MarketListingView[]; total: number } {
  const where = ['m.seller_id = ?'];
  const params: (string | number)[] = [sellerId];
  if (status) {
    where.push('m.status = ?');
    params.push(status);
  }
  const w = where.join(' AND ');
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM market_listings m WHERE ${w}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`${VIEW_SELECT} WHERE ${w} ORDER BY m.id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as unknown as MarketListingView[];
  return { rows, total };
}

/**
 * Lịch sử mua/bán (chỉ tin đã bán): người chơi là người bán HOẶC người mua, mới nhất trước.
 * Sắp theo thời điểm bán (`sold_at`) để trộn đúng 2 vai vào cùng một dòng thời gian.
 */
export function listMarketHistory(
  db: DB,
  userId: number,
  limit: number,
  offset: number,
): { rows: MarketListingView[]; total: number } {
  const w = "m.status = 'sold' AND (m.seller_id = ? OR m.buyer_id = ?)";
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM market_listings m WHERE ${w}`).get(userId, userId) as { n: number }).n;
  const rows = db
    .prepare(`${VIEW_SELECT} WHERE ${w} ORDER BY m.sold_at DESC, m.id DESC LIMIT ? OFFSET ?`)
    .all(userId, userId, limit, offset) as unknown as MarketListingView[];
  return { rows, total };
}

/** Đánh dấu đã bán (có điều kiện: chỉ tin đang active). Trả về số dòng đổi được. */
export function markListingSold(db: DB, id: number, buyerId: number, nowIso: string): number {
  return Number(
    db
      .prepare(
        `UPDATE market_listings SET status = 'sold', buyer_id = ?, sold_at = ?, updated_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(buyerId, nowIso, nowIso, id).changes,
  );
}

/** Người bán huỷ tin (có điều kiện: đúng chủ và đang active). Trả về số dòng đổi được. */
export function markListingCancelled(db: DB, id: number, sellerId: number, nowIso: string): number {
  return Number(
    db
      .prepare(
        `UPDATE market_listings SET status = 'cancelled', cancelled_at = ?, updated_at = ?
         WHERE id = ? AND seller_id = ? AND status = 'active'`,
      )
      .run(nowIso, nowIso, id, sellerId).changes,
  );
}
