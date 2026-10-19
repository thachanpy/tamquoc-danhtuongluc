import {
  FACTIONS,
  FACTION_LABELS,
  GEM_ELEMENT_LABELS,
  MAX_LEVEL,
  PVP_STYLES,
  PVP_STYLE_LABELS,
  type CardDto,
  type GemConfigDto,
  type GemDto,
  type GemElement,
  type UpgradePreviewDto,
} from '@tq/shared';
import { pct } from '../assets/art.ts';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api, fetchAllCards } from '../services/api.ts';
import { newKey, type ApiError } from '../services/http.ts';
import { gen, genStyle, state } from '../state/store.ts';
import { cardEl } from '../ui/Card.ts';
import { h, render, type Child } from '../ui/dom.ts';
import { gemCardEl } from '../ui/GemCard.ts';
import { PageScene } from '../ui/PageScene.ts';
import { playGemUpgrade, playUpgrade } from '../ui/stage.ts';
import { groupCardsByGeneral, type UpgradeSort } from '../utils/upgrade-groups.ts';

/** Tổng kết sau khi Nâng cấp nhanh (hoặc lỗi) — dùng chung cho cả thẻ Tướng lẫn Ngọc. */
type QuickSummary =
  | {
      kind: 'ok';
      merges: number;
      successes: number;
      failures: number;
      best: number;
      byLevel: [number, { n: number; ok: number }][];
      hasMore: boolean;
    }
  | { kind: 'error'; message: string };

/** Gom số liệu thô của một lần ghép nhanh thành bảng tổng kết theo level đầu vào. */
function summarise(
  results: { inputLevel: number; resultLevel: number; outcome: string }[],
  merges: number,
  successes: number,
  failures: number,
  hasMore: boolean,
): QuickSummary {
  const byLevel = new Map<number, { n: number; ok: number }>();
  for (const x of results) {
    const b = byLevel.get(x.inputLevel) ?? { n: 0, ok: 0 };
    b.n++;
    if (x.outcome === 'success') b.ok++;
    byLevel.set(x.inputLevel, b);
  }
  return {
    kind: 'ok',
    merges,
    successes,
    failures,
    best: results.length ? Math.max(...results.map((x) => x.resultLevel)) : 0,
    byLevel: [...byLevel.entries()].sort((a, b) => a[0] - b[0]),
    hasMore,
  };
}

/** Nút "Huỷ" chọn thẻ — dùng chung nhiều chỗ trong khung "Đã chọn". */
function cancelBtn(disabled: boolean, onClick: () => void): HTMLButtonElement {
  const b = h('button', { class: 'btn ghost', attrs: { 'data-clear': true }, text: 'Huỷ' });
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Trang Nâng cấp (mục 6.4 + 6.8): ghép N thẻ cùng tướng & cùng level, và ghép 2 viên Ngọc Ngũ Hành.
 *
 * Hai sub-tab dùng chung một Scene: "Tướng" (mặc định) và "Ngọc". Mọi tỷ lệ hiển thị chỉ để tham khảo —
 * server tính lại khi thực hiện; hiệu ứng ghép chỉ phát lại kết quả server đã xác nhận.
 */
export class UpgradeScene extends PageScene {
  /** Số thẻ mỗi lần ghép — lấy từ cấu hình server. */
  private readonly N: number;
  /** Mức level mặc định chọn sẵn cho Nâng cấp nhanh (cấu hình server). */
  private readonly Q: number;
  /** Mọi level có thể chọn ở Nâng cấp nhanh (Lv.1–9; Lv.10 không ghép tiếp được). */
  private readonly allLevels: number[];
  private readonly rates: { level: number; successBps: number; failureDistribution: { level: number; bps: number }[] }[];

  private sub: 'tuong' | 'ngoc' = 'tuong';
  private alive = true;

  // ===== Trạng thái tab Tướng =====
  /** null = chưa tải xong lần nào. */
  private cards: CardDto[] | null = null;
  private loadError: string | null = null;
  private selected: number[] = [];
  private preview: UpgradePreviewDto | null = null;
  private previewError: string | null = null;
  private busy = false;
  /** Đang ở bước "Xác nhận ghép?". */
  private confirming = false;
  private upMsg = '';
  private quickConfirming = false;
  private quickSummary: QuickSummary | null = null;
  /** Các level đầu vào tham gia Nâng cấp nhanh; mặc định chọn sẵn Lv.1–Q. */
  private quickLevels: number[];
  private fFaction = '';
  private fStyle = '';
  private fLevel = '';
  private fSort: UpgradeSort = 'level_desc';
  /** Idempotency key giữ qua lỗi mạng để bấm lại là retry an toàn. */
  private pendingKey: string | null = null;
  private quickKey: string | null = null;

  // ===== DOM tab Tướng =====
  private bodyEl!: HTMLElement;
  private subTabsEl!: HTMLElement;
  private quickEl!: HTMLElement;
  private readyEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private sideEl!: HTMLElement;
  private selCountEl!: HTMLElement;
  private slotsEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private cardsById = new Map<number, CardDto>();

  // ===== Tab Ngọc =====
  private gemTab: GemTab | null = null;

  constructor() {
    super(SceneKeys.Upgrade);
    const cfg = state.config;
    this.N = cfg?.upgradeInputCount ?? 2;
    this.Q = cfg?.quickUpgradeMaxLevel ?? 5;
    this.rates = cfg?.upgradeRates ?? [];
    this.allLevels = this.rates.map((r) => r.level);
    this.quickLevels = this.allLevels.filter((lv) => lv <= this.Q);
  }

  // ======================= Dựng khung trang =======================

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
      this.gemTab?.dispose();
      this.gemTab = null;
    });

    return root;
  }

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

  private renderSub(): void {
    if (this.sub === 'ngoc') {
      this.gemTab?.dispose();
      this.gemTab = new GemTab();
      render(this.bodyEl, this.gemTab.el);
      this.gemTab.mount();
      return;
    }
    this.buildTuongTab();
  }

  // ======================= Tab Tướng =======================

  private buildTuongTab(): void {
    this.quickEl = h('div', { class: 'quick' });
    this.readyEl = h('div', { class: 'groups' });
    this.gridEl = h('div', { class: 'pick-grid' });

    const panel = h(
      'section',
      { class: 'panel' },
      h('h2', { text: `Ghép ${this.N} thẻ` }),
      h('p', { class: 'muted' }, 'Chọn đúng ', h('b', { text: String(this.N) }), ' thẻ ', h('b', { text: 'cùng tướng' }), ' và ', h('b', { text: 'cùng level' }), ' (Lv.1–9).'),
      this.quickEl,
      this.readyEl,
    );

    this.selCountEl = h('span', { class: 'sel-count' });
    this.slotsEl = h('div', { class: 'sel-slots' });
    this.slotsEl.style.gridTemplateColumns = `repeat(${this.N}, minmax(0, 1fr))`;
    this.previewEl = h('div', { class: 'preview' });
    this.sideEl = h('section', { class: 'panel side' }, h('h3', {}, 'Đã chọn ', this.selCountEl, `/${this.N}`), this.slotsEl, this.previewEl);

    const twoCol = h(
      'div',
      { class: 'two-col upgrade-layout' },
      h('section', { class: 'panel' }, this.buildFilters(), this.gridEl),
      this.sideEl,
    );

    render(this.bodyEl, panel, twoCol);

    this.drawQuick();
    this.drawReady();
    this.drawGrid();
    this.drawSide();
  }

  /** Các ô lọc: phe, phong cách, level, sắp xếp nhóm tướng. */
  private buildFilters(): HTMLElement {
    const box = h('div', { class: 'filters' });
    const mkSelect = (label: string, defLabel: string, entries: [string, string][], onChange: (v: string) => void): HTMLSelectElement => {
      const sel = h('select', { attrs: { 'aria-label': label } }, h('option', { attrs: { value: '' }, text: defLabel }));
      for (const [v, l] of entries) sel.appendChild(h('option', { attrs: { value: v }, text: l }));
      sel.addEventListener('input', () => onChange(sel.value));
      return sel;
    };

    box.appendChild(mkSelect('Phe', 'Mọi phe', FACTIONS.map((f) => [f, FACTION_LABELS[f]] as [string, string]), (v) => ((this.fFaction = v), this.drawGrid())));
    box.appendChild(
      mkSelect('Phong cách', 'Mọi phong cách', PVP_STYLES.map((s) => [s, PVP_STYLE_LABELS[s]] as [string, string]), (v) => ((this.fStyle = v), this.drawGrid())),
    );
    box.appendChild(
      mkSelect(
        'Level',
        'Mọi level',
        Array.from({ length: 10 }, (_, i) => [String(i + 1), `Lv.${i + 1}`] as [string, string]),
        (v) => ((this.fLevel = v), this.drawGrid()),
      ),
    );

    const sortSel = mkSelect(
      'Sắp xếp nhóm tướng',
      'Level cao nhất',
      [
        ['level_desc', 'Level cao nhất'],
        ['ready', 'Ghép được trước'],
        ['count', 'Nhiều thẻ nhất'],
        ['name', 'Tên A→Z'],
      ],
      (v) => ((this.fSort = v as UpgradeSort), this.drawGrid()),
    );
    sortSel.value = 'level_desc';
    box.appendChild(sortSel);

    return box;
  }

  // ======================= Nguồn dữ liệu tab Tướng =======================

  private get list(): CardDto[] {
    return this.cards ?? [];
  }

  private cardById(id: number): CardDto | undefined {
    return this.cardsById.get(id);
  }

  private filteredCards(): CardDto[] {
    return this.list.filter((c) => {
      if (this.fFaction && gen(c.generalId).faction !== this.fFaction) return false;
      if (this.fStyle && genStyle(c.generalId) !== this.fStyle) return false;
      if (this.fLevel && c.level !== Number(this.fLevel)) return false;
      return true;
    });
  }

  /** Số cặp có thể ghép NGAY trong các level đã chọn (chỉ để hiển thị; server tự tính lại). */
  private quickPairs(): number {
    const sel = new Set(this.quickLevels);
    const count = new Map<string, number>();
    for (const c of this.list) if (sel.has(c.level)) count.set(`${c.generalId}|${c.level}`, (count.get(`${c.generalId}|${c.level}`) ?? 0) + 1);
    return [...count.values()].reduce((s, n) => s + Math.floor(n / this.N), 0);
  }

  private quickRates(): { level: number; successBps: number; failureDistribution: { level: number; bps: number }[] }[] {
    const sel = new Set(this.quickLevels);
    return this.rates.filter((r) => sel.has(r.level));
  }

  /** Các nhóm đủ N thẻ cùng tướng + cùng level (chip chọn nhanh). */
  private readyGroups(): CardDto[][] {
    const groups = new Map<string, CardDto[]>();
    for (const c of this.list) {
      if (c.level >= MAX_LEVEL) continue;
      const k = `${c.generalId}|${c.level}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    return [...groups.values()].filter((g) => g.length >= this.N).sort((a, b) => b[0]!.level - a[0]!.level);
  }

  private selectable(c: CardDto): boolean {
    if (c.level >= MAX_LEVEL) return false;
    const first = this.cardById(this.selected[0] ?? -1);
    if (!first) return true;
    return c.generalId === first.generalId && c.level === first.level;
  }

  // ======================= Vẽ tab Tướng =======================

  /** Khối Nâng cấp nhanh: nút, danh sách level, bước xác nhận và bảng tổng kết. */
  private drawQuick(): void {
    if (!this.cards) {
      render(this.quickEl);
      return;
    }
    const pairs = this.quickPairs();

    const runBtn = h('button', { class: 'btn primary', attrs: { 'data-quick': true }, text: '⚡ Nâng cấp nhanh' });
    runBtn.disabled = this.busy || this.quickLevels.length === 0 || pairs === 0 || this.quickConfirming;
    runBtn.addEventListener('click', () => {
      this.quickConfirming = true;
      this.drawQuick();
    });

    const head = h(
      'div',
      { class: 'quick-head' },
      runBtn,
      h(
        'span',
        { class: 'muted small' },
        pairs > 0
          ? `${pairs} cặp có thể ghép ngay. Tự ghép liên tục mọi cặp ${this.N} thẻ cùng tướng, cùng level trong các mức đã chọn.`
          : 'Chưa có cặp thẻ nào trong các mức đã chọn để ghép nhanh.',
      ),
    );

    const levels = h('div', { class: 'quick-levels' }, h('span', { class: 'muted small', text: 'Level ghép nhanh:' }));
    for (const lv of this.allLevels) {
      const on = this.quickLevels.includes(lv);
      const label = h('label', { class: 'lv-chk', classOn: { on } });
      const cb = h('input', { attrs: { type: 'checkbox' } });
      cb.checked = on;
      cb.disabled = this.busy;
      cb.addEventListener('change', () => this.toggleQuickLevel(lv));
      label.append(cb, `Lv.${lv}`);
      levels.appendChild(label);
    }

    const box = h('div', { class: 'quick-box' }, head, levels);
    if (this.quickConfirming) box.appendChild(this.buildQuickConfirm());
    if (this.quickSummary) box.appendChild(this.buildQuickSummary(this.quickSummary));
    render(this.quickEl, box);
  }

  /** Bảng tỉ lệ + cảnh báo + nút xác nhận của bước "Nâng cấp nhanh". */
  private buildQuickConfirm(): HTMLElement {
    const table = h(
      'table',
      { class: 'rates' },
      h('thead', {}, h('tr', {}, h('td', { text: 'Ghép' }), h('td', { text: 'Thành công' }), h('td', { text: 'Giữ nguyên' }), h('td', { text: 'Tụt' }))),
    );
    const tbody = h('tbody');
    for (const r of this.quickRates()) {
      const fail = 10000 - r.successBps;
      const keep = r.failureDistribution.find((e) => e.level === r.level)?.bps ?? 0;
      tbody.appendChild(
        h(
          'tr',
          {},
          h('td', { text: `Lv.${r.level} → ${r.level + 1}` }),
          h('td', { text: pct(r.successBps) }),
          h('td', { text: pct((fail * keep) / 10000) }),
          h('td', { text: pct(fail - (fail * keep) / 10000) }),
        ),
      );
    }
    table.appendChild(tbody);

    const no = h('button', { class: 'btn ghost', attrs: { 'data-quick-no': true }, text: 'Huỷ' });
    no.addEventListener('click', () => {
      this.quickConfirming = false;
      this.drawQuick();
    });
    const yes = h('button', { class: 'btn primary', attrs: { 'data-quick-yes': true } });
    yes.disabled = this.busy;
    yes.textContent = this.busy ? 'Đang ghép…' : 'Xác nhận nâng cấp nhanh';
    yes.addEventListener('click', () => void this.runQuick());

    return h(
      'div',
      { class: 'quick-confirm' },
      table,
      h(
        'p',
        { class: 'warn' },
        `⚠ Mỗi lần ghép tiêu thụ ${this.N} thẻ, có thể thất bại hoặc tụt level. Thẻ mới tạo ra thuộc mức đã chọn sẽ được ghép tiếp. Thẻ ở mức không chọn không bị đụng tới.`,
      ),
      h('div', { class: 'quick-actions' }, no, yes),
    );
  }

  /** Bảng tổng kết sau khi ghép nhanh (hoặc thông báo lỗi). */
  private buildQuickSummary(s: QuickSummary): HTMLElement {
    const box = h('div', { class: 'quick-summary', attrs: { 'aria-live': 'polite' } });
    if (s.kind === 'error') {
      box.appendChild(h('span', { class: 'error', text: s.message }));
      return box;
    }
    box.append(
      h('b', { text: `Đã ghép ${s.merges} lần:` }),
      ' ',
      h('span', { class: 'ok', text: `${s.successes} thành công` }),
      ', ',
      h('span', { class: 'bad', text: `${s.failures} thất bại` }),
      '. Level cao nhất đạt được: ',
      h('b', { text: `Lv.${s.best}` }),
      '.',
    );
    box.appendChild(h('div', { class: 'small muted', text: s.byLevel.map(([lv, b]) => `Lv.${lv}: ${b.ok}/${b.n} thành công`).join(' · ') }));
    if (s.hasMore) box.appendChild(h('div', { class: 'small', text: 'Vẫn còn cặp có thể ghép — bấm Nâng cấp nhanh lần nữa.' }));
    return box;
  }

  /** Chip "Nhóm đủ điều kiện" để chọn nhanh một nhóm N thẻ. */
  private drawReady(): void {
    if (!this.cards) {
      render(this.readyEl);
      return;
    }
    const groups = this.readyGroups();
    if (!groups.length) {
      render(this.readyEl, h('div', { class: 'muted small', text: `Chưa có nhóm ${this.N} thẻ cùng tướng & cùng level nào.` }));
      return;
    }
    const children: Child[] = [h('div', { class: 'muted small', text: 'Nhóm đủ điều kiện:' })];
    for (const g of groups) {
      const first = g[0]!;
      const chip = h('button', {
        class: `chip f-${gen(first.generalId).faction}`,
        text: `${gen(first.generalId).name} Lv.${first.level} ×${g.length}`,
      });
      chip.addEventListener('click', () => this.select(g.slice(0, this.N).map((c) => c.id)));
      children.push(chip);
    }
    render(this.readyEl, ...children);
  }

  /** Lưới thẻ để chọn — gom theo tướng, trong mỗi tướng chia nhỏ theo level. */
  private drawGrid(): void {
    if (this.loadError) {
      render(this.gridEl, h('div', { class: 'state-msg error', text: `Không tải được thẻ: ${this.loadError}` }));
      return;
    }
    if (!this.cards) {
      render(this.gridEl, h('div', { class: 'state-msg', text: 'Đang tải thẻ…' }));
      return;
    }
    if (!this.list.length) {
      render(this.gridEl, h('div', { class: 'state-msg', text: 'Bạn chưa có thẻ nào để ghép.' }));
      return;
    }
    const filtered = this.filteredCards();
    if (!filtered.length) {
      render(this.gridEl, h('div', { class: 'state-msg', text: 'Không có thẻ phù hợp bộ lọc.' }));
      return;
    }

    const children: Child[] = [];
    for (const g of groupCardsByGeneral(filtered, (id) => gen(id).name, this.fSort, this.N)) {
      const f = gen(g.generalId).faction;
      const head = h(
        'div',
        { class: 'gen-head' },
        h('b', { text: g.name }),
        h('span', { class: 'muted small', text: `${FACTION_LABELS[f]} · ${g.total} thẻ` }),
      );
      if (g.bestReadyLevel) head.appendChild(h('span', { class: 'ready-tag', text: 'Ghép được' }));

      const runs = h('div', { class: 'gen-runs' });
      for (const r of g.runs) {
        const label = h(
          'div',
          { class: 'run-label' },
          `Lv.${r.level} ×${r.cards.length}${r.ready ? ` · đủ ghép${r.cards.length >= 2 * this.N ? ` ${Math.floor(r.cards.length / this.N)} lần` : ''}` : ''}`,
        );
        const cardsBox = h('div', { class: 'run-cards' });
        for (const c of r.cards) cardsBox.appendChild(this.pickButton(c));
        runs.appendChild(h('div', { class: 'lv-run', classOn: { ready: r.ready } }, label, cardsBox));
      }
      children.push(h('div', { class: `gen-group f-${f}` }, head, runs));
    }
    render(this.gridEl, ...children);
    this.syncPicks();
  }

  /** Một ô thẻ bấm được trong lưới chọn. */
  private pickButton(c: CardDto): HTMLElement {
    const b = h('button', { class: 'pick', attrs: { 'data-id': c.id } }, cardEl({ general: gen(c.generalId), level: c.level, extra: 'small' }));
    b.addEventListener('click', () => this.togglePick(c.id));
    return b;
  }

  /** Cập nhật trạng thái chọn/khoá của mọi ô thẻ đang hiện (không dựng lại lưới). */
  private syncPicks(): void {
    const full = this.selected.length >= this.N;
    for (const b of this.gridEl.querySelectorAll<HTMLButtonElement>('.pick[data-id]')) {
      const id = Number(b.dataset.id);
      const on = this.selected.includes(id);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const c = this.cardById(id);
      b.disabled = !on && (!c || !this.selectable(c) || full);
    }
  }

  /** Khung "Đã chọn" bên phải (dính đáy màn hình trên mobile khi đang chọn). */
  private drawSide(): void {
    this.sideEl.classList.toggle('has-sel', this.selected.length > 0);
    this.selCountEl.textContent = String(this.selected.length);

    const slots: Child[] = [];
    if (this.cards) {
      for (let i = 0; i < this.N; i++) {
        const c = this.cardById(this.selected[i] ?? -1);
        if (!c) {
          slots.push(h('div', { class: 'slot empty', text: 'Trống' }));
          continue;
        }
        const b = h('button', { class: 'slot', attrs: { 'data-unpick': c.id, title: 'Bỏ chọn thẻ này' } }, cardEl({ general: gen(c.generalId), level: c.level, extra: 'small' }));
        b.disabled = this.busy;
        b.addEventListener('click', () => this.unpick(c.id));
        slots.push(b);
      }
    }
    render(this.slotsEl, ...slots);
    this.drawPreview();
  }

  private drawPreview(): void {
    if (!this.cards) {
      render(this.previewEl);
      return;
    }
    if (this.previewError) {
      render(this.previewEl, h('p', { class: 'error', text: this.previewError }));
      return;
    }
    if (this.selected.length < this.N) {
      const children: Child[] = [h('p', { class: 'muted', text: `Chọn thêm ${this.N - this.selected.length} thẻ.` })];
      if (this.selected.length > 0) {
        children.push(h('div', { class: 'confirm-area' }, cancelBtn(this.busy, () => this.clearSel())));
      }
      render(this.previewEl, ...children);
      return;
    }
    if (!this.preview) {
      render(
        this.previewEl,
        h('p', { class: 'muted', text: 'Đang tính tỷ lệ…' }),
        h('div', { class: 'confirm-area' }, cancelBtn(this.busy, () => this.clearSel())),
      );
      return;
    }
    render(this.previewEl, ...this.previewNodes(this.preview));
  }

  /** Nội dung khung xem trước khi đã chọn đủ thẻ: tỉ lệ, phân bố khi thất bại, nút ghép. */
  private previewNodes(p: UpgradePreviewDto): Child[] {
    const odds = h(
      'div',
      { class: 'odds' },
      h('div', { class: 'ok' }, 'Thành công ', h('b', { text: pct(p.successBps, p.bpsScale) }), ` → Lv.${p.successLevel}`),
      h('div', { class: 'bad' }, 'Thất bại ', h('b', { text: pct(p.failureBps, p.bpsScale) })),
    );

    const tbody = h('tbody');
    for (const e of p.failureDistribution) {
      tbody.appendChild(
        h('tr', {}, h('td', { text: e.level === p.inputLevel ? `Giữ nguyên Lv.${e.level}` : `Về Lv.${e.level}` }), h('td', { text: pct(e.bps, p.bpsScale) })),
      );
    }

    const confirm = h('div', { class: 'confirm-area' });
    if (this.confirming) {
      const back = h('button', { class: 'btn ghost', attrs: { 'data-no': true }, text: 'Quay lại' });
      back.disabled = this.busy;
      back.addEventListener('click', () => {
        this.confirming = false;
        this.upMsg = '';
        this.drawPreview();
      });
      const yes = h('button', { class: 'btn primary', attrs: { 'data-yes': true }, text: 'Xác nhận ghép' });
      yes.disabled = this.busy;
      yes.addEventListener('click', () => void this.attempt());
      confirm.append(h('p', {}, h('b', { text: 'Xác nhận ghép?' }), ` ${this.N} thẻ sẽ bị tiêu thụ.`), back, ' ', yes);
    } else {
      const go = h('button', { class: 'btn primary', attrs: { 'data-go': true }, text: 'Ghép thẻ' });
      go.disabled = this.busy;
      go.addEventListener('click', () => {
        this.confirming = true;
        this.drawPreview();
      });
      confirm.append(cancelBtn(this.busy, () => this.clearSel()), ' ', go);
    }

    return [
      odds,
      h('h4', { text: 'Nếu thất bại, thẻ nhận được:' }),
      h('table', { class: 'rates' }, tbody),
      h('p', { class: 'warn' }, `⚠ Cả ${this.N} thẻ đầu vào sẽ bị tiêu thụ dù thành công hay thất bại. Bạn luôn nhận lại đúng 1 thẻ ${gen(p.generalId).name}.`),
      h('p', { class: 'muted small', text: 'Tỷ lệ chỉ để tham khảo; server tính lại khi thực hiện.' }),
      confirm,
      h('div', { class: 'up-msg error', attrs: { 'aria-live': 'polite' }, text: this.upMsg }),
    ];
  }

  // ======================= Hành động tab Tướng =======================

  private toggleQuickLevel(lv: number): void {
    if (this.busy) return;
    this.quickLevels = this.quickLevels.includes(lv) ? this.quickLevels.filter((x) => x !== lv) : [...this.quickLevels, lv].sort((a, b) => a - b);
    this.drawQuick();
  }

  private togglePick(id: number): void {
    const sel = this.selected;
    this.select(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  }

  private unpick(id: number): void {
    if (this.busy) return;
    this.select(this.selected.filter((x) => x !== id));
  }

  private clearSel(): void {
    if (this.busy) return;
    this.select([]);
  }

  private select(ids: number[]): void {
    this.selected = ids;
    void this.onSelectionChange();
  }

  /** Mọi thay đổi lựa chọn đều huỷ tỉ lệ cũ và bước xác nhận. */
  private async onSelectionChange(): Promise<void> {
    this.preview = null;
    this.previewError = null;
    this.confirming = false;
    this.upMsg = '';
    this.pendingKey = null;
    this.syncPicks();
    this.drawSide();
    if (this.selected.length === this.N) {
      const ids = [...this.selected];
      try {
        const p = await api.upgradePreview(ids);
        if (this.alive && this.sub === 'tuong' && ids.join() === this.selected.join()) {
          this.preview = p;
          this.drawPreview();
        }
      } catch (e) {
        if (this.alive && this.sub === 'tuong' && ids.join() === this.selected.join()) {
          this.previewError = (e as Error).message;
          this.drawPreview();
        }
      }
    }
  }

  /** Ghép thẻ thật rồi phát hiệu ứng theo kết quả server trả về. */
  private async attempt(): Promise<void> {
    if (this.busy || this.selected.length !== this.N) return;
    this.busy = true;
    this.pendingKey ??= newKey();
    const ids = [...this.selected];
    const inputCard = this.cardById(ids[0]!);
    try {
      const r = await api.upgradeAttempt(ids, this.pendingKey);
      this.pendingKey = null;
      this.selected = [];
      this.preview = null;
      const g = gen(r.resultCard.generalId);
      const caption =
        r.outcome === 'success'
          ? `Thành công! ${g.name} Lv.${r.inputLevel} ×${r.inputCardIds.length} → Lv.${r.resultCard.level}`
          : `Thất bại. ${r.inputCardIds.length} thẻ Lv.${r.inputLevel} → nhận ${g.name} Lv.${r.resultCard.level}`;
      this.busy = false;
      await this.loadCards();
      if (inputCard) await playUpgrade(g, inputCard.level, r.resultCard.level, r.outcome, caption, r.inputCardIds.length);
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') this.pendingKey = null;
      this.busy = false;
      this.confirming = false;
      this.upMsg = err.message;
      this.drawSide();
      if (err.code === 'CARD_CONSUMED' || err.code === 'CARD_NOT_FOUND') {
        this.selected = [];
        await this.loadCards();
      }
    }
  }

  /** Ghép nhanh: server tự ghép liên tục mọi cặp trong các level đã chọn. */
  private async runQuick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.quickKey ??= newKey();
    this.drawQuick();
    try {
      const r = await api.upgradeQuick(this.quickKey, this.quickLevels);
      this.quickKey = null;
      this.quickSummary = summarise(r.results, r.merges, r.successes, r.failures, r.hasMore);
      this.busy = false;
      this.selected = [];
      this.preview = null;
      await this.loadCards();
      this.drawQuick();
    } catch (e) {
      const err = e as ApiError;
      // Lỗi mạng: giữ key để bấm lại là retry an toàn.
      if (err.code !== 'NETWORK') this.quickKey = null;
      this.quickSummary = { kind: 'error', message: err.message };
      this.busy = false;
      if (err.code === 'NOTHING_TO_UPGRADE') await this.loadCards();
      else this.quickConfirming = false;
      this.drawQuick();
    }
  }

  /** Tải lại toàn bộ thẻ và vẽ lại các khối phụ thuộc dữ liệu. */
  private async loadCards(): Promise<void> {
    try {
      const all = await fetchAllCards();
      if (!this.alive) return;
      this.cards = all;
      this.cardsById = new Map(all.map((c) => [c.id, c]));
      this.loadError = null;
      this.selected = this.selected.filter((id) => all.some((c) => c.id === id));
      // Như bản cũ: tải lại thì đóng bước xác nhận và xoá thông báo lỗi ghép.
      this.quickConfirming = false;
      this.confirming = false;
      this.upMsg = '';
    } catch (e) {
      if (this.alive) this.loadError = (e as Error).message;
    }
    if (!this.alive || this.sub !== 'tuong') return;
    this.drawQuick();
    this.drawReady();
    this.drawGrid();
    this.drawSide();
  }
}

/**
 * Tab "Ngọc" của trang Nâng cấp: ghép 2 viên Ngọc CÙNG loại & CÙNG cấp thành 1 viên cấp +1.
 * Dùng chung công thức, tỷ lệ và tài nguyên với thẻ Tướng (`api.gems` trả bảng tỷ lệ `rates`).
 */
class GemTab {
  /** Ngọc luôn ghép 2 → 1 (khác với Tướng dùng `upgradeInputCount`). */
  private static readonly GN = 2;

  readonly el: HTMLElement;
  private alive = true;
  private gems: GemDto[] = [];
  private config: GemConfigDto | null = null;
  private loaded = false;
  private loadError: string | null = null;
  private selected: number[] = [];
  private busy = false;
  private confirming = false;
  private msg = '';
  private quickConfirming = false;
  private quickSummary: QuickSummary | null = null;
  private quickLevels: number[] = [];
  private pendingKey: string | null = null;
  private quickKey: string | null = null;

  private quickEl!: HTMLElement;
  private gridEl!: HTMLElement;
  private sideEl!: HTMLElement;
  private selCountEl!: HTMLElement;
  private slotsEl!: HTMLElement;
  private previewEl!: HTMLElement;

  constructor() {
    this.quickEl = h('div', { class: 'quick' });
    this.gridEl = h('div', { class: 'pick-grid' });
    this.selCountEl = h('span', { class: 'sel-count' });
    this.slotsEl = h('div', { class: 'sel-slots' });
    this.slotsEl.style.gridTemplateColumns = `repeat(${GemTab.GN}, minmax(0, 1fr))`;
    this.previewEl = h('div', { class: 'preview' });
    this.sideEl = h(
      'section',
      { class: 'panel side' },
      h('h3', {}, 'Đã chọn ', this.selCountEl, `/${GemTab.GN}`),
      this.slotsEl,
      this.previewEl,
    );

    const panel = h(
      'section',
      { class: 'panel' },
      h('h2', { text: 'Ghép 2 Ngọc' }),
      h(
        'p',
        { class: 'muted' },
        'Chọn đúng 2 viên Ngọc ',
        h('b', { text: 'cùng loại' }),
        ' và ',
        h('b', { text: 'cùng cấp' }),
        ' (Cấp 1–9) để ghép thành 1 viên cấp cao hơn. Dùng chung công thức, tỷ lệ và tài nguyên với Tướng.',
      ),
      this.quickEl,
    );

    this.el = h('div', {}, panel, h('div', { class: 'two-col upgrade-layout' }, h('section', { class: 'panel' }, this.gridEl), this.sideEl));
  }

  dispose(): void {
    this.alive = false;
  }

  mount(): void {
    this.drawGrid();
    this.drawSide();
    this.drawQuick();
    void this.loadGems();
  }

  // ===== Trạng thái suy ra =====

  private get list(): GemDto[] {
    return this.gems;
  }

  private byId(): Map<number, GemDto> {
    return new Map(this.gems.map((g) => [g.id, g]));
  }

  /** Mọi cấp có thể chọn ghép nhanh (Cấp 1–9; Cấp 10 không ghép tiếp được). */
  private allLevels(): number[] {
    return (this.config?.rates ?? []).map((r) => r.level);
  }

  private pickedGem(i: number): GemDto | undefined {
    return this.byId().get(this.selected[i] ?? -1);
  }

  /** Tỷ lệ ghép của cấp đầu vào đang chọn (null khi chưa chọn đủ / cấp tối đa). */
  private previewRate(): { level: number; successBps: number; failureDistribution: { level: number; bps: number }[] } | null {
    const lv = this.pickedGem(0)?.level;
    return (this.config?.rates ?? []).find((r) => r.level === lv) ?? null;
  }

  /** Nhóm theo loại Ngọc, trong mỗi loại chia nhỏ theo cấp (cao trước). */
  private groups(): { element: GemElement; total: number; runs: { level: number; gems: GemDto[] }[] }[] {
    const byEl = new Map<GemElement, Map<number, GemDto[]>>();
    for (const g of this.gems) {
      const lvls = byEl.get(g.element) ?? new Map<number, GemDto[]>();
      lvls.set(g.level, [...(lvls.get(g.level) ?? []), g]);
      byEl.set(g.element, lvls);
    }
    return (this.config?.elements ?? [])
      .map((element) => {
        const lvls = byEl.get(element);
        const runs = lvls ? [...lvls.entries()].sort((a, b) => b[0] - a[0]).map(([level, list]) => ({ level, gems: list })) : [];
        return { element, total: runs.reduce((s, r) => s + r.gems.length, 0), runs };
      })
      .filter((g) => g.total > 0);
  }

  private quickPairs(): number {
    const sel = new Set(this.quickLevels);
    return this.groups()
      .flatMap((g) => g.runs)
      .filter((r) => sel.has(r.level))
      .reduce((s, r) => s + Math.floor(r.gems.length / GemTab.GN), 0);
  }

  private quickRates(): { level: number; successBps: number; failureDistribution: { level: number; bps: number }[] }[] {
    const sel = new Set(this.quickLevels);
    return (this.config?.rates ?? []).filter((r) => sel.has(r.level));
  }

  private selectable(g: GemDto): boolean {
    if (g.level >= MAX_LEVEL) return false;
    const first = this.pickedGem(0);
    if (!first) return true;
    return g.element === first.element && g.level === first.level;
  }

  // ===== Vẽ =====

  private drawQuick(): void {
    if (!this.loaded) {
      render(this.quickEl);
      return;
    }
    const pairs = this.quickPairs();
    const runBtn = h('button', { class: 'btn primary', text: '⚡ Ghép nhanh' });
    runBtn.disabled = this.busy || this.quickLevels.length === 0 || pairs === 0 || this.quickConfirming;
    runBtn.addEventListener('click', () => {
      this.quickConfirming = true;
      this.drawQuick();
    });

    const head = h(
      'div',
      { class: 'quick-head' },
      runBtn,
      h(
        'span',
        { class: 'muted small' },
        pairs > 0
          ? `${pairs} cặp Ngọc có thể ghép ngay. Tự ghép liên tục mọi cặp 2 viên cùng loại, cùng cấp trong các mức đã chọn.`
          : 'Chưa có cặp Ngọc nào trong các mức đã chọn để ghép nhanh.',
      ),
    );

    const levels = h('div', { class: 'quick-levels' }, h('span', { class: 'muted small', text: 'Cấp ghép nhanh:' }));
    for (const lv of this.allLevels()) {
      const on = this.quickLevels.includes(lv);
      const label = h('label', { class: 'lv-chk', classOn: { on } });
      const cb = h('input', { attrs: { type: 'checkbox' } });
      cb.checked = on;
      cb.disabled = this.busy;
      cb.addEventListener('change', () => {
        if (this.busy) return;
        this.quickLevels = this.quickLevels.includes(lv) ? this.quickLevels.filter((x) => x !== lv) : [...this.quickLevels, lv].sort((a, b) => a - b);
        this.drawQuick();
      });
      label.append(cb, `Cấp ${lv}`);
      levels.appendChild(label);
    }

    const box = h('div', { class: 'quick-box' }, head, levels);
    if (this.quickConfirming) box.appendChild(this.buildQuickConfirm());
    if (this.quickSummary) box.appendChild(this.buildQuickSummary(this.quickSummary));
    render(this.quickEl, box);
  }

  private buildQuickConfirm(): HTMLElement {
    const table = h(
      'table',
      { class: 'rates' },
      h('thead', {}, h('tr', {}, h('td', { text: 'Ghép' }), h('td', { text: 'Thành công' }), h('td', { text: 'Giữ nguyên' }), h('td', { text: 'Tụt' }))),
    );
    const tbody = h('tbody');
    for (const r of this.quickRates()) {
      const fail = 10000 - r.successBps;
      const keep = r.failureDistribution.find((e) => e.level === r.level)?.bps ?? 0;
      tbody.appendChild(
        h(
          'tr',
          {},
          h('td', { text: `Cấp ${r.level} → ${r.level + 1}` }),
          h('td', { text: pct(r.successBps) }),
          h('td', { text: pct((fail * keep) / 10000) }),
          h('td', { text: pct(fail - (fail * keep) / 10000) }),
        ),
      );
    }
    table.appendChild(tbody);

    const no = h('button', { class: 'btn ghost', text: 'Huỷ' });
    no.addEventListener('click', () => {
      this.quickConfirming = false;
      this.drawQuick();
    });
    const yes = h('button', { class: 'btn primary' });
    yes.disabled = this.busy;
    yes.textContent = this.busy ? 'Đang ghép…' : 'Xác nhận ghép nhanh';
    yes.addEventListener('click', () => void this.runQuick());

    return h(
      'div',
      { class: 'quick-confirm' },
      table,
      h(
        'p',
        { class: 'warn' },
        '⚠ Mỗi lần ghép tiêu thụ 2 viên Ngọc, có thể thất bại hoặc tụt cấp. Ngọc mới tạo ra thuộc mức đã chọn sẽ được ghép tiếp. Ngọc ở mức không chọn không bị đụng tới.',
      ),
      h('div', { class: 'quick-actions' }, no, yes),
    );
  }

  private buildQuickSummary(s: QuickSummary): HTMLElement {
    const box = h('div', { class: 'quick-summary', attrs: { 'aria-live': 'polite' } });
    if (s.kind === 'error') {
      box.appendChild(h('span', { class: 'error', text: s.message }));
      return box;
    }
    box.append(
      h('b', { text: `Đã ghép ${s.merges} lần:` }),
      ' ',
      h('span', { class: 'ok', text: `${s.successes} thành công` }),
      ', ',
      h('span', { class: 'bad', text: `${s.failures} thất bại` }),
      '. Cấp cao nhất đạt được: ',
      h('b', { text: `Cấp ${s.best}` }),
      '.',
    );
    box.appendChild(h('div', { class: 'small muted', text: s.byLevel.map(([lv, b]) => `Cấp ${lv}: ${b.ok}/${b.n} thành công`).join(' · ') }));
    if (s.hasMore) box.appendChild(h('div', { class: 'small', text: 'Vẫn còn cặp có thể ghép — bấm Ghép nhanh lần nữa.' }));
    return box;
  }

  private drawGrid(): void {
    if (this.loadError) {
      render(this.gridEl, h('div', { class: 'state-msg error', text: `Không tải được Ngọc: ${this.loadError}` }));
      return;
    }
    if (!this.loaded) {
      render(this.gridEl, h('div', { class: 'state-msg', text: 'Đang tải Ngọc…' }));
      return;
    }
    if (!this.gems.length) {
      render(this.gridEl, h('div', { class: 'state-msg', text: 'Bạn chưa có viên Ngọc nào. Quay thẻ để nhận Ngọc rớt kèm.' }));
      return;
    }

    const children: Child[] = [];
    for (const grp of this.groups()) {
      const head = h(
        'div',
        { class: 'gen-head' },
        h('b', { text: `Ngọc ${GEM_ELEMENT_LABELS[grp.element]}` }),
        h('span', { class: 'muted small', text: `Ngũ Hành · ${grp.total} viên` }),
      );
      if (grp.runs.some((r) => r.gems.length >= GemTab.GN && r.level < MAX_LEVEL)) head.appendChild(h('span', { class: 'ready-tag', text: 'Ghép được' }));

      const runs = h('div', { class: 'gen-runs' });
      for (const r of grp.runs) {
        const ready = r.gems.length >= GemTab.GN && r.level < MAX_LEVEL;
        const label = h(
          'div',
          { class: 'run-label' },
          `Cấp ${r.level} ×${r.gems.length}${ready ? ` · đủ ghép${r.gems.length >= 2 * GemTab.GN ? ` ${Math.floor(r.gems.length / GemTab.GN)} lần` : ''}` : ''}`,
        );
        const cardsBox = h('div', { class: 'run-cards' });
        for (const g of r.gems) {
          const b = h('button', { class: 'pick', attrs: { 'data-id': g.id } }, gemCardEl({ element: g.element, level: g.level }));
          b.addEventListener('click', () => this.togglePick(g));
          cardsBox.appendChild(b);
        }
        runs.appendChild(h('div', { class: 'lv-run', classOn: { ready } }, label, cardsBox));
      }
      children.push(h('div', { class: `gen-group e-${grp.element}` }, head, runs));
    }
    render(this.gridEl, ...children);
    this.syncPicks();
  }

  private syncPicks(): void {
    const full = this.selected.length >= GemTab.GN;
    const byId = this.byId();
    for (const b of this.gridEl.querySelectorAll<HTMLButtonElement>('.pick[data-id]')) {
      const id = Number(b.dataset.id);
      const on = this.selected.includes(id);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const g = byId.get(id);
      b.disabled = !on && (!g || !this.selectable(g) || full);
    }
  }

  private drawSide(): void {
    this.sideEl.classList.toggle('has-sel', this.selected.length > 0);
    this.selCountEl.textContent = String(this.selected.length);

    const slots: Child[] = [];
    for (let i = 0; i < GemTab.GN; i++) {
      const g = this.pickedGem(i);
      if (!g) {
        slots.push(h('div', { class: 'slot empty', text: 'Trống' }));
        continue;
      }
      const b = h('button', { class: 'slot', attrs: { title: 'Bỏ chọn viên Ngọc này' } }, gemCardEl({ element: g.element, level: g.level }));
      b.disabled = this.busy;
      b.addEventListener('click', () => this.togglePick(g));
      slots.push(b);
    }
    render(this.slotsEl, ...slots);
    this.drawPreview();
  }

  private drawPreview(): void {
    if (this.selected.length < GemTab.GN) {
      const children: Child[] = [h('p', { class: 'muted', text: `Chọn thêm ${GemTab.GN - this.selected.length} viên Ngọc cùng loại & cùng cấp.` })];
      if (this.selected.length > 0) {
        const cancel = h('button', { class: 'btn ghost', text: 'Huỷ' });
        cancel.disabled = this.busy;
        cancel.addEventListener('click', () => this.clearSel());
        children.push(h('div', { class: 'confirm-area' }, cancel));
      }
      render(this.previewEl, ...children);
      return;
    }

    const r = this.previewRate();
    if (!r) {
      render(this.previewEl, h('p', { class: 'warn', text: 'Ngọc Cấp 10 đã ở mức tối đa — không ghép tiếp được.' }));
      return;
    }
    const first = this.pickedGem(0)!;
    const odds = h(
      'div',
      { class: 'odds' },
      h('div', { class: 'ok' }, 'Thành công ', h('b', { text: pct(r.successBps) }), ` → Cấp ${r.level + 1}`),
      h('div', { class: 'bad' }, 'Thất bại ', h('b', { text: pct(10000 - r.successBps) })),
    );

    const tbody = h('tbody');
    for (const e of r.failureDistribution) {
      tbody.appendChild(h('tr', {}, h('td', { text: e.level === r.level ? `Giữ nguyên Cấp ${e.level}` : `Về Cấp ${e.level}` }), h('td', { text: pct(e.bps) })));
    }

    const confirm = h('div', { class: 'confirm-area' });
    if (this.confirming) {
      const back = h('button', { class: 'btn ghost', text: 'Quay lại' });
      back.disabled = this.busy;
      back.addEventListener('click', () => {
        this.confirming = false;
        this.msg = '';
        this.drawPreview();
      });
      const yes = h('button', { class: 'btn primary', text: 'Xác nhận ghép' });
      yes.disabled = this.busy;
      yes.addEventListener('click', () => void this.attempt());
      confirm.append(h('p', {}, h('b', { text: 'Xác nhận ghép?' }), ' 2 viên Ngọc sẽ bị tiêu thụ.'), back, ' ', yes);
    } else {
      const cancel = h('button', { class: 'btn ghost', text: 'Huỷ' });
      cancel.disabled = this.busy;
      cancel.addEventListener('click', () => this.clearSel());
      const go = h('button', { class: 'btn primary', text: 'Ghép Ngọc' });
      go.disabled = this.busy;
      go.addEventListener('click', () => {
        this.confirming = true;
        this.drawPreview();
      });
      confirm.append(cancel, ' ', go);
    }

    render(
      this.previewEl,
      odds,
      h('h4', { text: 'Nếu thất bại, Ngọc nhận được:' }),
      h('table', { class: 'rates' }, tbody),
      h('p', { class: 'warn' }, `⚠ Cả 2 viên Ngọc đầu vào sẽ bị tiêu thụ dù thành công hay thất bại. Bạn luôn nhận lại đúng 1 viên Ngọc ${GEM_ELEMENT_LABELS[first.element]}.`),
      h('p', { class: 'muted small', text: 'Tỷ lệ chỉ để tham khảo; server tính lại khi thực hiện.' }),
      confirm,
      h('div', { class: 'up-msg error', attrs: { 'aria-live': 'polite' }, text: this.msg }),
    );
  }

  // ===== Hành động =====

  private togglePick(g: GemDto): void {
    if (this.busy) return;
    this.msg = '';
    this.confirming = false;
    this.pendingKey = null;
    const sel = this.selected;
    this.selected = sel.includes(g.id) ? sel.filter((x) => x !== g.id) : sel.length < GemTab.GN ? [...sel, g.id] : sel;
    this.syncPicks();
    this.drawSide();
  }

  private clearSel(): void {
    if (this.busy) return;
    this.selected = [];
    this.confirming = false;
    this.msg = '';
    this.pendingKey = null;
    this.syncPicks();
    this.drawSide();
  }

  private async attempt(): Promise<void> {
    if (this.busy || this.selected.length !== GemTab.GN) return;
    this.busy = true;
    this.pendingKey ??= newKey();
    const ids = [...this.selected];
    try {
      const r = await api.gemMerge(ids, this.pendingKey);
      this.pendingKey = null;
      this.selected = [];
      this.confirming = false;
      const caption =
        r.outcome === 'success'
          ? `Thành công! ${GEM_ELEMENT_LABELS[r.element]} Cấp ${r.inputLevel} ×2 → Cấp ${r.resultGem.level}`
          : `Thất bại. 2 viên ${GEM_ELEMENT_LABELS[r.element]} Cấp ${r.inputLevel} → nhận Cấp ${r.resultGem.level}`;
      this.msg = caption;
      this.busy = false;
      await this.loadGems();
      // Hiệu ứng ghép Ngọc giống hệt nâng cấp Tướng (2 viên lao vào tâm → loé sáng → viên kết quả).
      await playGemUpgrade(r.element, r.inputLevel, r.resultGem.level, r.outcome, caption, r.inputGemIds.length);
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') this.pendingKey = null;
      this.busy = false;
      this.confirming = false;
      this.msg = err.message;
      this.drawSide();
      if (err.code === 'GEM_CONSUMED' || err.code === 'GEM_NOT_FOUND') {
        this.selected = [];
        await this.loadGems();
      }
    }
  }

  private async runQuick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.quickKey ??= newKey();
    this.drawQuick();
    try {
      const r = await api.gemMergeQuick(this.quickKey, this.quickLevels);
      this.quickKey = null;
      this.quickSummary = summarise(r.results, r.merges, r.successes, r.failures, r.hasMore);
      this.busy = false;
      this.selected = [];
      await this.loadGems();
      this.drawQuick();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') this.quickKey = null;
      this.quickSummary = { kind: 'error', message: err.message };
      this.busy = false;
      if (err.code === 'NOTHING_TO_UPGRADE') await this.loadGems();
      else this.quickConfirming = false;
      this.drawQuick();
    }
  }

  private async loadGems(): Promise<void> {
    try {
      const dto = await api.gems();
      if (!this.alive) return;
      this.gems = dto.gems;
      this.config = dto.config;
      this.loaded = true;
      this.loadError = null;
      this.selected = this.selected.filter((id) => dto.gems.some((g) => g.id === id));
      // Mặc định chọn sẵn Cấp 1 → mức ghép nhanh của Tướng (mặc định 5).
      if (!this.quickLevels.length) {
        const max = state.config?.quickUpgradeMaxLevel ?? 5;
        this.quickLevels = dto.config.rates.map((r) => r.level).filter((lv) => lv <= max);
      }
    } catch (e) {
      if (this.alive) this.loadError = (e as Error).message;
    }
    if (!this.alive) return;
    this.drawGrid();
    this.drawSide();
    this.drawQuick();
  }
}
