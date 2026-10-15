import { For, Show, createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Dynamic, render } from 'solid-js/web';
import { TICKET_LABELS, TICKET_TYPES, type DailyEventsDto, type GiftCodePublicDto, type TicketType } from '@tq/shared';
import { api, hasToken, setToken, type ApiError } from './api.ts';
import { pendingBadge, profile, questBadge, setPendingBadge, setProfile, setQuestBadge, setTickets, state, tickets } from './state.ts';
import { refreshPendingBadge, refreshQuestBadge } from './badges.ts';
import { toast } from './ui.ts';
import { rewardText } from './giftcode-text.ts';
import { MusicControl } from './components/MusicControl.tsx';
import { Avatar } from './components/Avatar.tsx';
import { CollectionPage } from './pages/Collection.tsx';
import { DrawPage } from './pages/Draw.tsx';
import { UpgradePage } from './pages/Upgrade.tsx';
import { QuestsPage } from './pages/Quests.tsx';
import { LeaderboardPage } from './pages/Leaderboard.tsx';
import { HistoryPage } from './pages/History.tsx';
import { GiftCodePage } from './pages/GiftCode.tsx';
import { ProfilePage } from './pages/Profile.tsx';
import { AdminPage } from './pages/Admin.tsx';

type PageDef = { label: string; component: () => JSX.Element; adminOnly?: boolean };
const PAGES = {
  collection: { label: 'Bộ sưu tập', component: CollectionPage },
  draw: { label: 'Quay thẻ', component: DrawPage },
  upgrade: { label: 'Nâng cấp', component: UpgradePage },
  quests: { label: 'Nhiệm vụ', component: QuestsPage },
  leaderboard: { label: 'Xếp hạng', component: LeaderboardPage },
  history: { label: 'Lịch sử', component: HistoryPage },
  giftcode: { label: 'Giftcode', component: GiftCodePage },
  profile: { label: 'Hồ sơ', component: ProfilePage },
  admin: { label: 'Quản trị', component: AdminPage, adminOnly: true },
} satisfies Record<string, PageDef>;
type PageId = keyof typeof PAGES;

const fmtCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/** Thông báo sự kiện ngày mới do server xử lý (thưởng reset 05:00, nhiệm vụ hôm trước tự nhận). */
function showDailyEvents(ev: DailyEventsDto) {
  if (ev.resetBonus) {
    const b = ev.resetBonus;
    const total = TICKET_TYPES.reduce((s, t) => s + b[t], 0);
    toast(`Ngày mới! Nhận ${total} vé thưởng (${TICKET_TYPES.map((t) => `${TICKET_LABELS[t]} ×${b[t]}`).join(', ')})`, 6000);
  }
  if (ev.autoClaimed.length) {
    const total = ev.autoClaimed.reduce((s, a) => s + a.count, 0);
    setTimeout(() => toast(`Tự nhận ${ev.autoClaimed.length} phần thưởng nhiệm vụ chưa nhận: +${total} vé`, 6000), ev.resetBonus ? 6200 : 0);
  }
}

type Phase = { kind: 'loading' } | { kind: 'login'; message?: string; info?: JSX.Element } | { kind: 'game' } | { kind: 'error'; message: string };

export function App() {
  const [phase, setPhase] = createSignal<Phase>({ kind: 'loading' });

  async function boot(): Promise<void> {
    if (!hasToken()) {
      setPhase({ kind: 'login' });
      return;
    }
    setPhase({ kind: 'loading' });
    try {
      const [me, generals, config] = await Promise.all([api.me(), api.generals(), api.gachaConfig()]);
      // Người chơi: nhận các mốc chưa xử lý ngay khi vào (offline vẫn tích lũy) — server quyết định.
      // Tài khoản quản trị không chơi game (server chặn ADMIN_NOT_PLAYER) nên bỏ qua.
      const claimed = me.isAdmin ? null : await api.claimRecovery();
      state.username = me.username;
      state.isAdmin = me.isAdmin;
      state.features = me.features;
      setProfile({ displayName: me.displayName, avatar: me.avatar });
      state.generals = generals.items;
      state.generalsById = new Map(generals.items.map((g) => [g.id, g]));
      state.config = config;
      setTickets(claimed ?? me.tickets);
      setPhase({ kind: 'game' });
      if (claimed && claimed.grantedTotal > 0) toast(`Nhận ${claimed.grantedTotal} vé hồi trong lúc vắng mặt`);
      // Request đầu tiên trong ngày (me hoặc claimRecovery) mang sự kiện ngày mới
      const daily = me.dailyEvents ?? claimed?.dailyEvents;
      if (claimed && daily) setTimeout(() => showDailyEvents(daily), claimed.grantedTotal > 0 ? 4200 : 0);
      void refreshPendingBadge();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) setPhase({ kind: 'login', message: 'Phiên đăng nhập đã hết hạn.' });
      else setPhase({ kind: 'error', message: err.message });
    }
  }

  onMount(() => void boot());

  return (
    <>
      <Show when={phase().kind === 'loading'}>
        <div class="state-msg">Đang tải…</div>
      </Show>
      <Show when={phase().kind === 'error' && phase()}>
        {(p) => (
          <div class="state-msg error">
            Không tải được game: {(p() as { message: string }).message}{' '}
            <button class="btn ghost" onClick={() => location.reload()}>
              Thử lại
            </button>
          </div>
        )}
      </Show>
      <Show when={phase().kind === 'login' && (phase() as Extract<Phase, { kind: 'login' }>)}>
        {(p) => <Login message={p().message} info={p().info} onLogin={boot} onPhase={setPhase} />}
      </Show>
      <Show when={phase().kind === 'game'}>
        <Shell onLogout={() => setPhase({ kind: 'login' })} />
      </Show>
    </>
  );
}

// ======================= Đăng nhập / đăng ký =======================

function Login(props: { message?: string; info?: JSX.Element; onLogin: () => Promise<void>; onPhase: (p: Phase) => void }) {
  let form!: HTMLFormElement;
  const [busy, setBusy] = createSignal(false);

  async function submit(ev: MouseEvent, act: 'login' | 'register') {
    ev.preventDefault();
    if (!form.reportValidity()) return;
    const fd = new FormData(form);
    const u = String(fd.get('username'));
    const p = String(fd.get('password'));
    setBusy(true);
    try {
      if (act === 'register') {
        const r = await api.register(u, p);
        if (r.status === 'pending') {
          // Tài khoản mới phải chờ admin duyệt mới đăng nhập được (mục 3.8)
          return props.onPhase({
            kind: 'login',
            info: (
              <>
                <b>Đăng ký thành công!</b> Tài khoản <b>{u}</b> đang <b>chờ quản trị viên duyệt</b>. Bạn sẽ đăng nhập được sau khi được duyệt; vé quà
                tân thủ được cấp lúc duyệt.
              </>
            ),
          });
        }
        setToken(r.token);
        await props.onLogin();
        const total = TICKET_TYPES.reduce((s, k) => s + r.signupBonus[k], 0);
        if (!state.isAdmin) toast(
          `Quà tân thủ: ${total} vé — ${TICKET_TYPES.filter((k) => r.signupBonus[k])
            .map((k) => `${TICKET_LABELS[k]} ×${r.signupBonus[k]}`)
            .join(', ')}`,
          7000,
        );
      } else {
        const r = await api.login(u, p);
        setToken(r.token);
        await props.onLogin();
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'ACCOUNT_PENDING') {
        return props.onPhase({
          kind: 'login',
          info: (
            <>
              Tài khoản <b>{u}</b> đang <b>chờ quản trị viên duyệt</b>. Vui lòng quay lại sau khi được duyệt.
            </>
          ),
        });
      }
      props.onPhase({ kind: 'login', message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="login">
      <img class="logo big" src="/icons/icon-192.png" alt="" aria-hidden="true" />
      <h1>Tam Quốc: </h1>
      <h1>Danh Tướng Lục</h1>
      <form class="panel" ref={form}>
        <label>
          Tên đăng nhập <input name="username" autocomplete="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" />
        </label>
        <label>
          Mật khẩu <input name="password" type="password" autocomplete="current-password" required minLength={6} />
        </label>
        <div class="row">
          <button class="btn primary" disabled={busy()} onClick={(e) => void submit(e, 'login')}>
            Đăng nhập
          </button>
          <button class="btn ghost" disabled={busy()} onClick={(e) => void submit(e, 'register')}>
            Tạo tài khoản
          </button>
        </div>
        <Show when={props.info}>
          <div class="notice" role="status">
            {props.info}
          </div>
        </Show>
        <div class="error" aria-live="polite">
          {props.message ?? ''}
        </div>
      </form>
    </div>
  );
}

// ======================= Khung game: thanh trên, tab, trang =======================

function readRoute(): PageId {
  // Tài khoản quản trị chỉ thấy trang Quản trị (chủ dự án yêu cầu)
  if (state.isAdmin) return 'admin';
  const raw = location.hash.slice(1) || 'collection';
  const id = (raw === 'gift' ? 'collection' : raw) as PageId;
  const p = PAGES[id] as PageDef | undefined;
  return p && !p.adminOnly ? id : 'collection';
}

function Shell(props: { onLogout: () => void }) {
  let head!: HTMLDivElement;
  let nav!: HTMLElement;
  const [route, setRoute] = createSignal<PageId>(readRoute());
  const onHash = () => setRoute(readRoute());
  window.addEventListener('hashchange', onHash);
  onCleanup(() => {
    window.removeEventListener('hashchange', onHash);
    // Đăng xuất: xoá badge của tài khoản cũ
    setQuestBadge(0);
    setPendingBadge(0);
  });

  createEffect(() => {
    const id = route();
    // Mobile: thanh tab cuộn ngang => đưa tab đang chọn vào tầm nhìn
    queueMicrotask(() => nav.querySelector<HTMLAnchorElement>(`[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
    // Quay/ghép ở trang khác có thể làm xong nhiệm vụ => cập nhật badge khi đổi trang
    if (id !== 'quests' && !state.isAdmin) void refreshQuestBadge();
  });

  onMount(() => {
    // Thanh trên + tab dính trên cùng; đo chiều cao để các phần dính khác (VD khung "Đã chọn" ở Nâng cấp) nằm ngay dưới
    const sync = () => document.documentElement.style.setProperty('--head-h', `${head.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(head);
    onCleanup(() => ro.disconnect());
    if (!state.isAdmin) void maybeShowGiftCodePopup();
  });

  const logout = async () => {
    await api.logout().catch(() => {});
    setToken(null);
    props.onLogout();
  };

  // Admin chỉ có tab Quản trị; người chơi có mọi tab trừ Quản trị
  const tabs = (Object.entries(PAGES) as [PageId, PageDef][]).filter(([, p]) => !!p.adminOnly === state.isAdmin);

  return (
    <>
      <div class="app-head" ref={head}>
        <header class="top">
          <div class="brand">
            <img class="logo" src="/icons/icon-192.png" alt="" aria-hidden="true" />
            Tam Quốc<i class="brand-sep">:</i> <span>Danh Tướng Lục</span>
          </div>
          <Show when={!state.isAdmin}>
            <TicketsBar />
          </Show>
          <div class="user">
            <MusicControl />
            <span class="user-id">
              <Avatar avatar={profile().avatar} name={profile().displayName} class="head-avatar" />
              <span class="user-name">{profile().displayName || state.username}</span>
            </span>
            <button class="btn ghost small" onClick={() => void logout()}>
              Đăng xuất
            </button>
          </div>
        </header>
        <nav class="tabs" ref={nav}>
          <For each={tabs}>
            {([id, p]) => (
              <a href={`#${id}`} data-tab={id} classList={{ on: route() === id }}>
                {p.label}
                <Show when={p.adminOnly}>
                  {' '}
                  <span class="badge" hidden={pendingBadge() === 0}>
                    {pendingBadge()}
                  </span>
                </Show>
                <Show when={id === 'quests'}>
                  {' '}
                  <span class="badge" hidden={questBadge() === 0}>
                    {questBadge()}
                  </span>
                </Show>
              </a>
            )}
          </For>
        </nav>
      </div>
      <main id="page">
        <Dynamic component={PAGES[route()].component} />
      </main>
    </>
  );
}

/** Thanh vé: số dư / trần vé hồi từng loại, tổng, đồng hồ tới mốc hồi kế tiếp. */
function TicketsBar() {
  const [now, setNow] = createSignal(performance.now());
  let claiming = false;
  // Đồng hồ đếm ngược chỉ để hiển thị. Khi tới mốc, hỏi server — server mới quyết định cấp vé.
  const timer = window.setInterval(async () => {
    setNow(performance.now());
    const left = state.nextRecoveryLocal - performance.now();
    if (left <= -1000 && !claiming) {
      claiming = true;
      try {
        const r = await api.claimRecovery();
        setTickets(r);
        if (r.dailyEvents) showDailyEvents(r.dailyEvents);
        void refreshQuestBadge();
        if (r.grantedTotal > 0) {
          toast(`Nhận ${r.grantedTotal} vé: ${TICKET_TYPES.filter((k) => r.granted[k]).map((k) => `${TICKET_LABELS[k]} ×${r.granted[k]}`).join(', ')}`);
        }
      } catch {
        state.nextRecoveryLocal = performance.now() + 15_000; // thử lại sau
      } finally {
        claiming = false;
      }
    }
  }, 500);
  onCleanup(() => clearInterval(timer));

  return (
    <div class="tickets-bar" aria-live="polite">
      <Show when={tickets()}>
        {(t) => {
          // Trần vé hồi theo thời gian (mỗi loại); vé từ nhiệm vụ/giftcode… có thể vượt trần
          const cap = () => t().recoveryCap;
          const full = (k: TicketType) => t().balances[k] >= cap()[k];
          const allFull = () => TICKET_TYPES.every(full);
          return (
            <>
              <For each={TICKET_TYPES}>
                {(k) => (
                  <span
                    class={`tb t-${k}`}
                    classList={{ full: full(k) }}
                    title={`${TICKET_LABELS[k]}${full(k) ? ` — đã đạt trần vé hồi ${cap()[k]}, không hồi thêm loại này` : ` — vé hồi tối đa ${cap()[k]}`}`}
                  >
                    {TICKET_LABELS[k].replace('Vé ', '')} <b>{t().balances[k]}</b>
                    <small class="tb-cap">/{cap()[k]}</small>
                  </span>
                )}
              </For>
              <span class="tb total">
                Tổng <b>{t().total}</b>
              </span>
              <Show
                when={!allFull()}
                fallback={
                  <span
                    class="tb timer full"
                    title={`Mọi loại vé đã đạt trần (thường ${cap().normal}, phe ${cap().shu}): vé hồi theo thời gian tạm dừng (nhiệm vụ, giftcode vẫn cộng được)`}
                  >
                    Vé hồi đã đầy
                  </span>
                }
              >
                <span
                  class="tb timer"
                  title={`Vé kế tiếp lúc ${new Date(t().nextRecoveryAt).toLocaleTimeString('vi-VN')}. Vé hồi tối đa: thường ${cap().normal}, mỗi loại phe ${cap().shu}`}
                >
                  +1 vé sau <b>{fmtCountdown(state.nextRecoveryLocal - now())}</b>
                </span>
              </Show>
            </>
          );
        }}
      </Show>
    </div>
  );
}

// ======================= Popup giftcode lần đầu đăng nhập =======================

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
  let codes: GiftCodePublicDto[];
  try {
    codes = (await api.giftcodes()).featured.filter((c) => !c.redeemed);
  } catch {
    return;
  }
  if (!codes.length) return;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const close = () => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* bỏ qua */
    }
    dispose();
    host.remove();
  };
  const dispose = render(() => <GiftCodePopup codes={codes} onClose={close} />, host);
}

function GiftCodePopup(props: { codes: GiftCodePublicDto[]; onClose: () => void }) {
  let go!: HTMLButtonElement;
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  onMount(() => {
    document.addEventListener('keydown', onKey);
    go.focus();
  });
  onCleanup(() => document.removeEventListener('keydown', onKey));
  return (
    <div class="gc-popup" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel gc-popup-box">
        <h2>Quà tân thủ</h2>
        <p>Chào mừng chủ công! Hãy nhập {props.codes.length} giftcode này để nhận quà:</p>
        <ul>
          <For each={props.codes}>
            {(c) => (
              <li>
                <b class="gc-code">{c.code}</b> — {rewardText(c.rewards)}
              </li>
            )}
          </For>
        </ul>
        <div class="row">
          <button
            class="btn primary"
            ref={go}
            onClick={() => {
              props.onClose();
              location.hash = 'giftcode';
            }}
          >
            Đến trang nhập Giftcode
          </button>
          <button class="btn ghost" onClick={() => props.onClose()}>
            Để sau
          </button>
        </div>
      </div>
    </div>
  );
}
