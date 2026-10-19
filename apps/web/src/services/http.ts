import { STORAGE_KEYS } from '../core/constants.ts';

/**
 * Tầng HTTP dùng chung cho mọi lời gọi API tới Fastify (đường dẫn `/api/...`).
 *
 * Giữ nguyên hợp đồng của bản SolidJS cũ: gửi Bearer token, JSON body, và chuẩn hóa lỗi về
 * một lớp duy nhất `ApiError` (kèm `status` + `code` để UI phân nhánh theo mã lỗi nghiệp vụ).
 */

const TOKEN_KEY = STORAGE_KEYS.token;

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

let token: string | null = readToken();

/** Lưu token phiên (null = đăng xuất) — đồng bộ cả bộ nhớ lẫn localStorage. */
export function setToken(t: string | null): void {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* bỏ qua: trình duyệt chặn storage */
  }
}

export const hasToken = (): boolean => !!token;

/** Lỗi API đã chuẩn hóa: `status = 0` nghĩa là không kết nối được máy chủ. */
export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Gọi API thô: tự gắn token, tự phân tích JSON và ném `ApiError` khi không thành công. */
export async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Không kết nối được máy chủ.');
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } } | null)?.error;
    // Phiên hết hạn: xóa token ngay để lần gọi sau không lặp lại lỗi 401.
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, err?.code ?? 'HTTP_' + res.status, err?.message ?? 'Lỗi không xác định.');
  }
  return data as T;
}

/** Idempotency key sinh 1 lần cho mỗi thao tác người dùng; retry dùng lại cùng key. */
export const newKey = (): string => crypto.randomUUID();

/** Ghép query string, bỏ qua tham số rỗng/không xác định. */
export const qs = (o: Record<string, unknown>): string =>
  new URLSearchParams(
    Object.entries(o)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [k, String(v)]),
  ).toString();
