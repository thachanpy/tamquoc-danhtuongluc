import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { TICKET_TYPES, type TicketBalances } from '@tq/shared';
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
 * Tạo tài khoản + 4 dòng số dư vé + trạng thái hồi vé + quà đăng ký (100 vé), tất cả trong 1 transaction.
 * Mốc đã xử lý = mốc hồi (RECOVERY_INTERVAL_MS) gần nhất ĐÃ QUA tại lúc tạo; vé hồi đầu tiên đến ở mốc kế tiếp.
 * Đăng ký trả về token => người chơi đăng nhập ngay và thấy 100 vé.
 */
export function register(
  ctx: GameContext,
  username: string,
  password: string,
): { token: string; userId: number; signupBonus: TicketBalances } {
  const passwordHash = hashPassword(password);
  return tx(ctx.db, () => {
    const exists = ctx.db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) throw new AppError(409, 'USERNAME_TAKEN', 'Tên đăng nhập đã tồn tại.');
    const now = ctx.now();
    const nowIso = iso(now);
    const r = ctx.db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?,?,?)')
      .run(username, passwordHash, nowIso);
    const userId = Number(r.lastInsertRowid);
    const ins = ctx.db.prepare('INSERT INTO user_tickets (user_id, ticket_type, balance, updated_at) VALUES (?,?,0,?)');
    for (const t of TICKET_TYPES) ins.run(userId, t, nowIso);
    const slot = Math.floor(now / RECOVERY_INTERVAL_MS) * RECOVERY_INTERVAL_MS;
    ctx.db
      .prepare('INSERT INTO ticket_recovery_state (user_id, last_processed_recovery_at, updated_at) VALUES (?,?,?)')
      .run(userId, iso(slot), nowIso);
    const signupBonus = grantSignupBonus(ctx, userId, nowIso);
    return { userId, token: createSession(ctx, userId), signupBonus };
  });
}

export function login(ctx: GameContext, username: string, password: string): { token: string; userId: number } {
  const row = ctx.db.prepare('SELECT id, password_hash FROM users WHERE username = ?').get(username) as
    | { id: number; password_hash: string }
    | undefined;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu.');
  }
  return { userId: row.id, token: createSession(ctx, row.id) };
}

export function logout(ctx: GameContext, token: string): void {
  ctx.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function authenticate(ctx: GameContext, token: string | undefined): number {
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Chưa đăng nhập.');
  const row = ctx.db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
    | { user_id: number; expires_at: string }
    | undefined;
  if (!row || Date.parse(row.expires_at) <= ctx.now()) {
    throw new AppError(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
  return row.user_id;
}

export function getUsername(ctx: GameContext, userId: number): string {
  const row = ctx.db.prepare('SELECT username FROM users WHERE id = ?').get(userId) as { username: string } | undefined;
  if (!row) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy người chơi.');
  return row.username;
}
