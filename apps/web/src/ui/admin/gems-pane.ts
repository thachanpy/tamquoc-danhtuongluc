import { GEM_ELEMENTS, GEM_ELEMENT_LABELS, type AdminGemDto, type GemConfigDto, type GemElement } from '@tq/shared';
import { api } from '../../services/api.ts';
import { clear, h } from '../dom.ts';
import { gemCardEl } from '../GemCard.ts';
import { openGemViewer } from '../viewer.ts';
import { createPager, createUserSelect, fillOptions, loadBlock, type Load, type PagerInfo, type UserSelect } from './shared.ts';

/** Số viên Ngọc mỗi trang. */
const PAGE_SIZE = 60;

/**
 * Tab "Ngọc": mọi viên Ngọc Ngũ Hành của mọi người chơi, lọc theo người chơi / loại / cấp.
 * Bấm một viên để mở popup chi tiết — ruột là chỉ số của đúng cấp đang xem, cần cấu hình Ngọc
 * nên tab này nạp thêm `/api/gems` một lần.
 */
export class GemsPane {
  readonly el: HTMLElement;

  private readonly opts: { alive: () => boolean };
  private readonly f = { userId: '', element: '', level: '', sort: 'level_desc', page: 1 };
  private readonly users: UserSelect;

  private loaded = false;
  private seq = 0;
  private config: GemConfigDto | null = null;
  private configReq: Promise<void> | null = null;
  private grid: Load = { kind: 'loading' };
  private shown: AdminGemDto[] = [];
  private summary = '';
  private pagerInfo: PagerInfo | null = null;

  private readonly summaryEl: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly pager: ReturnType<typeof createPager>;

  constructor(opts: { alive: () => boolean }) {
    this.opts = opts;
    this.users = createUserSelect(opts.alive, (v) => this.onFilter('userId', v));

    const element = h('select', { attrs: { 'aria-label': 'Loại Ngọc' } }, h('option', { attrs: { value: '' }, text: 'Mọi loại' }));
    fillOptions(
      element,
      GEM_ELEMENTS.map((x) => ({ value: x, label: GEM_ELEMENT_LABELS[x] })),
      false,
    );
    element.addEventListener('input', () => this.onFilter('element', element.value));

    const level = h('select', { attrs: { 'aria-label': 'Cấp Ngọc' } }, h('option', { attrs: { value: '' }, text: 'Mọi cấp' }));
    fillOptions(
      level,
      Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `Cấp ${i + 1}` })),
      false,
    );
    level.addEventListener('input', () => this.onFilter('level', level.value));

    const sort = h(
      'select',
      { attrs: { 'aria-label': 'Sắp xếp' } },
      h('option', { attrs: { value: 'level_desc' }, text: 'Cấp cao nhất' }),
      h('option', { attrs: { value: 'newest' }, text: 'Mới nhất' }),
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

    this.el = h('div', {}, h('div', { class: 'filters' }, this.users.el, element, level, sort), this.summaryEl, this.gridEl, this.pager.el);
  }

  /** Gọi khi người dùng mở tab: nạp danh sách người chơi, cấu hình Ngọc và lưới lần đầu. */
  ensureLoaded(): void {
    void this.users.load();
    void this.loadConfig();
    if (!this.loaded) void this.load();
  }

  private loadConfig(): Promise<void> {
    return (this.configReq ??= this.fetchConfig());
  }

  private async fetchConfig(): Promise<void> {
    try {
      const dto = await api.gems();
      if (this.opts.alive()) {
        this.config = dto.config;
        this.drawGrid();
      }
    } catch {
      this.configReq = null;
    }
  }

  private onFilter(key: 'userId' | 'element' | 'level' | 'sort', value: string): void {
    this.f[key] = value;
    this.f.page = 1;
    void this.load();
  }

  private async load(): Promise<void> {
    this.loaded = true;
    const my = ++this.seq;
    this.grid = { kind: 'loading' };
    this.draw();
    try {
      const p = await api.admin.gems({
        userId: this.f.userId ? Number(this.f.userId) : undefined,
        element: (this.f.element || undefined) as GemElement | undefined,
        level: this.f.level ? Number(this.f.level) : undefined,
        sort: this.f.sort,
        page: this.f.page,
        pageSize: PAGE_SIZE,
      });
      if (!this.opts.alive() || my !== this.seq) return;
      this.shown = p.items;
      this.summary = `${p.total.toLocaleString('vi-VN')} viên Ngọc`;
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
    this.drawGrid();
    this.pager.set(this.pagerInfo);
  }

  private drawGrid(): void {
    clear(this.gridEl);
    if (this.grid.kind !== 'ready' || this.shown.length === 0) {
      this.gridEl.appendChild(loadBlock(this.grid, 'Không có Ngọc phù hợp.'));
      return;
    }
    const grid = h('div', { class: 'grid adm-grid' });
    for (const g of this.shown) {
      const view = h('button', { class: 'pick view', attrs: { title: 'Xem Ngọc' } }, gemCardEl({ element: g.element, level: g.level, extra: 'small' }));
      // Chưa có cấu hình Ngọc thì chưa mở được popup chi tiết (bảng chỉ số theo cấp nằm trong đó).
      view.disabled = !this.config;
      view.addEventListener('click', () => {
        if (!this.config) return;
        openGemViewer({ element: g.element, config: this.config, owner: g.username, level: g.level });
      });
      grid.appendChild(h('div', { class: 'grid-item' }, view, h('div', { class: 'owner small', text: `👤 ${g.username}` })));
    }
    this.gridEl.appendChild(grid);
  }
}
