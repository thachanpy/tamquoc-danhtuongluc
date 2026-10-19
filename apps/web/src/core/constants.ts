/** Hằng số dùng chung toàn frontend (một nguồn sự thật, tránh gõ chuỗi rải rác). */

export const APP_NAME = 'Tam Quốc: Vô Song';

/** Khóa lưu trong localStorage. */
export const STORAGE_KEYS = {
  /** Token phiên đăng nhập (Bearer) — dùng ở tầng gọi API. */
  token: 'tq.token',
  /** Tùy chọn nhạc nền: { on, volume }. */
  music: 'tq.music',
  /** Bài nhạc vừa phát — để lần mở sau không bắt đầu lại đúng bài đó. */
  musicLast: 'tq.music.last',
  /** Tùy chọn hiệu ứng âm thanh: { on, volume }. */
  sfx: 'tq.sfx',
  /** Tiền tố khoá đánh dấu đã hiện popup mời nhập giftcode (nối thêm tên đăng nhập). */
  gcPopupPrefix: 'tq.gcPopup.',
} as const;

/**
 * Mốc bề rộng khung (px) dùng để chọn bố cục.
 * Khớp bản SolidJS cũ: ≤640px là bố cục mobile.
 */
export const BREAKPOINTS = { mobile: 640, tablet: 1024 } as const;

/** Kích thước gốc của hai bố cục sân đấu PvP (mục 6.7). */
export const ARENA = {
  landscape: { width: 900, height: 560 },
  portrait: { width: 640, height: 768 },
} as const;

/** Giới hạn FPS — tránh lag và hao pin trên thiết bị iOS màn hình ProMotion. */
export const TARGET_FPS = 60;
