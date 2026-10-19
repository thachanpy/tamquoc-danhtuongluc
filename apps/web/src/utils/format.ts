/** Định dạng hiển thị dùng chung cho mọi trang (locale tiếng Việt). */

/** Số nguyên có dấu phân cách nghìn: 12345 → "12.345". */
export const num = (n: number): string => n.toLocaleString('vi-VN');

/** Ngày-giờ đầy đủ theo tiếng Việt: "19/10/2026 14:05:00". */
export const fmtDateTime = (iso: string): string => new Date(iso).toLocaleString('vi-VN');

/** Ngày-giờ rút gọn: "19/10 14:05". */
export const fmtDateTimeShort = (iso: string): string =>
  new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Đếm ngược ms → "mm:ss" (tối thiểu 00:00). */
export const fmtCountdown = (ms: number): string => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Đếm ngược giây → "HH:MM:SS" (dùng cho mốc reset nhiệm vụ). */
export const fmtClock = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
};
