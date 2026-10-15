/**
 * Hiệu ứng âm thanh trận đấu PvP (chỉ trải nghiệm, không liên quan dữ liệu game).
 * - Mỗi loại sự kiện trong trận (đòn thường, chí mạng, hồi máu, thiêu đốt, choáng, ...) ứng với một file
 *   trong `public/audio/sfx`. Danh sách clip nằm ở `CLIPS`.
 * - Bật/tắt và âm lượng nhớ theo trình duyệt (localStorage) — dùng chung cho mọi trận đấu.
 * - Trình duyệt chặn tự phát âm thanh, nên chỉ phát sau lần chạm/bấm đầu tiên của người chơi.
 * - Mỗi clip có một nhóm Audio nhỏ phát vòng (round-robin) để tiếng nọ không cắt tiếng kia, kèm chống
 *   dội (throttle) theo từng loại: một đòn đánh diện rộng 3 mục tiêu chỉ nghe MỘT tiếng va chạm.
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
  heal: '/audio/sfx/sfx_heal.wav',
  lifesteal: '/audio/sfx/sfx_lifesteal.wav',
  stun: '/audio/sfx/sfx_stun.wav',
} as const;

export type SfxName = keyof typeof CLIPS;

/** Số bản sao mỗi clip (đủ để vài tiếng chồng nhau mà không cắt nhau). */
const VOICES = 3;
/** Khoảng cách tối thiểu giữa hai lần phát CÙNG một clip (ms) — chống dội khi đánh diện rộng. */
const THROTTLE_MS = 60;

const prefs = loadPrefs();
const voices: Partial<Record<SfxName, HTMLAudioElement[]>> = {};
const next: Partial<Record<SfxName, number>> = {};
const lastAt: Partial<Record<SfxName, number>> = {};
let unlocked = false;

/** Nhóm Audio của một clip (tạo lười ở lần phát đầu). */
function voicesOf(name: SfxName): HTMLAudioElement[] {
  let list = voices[name];
  if (!list) {
    list = Array.from({ length: VOICES }, () => {
      const a = new Audio(CLIPS[name]);
      a.preload = 'auto';
      a.volume = prefs.volume;
      return a;
    });
    voices[name] = list;
  }
  return list;
}

/** Phát một hiệu ứng. Bỏ qua khi: chưa mở khoá (chưa tương tác), đang tắt, âm lượng 0, hoặc vừa phát cùng clip. */
export function playSfx(name: SfxName) {
  if (!unlocked || !prefs.on || prefs.volume <= 0) return;
  const now = Date.now();
  if (now - (lastAt[name] ?? 0) < THROTTLE_MS) return;
  lastAt[name] = now;
  const list = voicesOf(name);
  const i = next[name] ?? 0;
  next[name] = (i + 1) % list.length;
  const a = list[i]!;
  a.volume = prefs.volume;
  try {
    a.currentTime = 0;
  } catch {
    /* bỏ qua: một số trình duyệt chưa sẵn sàng để tua */
  }
  void a.play().catch(() => {});
}

/** Dừng mọi hiệu ứng đang phát (dùng khi dựng lại trận đấu). */
export function stopAllSfx() {
  for (const list of Object.values(voices)) for (const a of list ?? []) a.pause();
}

function sync() {
  for (const list of Object.values(voices)) for (const a of list ?? []) a.volume = prefs.volume;
}

/** Gọi 1 lần khi khởi động: chờ tương tác đầu tiên rồi mới cho phép phát. */
export function initSfx() {
  const unlock = () => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
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
