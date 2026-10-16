import type { GemElement, UpgradeOutcome, WeightEntry } from '@tq/shared';
import type { DB } from '../db.ts';

/**
 * Truy vấn bảng Ngọc Ngũ Hành: user_gems (kho Ngọc), gem_merge_history (lịch sử ghép)
 * và pvp_team_gems (Ngọc gắn cho đội hình). Ngọc là VẬT PHẨM RỜI theo (loại, cấp) — ghép 2 viên
 * cùng loại & cùng cấp thành 1 viên cấp +1, dùng chung công thức/tỷ lệ với thẻ Tướng.
 */

export interface GemRow {
  id: number;
  user_id: number;
  element: GemElement;
  level: number;
  status: string;
  created_at: string;
}

/** Ngọc chỉ gồm (id, loại, cấp) — đủ để ghép và cộng chỉ số đội. */
export interface GemPairRow {
  id: number;
  element: GemElement;
  level: number;
}

const marks = (ids: number[]) => ids.map(() => '?').join(',');

export function insertGem(db: DB, userId: number, element: GemElement, level: number, nowIso: string): number {
  const r = db
    .prepare('INSERT INTO user_gems (user_id, element, level, created_at, updated_at) VALUES (?,?,?,?,?)')
    .run(userId, element, level, nowIso, nowIso);
  return Number(r.lastInsertRowid);
}

export function findGemsByIds(db: DB, ids: number[]): GemRow[] {
  return db
    .prepare(`SELECT id, user_id, element, level, status, created_at FROM user_gems WHERE id IN (${marks(ids)})`)
    .all(...ids) as unknown as GemRow[];
}

/** Tiêu thụ có điều kiện: chỉ Ngọc còn active của chính người chơi. Trả về số dòng đổi được. */
export function consumeActiveGems(db: DB, ids: number[], userId: number, nowIso: string): number {
  return Number(
    db
      .prepare(
        `UPDATE user_gems SET status = 'consumed', consumed_at = ?, updated_at = ?
         WHERE id IN (${marks(ids)}) AND user_id = ? AND status = 'active'`,
      )
      .run(nowIso, nowIso, ...ids, userId).changes,
  );
}

/** Gắn id lần ghép đã tiêu thụ Ngọc (truy vết lịch sử). */
export function attachConsumedByMerge(db: DB, mergeId: number, ids: number[]): void {
  db.prepare(`UPDATE user_gems SET consumed_by_merge_id = ? WHERE id IN (${marks(ids)})`).run(mergeId, ...ids);
}

/** Toàn bộ Ngọc đang sở hữu (chưa tiêu hao), mới nhất trước — tab Bộ sưu tập. */
export function listActiveGems(db: DB, userId: number): GemRow[] {
  return db
    .prepare(
      `SELECT id, user_id, element, level, status, created_at FROM user_gems
        WHERE user_id = ? AND status = 'active' ORDER BY id DESC`,
    )
    .all(userId) as unknown as GemRow[];
}

/** Hàng đợi ghép nhanh: Ngọc active của người chơi có level ≤ trần, cũ nhất trước. */
export function listActiveGemsUpTo(db: DB, userId: number, maxLevel: number): GemPairRow[] {
  return db
    .prepare(
      `SELECT id, element, level FROM user_gems
        WHERE user_id = ? AND status = 'active' AND level <= ? ORDER BY id`,
    )
    .all(userId, maxLevel) as unknown as GemPairRow[];
}

export function insertGemMerge(
  db: DB,
  p: {
    userId: number;
    inputGemIdsSnapshot: string;
    element: GemElement;
    inputLevel: number;
    resultGemId: number;
    resultLevel: number;
    successBps: number;
    failureBps: number;
    outcome: UpgradeOutcome;
    failureDistributionSnapshot: WeightEntry[];
    idempotencyKey: string;
    createdAt: string;
  },
): number {
  const r = db
    .prepare(
      `INSERT INTO gem_merge_history (user_id, input_gem_ids_snapshot, element, input_level, result_gem_id,
         result_level, success_chance, failure_chance, outcome, failure_distribution_snapshot, idempotency_key, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.userId,
      p.inputGemIdsSnapshot,
      p.element,
      p.inputLevel,
      p.resultGemId,
      p.resultLevel,
      p.successBps,
      p.failureBps,
      p.outcome,
      JSON.stringify(p.failureDistributionSnapshot),
      p.idempotencyKey,
      p.createdAt,
    );
  return Number(r.lastInsertRowid);
}

// ===== Ngọc gắn cho đội hình (pvp_team_gems) =====

/** Loại Ngọc đã gắn cho đội của người chơi (cấp lấy động ở manager = viên cao nhất đang sở hữu). */
export function listTeamGemElements(db: DB, userId: number): GemElement[] {
  return (
    db.prepare('SELECT element FROM pvp_team_gems WHERE user_id = ?').all(userId) as unknown as { element: GemElement }[]
  ).map((r) => r.element);
}

/** Ghi đè toàn bộ Ngọc gắn cho đội (tối đa PVP_TEAM_GEM_COUNT loại khác nhau). */
export function replaceTeamGems(db: DB, userId: number, elements: GemElement[], nowIso: string): void {
  db.prepare('DELETE FROM pvp_team_gems WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO pvp_team_gems (user_id, element, updated_at) VALUES (?,?,?)');
  for (const e of elements) ins.run(userId, e, nowIso);
}

// ===== Dữ liệu cho Bảng xếp hạng LC (mọi người chơi đủ điều kiện) =====

/** Mọi viên Ngọc active của người chơi đủ điều kiện (đã duyệt, không admin) — dựng LC bảng xếp hạng. */
export function listEligibleUserGems(db: DB): { user_id: number; element: GemElement; level: number }[] {
  return db
    .prepare(
      `SELECT g.user_id, g.element, g.level
         FROM user_gems g
         JOIN users u ON u.id = g.user_id AND u.status = 'approved' AND u.is_admin = 0
        WHERE g.status = 'active'`,
    )
    .all() as unknown as { user_id: number; element: GemElement; level: number }[];
}

/** Loại Ngọc đã gắn của mọi người chơi đủ điều kiện — dựng LC bảng xếp hạng. */
export function listEligibleTeamGems(db: DB): { user_id: number; element: GemElement }[] {
  return db
    .prepare(
      `SELECT t.user_id, t.element
         FROM pvp_team_gems t
         JOIN users u ON u.id = t.user_id AND u.status = 'approved' AND u.is_admin = 0`,
    )
    .all() as unknown as { user_id: number; element: GemElement }[];
}

// ===== Dữ liệu cho tab Ngọc ở trang Quản trị =====

export interface AdminGemsFilter {
  userId?: number;
  element?: GemElement;
  level?: number;
  sort?: 'newest' | 'level_desc' | 'level_asc' | 'owner';
  limit: number;
  offset: number;
}

/** Mọi viên Ngọc đang active của mọi người chơi (chỉ đọc), có lọc và phân trang. */
export function listAllGems(
  db: DB,
  f: AdminGemsFilter,
): {
  rows: { id: number; user_id: number; username: string; element: GemElement; level: number; created_at: string }[];
  total: number;
} {
  const where = ["g.status = 'active'"];
  const params: (string | number)[] = [];
  if (f.userId) {
    where.push('g.user_id = ?');
    params.push(f.userId);
  }
  if (f.element) {
    where.push('g.element = ?');
    params.push(f.element);
  }
  if (f.level) {
    where.push('g.level = ?');
    params.push(f.level);
  }
  const order =
    f.sort === 'level_desc'
      ? 'g.level DESC, g.id DESC'
      : f.sort === 'level_asc'
        ? 'g.level ASC, g.id DESC'
        : f.sort === 'owner'
          ? 'u.username COLLATE NOCASE ASC, g.level DESC, g.id ASC'
          : 'g.id DESC';
  const from = `FROM user_gems g JOIN users u ON u.id = g.user_id WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`SELECT g.id, g.user_id, u.username, g.element, g.level, g.created_at ${from} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, f.limit, f.offset) as {
    id: number;
    user_id: number;
    username: string;
    element: GemElement;
    level: number;
    created_at: string;
  }[];
  return { rows, total };
}
