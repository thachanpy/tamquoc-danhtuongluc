import { musicPrefs, setMusicVolume, toggleMusic } from '../music.ts';

/** Nút bật/tắt nhạc nền hình trống trận (SVG; khi tắt có vạch son chéo) + thanh âm lượng. */
export function MusicControl() {
  const playing = () => musicPrefs().on && musicPrefs().volume > 0;
  const vol = () => Math.round(musicPrefs().volume * 100);
  return (
    <div class="music-ctl">
      <button
        class={`btn ghost small music-toggle ${playing() ? '' : 'muted'}`}
        type="button"
        title={playing() ? 'Tắt nhạc nền' : 'Bật nhạc nền'}
        aria-pressed={playing() ? 'true' : 'false'}
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
        value={vol()}
        disabled={!musicPrefs().on}
        style={{ '--p': `${vol()}%` }}
        onInput={(e) => setMusicVolume(Number(e.currentTarget.value) / 100)}
      />
    </div>
  );
}
