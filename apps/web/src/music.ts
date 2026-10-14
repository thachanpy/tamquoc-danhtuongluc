/**
 * Nhạc nền (chỉ trải nghiệm, không liên quan dữ liệu game).
 * - Danh sách bài trong TRACKS, phát kiểu xào bài: trộn ngẫu nhiên, nghe hết các bài rồi mới lặp; lần mở game sau
 *   không bắt đầu bằng bài vừa nghe lần trước.
 * - Bật/tắt và âm lượng được nhớ theo trình duyệt (localStorage).
 * - Trình duyệt chặn tự phát nhạc, nên nhạc chỉ bắt đầu sau lần chạm/bấm đầu tiên của người chơi.
 */
const KEY = 'tq.music';
type Prefs = { on: boolean; volume: number };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<Prefs>;
    return { on: p.on !== false, volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 0.4 };
  } catch {
    return { on: true, volume: 0.4 };
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* bỏ qua: chế độ riêng tư / bị chặn storage */
  }
}

/** Thêm/bớt bài = thêm/bớt file trong public/audio và sửa danh sách này. */
const TRACKS = ['/audio/b1.mp3', '/audio/b2.mp3', '/audio/b3.mp3', '/audio/b4.mp3'];
const LAST_KEY = 'tq.music.last';

/**
 * Phát kiểu "xào bài": trộn ngẫu nhiên toàn bộ danh sách, nghe hết lượt rồi mới trộn lại.
 * Bài đầu tiên của lượt mới không trùng bài vừa nghe; bài vừa nghe được nhớ qua các lần mở game
 * (localStorage) nên mỗi lần vào game không bắt đầu bằng cùng một bài.
 */
let queue: number[] = [];
let current = readLast();

function readLast(): number {
  try {
    const i = Number(localStorage.getItem(LAST_KEY));
    return Number.isInteger(i) && i >= 0 && i < TRACKS.length ? i : -1;
  } catch {
    return -1;
  }
}

function shuffled(): number[] {
  const a = TRACKS.map((_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  // Không mở lượt mới bằng đúng bài vừa nghe
  if (a.length > 1 && a[0] === current) [a[0], a[a.length - 1]] = [a[a.length - 1]!, a[0]!];
  return a;
}

function pickNext(): string {
  if (!queue.length) queue = shuffled();
  current = queue.shift()!;
  try {
    localStorage.setItem(LAST_KEY, String(current));
  } catch {
    /* bỏ qua */
  }
  return TRACKS[current]!;
}

const prefs = loadPrefs();
let audio: HTMLAudioElement | null = null;
let unlocked = false;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(pickNext());
    audio.preload = 'none';
    audio.volume = prefs.volume;
    // Hết bài: sang bài ngẫu nhiên khác
    audio.addEventListener('ended', () => {
      const a = audio!;
      a.src = pickNext();
      if (prefs.on && prefs.volume > 0) void a.play().catch(() => {});
    });
    // Bài lỗi/không tải được: thử bài khác (tránh vòng lặp vô hạn nếu chỉ có 1 bài)
    audio.addEventListener('error', () => {
      if (TRACKS.length < 2) return;
      const a = audio!;
      a.src = pickNext();
      if (prefs.on && prefs.volume > 0) void a.play().catch(() => {});
    });
  }
  return audio;
}

function sync() {
  if (!unlocked) return;
  const a = getAudio();
  a.volume = prefs.volume;
  if (prefs.on && prefs.volume > 0) void a.play().catch(() => {});
  else a.pause();
}

/** Gọi 1 lần khi khởi động: chờ tương tác đầu tiên rồi mới phát. */
export function initMusic() {
  const unlock = () => {
    unlocked = true;
    sync();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Biểu tượng trống trận (chiến cổ) vẽ bằng SVG, màu theo currentColor; khi tắt có vạch son chéo. */
const DRUM_SVG = `<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
    <ellipse cx="16" cy="12" rx="10" ry="4" fill="currentColor" fill-opacity=".18"/>
    <path d="M6 12v9c0 2.2 4.5 4 10 4s10-1.8 10-4v-9"/>
    <path d="M9 15.3v8M13 16.2v8.4M19 16.2v8.4M23 15.3v8" stroke-width="1.1" opacity=".7"/>
    <path d="M7 4.5l7.5 6M25 4.5l-7.5 6" stroke-width="2"/>
  </g>
  <circle cx="6.5" cy="4" r="1.8" fill="currentColor"/><circle cx="25.5" cy="4" r="1.8" fill="currentColor"/>
  <path class="mute-slash" d="M4 28L28 4" stroke="#d8432f" stroke-width="3" stroke-linecap="round"/>
</svg>`;

/** Gắn nút bật/tắt + thanh âm lượng vào phần tử cho trước. */
export function mountMusicControl(el: HTMLElement) {
  el.className = 'music-ctl';
  el.innerHTML = `
    <button class="btn ghost small music-toggle" type="button"></button>
    <input class="music-vol" type="range" min="0" max="100" step="1" aria-label="Âm lượng nhạc nền" />`;
  const btn = el.querySelector<HTMLButtonElement>('.music-toggle')!;
  const vol = el.querySelector<HTMLInputElement>('.music-vol')!;
  const draw = () => {
    const playing = prefs.on && prefs.volume > 0;
    btn.innerHTML = DRUM_SVG;
    btn.classList.toggle('muted', !playing);
    btn.title = playing ? 'Tắt nhạc nền' : 'Bật nhạc nền';
    btn.setAttribute('aria-pressed', String(playing));
    vol.value = String(Math.round(prefs.volume * 100));
    vol.style.setProperty('--p', `${vol.value}%`);
    vol.disabled = !prefs.on;
  };
  btn.onclick = () => {
    prefs.on = !prefs.on;
    if (prefs.on && prefs.volume === 0) prefs.volume = 0.4;
    unlocked = true;
    savePrefs(prefs);
    sync();
    draw();
  };
  vol.oninput = () => {
    prefs.volume = Number(vol.value) / 100;
    unlocked = true;
    savePrefs(prefs);
    sync();
    draw();
  };
  draw();
}
