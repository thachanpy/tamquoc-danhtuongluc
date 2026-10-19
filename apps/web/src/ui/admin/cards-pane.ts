import { FACTIONS, FACTION_LABELS, type AdminCardDto } from '@tq/shared';
import { api } from '../../services/api.ts';
import { gen } from '../../state/store.ts';
import { cardEl } from '../Card.ts';
import { clear, h } from '../dom.ts';
import { openCardViewer } from '../viewer.ts';
import { createPager, createUserSelect, fillOptions, loadBlock, type Load, type PagerInfo, type UserSelect } from './shared.ts';

/** Số thẻ mỗi trang. */
const PAGE_SIZE = 60;

/**
 * Tab "Thẻ tướng": xem mọi thẻ của mọi người chơi, lọc theo người chơi / phe / level / tên.
 * Bấm một thẻ để mở popup ngắm thẻ (dùng chung với Bộ sưu tập).
 */
export class CardsPane {
  readonly el: HTMLElement;

  private readonly opts: { alive: () => boolean };
  private readonly f = { userId: '', q: '', faction: '', level: '', sort: 'level_desc', page: 1 };
  private readonly users: UserSelect;

  private loaded = false;
  private seq = 0;
  private grid: Load = { kind: 'loading' };
  private shown: AdminCardDto[] = [];
  private summary = '';
  private pagerInfo: PagerInfo | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  private readonly summaryEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly pager: ReturnType<typeof createPager>;

  constructor(opts: { alive: () => boolean }) {
    this.opts = opts;
    this.users = createUserSelect(opts.alive, (v) => this.onFilter('userId', v));

    const q = h('input', { attrs: { type: 'search', placeholder: 'Tìm theo tên tướng…', 'aria-label': 'Tìm tướng' } });
    q.addEventListener('input', () => this.onFilter('q', q.value));

    const faction = h('select', { attrs: { 'aria-label': 'Phe' } }, h('option', { attrs: { value: '' }, text: 'Mọi phe' }));
    fillOptions(
      faction,
      FACTIONS.map((x) => ({ value: x, label: FACTION_LABELS[x] })),
      false,
    );
    faction.addEventListener('input', () => this.onFilter('faction', faction.value));

    const level = h('select', { attrs: { 'aria-label': 'Level' } }, h('option', { attrs: { value: '' }, text: 'Mọi level' }));
    fillOptions(
      level,
      Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `Lv.${i + 1}` })),
      false,
    );
    level.addEventListener('input', () => this.onFilter('level', level.value));

    const sort = h(
      'select',
      { attrs: { 'aria-label': 'Sắp xếp' } },
      h('option', { attrs: { value: 'level_desc' }, text: 'Level cao nhất' }),
      h('option', { attrs: { value: 'newest' }, text: 'Mới nhất' }),
      h('option', { attrs: { value: 'name' }, text: 'Tên tướng A→Z' }),
      h('option', { attrs: { value: 'owner' }, text: 'Theo người chơi' }),
    );
    sort.value = this.f.sort;
    sort.addEventListener('input', () => this.onFilter('sort', sort.value));

    this.summaryEl = h('div', { class: 'adm-summary muted small' });
    this.gridEl = h('div', { class: 'adm-cards-grid' });
    this.pager = createPager({
      onPrev: () => {
        this.f.page--;
        void this.load();
      },
      onNext: () => {
        this.f.page++;
        void this.load();
      },
    });

    this.el = h(
      'div',
      {},
      h('div', { class: 'filters' }, this.users.el, q, faction, level, sort),
      this.summaryEl,
      this.gridEl,
      this.pager.el,
    );
  }

  /** Gọi khi người dùng mở tab: nạp danh sách người chơi (cho bộ lọc) và lưới thẻ lần đầu. */
  ensureLoaded(): void {
    void this.users.load();
    if (!this.loaded) void this.load();
  }

  /** Nhảy sang tab Thẻ tướng với bộ lọc đúng người chơi vừa bấm "Xem thẻ" ở tab Người chơi. */
  showUser(userId: number): void {
    this.f.userId = String(userId);
    this.f.page = 1;
    void this.users.load().then(() => (this.users.el.value = this.f.userId));
    void this.load();
  }

  private onFilter(key: 'userId' | 'q' | 'faction' | 'level' | 'sort', value: string): void {
    const apply = (): void => {
      this.f[key] = value;
      this.f.page = 1;
      void this.load();
    };
    // Ô tìm kiếm gõ liên tục nên chờ 250ms; các bộ lọc còn lại áp dụng ngay.
    clearTimeout(this.timer);
    if (key === 'q') this.timer = setTimeout(apply, 250);
    else apply();
  }

  private async load(): Promise<void> {
    this.loaded = true;
    const my = ++this.seq;
    this.grid = { kind: 'loading' };
    this.draw();
    try {
      const p = await api.admin.cards({
        userId: this.f.userId ? Number(this.f.userId) : undefined,
        q: this.f.q,
        faction: (this.f.faction || undefined) as never,
        level: this.f.level ? Number(this.f.level) : undefined,
        sort: this.f.sort,
        page: this.f.page,
        pageSize: PAGE_SIZE,
      });
      if (!this.opts.alive() || my !== this.seq) return;
      this.shown = p.items;
      this.summary = `${p.total.toLocaleString('vi-VN')} thẻ đang sở hữu`;
      this.pagerInfo = { page: this.f.page, pages: Math.max(1, Math.ceil(p.total / PAGE_SIZE)) };
      this.grid = { kind: 'ready' };
    } catch (e) {
      if (!this.opts.alive() || my !== this.seq) return;
      this.grid = { kind: 'error', text: (e as Error).message };
    }
    this.draw();
  }

  private draw(): void {
    this.summaryEl.textContent = this.summary;
    clear(this.gridEl);
    if (this.grid.kind !== 'ready' || this.shown.length === 0) {
      this.gridEl.appendChild(loadBlock(this.grid, 'Không có thẻ phù hợp.'));
    } else {
      const grid = h('div', { class: 'grid adm-grid' });
      for (const c of this.shown) {
        const view = h('button', { class: 'pick view', attrs: { title: 'Xem thẻ' } }, cardEl({ general: gen(c.generalId), level: c.level, extra: 'small' }));
        view.addEventListener('click', () => openCardViewer(gen(c.generalId), c));
        grid.appendChild(h('div', { class: 'grid-item' }, view, h('div', { class: 'owner small', text: `👤 ${c.username}` })));
      }
      this.gridEl.appendChild(grid);
    }
    this.pager.set(this.pagerInfo);
  }

  /** Dỡ pane: huỷ debounce tìm kiếm còn treo. */
  dispose(): void {
    clearTimeout(this.timer);
  }
}
