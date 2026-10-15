import { musicPrefs, setMusicVolume, toggleMusic } from '../music.ts';
import { setSfxVolume, sfxPrefs, toggleSfx } from '../sfx.ts';

/**
 * Cụm điều khiển âm thanh ở thanh trên: nhạc nền (trống trận) và hiệu ứng trận đấu.
 * Mỗi nhóm có nút bật/tắt (khi tắt hiện vạch son chéo) + thanh âm lượng riêng.
 */
export function MusicControl() {
  const musicOn = () => musicPrefs().on && musicPrefs().volume > 0;
  const musicVol = () => Math.round(musicPrefs().volume * 100);
  const sfxOn = () => sfxPrefs().on && sfxPrefs().volume > 0;
  const sfxVol = () => Math.round(sfxPrefs().volume * 100);
  return (
    <div class="music-ctl">
      <button
        class={`btn ghost small music-toggle ${musicOn() ? '' : 'muted'}`}
        type="button"
        title={musicOn() ? 'Tắt nhạc nền' : 'Bật nhạc nền'}
        aria-pressed={musicOn() ? 'true' : 'false'}
        onClick={toggleMusic}
      >
        <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <ellipse cx="16" cy="12" rx="10" ry="4" fill="currentColor" fill-opacity=".18" />
            <path d="M6 12v9c0 2.2 4.5 4 10 4s10-1.8 10-4v-9" />
            <path d="M9 15.3v8M13 16.2v8.4M19 16.2v8.4M23 15.3v8" stroke-width="1.1" opacity=".7" />
            <path d="M7 4.5l7.5 6M25 4.5l-7.5 6" stroke-width="2" />
          </g>
          <circle cx="6.5" cy="4" r="1.8" fill="currentColor" />
          <circle cx="25.5" cy="4" r="1.8" fill="currentColor" />
          <path class="mute-slash" d="M4 28L28 4" stroke="#d8432f" stroke-width="3" stroke-linecap="round" />
        </svg>
      </button>
      <input
        class="music-vol"
        type="range"
        min="0"
        max="100"
        step="1"
        aria-label="Âm lượng nhạc nền"
        value={musicVol()}
        disabled={!musicPrefs().on}
        style={{ '--p': `${musicVol()}%` }}
        onInput={(e) => setMusicVolume(Number(e.currentTarget.value) / 100)}
      />
      <button
        class={`btn ghost small sfx-toggle ${sfxOn() ? '' : 'muted'}`}
        type="button"
        title={sfxOn() ? 'Tắt hiệu ứng âm thanh trận đấu' : 'Bật hiệu ứng âm thanh trận đấu'}
        aria-pressed={sfxOn() ? 'true' : 'false'}
        onClick={toggleSfx}
      >
        <svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
          <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M6 12v8h5l6 5V7l-6 5H6z" fill="currentColor" fill-opacity=".18" />
            <path d="M21 12.5a6 6 0 0 1 0 7M24.5 9.5a10.5 10.5 0 0 1 0 13" stroke-width="1.6" />
          </g>
          <path class="mute-slash" d="M4 28L28 4" stroke="#d8432f" stroke-width="3" stroke-linecap="round" />
        </svg>
      </button>
      <input
        class="sfx-vol"
        type="range"
        min="0"
        max="100"
        step="1"
        aria-label="Âm lượng hiệu ứng trận đấu"
        value={sfxVol()}
        disabled={!sfxPrefs().on}
        style={{ '--p': `${sfxVol()}%` }}
        onInput={(e) => setSfxVolume(Number(e.currentTarget.value) / 100)}
      />
    </div>
  );
}
