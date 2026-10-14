import { FACTIONS, FACTION_LABELS, TICKET_LABELS, TICKET_TYPES, type AdminUserDto, type TicketType } from '@tq/shared';
import { api, newKey, type ApiError } from '../api.ts';
import { gen, state } from '../state.ts';
import { cardHtml, esc } from '../art.ts';
import { openCardViewer } from '../viewer.ts';
import { rewardText } from './giftcode.ts';

const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN');
const pendingChanged = () => window.dispatchEvent(new Event('tq:pending-changed'));

/**
 * Trang Quản trị (mục 3.8) — chỉ admin thấy tab này; server kiểm tra quyền ở mọi route /api/admin/*.
 * - Người chơi: duyệt/từ chối đăng ký, xem số vé & số thẻ, cộng vé (chọn loại + số lượng), cấp/thu quyền admin.
 * - Thẻ tướng: mọi thẻ của mọi người chơi, lọc theo người chơi/phe/level/tên.
 * - Giftcode (mục 3.9): tạo code (vé quay nhiều loại + số lượng, hạn sử dụng tuỳ chọn), bật/tắt code.
 */
export function renderAdmin(root: HTMLElement): () => void {
  let alive = true;
  root.innerHTML = `
    <section class="panel admin">
      <div class="sub-tabs" role="tablist">
        <button class="btn small on" data-sub="users" role="tab">Người chơi</button>
        <button class="btn small" data-sub="cards" role="tab">Thẻ tướng</button>
        <button class="btn small" data-sub="giftcode" role="tab">Giftcode</button>
      </div>
      <div data-pane="users"></div>
      <div data-pane="cards" hidden></div>
      <div data-pane="giftcode" hidden></div>
    </section>`;
  const panes = {
    users: root.querySelector<HTMLDivElement>('[data-pane="users"]')!,
    cards: root.querySelector<HTMLDivElement>('[data-pane="cards"]')!,
    giftcode: root.querySelector<HTMLDivElement>('[data-pane="giftcode"]')!,
  };
  const giftcodes = giftCodePane(panes.giftcode, () => alive);
  const cards = cardsPane(panes.cards, () => alive);
  const users = usersPane(panes.users, () => alive, (userId) => {
    cards.showUser(userId);
    switchTo('cards');
  });
  type Sub = keyof typeof panes;
  function switchTo(id: Sub) {
    root.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach((b) => b.classList.toggle('on', b.dataset.sub === id));
    for (const k of Object.keys(panes) as Sub[]) panes[k].hidden = k !== id;
    if (id === 'cards') cards.ensureLoaded();
    if (id === 'giftcode') giftcodes.ensureLoaded();
  }
  root.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach((b) => (b.onclick = () => switchTo(b.dataset.sub as Sub)));
  users.load();
  return () => (alive = false);
}

// ======================= Người chơi =======================

function usersPane(el: HTMLElement, alive: () => boolean, viewCards: (userId: number) => void) {
  const pageSize = 50;
  const f = { q: '', status: '', page: 1 };
  let items: AdminUserDto[] = [];
  let grantMax = 10000;
  let openGrant: number | null = null; // userId đang mở form cộng vé
  let grantKey: { key: string; sig: string } | null = null; // giữ key khi lỗi mạng để retry an toàn
  let confirmReject: number | null = null;
  let busy = false;

  el.innerHTML = `
    <label class="adm-setting">
      <input type="checkbox" data-approval disabled />
      <span><b>Duyệt tài khoản đăng ký</b> — bật: người đăng ký mới phải chờ admin duyệt mới vào được game; tắt: đăng ký là chơi ngay.</span>
      <span class="adm-setting-state muted small"></span>
    </label>
    <div class="filters">
      <input type="search" placeholder="Tìm tên đăng nhập…" data-f="q" maxlength="32" aria-label="Tìm người chơi" />
      <select data-f="status" aria-label="Trạng thái">
        <option value="">Mọi trạng thái</option><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option>
      </select>
    </div>
    <div class="adm-summary muted small"></div>
    <div class="adm-msg" aria-live="polite"></div>
    <div class="adm-users"><div class="state-msg">Đang tải…</div></div>
    <div class="pager"><button class="btn ghost" data-prev>‹ Trước</button><span class="pinfo muted"></span><button class="btn ghost" data-next>Sau ›</button></div>`;
  const list = el.querySelector<HTMLDivElement>('.adm-users')!;
  const msg = el.querySelector<HTMLDivElement>('.adm-msg')!;
  const prev = el.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = el.querySelector<HTMLButtonElement>('[data-next]')!;
  const say = (text: string, ok = true) => (msg.innerHTML = text ? `<div class="${ok ? 'notice' : 'warn'}">${text}</div>` : '');

  // Cài đặt "Duyệt tài khoản" (lưu ở server, áp dụng cho các lượt đăng ký sau đó)
  const approval = el.querySelector<HTMLInputElement>('[data-approval]')!;
  const approvalState = el.querySelector<HTMLSpanElement>('.adm-setting-state')!;
  const showApproval = (on: boolean) => {
    approval.checked = on;
    approvalState.textContent = on ? 'Đang bật' : 'Đang tắt';
  };
  api.admin
    .settings()
    .then((s) => {
      showApproval(s.requireApproval);
      approval.disabled = false;
    })
    .catch((e) => say(esc((e as Error).message), false));
  approval.onchange = async () => {
    const want = approval.checked;
    approval.disabled = true;
    try {
      const s = await api.admin.setSettings({ requireApproval: want });
      showApproval(s.requireApproval);
      say(
        s.requireApproval
          ? 'Đã <b>bật</b> duyệt tài khoản: người đăng ký mới sẽ chờ duyệt.'
          : 'Đã <b>tắt</b> duyệt tài khoản: người đăng ký mới vào game ngay. Tài khoản đang chờ (nếu có) vẫn cần duyệt tay.',
      );
    } catch (e) {
      showApproval(!want);
      say(esc((e as ApiError).message), false);
    } finally {
      approval.disabled = false;
    }
  };

  const ticketChips = (u: AdminUserDto) =>
    TICKET_TYPES.filter((t) => u.tickets[t] > 0)
      .map((t) => `<span class="tb t-${t}">${TICKET_LABELS[t].replace('Vé ', '')} <b>${u.tickets[t]}</b></span>`)
      .join('');

  function grantForm(u: AdminUserDto): string {
    return `
      <div class="grant-form" data-grant="${u.id}">
        <label>Loại vé <select data-g="type">${TICKET_TYPES.map((t) => `<option value="${t}">${TICKET_LABELS[t]}</option>`).join('')}</select></label>
        <label>Số lượng <input data-g="amount" type="number" min="1" max="${grantMax}" step="1" value="10" inputmode="numeric" /></label>
        <button class="btn primary small" data-act="grant" data-id="${u.id}">Cộng vé</button>
        <button class="btn ghost small" data-act="grant-cancel">Huỷ</button>
        <span class="muted small">Tối đa ${grantMax.toLocaleString('vi-VN')} vé mỗi lần. Ghi lịch sử “Quản trị viên tặng”.</span>
      </div>`;
  }

  function rowHtml(u: AdminUserDto): string {
    const self = u.username === state.username;
    const status =
      u.status === 'pending' ? '<span class="tag warn-tag">Chờ duyệt</span>' : '<span class="tag ok">Đã duyệt</span>';
    const actions =
      u.status === 'pending'
        ? `<button class="btn primary small" data-act="approve" data-id="${u.id}">Duyệt</button>
           ${
             confirmReject === u.id
               ? `<button class="btn danger small" data-act="reject" data-id="${u.id}">Xác nhận từ chối</button><button class="btn ghost small" data-act="reject-cancel">Huỷ</button>`
               : `<button class="btn ghost small" data-act="reject-ask" data-id="${u.id}">Từ chối</button>`
           }`
        : `<button class="btn small" data-act="grant-open" data-id="${u.id}">+ Cộng vé</button>
           <button class="btn ghost small" data-act="cards" data-id="${u.id}" ${u.cardCount ? '' : 'disabled'}>Xem thẻ</button>
           ${
             u.isAdmin
               ? self
                 ? ''
                 : `<button class="btn ghost small" data-act="admin-off" data-id="${u.id}">Thu quyền admin</button>`
               : `<button class="btn ghost small" data-act="admin-on" data-id="${u.id}">Cấp quyền admin</button>`
           }`;
    return `
      <div class="adm-row ${u.status}">
        <div class="adm-name"><b>${esc(u.username)}</b>${u.isAdmin ? ' <span class="tag gacha">Admin</span>' : ''}${self ? ' <span class="muted small">(bạn)</span>' : ''}
          <div class="muted small">#${u.id} · đăng ký ${fmt(u.createdAt)}${u.approvedAt && u.status === 'approved' ? ` · duyệt ${fmt(u.approvedAt)}` : ''}</div></div>
        <div>${status}</div>
        <div class="adm-tix">${u.status === 'approved' ? `<span class="tb total">Tổng <b>${u.ticketTotal}</b></span>${ticketChips(u)}` : '<span class="muted small">Chưa kích hoạt</span>'}</div>
        <div class="adm-cards">${u.cardCount ? `<b>${u.cardCount}</b> thẻ${u.maxLevel ? ` · cao nhất Lv.${u.maxLevel}` : ''}` : '<span class="muted small">0 thẻ</span>'}</div>
        <div class="adm-act">${actions}</div>
        ${openGrant === u.id ? grantForm(u) : ''}
      </div>`;
  }

  function render() {
    list.innerHTML = items.length
      ? `<div class="adm-head muted small"><div>Người chơi</div><div>Trạng thái</div><div>Vé</div><div>Thẻ</div><div>Thao tác</div></div>${items.map(rowHtml).join('')}`
      : `<div class="state-msg">${f.q || f.status ? 'Không có người chơi phù hợp.' : 'Chưa có người chơi.'}</div>`;
    list.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled ||= busy));
  }

  async function load() {
    try {
      const p = await api.admin.users({ q: f.q, status: f.status || undefined, page: f.page, pageSize });
      if (!alive()) return;
      items = p.items;
      grantMax = p.grantMaxTickets;
      const pages = Math.max(1, Math.ceil(p.total / pageSize));
      el.querySelector('.adm-summary')!.innerHTML = `${p.total} người chơi${p.pendingCount ? ` · <b class="warn-text">${p.pendingCount} chờ duyệt</b>` : ''}`;
      el.querySelector('.pinfo')!.textContent = `Trang ${f.page}/${pages}`;
      prev.disabled = f.page <= 1;
      next.disabled = f.page >= pages;
      render();
    } catch (e) {
      if (alive()) list.innerHTML = `<div class="state-msg error">${esc((e as Error).message)}</div>`;
    }
  }

  async function run(action: () => Promise<string>) {
    if (busy) return;
    busy = true;
    render();
    try {
      say(await action());
    } catch (e) {
      say(esc((e as ApiError).message), false);
    } finally {
      busy = false;
      await load();
    }
  }

  list.onclick = (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b || b.disabled) return;
    const id = Number(b.dataset.id);
    const u = items.find((x) => x.id === id);
    switch (b.dataset.act) {
      case 'approve':
        return void run(async () => {
          const r = await api.admin.approve(id);
          pendingChanged();
          return `Đã duyệt <b>${esc(r.user.username)}</b> — nhận quà tân thủ ${r.user.ticketTotal} vé.`;
        });
      case 'reject-ask':
        confirmReject = id;
        return render();
      case 'reject-cancel':
        confirmReject = null;
        return render();
      case 'reject':
        confirmReject = null;
        return void run(async () => {
          const r = await api.admin.reject(id);
          pendingChanged();
          return `Đã từ chối và xoá đăng ký <b>${esc(r.username)}</b>.`;
        });
      case 'grant-open':
        openGrant = openGrant === id ? null : id;
        grantKey = null;
        render();
        return list.querySelector<HTMLInputElement>('[data-g="amount"]')?.focus();
      case 'grant-cancel':
        openGrant = null;
        grantKey = null;
        return render();
      case 'grant': {
        const form = list.querySelector<HTMLDivElement>(`[data-grant="${id}"]`)!;
        const type = form.querySelector<HTMLSelectElement>('[data-g="type"]')!.value as TicketType;
        const input = form.querySelector<HTMLInputElement>('[data-g="amount"]')!;
        const amount = Number(input.value);
        if (!Number.isInteger(amount) || amount < 1 || amount > grantMax) {
          return say(`Số vé phải là số nguyên từ 1 đến ${grantMax}.`, false);
        }
        const sig = `${id}:${type}:${amount}`;
        if (!grantKey || grantKey.sig !== sig) grantKey = { key: newKey(), sig };
        const key = grantKey.key;
        return void run(async () => {
          try {
            const r = await api.admin.grant(id, type, amount, key);
            grantKey = null;
            openGrant = null;
            return `Đã cộng <b>${r.amount} ${TICKET_LABELS[r.ticketType]}</b> cho <b>${esc(r.username)}</b> (còn ${r.balances[r.ticketType]}).`;
          } catch (e) {
            if ((e as ApiError).code !== 'NETWORK') grantKey = null; // lỗi mạng: giữ key, bấm lại là retry an toàn
            throw e;
          }
        });
      }
      case 'cards':
        return viewCards(id);
      case 'admin-on':
      case 'admin-off': {
        const on = b.dataset.act === 'admin-on';
        return void run(async () => {
          const r = await api.admin.setAdmin(id, on);
          return on ? `Đã cấp quyền quản trị cho <b>${esc(r.username)}</b>.` : `Đã thu quyền quản trị của <b>${esc(u?.username ?? r.username)}</b>.`;
        });
      }
    }
  };

  let t: number | undefined;
  el.querySelector<HTMLInputElement>('[data-f="q"]')!.oninput = (ev) => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      f.q = (ev.target as HTMLInputElement).value;
      f.page = 1;
      void load();
    }, 250);
  };
  el.querySelector<HTMLSelectElement>('[data-f="status"]')!.oninput = (ev) => {
    f.status = (ev.target as HTMLSelectElement).value;
    f.page = 1;
    void load();
  };
  prev.onclick = () => {
    f.page--;
    void load();
  };
  next.onclick = () => {
    f.page++;
    void load();
  };
  return { load: () => void load() };
}

// ======================= Thẻ tướng =======================

function cardsPane(el: HTMLElement, alive: () => boolean) {
  const pageSize = 60;
  const f = { userId: '', q: '', faction: '', level: '', sort: 'level_desc', page: 1 };
  let loaded = false;
  let usersReq: Promise<void> | null = null;
  let seq = 0; // bỏ kết quả của request cũ nếu bộ lọc đã đổi

  el.innerHTML = `
    <div class="filters">
      <select data-f="userId" aria-label="Người chơi"><option value="">Mọi người chơi</option></select>
      <input type="search" placeholder="Tìm theo tên tướng…" data-f="q" aria-label="Tìm tướng" />
      <select data-f="faction" aria-label="Phe"><option value="">Mọi phe</option>${FACTIONS.map((x) => `<option value="${x}">${FACTION_LABELS[x]}</option>`).join('')}</select>
      <select data-f="level" aria-label="Level"><option value="">Mọi level</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">Lv.${i + 1}</option>`).join('')}</select>
      <select data-f="sort" aria-label="Sắp xếp">
        <option value="level_desc" selected>Level cao nhất</option><option value="newest">Mới nhất</option><option value="name">Tên tướng A→Z</option><option value="owner">Theo người chơi</option>
      </select>
    </div>
    <div class="adm-summary muted small"></div>
    <div class="adm-cards-grid"><div class="state-msg">Đang tải…</div></div>
    <div class="pager"><button class="btn ghost" data-prev>‹ Trước</button><span class="pinfo muted"></span><button class="btn ghost" data-next>Sau ›</button></div>`;
  const grid = el.querySelector<HTMLDivElement>('.adm-cards-grid')!;
  const prev = el.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = el.querySelector<HTMLButtonElement>('[data-next]')!;
  const userSel = el.querySelector<HTMLSelectElement>('[data-f="userId"]')!;
  let shown: { id: number; generalId: string; level: number; createdAt: string; username: string }[] = [];

  function loadUsers(): Promise<void> {
    usersReq ??= fetchUsers();
    return usersReq;
  }
  async function fetchUsers() {
    try {
      const p = await api.admin.users({ status: 'approved', pageSize: 500 });
      const cur = userSel.value || f.userId;
      userSel.innerHTML =
        `<option value="">Mọi người chơi</option>` +
        p.items
          .slice()
          .sort((a, b) => a.username.localeCompare(b.username))
          .map((u) => `<option value="${u.id}">${esc(u.username)} (${u.cardCount})</option>`)
          .join('');
      userSel.value = cur;
    } catch {
      usersReq = null;
    }
  }

  async function load() {
    loaded = true;
    const my = ++seq;
    grid.innerHTML = `<div class="state-msg">Đang tải…</div>`;
    try {
      const p = await api.admin.cards({
        userId: f.userId ? Number(f.userId) : undefined,
        q: f.q,
        faction: (f.faction || undefined) as never,
        level: f.level ? Number(f.level) : undefined,
        sort: f.sort,
        page: f.page,
        pageSize,
      });
      if (!alive() || my !== seq) return;
      shown = p.items;
      const pages = Math.max(1, Math.ceil(p.total / pageSize));
      el.querySelector('.adm-summary')!.textContent = `${p.total.toLocaleString('vi-VN')} thẻ đang sở hữu`;
      el.querySelector('.pinfo')!.textContent = `Trang ${f.page}/${pages}`;
      prev.disabled = f.page <= 1;
      next.disabled = f.page >= pages;
      grid.innerHTML = p.items.length
        ? `<div class="grid adm-grid">${p.items
            .map(
              (c) => `<div class="grid-item"><button class="pick view" data-view="${c.id}" title="Xem thẻ">${cardHtml(gen(c.generalId), c.level, 'small')}<span class="cid">#${c.id}</span></button>
                <div class="owner small">👤 ${esc(c.username)}</div></div>`,
            )
            .join('')}</div>`
        : `<div class="state-msg">Không có thẻ phù hợp.</div>`;
    } catch (e) {
      if (alive() && my === seq) grid.innerHTML = `<div class="state-msg error">${esc((e as Error).message)}</div>`;
    }
  }

  grid.onclick = (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-view]');
    const c = b && shown.find((x) => x.id === Number(b.dataset.view));
    if (c) openCardViewer(gen(c.generalId), c);
  };
  let t: number | undefined;
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((input) => {
    input.oninput = () => {
      const apply = () => {
        (f as Record<string, string | number>)[input.dataset.f!] = input.value;
        f.page = 1;
        void load();
      };
      clearTimeout(t);
      if (input.dataset.f === 'q') t = window.setTimeout(apply, 250);
      else apply();
    };
  });
  prev.onclick = () => {
    f.page--;
    void load();
  };
  next.onclick = () => {
    f.page++;
    void load();
  };

  return {
    ensureLoaded() {
      void loadUsers();
      if (!loaded) void load();
    },
    showUser(userId: number) {
      f.userId = String(userId);
      f.page = 1;
      void loadUsers().then(() => (userSel.value = f.userId));
      userSel.value = f.userId;
      void load();
    },
  };
}

// ======================= Giftcode =======================

function giftCodePane(el: HTMLElement, alive: () => boolean) {
  let loaded = false;
  let busy = false;
  const MAX_T = state.config!.giftCodeMaxTickets; // server kiểm tra lại
  el.innerHTML = `
    <form class="gc-create">
      <h3>Tạo giftcode</h3>
      <label>Mã giftcode <input data-g="code" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_\\-]+" placeholder="VD: TET2027" autocapitalize="characters" /></label>
      <div class="muted small">Số <b>vé quay</b> mỗi loại (để trống hoặc 0 nếu không tặng). Giftcode chỉ tặng vé.</div>
      <div class="gc-rewards">${TICKET_TYPES.map(
        (t) => `<label class="t-${t}">${TICKET_LABELS[t]} <input type="number" min="0" max="${MAX_T}" step="1" data-kind="ticket" data-pool="${t}" inputmode="numeric" placeholder="0" /></label>`,
      ).join('')}</div>
      <label>Hạn sử dụng (tuỳ chọn) <input type="datetime-local" data-g="expires" /></label>
      <label class="check"><input type="checkbox" data-g="featured" /> Hiện trong popup chào người mới & mục gợi ý</label>
      <div class="row"><button class="btn primary" data-create>Tạo giftcode</button><span class="gc-total muted small"></span></div>
      <div class="gc-admin-msg" aria-live="polite"></div>
    </form>
    <h3>Danh sách giftcode</h3>
    <div class="gc-admin-list"><div class="state-msg">Đang tải…</div></div>`;
  const form = el.querySelector<HTMLFormElement>('.gc-create')!;
  const listEl = el.querySelector<HTMLDivElement>('.gc-admin-list')!;
  const msg = el.querySelector<HTMLDivElement>('.gc-admin-msg')!;
  const totalEl = el.querySelector<HTMLSpanElement>('.gc-total')!;
  const say = (html: string, ok = true) => (msg.innerHTML = html ? `<div class="${ok ? 'notice' : 'warn'}">${html}</div>` : '');

  const readRewards = () =>
    [...form.querySelectorAll<HTMLInputElement>('[data-pool]')]
      .map((i) => ({ kind: 'ticket' as const, pool: i.dataset.pool as TicketType, count: Math.floor(Number(i.value) || 0) }))
      .filter((r) => r.count > 0);
  const totalOf = (rs: ReturnType<typeof readRewards>) => rs.reduce((s, r) => s + r.count, 0);
  form.oninput = () => {
    const t = totalOf(readRewards());
    totalEl.textContent = t ? `Tổng ${t} vé${t > MAX_T ? ` — vượt tối đa ${MAX_T}` : ''}` : '';
  };

  async function load() {
    loaded = true;
    try {
      const { items } = await api.admin.giftcodes();
      if (!alive()) return;
      const now = Date.now();
      listEl.innerHTML = items.length
        ? `<div class="gc-table">${items
            .map((c) => {
              const expired = c.expiresAt !== null && Date.parse(c.expiresAt) <= now;
              const status = !c.isActive
                ? '<span class="tag bad">Đã tắt</span>'
                : expired
                  ? '<span class="tag warn-tag">Hết hạn</span>'
                  : '<span class="tag ok">Đang bật</span>';
              return `<div class="gc-row">
                <div><b class="gc-code">${esc(c.code)}</b>${c.featured ? ' <span class="tag gacha">Gợi ý</span>' : ''}
                  <div class="muted small">${c.createdBy ? `bởi ${esc(c.createdBy)} · ` : 'mặc định · '}${fmt(c.createdAt)}</div></div>
                <div>${esc(rewardText(c.rewards))}<div class="muted small">Tổng ${[c.totalTickets ? `${c.totalTickets} vé` : '', c.totalCards ? `${c.totalCards} thẻ` : ''].filter(Boolean).join(' + ')}</div></div>
                <div class="small">${c.expiresAt ? `Hạn ${fmt(c.expiresAt)}` : 'Không hạn'}</div>
                <div class="small"><b>${c.redemptionCount}</b> lượt nhập</div>
                <div>${status}</div>
                <div>${
                  c.totalCards > 0 && !c.isActive
                    ? '<span class="muted small" title="Giftcode chỉ tặng vé quay; code thẻ cũ không bật lại được">Code thẻ cũ</span>'
                    : `<button class="btn ghost small" data-toggle="${c.id}" data-active="${c.isActive ? 1 : 0}">${c.isActive ? 'Tắt' : 'Bật'}</button>`
                }</div>
              </div>`;
            })
            .join('')}</div>`
        : '<div class="state-msg">Chưa có giftcode.</div>';
    } catch (e) {
      if (alive()) listEl.innerHTML = `<div class="state-msg error">${esc((e as Error).message)}</div>`;
    }
  }

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    if (busy || !form.reportValidity()) return;
    const rewards = readRewards();
    if (!rewards.length) return say('Hãy nhập số vé cho ít nhất 1 loại.', false);
    if (totalOf(rewards) > MAX_T) return say(`Mỗi giftcode tối đa ${MAX_T} vé.`, false);
    const expiresRaw = form.querySelector<HTMLInputElement>('[data-g="expires"]')!.value;
    const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null; // datetime-local theo giờ máy admin
    const btn = form.querySelector<HTMLButtonElement>('[data-create]')!;
    busy = true;
    btn.disabled = true;
    try {
      const c = await api.admin.createGiftCode({
        code: form.querySelector<HTMLInputElement>('[data-g="code"]')!.value.trim(),
        rewards,
        expiresAt,
        featured: form.querySelector<HTMLInputElement>('[data-g="featured"]')!.checked,
      });
      form.reset();
      totalEl.textContent = '';
      say(`Đã tạo giftcode <b>${esc(c.code)}</b>: ${esc(rewardText(c.rewards))}${c.expiresAt ? `, hạn ${fmt(c.expiresAt)}` : ', không hạn'}.`);
      void load();
    } catch (e) {
      say(esc((e as ApiError).message), false);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  };

  listEl.onclick = async (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-toggle]');
    if (!b || busy) return;
    busy = true;
    b.disabled = true;
    try {
      const c = await api.admin.setGiftCodeActive(Number(b.dataset.toggle), b.dataset.active !== '1');
      say(`Giftcode <b>${esc(c.code)}</b> đã ${c.isActive ? 'bật' : 'tắt'}.`);
    } catch (e) {
      say(esc((e as ApiError).message), false);
    } finally {
      busy = false;
      void load();
    }
  };

  return {
    ensureLoaded() {
      if (!loaded) void load();
    },
  };
}
