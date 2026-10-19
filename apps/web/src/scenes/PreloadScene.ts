import Phaser from 'phaser';
import { SceneKeys } from '../core/SceneKeys.ts';
import { emit, GameEvents } from '../core/events.ts';
import { APP_NAME } from '../core/constants.ts';
import { CORE_IMAGES } from '../assets/manifest.ts';
import { hasToken } from '../services/http.ts';
import { bootstrapSession } from '../state/session.ts';
import { onViewportChange, type Viewport } from '../utils/responsive.ts';

/** Kích thước thanh tiến trình (px) — bề rộng co theo khung nhưng không vượt quá `maxWidth`. */
const BAR = { height: 14, maxWidth: 520, widthRatio: 0.72, radius: 7 } as const;

/**
 * Preload: nạp tài nguyên khởi động và hiện tiến trình, sau đó bàn giao cho màn kế tiếp.
 *
 * Chỉ nạp nhóm `CORE_IMAGES` (khung thẻ, khung nền, huy hiệu hạng, biểu tượng — vài trăm KB).
 * Chân dung tướng (~18MB) và Ngọc nạp theo nhu cầu ở từng màn qua `AssetService.ensureTexture`,
 * vì nạp trước toàn bộ sẽ làm chậm hẳn lần mở đầu tiên trên mobile. Âm thanh cũng nạp sau lần
 * tương tác đầu tiên (trình duyệt chặn tự phát) — xem `assets/audio`.
 */
export class PreloadScene extends Phaser.Scene {
  private titleText!: Phaser.GameObjects.Text;
  private percentText!: Phaser.GameObjects.Text;
  private noteText!: Phaser.GameObjects.Text;
  private barFrame!: Phaser.GameObjects.Graphics;
  private barFill!: Phaser.GameObjects.Graphics;

  private viewport!: Viewport;
  /** Vùng vẽ của phần đã nạp — tính lại mỗi lần khung đổi kích thước. */
  private barGeometry = { x: 0, y: 0, width: 0 };
  private value = 0;
  private failed = 0;
  private stopResize?: () => void;

  constructor() {
    super(SceneKeys.Preload);
  }

  preload(): void {
    this.buildUi();

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      this.setProgress(value);
      emit(GameEvents.AssetsProgress, { value });
    });

    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      // Thiếu tài nguyên KHÔNG chặn vào game: chỗ hiển thị tự rơi về placeholder.
      this.failed += 1;
      console.warn(`[preload] không nạp được tài nguyên: ${file.key} (${file.src})`);
    });

    for (const asset of CORE_IMAGES) this.load.image(asset.key, asset.url);
  }

  create(): void {
    this.setProgress(1);
    this.noteText.setText(this.failed === 0 ? 'Sẵn sàng' : `Sẵn sàng — thiếu ${this.failed} tài nguyên`);
    emit(GameEvents.AssetsReady, { failed: this.failed });
    void this.enter();
  }

  /**
   * Quyết định màn kế tiếp: còn token thì thử khởi tạo phiên rồi vào thẳng khung game,
   * ngược lại (hoặc phiên hết hạn) thì mở màn Đăng nhập — kèm lý do nếu vừa hết hạn.
   */
  private async enter(): Promise<void> {
    if (!hasToken()) {
      this.scene.start(SceneKeys.Login);
      return;
    }
    const res = await bootstrapSession();
    if (res.ok) this.scene.start(SceneKeys.Shell);
    else this.scene.start(SceneKeys.Login, { message: res.message });
  }

  /** Dựng các thành phần hiển thị (chạy trong `preload` để thấy ngay khi tài nguyên đang tải). */
  private buildUi(): void {
    this.barFrame = this.add.graphics();
    this.barFill = this.add.graphics();

    this.titleText = this.add
      .text(0, 0, APP_NAME, {
        fontFamily: 'Playfair Display SC, Noto Serif, Georgia, serif',
        fontSize: '30px',
        color: '#e6bf45',
      })
      .setOrigin(0.5);

    this.percentText = this.add
      .text(0, 0, '0%', {
        fontFamily: 'Oswald, Noto Serif, sans-serif',
        fontSize: '16px',
        color: '#e8dcc0',
      })
      .setOrigin(0.5);

    this.noteText = this.add
      .text(0, 0, 'Đang nạp tài nguyên…', {
        fontFamily: 'Noto Serif, Georgia, serif',
        fontSize: '13px',
        color: '#9c8f76',
      })
      .setOrigin(0.5);

    this.stopResize = onViewportChange(this, (viewport) => {
      this.viewport = viewport;
      this.layout();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stopResize?.();
      this.stopResize = undefined;
    });
  }

  /** Đặt lại vị trí mọi thành phần theo khung hiện tại (mobile ≤640px dùng thanh hẹp hơn). */
  private layout(): void {
    const { width, height } = this.viewport;
    const barWidth = Math.min(BAR.maxWidth, width * BAR.widthRatio);
    const centerX = width / 2;
    const barX = centerX - barWidth / 2;
    const barY = height * 0.62;

    this.titleText.setPosition(centerX, height * 0.4).setFontSize(width <= 640 ? 24 : 30);
    this.barFrame.clear();
    this.barFrame.fillStyle(0x000000, 0.45);
    this.barFrame.fillRoundedRect(barX, barY, barWidth, BAR.height, BAR.radius);
    this.barFrame.lineStyle(1, 0xe6bf45, 0.5);
    this.barFrame.strokeRoundedRect(barX, barY, barWidth, BAR.height, BAR.radius);

    this.percentText.setPosition(centerX, barY + BAR.height + 18);
    this.noteText.setPosition(centerX, barY + BAR.height + 40);

    this.barGeometry = { x: barX, y: barY, width: barWidth };
    this.drawFill();
  }

  private setProgress(value: number): void {
    this.value = Phaser.Math.Clamp(value, 0, 1);
    this.percentText.setText(`${Math.round(this.value * 100)}%`);
    this.drawFill();
  }

  private drawFill(): void {
    const { x, y, width } = this.barGeometry;
    this.barFill.clear();
    if (width <= 0 || this.value <= 0) return;
    // Chừa 2px mỗi bên để phần đã nạp nằm gọn trong viền khung.
    const inner = Math.max(0, width - 4);
    const filled = inner * this.value;
    if (filled <= 0) return;
    this.barFill.fillStyle(0x6fbe73, 1);
    this.barFill.fillRoundedRect(x + 2, y + 2, filled, BAR.height - 4, Math.min(BAR.radius, filled / 2));
  }
}
