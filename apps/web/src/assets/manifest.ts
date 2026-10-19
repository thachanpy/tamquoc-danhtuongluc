import type { GemElement } from '@tq/shared';
import { frameUrl, gemUrl, portraitUrl, rankIconUrl, RANK_ICON_MAX } from './art.ts';

/**
 * Danh mục tài nguyên (một nguồn sự thật cho khóa texture + đường dẫn).
 *
 * Chia ba nhóm theo thời điểm nạp:
 * - `CORE_IMAGES`: nhỏ, dùng ở mọi màn → nạp ngay ở Preload (có thanh tiến trình).
 * - `MUSIC_TRACKS` / `SFX_CLIPS`: nạp sau lần tương tác đầu tiên (trình duyệt chặn
 *   tự phát âm thanh trước đó) — xem `assets/audio`.
 * - Chân dung tướng (18MB) và Ngọc chỉ nạp khi cần qua `AssetService` — nạp trước toàn bộ
 *   sẽ làm chậm hẳn lần mở đầu tiên trên mobile.
 */
export type ImageAsset = { key: string; url: string };

const clampLevel = (level: number) => Math.min(10, Math.max(1, Math.round(level)));

/** Khóa texture trong Texture Manager của Phaser. */
export const TexKeys = {
  appIcon: (size: 32 | 192 | 512) => `icon-${size}`,
  cardBack: 'theme-card-back',
  landscape: 'theme-landscape',
  fret: 'theme-fret',
  corner: (corner: 'tl' | 'tr' | 'bl' | 'br') => `theme-corner-${corner}`,
  frame: (level: number) => `frame-lv${clampLevel(level)}`,
  rankIcon: (rank: number) => `rank-${rank}`,
  portrait: (artKey: string) => `portrait-${artKey}`,
  gem: (element: GemElement, level: number) =>
    `gem-${element}-${String(clampLevel(level)).padStart(2, '0')}`,
} as const;

/** Bốn góc trang trí + đường diềm khung giao diện cổ phong. */
const CORNERS: readonly ('tl' | 'tr' | 'bl' | 'br')[] = ['tl', 'tr', 'bl', 'br'];

/** Tài nguyên nạp ngay khi khởi động: khung thẻ, khung thân, huy hiệu hạng, biểu tượng app. */
export const CORE_IMAGES: readonly ImageAsset[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => ({ key: TexKeys.frame(level), url: frameUrl(level) })),
  { key: TexKeys.cardBack, url: '/theme/card-back.webp' },
  { key: TexKeys.landscape, url: '/theme/landscape.svg' },
  { key: TexKeys.fret, url: '/theme/fret.svg' },
  ...CORNERS.map((corner) => ({ key: TexKeys.corner(corner), url: `/theme/corner-${corner}.svg` })),
  ...Array.from({ length: RANK_ICON_MAX }, (_, i) => ({ key: TexKeys.rankIcon(i + 1), url: rankIconUrl(i + 1) })),
  { key: TexKeys.appIcon(192), url: '/icons/icon-192.png' },
  { key: TexKeys.appIcon(512), url: '/icons/icon-512.png' },
];

/** Thêm/bớt bài = thêm/bớt file trong `public/audio` và sửa danh sách này. */
export const MUSIC_TRACKS: readonly string[] = ['/audio/b1.mp3', '/audio/b2.mp3', '/audio/b3.mp3', '/audio/b4.mp3'];

/** Thêm/bớt clip = thêm/bớt file trong `public/audio/sfx` và sửa danh sách này. */
export const SFX_CLIPS = {
  attackNormal: '/audio/sfx/sfx_attack_normal.wav',
  attackCrit: '/audio/sfx/sfx_attack_crit.wav',
  buff: '/audio/sfx/sfx_buff_damage.wav',
  burn: '/audio/sfx/sfx_burn.wav',
  counter: '/audio/sfx/sfx_counter.wav',
  death: '/audio/sfx/sfx_death.wav',
  dispel: '/audio/sfx/sfx_dispel.wav',
  dodge: '/audio/sfx/sfx_dodge.wav',
  heal: '/audio/sfx/sfx_heal.wav',
  lifesteal: '/audio/sfx/sfx_lifesteal.wav',
  stun: '/audio/sfx/sfx_stun.wav',
} as const;

export type SfxName = keyof typeof SFX_CLIPS;

/** Tài nguyên nạp theo nhu cầu. */
export const portraitAsset = (artKey: string): ImageAsset => ({
  key: TexKeys.portrait(artKey),
  url: portraitUrl(artKey),
});

export const gemAsset = (element: GemElement, level: number): ImageAsset => ({
  key: TexKeys.gem(element, level),
  url: gemUrl(element, level),
});
