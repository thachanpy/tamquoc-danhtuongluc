/**
 * Nhạc nền (chỉ trải nghiệm, không liên quan dữ liệu game).
 * - Danh sách bài trong TRACKS, phát kiểu xào bài: trộn ngẫu nhiên, nghe hết các bài rồi mới lặp; lần mở game sau
 *   không bắt đầu bằng bài vừa nghe lần trước.
 * - Bật/tắt và âm lượng được nhớ theo trình duyệt (localStorage).
 * - Trình duyệt chặn tự phát nhạc, nên nhạc chỉ bắt đầu sau lần chạm/bấm đầu tiên của người chơi.
 */
import { createSignal } from 'solid-js';

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
/**
 * Tạm nhường thiết bị âm thanh cho màn xem trận (`holdMusic`). Chỉ áp dụng trên thiết bị cảm ứng
 * (điện thoại/máy tính bảng): ở đó nhạc nền phát song song với tiếng trận làm trang bị hạ khung hình
 * nặng thêm (xem `sfx.ts`); máy tính để nguyên như cũ.
 */
let held = false;
const isTouch =
  typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

/** Nhạc có được phép phát ngay bây giờ không (đang bật, còn âm lượng, và không bị tạm nhường). */
const shouldPlay = () => prefs.on && prefs.volume > 0 && !held;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(pickNext());
    audio.preload = 'none';
    audio.volume = prefs.volume;
    // Hết bài: sang bài ngẫu nhiên khác
    audio.addEventListener('ended', () => {
      const a = audio!;
      a.src = pickNext();
      if (shouldPlay()) void a.play().catch(() => {});
    });
    // Bài lỗi/không tải được: thử bài khác (tránh vòng lặp vô hạn nếu chỉ có 1 bài)
    audio.addEventListener('error', () => {
      if (TRACKS.length < 2) return;
      const a = audio!;
      a.src = pickNext();
      if (shouldPlay()) void a.play().catch(() => {});
    });
  }
  return audio;
}

function sync() {
  if (!unlocked) return;
  const a = getAudio();
  a.volume = prefs.volume;
  if (shouldPlay()) void a.play().catch(() => {});
  else a.pause();
}

/**
 * Tạm dừng / phát lại nhạc nền khi mở-đóng màn xem trận (chỉ trên thiết bị cảm ứng).
 * Không đổi tuỳ chọn bật/tắt hay âm lượng của người chơi — chỉ tạm nhường thiết bị âm thanh.
 */
export function holdMusic(on: boolean) {
  const next = on && isTouch;
  if (held === next) return;
  held = next;
  if (!audio) return;
  if (held) audio.pause();
  else if (unlocked && shouldPlay()) void audio.play().catch(() => {});
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

/** Trạng thái nhạc cho UI (reactive): bật/tắt + âm lượng 0–1. */
const [prefsSig, setPrefsSig] = createSignal<Prefs>({ ...prefs });
export const musicPrefs = prefsSig;

function apply() {
  unlocked = true;
  savePrefs(prefs);
  sync();
  setPrefsSig({ ...prefs });
}

/** Bật/tắt nhạc nền (bật lại khi âm lượng đang 0 thì đặt về 40%). */
export function toggleMusic() {
  prefs.on = !prefs.on;
  if (prefs.on && prefs.volume === 0) prefs.volume = 0.4;
  apply();
}

/** Đặt âm lượng 0–1. */
export function setMusicVolume(v: number) {
  prefs.volume = Math.min(1, Math.max(0, v));
  apply();
}
