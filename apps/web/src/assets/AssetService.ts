import Phaser from 'phaser';
import type { ImageAsset } from './manifest.ts';

/**
 * Nạp texture theo nhu cầu (chân dung tướng, viên Ngọc) vào Texture Manager của Phaser.
 *
 * Chân dung tướng chiếm ~18MB nên không nạp trước toàn bộ; thẻ nào sắp hiện thì nạp thẻ đó.
 * Texture nằm trong cache DÙNG CHUNG giữa mọi scene nên chỉ tải một lần cho cả phiên chơi.
 */
const inflight = new Map<string, Promise<void>>();

/** Bảo đảm texture đã có trong cache; nạp nếu thiếu (không nạp trùng khi gọi song song). */
export function ensureTexture(scene: Phaser.Scene, asset: ImageAsset): Promise<void> {
  if (scene.textures.exists(asset.key)) return Promise.resolve();

  const running = inflight.get(asset.key);
  if (running) return running;

  const task = new Promise<void>((resolve) => {
    const completeEvent = `filecomplete-image-${asset.key}`;

    const onLoadError = (file: Phaser.Loader.File) => {
      // Thiếu file / lỗi mạng: bỏ qua để chỗ hiển thị tự rơi về placeholder, không treo UI.
      if (file.key !== asset.key) return;
      finish();
    };

    function finish() {
      scene.load.off(completeEvent, finish);
      scene.load.off(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
      resolve();
    }

    scene.load.once(completeEvent, finish);
    scene.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, onLoadError);
    scene.load.image(asset.key, asset.url);

    // Ngoài `preload()` phải tự khởi động Loader; nếu đang chạy thì file mới vào chung lượt đó.
    try {
      if (!scene.load.isLoading()) scene.load.start();
    } catch {
      /* Loader đang chạy — file vừa thêm sẽ được xử lý trong lượt hiện tại */
    }
  }).finally(() => inflight.delete(asset.key));

  inflight.set(asset.key, task);
  return task;
}

/**
 * Nạp trước lần lượt một nhóm texture. `onProgress` nhận số lượng đã xong để hiện tiến trình.
 * Dùng cho màn cần nhiều ảnh cùng lúc (bộ sưu tập, chợ thẻ) mà vẫn nạp theo nhu cầu.
 */
export async function ensureTextures(
  scene: Phaser.Scene,
  assets: readonly ImageAsset[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  let done = 0;
  for (const asset of assets) {
    await ensureTexture(scene, asset);
    done += 1;
    onProgress?.(done, assets.length);
  }
}
