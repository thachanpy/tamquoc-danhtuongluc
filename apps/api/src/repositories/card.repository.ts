import type { Faction } from '@tq/shared';
import type { DB } from '../db.ts';

/** Truy vấn bảng user_cards (thẻ người chơi sở hữu). */

export interface CardRow {
  id: number;
  user_id: number;
  general_id: string;
  level: number;
  status: string;
}

const marks = (ids: number[]) => ids.map(() => '?').join(',');

export function insertCard(db: DB, userId: number, generalId: string, level: number, nowIso: string): number {
  const r = db
    .prepare('INSERT INTO user_cards (user_id, general_id, level, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(userId, generalId, level, nowIso, nowIso);
  return Number(r.lastInsertRowid);
}

export function findCardsByIds(db: DB, ids: number[]): CardRow[] {
  return db
    .prepare(`SELECT id, user_id, general_id, level, status FROM user_cards WHERE id IN (${marks(ids)})`)
    .all(...ids) as unknown as CardRow[];
}

/** Tiêu thụ có điều kiện: chỉ thẻ còn active của chính người chơi. Trả về số dòng đổi được. */
export function consumeActiveCards(db: DB, ids: number[], userId: number, nowIso: string): number {
  return Number(
    db
      .prepare(
        `UPDATE user_cards SET status = 'consumed', consumed_at = ?, updated_at = ?
         WHERE id IN (${marks(ids)}) AND user_id = ? AND status = 'active'`,
      )
      .run(nowIso, nowIso, ...ids, userId).changes,
  );
}

/** Gắn id lần ghép đã tiêu thụ thẻ (truy vết lịch sử). */
export function attachConsumedByUpgrade(db: DB, upgradeId: number, ids: number[]): void {
  db.prepare(`UPDATE user_cards SET consumed_by_upgrade_id = ? WHERE id IN (${marks(ids)})`).run(upgradeId, ...ids);
}

/** Đổi chủ có điều kiện (tặng thẻ): chỉ thẻ active của người gửi. Trả về số dòng đổi được. */
export function transferActiveCards(db: DB, ids: number[], fromUserId: number, toUserId: number, nowIso: string): number {
  return Number(
    db
      .prepare(
        `UPDATE user_cards SET user_id = ?, updated_at = ?
         WHERE id IN (${marks(ids)}) AND user_id = ? AND status = 'active'`,
      )
      .run(toUserId, nowIso, ...ids, fromUserId).changes,
  );
}

/** Hàng đợi nâng cấp nhanh: thẻ active của người chơi có level ≤ trần, cũ nhất trước. */
export function listActiveCardsUpTo(
  db: DB,
  userId: number,
  maxLevel: number,
): { id: number; general_id: string; level: number }[] {
  return db
    .prepare(
      `SELECT id, general_id, level FROM user_cards
       WHERE user_id = ? AND status = 'active' AND level <= ? ORDER BY id`,
    )
    .all(userId, maxLevel) as { id: number; general_id: string; level: number }[];
}

export interface UserCardsFilter {
  userId: number;
  faction?: Faction;
  level?: number;
  generalId?: string;
  /** Danh sách id tướng khớp tìm kiếm tên; [] = không khớp tướng nào. */
  generalIds?: string[];
  sort?: 'newest' | 'level_desc' | 'level_asc' | 'name';
  limit: number;
  offset: number;
}

export function listUserCards(
  db: DB,
  f: UserCardsFilter,
): { rows: { id: number; general_id: string; level: number; created_at: string }[]; total: number } {
  const where = ['c.user_id = ?', "c.status = 'active'"];
  const params: (string | number)[] = [f.userId];
  if (f.faction) {
    where.push('g.faction = ?');
    params.push(f.faction);
  }
  if (f.level) {
    where.push('c.level = ?');
    params.push(f.level);
  }
  if (f.generalId) {
    where.push('c.general_id = ?');
    params.push(f.generalId);
  }
  if (f.generalIds) {
    if (f.generalIds.length === 0) return { rows: [], total: 0 };
    where.push(`c.general_id IN (${f.generalIds.map(() => '?').join(',')})`);
    params.push(...f.generalIds);
  }
  const order =
    f.sort === 'level_desc'
      ? 'c.level DESC, c.id DESC'
      : f.sort === 'level_asc'
        ? 'c.level ASC, c.id DESC'
        : f.sort === 'name'
          ? 'g.name ASC, c.level DESC, c.id ASC'
          : 'c.id DESC';
  const from = `FROM user_cards c JOIN generals g ON g.id = c.general_id WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT c.id, c.general_id, c.level, c.created_at ${from} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, f.limit, f.offset) as { id: number; general_id: string; level: number; created_at: string }[];
  return { rows, total };
}

/** Cả bộ sưu tập active của một người chơi, mới nhất trước. */
const OWNED_CARDS_SQL = `SELECT id, general_id, level, created_at FROM user_cards
   WHERE user_id = ? AND status = 'active' ORDER BY id DESC`;
/** Mỗi tướng một thẻ: `ROW_NUMBER` lấy thẻ cấp cao nhất (cùng cấp thì lấy thẻ mới nhất). */
const BEST_OWNED_CARDS_SQL = `SELECT id, general_id, level, created_at FROM (
     SELECT id, general_id, level, created_at,
            ROW_NUMBER() OVER (PARTITION BY general_id ORDER BY level DESC, id DESC) AS rn
     FROM user_cards WHERE user_id = ? AND status = 'active')
   WHERE rn = 1 ORDER BY id DESC`;

/**
 * Toàn bộ thẻ active của một người chơi trong MỘT lượt — dùng cho `/api/cards/all`.
 * Không phân trang nên bỏ được `COUNT(*)` và `JOIN generals` (client tự lọc/sắp theo tên);
 * đổi lại phải quét hết bảng một lần thay vì quét lại ở từng trang.
 * `bestOnly`: lọc ngay trong SQL, mỗi tướng chỉ giữ một thẻ cấp cao nhất — màn chọn tướng PvP
 * chỉ cần cấp cao nhất nên payload giảm từ hàng chục nghìn dòng xuống còn vài trăm.
 */
export function listOwnedCards(
  db: DB,
  userId: number,
  bestOnly = false,
): { id: number; general_id: string; level: number; created_at: string }[] {
  return db.prepare(bestOnly ? BEST_OWNED_CARDS_SQL : OWNED_CARDS_SQL).all(userId) as {
    id: number;
    general_id: string;
    level: number;
    created_at: string;
  }[];
}

export interface AdminCardsFilter {
  /** Danh sách id tướng khớp tìm kiếm tên; [] = không khớp tướng nào. */
  generalIds?: string[];
  userId?: number;
  faction?: Faction;
  level?: number;
  sort?: 'newest' | 'level_desc' | 'level_asc' | 'name' | 'owner';
  limit: number;
  offset: number;
}

export function listAllCards(
  db: DB,
  f: AdminCardsFilter,
): {
  rows: { id: number; user_id: number; username: string; general_id: string; level: number; created_at: string }[];
  total: number;
} {
  const where = ["c.status = 'active'"];
  const params: (string | number)[] = [];
  if (f.userId) {
    where.push('c.user_id = ?');
    params.push(f.userId);
  }
  if (f.faction) {
    where.push('g.faction = ?');
    params.push(f.faction);
  }
  if (f.level) {
    where.push('c.level = ?');
    params.push(f.level);
  }
  if (f.generalIds) {
    if (f.generalIds.length === 0) return { rows: [], total: 0 };
    where.push(`c.general_id IN (${f.generalIds.map(() => '?').join(',')})`);
    params.push(...f.generalIds);
  }
  const order =
    f.sort === 'level_desc'
      ? 'c.level DESC, c.id DESC'
      : f.sort === 'level_asc'
        ? 'c.level ASC, c.id DESC'
        : f.sort === 'name'
          ? 'g.name ASC, c.level DESC, c.id ASC'
          : f.sort === 'owner'
            ? 'u.username COLLATE NOCASE ASC, c.level DESC, c.id ASC'
            : 'c.id DESC';
  const from = `FROM user_cards c JOIN generals g ON g.id = c.general_id JOIN users u ON u.id = c.user_id WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(
      `SELECT c.id, c.user_id, u.username, c.general_id, c.level, c.created_at ${from} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, f.limit, f.offset) as {
    id: number;
    user_id: number;
    username: string;
    general_id: string;
    level: number;
    created_at: string;
  }[];
  return { rows, total };
}
