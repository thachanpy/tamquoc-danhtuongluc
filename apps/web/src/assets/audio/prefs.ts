import { STORAGE_KEYS } from '../../core/constants.ts';

/** Tùy chọn một kênh âm thanh: bật/tắt + âm lượng 0–1. */
export type AudioPrefs = { on: boolean; volume: number };

export const clampVolume = (value: number) => Math.min(1, Math.max(0, value));

/** Đọc tùy chọn đã lưu; hỏng/không đọc được thì dùng mặc định. */
export function loadAudioPrefs(storageKey: string, fallbackVolume: number): AudioPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) ?? '') as Partial<AudioPrefs>;
    return {
      on: raw.on !== false,
      volume: typeof raw.volume === 'number' ? clampVolume(raw.volume) : fallbackVolume,
    };
  } catch {
    return { on: true, volume: fallbackVolume };
  }
}

/** Lưu tùy chọn (bỏ qua khi trình duyệt chặn storage, ví dụ chế độ riêng tư). */
export function saveAudioPrefs(storageKey: string, prefs: AudioPrefs): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs));
  } catch {
    /* bỏ qua */
  }
}

export { STORAGE_KEYS };
