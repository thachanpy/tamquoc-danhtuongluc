import './style.css';
import './theme.css';
import { TICKET_TYPES, TICKET_LABELS, type DailyEventsDto } from '@tq/shared';
import { api, setToken, hasToken, type ApiError } from './api.ts';
import { state, setTickets, onTickets } from './state.ts';
import { esc } from './art.ts';
import { initMusic, mountMusicControl } from './music.ts';
import { renderDraw } from './pages/draw.ts';
import { renderCollection } from './pages/collection.ts';
import { renderUpgrade } from './pages/upgrade.ts';
import { renderHistory } from './pages/history.ts';
import { renderLeaderboard } from './pages/leaderboard.ts';
import { renderQuests } from './pages/quests.ts';
import { renderAdmin } from './pages/admin.ts';
import { renderGiftCode, rewardText } from './pages/giftcode.ts';

const app = document.getElementById('app')!;

/** Tia lửa trang trí trên nền (chỉ hiệu ứng, không ảnh hưởng dữ liệu). */
function addSparks(count = 40) {
  const colors = ['#60a5fa', '#4ade80', '#f87171', '#fbbf24', '#fef08a'];
  const box = document.createElement('div');
  box.className = 'sparks';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const size = Math.random() * 4 + 2;
    const c = colors[Math.floor(Math.random() * colors.length)]!;
    s.style.cssText = `width:${size}px;height:${size}px;left:${Math.random() * 100}vw;background:${c};box-shadow:0 0 10px ${c};animation-duration:${Math.random() * 4 + 4}s;animation-delay:${Math.random() * 5}s`;
    box.appendChild(s);
  }
  document.body.prepend(box);
}
addSparks();
initMusic();
const PAGES = {
  collection: { label: 'Bộ sưu tập', render: renderCollection },
  draw: { label: 'Quay thẻ', render: renderDraw },
  upgrade: { label: 'Nâng cấp', render: renderUpgrade },
  quests: { label: 'Nhiệm vụ', render: renderQuests },
  leaderboard: { label: 'Xếp hạng', render: renderLeaderboard },
  history: { label: 'Lịch sử', render: renderHistory },
  giftcode: { label: 'Giftcode', render: renderGiftCode },
  admin: { label: 'Quản trị', render: renderAdmin, adminOnly: true },
} as const;
type PageId = keyof typeof PAGES;

let cleanupPage: (() => void) | null = null;
let timer: number | null = null;

function renderLogin(message = '', info = '') {
  if (timer) clearInterval(timer);
  app.innerHTML = `
    <div class="login">
      <img class="logo big" src="/icons/icon-192.png" alt="" aria-hidden="true" />
      <h1>Tam Quốc: </h1>
      <h1>Danh Tướng Lục</h1>
      <form class="panel">
        <label>Tên đăng nhập <input name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" /></label>
        <label>Mật khẩu <input name="password" type="password" autocomplete="current-password" required minlength="6" /></label>
        <div class="row">
          <button class="btn primary" data-act="login">Đăng nhập</button>
          <button class="btn ghost" data-act="register">Tạo tài khoản</button>
        </div>
        ${info ? `<div class="notice" role="status">${info}</div>` : ''}
        <div class="error" aria-live="polite">${esc(message)}</div>
      </form>
    </div>`;
  const form = app.querySelector('form')!;
  form.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => {
    b.onclick = async (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const fd = new FormData(form);
      const u = String(fd.get('username'));
      const p = String(fd.get('password'));
      form.querySelectorAll('button').forEach((x) => (x.disabled = true));
      try {
        if (b.dataset.act === 'register') {
          const r = await api.register(u, p);
          if (r.status === 'pending') {
            // Tài khoản mới phải chờ admin duyệt mới đăng nhập được (mục 3.8)
            return renderLogin(
              '',
              `<b>Đăng ký thành công!</b> Tài khoản <b>${esc(u)}</b> đang <b>chờ quản trị viên duyệt</b>. ` +
                `Bạn sẽ đăng nhập được sau khi được duyệt; vé quà tân thủ được cấp lúc duyệt.`,
            );
          }
          setToken(r.token);
          await boot();
          const total = TICKET_TYPES.reduce((s, k) => s + r.signupBonus[k], 0);
          toast(
            `Quà tân thủ: ${total} vé — ${TICKET_TYPES.filter((k) => r.signupBonus[k]).map((k) => `${TICKET_LABELS[k]} ×${r.signupBonus[k]}`).join(', ')}`,
            7000,
          );
        } else {
          const r = await api.login(u, p);
          setToken(r.token);
          await boot();
        }
      } catch (e) {
        const err = e as ApiError;
        if (err.code === 'ACCOUNT_PENDING') {
          return renderLogin('', `Tài khoản <b>${esc(u)}</b> đang <b>chờ quản trị viên duyệt</b>. Vui lòng quay lại sau khi được duyệt.`);
        }
        renderLogin(err.message);
      }
    };
  });
}

function fmtCountdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function renderShell() {
  state.listeners.clear();
  app.innerHTML = `
    <div class="app-head">
    <header class="top">
      <div class="brand"><img class="logo" src="/icons/icon-192.png" alt="" aria-hidden="true" />Tam Quốc<i class="brand-sep">:</i> <span>Danh Tướng Lục</span></div>
      <div class="tickets-bar" aria-live="polite"></div>
      <div class="user">
        <div data-music></div><span>${esc(state.username)}</span><button class="btn ghost small" data-logout>Đăng xuất</button>
      </div>
    </header>
    <nav class="tabs">${Object.entries(PAGES)
      .filter(([, p]) => !('adminOnly' in p) || state.isAdmin)
      .map(([id, p]) => `<a href="#${id}" data-tab="${id}">${p.label}${'adminOnly' in p ? ' <span class="badge" data-pending hidden></span>' : ''}${id === 'quests' ? ' <span class="badge" data-quests hidden></span>' : ''}</a>`)
      .join('')}</nav>
    </div>
    <main id="page"></main>`;
  // Thanh trên + tab dính trên cùng; đo chiều cao để các phần dính khác (VD khung "Đã chọn" ở Nâng cấp) nằm ngay dưới
  const head = app.querySelector<HTMLDivElement>('.app-head')!;
  const syncHeadH = () => document.documentElement.style.setProperty('--head-h', `${head.offsetHeight}px`);
  syncHeadH();
  new ResizeObserver(syncHeadH).observe(head);
  mountMusicControl(app.querySelector<HTMLDivElement>('[data-music]')!);
  app.querySelector<HTMLButtonElement>('[data-logout]')!.onclick = async () => {
    await api.logout().catch(() => {});
    setToken(null);
    renderLogin();
  };

  const bar = app.querySelector<HTMLDivElement>('.tickets-bar')!;
  const drawBar = () => {
    const t = state.tickets;
    if (!t) return;
    // Trần vé hồi theo thời gian (mỗi loại); vé từ nhiệm vụ/giftcode… có thể vượt trần
    const cap = t.recoveryCap;
    const full = (k: (typeof TICKET_TYPES)[number]) => t.balances[k] >= cap[k];
    const allFull = TICKET_TYPES.every(full);
    bar.innerHTML = `
      ${TICKET_TYPES.map(
        (k) =>
          `<span class="tb t-${k} ${full(k) ? 'full' : ''}" title="${TICKET_LABELS[k]}${full(k) ? ` — đã đạt trần vé hồi ${cap[k]}, không hồi thêm loại này` : ` — vé hồi tối đa ${cap[k]}`}">${TICKET_LABELS[k].replace('Vé ', '')} <b>${t.balances[k]}</b><small class="tb-cap">/${cap[k]}</small></span>`,
      ).join('')}
      <span class="tb total">Tổng <b>${t.total}</b></span>
      ${
        allFull
          ? `<span class="tb timer full" title="Mọi loại vé đã đạt trần (thường ${cap.normal}, phe ${cap.shu}): vé hồi theo thời gian tạm dừng (nhiệm vụ, giftcode vẫn cộng được)">Vé hồi đã đầy</span>`
          : `<span class="tb timer" title="Vé kế tiếp lúc ${new Date(t.nextRecoveryAt).toLocaleTimeString('vi-VN')}. Vé hồi tối đa: thường ${cap.normal}, mỗi loại phe ${cap.shu}">+1 vé sau <b data-cd>${fmtCountdown(state.nextRecoveryLocal - performance.now())}</b></span>`
      }`;
  };
  onTickets(drawBar);
  drawBar();

  // Đồng hồ đếm ngược chỉ để hiển thị. Khi tới mốc, hỏi server — server mới quyết định cấp vé.
  let claiming = false;
  timer = window.setInterval(async () => {
    const left = state.nextRecoveryLocal - performance.now();
    const cd = bar.querySelector('[data-cd]');
    if (cd) cd.textContent = fmtCountdown(left);
    if (left <= -1000 && !claiming) {
      claiming = true;
      try {
        const r = await api.claimRecovery();
        setTickets(r);
        if (r.dailyEvents) showDailyEvents(r.dailyEvents);
        void refreshQuestBadge();
        if (r.grantedTotal > 0) toast(`Nhận ${r.grantedTotal} vé: ${TICKET_TYPES.filter((k) => r.granted[k]).map((k) => `${TICKET_LABELS[k]} ×${r.granted[k]}`).join(', ')}`);
      } catch {
        state.nextRecoveryLocal = performance.now() + 15_000; // thử lại sau
      } finally {
        claiming = false;
      }
    }
  }, 500);
}

/** Số tài khoản chờ duyệt trên tab Quản trị (chỉ admin). */
async function refreshPendingBadge() {
  const el = app.querySelector<HTMLSpanElement>('[data-pending]');
  if (!el) return;
  try {
    const p = await api.admin.users({ status: 'pending', pageSize: 1 });
    el.textContent = String(p.pendingCount);
    el.hidden = p.pendingCount === 0;
  } catch {
    /* chỉ là badge hiển thị */
  }
}

/** Số phần thưởng nhiệm vụ/thành tựu đang chờ nhận (badge tab Nhiệm vụ). */
let questBadgeSeq = 0;
async function refreshQuestBadge() {
  const seq = ++questBadgeSeq;
  try {
    const q = await api.quests();
    if (seq === questBadgeSeq) setQuestBadge(q.claimable);
  } catch {
    /* chỉ là badge hiển thị */
  }
}
function setQuestBadge(n: number) {
  const el = app.querySelector<HTMLSpanElement>('[data-quests]');
  if (!el) return;
  el.textContent = String(n);
  el.hidden = n === 0;
}

/** Thông báo sự kiện ngày mới do server xử lý (thưởng reset 05:00, nhiệm vụ hôm trước tự nhận). */
function showDailyEvents(ev: DailyEventsDto) {
  if (ev.resetBonus) {
    const total = TICKET_TYPES.reduce((s, t) => s + ev.resetBonus![t], 0);
    toast(`Ngày mới! Nhận ${total} vé thưởng (${TICKET_TYPES.map((t) => `${TICKET_LABELS[t]} ×${ev.resetBonus![t]}`).join(', ')})`, 6000);
  }
  if (ev.autoClaimed.length) {
    const total = ev.autoClaimed.reduce((s, a) => s + a.count, 0);
    setTimeout(() => toast(`Tự nhận ${ev.autoClaimed.length} phần thưởng nhiệm vụ chưa nhận: +${total} vé`, 6000), ev.resetBonus ? 6200 : 0);
  }
}

function toast(text: string, ms = 4000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function route() {
  const raw = location.hash.slice(1) || 'collection';
  const id = (raw === 'gift' ? 'collection' : raw) as PageId;
  const page = PAGES[id] && (!('adminOnly' in PAGES[id]) || state.isAdmin) ? PAGES[id] : PAGES.collection;
  cleanupPage?.();
  app.querySelectorAll<HTMLAnchorElement>('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === id));
  // Mobile: thanh tab cuộn ngang => đưa tab đang chọn vào tầm nhìn
  app.querySelector<HTMLAnchorElement>('[data-tab].on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  cleanupPage = page.render(document.getElementById('page')!);
  // Quay/ghép ở trang khác có thể làm xong nhiệm vụ => cập nhật badge khi đổi trang
  if (id !== 'quests') void refreshQuestBadge();
}

/**
 * Popup lần đầu đăng nhập (mục 3.9): mời nhập các giftcode gợi ý chưa nhập.
 * Chỉ hiện 1 lần cho mỗi tài khoản trên trình duyệt này (localStorage); bấm nút thì sang trang Giftcode.
 */
async function maybeShowGiftCodePopup() {
  const key = `tq.gcPopup.${state.username.toLowerCase()}`;
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    return;
  }
  let codes;
  try {
    codes = (await api.giftcodes()).featured.filter((c) => !c.redeemed);
  } catch {
    return;
  }
  if (!codes.length) return;
  const markSeen = () => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* bỏ qua */
    }
  };
  const overlay = document.createElement('div');
  overlay.className = 'gc-popup';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.innerHTML = `
    <div class="panel gc-popup-box">
      <h2>Quà tân thủ</h2>
      <p>Chào mừng chủ công! Hãy nhập ${codes.length} giftcode này để nhận quà:</p>
      <ul>${codes.map((c) => `<li><b class="gc-code">${esc(c.code)}</b> — ${esc(rewardText(c.rewards))}</li>`).join('')}</ul>
      <div class="row">
        <button class="btn primary" data-go>Đến trang nhập Giftcode</button>
        <button class="btn ghost" data-close>Để sau</button>
      </div>
    </div>`;
  const close = () => {
    markSeen();
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  overlay.querySelector<HTMLButtonElement>('[data-go]')!.onclick = () => {
    close();
    location.hash = 'giftcode';
  };
  overlay.querySelector<HTMLButtonElement>('[data-close]')!.onclick = close;
  overlay.onclick = (e) => e.target === overlay && close();
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector<HTMLButtonElement>('[data-go]')!.focus();
}

// Trang Quản trị báo khi duyệt/từ chối để cập nhật badge (tránh import vòng main <-> pages).
window.addEventListener('tq:pending-changed', () => void refreshPendingBadge());
// Trang Nhiệm vụ báo số phần thưởng còn chờ nhận sau mỗi lần tải/nhận
window.addEventListener('tq:quests-changed', (e) => setQuestBadge(Number((e as CustomEvent).detail) || 0));

async function boot() {
  if (!hasToken()) return renderLogin();
  app.innerHTML = `<div class="state-msg">Đang tải…</div>`;
  try {
    // Nhận các mốc chưa xử lý ngay khi vào (offline vẫn tích lũy) — server quyết định.
    const claimed = await api.claimRecovery();
    const [me, generals, config] = await Promise.all([api.me(), api.generals(), api.gachaConfig()]);
    state.username = me.username;
    state.isAdmin = me.isAdmin;
    state.features = me.features;
    state.generals = generals.items;
    state.generalsById = new Map(generals.items.map((g) => [g.id, g]));
    state.config = config;
    renderShell();
    setTickets(me.tickets);
    if (claimed.grantedTotal > 0) toast(`Nhận ${claimed.grantedTotal} vé hồi trong lúc vắng mặt`);
    // Request đầu tiên trong ngày (claimRecovery hoặc me) mang sự kiện ngày mới
    const daily = claimed.dailyEvents ?? me.dailyEvents;
    if (daily) setTimeout(() => showDailyEvents(daily), claimed.grantedTotal > 0 ? 4200 : 0);
    window.onhashchange = route;
    route();
    if (state.isAdmin) void refreshPendingBadge();
    void maybeShowGiftCodePopup();
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) return renderLogin('Phiên đăng nhập đã hết hạn.');
    app.innerHTML = `<div class="state-msg error">Không tải được game: ${esc(err.message)} <button class="btn ghost" onclick="location.reload()">Thử lại</button></div>`;
  }
}

void boot();
