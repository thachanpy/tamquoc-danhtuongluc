/**
 * Hiệu ứng âm thanh trận đấu PvP (chỉ trải nghiệm, không liên quan dữ liệu game).
 * - Mỗi loại sự kiện trong trận (đòn thường, chí mạng, hồi máu, thiêu đốt, choáng, ...) ứng với một file
 *   trong `public/audio/sfx`. Danh sách clip nằm ở `CLIPS`.
 * - Bật/tắt và âm lượng nhớ theo trình duyệt (localStorage) — dùng chung cho mọi trận đấu.
 * - Trình duyệt chặn tự phát âm thanh, nên chỉ phát sau lần chạm/bấm đầu tiên của người chơi.
 * - Chống dội (throttle) theo từng loại: một đòn đánh diện rộng 3 mục tiêu chỉ nghe MỘT tiếng va chạm.
 *
 * Phát bằng **Web Audio API** (`AudioBufferSourceNode`) chứ không dùng thẻ `<audio>`:
 * một trận bắn ra rất nhiều tiếng NGẮN liên tiếp, mà mỗi lần `HTMLAudioElement.play()` trên iOS Safari
 * đều phải đi qua tầng media của hệ điều hành — vừa trễ tiếng vừa chặn luồng chính, làm giật hoạt ảnh
 * sân đấu (chỉ thấy rõ trên mobile, máy tính thì không). Web Audio giải mã sẵn file thành buffer rồi
 * phát tức thì trên luồng âm thanh riêng, không đụng tới luồng vẽ. Ngữ cảnh âm thanh giữ HOẠT ĐỘNG
 * suốt phiên chơi để tiếng bắn ra tức thì, không phải chờ đánh thức lại ở đầu trận.
 */
import { createSignal } from 'solid-js';

const KEY = 'tq.sfx';
type Prefs = { on: boolean; volume: number };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '') as Partial<Prefs>;
    return { on: p.on !== false, volume: typeof p.volume === 'number' ? Math.min(1, Math.max(0, p.volume)) : 0.5 };
  } catch {
    return { on: true, volume: 0.5 };
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* bỏ qua: chế độ riêng tư / bị chặn storage */
  }
}

/** Thêm/bớt clip = thêm/bớt file trong public/audio/sfx và sửa danh sách này. */
const CLIPS = {
  attackNormal: '/audio/sfx/sfx_attack_normal.wav',
  attackCrit: '/audio/sfx/sfx_attack_crit.wav',
  buff: '/audio/sfx/sfx_buff_damage.wav',
  burn: '/audio/sfx/sfx_burn.wav',
  counter: '/audio/sfx/sfx_counter.wav',
  death: '/audio/sfx/sfx_death.wav',
  dispel: '/audio/sfx/sfx_dispel.wav',
  dodge: '/audio/sfx/sfx_dodge.wav',
  heal: '/audio/sfx/sfx_heal.wav',
  lifesteal: '/audio/sfx/sfx_lifesteal.wav',
  stun: '/audio/sfx/sfx_stun.wav',
} as const;

export type SfxName = keyof typeof CLIPS;

const NAMES = Object.keys(CLIPS) as SfxName[];

/** Khoảng cách tối thiểu giữa hai lần phát CÙNG một clip (ms) — chống dội khi đánh diện rộng. */
const THROTTLE_MS = 60;

const prefs = loadPrefs();
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

/** Phát một hiệu ứng. Bỏ qua khi: chưa mở khoá (chưa tương tác), đang tắt, âm lượng 0, hoặc vừa phát cùng clip. */
export function playSfx(name: SfxName) {
  if (!unlocked || !prefs.on || prefs.volume <= 0) return;
  const c = ctx;
  const buf = buffers[name];
  if (!c || !master || !buf) return;
  // Ngữ cảnh có thể bị hệ điều hành đẩy sang 'interrupted'/'suspended' — trên iOS điều này xảy ra khi
  // trình phát NHẠC NỀN bị tạm dừng (hai thứ độc lập về logic nhưng chung phiên âm thanh của máy).
  // Gặp trường hợp đó thì đánh thức lại rồi phát luôn: trước đây bỏ qua nên tắt nhạc nền là mất luôn
  // tiếng trận đấu.
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
export function stopAllSfx() {
  for (const src of live) {
    try {
      src.stop();
    } catch {
      /* bỏ qua: nguồn đã kết thúc */
    }
  }
  live.clear();
}

function sync() {
  if (master) master.gain.value = prefs.on ? prefs.volume : 0;
  if (!unlocked) return;
  const c = ensureCtx();
  if (!c) return;
  try {
    // Giữ ngữ cảnh LUÔN chạy để tiếng bắn ra tức thì ở đầu trận (không phải chờ đánh thức lại).
    // Gồm cả 'interrupted': tắt nhạc nền trên iOS có thể đẩy ngữ cảnh sang trạng thái này.
    if (c.state !== 'running') void c.resume().catch(() => {});
  } catch {
    /* bỏ qua: trình duyệt không cho đổi trạng thái ngữ cảnh */
  }
}

/** Gọi 1 lần khi khởi động: chờ tương tác đầu tiên rồi mới cho phép phát. */
export function initSfx() {
  const unlock = () => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    const c = ensureCtx();
    if (!c) return;
    if (c.state === 'suspended') void c.resume().catch(() => {});
    // Tự đánh thức ngữ cảnh mỗi khi hệ điều hành đổi trạng thái nó (ví dụ tắt nhạc nền trên iOS):
    // hiệu ứng trận đấu KHÔNG phụ thuộc vào việc nhạc nền đang bật hay tắt.
    c.addEventListener('statechange', () => {
      if (c.state !== 'running') void c.resume().catch(() => {});
    });
    preload();
    sync();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

/** Trạng thái hiệu ứng âm thanh cho UI (reactive): bật/tắt + âm lượng 0–1. */
const [prefsSig, setPrefsSig] = createSignal<Prefs>({ ...prefs });
export const sfxPrefs = prefsSig;

function apply() {
  unlocked = true;
  savePrefs(prefs);
  sync();
  setPrefsSig({ ...prefs });
}

/** Bật/tắt hiệu ứng âm thanh (bật lại khi âm lượng đang 0 thì đặt về 50%). */
export function toggleSfx() {
  prefs.on = !prefs.on;
  if (prefs.on && prefs.volume === 0) prefs.volume = 0.5;
  apply();
}

/** Đặt âm lượng hiệu ứng 0–1. */
export function setSfxVolume(v: number) {
  prefs.volume = Math.min(1, Math.max(0, v));
  apply();
}

/**
 * Bật sẵn hiệu ứng âm thanh — gọi khi VÀO trận đấu trên mobile để người chơi không phải tự bật lại
 * mỗi trận (trận đấu im lặng vì lần trước đã tắt). Âm lượng đang 0 thì đặt lại 50%, nếu không thì
 * bật công tắc mà vẫn không nghe thấy gì. Nút "Âm thanh" trong hàng điều khiển vẫn tắt/mở được cho
 * riêng trận đang xem.
 */
export function ensureSfxOn() {
  if (prefs.on && prefs.volume > 0) return;
  prefs.on = true;
  if (prefs.volume === 0) prefs.volume = 0.5;
  apply();
}
