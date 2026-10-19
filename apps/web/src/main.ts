import './styles/base.css';
import './styles/style.css';
import './styles/theme.css';
import { createGame } from './core/GameConfig.ts';
import { addSparks } from './ui/effects.ts';

/**
 * Điểm khởi động frontend (Phaser + TypeScript + Vite + PWA).
 * Trước đây là `main.tsx` của SolidJS — nay chỉ tạo một `Phaser.Game` duy nhất
 * và để các Scene lo phần hiển thị. Lớp UI HTML nằm trong `#ui-root` (xem `ui/`).
 */

// Tia lửa 4 màu phe bay lên ở nền (chỉ trang trí, không bắt sự kiện chuột).
addSparks();

const game = createGame();

// Vite HMR: huỷ game cũ khi nạp lại module để tránh chồng nhiều canvas/service.
if (import.meta.hot) {
  import.meta.hot.dispose(() => game.destroy(true));
}
