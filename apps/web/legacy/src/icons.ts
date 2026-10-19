/**
 * Bộ icon hiệu ứng chiến đấu: 15 biểu tượng đơn sắc vẽ trong khung 24×24 (mục 18 — Trao đổi đòn).
 *
 * Là NGUỒN HÌNH DẠNG DUY NHẤT cho cả hai tầng hiển thị:
 * - Giao diện DOM (`StatIcon` — chèn thẳng chuỗi SVG qua `innerHTML`),
 * - Sân đấu PixiJS (`drawIcon` trong `pixi/arena.ts` — nạp cùng chuỗi SVG qua `Graphics#svg`).
 *
 * `{c}` trong phần thân là chỗ điền màu; DOM truyền `currentColor` để ăn theo CSS,
 * canvas truyền mã hex vì bộ nạp SVG của PixiJS không hiểu `currentColor`.
 */

export type IconId =
  /** Tấn công / sát thương. */
  | 'attack'
  /** Máu / HP. */
  | 'heart'
  /** Tỷ lệ bạo kích. */
  | 'crit-rate'
  /** Sát thương bạo kích. */
  | 'crit-dmg'
  /** Chính xác. */
  | 'eye'
  /** Giảm chính xác. */
  | 'eye-off'
  /** Né tránh. */
  | 'dodge'
  /** Giảm né tránh. */
  | 'dodge-off'
  /** Phòng thủ. */
  | 'armor'
  /** Xuyên giáp. */
  | 'bow-pen'
  /** Hút máu. */
  | 'blood'
  /** Giảm sát thương nhận. */
  | 'shield-reduce'
  /** Khiên lượng hấp thụ. */
  | 'sphere-shield'
  /** Thiêu đốt. */
  | 'burn'
  /** Chú thích / hướng dẫn. */
  | 'info';

/** Thân hình icon (không gồm thẻ `<svg>`) — `{c}` = chỗ điền màu. */
const BODY: Record<IconId, string> = {
  // Bảo kiếm chéo (tô kín) — nguồn: SVG Repo, khung gốc 16×16 (xem `VIEW_BOX`).
  attack:
    '<path d="M16 0H13L3.70711 9.29289L2.20711 7.79289L0.792893 9.20711L3.08579 11.5L1.5835 13.0023C1.55586 13.0008 1.52802 13 1.5 13C0.671573 13 0 13.6716 0 14.5C0 15.3284 0.671573 16 1.5 16C2.32843 16 3 15.3284 3 14.5C3 14.472 2.99923 14.4441 2.99771 14.4165L4.5 12.9142L6.79289 15.2071L8.20711 13.7929L6.70711 12.2929L16 3V0Z"/>',
  // Trái tim (tô kín)
  heart: '<path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>',
  // Tia sét (tô kín)
  'crit-rate': '<path d="M13 2L3 14h7v8l11-12h-8l3-8z"/>',
  // Vụ nổ lôi điện tỏa tròn
  'crit-dmg': '<path d="M12 2v4m0 12v4M2 12h4m14 0h4m-3.17-6.83l-2.83 2.83m-8 8l-2.83 2.83m0-13.66l2.83 2.83m8 8l2.83 2.83"/><circle cx="12" cy="12" r="3" fill="{c}" stroke="none"/>',
  // Ưng nhãn
  eye: '<circle cx="12" cy="12" r="3" fill="{c}" stroke="none"/><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>',
  // Mắt bị gạch chéo
  'eye-off': '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>',
  // Làn gió lướt thân thủ
  dodge: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
  // Gió bị cản
  'dodge-off': '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/><path d="M2 2l20 20"/>',
  // Áo giáp ngực
  armor: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.8 17 5 19 5a1 1 0 0 1 1 1z"/><path d="M12 8v8m-4-4h8"/>',
  // Cung tên đâm thủng giáp
  'bow-pen': '<path d="M5 3c7 0 14 4 14 9s-7 9-14 9"/><path d="M5 3v18"/><path d="M5 12h16m-4-4l4 4-4 4"/>',
  // Giọt máu (tô kín)
  blood: '<path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/>',
  // Khiên bảo hộ kèm dấu tích
  'shield-reduce': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
  // Cầu khí bảo hộ
  'sphere-shield': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5" stroke-dasharray="2 2"/><circle cx="12" cy="12" r="2" fill="{c}" stroke="none"/>',
  // Ngọn lửa (tô kín)
  burn: '<path d="M12 23c6.075 0 10-3.358 10-8.5c0-3.125-2.25-6.25-4-7.5c.25 2.5-1.25 3.5-2.5 3.5c-2.5 0-3-2.5-3-5c0-2 1-3.5 2-4.5c-4.25 1-6.5 4.5-6.5 7.5c0 1.5.5 3 1.5 4c-1.25-.5-2.5-1.75-2.5-3.5c-2.5 2.25-3 5.5-3 6.5c0 5.142 3.925 8.5 10 8.5z"/>',
  // Vòng tròn chữ i — nút mở bảng chú thích
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.6v5.4"/><circle cx="12" cy="7.8" r="1.1" fill="{c}" stroke="none"/>',
};

/** Icon tô kín ruột (không vẽ nét); các icon còn lại vẽ nét. */
const FILLED: ReadonlySet<IconId> = new Set<IconId>(['attack', 'heart', 'crit-rate', 'blood', 'burn']);

/**
 * Cạnh khung nhìn (viewBox `0 0 N N`) của từng icon — mặc định 24.
 * Vài icon nạp từ bộ SVG bên ngoài dùng khung gốc khác (vd `attack` là 16).
 */
const VIEW_BOX: Partial<Record<IconId, number>> = { attack: 16 };

/** Cạnh khung nhìn của icon — tầng canvas cần để quy đổi tỉ lệ vẽ (PixiJS bỏ qua viewBox). */
export function iconViewBox(id: IconId): number {
  return VIEW_BOX[id] ?? 24;
}

/** Chuỗi SVG hoàn chỉnh của icon, sẵn sàng cho `innerHTML` (DOM) hoặc `Graphics#svg` (PixiJS). */
export function iconSvg(id: IconId, color: string): string {
  const style = FILLED.has(id)
    ? `fill="${color}" stroke="none"`
    : `fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`;
  const vb = iconViewBox(id);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" ${style}>${BODY[id].split('{c}').join(color)}</svg>`;
}
