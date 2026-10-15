import type { UserStatus } from '@tq/shared';
import type { DB } from '../db.ts';
import { likeContains } from '../utils.ts';

/** Truy vấn bảng users + sessions (xác thực/phiên đăng nhập). */

export interface UserAuthRow {
  id: number;
  password_hash: string;
  status: UserStatus;
}

export interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  avatar: string | null;
  status: UserStatus;
  is_admin: number;
  created_at: string;
  approved_at: string | null;
}

export interface AdminUserRow extends UserRow {
  card_count: number;
  max_level: number | null;
}

const USER_SELECT = `SELECT u.id, u.username, u.display_name, u.avatar, u.status, u.is_admin, u.created_at, u.approved_at,
  (SELECT COUNT(*) FROM user_cards c WHERE c.user_id = u.id AND c.status = 'active') AS card_count,
  (SELECT MAX(level) FROM user_cards c WHERE c.user_id = u.id AND c.status = 'active') AS max_level
  FROM users u`;

export function usernameExists(db: DB, username: string): boolean {
  return !!db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
}

export function hasAnyUser(db: DB): boolean {
  return !!db.prepare('SELECT 1 FROM users LIMIT 1').get();
}

export function insertUser(
  db: DB,
  p: { username: string; passwordHash: string; createdAt: string; status: UserStatus; isAdmin: boolean; approvedAt: string | null },
): number {
  // Tên hiển thị mặc định = tên đăng nhập (chủ dự án yêu cầu); người chơi đổi ở trang Hồ sơ.
  const r = db
    .prepare(
      'INSERT INTO users (username, password_hash, created_at, status, is_admin, approved_at, display_name) VALUES (?,?,?,?,?,?,?)',
    )
    .run(p.username, p.passwordHash, p.createdAt, p.status, p.isAdmin ? 1 : 0, p.approvedAt, p.username);
  return Number(r.lastInsertRowid);
}

export function findUserAuth(db: DB, username: string): UserAuthRow | undefined {
  return db.prepare('SELECT id, password_hash, status FROM users WHERE username = ?').get(username) as
    | UserAuthRow
    | undefined;
}

export function findUserRow(db: DB, userId: number): UserRow | undefined {
  return db
    .prepare('SELECT id, username, display_name, avatar, status, is_admin, created_at, approved_at FROM users WHERE id = ?')
    .get(userId) as UserRow | undefined;
}

/** Hash mật khẩu hiện tại (để kiểm tra trước khi đổi mật khẩu). */
export function findUserPasswordHash(db: DB, userId: number): string | undefined {
  return (db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined)
    ?.password_hash;
}

export function updateUserDisplayName(db: DB, userId: number, displayName: string): void {
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, userId);
}

export function updateUserAvatar(db: DB, userId: number, avatar: string | null): void {
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(avatar, userId);
}

export function updateUserPasswordHash(db: DB, userId: number, passwordHash: string): void {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

/** Người nhận thẻ tặng: chỉ tài khoản đã duyệt, tra theo tên chính xác. */
export function findApprovedUserByUsername(db: DB, username: string): { id: number; username: string; is_admin: number } | undefined {
  return db.prepare(`SELECT id, username, is_admin FROM users WHERE username = ? AND status = 'approved'`).get(username) as
    | { id: number; username: string; is_admin: number }
    | undefined;
}

export function findAdminUserRow(db: DB, userId: number): AdminUserRow | undefined {
  return db.prepare(`${USER_SELECT} WHERE u.id = ?`).get(userId) as AdminUserRow | undefined;
}

/** pending → approved (điều kiện status='pending'); trả về số dòng đổi được. */
export function approveUserRow(db: DB, userId: number, approvedAt: string): number {
  return Number(
    db.prepare(`UPDATE users SET status = 'approved', approved_at = ? WHERE id = ? AND status = 'pending'`).run(approvedAt, userId)
      .changes,
  );
}

/** Xoá tài khoản đang chờ duyệt; trả về số dòng đổi được. */
export function deletePendingUser(db: DB, userId: number): number {
  return Number(db.prepare(`DELETE FROM users WHERE id = ? AND status = 'pending'`).run(userId).changes);
}

export function updateUserAdmin(db: DB, userId: number, isAdmin: boolean): void {
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, userId);
}

/** Danh sách người chơi cho trang Quản trị: tài khoản chờ duyệt lên đầu, sau đó mới nhất trước. */
export function queryAdminUsers(
  db: DB,
  q: { username?: string; status?: UserStatus; limit: number; offset: number },
): { rows: AdminUserRow[]; total: number; pendingCount: number } {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (q.username?.trim()) {
    where.push(`u.username LIKE $q ESCAPE '\\'`);
    params.q = likeContains(q.username);
  }
  if (q.status) {
    where.push('u.status = $status');
    params.status = q.status;
  }
  const w = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM users u${w}`).get(params) as { n: number }).n;
  const rows = db
    .prepare(`${USER_SELECT}${w} ORDER BY (u.status = 'pending') DESC, u.id DESC LIMIT $limit OFFSET $offset`)
    .all({ ...params, limit: q.limit, offset: q.offset }) as unknown as AdminUserRow[];
  const pendingCount = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE status = 'pending'`).get() as { n: number }).n;
  return { rows, total, pendingCount };
}

// ======================= Phiên đăng nhập =======================

export function insertSession(
  db: DB,
  p: { tokenHash: string; userId: number; createdAt: string; expiresAt: string | null },
): void {
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(
    p.tokenHash,
    p.userId,
    p.createdAt,
    p.expiresAt,
  );
}

export function findSession(db: DB, tokenHash: string): { user_id: number; expires_at: string | null; status: UserStatus } | undefined {
  return db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as { user_id: number; expires_at: string | null; status: UserStatus } | undefined;
}

export function deleteSession(db: DB, tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteSessionsForUser(db: DB, userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}
