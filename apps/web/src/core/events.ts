import Phaser from 'phaser';

/**
 * Bus sự kiện chung giữa Scene Phaser (canvas) và lớp UI DOM overlay.
 *
 * Hai tầng này không gọi trực tiếp lẫn nhau: Scene phát sự kiện, lớp UI lắng nghe
 * (và ngược lại), nhờ đó tách rời phần hiển thị canvas khỏi phần giao diện HTML.
 */
export const GameEvents = {
  /** Tiến trình nạp tài nguyên ở Preload (0–1). */
  AssetsProgress: 'assets:progress',
  /** Nạp xong toàn bộ tài nguyên khởi động. */
  AssetsReady: 'assets:ready',
  /** Đổi tùy chọn âm thanh (bật/tắt hoặc âm lượng) của một kênh. */
  AudioPrefs: 'audio:prefs',
  /** Yêu cầu hiện thông báo nhanh (toast) ở lớp UI. */
  Toast: 'ui:toast',
} as const;

export type ToastTone = 'info' | 'success' | 'error';

export type ToastPayload = {
  message: string;
  tone?: ToastTone;
  /** Thời gian hiện (ms). Bỏ trống dùng mặc định của lớp UI. */
  durationMs?: number;
};

/** Kênh âm thanh độc lập: nhạc nền và hiệu ứng trận đấu. */
export type AudioChannel = 'music' | 'sfx';

/** Kiểu payload tương ứng từng sự kiện — `emit`/`on` kiểm tra kiểu theo khóa. */
export type GameEventPayloads = {
  'assets:progress': { value: number };
  'assets:ready': { failed: number };
  'audio:prefs': { channel: AudioChannel; on: boolean; volume: number };
  'ui:toast': ToastPayload;
};

export const bus = new Phaser.Events.EventEmitter();

/** Phát một sự kiện toàn cục. */
export function emit<K extends keyof GameEventPayloads>(event: K, payload: GameEventPayloads[K]): void {
  bus.emit(event, payload);
}

/** Lắng nghe sự kiện toàn cục; trả về hàm huỷ đăng ký (gọi khi scene/UI bị dỡ). */
export function on<K extends keyof GameEventPayloads>(event: K, fn: (payload: GameEventPayloads[K]) => void): () => void {
  const handler = (payload: GameEventPayloads[K]) => fn(payload);
  bus.on(event, handler);
  return () => {
    bus.off(event, handler);
  };
}
