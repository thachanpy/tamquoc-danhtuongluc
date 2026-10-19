import { STORAGE_KEYS } from '../../core/constants.ts';
import { emit, GameEvents } from '../../core/events.ts';
import { SFX_CLIPS, type SfxName } from '../manifest.ts';
import { clampVolume, loadAudioPrefs, saveAudioPrefs, type AudioPrefs } from './prefs.ts';

/**
 * Hiệu ứng âm thanh trận đấu PvP (chỉ trải nghiệm, không liên quan dữ liệu game).
 * - Mỗi loại sự kiện trong trận (đòn thường, chí mạng, hồi máu, thiêu đốt, choáng, ...) ứng với một file
 *   trong `public/audio/sfx`. Danh sách clip nằm ở `SFX_CLIPS` (`assets/manifest.ts`).
 * - Bật/tắt và âm lượng nhớ theo trình duyệt (localStorage) — dùng chung cho mọi trận đấu.
 * - Trình duyệt chặn tự phát âm thanh, nên chỉ phát sau lần chạm/bấm đầu tiên của người chơi.
 * - Chống dội (throttle) theo từng loại: một đòn đánh diện rộng 3 mục tiêu chỉ nghe MỘT tiếng va chạm.
 *
 * Phát bằng **Web Audio API** (`AudioBufferSourceNode`) chứ không dùng thẻ `<audio>`:
 * một trận bắn ra rất nhiều tiếng NGẮN liên tiếp, mà mỗi lần `HTMLAudioElement.play()` trên iOS Safari
 * đều phải đi qua tầng media của hệ điều hành — vừa trễ tiếng vừa chặn luồng chính, làm giật hoạt ảnh
 * sân đấu. Web Audio giải mã sẵn file thành buffer rồi phát tức thì trên luồng âm thanh riêng.
 */
const CLIPS = SFX_CLIPS;
const NAMES = Object.keys(CLIPS) as SfxName[];

/** Khoảng cách tối thiểu giữa hai lần phát CÙNG một clip (ms) — chống dội khi đánh diện rộng. */
const THROTTLE_MS = 60;

const prefs = loadAudioPrefs(STORAGE_KEYS.sfx, 0.5);
let unlocked = false;

/** Ngữ cảnh âm thanh + âm lượng tổng; tạo lười ở lần tương tác đầu tiên (iOS bắt buộc trong thao tác người dùng). */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** Buffer đã giải mã của từng clip — phát lại nhiều lần không tốn thêm gì. */
const buffers: Partial<Record<SfxName, AudioBuffer>> = {};
const loading = new Set<SfxName>();
const lastAt: Partial<Record<SfxName, number>> = {};
/** Các nguồn đang phát (để dừng khi dựng lại trận đấu). */
const live = new Set<AudioBufferSourceNode>();

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    // Web Audio mặc định rơi vào nhóm âm thanh `ambient` của iOS — nhóm này BỊ CÔNG TẮC IM LẶNG trên
    // cạnh máy làm câm, trong khi nhạc nền phát bằng thẻ `<audio>` thuộc nhóm `playback` nên vẫn kêu →
    // đúng hiện tượng "chỉ nghe thấy nhạc nền, tiếng trận đấu im". Đặt `playback` cho tiếng trận đấu
    // ngang hàng với nhạc nền.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = prefs.on ? prefs.volume : 0;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/** Nạp + giải mã một clip (bỏ qua nếu đã có hoặc đang nạp). */
function load(name: SfxName): void {
  const c = ctx;
  if (!c || buffers[name] || loading.has(name)) return;
  loading.add(name);
  void fetch(CLIPS[name])
    .then((r) => r.arrayBuffer())
    .then((b) => c.decodeAudioData(b))
    .then((buf) => {
      buffers[name] = buf;
    })
    .catch(() => {
      /* thiếu file / giải mã lỗi: im lặng bỏ qua, không làm hỏng trận đấu */
    })
    .finally(() => loading.delete(name));
}

/** Nạp trước toàn bộ clip (gọi sau lần tương tác đầu tiên để trận đầu không bị thiếu tiếng). */
function preload(): void {
  for (const name of NAMES) load(name);
}

/**
 * Ngữ cảnh âm thanh DÙNG CHUNG cho cả tiếng trận đấu lẫn nhạc nền.
 * iOS chỉ cấp MỘT phiên âm thanh cho mỗi trang: hai thứ giữ hai phiên riêng thì chúng giành nhau —
 * tắt nhạc nền là tiếng trận đấu câm, và ngược lại. Nhạc nền được nối vào chính ngữ cảnh này
 * (xem `attach()` trong `music.ts`) để cả hai trộn bên trong một phiên duy nhất.
 */
export function sharedAudioContext(): AudioContext | null {
  return ensureCtx();
}

/** Nguồn im lặng giữ phiên (xem `holdSession`) — chỉ tạo một lần cho cả phiên chơi. */
let hold: AudioBufferSourceNode | null = null;

/**
 * Giữ phiên âm thanh của trang LUÔN thức bằng một nguồn IM LẶNG lặp vô hạn.
 *
 * WebKit cắt phiên âm thanh khi trang không còn phát ra tiếng: người chơi tắt nhạc nền là ngữ cảnh bị
 * đẩy sang `interrupted` (trạng thái riêng của WebKit, khác `suspended`), mà `resume()` chỉ chạy được
 * BÊN TRONG một thao tác người dùng — nên tiếng trận đấu câm hẳn dù công tắc vẫn bật. Một
 * `AudioBufferSourceNode` lặp mãi (buffer toàn số 0, gain 0) làm ngữ cảnh luôn có nguồn đang chạy,
 * nhờ vậy tiếng trận đấu độc lập hẳn với nhạc nền. Buffer toàn số 0 nên tai không nghe thấy gì.
 */
function holdSession(c: AudioContext): void {
  if (hold) return;
  try {
    const frames = Math.max(1, Math.round(c.sampleRate * 0.25)); // 0,25s: đủ dài để không phải lặp dày
    const buf = c.createBuffer(1, frames, c.sampleRate); // buffer mới sinh ra đã toàn số 0
    const g = c.createGain();
    g.gain.value = 0;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(g);
    g.connect(c.destination);
    src.start();
    hold = src;
  } catch {
    /* trình duyệt không cho tạo nguồn: bỏ qua, tiếng trận đấu vẫn phát theo đường cũ */
  }
}

/** Phát một hiệu ứng. Bỏ qua khi: chưa mở khoá (chưa tương tác), đang tắt, âm lượng 0, hoặc vừa phát cùng clip. */
export function playSfx(name: SfxName): void {
  if (!unlocked || !prefs.on || prefs.volume <= 0) return;
  const c = ctx;
  const buf = buffers[name];
  if (!c || !master || !buf) return;
  // Ngữ cảnh có thể bị hệ điều hành đẩy sang 'interrupted'/'suspended' — trên iOS điều này xảy ra khi
  // trình phát NHẠC NỀN bị tạm dừng. Gặp trường hợp đó thì đánh thức lại rồi phát luôn.
  if (c.state !== 'running') void c.resume().catch(() => {});
  const now = performance.now();
  if (now - (lastAt[name] ?? 0) < THROTTLE_MS) return;
  lastAt[name] = now;
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(master);
  src.onended = () => live.delete(src);
  live.add(src);
  try {
    src.start();
  } catch {
    live.delete(src);
  }
}

/** Dừng mọi hiệu ứng đang phát (dùng khi dựng lại trận đấu). */
export function stopAllSfx(): void {
  for (const src of live) {
    try {
      src.stop();
    } catch {
      /* bỏ qua: nguồn đã kết thúc */
    }
  }
  live.clear();
}

function sync(): void {
  if (master) master.gain.value = prefs.on ? prefs.volume : 0;
  if (!unlocked) return;
  const c = ensureCtx();
  if (!c) return;
  holdSession(c);
  try {
    // Giữ ngữ cảnh LUÔN chạy để tiếng bắn ra tức thì ở đầu trận. Gồm cả 'interrupted'.
    if (c.state !== 'running') void c.resume().catch(() => {});
  } catch {
    /* bỏ qua: trình duyệt không cho đổi trạng thái ngữ cảnh */
  }
}

/** Gọi 1 lần khi khởi động: chờ tương tác đầu tiên rồi mới cho phép phát. */
export function initSfx(): void {
  /**
   * Đánh thức âm thanh. Chạy ở MỖI thao tác người dùng (không gỡ listener sau lần chạm đầu):
   * iOS chỉ cho `resume()` chạy BÊN TRONG một thao tác người dùng, nên giữ đường hồi phục suốt phiên.
   */
  const wake = () => {
    const first = !unlocked;
    unlocked = true;
    const c = ensureCtx();
    if (!c) return;
    if (c.state !== 'running') void c.resume().catch(() => {});
    if (!first) return;
    // Tự đánh thức ngữ cảnh mỗi khi hệ điều hành đổi trạng thái nó (ví dụ tắt nhạc nền trên iOS).
    c.addEventListener('statechange', () => {
      if (c.state !== 'running') void c.resume().catch(() => {});
    });
    preload();
    sync();
  };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
  // Quay lại tab sau khi bị ẩn (WebKit hay treo ngữ cảnh): thử đánh thức lại ngay.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') wake();
  });
}

/** Trạng thái hiệu ứng âm thanh hiện tại (bật/tắt + âm lượng 0–1). */
export function sfxPrefs(): AudioPrefs {
  return { ...prefs };
}

function apply(): void {
  unlocked = true;
  saveAudioPrefs(STORAGE_KEYS.sfx, prefs);
  sync();
  emit(GameEvents.AudioPrefs, { channel: 'sfx', on: prefs.on, volume: prefs.volume });
}

/** Bật/tắt hiệu ứng âm thanh (bật lại khi âm lượng đang 0 thì đặt về 50%). */
export function toggleSfx(): void {
  prefs.on = !prefs.on;
  if (prefs.on && prefs.volume === 0) prefs.volume = 0.5;
  apply();
}

/** Đặt âm lượng hiệu ứng 0–1. */
export function setSfxVolume(value: number): void {
  prefs.volume = clampVolume(value);
  apply();
}

/**
 * Bật sẵn hiệu ứng âm thanh — gọi khi VÀO trận đấu trên mobile để người chơi không phải tự bật lại
 * mỗi trận. Âm lượng đang 0 thì đặt lại 50%, nếu không thì bật công tắc mà vẫn không nghe thấy gì.
 */
export function ensureSfxOn(): void {
  if (prefs.on && prefs.volume > 0) return;
  prefs.on = true;
  if (prefs.volume === 0) prefs.volume = 0.5;
  apply();
}
