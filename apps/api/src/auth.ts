import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { TICKET_TYPES, type TicketBalances, type RegisterResultDto } from '@tq/shared';
import { RECOVERY_INTERVAL_MS } from '@tq/game-config';
import { AppError, iso, sha256, type GameContext } from './context.ts';
import { tx } from './db.ts';
import { grantSignupBonus } from './tickets.ts';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

function createSession(ctx: GameContext, userId: number): string {
  const token = randomBytes(32).toString('base64url');
  const now = ctx.now();
  ctx.db
    .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
    .run(sha256(token), userId, iso(now), iso(now + SESSION_TTL_MS));
  return token;
}

/**
 * Kích hoạt tài khoản khi được duyệt: 5 dòng số dư vé + trạng thái hồi vé + quà đăng ký.
 * Mốc đã xử lý = mốc hồi (RECOVERY_INTERVAL_MS) gần nhất ĐÃ QUA tại lúc duyệt; vé hồi đầu tiên đến ở mốc kế tiếp.
 * PHẢI gọi trong transaction. Unique index ledger chặn cấp quà lần 2.
 */
export function activateAccount(ctx: GameContext, userId: number, now: number): TicketBalances {
  const nowIso = iso(now);
  const ins = ctx.db.prepare('INSERT INTO user_tickets (user_id, ticket_type, balance, updated_at) VALUES (?,?,0,?)');
  for (const t of TICKET_TYPES) ins.run(userId, t, nowIso);
  const slot = Math.floor(now / RECOVERY_INTERVAL_MS) * RECOVERY_INTERVAL_MS;
  ctx.db
    .prepare('INSERT INTO ticket_recovery_state (user_id, last_processed_recovery_at, updated_at) VALUES (?,?,?)')
    .run(userId, iso(slot), nowIso);
  return grantSignupBonus(ctx, userId, nowIso);
}

/**
 * Đăng ký (mục 3.8): tài khoản mới ở trạng thái 'pending', chưa có vé, chưa đăng nhập được
 * cho đến khi admin duyệt (quà đăng ký và vé hồi tính từ lúc duyệt).
 * Ngoại lệ: tài khoản ĐẦU TIÊN của hệ thống tự thành admin, được duyệt và kích hoạt ngay.
 */
export function register(ctx: GameContext, username: string, password: string): RegisterResultDto {
  const passwordHash = hashPassword(password);
  return tx(ctx.db, (): RegisterResultDto => {
    const exists = ctx.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) throw new AppError(409, 'USERNAME_TAKEN', 'Tên đăng nhập đã tồn tại.');
    const first = !ctx.db.prepare('SELECT 1 FROM users LIMIT 1').get();
    const now = ctx.now();
    const nowIso = iso(now);
    const r = ctx.db
      .prepare('INSERT INTO users (username, password_hash, created_at, status, is_admin, approved_at) VALUES (?,?,?,?,?,?)')
      .run(username, passwordHash, nowIso, first ? 'approved' : 'pending', first ? 1 : 0, first ? nowIso : null);
    const userId = Number(r.lastInsertRowid);
    if (!first) return { status: 'pending', userId };
    const signupBonus = activateAccount(ctx, userId, now);
    return { status: 'approved', userId, isAdmin: true, token: createSession(ctx, userId), signupBonus };
  });
}

export function login(ctx: GameContext, username: string, password: string): { token: string; userId: number } {
  const row = ctx.db.prepare('SELECT id, password_hash, status FROM users WHERE username = ?').get(username) as
    | { id: number; password_hash: string; status: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu.');
  }
  if (row.status !== 'approved') {
    throw new AppError(403, 'ACCOUNT_PENDING', 'Tài khoản đang chờ quản trị viên duyệt. Vui lòng quay lại sau.');
  }
  return { userId: row.id, token: createSession(ctx, row.id) };
}

export function logout(ctx: GameContext, token: string): void {
  ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function authenticate(ctx: GameContext, token: string | undefined): number {
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Chưa đăng nhập.');
  const row = ctx.db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.status FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as { user_id: number; expires_at: string; status: string } | undefined;
  if (!row || Date.parse(row.expires_at) <= ctx.now() || row.status !== 'approved') {
    throw new AppError(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
  return row.user_id;
}

export function getUsername(ctx: GameContext, userId: number): string {
  const row = ctx.db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  if (!row) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy người chơi.');
  return row.username;
}

export function isAdmin(ctx: GameContext, userId: number): boolean {
  const row = ctx.db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId) as { is_admin: number } | undefined;
  return row?.is_admin === 1;
}
