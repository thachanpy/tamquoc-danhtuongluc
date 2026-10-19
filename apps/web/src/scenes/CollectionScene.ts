import {
  FACTIONS,
  FACTION_LABELS,
  GEM_ELEMENTS,
  GEM_ELEMENT_LABELS,
  PVP_STYLES,
  PVP_STYLE_LABELS,
  type CardDto,
  type GemConfigDto,
  type GemDto,
  type GemElement,
  type RecipientDto,
} from '@tq/shared';
import { pct } from '../assets/art.ts';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api, fetchAllCards } from '../services/api.ts';
import { ApiError, newKey } from '../services/http.ts';
import { gen, genStyle, state } from '../state/store.ts';
import { cardEl } from '../ui/Card.ts';
import { h, render } from '../ui/dom.ts';
import { gemCardEl } from '../ui/GemCard.ts';
import { PageScene } from '../ui/PageScene.ts';
import { groupCardsByGeneral, type GeneralGroup, type LevelRun, type UpgradeSort } from '../utils/upgrade-groups.ts';
import { openCardViewer, openGemViewer } from '../ui/viewer.ts';

/** Bỏ dấu tiếng Việt để tìm kiếm không phân biệt dấu ("quan vu" khớp "Quan Vũ"). */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();

/** Số thẻ vẽ thêm mỗi lần bấm "Xem thêm" ở tab Tướng. */
const RENDER_STEP = 600;

/** "5 phút trước", "3 giờ trước", "2 ngày trước". */
function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 60 * 24) return `${Math.round(m / 60)} giờ trước`;
  return `${Math.round(m / 1440)} ngày trước`;
}

type GiftMsg = { kind: 'ok'; count: number; to: string } | { kind: 'error'; text: string };
type Confirm = { username: string; picked: CardDto[]; hi: number };

/**
 * Bộ sưu tập (mục 6.1) + Tặng thẻ (mục 5.6).
 * - Thẻ gom theo tướng: mọi bản sao cùng tướng nằm chung một khung, level cao → thấp.
 * - Chế độ xem "Tướng chưa có" hiện các tướng chưa sở hữu (mờ).
 * - Bật "Tặng thẻ" để chọn tối đa GIFT_MAX_CARDS thẻ và người nhận (dropdown có tìm kiếm,
 *   người giao dịch gần nhất lên đầu). Server kiểm tra lại toàn bộ và chuyển thẻ nguyên tử.
 */
export class CollectionScene extends PageScene {
  constructor() {
    super(SceneKeys.Collection);
  }

  // --- trạng thái tab + dữ liệu thẻ
  private sub: 'tuong' | 'ngoc' = 'tuong';
  private cards: CardDto[] = [];
  private loaded = false;
  private loadError: string | null = null;
  private q = '';
  private faction = '';
  private style = '';
  private level = '';
  private view = 'mine';
  private sort: UpgradeSort = 'level_desc';

  // --- trạng thái tặng thẻ
  private giftMode = false;
  private selected: number[] = [];
  private busy = false;
  private confirm: Confirm | null = null;
  private recipients: RecipientDto[] = [];
  private recipientsLoaded = false;
  private toValue = '';
  private listOpen = false;
  private activeIdx = -1;
  private msg: GiftMsg | null = null;
  private pending: { key: string; sig: string } | null = null;
  private limit = RENDER_STEP;

  // --- tab Ngọc
  private gems: GemDto[] = [];
  private gemConfig: GemConfigDto | null = null;
  private gemLoaded = false;
  private gemError: string | null = null;

  private alive = true;
  private blurTimer?: ReturnType<typeof setTimeout>;

  // --- phần tử DOM được cập nhật tại chỗ
  private bodyEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private summaryEl!: HTMLElement;
  private giftPanel!: HTMLElement;
  private giftToggleBtn!: HTMLButtonElement;
  private giftCountEl!: HTMLElement;
  private giftSendBtn!: HTMLButtonElement;
  private toInput!: HTMLInputElement;
  private listEl!: HTMLElement;
  private confirmEl!: HTMLElement;
  private msgEl!: HTMLElement;

  protected build(): HTMLElement {
    const root = h('div');
    const tabs = h('div', { class: 'sub-tabs lg', attrs: { role: 'tablist' } });
    const mkTab = (id: 'tuong' | 'ngoc', label: string): HTMLButtonElement => {
      const b = h('button', { class: 'btn small', attrs: { role: 'tab' }, text: label });
      b.addEventListener('click', () => {
        if (this.sub === id) return;
        this.sub = id;
        this.drawSubTabs();
        this.renderSub();
      });
      return b;
    };
    tabs.append(mkTab('tuong', 'Tướng'), mkTab('ngoc', 'Ngọc'));
    this.subTabsEl = tabs;

    this.bodyEl = h('div');
    root.append(tabs, this.bodyEl);

    this.track(() => {
      this.alive = false;
      clearTimeout(this.blurTimer);
    });

    return root;
  }

  private subTabsEl!: HTMLElement;

  private drawSubTabs(): void {
    const btns = this.subTabsEl.querySelectorAll('button');
    btns[0]?.classList.toggle('on', this.sub === 'tuong');
    btns[1]?.classList.toggle('on', this.sub === 'ngoc');
  }

  protected loadData(): void {
    this.drawSubTabs();
    this.renderSub();
    void this.loadCards();
  }

  /** Vẽ lại thân trang theo sub-tab đang chọn. */
  private renderSub(): void {
    if (this.sub === 'ngoc') this.buildGemTab();
    else this.buildTuongTab();
  }

  // ================= Tab Tướng =================

  private buildTuongTab(): void {
    const MAX = state.config!.giftMaxCards;

    this.summaryEl = h('div', { class: 'summary muted' });
    const head = h('div', { class: 'coll-head' }, this.summaryEl);
    // Tặng thẻ tạm tắt (server features.gift = false) => ẩn nút
    if (state.features.gift) {
      this.giftToggleBtn = h('button', { class: 'btn primary small' });
      this.giftToggleBtn.addEventListener('click', () => this.toggleGift());
      head.appendChild(this.giftToggleBtn);
    }

    this.giftPanel = h('div', { class: 'gift-panel' });
    this.buildGiftPanel(MAX);

    const filters = this.buildFilters();
    const panel = h('section', { class: 'panel' }, head, this.giftPanel, filters);

    this.gridEl = h('div', { class: 'pick-grid' });
    render(this.bodyEl, panel, this.gridEl);

    this.refresh();
  }

  /** Các ô lọc: tên, phe, phong cách, level, sắp xếp, chế độ xem. */
  private buildFilters(): HTMLElement {
    const box = h('div', { class: 'filters' });

    const search = h('input', { attrs: { type: 'search', placeholder: 'Tìm theo tên tướng…', 'aria-label': 'Tìm tướng' } });
    search.addEventListener('input', () => {
      this.q = search.value;
      this.redraw();
    });
    box.appendChild(search);

    const mkSelect = (label: string, defLabel: string, entries: [string, string][], onChange: (v: string) => void): HTMLSelectElement => {
      const sel = h('select', { attrs: { 'aria-label': label } }, h('option', { attrs: { value: '' }, text: defLabel }));
      for (const [v, l] of entries) sel.appendChild(h('option', { attrs: { value: v }, text: l }));
      sel.addEventListener('input', () => onChange(sel.value));
      return sel;
    };

    box.appendChild(mkSelect('Phe', 'Mọi phe', FACTIONS.map((f) => [f, FACTION_LABELS[f]] as [string, string]), (v) => ((this.faction = v), this.redraw())));
    box.appendChild(
      mkSelect('Phong cách', 'Mọi phong cách', PVP_STYLES.map((st) => [st, PVP_STYLE_LABELS[st]] as [string, string]), (v) => ((this.style = v), this.redraw())),
    );
    box.appendChild(
      mkSelect(
        'Level',
        'Mọi level',
        Array.from({ length: 10 }, (_, i) => [String(i + 1), `Lv.${i + 1}`] as [string, string]),
        (v) => ((this.level = v), this.redraw()),
      ),
    );

    const sortSel = mkSelect(
      'Sắp xếp',
      'Level cao nhất',
      [
        ['level_desc', 'Level cao nhất'],
        ['name', 'Tên A→Z'],
        ['count', 'Nhiều thẻ nhất'],
      ],
      (v) => ((this.sort = v as UpgradeSort), this.redraw()),
    );
    sortSel.value = 'level_desc';
    box.appendChild(sortSel);

    const viewSel = mkSelect(
      'Chế độ xem',
      'Thẻ của tôi',
      [
        ['mine', 'Thẻ của tôi'],
        ['missing', 'Tướng chưa có'],
      ],
      (v) => ((this.view = v), this.redraw()),
    );
    viewSel.value = 'mine';
    box.appendChild(viewSel);
    this.viewSel = viewSel;

    return box;
  }

  private viewSel?: HTMLSelectElement;

  /** Khung tặng thẻ: combobox người nhận + nút + hộp xác nhận + thông báo. */
  private buildGiftPanel(MAX: number): void {
    this.msgEl = h('div', { class: 'gift-msg', attrs: { 'aria-live': 'polite' } });
    this.confirmEl = h('div', { class: 'gift-confirm' });

    this.toInput = h('input', {
      attrs: {
        id: 'gift-to',
        placeholder: 'Tìm người chơi…',
        maxlength: 32,
        autocomplete: 'off',
        role: 'combobox',
        'aria-controls': 'gift-to-list',
      },
    });
    this.listEl = h('ul', { class: 'combo-list', attrs: { id: 'gift-to-list', role: 'listbox' } });

    this.toInput.addEventListener('focus', () => this.openList());
    this.toInput.addEventListener('blur', () => {
      clearTimeout(this.blurTimer);
      this.blurTimer = setTimeout(() => this.hideList(), 100);
    });
    this.toInput.addEventListener('input', () => {
      this.toValue = this.toInput.value;
      this.activeIdx = -1;
      this.closeConfirm();
      this.msg = null;
      this.listOpen = true;
      this.syncGift();
    });
    this.toInput.addEventListener('keydown', (ev) => this.onToKeyDown(ev));

    const combo = h(
      'div',
      { class: 'combo' },
      h('label', { attrs: { for: 'gift-to' }, text: 'Người nhận' }),
      this.toInput,
      this.listEl,
    );

    this.giftCountEl = h('span', { class: 'gift-count muted' });

    this.giftSendBtn = h('button', { class: 'btn primary' });
    this.giftSendBtn.addEventListener('click', () => {
      this.msg = null;
      this.showConfirm();
      this.syncGift();
    });

    const clearBtn = h('button', { class: 'btn ghost small', text: 'Bỏ chọn' });
    clearBtn.addEventListener('click', () => {
      this.selected = [];
      this.closeConfirm();
      this.redraw();
    });

    const form = h('div', { class: 'gift-form' }, combo, this.giftCountEl, clearBtn, this.giftSendBtn);

    const note = h('p', { class: 'muted small' }, 'Chọn tối đa ', h('b', { text: `${MAX} thẻ` }), ' bên dưới rồi chọn người nhận. Người nhận có thẻ ngay; thẻ đã tặng không lấy lại được.');

    this.giftPanel.append(note, form, this.confirmEl, this.msgEl);
  }

  // ================= Lưới thẻ =================

  private ownedIds(): Set<string> {
    return new Set(this.cards.map((c) => c.generalId));
  }

  private matchGeneral(id: string): boolean {
    const g = gen(id);
    const fq = fold(this.q.trim());
    return (!this.faction || g.faction === this.faction) && (!this.style || genStyle(g.id) === this.style) && (!fq || fold(g.name).includes(fq));
  }

  private missingGenerals(owned: Set<string>): typeof state.generals {
    return state.generals.filter((g) => !owned.has(g.id) && this.matchGeneral(g.id));
  }

  private filteredCards(): CardDto[] {
    return this.cards.filter((c) => this.matchGeneral(c.generalId) && (!this.level || c.level === Number(this.level)));
  }

  /** Nhóm đã cắt theo `limit`: nhãn vẫn hiện ĐÚNG tổng số thẻ, chỉ giới hạn số thẻ được vẽ. */
  private shownGroups(groups: GeneralGroup[]): { group: GeneralGroup; runs: { run: LevelRun; shown: number }[] }[] {
    let left = this.limit;
    const out: { group: GeneralGroup; runs: { run: LevelRun; shown: number }[] }[] = [];
    for (const g of groups) {
      if (left <= 0) break;
      const runs = g.runs.map((r) => {
        const n = Math.min(left, r.cards.length);
        left -= n;
        return { run: r, shown: n };
      });
      out.push({ group: g, runs });
    }
    return out;
  }

  /** Lỗi tải hiện thay lưới cho tới lần vẽ lại kế tiếp (đổi lọc, bật/tắt tặng, chọn thẻ…). */
  private redraw(): void {
    this.loadError = null;
    this.limit = RENDER_STEP;
    this.refresh();
  }

  /** Vẽ lại lưới + đồng bộ khung tặng thẻ. */
  private refresh(): void {
    if (!this.alive) return;
    this.drawGrid();
    this.syncGift();
  }

  private drawGrid(): void {
    const owned = this.ownedIds();
    this.summaryEl.textContent = this.loaded ? `Đã sở hữu ${owned.size}/${state.generals.length} tướng · ${this.cards.length} thẻ` : '';

    if (this.loadError) {
      render(this.gridEl, h('div', { class: 'state-msg error', text: `Không tải được bộ sưu tập: ${this.loadError}` }));
      return;
    }
    if (!this.loaded) {
      render(this.gridEl, h('div', { class: 'state-msg', text: 'Đang tải bộ sưu tập…' }));
      return;
    }
    if (this.view === 'missing') {
      const missing = this.missingGenerals(owned);
      if (!missing.length) {
        const text = owned.size === state.generals.length ? `Bạn đã sở hữu đủ ${state.generals.length} tướng!` : 'Không có tướng phù hợp bộ lọc.';
        render(this.gridEl, h('div', { class: 'state-msg', text }));
        return;
      }
      const grid = h('div', { class: 'grid' });
      for (const g of missing) grid.appendChild(h('div', { class: 'grid-item' }, cardEl({ general: g, level: null })));
      render(this.gridEl, grid);
      return;
    }

    const filtered = this.filteredCards();
    if (this.cards.length === 0) {
      render(this.gridEl, h('div', { class: 'state-msg', text: 'Bạn chưa có thẻ nào. Hãy quay thẻ ở tab Quay thẻ.' }));
      return;
    }
    if (filtered.length === 0) {
      render(this.gridEl, h('div', { class: 'state-msg', text: 'Không có thẻ phù hợp bộ lọc.' }));
      return;
    }

    const groups = groupCardsByGeneral(filtered, (id) => gen(id).name, this.sort, Number.MAX_SAFE_INTEGER);
    const children: HTMLElement[] = [];
    for (const v of this.shownGroups(groups)) {
      const f = gen(v.group.generalId).faction;
      const group = h(
        'div',
        { class: `gen-group f-${f}` },
        h(
          'div',
          { class: 'gen-head' },
          h('b', { text: v.group.name }),
          h('span', { class: 'muted small', text: `${FACTION_LABELS[f]} · ${v.group.total} thẻ` }),
        ),
      );
      const runs = h('div', { class: 'gen-runs' });
      for (const x of v.runs) {
        const label = x.shown < x.run.cards.length ? `Lv.${x.run.level} ×${x.shown}/${x.run.cards.length}` : `Lv.${x.run.level} ×${x.run.cards.length}`;
        const cardsBox = h('div', { class: 'run-cards' });
        for (const c of x.run.cards.slice(0, x.shown)) cardsBox.appendChild(this.cardButton(c));
        runs.appendChild(h('div', { class: 'lv-run' }, h('div', { class: 'run-label', text: label }), cardsBox));
      }
      group.appendChild(runs);
      children.push(group);
    }

    if (filtered.length > this.limit || this.limit > RENDER_STEP) {
      const more = h('div', { class: 'coll-more' });
      if (filtered.length > this.limit) {
        const b = h('button', { class: 'btn primary small', text: `Xem thêm (đang hiện ${this.limit}/${filtered.length} thẻ)` });
        b.addEventListener('click', () => {
          this.limit += RENDER_STEP;
          this.refresh();
        });
        more.appendChild(b);
      }
      if (this.limit > RENDER_STEP) {
        const b = h('button', { class: 'btn ghost small', text: 'Thu gọn' });
        b.addEventListener('click', () => {
          this.limit = RENDER_STEP;
          this.refresh();
        });
        more.appendChild(b);
      }
      children.push(more);
    }

    render(this.gridEl, ...children);
  }

  /** Một thẻ trong lưới: chế độ tặng thì là nút chọn, ngược lại là nút xem. */
  private cardButton(card: CardDto): HTMLElement {
    if (!this.giftMode) {
      const b = h('button', { class: 'pick view', attrs: { title: 'Xem thẻ' } }, cardEl({ general: gen(card.generalId), level: card.level, extra: 'small' }));
      b.addEventListener('click', () => openCardViewer(gen(card.generalId), card));
      return b;
    }
    const on = this.selected.includes(card.id);
    const b = h('button', { class: on ? 'pick on' : 'pick', attrs: { 'aria-pressed': on ? 'true' : 'false' } },
      cardEl({ general: gen(card.generalId), level: card.level, extra: 'small' }),
    );
    b.disabled = !on && (this.busy || this.selected.length >= state.config!.giftMaxCards);
    b.addEventListener('click', () => this.toggleCard(card.id));
    return b;
  }

  private toggleCard(id: number): void {
    this.selected = this.selected.includes(id) ? this.selected.filter((x) => x !== id) : [...this.selected, id].slice(0, state.config!.giftMaxCards);
    this.closeConfirm();
    this.redraw();
  }

  // ================= Người nhận (combobox) =================

  private findRecipient(name: string): RecipientDto | undefined {
    return this.recipients.find((r) => r.username.toLowerCase() === name.trim().toLowerCase());
  }

  private listItems(): RecipientDto[] {
    const fq = fold(this.toValue.trim());
    return this.recipients.filter((r) => !fq || fold(r.username).includes(fq)).slice(0, 50);
  }

  private async loadRecipients(): Promise<void> {
    try {
      const items = (await api.users()).items;
      if (!this.alive) return;
      this.recipients = items;
      this.recipientsLoaded = true;
      this.syncGift();
    } catch (e) {
      if (this.alive) {
        this.msg = { kind: 'error', text: `Không tải được danh sách người chơi: ${(e as Error).message}` };
        this.syncGift();
      }
    }
  }

  private openList(): void {
    this.activeIdx = Math.min(this.activeIdx, this.listItems().length - 1);
    this.listOpen = true;
    this.syncGift();
  }

  private hideList(): void {
    this.listOpen = false;
    this.activeIdx = -1;
    this.syncGift();
  }

  private pick(name: string): void {
    this.toValue = name;
    this.toInput.value = name;
    this.listOpen = false;
    this.activeIdx = -1;
    this.closeConfirm();
    this.msg = null;
    this.syncGift();
  }

  private onToKeyDown(ev: KeyboardEvent): void {
    const n = this.recipientsLoaded ? this.listItems().length : 0;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      this.activeIdx = Math.max(0, Math.min(n - 1, Math.min(this.activeIdx, n - 1) + (ev.key === 'ArrowDown' ? 1 : -1)));
      this.listOpen = true;
      this.syncGift();
    } else if (ev.key === 'Enter' && this.listOpen && this.activeIdx >= 0 && this.activeIdx < n) {
      ev.preventDefault();
      this.pick(this.listItems()[this.activeIdx]!.username);
    } else if (ev.key === 'Escape') {
      this.hideList();
    }
  }

  // ================= Tặng thẻ =================

  private validRecipient(): boolean {
    return !!this.findRecipient(this.toValue);
  }

  private closeConfirm(): void {
    this.confirm = null;
  }

  private showConfirm(): void {
    const r = this.findRecipient(this.toValue);
    if (!r) return;
    const byId = new Map(this.cards.map((c) => [c.id, c]));
    const picked = this.selected.map((id) => byId.get(id)).filter((c): c is CardDto => !!c);
    this.confirm = { username: r.username, picked, hi: picked.filter((c) => c.level >= 6).length };
  }

  /** Đồng bộ mọi phần phụ thuộc trạng thái tặng thẻ (khung, combobox, xác nhận, thông báo). */
  private syncGift(): void {
    if (!this.alive || !this.giftPanel?.isConnected) return;
    const MAX = state.config!.giftMaxCards;

    this.giftPanel.hidden = !this.giftMode;
    if (this.giftToggleBtn) {
      this.giftToggleBtn.textContent = this.giftMode ? 'Đóng tặng thẻ' : '🎁 Tặng thẻ';
      this.giftToggleBtn.className = this.giftMode ? 'btn ghost small' : 'btn primary small';
    }

    this.giftCountEl.textContent = `Đã chọn ${this.selected.length}/${MAX}`;

    const valid = this.validRecipient();
    this.giftSendBtn.disabled = this.busy || !!this.confirm || this.selected.length === 0 || !valid;
    this.giftSendBtn.title = !valid && this.toValue.trim() ? 'Chọn người nhận trong danh sách' : '';
    this.giftSendBtn.textContent = this.busy ? 'Đang tặng…' : this.selected.length ? `Tặng ${this.selected.length} thẻ` : 'Tặng';

    this.toInput.setAttribute('aria-expanded', this.listOpen ? 'true' : 'false');
    this.listEl.hidden = !this.listOpen;
    if (this.listOpen) {
      const items = this.listItems();
      if (!this.recipientsLoaded) render(this.listEl, h('li', { class: 'muted small', text: 'Đang tải…' }));
      else if (items.length === 0) render(this.listEl, h('li', { class: 'muted small', text: 'Không tìm thấy người chơi.' }));
      else {
        render(
          this.listEl,
          ...items.map((r, i) => {
            const li = h(
              'li',
              { class: i === this.activeIdx ? 'active' : '', attrs: { role: 'option', 'data-name': r.username, 'aria-selected': i === this.activeIdx ? 'true' : 'false' } },
              h('span', { text: r.username }),
            );
            if (r.lastGiftAt) li.appendChild(h('span', { class: 'recent', text: `Gần đây · ${ago(r.lastGiftAt)}` }));
            li.addEventListener('mousedown', (ev) => {
              ev.preventDefault(); // giữ focus, tránh blur trước khi chọn
              this.pick(r.username);
            });
            return li;
          }),
        );
      }
    }

    // Hộp xác nhận: chỉ hiện khi đã chọn người nhận + thẻ.
    if (!this.confirm) {
      render(this.confirmEl);
    } else {
      const c = this.confirm;
      const cardsBox = h('div', { class: 'result-cards' });
      for (const card of c.picked) cardsBox.appendChild(cardEl({ general: gen(card.generalId), level: card.level, extra: 'small' }));
      const cancel = h('button', { class: 'btn ghost', text: 'Huỷ' });
      cancel.disabled = this.busy;
      cancel.addEventListener('click', () => {
        this.closeConfirm();
        this.syncGift();
      });
      const ok = h('button', { class: 'btn danger', text: 'Xác nhận tặng' });
      ok.disabled = this.busy;
      ok.addEventListener('click', () => void this.send(c.username));
      const warn = h('p', { class: 'warn' }, '⚠ Thẻ sẽ chuyển ngay sang người nhận và không thể lấy lại.', c.hi ? ` Trong đó có ${c.hi} thẻ từ Lv.6 trở lên.` : '');
      render(
        this.confirmEl,
        h('div', { class: 'quick-box' }, h('p', {}, h('b', { text: `Xác nhận tặng ${c.picked.length} thẻ cho "${c.username}"?` })), cardsBox, warn, cancel, ' ', ok),
      );
    }

    const m = this.msg;
    if (!m) render(this.msgEl);
    else if (m.kind === 'ok') render(this.msgEl, h('span', { class: 'ok' }, `✓ Đã tặng ${m.count} thẻ cho `, h('b', { text: m.to }), '.'));
    else render(this.msgEl, h('span', { class: 'error', text: m.text }));
  }

  private async send(to: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.syncGift();
    const ids = [...this.selected].sort((a, b) => a - b);
    const sig = `${to.toLowerCase()}|${ids.join(',')}`;
    // Giữ key khi lỗi mạng để bấm lại là retry an toàn (server không chuyển thẻ 2 lần)
    if (!this.pending || this.pending.sig !== sig) this.pending = { key: newKey(), sig };
    try {
      const r = await api.gift(to, ids, this.pending.key);
      this.pending = null;
      if (!this.alive) return;
      this.selected = [];
      this.closeConfirm();
      this.msg = { kind: 'ok', count: r.cards.length, to: r.toUsername };
      this.busy = false;
      await Promise.all([this.loadCards(), this.loadRecipients()]); // người vừa nhận lên đầu danh sách
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') this.pending = null;
      if (!this.alive) return;
      this.busy = false;
      this.closeConfirm();
      this.msg = { kind: 'error', text: err.message };
      if (err.code === 'CARD_NOT_FOUND' || err.code === 'CARD_CONSUMED') {
        this.selected = [];
        await this.loadCards();
      } else {
        this.redraw();
      }
      this.syncGift();
    }
  }

  private toggleGift(): void {
    const on = !this.giftMode;
    this.giftMode = on;
    if (on) {
      if (this.view !== 'mine') {
        this.view = 'mine';
        if (this.viewSel) this.viewSel.value = 'mine';
      }
      if (!this.recipientsLoaded) void this.loadRecipients();
    } else {
      this.selected = [];
      this.closeConfirm();
      this.msg = null;
    }
    this.redraw();
  }

  private async loadCards(): Promise<void> {
    try {
      const list = await fetchAllCards();
      if (!this.alive) return;
      this.cards = list;
      this.selected = this.selected.filter((id) => list.some((c) => c.id === id));
      this.loaded = true;
      this.loadError = null;
      this.refresh();
    } catch (e) {
      if (this.alive) {
        this.loadError = (e as Error).message;
        this.refresh();
      }
    }
  }

  // ================= Tab Ngọc =================

  /** Nhóm theo loại Ngọc (đủ 5 loại): mỗi loại là một khung, trong khung chia theo cấp (cao → thấp). */
  private gemGroups(): { element: GemElement; total: number; best: number; runs: { level: number; gems: GemDto[] }[] }[] {
    const byEl = new Map<GemElement, Map<number, GemDto[]>>();
    for (const g of this.gems) {
      const lvls = byEl.get(g.element) ?? new Map<number, GemDto[]>();
      lvls.set(g.level, [...(lvls.get(g.level) ?? []), g]);
      byEl.set(g.element, lvls);
    }
    return GEM_ELEMENTS.map((element) => {
      const lvls = byEl.get(element);
      const runs = lvls ? [...lvls.entries()].sort((a, b) => b[0] - a[0]).map(([level, list]) => ({ level, gems: list })) : [];
      return { element, total: runs.reduce((s, r) => s + r.gems.length, 0), best: runs[0]?.level ?? 0, runs };
    });
  }

  private buildGemTab(): void {
    const summary = h('div', { class: 'summary muted', text: this.gemLoaded ? `Đã sở hữu ${this.gems.length} viên Ngọc` : '' });
    const panel = h('section', { class: 'panel' }, h('div', { class: 'coll-head' }, summary));

    if (this.gemConfig) {
      const c = this.gemConfig;
      panel.appendChild(
        h(
          'p',
          { class: 'muted small' },
          'Ngọc cộng Chỉ số Nền cho toàn đội khi vào trận (không thể bị Xóa Buff). Mỗi đội hình gắn tối đa ',
          h('b', { text: `${c.teamGemCount} Ngọc khác loại` }),
          '; hệ thống tự dùng viên cấp cao nhất đang sở hữu. Quay thẻ có ',
          pct(c.dropBps, c.bpsScale),
          ' cơ hội rớt kèm 1 viên Ngọc cùng cấp (hệ chọn theo trọng số).',
        ),
      );
    }

    const grid = h('div', { class: 'pick-grid' });
    if (this.gemError) grid.appendChild(h('div', { class: 'state-msg error', text: `Không tải được Ngọc: ${this.gemError}` }));
    else if (!this.gemLoaded) grid.appendChild(h('div', { class: 'state-msg', text: 'Đang tải Ngọc…' }));
    else {
      for (const grp of this.gemGroups()) {
        const head = h(
          'div',
          { class: 'gen-head' },
          h('b', { text: `Ngọc ${GEM_ELEMENT_LABELS[grp.element]}` }),
          h('span', { class: 'muted small', text: grp.total > 0 ? `Ngũ Hành · ${grp.total} viên` : 'Ngũ Hành · chưa sở hữu' }),
        );
        const detailBtn = h('button', { class: 'btn ghost small', text: 'Chi tiết' });
        detailBtn.disabled = !this.gemConfig;
        detailBtn.addEventListener('click', () => this.viewGem(grp.element, grp.best || 1, grp.total, grp.best));
        head.appendChild(detailBtn);

        const group = h('div', { class: `gen-group e-${grp.element}` }, head);
        if (grp.total === 0) group.appendChild(h('div', { class: 'muted small', text: 'Chưa sở hữu viên nào.' }));
        else {
          const runs = h('div', { class: 'gen-runs' });
          for (const r of grp.runs) {
            const cardsBox = h('div', { class: 'run-cards' });
            for (const g of r.gems) {
              const b = h('button', { class: 'pick view', attrs: { title: 'Xem Ngọc' } }, gemCardEl({ element: g.element, level: g.level }));
              b.addEventListener('click', () => this.viewGem(g.element, g.level, grp.total, grp.best));
              cardsBox.appendChild(b);
            }
            runs.appendChild(h('div', { class: 'lv-run' }, h('div', { class: 'run-label', text: `Cấp ${r.level} ×${r.gems.length}` }), cardsBox));
          }
          group.appendChild(runs);
        }
        grid.appendChild(group);
      }
    }
    panel.appendChild(grid);
    render(this.bodyEl, panel);

    if (!this.gemLoaded && !this.gemError) void this.loadGems();
  }

  private viewGem(element: GemElement, level: number, owned: number, best: number): void {
    if (this.gemConfig) openGemViewer({ element, config: this.gemConfig, owned, best, level });
  }

  private async loadGems(): Promise<void> {
    try {
      const dto = await api.gems();
      if (!this.alive) return;
      this.gems = dto.gems;
      this.gemConfig = dto.config;
      this.gemLoaded = true;
      this.gemError = null;
    } catch (e) {
      if (this.alive) this.gemError = (e as Error).message;
    }
    if (this.sub === 'ngoc' && this.alive) this.buildGemTab();
  }
}
