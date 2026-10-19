import Phaser from 'phaser';
import { TARGET_FPS } from './constants.ts';
import { BootScene } from '../scenes/BootScene.ts';
import { PreloadScene } from '../scenes/PreloadScene.ts';
import { LoginScene } from '../scenes/LoginScene.ts';
import { ShellScene } from '../scenes/ShellScene.ts';
import { CollectionScene } from '../scenes/CollectionScene.ts';
import { DrawScene } from '../scenes/DrawScene.ts';
import { UpgradeScene } from '../scenes/UpgradeScene.ts';
import { MarketScene } from '../scenes/MarketScene.ts';
import { QuestsScene } from '../scenes/QuestsScene.ts';
import { LeaderboardScene } from '../scenes/LeaderboardScene.ts';
import { HistoryScene } from '../scenes/HistoryScene.ts';
import { GiftCodeScene } from '../scenes/GiftCodeScene.ts';
import { ProfileScene } from '../scenes/ProfileScene.ts';
import { AdminScene } from '../scenes/AdminScene.ts';

/**
 * Cấu hình `Phaser.Game` cho toàn bộ game.
 *
 * - `Phaser.Scale.RESIZE`: canvas luôn khớp kích thước phần tử cha (`#game-root`),
 *   nhờ đó giao diện tự scale đúng trên cả mobile và desktop. Các Scene lắng nghe
 *   sự kiện `resize` để bố trí lại phần tử khi khung đổi kích thước.
 * - `fps.target = 60`: giới hạn FPS để tránh lag/hao pin trên thiết bị iOS màn hình ProMotion.
 * - `dom.createContainer = true`: cho phép dùng Phaser DOM Element chèn HTML/CSS đè lên canvas
 *   (phục vụ chiến lược UI hybrid).
 */
export function createGame(): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game-root',
    // Canvas TRONG SUỐT: nền thủy mặc do DOM (body + `#ui-root`) đảm nhiệm, chỉ những
    // Scene cần hình nền riêng (Đấu trường) mới tự vẽ. Nhờ vậy lớp UI HTML nằm đè khớp liền mạch.
    transparent: true,
    disableContextMenu: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: true,
      powerPreference: 'high-performance',
    },
    dom: { createContainer: true },
    fps: { target: TARGET_FPS },
    // Thứ tự: phần tử đầu chạy trước; các scene màn hình được thêm dần khi port từng trang.
    scene: [
      BootScene,
      PreloadScene,
      LoginScene,
      ShellScene,
      CollectionScene,
      DrawScene,
      UpgradeScene,
      MarketScene,
      QuestsScene,
      LeaderboardScene,
      HistoryScene,
      GiftCodeScene,
      ProfileScene,
      AdminScene,
    ],
  });
}
