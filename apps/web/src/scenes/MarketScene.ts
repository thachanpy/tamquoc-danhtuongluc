import {
  FACTIONS,
  FACTION_LABELS,
  type CardDto,
  type Faction,
  type MarketListingDto,
  type MarketListingStatus,
} from '@tq/shared';
import { FRAME_LAYOUT, frameUrl, initials, levelTier, portraitUrl } from '../assets/art.ts';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api, fetchAllCards } from '../services/api.ts';
import { newKey, type ApiError } from '../services/http.ts';
import { gen, state } from '../state/store.ts';
import { cardEl } from '../ui/Card.ts';
import { h, render } from '../ui/dom.ts';
import { openOverlay } from '../ui/modal.ts';
import { PageScene } from '../ui/PageScene.ts';
import { toast } from '../ui/toast.ts';
import { openCardViewer } from '../ui/viewer.ts';

/**
 * Chợ thẻ tướng: người chơi đem thẻ của mình lên bán cho người khác.
 * - Mỗi tin = MỘT thẻ (tướng + cấp). Đơn vị tiền tệ là Vàng nhưng hiện bán giá 0 (hệ thống Vàng làm sau).
 * - Trang gồm 4 mục: Chợ (duyệt + mua), Đăng bán (chọn thẻ từ bộ sưu tập), Tin của tôi (huỷ tin),
 *   Lịch sử mua/bán. Mọi thao tác GHI (mua / huỷ tin / đăng bán) đều mở MODAL xác nhận.
 * Port từ `legacy/src/pages/Market.tsx` — giữ nguyên class CSS, cấu trúc DOM và chuỗi tiếng Việt.
 */

/** Số tin mỗi trang khi duyệt chợ (khớp trần `pageSize` của schema server). */
const BROWSE_PAGE_SIZE = 60;
/** Số tin mỗi trang ở "Tin của tôi" / "Lịch sử". */
const MINE_PAGE_SIZE = 50;
const HISTORY_PAGE_SIZE = 20;
/** Số thẻ vẽ thêm mỗi lần bấm "Xem thêm" ở tab Đăng bán (bộ sưu tập có thể rất lớn). */
const RENDER_STEP = 600;

/** Bỏ dấu tiếng Việt để tìm không phân biệt dấu. */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

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

/**
 * Avatar tướng ở Chợ: HÌNH VUÔNG (bo 8px, khác thẻ dọc ở trang khác), phủ khung cấp bậc lên trên.
 * Khung Lv.6+ tràn ra ngoài nên avatar được bọc trong một span bao (không có class CSS) để khung
 * không bị `.mkt-art { overflow: hidden }` cắt mất phần trang trí.
 */
function generalArt(opts: { generalId: string; level: number; big?: boolean; onClick?: () => void }): HTMLElement {
  const g = gen(opts.generalId);
  const cls = ['mkt-art'];
  if (opts.big) cls.push('big');
  if (opts.onClick) cls.push('view');

  const art = h('span', {
    class: cls.join(' '),
    // Avatar Chợ là hình vuông bo 8px (mặc định CSS là hình tròn).
    style: { borderRadius: '8px' },
    attrs: {
      role: opts.onClick ? 'button' : undefined,
      tabindex: opts.onClick ? 0 : undefined,
      title: opts.onClick ? `Xem chi tiết ${g.name}` : undefined,
    },
  });
  art.style.setProperty('--tc', levelTier(opts.level).css);

  const img = h('img', { attrs: { src: portraitUrl(g.artKey), alt: '', loading: 'lazy', decoding: 'async' } });
  img.addEventListener('error', () => img.remove());

  art.append(h('span', { class: 'mkt-art-ini', text: initials(g.name) }), img);

  if (opts.onClick) {
    const go = opts.onClick;
    art.addEventListener('click', (e) => {
      e.stopPropagation();
      go();
    });
    art.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== 'Enter' && k !== ' ') return;
      e.preventDefault();
      go();
    });
  }

  const wrap = h('span', { style: { position: 'relative', display: 'block' } });
  wrap.appendChild(art);

  // Khung cấp bậc phủ lên avatar (giống thẻ ở Bộ sưu tập). Khung vốn vẽ cho thẻ dọc nên kéo rộng
  // ngang ~1.3x để bao trọn ô vuông.
  const fl = FRAME_LAYOUT[Math.min(Math.max(opts.level, 1), 10)];
  if (fl) {
    const frame = h('span', { class: 'tq-frame', attrs: { 'aria-hidden': 'true' } });
    frame.style.backgroundImage = `url(${frameUrl(opts.level)})`;
    frame.style.left = `${fl.left}%`;
    frame.style.top = `${fl.top}%`;
    frame.style.width = `${fl.width}%`;
    frame.style.height = `${fl.height}%`;
    frame.style.transform = 'scaleX(1.3)';
    wrap.appendChild(frame);
  }
  return wrap;
}

/** Trang Chợ thẻ tướng với 4 mục con (sub-tab). */
export class MarketScene extends PageScene {
  private alive = true;
  private sub: 'cho' | 'dang' | 'mine' | 'his' = 'cho';
  /** Tăng mỗi lần đổi tab để bỏ qua kết quả của lượt tải cũ (tránh vẽ vào tab đã gỡ). */
  private viewToken = 0;
  private searchTimer?: ReturnType<typeof setTimeout>;

  // --- DOM dùng chung
  private subTabsEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  // --- modal hành động (mua / đăng bán / huỷ tin)
  private modalClose: (() => void) | null = null;
  private modalPrimary: HTMLButtonElement | null = null;
  private modalCloseBtn: HTMLButtonElement | null = null;
  private modalPrimaryIdle = '';
  private modalPrimaryBusy = '';

  // --- Mục 1: Chợ
  private bItems: MarketListingDto[] = [];
  private bTotal = 0;
  private bPage = 1;
  private bLoaded = false;
  private bError: string | null = null;
  private bQ = '';
  private bFaction = '';
  private bLevel = '';
  private bSort = 'newest';
  private bBusyId = 0;
  private bPending: { key: string; sig: string } | null = null;
  private bSummaryEl?: HTMLElement;
  private bListEl?: HTMLElement;
  private bPagerEl?: HTMLElement;

  // --- Mục 2: Đăng bán
  private sCards: CardDto[] = [];
  private sLoaded = false;
  private sError: string | null = null;
  private sQ = '';
  private sFaction = '';
  private sLevel = '';
  private sPicked: CardDto | null = null;
  private sBusy = false;
  private sLimit = RENDER_STEP;
  private sPending: { key: string; sig: string } | null = null;
  private sSummaryEl?: HTMLElement;
  private sGridEl?: HTMLElement;

  // --- Mục 3: Tin của tôi
  private mItems: MarketListingDto[] = [];
  private mTotal = 0;
  private mPage = 1;
  private mLoaded = false;
  private mError: string | null = null;
  private mStatus: '' | MarketListingStatus = '';
  private mBusyId = 0;
  private mPending: { key: string; sig: string } | null = null;
  private mSummaryEl?: HTMLElement;
  private mListEl?: HTMLElement;
  private mPagerEl?: HTMLElement;

  // --- Mục 4: Lịch sử
  private hItems: MarketListingDto[] = [];
  private hTotal = 0;
  private hPage = 1;
  private hLoaded = false;
  private hError: string | null = null;
  private hSummaryEl?: HTMLElement;
  private hListEl?: HTMLElement;
  private hPagerEl?: HTMLElement;

  constructor() {
    super(SceneKeys.Market);
  }

  protected build(): HTMLElement {
    const root = h('div');
    const tabs = h('div', { class: 'sub-tabs lg', attrs: { role: 'tablist' } });
    const mkTab = (id: 'cho' | 'dang' | 'mine' | 'his', label: string): HTMLButtonElement => {
      const b = h('button', { class: 'btn small', attrs: { role: 'tab' }, text: label });
      b.addEventListener('click', () => {
        if (this.sub === id) return;
        this.sub = id;
        this.drawSubTabs();
        this.renderSub();
      });
      return b;
    };
    tabs.append(mkTab('cho', 'Chợ'), mkTab('dang', 'Đăng bán'), mkTab('mine', 'Tin của tôi'), mkTab('his', 'Lịch sử'));
    this.subTabsEl = tabs;

    this.bodyEl = h('div');
    root.append(tabs, this.bodyEl);

    this.track(() => {
      this.alive = false;
      clearTimeout(this.searchTimer);
      this.closeModal();
    });

    return root;
  }

  private drawSubTabs(): void {
    const order: ('cho' | 'dang' | 'mine' | 'his')[] = ['cho', 'dang', 'mine', 'his'];
    const btns = this.subTabsEl.querySelectorAll('button');
    order.forEach((id, i) => btns[i]?.classList.toggle('on', this.sub === id));
  }

  protected loadData(): void {
    this.drawSubTabs();
    this.renderSub();
  }

  /** Vẽ lại thân trang theo sub-tab đang chọn (mỗi lần đổi tab tải lại như bản cũ). */
  private renderSub(): void {
    this.closeModal();
    this.viewToken++;
    if (this.sub === 'cho') this.buildBrowse();
    else if (this.sub === 'dang') this.buildSell();
    else if (this.sub === 'mine') this.buildMine();
    else this.buildHistory();
  }

  // ================= Khối dùng chung =================

  /** Tạo `select` với các option; `defLabel` (nếu có) là option rỗng "mọi …" đứng đầu. */
  private mkSelect(
    label: string,
    defLabel: string | undefined,
    entries: [string, string][],
    value: string,
    onChange: (v: string) => void,
  ): HTMLSelectElement {
    const sel = h('select', { attrs: { 'aria-label': label } });
    if (defLabel !== undefined) sel.appendChild(h('option', { attrs: { value: '' }, text: defLabel }));
    for (const [v, l] of entries) sel.appendChild(h('option', { attrs: { value: v }, text: l }));
    sel.value = value;
    sel.addEventListener('input', () => onChange(sel.value));
    return sel;
  }

  /** Một tin đăng nằm gọn trong MỘT Ô NHỎ: avatar, tên, phe · cấp, giá, người bán + khe hành động. */
  private listingCell(l: MarketListingDto, act: HTMLElement): HTMLElement {
    const g = gen(l.generalId);
    const pseudoCard: CardDto = { id: 0, generalId: l.generalId, level: l.level, createdAt: l.createdAt };
    return h(
      'div',
      { class: 'mkt-cell' },
      generalArt({ generalId: l.generalId, level: l.level, onClick: () => openCardViewer(g, pseudoCard) }),
      h('div', { class: 'mkt-cell-name', attrs: { title: g.name }, text: g.name }),
      h(
        'div',
        { class: 'mkt-cell-sub' },
        h('span', { class: `fac f-${g.faction}`, text: FACTION_LABELS[g.faction] }),
        h('span', { class: 'dot', text: '·' }),
        h('span', { style: { color: levelTier(l.level).css }, text: `Lv.${l.level}` }),
      ),
      h('div', { class: 'mkt-cell-price', text: priceText(l.price) }),
      h('div', { class: 'mkt-cell-seller', attrs: { title: `Người bán: ${l.sellerName}` }, text: `Người bán: ${l.sellerName}` }),
      act,
    );
  }

  /** Nút chuyển trang (chỉ hiện khi có nhiều hơn 1 trang). */
  private drawPager(host: HTMLElement | undefined, page: number, pageSize: number, total: number, onGo: (p: number) => void): void {
    if (!host) return;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (pages <= 1) {
      render(host);
      return;
    }
    const prev = h('button', { class: 'btn ghost small', text: '← Trang trước' });
    prev.disabled = page <= 1;
    prev.addEventListener('click', () => onGo(page - 1));
    const next = h('button', { class: 'btn ghost small', text: 'Trang sau →' });
    next.disabled = page >= pages;
    next.addEventListener('click', () => onGo(page + 1));
    render(host, h('div', { class: 'mkt-pager' }, prev, h('span', { class: 'muted small', text: `Trang ${page}/${pages} · ${total} tin` }), next));
  }

  /**
   * Mở modal hành động dùng chung (mua / huỷ tin / đăng bán): avatar lớn + tên/cấp + dòng phụ + giá
   * + ghi chú + hai nút (đóng / xác nhận). Nền mờ, bấm vùng nền hoặc Esc để đóng.
   */
  private openAction(opts: {
    title: string;
    generalId: string;
    level: number;
    sub: string;
    price?: number;
    note: string;
    primary: string;
    primaryBusy: string;
    danger?: boolean;
    onPrimary: () => void;
    onClose: () => void;
  }): void {
    this.closeModal();

    const closeBtn = h('button', { class: 'btn ghost', text: 'Đóng' });
    const primaryBtn = h('button', { class: opts.danger ? 'btn danger' : 'btn primary', text: opts.primary });

    const info = h(
      'div',
      { class: 'mkt-modal-info' },
      h(
        'div',
        { class: 'mkt-modal-name' },
        gen(opts.generalId).name,
        h('span', { class: 'mkt-modal-lv', style: { color: levelTier(opts.level).css }, text: `Lv.${opts.level}` }),
      ),
      h('div', { class: 'muted small', text: opts.sub }),
    );
    if (opts.price !== undefined) info.appendChild(h('div', { class: 'mkt-modal-price', text: priceText(opts.price) }));
    info.appendChild(h('p', { class: 'mkt-modal-note muted small', text: opts.note }));

    const close = openOverlay({
      className: 'mkt-modal',
      boxClass: 'mkt-modal-box',
      content: [
        h('div', { class: 'mkt-modal-head', text: opts.title }),
        h('div', { class: 'mkt-modal-body' }, generalArt({ generalId: opts.generalId, level: opts.level, big: true }), info),
        h('div', { class: 'mkt-modal-act' }, closeBtn, primaryBtn),
      ],
      onClose: () => {
        this.modalClose = null;
        this.modalPrimary = null;
        this.modalCloseBtn = null;
        opts.onClose();
      },
    });

    this.modalClose = close;
    this.modalPrimary = primaryBtn;
    this.modalCloseBtn = closeBtn;
    this.modalPrimaryIdle = opts.primary;
    this.modalPrimaryBusy = opts.primaryBusy;
    closeBtn.addEventListener('click', () => close());
    primaryBtn.addEventListener('click', () => opts.onPrimary());
  }

  private closeModal(): void {
    this.modalClose?.();
  }

  /** Bật/tắt trạng thái "đang xử lý" trên hai nút của modal đang mở. */
  private setModalBusy(busy: boolean): void {
    if (this.modalPrimary) {
      this.modalPrimary.disabled = busy;
      this.modalPrimary.textContent = busy ? this.modalPrimaryBusy : this.modalPrimaryIdle;
    }
    if (this.modalCloseBtn) this.modalCloseBtn.disabled = busy;
  }

  // ================= Mục 1: Chợ (duyệt + mua) =================

  private buildBrowse(): void {
    this.bSummaryEl = h('div', { class: 'summary muted' });

    const search = h('input', { attrs: { type: 'search', placeholder: 'Tìm theo tên tướng…', 'aria-label': 'Tìm tướng' } });
    search.value = this.bQ;
    search.addEventListener('input', () => {
      this.bQ = search.value;
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => this.bRefilter(), 300);
    });

    const factionSel = this.mkSelect('Phe', 'Mọi phe', FACTIONS.map((f) => [f, FACTION_LABELS[f]] as [string, string]), this.bFaction, (v) => {
      this.bFaction = v;
      this.bRefilter();
    });
    const levelSel = this.mkSelect(
      'Level',
      'Mọi level',
      Array.from({ length: 10 }, (_, i) => [String(i + 1), `Lv.${i + 1}`] as [string, string]),
      this.bLevel,
      (v) => {
        this.bLevel = v;
        this.bRefilter();
      },
    );
    const sortSel = this.mkSelect(
      'Sắp xếp',
      undefined,
      [
        ['newest', 'Mới nhất'],
        ['level_desc', 'Level cao nhất'],
        ['level_asc', 'Level thấp nhất'],
        ['name', 'Tên A→Z'],
      ],
      this.bSort,
      (v) => {
        this.bSort = v;
        this.bRefilter();
      },
    );
    const refresh = h('button', { class: 'btn ghost small', text: 'Làm mới' });
    refresh.addEventListener('click', () => void this.bLoad());

    const filters = h('div', { class: 'filters' }, search, factionSel, levelSel, sortSel, refresh);
    this.bListEl = h('div');
    this.bPagerEl = h('div');

    const panel = h('section', { class: 'panel' }, h('div', { class: 'coll-head' }, this.bSummaryEl), filters, this.bListEl, this.bPagerEl);
    render(this.bodyEl, panel);

    this.drawBrowse();
    void this.bLoad();
  }

  /** Đổi bộ lọc thì quay về trang 1 rồi tải lại. */
  private bRefilter(): void {
    this.bPage = 1;
    void this.bLoad(1);
  }

  private drawBrowse(): void {
    if (this.bSummaryEl) this.bSummaryEl.textContent = this.bLoaded ? `${this.bTotal} tin đang bán · giá ${priceText(0)}` : '';
    const host = this.bListEl;
    if (host) {
      if (this.bError) render(host, h('div', { class: 'state-msg error', text: `Không tải được chợ: ${this.bError}` }));
      else if (!this.bLoaded) render(host, h('div', { class: 'state-msg', text: 'Đang tải chợ…' }));
      else if (this.bItems.length === 0) render(host, h('div', { class: 'state-msg', text: 'Chưa có tin đăng bán nào phù hợp.' }));
      else {
        const grid = h('div', { class: 'mkt-grid' });
        for (const l of this.bItems) grid.appendChild(this.browseCell(l));
        render(host, grid);
      }
    }
    this.drawPager(this.bPagerEl, this.bPage, BROWSE_PAGE_SIZE, this.bTotal, (p) => void this.bLoad(p));
  }

  private browseCell(l: MarketListingDto): HTMLElement {
    const act = h('div', { class: 'mkt-cell-act' });
    if (!isMine(l)) {
      const b = h('button', { class: 'btn primary small mkt-buy', text: this.bBusyId === l.id ? 'Đang mua…' : 'Mua' });
      b.disabled = this.bBusyId !== 0;
      b.addEventListener('click', () => this.openBuyModal(l));
      act.appendChild(b);
    } else {
      act.appendChild(h('span', { class: 'tag', attrs: { title: 'Không thể mua thẻ của chính mình' }, text: 'Thẻ của bạn' }));
    }
    act.appendChild(h('span', { class: 'mkt-cell-time muted small', text: ago(l.createdAt) }));
    return this.listingCell(l, act);
  }

  private async bLoad(p = this.bPage): Promise<void> {
    this.bError = null;
    const token = this.viewToken;
    try {
      const res = await api.market.listings({
        faction: this.bFaction ? (this.bFaction as Faction) : undefined,
        level: this.bLevel ? Number(this.bLevel) : undefined,
        q: this.bQ.trim() || undefined,
        sort: this.bSort,
        page: p,
        pageSize: BROWSE_PAGE_SIZE,
      });
      if (!this.alive || token !== this.viewToken) return;
      this.bItems = res.items;
      this.bTotal = res.total;
      this.bPage = res.page;
      this.bLoaded = true;
      this.drawBrowse();
    } catch (e) {
      if (this.alive && token === this.viewToken) {
        this.bError = (e as Error).message;
        this.drawBrowse();
      }
    }
  }

  private openBuyModal(l: MarketListingDto): void {
    if (this.bBusyId) return;
    const g = gen(l.generalId);
    this.openAction({
      title: 'Xác nhận mua thẻ',
      generalId: l.generalId,
      level: l.level,
      sub: `${FACTION_LABELS[g.faction]} · Người bán: ${l.sellerName}`,
      price: l.price,
      note: 'Thẻ sẽ chuyển ngay sang bộ sưu tập của bạn.',
      primary: 'Xác nhận mua',
      primaryBusy: 'Đang mua…',
      onPrimary: () => void this.buy(l),
      onClose: () => {
        /* không cần dọn state riêng */
      },
    });
  }

  private async buy(l: MarketListingDto): Promise<void> {
    if (this.bBusyId) return;
    this.bBusyId = l.id;
    this.setModalBusy(true);
    const token = this.viewToken;
    const sig = `buy:${l.id}`;
    // Giữ key khi lỗi mạng để bấm lại là retry an toàn (server không tạo thẻ 2 lần).
    if (!this.bPending || this.bPending.sig !== sig) this.bPending = { key: newKey(), sig };
    try {
      const r = await api.market.buy(l.id, this.bPending.key);
      this.bPending = null;
      if (!this.alive) return;
      this.closeModal();
      toast(`Đã mua ${gen(r.generalId).name} Lv.${r.level} với giá ${priceText(r.price)}.`);
      await this.bLoad();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') this.bPending = null;
      if (!this.alive) return;
      this.closeModal();
      toast(err.message, 5000);
      // Tin vừa bị người khác mua/huỷ => tải lại danh sách cho khớp.
      if (err.code === 'LISTING_NOT_ACTIVE' || err.code === 'LISTING_GONE' || err.code === 'LISTING_NOT_FOUND') await this.bLoad();
    } finally {
      this.bBusyId = 0;
      if (this.alive && token === this.viewToken) {
        this.setModalBusy(false);
        this.drawBrowse();
      }
    }
  }

  // ================= Mục 2: Đăng bán =================

  private buildSell(): void {
    this.sSummaryEl = h('div', { class: 'summary muted' });

    const search = h('input', { attrs: { type: 'search', placeholder: 'Tìm theo tên tướng…', 'aria-label': 'Tìm tướng' } });
    search.value = this.sQ;
    search.addEventListener('input', () => {
      this.sQ = search.value;
      this.sLimit = RENDER_STEP;
      this.drawSell();
    });

    const factionSel = this.mkSelect('Phe', 'Mọi phe', FACTIONS.map((f) => [f, FACTION_LABELS[f]] as [string, string]), this.sFaction, (v) => {
      this.sFaction = v;
      this.sLimit = RENDER_STEP;
      this.drawSell();
    });
    const levelSel = this.mkSelect(
      'Level',
      'Mọi level',
      Array.from({ length: 10 }, (_, i) => [String(i + 1), `Lv.${i + 1}`] as [string, string]),
      this.sLevel,
      (v) => {
        this.sLevel = v;
        this.sLimit = RENDER_STEP;
        this.drawSell();
      },
    );

    const filters = h('div', { class: 'filters' }, search, factionSel, levelSel);
    this.sGridEl = h('div', { class: 'pick-grid' });

    const panel = h('section', { class: 'panel' }, h('div', { class: 'coll-head' }, this.sSummaryEl), filters, this.sGridEl);
    render(this.bodyEl, panel);

    this.drawSell();
    void this.sLoad();
  }

  private sFiltered(): CardDto[] {
    const fq = fold(this.sQ.trim());
    return this.sCards.filter((c) => {
      const g = gen(c.generalId);
      return (!this.sFaction || g.faction === this.sFaction) && (!fq || fold(g.name).includes(fq)) && (!this.sLevel || c.level === Number(this.sLevel));
    });
  }

  private drawSell(): void {
    if (this.sSummaryEl) this.sSummaryEl.textContent = this.sLoaded ? `Bạn có ${this.sCards.length} thẻ có thể đăng bán` : '';
    const host = this.sGridEl;
    if (!host) return;

    if (this.sError) {
      render(host, h('div', { class: 'state-msg error', text: `Không tải được bộ sưu tập: ${this.sError}` }));
      return;
    }
    if (!this.sLoaded) {
      render(host, h('div', { class: 'state-msg', text: 'Đang tải bộ sưu tập…' }));
      return;
    }
    if (this.sCards.length === 0) {
      render(host, h('div', { class: 'state-msg', text: 'Bạn chưa có thẻ nào để đăng bán. Hãy quay thẻ ở tab Quay thẻ.' }));
      return;
    }
    const filtered = this.sFiltered();
    if (filtered.length === 0) {
      render(host, h('div', { class: 'state-msg', text: 'Không có thẻ phù hợp bộ lọc.' }));
      return;
    }

    const grid = h('div', { class: 'grid' });
    for (const card of filtered.slice(0, this.sLimit)) {
      const on = this.sPicked?.id === card.id;
      const b = h(
        'button',
        { class: on ? 'pick on' : 'pick', attrs: { 'aria-pressed': on ? 'true' : 'false' } },
        cardEl({ general: gen(card.generalId), level: card.level, extra: 'small' }),
      );
      b.disabled = this.sBusy;
      b.addEventListener('click', () => {
        if (this.sPicked?.id === card.id) {
          this.sPicked = null;
          this.closeModal();
          this.drawSell();
        } else {
          this.sPicked = card;
          this.drawSell();
          this.openSellModal(card);
        }
      });
      grid.appendChild(h('div', { class: 'grid-item' }, b));
    }
    render(host, grid);

    // Chỉ vẽ thêm nút "Xem thêm"/"Thu gọn" khi cần (bộ sưu tập có thể rất lớn).
    if (filtered.length > this.sLimit || this.sLimit > RENDER_STEP) {
      const more = h('div', { class: 'coll-more' });
      if (filtered.length > this.sLimit) {
        const b = h('button', { class: 'btn primary small', text: `Xem thêm (đang hiện ${this.sLimit}/${filtered.length} thẻ)` });
        b.addEventListener('click', () => {
          this.sLimit += RENDER_STEP;
          this.drawSell();
        });
        more.appendChild(b);
      }
      if (this.sLimit > RENDER_STEP) {
        const b = h('button', { class: 'btn ghost small', text: 'Thu gọn' });
        b.addEventListener('click', () => {
          this.sLimit = RENDER_STEP;
          this.drawSell();
        });
        more.appendChild(b);
      }
      host.appendChild(more);
    }
  }

  private async sLoad(): Promise<void> {
    const token = this.viewToken;
    try {
      const list = await fetchAllCards();
      if (!this.alive || token !== this.viewToken) return;
      this.sCards = list;
      this.sPicked = this.sPicked && list.some((c) => c.id === this.sPicked?.id) ? this.sPicked : null;
      this.sLoaded = true;
      this.sError = null;
      this.drawSell();
    } catch (e) {
      if (this.alive && token === this.viewToken) {
        this.sError = (e as Error).message;
        this.drawSell();
      }
    }
  }

  private openSellModal(card: CardDto): void {
    this.openAction({
      title: 'Đăng bán thẻ',
      generalId: card.generalId,
      level: card.level,
      sub: FACTION_LABELS[gen(card.generalId).faction],
      price: 0,
      note: 'Thẻ sẽ được chuyển lên chợ và tạm rời khỏi bộ sưu tập cho tới khi có người mua hoặc bạn huỷ tin.',
      primary: 'Đăng bán',
      primaryBusy: 'Đang đăng…',
      onPrimary: () => void this.sell(),
      onClose: () => {
        this.sPicked = null;
        this.drawSell();
      },
    });
  }

  private async sell(): Promise<void> {
    const card = this.sPicked;
    if (!card || this.sBusy) return;
    this.sBusy = true;
    this.setModalBusy(true);
    const token = this.viewToken;
    const sig = `sell:${card.id}`;
    if (!this.sPending || this.sPending.sig !== sig) this.sPending = { key: newKey(), sig };
    try {
      const r = await api.market.create(card.id, this.sPending.key);
      this.sPending = null;
      if (!this.alive) return;
      this.sPicked = null;
      this.closeModal();
      toast(`Đã đăng bán ${gen(r.generalId).name} Lv.${r.level} với giá ${priceText(r.price)}.`);
      await this.sLoad();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') this.sPending = null;
      if (!this.alive) return;
      toast(err.message, 5000);
      if (err.code === 'CARD_NOT_FOUND' || err.code === 'CARD_CONSUMED') {
        this.sPicked = null;
        this.closeModal();
        await this.sLoad();
      }
    } finally {
      this.sBusy = false;
      if (this.alive && token === this.viewToken) {
        this.setModalBusy(false);
        this.drawSell();
      }
    }
  }

  // ================= Mục 3: Tin của tôi =================

  private buildMine(): void {
    this.mSummaryEl = h('div', { class: 'summary muted' });

    const statusSel = this.mkSelect(
      'Trạng thái',
      'Mọi trạng thái',
      [
        ['active', 'Đang bán'],
        ['sold', 'Đã bán'],
        ['cancelled', 'Đã huỷ'],
      ],
      this.mStatus,
      (v) => {
        this.mStatus = v as '' | MarketListingStatus;
        this.mRefilter();
      },
    );
    const refresh = h('button', { class: 'btn ghost small', text: 'Làm mới' });
    refresh.addEventListener('click', () => void this.mLoad());

    const filters = h('div', { class: 'filters' }, statusSel, refresh);
    this.mListEl = h('div');
    this.mPagerEl = h('div');

    const panel = h('section', { class: 'panel' }, h('div', { class: 'coll-head' }, this.mSummaryEl), filters, this.mListEl, this.mPagerEl);
    render(this.bodyEl, panel);

    this.drawMine();
    void this.mLoad();
  }

  private mRefilter(): void {
    this.mPage = 1;
    void this.mLoad(1);
  }

  private drawMine(): void {
    if (this.mSummaryEl) this.mSummaryEl.textContent = this.mLoaded ? `${this.mTotal} tin` : '';
    const host = this.mListEl;
    if (host) {
      if (this.mError) render(host, h('div', { class: 'state-msg error', text: `Không tải được tin của bạn: ${this.mError}` }));
      else if (!this.mLoaded) render(host, h('div', { class: 'state-msg', text: 'Đang tải…' }));
      else if (this.mItems.length === 0) render(host, h('div', { class: 'state-msg', text: 'Bạn chưa có tin đăng bán nào.' }));
      else {
        const grid = h('div', { class: 'mkt-grid' });
        for (const l of this.mItems) grid.appendChild(this.mineCell(l));
        render(host, grid);
      }
    }
    this.drawPager(this.mPagerEl, this.mPage, MINE_PAGE_SIZE, this.mTotal, (p) => void this.mLoad(p));
  }

  private mineCell(l: MarketListingDto): HTMLElement {
    const act = h('div', { class: 'mkt-cell-act' });
    act.appendChild(h('span', { class: l.status === 'active' ? 'tag warn-tag' : 'tag', text: STATUS_LABEL[l.status] }));
    if (l.status === 'active') {
      const b = h('button', { class: 'btn ghost small', text: this.mBusyId === l.id ? 'Đang huỷ…' : 'Huỷ tin' });
      b.disabled = this.mBusyId !== 0;
      b.addEventListener('click', () => this.openCancelModal(l));
      act.appendChild(b);
    }
    act.appendChild(h('span', { class: 'mkt-cell-time muted small', text: ago(l.createdAt) }));
    return this.listingCell(l, act);
  }

  private async mLoad(p = this.mPage): Promise<void> {
    this.mError = null;
    const token = this.viewToken;
    try {
      const res = await api.market.mine({ status: this.mStatus || undefined, page: p, pageSize: MINE_PAGE_SIZE });
      if (!this.alive || token !== this.viewToken) return;
      this.mItems = res.items;
      this.mTotal = res.total;
      this.mPage = res.page;
      this.mLoaded = true;
      this.drawMine();
    } catch (e) {
      if (this.alive && token === this.viewToken) {
        this.mError = (e as Error).message;
        this.drawMine();
      }
    }
  }

  private openCancelModal(l: MarketListingDto): void {
    if (this.mBusyId) return;
    const g = gen(l.generalId);
    this.openAction({
      title: 'Xác nhận huỷ tin',
      generalId: l.generalId,
      level: l.level,
      sub: `${FACTION_LABELS[g.faction]} · ${STATUS_LABEL[l.status]}`,
      price: l.price,
      note: 'Thẻ sẽ được trả lại bộ sưu tập của bạn ngay.',
      primary: 'Xác nhận huỷ tin',
      primaryBusy: 'Đang huỷ…',
      danger: true,
      onPrimary: () => void this.cancel(l),
      onClose: () => {
        /* không cần dọn state riêng */
      },
    });
  }

  private async cancel(l: MarketListingDto): Promise<void> {
    if (this.mBusyId) return;
    this.mBusyId = l.id;
    this.setModalBusy(true);
    const token = this.viewToken;
    const sig = `cancel:${l.id}`;
    if (!this.mPending || this.mPending.sig !== sig) this.mPending = { key: newKey(), sig };
    try {
      const r = await api.market.cancel(l.id, this.mPending.key);
      this.mPending = null;
      if (!this.alive) return;
      this.closeModal();
      toast(`Đã huỷ tin và lấy lại ${gen(r.generalId).name} Lv.${r.level}.`);
      await this.mLoad();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') this.mPending = null;
      if (!this.alive) return;
      this.closeModal();
      toast(err.message, 5000);
      if (err.code === 'LISTING_NOT_ACTIVE' || err.code === 'LISTING_GONE' || err.code === 'LISTING_NOT_FOUND') await this.mLoad();
    } finally {
      this.mBusyId = 0;
      if (this.alive && token === this.viewToken) {
        this.setModalBusy(false);
        this.drawMine();
      }
    }
  }

  // ================= Mục 4: Lịch sử mua/bán =================

  private buildHistory(): void {
    this.hSummaryEl = h('div', { class: 'summary muted' });
    this.hListEl = h('div');
    this.hPagerEl = h('div');

    const panel = h('section', { class: 'panel' }, h('div', { class: 'coll-head' }, this.hSummaryEl), this.hListEl, this.hPagerEl);
    render(this.bodyEl, panel);

    this.drawHistory();
    void this.hLoad();
  }

  private drawHistory(): void {
    if (this.hSummaryEl) this.hSummaryEl.textContent = this.hLoaded ? `${this.hTotal} giao dịch` : '';
    const host = this.hListEl;
    if (host) {
      if (this.hError) render(host, h('div', { class: 'state-msg error', text: `Không tải được lịch sử: ${this.hError}` }));
      else if (!this.hLoaded) render(host, h('div', { class: 'state-msg', text: 'Đang tải…' }));
      else if (this.hItems.length === 0) render(host, h('div', { class: 'state-msg', text: 'Chưa có giao dịch mua/bán nào.' }));
      else {
        const grid = h('div', { class: 'mkt-grid' });
        for (const l of this.hItems) grid.appendChild(this.historyCell(l));
        render(host, grid);
      }
    }
    this.drawPager(this.hPagerEl, this.hPage, HISTORY_PAGE_SIZE, this.hTotal, (p) => void this.hLoad(p));
  }

  private historyCell(l: MarketListingDto): HTMLElement {
    const role = l.sellerId === state.userId ? 'Bán' : 'Mua';
    const partner = (role === 'Bán' ? l.buyerName : l.sellerName) ?? '—';
    const act = h(
      'div',
      { class: 'mkt-cell-act' },
      h('span', { class: role === 'Mua' ? 'tag warn-tag' : 'tag', text: role }),
      h('span', { class: 'mkt-cell-time muted small', text: `${role === 'Mua' ? 'Từ' : 'Cho'} ${partner}` }),
      h('span', { class: 'mkt-cell-time muted small', text: l.soldAt ? new Date(l.soldAt).toLocaleString('vi-VN') : '' }),
    );
    return this.listingCell(l, act);
  }

  private async hLoad(p = this.hPage): Promise<void> {
    this.hError = null;
    const token = this.viewToken;
    try {
      const res = await api.market.history({ page: p, pageSize: HISTORY_PAGE_SIZE });
      if (!this.alive || token !== this.viewToken) return;
      this.hItems = res.items;
      this.hTotal = res.total;
      this.hPage = res.page;
      this.hLoaded = true;
      this.drawHistory();
    } catch (e) {
      if (this.alive && token === this.viewToken) {
        this.hError = (e as Error).message;
        this.drawHistory();
      }
    }
  }
}
