import { STORAGE_KEYS } from '../../core/constants.ts';
import { emit, GameEvents } from '../../core/events.ts';
import { MUSIC_TRACKS } from '../manifest.ts';
import { clampVolume, loadAudioPrefs, saveAudioPrefs, type AudioPrefs } from './prefs.ts';
import { sharedAudioContext } from './sfx.ts';

/**
 * Nhạc nền (chỉ trải nghiệm, không liên quan dữ liệu game).
 * - Danh sách bài trong `MUSIC_TRACKS`; phát kiểu xào bài: trộn ngẫu nhiên, nghe hết các bài rồi mới lặp;
 *   lần mở game sau không bắt đầu bằng bài vừa nghe lần trước.
 * - Bật/tắt và âm lượng được nhớ theo trình duyệt (localStorage).
 * - Trình duyệt chặn tự phát nhạc, nên nhạc chỉ bắt đầu sau lần chạm/bấm đầu tiên của người chơi.
 * - Thẻ `<audio>` được NỐI VÀO ngữ cảnh âm thanh dùng chung của tiếng trận đấu (`attach()`): iOS chỉ
 *   cấp một phiên âm thanh cho mỗi trang, hai thứ giữ hai phiên riêng sẽ giành nhau.
 */
const TRACKS = MUSIC_TRACKS;
const prefs = loadAudioPrefs(STORAGE_KEYS.music, 0.4);

/**
 * Phát kiểu "xào bài": trộn ngẫu nhiên toàn bộ danh sách, nghe hết lượt rồi mới trộn lại.
 * Bài đầu tiên của lượt mới không trùng bài vừa nghe; bài vừa nghe được nhớ qua các lần mở game
 * (localStorage) nên mỗi lần vào game không bắt đầu bằng cùng một bài.
 */
let queue: number[] = [];
let current = readLast();

function readLast(): number {
  try {
    const i = Number(localStorage.getItem(STORAGE_KEYS.musicLast));
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
    localStorage.setItem(STORAGE_KEYS.musicLast, String(current));
  } catch {
    /* bỏ qua */
  }
  return TRACKS[current]!;
}

let audio: HTMLAudioElement | null = null;
/** Âm lượng nhạc khi đã nối vào ngữ cảnh dùng chung (iOS bỏ qua `audio.volume`, phải chỉnh bằng gain). */
let gain: GainNode | null = null;
let unlocked = false;
/** Số nhịp còn được thử phát lại (xem `retry`) và đồng hồ hẹn nhịp kế tiếp. */
let retryLeft = 0;
let retryTimer = 0;

function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(pickNext());
    audio.preload = 'none';
    audio.volume = prefs.volume;
    // Hết bài: sang bài ngẫu nhiên khác
    audio.addEventListener('ended', () => {
      audio!.src = pickNext();
      start();
    });
    // Bài lỗi/không tải được: thử bài khác (tránh vòng lặp vô hạn nếu chỉ có 1 bài)
    audio.addEventListener('error', () => {
      if (TRACKS.length < 2) return;
      audio!.src = pickNext();
      start();
    });
  }
  return audio;
}

/**
 * Nối thẻ nhạc vào NGỮ CẢNH ÂM THANH DÙNG CHUNG (xem `sharedAudioContext`) để nhạc nền và tiếng trận
 * đấu nằm chung một phiên âm thanh — tắt cái này không làm câm cái kia. Chỉ nối khi ngữ cảnh đã CHẠY
 * thật (nối vào ngữ cảnh đang treo thì nhạc im mà vẫn báo là đang phát).
 */
function attach(): void {
  if (gain) return;
  const c = sharedAudioContext();
  if (!c) return;
  if (c.state !== 'running') {
    void c.resume().catch(() => {});
    return;
  }
  try {
    const src = c.createMediaElementSource(getAudio());
    const g = c.createGain();
    g.gain.value = prefs.on ? prefs.volume : 0;
    src.connect(g);
    g.connect(c.destination);
    gain = g;
    audio!.volume = 1; // âm lượng đã do gain quyết định
  } catch {
    /* trình duyệt không cho nối (thẻ đã nối ở nơi khác): dùng âm lượng của thẻ */
  }
}

/** Phát lại nhạc nếu đang bật (im lặng bỏ qua khi `play()` bị từ chối — có `retry` đỡ phía sau). */
function tryPlay(): void {
  if (!unlocked || !prefs.on || prefs.volume <= 0) return;
  void getAudio().play().catch(retry);
}

/**
 * Thử phát lại vài nhịp sau khi `play()` bị từ chối: iOS tạm treo trình phát khi phiên âm thanh vừa
 * đổi trạng thái (vào trận, quay lại từ nền). Nhờ vậy nhạc tự hồi mà không phải bấm lại công tắc.
 */
function retry(): void {
  if (retryLeft <= 0) return;
  retryLeft -= 1;
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(tryPlay, 250);
}

/** Bắt đầu phát nhạc (kèm hạn thử lại) — dùng cho cả thao tác bật công tắc lẫn chuyển bài. */
function start(): void {
  retryLeft = 4;
  tryPlay();
}

function sync(): void {
  if (!unlocked) return;
  const a = getAudio();
  attach();
  if (gain) gain.gain.value = prefs.on ? prefs.volume : 0;
  else a.volume = prefs.volume;
  if (prefs.on && prefs.volume > 0) start();
  else a.pause();
}

/** Gọi 1 lần khi khởi động: chờ tương tác đầu tiên rồi mới phát. */
export function initMusic(): void {
  const unlock = () => {
    unlocked = true;
    sync();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Trạng thái nhạc nền hiện tại (bật/tắt + âm lượng 0–1). */
export function musicPrefs(): AudioPrefs {
  return { ...prefs };
}

function apply(): void {
  unlocked = true;
  saveAudioPrefs(STORAGE_KEYS.music, prefs);
  sync();
  emit(GameEvents.AudioPrefs, { channel: 'music', on: prefs.on, volume: prefs.volume });
}

/** Bật/tắt nhạc nền (bật lại khi âm lượng đang 0 thì đặt về 40%). */
export function toggleMusic(): void {
  prefs.on = !prefs.on;
  if (prefs.on && prefs.volume === 0) prefs.volume = 0.4;
  apply();
}

/** Đặt âm lượng nhạc nền 0–1. */
export function setMusicVolume(value: number): void {
  prefs.volume = clampVolume(value);
  apply();
}
