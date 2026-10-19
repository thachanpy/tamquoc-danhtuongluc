import { musicPrefs, setMusicVolume, toggleMusic, sfxPrefs, setSfxVolume, toggleSfx } from '../assets/audio/index.ts';
import { h } from './dom.ts';

/** Biểu tượng trống trận (nhạc nền) — vẽ bằng SVG, vạch son chéo hiện khi tắt. */
const MUSIC_SVG = `<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <ellipse cx="16" cy="12" rx="10" ry="4" fill="currentColor" fill-opacity=".18" />
    <path d="M6 12v9c0 2.2 4.5 4 10 4s10-1.8 10-4v-9" />
    <path d="M9 15.3v8M13 16.2v8.4M19 16.2v8.4M23 15.3v8" stroke-width="1.1" opacity=".7" />
    <path d="M7 4.5l7.5 6M25 4.5l-7.5 6" stroke-width="2" />
  </g>
  <circle cx="6.5" cy="4" r="1.8" fill="currentColor" />
  <circle cx="25.5" cy="4" r="1.8" fill="currentColor" />
  <path class="mute-slash" d="M4 28L28 4" stroke="#d8432f" stroke-width="3" stroke-linecap="round" />
</svg>`;

/** Biểu tượng loa (hiệu ứng trận đấu). */
const SFX_SVG = `<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <path d="M6 12v8h5l6 5V7l-6 5H6z" fill="currentColor" fill-opacity=".18" />
    <path d="M21 12.5a6 6 0 0 1 0 7M24.5 9.5a10.5 10.5 0 0 1 0 13" stroke-width="1.6" />
  </g>
  <path class="mute-slash" d="M4 28L28 4" stroke="#d8432f" stroke-width="3" stroke-linecap="round" />
</svg>`;

/**
 * Cụm điều khiển âm thanh ở thanh trên: nhạc nền (trống trận) và hiệu ứng trận đấu.
 * Mỗi nhóm có nút bật/tắt (tắt thì hiện vạch son chéo) + thanh âm lượng riêng.
 */
export function audioControl(): HTMLElement {
  const musicBtn = h('button', { class: 'btn ghost small music-toggle', attrs: { type: 'button' }, html: MUSIC_SVG });
  const musicVol = h('input', { class: 'music-vol', attrs: { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Âm lượng nhạc nền' } });
  const sfxBtn = h('button', { class: 'btn ghost small sfx-toggle', attrs: { type: 'button' }, html: SFX_SVG });
  const sfxVol = h('input', { class: 'sfx-vol', attrs: { type: 'range', min: '0', max: '100', step: '1', 'aria-label': 'Âm lượng hiệu ứng trận đấu' } });

  /** Đồng bộ trạng thái nút/thanh trượt theo tùy chọn hiện tại. */
  const sync = (): void => {
    const m = musicPrefs();
    const s = sfxPrefs();
    const musicOn = m.on && m.volume > 0;
    const sfxOn = s.on && s.volume > 0;
    const mv = Math.round(m.volume * 100);
    const sv = Math.round(s.volume * 100);

    musicBtn.classList.toggle('muted', !musicOn);
    musicBtn.title = musicOn ? 'Tắt nhạc nền' : 'Bật nhạc nền';
    musicBtn.setAttribute('aria-pressed', musicOn ? 'true' : 'false');
    musicVol.value = String(mv);
    musicVol.disabled = !m.on;
    musicVol.style.setProperty('--p', `${mv}%`);

    sfxBtn.classList.toggle('muted', !sfxOn);
    sfxBtn.title = sfxOn ? 'Tắt hiệu ứng âm thanh trận đấu' : 'Bật hiệu ứng âm thanh trận đấu';
    sfxBtn.setAttribute('aria-pressed', sfxOn ? 'true' : 'false');
    sfxVol.value = String(sv);
    sfxVol.disabled = !s.on;
    sfxVol.style.setProperty('--p', `${sv}%`);
  };

  musicBtn.addEventListener('click', () => {
    toggleMusic();
    sync();
  });
  musicVol.addEventListener('input', () => {
    setMusicVolume(Number(musicVol.value) / 100);
    sync();
  });
  sfxBtn.addEventListener('click', () => {
    toggleSfx();
    sync();
  });
  sfxVol.addEventListener('input', () => {
    setSfxVolume(Number(sfxVol.value) / 100);
    sync();
  });

  sync();
  return h('div', { class: 'music-ctl' }, musicBtn, musicVol, sfxBtn, sfxVol);
}
