import {
  GACHA_ADMIN_MAX_LEVEL,
  GEM_ELEMENTS,
  GEM_ELEMENT_LABELS,
  MIN_LEVEL,
  type GachaRatesAdminDto,
  type GemElement,
  type WeightEntry,
} from '@tq/shared';
import { api } from '../../services/api.ts';
import { clear, h } from '../dom.ts';
import { loadBlock, msgBox, type Load, type Msg } from './shared.ts';

/**
 * Tab "Tỉ lệ quay" (mục 3.x): chỉnh bảng tỉ lệ CẤP TƯỚNG khi quay (Lv1–Lv9) và cấu hình RỚT NGỌC
 * (tỉ lệ rớt mỗi lượt + trọng số 5 hệ). Server buộc tổng mỗi bảng bằng 100%, lưu DB rồi nạp lại
 * cache nên lượt quay kế tiếp áp dụng ngay, không cần khởi động lại API.
 *
 * Bản nháp được MUTATE trực tiếp và form chỉ dựng lại khi nạp/lưu/hoàn tác — nhờ vậy gõ số
 * không mất focus; mỗi phím gõ chỉ cập nhật dòng quy đổi % và tổng tại chỗ.
 */

/** Bản nháp đang sửa trên form. */
type Draft = {
  levelRates: WeightEntry[];
  gemDropBps: number;
  gemTypeWeights: Record<GemElement, number>;
};

/** Giá trị nguyên không âm (ô nhập số để trống ⇒ 0). */
const intOr0 = (v: string): number => Math.max(0, Math.floor(Number(v) || 0));

export class GachaRatesPane {
  readonly el: HTMLElement;

  private readonly opts: { alive: () => boolean };

  private loaded = false;
  private seq = 0;
  private listState: Load = { kind: 'loading' };
  private notice: Msg = null;
  private draft: Draft | null = null;
  private levelScale = 100_000;
  private bpsScale = 10_000;
  private updatedAt: string | null = null;
  private dirty = false;
  private saving = false;

  private readonly msgEl: HTMLElement;
  private readonly updatedEl: HTMLElement;
  private readonly bodyEl: HTMLElement;

  // --- phần tử cập nhật tại chỗ khi gõ
  private readonly levelPct: HTMLElement[] = [];
  private levelTotalEl: HTMLElement | null = null;
  private dropPct: HTMLElement | null = null;
  private readonly weightPct = new Map<GemElement, HTMLElement>();
  private weightTotalEl: HTMLElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;
  private undoBtn: HTMLButtonElement | null = null;

  constructor(opts: { alive: () => boolean }) {
    this.opts = opts;

    this.updatedEl = h('span', { class: 'muted small' });
    const toolbar = h(
      'div',
      { class: 'cfg-toolbar' },
      h(
        'span',
        { class: 'muted small' },
        'Nhập tỉ lệ theo đơn vị gốc; ô bên dưới quy đổi ra %. Tổng tỉ lệ cấp tướng và tổng trọng số 5 hệ đều ',
        h('b', { text: 'phải bằng 100%' }),
        '.',
      ),
      this.updatedEl,
    );

    this.msgEl = h('div', { class: 'adm-msg', attrs: { 'aria-live': 'polite' } });
    this.bodyEl = h('div', {});

    this.el = h('div', {}, toolbar, this.msgEl, this.bodyEl);

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
    this.drawBody();
    try {
      const dto = await api.admin.gachaRates();
      if (!this.opts.alive() || my !== this.seq) return;
      this.apply(dto);
      this.listState = { kind: 'ready' };
    } catch (e) {
      if (!this.opts.alive() || my !== this.seq) return;
      this.listState = { kind: 'error', text: (e as Error).message };
    }
    this.drawBody();
  }

  /** Nhận dữ liệu server: ghi bản nháp mới và xoá cờ "chưa lưu". */
  private apply(dto: GachaRatesAdminDto): void {
    this.draft = {
      levelRates: dto.levelRates.map((e) => ({ ...e })),
      gemDropBps: dto.gemDropBps,
      gemTypeWeights: { ...dto.gemTypeWeights },
    };
    this.levelScale = dto.levelScale;
    this.bpsScale = dto.bpsScale;
    this.updatedAt = dto.updatedAt;
    this.dirty = false;
  }

  private levelTotal(): number {
    return this.draft?.levelRates.reduce((s, e) => s + e.bps, 0) ?? 0;
  }

  private weightTotal(): number {
    const d = this.draft;
    return d ? GEM_ELEMENTS.reduce((s, e) => s + (d.gemTypeWeights[e] ?? 0), 0) : 0;
  }

  private valid(): boolean {
    return !!this.draft && this.levelTotal() === this.levelScale && this.weightTotal() === this.bpsScale;
  }

  /** Tỉ lệ % từ đơn vị gốc, bỏ số 0 thừa ở cuối. */
  private pctText(bps: number, scale: number): string {
    return `${Number(((bps / scale) * 100).toFixed(4))}%`;
  }

  private async save(): Promise<void> {
    const d = this.draft;
    if (!d || this.saving) return;
    if (!this.valid()) {
      this.say('Tổng mỗi bảng tỉ lệ phải bằng 100% mới lưu được.', false);
      return;
    }
    this.saving = true;
    this.refresh();
    try {
      const saved = await api.admin.gachaRatesUpdate({ levelRates: d.levelRates, gemDropBps: d.gemDropBps, gemTypeWeights: d.gemTypeWeights });
      if (!this.opts.alive()) return;
      this.apply(saved);
      this.say('Đã lưu tỉ lệ quay — áp dụng ngay cho lượt quay kế tiếp.');
    } catch (e) {
      if (!this.opts.alive()) return;
      this.say((e as Error).message, false);
    } finally {
      this.saving = false;
    }
    if (this.opts.alive()) this.drawBody();
  }

  // ======================= Vẽ form =======================

  private drawBody(): void {
    this.drawNotice();
    this.updatedEl.textContent = this.updatedAt ? `Cập nhật: ${new Date(this.updatedAt).toLocaleString('vi-VN')}` : '';
    clear(this.bodyEl);
    this.levelPct.length = 0;
    this.weightPct.clear();
    this.levelTotalEl = null;
    this.weightTotalEl = null;
    this.dropPct = null;
    this.saveBtn = null;
    this.undoBtn = null;

    const d = this.draft;
    if (this.listState.kind !== 'ready' || !d) {
      this.bodyEl.appendChild(loadBlock(this.listState, 'Chưa có cấu hình tỉ lệ quay.'));
      return;
    }

    // --- Bảng tỉ lệ cấp tướng
    const levelGrid = h('div', { class: 'cfg-grid' });
    for (const e of d.levelRates) {
      const input = h('input', { attrs: { type: 'number', min: 0, step: 1, inputmode: 'numeric', 'aria-label': `Tỉ lệ Lv${e.level}` } });
      input.value = String(e.bps);
      input.addEventListener('input', () => this.setLevel(e.level, intOr0(input.value)));
      const pctEl = h('span', { class: 'muted small' });
      this.levelPct.push(pctEl);
      levelGrid.appendChild(h('label', { class: 'cfg-field' }, h('span', { text: `Lv${e.level}` }), input, pctEl));
    }
    this.levelTotalEl = h('div', { class: 'cfg-help muted small' });

    // --- Rớt Ngọc + trọng số 5 hệ
    const dropInput = h('input', { attrs: { type: 'number', min: 0, max: this.bpsScale, step: 1, inputmode: 'numeric', 'aria-label': 'Tỉ lệ rớt Ngọc' } });
    dropInput.value = String(d.gemDropBps);
    dropInput.addEventListener('input', () => this.setDrop(intOr0(dropInput.value)));
    this.dropPct = h('span', { class: 'muted small' });
    const gemGrid = h(
      'div',
      { class: 'cfg-grid' },
      h('label', { class: 'cfg-field' }, h('span', { text: 'Tỉ lệ rớt mỗi lượt quay' }), dropInput, this.dropPct),
    );
    for (const element of GEM_ELEMENTS) {
      const input = h('input', { attrs: { type: 'number', min: 0, step: 1, inputmode: 'numeric', 'aria-label': `Trọng số hệ ${GEM_ELEMENT_LABELS[element]}` } });
      input.value = String(d.gemTypeWeights[element]);
      input.addEventListener('input', () => this.setWeight(element, intOr0(input.value)));
      const pctEl = h('span', { class: 'muted small' });
      this.weightPct.set(element, pctEl);
      gemGrid.appendChild(
        h(
          'label',
          { class: 'cfg-field' },
          h('span', {}, 'Trọng số hệ ', h('b', { class: `cfg-fac e-${element}`, text: GEM_ELEMENT_LABELS[element] })),
          input,
          pctEl,
        ),
      );
    }
    this.weightTotalEl = h('div', { class: 'cfg-help muted small' });

    // --- Nút lưu / hoàn tác
    this.saveBtn = h('button', { class: 'btn primary', text: 'Lưu tỉ lệ quay' });
    this.saveBtn.addEventListener('click', () => void this.save());
    this.undoBtn = h('button', { class: 'btn ghost', text: 'Hoàn tác' });
    this.undoBtn.addEventListener('click', () => void this.load());
    const actions = h(
      'div',
      { class: 'cfg-toolbar' },
      this.saveBtn,
      this.undoBtn,
      h('span', {
        class: 'muted small',
        text: `Lv được quay trực tiếp: Lv${MIN_LEVEL}–Lv${GACHA_ADMIN_MAX_LEVEL} (Lv10 chỉ đạt được qua ghép thẻ).`,
      }),
    );

    this.bodyEl.append(
      h('h3', { text: 'Tỉ lệ cấp tướng khi quay' }),
      levelGrid,
      this.levelTotalEl,
      h('h3', { text: 'Rớt Ngọc Ngũ Hành' }),
      gemGrid,
      this.weightTotalEl,
      actions,
    );

    this.refresh();
  }

  /** Cập nhật tại chỗ: dòng quy đổi %, tổng mỗi bảng và trạng thái nút. */
  private refresh(): void {
    const d = this.draft;
    if (!d) return;

    d.levelRates.forEach((e, i) => {
      const el = this.levelPct[i];
      if (el) el.textContent = this.pctText(e.bps, this.levelScale);
    });

    const lt = this.levelTotal();
    if (this.levelTotalEl) {
      const ok = lt === this.levelScale;
      this.levelTotalEl.className = ok ? 'cfg-help muted small' : 'cfg-help warn small';
      this.levelTotalEl.textContent = `Tổng: ${lt.toLocaleString('vi-VN')} / ${this.levelScale.toLocaleString('vi-VN')} (${this.pctText(lt, this.levelScale)})${ok ? '' : ' — phải bằng 100%'}`;
    }

    if (this.dropPct) this.dropPct.textContent = this.pctText(d.gemDropBps, this.bpsScale);
    for (const element of GEM_ELEMENTS) {
      const el = this.weightPct.get(element);
      if (el) el.textContent = this.pctText(d.gemTypeWeights[element] ?? 0, this.bpsScale);
    }

    const wt = this.weightTotal();
    if (this.weightTotalEl) {
      const ok = wt === this.bpsScale;
      this.weightTotalEl.className = ok ? 'cfg-help muted small' : 'cfg-help warn small';
      this.weightTotalEl.textContent = `Tổng trọng số 5 hệ: ${wt.toLocaleString('vi-VN')} / ${this.bpsScale.toLocaleString('vi-VN')} (${this.pctText(wt, this.bpsScale)})${ok ? '' : ' — phải bằng 100%'}`;
    }

    if (this.saveBtn) this.saveBtn.disabled = this.saving || !this.dirty || !this.valid();
    if (this.undoBtn) this.undoBtn.hidden = !this.dirty;
  }

  /** Ghi tỉ lệ của một cấp (giữ nguyên thẻ `<input>` đang gõ). */
  private setLevel(level: number, bps: number): void {
    const i = this.draft?.levelRates.findIndex((e) => e.level === level) ?? -1;
    const row = i < 0 ? undefined : this.draft?.levelRates[i];
    if (!row) return;
    row.bps = bps;
    this.dirty = true;
    this.refresh();
  }

  private setWeight(element: GemElement, value: number): void {
    if (!this.draft) return;
    this.draft.gemTypeWeights[element] = value;
    this.dirty = true;
    this.refresh();
  }

  private setDrop(value: number): void {
    if (!this.draft) return;
    this.draft.gemDropBps = value;
    this.dirty = true;
    this.refresh();
  }
}
