import './style.css';
import './theme.css';
import { TICKET_TYPES, TICKET_LABELS } from '@tq/shared';
import { api, setToken, hasToken, newKey, type ApiError } from './api.ts';
import { state, setTickets, onTickets } from './state.ts';
import { esc } from './art.ts';
import { initMusic, mountMusicControl } from './music.ts';
import { renderDraw } from './pages/draw.ts';
import { renderCollection } from './pages/collection.ts';
import { renderUpgrade } from './pages/upgrade.ts';
import { renderHistory } from './pages/history.ts';

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
  history: { label: 'Lịch sử', render: renderHistory },
} as const;
type PageId = keyof typeof PAGES;

let cleanupPage: (() => void) | null = null;
let timer: number | null = null;

function renderLogin(message = '') {
  if (timer) clearInterval(timer);
  app.innerHTML = `
    <div class="login">
      <img class="logo big" src="/icons/icon-192.png" alt="" aria-hidden="true" />
      <h1>Tam Quốc: <span>Danh Tướng Lục</span></h1>
      <form class="panel">
        <label>Tên đăng nhập <input name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" /></label>
        <label>Mật khẩu <input name="password" type="password" autocomplete="current-password" required minlength="6" /></label>
        <div class="row">
          <button class="btn primary" data-act="login">Đăng nhập</button>
          <button class="btn ghost" data-act="register">Tạo tài khoản</button>
        </div>
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
        renderLogin((e as ApiError).message);
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
    <header class="top">
      <div class="brand"><img class="logo" src="/icons/icon-192.png" alt="" aria-hidden="true" />Tam Quốc: <span>Danh Tướng Lục</span></div>
      <div class="tickets-bar" aria-live="polite"></div>
      <div class="user">
        ${state.features.devTopup ? `<button class="btn topup small" data-topup title="Tính năng thử nghiệm — cộng ${state.features.devTopupAmount} vé, loại vé ngẫu nhiên">+${state.features.devTopupAmount} vé</button>` : ''}
        <div data-music></div><span>${esc(state.username)}</span><button class="btn ghost small" data-logout>Đăng xuất</button>
      </div>
    </header>
    <nav class="tabs">${Object.entries(PAGES)
      .map(([id, p]) => `<a href="#${id}" data-tab="${id}">${p.label}</a>`)
      .join('')}</nav>
    <main id="page"></main>`;
  mountMusicControl(app.querySelector<HTMLDivElement>('[data-music]')!);
  app.querySelector<HTMLButtonElement>('[data-logout]')!.onclick = async () => {
    await api.logout().catch(() => {});
    setToken(null);
    renderLogin();
  };
  // Nút cộng vé thử nghiệm: server quyết định số vé & loại vé; client chỉ gửi idempotency key.
  const topupBtn = app.querySelector<HTMLButtonElement>('[data-topup]');
  if (topupBtn) {
    let pendingKey: string | null = null;
    topupBtn.onclick = async () => {
      if (topupBtn.disabled) return;
      topupBtn.disabled = true;
      pendingKey ??= newKey();
      try {
        const r = await api.devTopup(pendingKey);
        pendingKey = null;
        setTickets(r.tickets);
        toast(
          `+${r.grantedTotal} vé: ${TICKET_TYPES.filter((k) => r.granted[k]).map((k) => `${TICKET_LABELS[k]} ×${r.granted[k]}`).join(', ')}`,
        );
      } catch (e) {
        const err = e as ApiError;
        if (err.code !== 'NETWORK') pendingKey = null; // lỗi mạng: giữ key để bấm lại là retry an toàn
        toast(err.message);
      } finally {
        topupBtn.disabled = false;
      }
    };
  }

  const bar = app.querySelector<HTMLDivElement>('.tickets-bar')!;
  const drawBar = () => {
    const t = state.tickets;
    if (!t) return;
    bar.innerHTML = `
      ${TICKET_TYPES.map((k) => `<span class="tb t-${k}" title="${TICKET_LABELS[k]}">${TICKET_LABELS[k].replace('Vé ', '')} <b>${t.balances[k]}</b></span>`).join('')}
      <span class="tb total">Tổng <b>${t.total}</b></span>
      <span class="tb timer" title="Vé kế tiếp lúc ${new Date(t.nextRecoveryAt).toLocaleTimeString('vi-VN')}">+1 vé sau <b data-cd>${fmtCountdown(state.nextRecoveryLocal - performance.now())}</b></span>`;
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
        if (r.grantedTotal > 0) toast(`Nhận ${r.grantedTotal} vé: ${TICKET_TYPES.filter((k) => r.granted[k]).map((k) => `${TICKET_LABELS[k]} ×${r.granted[k]}`).join(', ')}`);
      } catch {
        state.nextRecoveryLocal = performance.now() + 15_000; // thử lại sau
      } finally {
        claiming = false;
      }
    }
  }, 500);
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
  const page = PAGES[id] ?? PAGES.draw;
  cleanupPage?.();
  app.querySelectorAll<HTMLAnchorElement>('[data-tab]').forEach((a) => a.classList.toggle('on', a.dataset.tab === id));
  cleanupPage = page.render(document.getElementById('page')!);
}

async function boot() {
  if (!hasToken()) return renderLogin();
  app.innerHTML = `<div class="state-msg">Đang tải…</div>`;
  try {
    // Nhận các mốc chưa xử lý ngay khi vào (offline vẫn tích lũy) — server quyết định.
    const claimed = await api.claimRecovery();
    const [me, generals, config] = await Promise.all([api.me(), api.generals(), api.gachaConfig()]);
    state.username = me.username;
    state.features = me.features;
    state.generals = generals.items;
    state.generalsById = new Map(generals.items.map((g) => [g.id, g]));
    state.config = config;
    renderShell();
    setTickets(me.tickets);
    if (claimed.grantedTotal > 0) toast(`Nhận ${claimed.grantedTotal} vé hồi trong lúc vắng mặt`);
    window.onhashchange = route;
    route();
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) return renderLogin('Phiên đăng nhập đã hết hạn.');
    app.innerHTML = `<div class="state-msg error">Không tải được game: ${esc(err.message)} <button class="btn ghost" onclick="location.reload()">Thử lại</button></div>`;
  }
}

void boot();
