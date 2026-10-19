import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  FACTIONS,
  FACTION_LABELS,
  type CardDto,
  type Faction,
  type MarketListingDto,
  type MarketListingStatus,
} from '@tq/shared';
import { api, fetchAllCards, newKey, type ApiError } from '../api.ts';
import { gen, state } from '../state.ts';
import { levelTier, portraitUrl, initials } from '../art.ts';
import { Card } from '../components/Card.tsx';
import { openCardViewer } from '../viewer.tsx';
import { toast } from '../ui.ts';

/**
 * Chợ thẻ tướng (chủ dự án yêu cầu): người chơi đem thẻ của mình lên bán cho người khác.
 * - Mỗi tin = MỘT thẻ (tướng + cấp). Đơn vị tiền tệ là Vàng nhưng hiện bán giá 0 (hệ thống Vàng làm sau).
 * - Toàn bộ xác suất/giá/kiểm tra quyền sở hữu do server quyết định; client chỉ gọi API và hiển thị.
 * - Trang gồm 4 mục: Chợ (duyệt + mua), Đăng bán (chọn thẻ từ bộ sưu tập), Tin của tôi (huỷ tin), Lịch sử mua/bán.
 * - Mỗi tin nằm gọn trong một Ô NHỎ của lưới (avatar tướng + tên + cấp + giá); mọi thao tác ghi
 *   (mua / huỷ tin / đăng bán) đều mở MODAL xác nhận thay vì khối xác nhận nằm trong danh sách.
 */

/** Số tin mỗi trang khi duyệt chợ (khớp trần `pageSize` của schema server). */
const BROWSE_PAGE_SIZE = 60;
/** Số tin mỗi trang ở "Tin của tôi" / "Lịch sử". */
const MINE_PAGE_SIZE = 50;
const HISTORY_PAGE_SIZE = 20;
/** Số thẻ vẽ thêm mỗi lần bấm "Xem thêm" ở tab Đăng bán (bộ sưu tập có thể rất lớn). */
const RENDER_STEP = 600;

/** Bỏ dấu tiếng Việt để tìm không phân biệt dấu. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** "5 phút trước", "3 giờ trước", "2 ngày trước". */
function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 60 * 24) return `${Math.round(m / 60)} giờ trước`;
  return `${Math.round(m / 1440)} ngày trước`;
}

/** Giá bán hiển thị kèm đơn vị Vàng (hiện luôn 0). */
const priceText = (price: number) => `${price} Vàng`;

/** Tin này có phải của chính mình không (dựa vào id người chơi lấy từ `/api/me`). */
const isMine = (l: MarketListingDto) => l.sellerId === state.userId;

const STATUS_LABEL: Record<MarketListingStatus, string> = {
  active: 'Đang bán',
  sold: 'Đã bán',
  cancelled: 'Đã huỷ',
};

/** Trang Chợ thẻ tướng với 4 mục con (sub-tab). */
export function MarketPage(): JSX.Element {
  const [sub, setSub] = createSignal<'cho' | 'dang' | 'mine' | 'his'>('cho');
  return (
    <>
      <div class="sub-tabs lg" role="tablist">
        <button class="btn small" classList={{ on: sub() === 'cho' }} role="tab" onClick={() => setSub('cho')}>
          Chợ
        </button>
        <button class="btn small" classList={{ on: sub() === 'dang' }} role="tab" onClick={() => setSub('dang')}>
          Đăng bán
        </button>
        <button class="btn small" classList={{ on: sub() === 'mine' }} role="tab" onClick={() => setSub('mine')}>
          Tin của tôi
        </button>
        <button class="btn small" classList={{ on: sub() === 'his' }} role="tab" onClick={() => setSub('his')}>
          Lịch sử
        </button>
      </div>
      <Show when={sub() === 'cho'}>
        <BrowseTab />
      </Show>
      <Show when={sub() === 'dang'}>
        <SellTab />
      </Show>
      <Show when={sub() === 'mine'}>
        <MyListingsTab />
      </Show>
      <Show when={sub() === 'his'}>
        <HistoryTab />
      </Show>
    </>
  );
}

// ======================= Khối dùng chung =======================

/**
 * Avatar tròn của tướng (mục 6.1): chân dung thật, chữ viết tắt làm nền dự phòng khi thiếu ảnh.
 * Viền avatar tô theo bậc cấp của thẻ. Có `onClick` thì bấm vào mở popup chi tiết tướng.
 */
function GeneralArt(props: { generalId: string; level: number; big?: boolean; onClick?: () => void }): JSX.Element {
  const g = () => gen(props.generalId);
  return (
    <span
      class={`mkt-art ${props.big ? 'big' : ''} ${props.onClick ? 'view' : ''}`}
      style={{ '--tc': levelTier(props.level).css }}
      role={props.onClick ? 'button' : undefined}
      tabIndex={props.onClick ? 0 : undefined}
      title={props.onClick ? `Xem chi tiết ${g().name}` : undefined}
      onClick={(e) => {
        if (!props.onClick) return;
        e.stopPropagation();
        props.onClick();
      }}
      onKeyDown={(e) => {
        if (!props.onClick || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        props.onClick();
      }}
    >
      <span class="mkt-art-ini">{initials(g().name)}</span>
      <img
        src={portraitUrl(g().artKey)}
        alt=""
        loading="lazy"
        decoding="async"
        onError={(e) => (e.currentTarget.style.display = 'none')}
      />
    </span>
  );
}

/** Nút chuyển trang (chỉ hiện khi có nhiều hơn 1 trang). */
function Pager(props: { page: number; pageSize: number; total: number; onGo: (p: number) => void }): JSX.Element {
  const pages = () => Math.max(1, Math.ceil(props.total / props.pageSize));
  return (
    <Show when={pages() > 1}>
      <div class="mkt-pager">
        <button class="btn ghost small" disabled={props.page <= 1} onClick={() => props.onGo(props.page - 1)}>
          ← Trang trước
        </button>
        <span class="muted small">{`Trang ${props.page}/${pages()} · ${props.total} tin`}</span>
        <button class="btn ghost small" disabled={props.page >= pages()} onClick={() => props.onGo(props.page + 1)}>
          Trang sau →
        </button>
      </div>
    </Show>
  );
}

/**
 * Một tin đăng bán nằm gọn trong MỘT Ô NHỎ của lưới: avatar tướng, tên, phe · cấp, giá, người bán.
 * `children` là khe hành động của từng mục (nút Mua / Huỷ tin / nhãn trạng thái / vai giao dịch).
 */
function ListingCell(props: { listing: MarketListingDto; children?: JSX.Element }): JSX.Element {
  const l = () => props.listing;
  const g = () => gen(l().generalId);
  // Tin không giữ id thẻ thật (thẻ đang bị tiêu thụ); dựng CardDto tối thiểu để mở popup ngắm thẻ.
  const pseudoCard = (): CardDto => ({ id: 0, generalId: l().generalId, level: l().level, createdAt: l().createdAt });
  return (
    <div class="mkt-cell">
      <GeneralArt generalId={l().generalId} level={l().level} onClick={() => openCardViewer(g(), pseudoCard())} />
      <div class="mkt-cell-name" title={g().name}>
        {g().name}
      </div>
      <div class="mkt-cell-sub">
        <span class={`fac f-${g().faction}`}>{FACTION_LABELS[g().faction]}</span>
        <span class="dot">·</span>
        <span style={{ color: levelTier(l().level).css }}>{`Lv.${l().level}`}</span>
      </div>
      <div class="mkt-cell-price">{priceText(l().price)}</div>
      <div class="mkt-cell-seller" title={`Người bán: ${l().sellerName}`}>{`Người bán: ${l().sellerName}`}</div>
      <div class="mkt-cell-act">{props.children}</div>
    </div>
  );
}

/** Khung modal của Chợ: nền tối trung tính + làm mờ; bấm vùng nền hoặc Esc để đóng. */
function MarketModal(props: { onClose: () => void; children: JSX.Element }): JSX.Element {
  let overlay!: HTMLDivElement;
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  onMount(() => {
    document.addEventListener('keydown', onKey);
    overlay.focus();
  });
  onCleanup(() => document.removeEventListener('keydown', onKey));
  return (
    // Portal ra body để modal không bị ảnh hưởng bởi các khối dính/backdrop-filter của trang.
    <Portal>
      <div
        ref={overlay}
        class="mkt-modal"
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div class="mkt-modal-box">{props.children}</div>
      </div>
    </Portal>
  );
}

/**
 * Nội dung modal hành động dùng chung cho cả 3 thao tác (mua / huỷ tin / đăng bán):
 * avatar lớn + tên/cấp + dòng phụ + giá + ghi chú + hai nút (đóng / xác nhận).
 */
function ActionBox(props: {
  title: string;
  generalId: string;
  level: number;
  /** Dòng phụ dưới tên (VD "Thục · Người bán: tester"). */
  sub: string;
  /** Giá bán tính bằng Vàng (bỏ trống thì không hiện dòng giá). */
  price?: number;
  note: string;
  primary: string;
  /** Nút xác nhận dùng tông cảnh báo (huỷ tin) thay vì tông chính. */
  danger?: boolean;
  busy: boolean;
  onPrimary: () => void;
  onClose: () => void;
}): JSX.Element {
  return (
    <>
      <div class="mkt-modal-head">{props.title}</div>
      <div class="mkt-modal-body">
        <GeneralArt generalId={props.generalId} level={props.level} big />
        <div class="mkt-modal-info">
          <div class="mkt-modal-name">
            {gen(props.generalId).name}
            <span class="mkt-modal-lv" style={{ color: levelTier(props.level).css }}>{`Lv.${props.level}`}</span>
          </div>
          <div class="muted small">{props.sub}</div>
          <Show when={props.price !== undefined}>
            <div class="mkt-modal-price">{priceText(props.price!)}</div>
          </Show>
          <p class="mkt-modal-note muted small">{props.note}</p>
        </div>
      </div>
      <div class="mkt-modal-act">
        <button class="btn ghost" disabled={props.busy} onClick={() => props.onClose()}>
          Đóng
        </button>
        <button class={`btn ${props.danger ? 'danger' : 'primary'}`} disabled={props.busy} onClick={() => props.onPrimary()}>
          {props.primary}
        </button>
      </div>
    </>
  );
}

// ======================= Mục 1: Chợ (duyệt + mua) =======================

function BrowseTab(): JSX.Element {
  let alive = true;
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    alive = false;
    clearTimeout(searchTimer);
  });

  const [items, setItems] = createSignal<MarketListingDto[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Bộ lọc
  const [q, setQ] = createSignal('');
  const [faction, setFaction] = createSignal('');
  const [level, setLevel] = createSignal('');
  const [sort, setSort] = createSignal('newest');

  // Mua
  const [busyId, setBusyId] = createSignal(0);
  const [confirm, setConfirm] = createSignal<MarketListingDto | null>(null);
  let pending: { key: string; sig: string } | null = null;

  async function load(p = page()) {
    setError(null);
    try {
      const res = await api.market.listings({
        faction: faction() ? (faction() as Faction) : undefined,
        level: level() ? Number(level()) : undefined,
        q: q().trim() || undefined,
        sort: sort(),
        page: p,
        pageSize: BROWSE_PAGE_SIZE,
      });
      if (!alive) return;
      setItems(res.items);
      setTotal(res.total);
      setPage(res.page);
      setLoaded(true);
    } catch (e) {
      if (alive) setError((e as Error).message);
    }
  }
  void load();

  /** Đổi bộ lọc thì quay về trang 1 rồi tải lại. */
  function refilter() {
    setPage(1);
    void load(1);
  }

  async function buy(l: MarketListingDto) {
    if (busyId()) return;
    setBusyId(l.id);
    const sig = `buy:${l.id}`;
    // Giữ key khi lỗi mạng để bấm lại là retry an toàn (server không tạo thẻ 2 lần).
    if (!pending || pending.sig !== sig) pending = { key: newKey(), sig };
    try {
      const r = await api.market.buy(l.id, pending.key);
      pending = null;
      if (!alive) return;
      setConfirm(null);
      toast(`Đã mua ${gen(r.generalId).name} Lv.${r.level} với giá ${priceText(r.price)}.`);
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') pending = null;
      if (!alive) return;
      setConfirm(null);
      toast(err.message, 5000);
      // Tin vừa bị người khác mua/huỷ => tải lại danh sách cho khớp.
      if (err.code === 'LISTING_NOT_ACTIVE' || err.code === 'LISTING_GONE' || err.code === 'LISTING_NOT_FOUND') await load();
    } finally {
      if (alive) setBusyId(0);
    }
  }

  return (
    <section class="panel">
      <div class="coll-head">
        <div class="summary muted">
          <Show when={loaded()}>{`${total()} tin đang bán · giá ${priceText(0)}`}</Show>
        </div>
      </div>
      <div class="filters">
        <input
          type="search"
          placeholder="Tìm theo tên tướng…"
          aria-label="Tìm tướng"
          onInput={(e) => {
            setQ(e.currentTarget.value);
            clearTimeout(searchTimer);
            searchTimer = setTimeout(refilter, 300);
          }}
        />
        <select
          aria-label="Phe"
          onInput={(e) => {
            setFaction(e.currentTarget.value);
            refilter();
          }}
        >
          <option value="">Mọi phe</option>
          <For each={FACTIONS}>{(f) => <option value={f}>{FACTION_LABELS[f]}</option>}</For>
        </select>
        <select
          aria-label="Level"
          onInput={(e) => {
            setLevel(e.currentTarget.value);
            refilter();
          }}
        >
          <option value="">Mọi level</option>
          <For each={Array.from({ length: 10 }, (_, i) => i + 1)}>{(lv) => <option value={String(lv)}>Lv.{lv}</option>}</For>
        </select>
        <select
          aria-label="Sắp xếp"
          value={sort()}
          onInput={(e) => {
            setSort(e.currentTarget.value);
            refilter();
          }}
        >
          <option value="newest">Mới nhất</option>
          <option value="level_desc">Level cao nhất</option>
          <option value="level_asc">Level thấp nhất</option>
          <option value="name">Tên A→Z</option>
        </select>
        <button class="btn ghost small" onClick={() => void load()}>
          Làm mới
        </button>
      </div>
      <Switch>
        <Match when={error()}>{(err) => <div class="state-msg error">Không tải được chợ: {err()}</div>}</Match>
        <Match when={!loaded()}>
          <div class="state-msg">Đang tải chợ…</div>
        </Match>
        <Match when={items().length === 0}>
          <div class="state-msg">Chưa có tin đăng bán nào phù hợp.</div>
        </Match>
        <Match when={true}>
          <div class="mkt-grid">
            <For each={items()}>
              {(l) => (
                <ListingCell listing={l}>
                  <Show
                    when={!isMine(l)}
                    fallback={
                      <span class="tag" title="Không thể mua thẻ của chính mình">
                        Thẻ của bạn
                      </span>
                    }
                  >
                    <button class="btn primary small mkt-buy" disabled={!!busyId()} onClick={() => setConfirm(l)}>
                      {busyId() === l.id ? 'Đang mua…' : 'Mua'}
                    </button>
                  </Show>
                  <span class="mkt-cell-time muted small">{ago(l.createdAt)}</span>
                </ListingCell>
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <Pager page={page()} pageSize={BROWSE_PAGE_SIZE} total={total()} onGo={(p) => void load(p)} />

      <Show when={confirm()}>
        {(l) => (
          <MarketModal onClose={() => !busyId() && setConfirm(null)}>
            <ActionBox
              title="Xác nhận mua thẻ"
              generalId={l().generalId}
              level={l().level}
              sub={`${FACTION_LABELS[gen(l().generalId).faction]} · Người bán: ${l().sellerName}`}
              price={l().price}
              note="Thẻ sẽ chuyển ngay sang bộ sưu tập của bạn."
              primary={busyId() ? 'Đang mua…' : 'Xác nhận mua'}
              busy={!!busyId()}
              onPrimary={() => void buy(l())}
              onClose={() => setConfirm(null)}
            />
          </MarketModal>
        )}
      </Show>
    </section>
  );
}

// ======================= Mục 2: Đăng bán =======================

function SellTab(): JSX.Element {
  let alive = true;
  onCleanup(() => (alive = false));

  const [cards, setCards] = createSignal<CardDto[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [q, setQ] = createSignal('');
  const [faction, setFaction] = createSignal('');
  const [level, setLevel] = createSignal('');
  const [picked, setPicked] = createSignal<CardDto | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [limit, setLimit] = createSignal(RENDER_STEP);
  let pending: { key: string; sig: string } | null = null;

  const matchGeneral = (id: string) => {
    const g = gen(id);
    const fq = fold(q().trim());
    return (!faction() || g.faction === faction()) && (!fq || fold(g.name).includes(fq));
  };
  const filtered = createMemo(
    () => cards().filter((c) => matchGeneral(c.generalId) && (!level() || c.level === Number(level()))),
  );
  const shown = createMemo(() => filtered().slice(0, limit()));

  // Đổi bộ lọc thì quay về lượt xem đầu (bộ lọc mới thường ít thẻ hơn).
  createEffect(() => {
    filtered();
    setLimit(RENDER_STEP);
  });

  async function load() {
    try {
      const list = await fetchAllCards();
      if (!alive) return;
      setCards(list);
      setPicked((p) => (p && list.some((c) => c.id === p.id) ? p : null));
      setLoaded(true);
      setError(null);
    } catch (e) {
      if (alive) setError((e as Error).message);
    }
  }
  void load();

  async function sell() {
    const card = picked();
    if (!card || busy()) return;
    setBusy(true);
    const sig = `sell:${card.id}`;
    if (!pending || pending.sig !== sig) pending = { key: newKey(), sig };
    try {
      const r = await api.market.create(card.id, pending.key);
      pending = null;
      if (!alive) return;
      setPicked(null);
      toast(`Đã đăng bán ${gen(r.generalId).name} Lv.${r.level} với giá ${priceText(r.price)}.`);
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') pending = null;
      if (!alive) return;
      toast(err.message, 5000);
      if (err.code === 'CARD_NOT_FOUND' || err.code === 'CARD_CONSUMED') {
        setPicked(null);
        await load();
      }
    } finally {
      if (alive) setBusy(false);
    }
  }

  return (
    <section class="panel">
      <div class="coll-head">
        <div class="summary muted">
          <Show when={loaded()}>{`Bạn có ${cards().length} thẻ có thể đăng bán`}</Show>
        </div>
      </div>
      <div class="filters">
        <input
          type="search"
          placeholder="Tìm theo tên tướng…"
          aria-label="Tìm tướng"
          onInput={(e) => setQ(e.currentTarget.value)}
        />
        <select aria-label="Phe" onInput={(e) => setFaction(e.currentTarget.value)}>
          <option value="">Mọi phe</option>
          <For each={FACTIONS}>{(f) => <option value={f}>{FACTION_LABELS[f]}</option>}</For>
        </select>
        <select aria-label="Level" onInput={(e) => setLevel(e.currentTarget.value)}>
          <option value="">Mọi level</option>
          <For each={Array.from({ length: 10 }, (_, i) => i + 1)}>{(lv) => <option value={String(lv)}>Lv.{lv}</option>}</For>
        </select>
      </div>
      <div class="pick-grid">
        <Switch>
          <Match when={error()}>{(err) => <div class="state-msg error">Không tải được bộ sưu tập: {err()}</div>}</Match>
          <Match when={!loaded()}>
            <div class="state-msg">Đang tải bộ sưu tập…</div>
          </Match>
          <Match when={cards().length === 0}>
            <div class="state-msg">Bạn chưa có thẻ nào để đăng bán. Hãy quay thẻ ở tab Quay thẻ.</div>
          </Match>
          <Match when={filtered().length === 0}>
            <div class="state-msg">Không có thẻ phù hợp bộ lọc.</div>
          </Match>
          <Match when={true}>
            <div class="grid">
              <For each={shown()}>
                {(card) => (
                  <div class="grid-item">
                    <button
                      class={`pick ${picked()?.id === card.id ? 'on' : ''}`}
                      disabled={busy()}
                      aria-pressed={picked()?.id === card.id ? 'true' : 'false'}
                      onClick={() => setPicked((p) => (p?.id === card.id ? null : card))}
                    >
                      <Card general={gen(card.generalId)} level={card.level} extra="small" />
                    </button>
                  </div>
                )}
              </For>
            </div>
            <Show when={filtered().length > limit() || limit() > RENDER_STEP}>
              <div class="coll-more">
                <Show when={filtered().length > limit()}>
                  <button class="btn primary small" onClick={() => setLimit((n) => n + RENDER_STEP)}>
                    {`Xem thêm (đang hiện ${limit()}/${filtered().length} thẻ)`}
                  </button>
                </Show>
                <Show when={limit() > RENDER_STEP}>
                  <button class="btn ghost small" onClick={() => setLimit(RENDER_STEP)}>
                    Thu gọn
                  </button>
                </Show>
              </div>
            </Show>
          </Match>
        </Switch>
      </div>

      <Show when={picked()}>
        {(card) => (
          <MarketModal onClose={() => !busy() && setPicked(null)}>
            <ActionBox
              title="Đăng bán thẻ"
              generalId={card().generalId}
              level={card().level}
              sub={FACTION_LABELS[gen(card().generalId).faction]}
              price={0}
              note="Thẻ sẽ được chuyển lên chợ và tạm rời khỏi bộ sưu tập cho tới khi có người mua hoặc bạn huỷ tin."
              primary={busy() ? 'Đang đăng…' : 'Đăng bán'}
              busy={busy()}
              onPrimary={() => void sell()}
              onClose={() => setPicked(null)}
            />
          </MarketModal>
        )}
      </Show>
    </section>
  );
}

// ======================= Mục 3: Tin của tôi =======================

function MyListingsTab(): JSX.Element {
  let alive = true;
  onCleanup(() => (alive = false));

  const [items, setItems] = createSignal<MarketListingDto[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<'' | MarketListingStatus>('');
  const [busyId, setBusyId] = createSignal(0);
  const [confirm, setConfirm] = createSignal<MarketListingDto | null>(null);
  let pending: { key: string; sig: string } | null = null;

  async function load(p = page()) {
    setError(null);
    try {
      const res = await api.market.mine({ status: status() || undefined, page: p, pageSize: MINE_PAGE_SIZE });
      if (!alive) return;
      setItems(res.items);
      setTotal(res.total);
      setPage(res.page);
      setLoaded(true);
    } catch (e) {
      if (alive) setError((e as Error).message);
    }
  }
  void load();

  function refilter() {
    setPage(1);
    void load(1);
  }

  async function cancel(l: MarketListingDto) {
    if (busyId()) return;
    setBusyId(l.id);
    const sig = `cancel:${l.id}`;
    if (!pending || pending.sig !== sig) pending = { key: newKey(), sig };
    try {
      const r = await api.market.cancel(l.id, pending.key);
      pending = null;
      if (!alive) return;
      setConfirm(null);
      toast(`Đã huỷ tin và lấy lại ${gen(r.generalId).name} Lv.${r.level}.`);
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') pending = null;
      if (!alive) return;
      setConfirm(null);
      toast(err.message, 5000);
      if (err.code === 'LISTING_NOT_ACTIVE' || err.code === 'LISTING_GONE' || err.code === 'LISTING_NOT_FOUND') await load();
    } finally {
      if (alive) setBusyId(0);
    }
  }

  return (
    <section class="panel">
      <div class="coll-head">
        <div class="summary muted">
          <Show when={loaded()}>{`${total()} tin`}</Show>
        </div>
      </div>
      <div class="filters">
        <select
          aria-label="Trạng thái"
          value={status()}
          onInput={(e) => {
            setStatus(e.currentTarget.value as '' | MarketListingStatus);
            refilter();
          }}
        >
          <option value="">Mọi trạng thái</option>
          <option value="active">Đang bán</option>
          <option value="sold">Đã bán</option>
          <option value="cancelled">Đã huỷ</option>
        </select>
        <button class="btn ghost small" onClick={() => void load()}>
          Làm mới
        </button>
      </div>
      <Switch>
        <Match when={error()}>{(err) => <div class="state-msg error">Không tải được tin của bạn: {err()}</div>}</Match>
        <Match when={!loaded()}>
          <div class="state-msg">Đang tải…</div>
        </Match>
        <Match when={items().length === 0}>
          <div class="state-msg">Bạn chưa có tin đăng bán nào.</div>
        </Match>
        <Match when={true}>
          <div class="mkt-grid">
            <For each={items()}>
              {(l) => (
                <ListingCell listing={l}>
                  <span class={`tag ${l.status === 'active' ? 'warn-tag' : ''}`}>{STATUS_LABEL[l.status]}</span>
                  <Show when={l.status === 'active'}>
                    <button class="btn ghost small" disabled={!!busyId()} onClick={() => setConfirm(l)}>
                      {busyId() === l.id ? 'Đang huỷ…' : 'Huỷ tin'}
                    </button>
                  </Show>
                  <span class="mkt-cell-time muted small">{ago(l.createdAt)}</span>
                </ListingCell>
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <Pager page={page()} pageSize={MINE_PAGE_SIZE} total={total()} onGo={(p) => void load(p)} />

      <Show when={confirm()}>
        {(l) => (
          <MarketModal onClose={() => !busyId() && setConfirm(null)}>
            <ActionBox
              title="Xác nhận huỷ tin"
              generalId={l().generalId}
              level={l().level}
              sub={`${FACTION_LABELS[gen(l().generalId).faction]} · ${STATUS_LABEL[l().status]}`}
              price={l().price}
              note="Thẻ sẽ được trả lại bộ sưu tập của bạn ngay."
              primary={busyId() ? 'Đang huỷ…' : 'Xác nhận huỷ tin'}
              danger
              busy={!!busyId()}
              onPrimary={() => void cancel(l())}
              onClose={() => setConfirm(null)}
            />
          </MarketModal>
        )}
      </Show>
    </section>
  );
}

// ======================= Mục 4: Lịch sử mua/bán =======================

function HistoryTab(): JSX.Element {
  let alive = true;
  onCleanup(() => (alive = false));

  const [items, setItems] = createSignal<MarketListingDto[]>([]);
  const [total, setTotal] = createSignal(0);
  const [page, setPage] = createSignal(1);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function load(p = page()) {
    setError(null);
    try {
      const res = await api.market.history({ page: p, pageSize: HISTORY_PAGE_SIZE });
      if (!alive) return;
      setItems(res.items);
      setTotal(res.total);
      setPage(res.page);
      setLoaded(true);
    } catch (e) {
      if (alive) setError((e as Error).message);
    }
  }
  void load();

  /** Vai của mình trong một giao dịch đã bán xong. */
  const roleOf = (l: MarketListingDto) => (l.sellerId === state.userId ? 'Bán' : 'Mua');
  /** Tên đối tác (người mua nếu mình bán, người bán nếu mình mua). */
  const partnerOf = (l: MarketListingDto) => (l.sellerId === state.userId ? l.buyerName : l.sellerName) ?? '—';

  return (
    <section class="panel">
      <div class="coll-head">
        <div class="summary muted">
          <Show when={loaded()}>{`${total()} giao dịch`}</Show>
        </div>
      </div>
      <Switch>
        <Match when={error()}>{(err) => <div class="state-msg error">Không tải được lịch sử: {err()}</div>}</Match>
        <Match when={!loaded()}>
          <div class="state-msg">Đang tải…</div>
        </Match>
        <Match when={items().length === 0}>
          <div class="state-msg">Chưa có giao dịch mua/bán nào.</div>
        </Match>
        <Match when={true}>
          <div class="mkt-grid">
            <For each={items()}>
              {(l) => (
                <ListingCell listing={l}>
                  <span class={`tag ${roleOf(l) === 'Mua' ? 'warn-tag' : ''}`}>{roleOf(l)}</span>
                  <span class="mkt-cell-time muted small">
                    {`${roleOf(l) === 'Mua' ? 'Từ' : 'Cho'} ${partnerOf(l)}`}
                  </span>
                  <span class="mkt-cell-time muted small">{l.soldAt ? new Date(l.soldAt).toLocaleString('vi-VN') : ''}</span>
                </ListingCell>
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <Pager page={page()} pageSize={HISTORY_PAGE_SIZE} total={total()} onGo={(p) => void load(p)} />
    </section>
  );
}
