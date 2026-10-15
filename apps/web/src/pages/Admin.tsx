import { For, Match, Show, Switch, createSignal, onCleanup, type JSX } from 'solid-js';
import {
  FACTIONS,
  FACTION_LABELS,
  TICKET_LABELS,
  TICKET_TYPES,
  type AdminCardDto,
  type AdminGiftCodeDto,
  type AdminUserDto,
  type TicketType,
} from '@tq/shared';
import { api, newKey, type ApiError } from '../api.ts';
import { gen, state } from '../state.ts';
import { refreshPendingBadge } from '../badges.ts';
import { openCardViewer } from '../viewer.tsx';
import { rewardText } from '../giftcode-text.ts';
import { Card } from '../components/Card.tsx';

const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN');

/** Thông báo: chuỗi thường hoặc đoạn in đậm (thay HTML `<b>` cũ). */
type MsgPart = string | { b: string };
type Msg = { ok: boolean; parts: MsgPart[] } | null;
const b = (s: string | number): MsgPart => ({ b: String(s) });

function MsgBox(props: { msg: Msg }) {
  return (
    <Show when={props.msg}>
      {(m) => (
        <div class={m().ok ? 'notice' : 'warn'}>
          <For each={m().parts}>{(p) => (typeof p === 'string' ? p : <b>{p.b}</b>)}</For>
        </div>
      )}
    </Show>
  );
}

type Load = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready' };
type PagerInfo = { page: number; pages: number } | null;

function Pager(props: { info: PagerInfo; onPrev: () => void; onNext: () => void }) {
  return (
    <div class="pager">
      <button class="btn ghost" data-prev disabled={!!props.info && props.info.page <= 1} onClick={() => props.onPrev()}>
        ‹ Trước
      </button>
      <span class="pinfo muted">{props.info ? `Trang ${props.info.page}/${props.info.pages}` : ''}</span>
      <button
        class="btn ghost"
        data-next
        disabled={!!props.info && props.info.page >= props.info.pages}
        onClick={() => props.onNext()}
      >
        Sau ›
      </button>
    </div>
  );
}

type Sub = 'users' | 'cards' | 'giftcode';
type PaneCtl = { ensureLoaded: () => void };
type CardsCtl = PaneCtl & { showUser: (userId: number) => void };

/**
 * Trang Quản trị (mục 3.8) — chỉ admin thấy tab này; server kiểm tra quyền ở mọi route /api/admin/*.
 * - Người chơi: duyệt/từ chối đăng ký, xem số vé & số thẻ, cộng vé (chọn loại + số lượng), cấp/thu quyền admin.
 * - Thẻ tướng: mọi thẻ của mọi người chơi, lọc theo người chơi/phe/level/tên.
 * - Giftcode (mục 3.9): tạo code (vé quay nhiều loại + số lượng, hạn sử dụng tuỳ chọn), bật/tắt code.
 */
export function AdminPage(): JSX.Element {
  let alive = true;
  onCleanup(() => (alive = false));
  const isAlive = () => alive;
  const [sub, setSub] = createSignal<Sub>('users');
  let cards: CardsCtl | undefined;
  let giftcodes: PaneCtl | undefined;

  function switchTo(id: Sub) {
    setSub(id);
    if (id === 'cards') cards?.ensureLoaded();
    if (id === 'giftcode') giftcodes?.ensureLoaded();
  }
  const tabs: [Sub, string][] = [
    ['users', 'Người chơi'],
    ['cards', 'Thẻ tướng'],
    ['giftcode', 'Giftcode'],
  ];

  return (
    <section class="panel admin">
      <div class="sub-tabs" role="tablist">
        <For each={tabs}>
          {([id, label]) => (
            <button class="btn small" classList={{ on: sub() === id }} data-sub={id} role="tab" onClick={() => switchTo(id)}>
              {label}
            </button>
          )}
        </For>
      </div>
      <div data-pane="users" hidden={sub() !== 'users'}>
        <UsersPane
          alive={isAlive}
          viewCards={(userId) => {
            cards?.showUser(userId);
            switchTo('cards');
          }}
        />
      </div>
      <div data-pane="cards" hidden={sub() !== 'cards'}>
        <CardsPane alive={isAlive} ctl={(c) => (cards = c)} />
      </div>
      <div data-pane="giftcode" hidden={sub() !== 'giftcode'}>
        <GiftCodePane alive={isAlive} ctl={(c) => (giftcodes = c)} />
      </div>
    </section>
  );
}

// ======================= Người chơi =======================

function UsersPane(props: { alive: () => boolean; viewCards: (userId: number) => void }) {
  const pageSize = 50;
  const f = { q: '', status: '', page: 1 };
  const [items, setItems] = createSignal<AdminUserDto[]>([]);
  const [listState, setListState] = createSignal<Load>({ kind: 'loading' });
  const [grantMax, setGrantMax] = createSignal(10000);
  const [openGrant, setOpenGrant] = createSignal<number | null>(null); // userId đang mở form cộng vé
  let grantKey: { key: string; sig: string } | null = null; // giữ key khi lỗi mạng để retry an toàn
  const [grantType, setGrantType] = createSignal<TicketType>('normal');
  const [grantAmount, setGrantAmount] = createSignal('10');
  let focusGrant = false;
  const [confirmReject, setConfirmReject] = createSignal<number | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<Msg>(null);
  const [summary, setSummary] = createSignal<{ total: number; pending: number } | null>(null);
  const [pager, setPager] = createSignal<PagerInfo>(null);
  /** Bộ lọc của lần tải gần nhất có đang bật không (chọn câu báo danh sách trống). */
  const [hasFilter, setHasFilter] = createSignal(false);
  const say = (parts: MsgPart[], ok = true) => setMsg(parts.length ? { ok, parts } : null);

  // Cài đặt "Duyệt tài khoản" (lưu ở server, áp dụng cho các lượt đăng ký sau đó)
  let approval!: HTMLInputElement;
  const [approvalOn, setApprovalOn] = createSignal<boolean | null>(null);
  const [approvalDisabled, setApprovalDisabled] = createSignal(true);
  const showApproval = (on: boolean) => {
    setApprovalOn(on);
    approval.checked = on; // đồng bộ cả khi signal không đổi (người dùng vừa bấm nhưng lỗi)
  };
  api.admin
    .settings()
    .then((s) => {
      if (!props.alive()) return;
      showApproval(s.requireApproval);
      setApprovalDisabled(false);
    })
    .catch((e) => props.alive() && say([(e as Error).message], false));
  async function onApprovalChange() {
    const want = approval.checked;
    setApprovalDisabled(true);
    try {
      const s = await api.admin.setSettings({ requireApproval: want });
      if (!props.alive()) return;
      showApproval(s.requireApproval);
      say(
        s.requireApproval
          ? ['Đã ', b('bật'), ' duyệt tài khoản: người đăng ký mới sẽ chờ duyệt.']
          : ['Đã ', b('tắt'), ' duyệt tài khoản: người đăng ký mới vào game ngay. Tài khoản đang chờ (nếu có) vẫn cần duyệt tay.'],
      );
    } catch (e) {
      if (!props.alive()) return;
      showApproval(!want);
      say([(e as ApiError).message], false);
    } finally {
      setApprovalDisabled(false);
    }
  }

  async function load() {
    try {
      const p = await api.admin.users({ q: f.q, status: f.status || undefined, page: f.page, pageSize });
      if (!props.alive()) return;
      setHasFilter(!!(f.q || f.status));
      setItems(p.items);
      setGrantMax(p.grantMaxTickets);
      const pages = Math.max(1, Math.ceil(p.total / pageSize));
      setSummary({ total: p.total, pending: p.pendingCount });
      setPager({ page: f.page, pages });
      setListState({ kind: 'ready' });
    } catch (e) {
      if (props.alive()) setListState({ kind: 'error', text: (e as Error).message });
    }
  }

  async function run(action: () => Promise<MsgPart[]>) {
    if (busy()) return;
    setBusy(true);
    try {
      const parts = await action();
      if (props.alive()) say(parts);
    } catch (e) {
      if (props.alive()) say([(e as ApiError).message], false);
    } finally {
      setBusy(false);
      await load();
    }
  }

  const approve = (id: number) =>
    run(async () => {
      const r = await api.admin.approve(id);
      void refreshPendingBadge();
      return ['Đã duyệt ', b(r.user.username), ` — nhận quà tân thủ ${r.user.ticketTotal} vé.`];
    });
  const reject = (id: number) => {
    setConfirmReject(null);
    void run(async () => {
      const r = await api.admin.reject(id);
      void refreshPendingBadge();
      return ['Đã từ chối và xoá đăng ký ', b(r.username), '.'];
    });
  };
  const toggleGrant = (id: number) => {
    const opening = openGrant() !== id;
    if (opening) {
      setGrantType('normal');
      setGrantAmount('10');
      focusGrant = true;
    }
    setOpenGrant(opening ? id : null);
    grantKey = null;
  };
  const cancelGrant = () => {
    setOpenGrant(null);
    grantKey = null;
  };
  const grant = (id: number) => {
    const type = grantType();
    const amount = Number(grantAmount());
    const max = grantMax();
    if (!Number.isInteger(amount) || amount < 1 || amount > max) {
      return say([`Số vé phải là số nguyên từ 1 đến ${max}.`], false);
    }
    const sig = `${id}:${type}:${amount}`;
    if (!grantKey || grantKey.sig !== sig) grantKey = { key: newKey(), sig };
    const key = grantKey.key;
    void run(async () => {
      try {
        const r = await api.admin.grant(id, type, amount, key);
        grantKey = null;
        setOpenGrant(null);
        return ['Đã cộng ', b(`${r.amount} ${TICKET_LABELS[r.ticketType]}`), ' cho ', b(r.username), ` (còn ${r.balances[r.ticketType]}).`];
      } catch (e) {
        if ((e as ApiError).code !== 'NETWORK') grantKey = null; // lỗi mạng: giữ key, bấm lại là retry an toàn
        throw e;
      }
    });
  };
  const setAdmin = (u: AdminUserDto, on: boolean) =>
    run(async () => {
      const r = await api.admin.setAdmin(u.id, on);
      return on
        ? ['Đã cấp quyền quản trị cho ', b(r.username), '.']
        : ['Đã thu quyền quản trị của ', b(u.username), '.'];
    });

  function GrantForm(p: { u: AdminUserDto }) {
    return (
      <div class="grant-form" data-grant={p.u.id}>
        <label>
          Loại vé{' '}
          <select data-g="type" value={grantType()} onChange={(e) => setGrantType(e.currentTarget.value as TicketType)}>
            <For each={TICKET_TYPES}>{(t) => <option value={t}>{TICKET_LABELS[t]}</option>}</For>
          </select>
        </label>
        <label>
          Số lượng{' '}
          <input
            data-g="amount"
            type="number"
            min="1"
            max={grantMax()}
            step="1"
            value={grantAmount()}
            inputmode="numeric"
            onInput={(e) => setGrantAmount(e.currentTarget.value)}
            ref={(el: HTMLInputElement) => {
              if (focusGrant) {
                focusGrant = false;
                queueMicrotask(() => el.focus());
              }
            }}
          />
        </label>
        <button class="btn primary small" data-act="grant" disabled={busy()} onClick={() => grant(p.u.id)}>
          Cộng vé
        </button>
        <button class="btn ghost small" data-act="grant-cancel" disabled={busy()} onClick={cancelGrant}>
          Huỷ
        </button>
        <span class="muted small">
          Tối đa {grantMax().toLocaleString('vi-VN')} vé mỗi lần. Ghi lịch sử “Quản trị viên tặng”.
        </span>
      </div>
    );
  }

  function Row(p: { u: AdminUserDto }) {
    const u = p.u;
    const self = u.username === state.username;
    return (
      <div class={`adm-row ${u.status}`}>
        <div class="adm-name">
          <b>{u.username}</b>
          <Show when={u.isAdmin}>
            {' '}
            <span class="tag gacha">Admin</span>
          </Show>
          <Show when={self}>
            {' '}
            <span class="muted small">(bạn)</span>
          </Show>
          <div class="muted small">
            #{u.id} · đăng ký {fmt(u.createdAt)}
            {u.approvedAt && u.status === 'approved' ? ` · duyệt ${fmt(u.approvedAt)}` : ''}
          </div>
        </div>
        <div>
          {u.status === 'pending' ? <span class="tag warn-tag">Chờ duyệt</span> : <span class="tag ok">Đã duyệt</span>}
        </div>
        <div class="adm-tix">
          <Show when={u.status === 'approved'} fallback={<span class="muted small">Chưa kích hoạt</span>}>
            <span class="tb total">
              Tổng <b>{u.ticketTotal}</b>
            </span>
            <For each={TICKET_TYPES.filter((t) => u.tickets[t] > 0)}>
              {(t) => (
                <span class={`tb t-${t}`}>
                  {TICKET_LABELS[t].replace('Vé ', '')} <b>{u.tickets[t]}</b>
                </span>
              )}
            </For>
          </Show>
        </div>
        <div class="adm-cards">
          <Show when={u.cardCount} fallback={<span class="muted small">0 thẻ</span>}>
            <b>{u.cardCount}</b> thẻ{u.maxLevel ? ` · cao nhất Lv.${u.maxLevel}` : ''}
          </Show>
        </div>
        <div class="adm-act">
          <Show
            when={u.status === 'pending'}
            fallback={
              <>
                {/* Admin không chơi game => không cộng vé cho admin (server trả TARGET_IS_ADMIN) */}
                <Show when={!u.isAdmin}>
                  <button class="btn small" data-act="grant-open" disabled={busy()} onClick={() => toggleGrant(u.id)}>
                    + Cộng vé
                  </button>
                </Show>
                <button
                  class="btn ghost small"
                  data-act="cards"
                  disabled={!u.cardCount || busy()}
                  onClick={() => props.viewCards(u.id)}
                >
                  Xem thẻ
                </button>
                <Show
                  when={u.isAdmin}
                  fallback={
                    <button class="btn ghost small" data-act="admin-on" disabled={busy()} onClick={() => void setAdmin(u, true)}>
                      Cấp quyền admin
                    </button>
                  }
                >
                  <Show when={!self}>
                    <button class="btn ghost small" data-act="admin-off" disabled={busy()} onClick={() => void setAdmin(u, false)}>
                      Thu quyền admin
                    </button>
                  </Show>
                </Show>
              </>
            }
          >
            <button class="btn primary small" data-act="approve" disabled={busy()} onClick={() => void approve(u.id)}>
              Duyệt
            </button>
            <Show
              when={confirmReject() === u.id}
              fallback={
                <button class="btn ghost small" data-act="reject-ask" disabled={busy()} onClick={() => setConfirmReject(u.id)}>
                  Từ chối
                </button>
              }
            >
              <button class="btn danger small" data-act="reject" disabled={busy()} onClick={() => reject(u.id)}>
                Xác nhận từ chối
              </button>
              <button class="btn ghost small" data-act="reject-cancel" disabled={busy()} onClick={() => setConfirmReject(null)}>
                Huỷ
              </button>
            </Show>
          </Show>
        </div>
        <Show when={openGrant() === u.id}>
          <GrantForm u={u} />
        </Show>
      </div>
    );
  }

  let t: number | undefined;
  onCleanup(() => clearTimeout(t));
  const onSearch = (value: string) => {
    clearTimeout(t);
    t = window.setTimeout(() => {
      f.q = value;
      f.page = 1;
      void load();
    }, 250);
  };
  void load();

  return (
    <>
      <label class="adm-setting">
        <input type="checkbox" data-approval disabled={approvalDisabled()} ref={approval} onChange={() => void onApprovalChange()} />
        <span>
          <b>Duyệt tài khoản đăng ký</b> — bật: người đăng ký mới phải chờ admin duyệt mới vào được game; tắt: đăng ký là chơi ngay.
        </span>
        <span class="adm-setting-state muted small">
          {approvalOn() === null ? '' : approvalOn() ? 'Đang bật' : 'Đang tắt'}
        </span>
      </label>
      <div class="filters">
        <input
          type="search"
          placeholder="Tìm tên đăng nhập…"
          data-f="q"
          maxLength={32}
          aria-label="Tìm người chơi"
          onInput={(e) => onSearch(e.currentTarget.value)}
        />
        <select
          data-f="status"
          aria-label="Trạng thái"
          onInput={(e) => {
            f.status = e.currentTarget.value;
            f.page = 1;
            void load();
          }}
        >
          <option value="">Mọi trạng thái</option>
          <option value="pending">Chờ duyệt</option>
          <option value="approved">Đã duyệt</option>
        </select>
      </div>
      <div class="adm-summary muted small">
        <Show when={summary()}>
          {(s) => (
            <>
              {s().total} người chơi
              <Show when={s().pending}>
                {' · '}
                <b class="warn-text">{s().pending} chờ duyệt</b>
              </Show>
            </>
          )}
        </Show>
      </div>
      <div class="adm-msg" aria-live="polite">
        <MsgBox msg={msg()} />
      </div>
      <div class="adm-users">
        <Switch>
          <Match when={listState().kind === 'loading'}>
            <div class="state-msg">Đang tải…</div>
          </Match>
          <Match when={listState().kind === 'error'}>
            <div class="state-msg error">{(listState() as { text: string }).text}</div>
          </Match>
          <Match when={items().length > 0}>
            <div class="adm-head muted small">
              <div>Người chơi</div>
              <div>Trạng thái</div>
              <div>Vé</div>
              <div>Thẻ</div>
              <div>Thao tác</div>
            </div>
            <For each={items()}>{(u) => <Row u={u} />}</For>
          </Match>
          <Match when={true}>
            <div class="state-msg">{hasFilter() ? 'Không có người chơi phù hợp.' : 'Chưa có người chơi.'}</div>
          </Match>
        </Switch>
      </div>
      <Pager
        info={pager()}
        onPrev={() => {
          f.page--;
          void load();
        }}
        onNext={() => {
          f.page++;
          void load();
        }}
      />
    </>
  );
}

// ======================= Thẻ tướng =======================

function CardsPane(props: { alive: () => boolean; ctl: (c: CardsCtl) => void }) {
  const pageSize = 60;
  const f = { userId: '', q: '', faction: '', level: '', sort: 'level_desc', page: 1 };
  let loaded = false;
  let usersReq: Promise<void> | null = null;
  let seq = 0; // bỏ kết quả của request cũ nếu bộ lọc đã đổi
  let userSel!: HTMLSelectElement;
  const [userOpts, setUserOpts] = createSignal<AdminUserDto[]>([]);
  const [grid, setGrid] = createSignal<Load>({ kind: 'loading' });
  const [shown, setShown] = createSignal<AdminCardDto[]>([]);
  const [summary, setSummary] = createSignal('');
  const [pager, setPager] = createSignal<PagerInfo>(null);

  function loadUsers(): Promise<void> {
    usersReq ??= fetchUsers();
    return usersReq;
  }
  async function fetchUsers() {
    try {
      const p = await api.admin.users({ status: 'approved', pageSize: 500 });
      if (!props.alive()) return;
      const cur = userSel.value || f.userId;
      setUserOpts(p.items.slice().sort((a, c) => a.username.localeCompare(c.username)));
      userSel.value = cur;
    } catch {
      usersReq = null;
    }
  }

  async function load() {
    loaded = true;
    const my = ++seq;
    setGrid({ kind: 'loading' });
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
      if (!props.alive() || my !== seq) return;
      setShown(p.items);
      const pages = Math.max(1, Math.ceil(p.total / pageSize));
      setSummary(`${p.total.toLocaleString('vi-VN')} thẻ đang sở hữu`);
      setPager({ page: f.page, pages });
      setGrid({ kind: 'ready' });
    } catch (e) {
      if (props.alive() && my === seq) setGrid({ kind: 'error', text: (e as Error).message });
    }
  }

  let t: number | undefined;
  onCleanup(() => clearTimeout(t));
  const onFilter = (key: 'userId' | 'q' | 'faction' | 'level' | 'sort', value: string) => {
    const apply = () => {
      f[key] = value;
      f.page = 1;
      void load();
    };
    clearTimeout(t);
    if (key === 'q') t = window.setTimeout(apply, 250);
    else apply();
  };

  props.ctl({
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
  });

  return (
    <>
      <div class="filters">
        <select data-f="userId" aria-label="Người chơi" ref={userSel} onInput={(e) => onFilter('userId', e.currentTarget.value)}>
          <option value="">Mọi người chơi</option>
          <For each={userOpts()}>
            {(u) => (
              <option value={u.id}>
                {u.username} ({u.cardCount})
              </option>
            )}
          </For>
        </select>
        <input
          type="search"
          placeholder="Tìm theo tên tướng…"
          data-f="q"
          aria-label="Tìm tướng"
          onInput={(e) => onFilter('q', e.currentTarget.value)}
        />
        <select data-f="faction" aria-label="Phe" onInput={(e) => onFilter('faction', e.currentTarget.value)}>
          <option value="">Mọi phe</option>
          <For each={FACTIONS}>{(x) => <option value={x}>{FACTION_LABELS[x]}</option>}</For>
        </select>
        <select data-f="level" aria-label="Level" onInput={(e) => onFilter('level', e.currentTarget.value)}>
          <option value="">Mọi level</option>
          <For each={Array.from({ length: 10 }, (_, i) => i + 1)}>{(lv) => <option value={lv}>Lv.{lv}</option>}</For>
        </select>
        <select data-f="sort" aria-label="Sắp xếp" onInput={(e) => onFilter('sort', e.currentTarget.value)}>
          <option value="level_desc" selected>
            Level cao nhất
          </option>
          <option value="newest">Mới nhất</option>
          <option value="name">Tên tướng A→Z</option>
          <option value="owner">Theo người chơi</option>
        </select>
      </div>
      <div class="adm-summary muted small">{summary()}</div>
      <div class="adm-cards-grid">
        <Switch>
          <Match when={grid().kind === 'loading'}>
            <div class="state-msg">Đang tải…</div>
          </Match>
          <Match when={grid().kind === 'error'}>
            <div class="state-msg error">{(grid() as { text: string }).text}</div>
          </Match>
          <Match when={shown().length > 0}>
            <div class="grid adm-grid">
              <For each={shown()}>
                {(c) => (
                  <div class="grid-item">
                    <button class="pick view" data-view={c.id} title="Xem thẻ" onClick={() => openCardViewer(gen(c.generalId), c)}>
                      <Card general={gen(c.generalId)} level={c.level} extra="small" />
                    </button>
                    <div class="owner small">👤 {c.username}</div>
                  </div>
                )}
              </For>
            </div>
          </Match>
          <Match when={true}>
            <div class="state-msg">Không có thẻ phù hợp.</div>
          </Match>
        </Switch>
      </div>
      <Pager
        info={pager()}
        onPrev={() => {
          f.page--;
          void load();
        }}
        onNext={() => {
          f.page++;
          void load();
        }}
      />
    </>
  );
}

// ======================= Giftcode =======================

function GiftCodePane(props: { alive: () => boolean; ctl: (c: PaneCtl) => void }) {
  let loaded = false;
  const [busy, setBusy] = createSignal(false);
  const [toggling, setToggling] = createSignal<number | null>(null);
  const MAX_T = state.config!.giftCodeMaxTickets; // server kiểm tra lại
  let form!: HTMLFormElement;
  let codeInput!: HTMLInputElement;
  let expiresInput!: HTMLInputElement;
  let featuredInput!: HTMLInputElement;
  const [total, setTotal] = createSignal('');
  const [msg, setMsg] = createSignal<Msg>(null);
  const [list, setList] = createSignal<Load>({ kind: 'loading' });
  const [items, setItems] = createSignal<{ codes: AdminGiftCodeDto[]; now: number }>({ codes: [], now: 0 });
  const say = (parts: MsgPart[], ok = true) => setMsg(parts.length ? { ok, parts } : null);

  const readRewards = () =>
    [...form.querySelectorAll<HTMLInputElement>('[data-pool]')]
      .map((i) => ({ kind: 'ticket' as const, pool: i.dataset.pool as TicketType, count: Math.floor(Number(i.value) || 0) }))
      .filter((r) => r.count > 0);
  const totalOf = (rs: ReturnType<typeof readRewards>) => rs.reduce((s, r) => s + r.count, 0);
  const onFormInput = () => {
    const t = totalOf(readRewards());
    setTotal(t ? `Tổng ${t} vé${t > MAX_T ? ` — vượt tối đa ${MAX_T}` : ''}` : '');
  };

  async function load() {
    loaded = true;
    try {
      const { items: codes } = await api.admin.giftcodes();
      if (!props.alive()) return;
      setItems({ codes, now: Date.now() });
      setList({ kind: 'ready' });
    } catch (e) {
      if (props.alive()) setList({ kind: 'error', text: (e as Error).message });
    }
  }

  async function onSubmit(ev: SubmitEvent) {
    ev.preventDefault();
    if (busy() || !form.reportValidity()) return;
    const rewards = readRewards();
    if (!rewards.length) return say(['Hãy nhập số vé cho ít nhất 1 loại.'], false);
    if (totalOf(rewards) > MAX_T) return say([`Mỗi giftcode tối đa ${MAX_T} vé.`], false);
    const expiresRaw = expiresInput.value;
    const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null; // datetime-local theo giờ máy admin
    setBusy(true);
    try {
      const c = await api.admin.createGiftCode({
        code: codeInput.value.trim(),
        rewards,
        expiresAt,
        featured: featuredInput.checked,
      });
      if (!props.alive()) return;
      form.reset();
      setTotal('');
      say(['Đã tạo giftcode ', b(c.code), `: ${rewardText(c.rewards)}${c.expiresAt ? `, hạn ${fmt(c.expiresAt)}` : ', không hạn'}.`]);
      void load();
    } catch (e) {
      if (props.alive()) say([(e as ApiError).message], false);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: AdminGiftCodeDto) {
    if (busy()) return;
    setBusy(true);
    setToggling(c.id);
    try {
      const r = await api.admin.setGiftCodeActive(c.id, !c.isActive);
      if (props.alive()) say(['Giftcode ', b(r.code), ` đã ${r.isActive ? 'bật' : 'tắt'}.`]);
    } catch (e) {
      if (props.alive()) say([(e as ApiError).message], false);
    } finally {
      setBusy(false);
      await load();
      setToggling(null);
    }
  }

  props.ctl({
    ensureLoaded() {
      if (!loaded) void load();
    },
  });

  return (
    <>
      <form class="gc-create" ref={form} onInput={onFormInput} onSubmit={(ev) => void onSubmit(ev)}>
        <h3>Tạo giftcode</h3>
        <label>
          Mã giftcode{' '}
          <input
            data-g="code"
            ref={codeInput}
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9_\-]+"
            placeholder="VD: TET2027"
            autocapitalize="characters"
          />
        </label>
        <div class="muted small">
          Số <b>vé quay</b> mỗi loại (để trống hoặc 0 nếu không tặng). Giftcode chỉ tặng vé.
        </div>
        <div class="gc-rewards">
          <For each={TICKET_TYPES}>
            {(t) => (
              <label class={`t-${t}`}>
                {TICKET_LABELS[t]}{' '}
                <input type="number" min="0" max={MAX_T} step="1" data-kind="ticket" data-pool={t} inputmode="numeric" placeholder="0" />
              </label>
            )}
          </For>
        </div>
        <label>
          Hạn sử dụng (tuỳ chọn) <input type="datetime-local" data-g="expires" ref={expiresInput} />
        </label>
        <label class="check">
          <input type="checkbox" data-g="featured" ref={featuredInput} /> Hiện trong popup chào người mới & mục gợi ý
        </label>
        <div class="row">
          <button class="btn primary" data-create disabled={busy() && toggling() === null}>
            Tạo giftcode
          </button>
          <span class="gc-total muted small">{total()}</span>
        </div>
        <div class="gc-admin-msg" aria-live="polite">
          <MsgBox msg={msg()} />
        </div>
      </form>
      <h3>Danh sách giftcode</h3>
      <div class="gc-admin-list">
        <Switch>
          <Match when={list().kind === 'loading'}>
            <div class="state-msg">Đang tải…</div>
          </Match>
          <Match when={list().kind === 'error'}>
            <div class="state-msg error">{(list() as { text: string }).text}</div>
          </Match>
          <Match when={items().codes.length > 0}>
            <div class="gc-table">
              <For each={items().codes}>
                {(c) => {
                  const expired = c.expiresAt !== null && Date.parse(c.expiresAt) <= items().now;
                  return (
                    <div class="gc-row">
                      <div>
                        <b class="gc-code">{c.code}</b>
                        <Show when={c.featured}>
                          {' '}
                          <span class="tag gacha">Gợi ý</span>
                        </Show>
                        <div class="muted small">
                          {c.createdBy ? `bởi ${c.createdBy} · ` : 'mặc định · '}
                          {fmt(c.createdAt)}
                        </div>
                      </div>
                      <div>
                        {rewardText(c.rewards)}
                        <div class="muted small">
                          Tổng{' '}
                          {[c.totalTickets ? `${c.totalTickets} vé` : '', c.totalCards ? `${c.totalCards} thẻ` : '']
                            .filter(Boolean)
                            .join(' + ')}
                        </div>
                      </div>
                      <div class="small">{c.expiresAt ? `Hạn ${fmt(c.expiresAt)}` : 'Không hạn'}</div>
                      <div class="small">
                        <b>{c.redemptionCount}</b> lượt nhập
                      </div>
                      <div>
                        {!c.isActive ? (
                          <span class="tag bad">Đã tắt</span>
                        ) : expired ? (
                          <span class="tag warn-tag">Hết hạn</span>
                        ) : (
                          <span class="tag ok">Đang bật</span>
                        )}
                      </div>
                      <div>
                        <Show
                          when={c.totalCards > 0 && !c.isActive}
                          fallback={
                            <button
                              class="btn ghost small"
                              data-toggle={c.id}
                              data-active={c.isActive ? 1 : 0}
                              disabled={toggling() === c.id}
                              onClick={() => void toggle(c)}
                            >
                              {c.isActive ? 'Tắt' : 'Bật'}
                            </button>
                          }
                        >
                          <span class="muted small" title="Giftcode chỉ tặng vé quay; code thẻ cũ không bật lại được">
                            Code thẻ cũ
                          </span>
                        </Show>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Match>
          <Match when={true}>
            <div class="state-msg">Chưa có giftcode.</div>
          </Match>
        </Switch>
      </div>
    </>
  );
}
