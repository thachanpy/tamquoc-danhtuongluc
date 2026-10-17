import type { Faction, GemElement, PvpGemStats, PvpStyle } from '@tq/shared';

/** Màu & biểu tượng phe — dùng thống nhất cho DOM và PixiJS. */
export const FACTION_STYLE: Record<Faction, { color: number; css: string; dark: string; glyph: string }> = {
  wei: { color: 0x4a7bd8, css: '#4a7bd8', dark: '#1b2c52', glyph: '魏' },
  shu: { color: 0x3fae6a, css: '#3fae6a', dark: '#163d27', glyph: '蜀' },
  wu: { color: 0xd9534f, css: '#d9534f', dark: '#4d1b1a', glyph: '吳' },
  qun: { color: 0xa47ad6, css: '#a47ad6', dark: '#33224a', glyph: '群' },
};

/** Màu huy hiệu phong cách chiến đấu (mục 6.7) — nhãn lấy từ PVP_STYLE_LABELS. */
export const STYLE_COLOR: Record<PvpStyle, string> = {
  attack: '#ef6f6a',
  defense: '#5aa2ff',
  support: '#3fbf7f',
};

/** Bậc thẻ theo level (khung + màu chữ), theo bộ khung chủ dự án cung cấp. */
const TIERS: { css: string; color: number; label: string }[] = [
  { css: '#c98a5a', color: 0xc98a5a, label: 'Đồng' },
  { css: '#c4c9d2', color: 0xc4c9d2, label: 'Bạc' },
  { css: '#3fbf7f', color: 0x3fbf7f, label: 'Lục' },
  { css: '#e6bf45', color: 0xe6bf45, label: 'Vàng' },
  { css: '#ef5350', color: 0xef5350, label: 'Đỏ' },
  { css: '#5aa2ff', color: 0x5aa2ff, label: 'Huyền' },
  { css: '#b277ff', color: 0xb277ff, label: 'Tử' },
  { css: '#ff9441', color: 0xff9441, label: 'Cam' },
  { css: '#efe9da', color: 0xefe9da, label: 'Bạch kim' },
  { css: '#ffd76a', color: 0xffd76a, label: 'Kim cương' },
];

export function levelTier(level: number): { css: string; color: number; label: string } {
  return TIERS[Math.min(Math.max(level, 1), 10) - 1]!;
}

/**
 * Khung thẻ theo level: ảnh PNG trong suốt ở /frames/lv{n}.png (tách từ bộ khung tham chiếu).
 * left/top/width/height (%) đặt ảnh so với thân thẻ để phần lõi khung ôm sát thẻ;
 * phần trang trí (cánh, rồng, hào quang) ở Lv.6+ được phép tràn ra ngoài.
 * Số liệu đo tự động từ cạnh ngoài thanh khung (bộ khung chủ dự án cung cấp, bản 3).
 */
export const FRAME_LAYOUT: Record<number, { left: number; top: number; width: number; height: number }> = {
  1: { left: -1.17, top: -4.68, width: 102.34, height: 106.01 },
  2: { left: -1.74, top: -4.45, width: 103.78, height: 107.35 },
  3: { left: -1.74, top: -3.78, width: 104.06, height: 106.22 },
  4: { left: -2.33, top: -4.00, width: 104.96, height: 106.44 },
  5: { left: -2.32, top: -8.15, width: 104.64, height: 111.23 },
  6: { left: -12.61, top: -12.45, width: 124.64, height: 122.92 },
  7: { left: -13.70, top: -14.54, width: 126.53, height: 126.49 },
  8: { left: -11.99, top: -12.00, width: 124.27, height: 119.00 },
  9: { left: -13.65, top: -12.13, width: 128.49, height: 118.89 },
  10: { left: -13.12, top: -11.81, width: 126.24, height: 118.27 },
};
export const frameUrl = (level: number) => `/frames/lv${Math.min(Math.max(level, 1), 10)}.png`;

/**
 * Viên Ngọc Ngũ Hành: /gem/{artKey}_{cấp:2}.webp (bộ ảnh chủ dự án cung cấp).
 * Cấp ghi 2 chữ số (01→10). Thay artwork = thay file cùng tên. Thiếu ảnh thì chỗ hiển thị
 * tự rơi về viên Ngọc vẽ bằng CSS/PixiJS.
 */
const GEM_ART_KEY: Record<GemElement, string> = {
  kim: 'metal',
  moc: 'wood',
  thuy: 'water',
  hoa: 'fire',
  tho: 'earth',
};
/** Tăng khi thay bộ ảnh Ngọc để trình duyệt bỏ bản cũ (nginx cache /gem/ 7 ngày). */
const GEM_ART_VERSION = 2;
export const gemUrl = (element: GemElement, level: number) => {
  const lv = String(Math.min(Math.max(level, 1), 10)).padStart(2, '0');
  return `/gem/${GEM_ART_KEY[element]}_${lv}.webp?v=${GEM_ART_VERSION}`;
};

/**
 * Huy hiệu hạng ở bảng xếp hạng (mục 6.6): /theme/rank/r{n}.png cho các hạng đầu.
 * Hạng ngoài phạm vi có ảnh thì hiển thị số thường. Tăng RANK_ICON_VERSION khi thay bộ ảnh
 * (nginx cache /theme/ 7 ngày nên đổi query để trình duyệt lấy bản mới).
 */
const RANK_ICON_VERSION = 1;
export const RANK_ICON_MAX = 4;
export const rankIconUrl = (rank: number) => `/theme/rank/r${rank}.png?v=${RANK_ICON_VERSION}`;

/**
 * Chân dung tướng: /generals/{artKey}.webp (cắt từ bộ ảnh chủ dự án cung cấp).
 * Thay artwork = thay file cùng tên. Thiếu ảnh thì thẻ tự rơi về placeholder (glyph phe + chữ viết tắt).
 */
/** Tăng khi thay bộ chân dung để trình duyệt bỏ bản cũ (nginx cache /generals/ 7 ngày). */
const PORTRAIT_VERSION = 6;
export const portraitUrl = (artKey: string) => `/generals/${encodeURIComponent(artKey)}.webp?v=${PORTRAIT_VERSION}`;

/** Chữ viết tắt cho placeholder artwork (VD: "Gia Cát Lượng" -> "GCL"). Thay bằng ảnh thật theo artKey sau. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Số nguyên thì bỏ thập phân, ngược lại hiện tối đa 3 chữ số (đủ cho Lv9 = 0.005%). */
const fmtNum = (v: number) => (Number.isInteger(v) ? v.toFixed(0) : v.toFixed(3).replace(/\.?0+$/, ''));

/** Hiển thị bps thành % (10000 = 100%). */
export const pct = (bps: number, scale = 10000) => `${fmtNum((bps / scale) * 100)}%`;

/**
 * bps → ĐIỂM cho Chính xác · Né tránh · Xuyên giáp (1 điểm = 1%). Ba chỉ số này được đối chiếu
 * theo tỷ lệ giữa hai bên chứ không cộng thẳng vào % nên hiện theo điểm cho khỏi gây hiểu nhầm.
 * Ô tướng hiện con số trần (giống Giáp); dùng `ptText` khi cần kèm chữ "điểm".
 */
export const pt = (bps: number, scale = 10000) => fmtNum((bps / scale) * 100);

/** bps → "15 điểm" — dùng ở gợi ý / chi tiết chỉ số / nhật ký / trang Quản trị. */
export const ptText = (bps: number, scale = 10000) => `${pt(bps, scale)} điểm`;

/** Chỉ số Ngọc tính bằng ĐIỂM GIÁP nguyên (KHÔNG phải bps) — hiện chỉ có Thổ "Phòng thủ". */
const ARMOR_GEM_STATS = new Set<keyof PvpGemStats>(['defArmor']);
/** Chỉ số Ngọc hiện theo ĐIỂM (1 điểm = 1%) thay vì %: Xuyên giáp · Chính xác · Né tránh. */
const POINT_GEM_STATS = new Set<keyof PvpGemStats>(['defPenBps', 'hitBps', 'dodgeBps']);

/** Chỉ số Ngọc này tính bằng điểm Giáp nguyên (không quy ra %)? */
export const isArmorGemStat = (key: keyof PvpGemStats) => ARMOR_GEM_STATS.has(key);

/** Chỉ số Ngọc này hiện theo điểm (1 điểm = 1%) thay vì %? */
export const isPointGemStat = (key: keyof PvpGemStats) => POINT_GEM_STATS.has(key);

/** Hiển thị giá trị một chỉ số Ngọc: Giáp → "N Giáp", chỉ số đối kháng → "N điểm", còn lại → %. */
export const gemStatText = (key: keyof PvpGemStats, value: number, scale = 10000) =>
  isArmorGemStat(key) ? `${value} Giáp` : isPointGemStat(key) ? ptText(value, scale) : pct(value, scale);
