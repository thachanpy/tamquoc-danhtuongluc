import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import {
  TICKET_TYPES,
  AVATAR_MAX_LENGTH,
  DISPLAY_NAME_MAX,
  type TicketBalances,
  type RegisterResultDto,
  type ProfileDto,
} from '@tq/shared';
import { RECOVERY_INTERVAL_MS } from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso, sha256 } from '../utils.ts';
import { PREFIX, TTL, DROP, invalidatePlayers } from '../cache.ts';
import { tx } from '../db.ts';
import {
  hasAnyUser,
  usernameExists,
  insertUser,
  findUserAuth,
  findUserRow,
  findUserPasswordHash,
  updateUserDisplayName,
  updateUserAvatar,
  updateUserPasswordHash,
  insertSession,
  findSession,
  deleteSession,
} from '../repositories/user.repository.ts';
import { insertInitialTicketRows, insertRecoveryState, floorToSlot } from '../repositories/ticket.repository.ts';
import { grantSignupBonus } from './ticket.manager.ts';
import { getRequireApproval } from './settings.manager.ts';

/** Thời hạn phiên đăng nhập; null = không hết hạn (mặc định, chủ dự án yêu cầu). Phiên lưu trong SQLite nên khởi động lại server không mất. */
const SESSION_TTL_MS: number | null = null;

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
  insertSession(ctx.db, {
    tokenHash: sha256(token),
    userId,
    createdAt: iso(now),
    expiresAt: SESSION_TTL_MS === null ? null : iso(now + SESSION_TTL_MS),
  });
  return token;
}

/**
 * Kích hoạt tài khoản khi được duyệt: 5 dòng số dư vé + trạng thái hồi vé + quà đăng ký.
 * Mốc đã xử lý = mốc hồi (RECOVERY_INTERVAL_MS) gần nhất ĐÃ QUA tại lúc duyệt; vé hồi đầu tiên đến ở mốc kế tiếp.
 * PHẢI gọi trong transaction. Unique index ledger chặn cấp quà lần 2.
 */
export function activateAccount(ctx: GameContext, userId: number, now: number): TicketBalances {
  const nowIso = iso(now);
  insertInitialTicketRows(ctx.db, userId, nowIso);
  insertRecoveryState(ctx.db, userId, iso(floorToSlot(now)), nowIso);
  return grantSignupBonus(ctx, userId, nowIso);
}

/**
 * Đăng ký (mục 3.8): tài khoản mới ở trạng thái 'pending', chưa có vé, chưa đăng nhập được
 * cho đến khi admin duyệt (quà đăng ký và vé hồi tính từ lúc duyệt).
 * Ngoại lệ: tài khoản ĐẦU TIÊN của hệ thống tự thành admin, được duyệt và kích hoạt ngay.
 * Khi cài đặt "Duyệt tài khoản" tắt (mặc định; admin bật/tắt ở trang Quản trị), mọi tài khoản mới được duyệt ngay.
 */
export function register(ctx: GameContext, username: string, password: string): RegisterResultDto {
  const passwordHash = hashPassword(password);
  return tx(ctx.db, (): RegisterResultDto => {
    if (usernameExists(ctx.db, username)) {
      throw new AppError(409, 'USERNAME_TAKEN', 'Tên đăng nhập đã tồn tại.');
    }
    const first = !hasAnyUser(ctx.db);
    const autoApprove = first || !getRequireApproval(ctx);
    const now = ctx.now();
    const nowIso = iso(now);
    const userId = insertUser(ctx.db, {
      username,
      passwordHash,
      createdAt: nowIso,
      status: autoApprove ? 'approved' : 'pending',
      isAdmin: first,
      approvedAt: autoApprove ? nowIso : null,
    });
    if (!autoApprove) {
      // Tài khoản mới xuất hiện trong danh sách Quản trị => xoá cache danh sách.
      invalidatePlayers(ctx.cache, userId);
      return { status: 'pending', userId };
    }
    invalidatePlayers(ctx.cache, userId);
    const signupBonus = activateAccount(ctx, userId, now);
    return { status: 'approved', userId, isAdmin: first, token: createSession(ctx, userId), signupBonus };
  });
}

export function login(ctx: GameContext, username: string, password: string): { token: string; userId: number } {
  const row = findUserAuth(ctx.db, username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Sai tên đăng nhập hoặc mật khẩu.');
  }
  if (row.status !== 'approved') {
    throw new AppError(403, 'ACCOUNT_PENDING', 'Tài khoản đang chờ quản trị viên duyệt. Vui lòng quay lại sau.');
  }
  return { userId: row.id, token: createSession(ctx, row.id) };
}

export function logout(ctx: GameContext, token: string): void {
  const tokenHash = sha256(token);
  deleteSession(ctx.db, tokenHash);
  ctx.cache.drop([DROP.session(tokenHash)]);
}

/**
 * Xác thực token: tra phiên đăng nhập (đệm cache 60s để đỡ 1 truy vấn join mỗi request).
 * Phiên không hợp lệ/hết hạn/tài khoản chưa duyệt => 401.
 */
export async function authenticate(ctx: GameContext, token: string | undefined): Promise<number> {
  if (!token) throw new AppError(401, 'UNAUTHORIZED', 'Chưa đăng nhập.');
  const tokenHash = sha256(token);
  const row = await ctx.cache.readThrough(PREFIX.session(tokenHash), TTL.session, () => findSession(ctx.db, tokenHash) ?? null);
  const expired = row?.expires_at != null && Date.parse(row.expires_at) <= ctx.now();
  if (!row || expired || row.status !== 'approved') {
    throw new AppError(401, 'UNAUTHORIZED', 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
  }
  return row.user_id;
}

export function getUsername(ctx: GameContext, userId: number): string {
  const row = findUserRow(ctx.db, userId);
  if (!row) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy người chơi.');
  return row.username;
}

/** Cờ quản trị của người chơi (đệm cache 60s; xoá ở các đường đổi quyền/trạng thái). */
export async function isAdmin(ctx: GameContext, userId: number): Promise<boolean> {
  const row = await ctx.cache.readThrough(PREFIX.user(userId), TTL.user, () => findUserRow(ctx.db, userId) ?? null);
  return row?.is_admin === 1;
}

// ===== Hồ sơ người chơi (mục 3.11): tên hiển thị + ảnh đại diện + đổi mật khẩu =====

/** Ảnh đại diện tự tải: data URL đã thu nhỏ ở client (png/jpeg/webp). */
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** Ảnh đại diện gợi ý: chân dung tướng trong /generals (chỉ nhận đúng tên file, không nhận đường dẫn khác). */
const AVATAR_PORTRAIT = /^\/generals\/[a-z0-9-]+\.webp$/;

function validateDisplayName(raw: string): string {
  const name = raw.trim();
  if (!name) throw new AppError(400, 'INVALID_DISPLAY_NAME', 'Tên hiển thị không được để trống.');
  if (name.length > DISPLAY_NAME_MAX) {
    throw new AppError(400, 'INVALID_DISPLAY_NAME', `Tên hiển thị tối đa ${DISPLAY_NAME_MAX} ký tự.`);
  }
  // Ký tự điều khiển (gồm xuống dòng) không dùng được trong tên hiển thị
  if (/[\p{Cc}\p{Cf}]/u.test(name)) {
    throw new AppError(400, 'INVALID_DISPLAY_NAME', 'Tên hiển thị chứa ký tự không hợp lệ.');
  }
  return name;
}

function validateAvatar(raw: string | null): string | null {
  if (raw === null) return null;
  if (raw.length > AVATAR_MAX_LENGTH) throw new AppError(400, 'AVATAR_TOO_LARGE', 'Ảnh đại diện quá lớn.');
  if (AVATAR_DATA_URL.test(raw) || AVATAR_PORTRAIT.test(raw)) return raw;
  throw new AppError(400, 'INVALID_AVATAR', 'Ảnh đại diện không hợp lệ.');
}

export function getProfile(ctx: GameContext, userId: number): ProfileDto {
  const row = findUserRow(ctx.db, userId);
  if (!row) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy người chơi.');
  // Tên hiển thị mặc định = tên đăng nhập (tài khoản tạo trước migration v13 có thể còn NULL)
  return { displayName: row.display_name ?? row.username, avatar: row.avatar };
}

export interface ProfilePatch {
  displayName?: string;
  avatar?: string | null;
}

/** Cập nhật hồ sơ: chỉ đổi field có mặt trong patch; avatar = null là xoá ảnh đại diện. */
export function updateProfile(ctx: GameContext, userId: number, patch: ProfilePatch): ProfileDto {
  if (patch.displayName === undefined && patch.avatar === undefined) {
    throw new AppError(400, 'NOTHING_TO_UPDATE', 'Không có thay đổi nào để lưu.');
  }
  if (patch.displayName !== undefined) updateUserDisplayName(ctx.db, userId, validateDisplayName(patch.displayName));
  if (patch.avatar !== undefined) updateUserAvatar(ctx.db, userId, validateAvatar(patch.avatar));
  // Tên/ảnh hiển thị xuất hiện trên bảng xếp hạng và danh sách Quản trị => xoá cache liên quan.
  invalidatePlayers(ctx.cache, userId);
  return getProfile(ctx, userId);
}

/** Đổi mật khẩu: phải nhập đúng mật khẩu hiện tại. Phiên đăng nhập đang dùng vẫn giữ nguyên. */
export function changePassword(ctx: GameContext, userId: number, currentPassword: string, newPassword: string): void {
  const stored = findUserPasswordHash(ctx.db, userId);
  if (!stored || !verifyPassword(currentPassword, stored)) {
    throw new AppError(400, 'INVALID_PASSWORD', 'Mật khẩu hiện tại không đúng.');
  }
  if (newPassword === currentPassword) {
    throw new AppError(400, 'SAME_PASSWORD', 'Mật khẩu mới phải khác mật khẩu hiện tại.');
  }
  updateUserPasswordHash(ctx.db, userId, hashPassword(newPassword));
}
