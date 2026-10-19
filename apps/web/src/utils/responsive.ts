import Phaser from 'phaser';
import { ARENA, BREAKPOINTS } from '../core/constants.ts';

/** Nhóm bố cục theo bề rộng khung. */
export type LayoutKind = 'mobile' | 'tablet' | 'desktop';

export type Viewport = {
  width: number;
  height: number;
  /** Khung cao hơn rộng (điện thoại dựng đứng). */
  portrait: boolean;
  layout: LayoutKind;
};

/** Phân loại khung hiện tại (dùng chung cho mọi scene). */
export function viewportFor(width: number, height: number): Viewport {
  const layout: LayoutKind =
    width <= BREAKPOINTS.mobile ? 'mobile' : width <= BREAKPOINTS.tablet ? 'tablet' : 'desktop';
  return { width, height, portrait: height >= width, layout };
}

/**
 * Bố cục sân đấu PvP theo bề rộng khung (mục 6.7): màn ≤640px dùng bản dọc
 * để ô tướng to hơn; rộng hơn dùng bản ngang.
 */
export function arenaLayoutFor(width: number): 'portrait' | 'landscape' {
  return width <= BREAKPOINTS.mobile ? 'portrait' : 'landscape';
}

/** Kích thước gốc của bố cục sân đấu. */
export function arenaSizeFor(layout: 'portrait' | 'landscape'): { width: number; height: number } {
  return ARENA[layout];
}

/**
 * Theo dõi thay đổi kích thước khung. Gọi `fn` ngay một lần với khung hiện tại,
 * sau đó mỗi khi khung đổi kích thước. Trả về hàm huỷ (gọi khi scene shutdown).
 */
export function onViewportChange(scene: Phaser.Scene, fn: (viewport: Viewport) => void): () => void {
  const handler = (gameSize: Phaser.Structs.Size) => fn(viewportFor(gameSize.width, gameSize.height));
  scene.scale.on(Phaser.Scale.Events.RESIZE, handler);
  fn(viewportFor(scene.scale.width, scene.scale.height));
  return () => {
    scene.scale.off(Phaser.Scale.Events.RESIZE, handler);
  };
}
