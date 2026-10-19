import Phaser from 'phaser';
import { SceneKeys } from '../core/SceneKeys.ts';

/**
 * Scene nền cho mọi trang giao diện (Bộ sưu tập, Quay thẻ, Chợ, Đấu trường…).
 *
 * Trang được dựng bằng DOM thật rồi gắn vào `<main id="page">` do `ShellScene` tạo — nhờ vậy
 * CSS cổ phong port nguyên từ bản cũ vẫn dùng được, và canvas Phaser chỉ lo phần hiệu ứng.
 * `create` gọi `build()` (dựng DOM) rồi `load()` (nạp dữ liệu); khi Scene dừng, mọi đăng ký
 * qua `track()` được dỡ bỏ và phần tử DOM bị xoá để không rò rỉ giữa các lần chuyển trang.
 */
export abstract class PageScene extends Phaser.Scene {
  private root?: HTMLElement;
  private disposers: (() => void)[] = [];

  protected constructor(key: string) {
    super(key);
  }

  /** Dựng nội dung trang; trả về phần tử gốc sẽ được gắn vào `<main id="page">`. */
  protected abstract build(): HTMLElement;

  /**
   * Id phần tử chứa trang. Mặc định `page` (vùng nội dung của khung Shell);
   * màn toàn màn hình không nằm trong khung (Đăng nhập) gắn thẳng vào `ui-root`.
   */
  protected hostId = 'page';

  /** Nạp dữ liệu và vẽ lần đầu. Chạy sau `build()`; mặc định không làm gì. */
  protected loadData(): void | Promise<void> {
    /* trang không cần nạp dữ liệu thì bỏ qua */
  }

  create(): void {
    const host = document.getElementById(this.hostId);
    if (!host) {
      console.warn(`[${this.scene.key}] thiếu #${this.hostId} — chưa có phần tử chứa?`);
      return;
    }
    this.root = this.build();
    host.appendChild(this.root);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      for (const d of this.disposers) d();
      this.disposers = [];
      this.root?.remove();
      this.root = undefined;
    });

    void this.loadData();
  }

  /** Đăng ký hàm dỡ (bỏ listener/interval/huỷ đăng ký state…) chạy khi rời trang. */
  protected track(dispose: () => void): void {
    this.disposers.push(dispose);
  }

  /**
   * Chạy lại `draw` mỗi khi state đổi; trả về hàm đọc dữ liệu đã vẽ.
   * Giữ nguyên hành vi "chỉ vẽ lại khi vào trang" của bản cũ, chỉ khác là không dùng reactive Solid.
   */
  protected rerender(draw: () => void): void {
    try {
      draw();
    } catch (e) {
      console.error(`[${this.scene.key}] lỗi vẽ lại`, e);
    }
  }

  /** Chuyển sang trang khác (giữ nguyên khung Shell). */
  protected go(key: string): void {
    if (key === this.scene.key) return;
    this.scene.start(key);
  }

  /** Về trang Bộ sưu tập — đích mặc định khi người chơi không có quyền vào trang hiện tại. */
  protected goHome(): void {
    this.go(SceneKeys.Collection);
  }
}
