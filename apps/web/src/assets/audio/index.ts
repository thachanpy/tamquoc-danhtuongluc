import { initMusic } from './music.ts';
import { initSfx } from './sfx.ts';

/**
 * Khởi động cả hai kênh âm thanh (nhạc nền + hiệu ứng trận đấu).
 * Chỉ gắn listener chờ tương tác đầu tiên — trình duyệt (nhất là iOS) chặn tự phát âm thanh.
 */
let started = false;

export function initAudio(): void {
  if (started) return;
  started = true;
  initMusic();
  initSfx();
}

export { toggleMusic, setMusicVolume, musicPrefs } from './music.ts';
export { playSfx, stopAllSfx, toggleSfx, setSfxVolume, ensureSfxOn, sfxPrefs, sharedAudioContext } from './sfx.ts';
export type { AudioPrefs } from './prefs.ts';
