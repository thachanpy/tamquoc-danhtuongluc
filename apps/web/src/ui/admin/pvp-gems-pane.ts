import {
  GEM_ELEMENT_LABELS,
  GEM_STAT_LABELS,
  PVP_GEM_STAT_KEYS,
  type GemElement,
  type PvpGemAdminDto,
  type PvpGemStats,
} from '@tq/shared';
import { gemStatText, gemUrl, initials } from '../../assets/art.ts';
import { api } from '../../services/api.ts';
import { clear, h } from '../dom.ts';
import { loadBlock, msgBox, type Load, type Msg } from './shared.ts';

/**
 * Tab "Cấu hình Ngọc" (mục 6.7): bảng cấu hình 5 hệ Ngọc Ngũ Hành.
 *
 * Mỗi hệ có 2 chỉ số, mỗi chỉ số nhập giá trị tại Cấp 1 và Cấp 10; server nội suy tuyến tính
 * các cấp ở giữa và nạp lại `PvpConfigRegistry` nên trận PvP tạo sau khi lưu áp dụng ngay.
 *
 * Bản Phaser không dùng reactive của Solid: mỗi dòng Ngọc dựng DOM MỘT LẦN (giữ danh tính thẻ
 * `<input>` để không mất focus khi đang gõ), sau đó chỉ cập nhật tại chỗ nhãn "Chưa lưu",
 * nút Lưu và dòng quy đổi chỉ số.
 */

/** Một dòng Ngọc: bản nháp + các phần tử cần cập nhật tại chỗ. */
type GemRow = {
  draft: PvpGemAdminDto;
  saving: boolean;
  dirty: boolean;
  /** Nhãn "Chưa lưu" (ẩn/hiện theo `dirty`). */
  tag: HTMLElement;
  saveBtn: HTMLButtonElement;
  /** Dòng quy đổi "Cấp 1 ≈ … · Cấp 10 ≈ …" của chỉ số 1 và 2. */
  help: [HTMLElement, HTMLElement];
  /** Gán lại giá trị ô nhập từ bản nháp (dùng sau khi server trả về bản đã chuẩn hoá). */
  sync: (() => void)[];
};

/** Chỉ số cộng thêm (không phải bps) hiển thị theo đơn vị gốc. */
const intOr0 = (v: string): number => Math.max(0, Math.floor(Number(v) || 0));

/** Ảnh viên Ngọc thu nhỏ; thiếu ảnh thì lộ chữ viết tắt làm nền. */
function gemThumb(element: GemElement, level: number): HTMLElement {
  const img = h('img', { attrs: { src: gemUrl(element, level), alt: '', loading: 'lazy', decoding: 'async' } });
  img.addEventListener('error', () => img.remove());
  return h(
    'span',
    { class: 'cfg-thumb gem', attrs: { 'aria-hidden': 'true' } },
    h('span', { class: 'cfg-thumb-ini', text: initials(GEM_ELEMENT_LABELS[element]) }),
    img,
  );
}

export class PvpGemsPane {
  readonly el: HTMLElement;

  private readonly opts: { alive: () => boolean };

  private loaded = false;
  private seq = 0;
  private items: PvpGemAdminDto[] = [];
  private rows: GemRow[] = [];
  private listState: Load = { kind: 'loading' };
  private notice: Msg = null;

  private readonly msgEl: HTMLElement;
  private readonly bodyEl: HTMLElement;

  constructor(opts: { alive: () => boolean }) {
    this.opts = opts;

    const toolbar = h(
      'div',
      { class: 'cfg-toolbar' },
      h(
        'span',
        { class: 'muted small' },
        'Mỗi hệ Ngọc có 2 chỉ số. Nhập giá trị tại ',
        h('b', { text: 'Cấp 1' }),
        ' và ',
        h('b', { text: 'Cấp 10' }),
        '; server nội suy tuyến tính các cấp ở giữa.',
      ),
    );

    this.msgEl = h('div', { class: 'adm-msg', attrs: { 'aria-live': 'polite' } });
    this.bodyEl = h('div', {});

    this.el = h(
      'div',
      {},
      toolbar,
      this.msgEl,
      this.bodyEl,
      h('div', {
        class: 'cfg-help muted small',
        text: 'Lưu ý: cấp Ngọc tối đa là 10. Nếu chỉ số bị đổi loại, toàn bộ đường cong 10 cấp được nội suy lại từ 2 mốc mới.',
      }),
    );

    void this.load();
  }

  /** Gọi khi người dùng mở tab (dữ liệu đã nạp ngay khi pane được tạo). */
  ensureLoaded(): void {
    if (!this.loaded) void this.load();
  }

  private say(text: string, ok = true): void {
    this.notice = text ? { ok, parts: [text] } : null;
    this.drawNotice();
  }

  private drawNotice(): void {
    clear(this.msgEl);
    const box = msgBox(this.notice);
    if (box) this.msgEl.appendChild(box);
  }

  private async load(): Promise<void> {
    this.loaded = true;
    const my = ++this.seq;
    this.listState = { kind: 'loading' };
    this.drawList();
    try {
      const dto = await api.admin.pvpGems();
      if (!this.opts.alive() || my !== this.seq) return;
      this.items = dto.items;
      this.listState = { kind: 'ready' };
    } catch (e) {
      if (!this.opts.alive() || my !== this.seq) return;
      this.listState = { kind: 'error', text: (e as Error).message };
    }
    this.drawList();
  }

  // ======================= Vẽ danh sách =======================

  private drawList(): void {
    this.drawNotice();
    clear(this.bodyEl);
    this.rows = [];
    if (this.listState.kind !== 'ready' || this.items.length === 0) {
      this.bodyEl.appendChild(loadBlock(this.listState, 'Chưa có cấu hình Ngọc.'));
      return;
    }
    const wrap = h('div', { class: 'cfg-gems' });
    for (const g of this.items) {
      const row = this.createRow(g);
      this.rows.push(row);
      wrap.appendChild(row.el);
    }
    this.bodyEl.appendChild(wrap);
  }

  private createRow(dto: PvpGemAdminDto): GemRow & { el: HTMLElement } {
    const element = dto.element;

    const tag = h('span', { class: 'tag warn-tag', text: 'Chưa lưu' });
    tag.hidden = true;
    const saveBtn = h('button', { class: 'btn primary small', text: 'Lưu' });
    saveBtn.disabled = true;

    const head = h(
      'div',
      { class: 'cfg-gem-head' },
      h('span', { class: 'cfg-gem-art' }, gemThumb(element, 1), gemThumb(element, 10)),
      h('b', { class: `cfg-fac e-${element}`, text: GEM_ELEMENT_LABELS[element] }),
      h('span', { class: 'muted small', text: 'Cấp 1 → 10' }),
      tag,
      saveBtn,
    );

    const row: GemRow & { el: HTMLElement } = {
      draft: { ...dto },
      saving: false,
      dirty: false,
      tag,
      saveBtn,
      help: [h('div', { class: 'cfg-help muted small' }), h('div', { class: 'cfg-help muted small' })],
      sync: [],
      el: h('div', { class: 'cfg-gem', attrs: { 'data-gem': element } }),
    };

    const body = h('div', { class: 'cfg-gem-body' });
    body.append(...this.statField(row, 1), ...this.statField(row, 2));
    row.el.append(head, body);

    saveBtn.addEventListener('click', () => void this.save(row));
    this.drawRow(row);
    return row;
  }

  /**
   * Dựng 4 ô của một chỉ số: loại chỉ số, giá trị Cấp 1, giá trị Cấp 10 và dòng quy đổi.
   * Ghi thẳng vào `row.draft` (không tạo object mới) để giữ nguyên thẻ `<input>` đang gõ.
   */
  private statField(row: GemRow, idx: 1 | 2): HTMLElement[] {
    const d = row.draft;
    const typeKey: 'stat1Type' | 'stat2Type' = idx === 1 ? 'stat1Type' : 'stat2Type';
    const minKey: 'stat1Min' | 'stat2Min' = idx === 1 ? 'stat1Min' : 'stat2Min';
    const maxKey: 'stat1Max' | 'stat2Max' = idx === 1 ? 'stat1Max' : 'stat2Max';

    const sel = h('select', {}, ...PVP_GEM_STAT_KEYS.map((k) => h('option', { attrs: { value: k }, text: GEM_STAT_LABELS[k] })));
    sel.value = d[typeKey];
    sel.addEventListener('change', () => {
      const v = sel.value as keyof PvpGemStats;
      if (idx === 1) this.update(row, { stat1Type: v });
      else this.update(row, { stat2Type: v });
    });
    row.sync.push(() => (sel.value = row.draft[typeKey]));

    const minInput = h('input', { attrs: { type: 'number', min: 0, step: 1, inputmode: 'numeric', 'aria-label': `Cấp 1 chỉ số ${idx}` } });
    minInput.value = String(d[minKey]);
    minInput.addEventListener('input', () => {
      const v = intOr0(minInput.value);
      if (idx === 1) this.update(row, { stat1Min: v });
      else this.update(row, { stat2Min: v });
    });
    row.sync.push(() => (minInput.value = String(row.draft[minKey])));

    const maxInput = h('input', { attrs: { type: 'number', min: 0, step: 1, inputmode: 'numeric', 'aria-label': `Cấp 10 chỉ số ${idx}` } });
    maxInput.value = String(d[maxKey]);
    maxInput.addEventListener('input', () => {
      const v = intOr0(maxInput.value);
      if (idx === 1) this.update(row, { stat1Max: v });
      else this.update(row, { stat2Max: v });
    });
    row.sync.push(() => (maxInput.value = String(row.draft[maxKey])));

    return [
      h('label', { class: 'cfg-field' }, h('span', { text: `Chỉ số ${idx}` }), sel),
      h('label', { class: 'cfg-field' }, h('span', { text: 'Cấp 1' }), minInput),
      h('label', { class: 'cfg-field' }, h('span', { text: 'Cấp 10' }), maxInput),
      idx === 1 ? row.help[0] : row.help[1],
    ];
  }

  /** Ghi bản nháp + đánh dấu "chưa lưu" rồi vẽ lại đúng dòng đó. */
  private update(row: GemRow, p: Partial<PvpGemAdminDto>): void {
    Object.assign(row.draft, p);
    row.dirty = true;
    this.drawRow(row);
  }

  private drawRow(row: GemRow): void {
    const d = row.draft;
    row.tag.hidden = !row.dirty;
    row.saveBtn.disabled = row.saving || !row.dirty;
    row.help[0].textContent = `Cấp 1 ≈ ${gemStatText(d.stat1Type, d.stat1Min)} · Cấp 10 ≈ ${gemStatText(d.stat1Type, d.stat1Max)}`;
    row.help[1].textContent = `Cấp 1 ≈ ${gemStatText(d.stat2Type, d.stat2Min)} · Cấp 10 ≈ ${gemStatText(d.stat2Type, d.stat2Max)}`;
  }

  private async save(row: GemRow): Promise<void> {
    if (row.saving) return;
    const d = row.draft;
    if (d.stat1Min > d.stat1Max || d.stat2Min > d.stat2Max) {
      this.say('Giá trị Cấp 1 không được lớn hơn Cấp 10.', false);
      return;
    }
    row.saving = true;
    this.drawRow(row);
    try {
      const saved = await api.admin.pvpGemUpdate(d);
      if (!this.opts.alive()) return;
      row.draft = { ...saved };
      for (const f of row.sync) f();
      row.saving = false;
      row.dirty = false;
      this.say(`Đã lưu Ngọc hệ ${GEM_ELEMENT_LABELS[saved.element]} — áp dụng ngay cho trận PvP mới.`);
    } catch (e) {
      if (!this.opts.alive()) return;
      row.saving = false;
      this.say((e as Error).message, false);
    }
    this.drawRow(row);
  }
}
