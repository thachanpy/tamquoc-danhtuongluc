import { createHash } from 'node:crypto';
import { ROSTER } from '@tq/game-config';

/** ISO-8601 (UTC) từ epoch ms. */
export const iso = (ms: number) => new Date(ms).toISOString();

/** Băm SHA-256 hex — dùng cho token phiên đăng nhập và request hash của idempotency. */
export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Bỏ dấu tiếng Việt để tìm kiếm tên không phân biệt dấu/hoa thường. */
export function foldVi(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Id các tướng khớp từ khoá tìm kiếm (theo tên không dấu hoặc id). */
export function searchGeneralIds(q: string): string[] {
  const needle = foldVi(q.trim());
  return ROSTER.filter((g) => foldVi(g.name).includes(needle) || g.id.includes(needle)).map((g) => g.id);
}

/** Mẫu LIKE '%...%' đã escape ký tự đặc biệt (% _ \) để dùng kèm `ESCAPE '\'`. */
export const likeContains = (q: string) => `%${q.trim().replace(/[%_\\]/g, (m) => '\\' + m)}%`;
