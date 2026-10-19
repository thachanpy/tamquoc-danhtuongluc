import { FACTION_LABELS, GEM_ELEMENT_LABELS, TICKET_LABELS, TICKET_TYPES, type TicketType } from '@tq/shared';
import { levelTier, pct } from '../assets/art.ts';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api } from '../services/api.ts';
import { newKey, type ApiError } from '../services/http.ts';
import { state, setTickets, tickets } from '../state/store.ts';
import { clear, h, render, type Child } from '../ui/dom.ts';
import { PageScene } from '../ui/PageScene.ts';
import { playReveal, playRevealMany, type StageAction } from '../ui/stage.ts';

/**
 * Trang Quay thẻ (mục 6.2 + 6.3): chọn loại vé, quay 1/×N/"mở tất cả" và phát hiệu ứng mở thẻ.
 *
 * Toàn bộ xác suất do server tính; trang chỉ hiển thị tỉ lệ đang áp dụng và phát lại kết quả.
 * Sau khi quay, kết quả CHỈ hiện trong màn mở thẻ (không lộ trước ở trang) — khi đóng màn chỉ còn
 * dòng tóm tắt, đúng nguyên tắc "không tiết lộ kết quả trước" của chủ dự án.
 */
export class DrawScene extends PageScene {
  private alive = true;
  private selected: TicketType = 'normal';
  private busy = false;
  private msg = '';
  private msgError = false;
  /** Dòng tóm tắt sau khi đóng màn mở thẻ. */
  private last = '';
  /**
   * Key giữ nguyên cho tới khi request có phản hồi xác định -> retry an toàn sau lỗi mạng.
   * Gắn với (loại vé, số lần) để không dùng lại key cho một yêu cầu khác.
   */
  private pending: { key: string; type: TicketType; count: number } | null = null;

  private pickerEl!: HTMLElement;
  private btnsEl!: HTMLElement;
  private msgEl!: HTMLElement;
  private lastEl!: HTMLElement;
  private poolEl!: HTMLElement;
  private poolCountEl!: HTMLElement;

  private readonly counts: number[] = [];
  private readonly maxCount: number;
  /** Số thẻ xịn nhất hiện trong màn kết quả "Mở tất cả"; phần còn lại hiển thị "+N". */
  private static readonly TOP_SHOWN = 10;

  constructor() {
    super(SceneKeys.Draw);
    const cfg = state.config;
    this.counts = cfg ? [...cfg.drawCountOptions].sort((a, b) => a - b) : [1];
    this.maxCount = Math.max(...this.counts);
  }

  // ======================= Dựng DOM =======================

  protected build(): HTMLElement {
    const cfg = state.config;
    if (!cfg) return h('div', { class: 'state-msg error', text: 'Chưa có cấu hình quay thẻ.' });

    this.pickerEl = h('div', { class: 'ticket-picker', attrs: { role: 'radiogroup' } });
    this.btnsEl = h('div', { class: 'draw-btns' });
    this.msgEl = h('div', { class: 'draw-msg', attrs: { 'aria-live': 'polite' } });
    this.lastEl = h('div', { class: 'last-result' });
    this.poolEl = h('div', { class: 'pool' });
    this.poolCountEl = h('span', { class: 'pool-count muted' });

    const panel = h(
      'section',
      { class: 'panel' },
      h('h2', { text: 'Chọn loại vé' }),
      this.pickerEl,
      h('div', { class: 'draw-row' }, this.btnsEl, this.msgEl),
      this.lastEl,
    );

    const rates = h('table', { class: 'rates' }, h('tbody'));
    const tbody = rates.querySelector('tbody')!;
    for (const r of cfg.levelRates) {
      const dot = h('span', { class: 'lv-dot' });
      dot.style.setProperty('--tc', levelTier(r.level).css);
      tbody.appendChild(h('tr', {}, h('td', {}, dot, ` Lv.${r.level}`), h('td', { text: pct(r.bps, cfg.levelScale) })));
    }

    const twoCol = h(
      'div',
      { class: 'two-col' },
      h('section', { class: 'panel' }, h('h3', { text: 'Tỷ lệ level (server đang áp dụng)' }), rates),
      h('section', { class: 'panel' }, h('h3', {}, 'Pool tướng ', this.poolCountEl), this.poolEl),
    );

    this.track(() => (this.alive = false));
    return h('div', {}, panel, twoCol);
  }

  protected loadData(): void {
    this.drawAll();
    // Số dư vé có thể đổi từ nơi khác (nhận giftcode, nhiệm vụ, hồi theo thời gian).
    this.track(tickets.subscribe(() => this.drawAll()));
  }

  /** Vẽ lại toàn bộ khu vực phụ thuộc số dư vé/loại vé đang chọn. */
  private drawAll(): void {
    this.drawPicker();
    this.drawButtons();
    this.drawMsg();
    this.drawLast();
    this.drawPool();
  }

  // ======================= Nguồn dữ liệu =======================

  private get balance(): number {
    return tickets.get()?.balances[this.selected] ?? 0;
  }

  private poolSize(t: TicketType): number {
    return state.config?.ticketTypes.find((x) => x.id === t)?.pool.length ?? 0;
  }

  /** "Mở tất cả": quay hết vé loại đang chọn, tối đa `drawAllMax` lượt mỗi lần bấm (server kiểm tra). */
  private openAllLabel(balance: number): string {
    const allMax = state.config?.drawAllMax ?? 0;
    return balance > allMax ? `Mở ${allMax} vé (tối đa mỗi lần)` : `Mở tất cả ${balance} vé`;
  }

  /** Nút "Quay tiếp" trong màn kết quả: cùng loại vé, cùng các lựa chọn số lần như ở trang. */
  private againActions(balance: number): StageAction[] {
    if (balance <= 0) return [{ label: `Hết ${TICKET_LABELS[this.selected]}`, value: '', disabled: true }];
    const allMax = state.config?.drawAllMax ?? 0;
    const list: StageAction[] = this.counts
      .filter((n) => n === 1 || balance !== 1)
      .map((n) => ({
        label: n === 1 ? 'Quay tiếp 1 vé' : balance < n ? `Quay hết ${balance} vé` : `Quay tiếp ${n} vé`,
        value: String(n),
        primary: n !== 1,
      }));
    if (balance > this.maxCount) list.push({ label: this.openAllLabel(balance), value: String(allMax), primary: true });
    return list;
  }

  /** Nhãn nút: "Quay ×10", hoặc "Quay hết 3 vé" khi số dư ít hơn số lần. Server vẫn quyết số lượt thật. */
  private btnLabel(n: number, balance: number): string {
    if (n === 1) return 'Quay 1 lần';
    return balance > 0 && balance < n ? `Quay hết ${balance} vé` : `Quay ×${n}`;
  }

  // ======================= Vẽ các khối =======================

  private drawPicker(): void {
    const bal = tickets.get()?.balances;
    const cap = tickets.get()?.recoveryCap;
    const children: Child[] = TICKET_TYPES.map((t) => {
      const btn = h('button', {
        class: `ticket t-${t}`,
        classOn: { on: t === this.selected },
        attrs: { role: 'radio', 'aria-checked': t === this.selected ? 'true' : 'false', 'data-t': t },
      });
      btn.appendChild(h('span', { class: 't-name', text: TICKET_LABELS[t] }));
      const count = h('span', {
        class: 't-count',
        classOn: { full: !!(bal && cap && cap[t] > 0 && bal[t] >= cap[t]) },
        attrs: { title: cap ? `Vé hồi theo thời gian tối đa ${cap[t]}; nhiệm vụ, giftcode… vẫn cộng vượt được` : '' },
      });
      count.appendChild(document.createTextNode(String(bal ? bal[t] : '–')));
      if (cap) count.appendChild(h('small', { class: 't-cap', text: ` / ${cap[t]}` }));
      btn.appendChild(count);
      btn.appendChild(
        h('span', { class: 't-pool muted', text: `${this.poolSize(t)} tướng${t === 'normal' ? '' : ` ${FACTION_LABELS[t]}`}` }),
      );
      btn.addEventListener('click', () => this.pick(t));
      return btn;
    });
    render(this.pickerEl, ...children);
  }

  private drawButtons(): void {
    const busy = this.busy;
    const balance = this.balance;
    const children: Child[] = this.counts
      // Ẩn nút ×N trùng hành vi với nút ×1 khi chỉ còn 1 vé.
      .filter((n) => n === 1 || balance !== 1)
      .map((n) => {
        const b = h('button', { class: `btn ${n === 1 ? 'ghost' : 'primary'} big`, attrs: { 'data-n': n } });
        b.disabled = busy || balance <= 0;
        b.textContent = busy ? 'Đang quay…' : balance <= 0 ? 'Hết vé loại này' : this.btnLabel(n, balance);
        b.addEventListener('click', () => void this.doDraw(n));
        return b;
      });
    if (balance > this.maxCount) {
      const b = h('button', { class: 'btn primary big open-all' });
      b.disabled = busy;
      b.textContent = busy ? 'Đang quay…' : this.openAllLabel(balance);
      b.addEventListener('click', () => void this.doDraw(state.config?.drawAllMax ?? 0));
      children.push(b);
    }
    render(this.btnsEl, ...children);
  }

  private drawMsg(): void {
    this.msgEl.classList.toggle('error', this.msgError);
    render(this.msgEl, this.msg);
  }

  private drawLast(): void {
    render(this.lastEl, this.last ? h('div', { class: 'muted small', text: this.last }) : null);
  }

  private drawPool(): void {
    const pool = state.config?.ticketTypes.find((t) => t.id === this.selected)?.pool ?? [];
    render(this.poolCountEl, `(${pool.length} tướng, mỗi tướng ${pct(pool.length ? 10000 / pool.length : 0)})`);
    const children: Child[] = pool.map((id) => {
      const g = state.generalsById.get(id);
      return g ? h('span', { class: `chip f-${g.faction}`, text: g.name }) : null;
    });
    clear(this.poolEl);
    for (const c of children) if (c) this.poolEl.appendChild(c as Node);
  }

  // ======================= Hành động =======================

  private pick(t: TicketType): void {
    this.selected = t;
    this.pending = null;
    this.msg = '';
    this.msgError = false;
    this.drawAll();
  }

  /** Quay vé rồi phát hiệu ứng mở thẻ theo đúng kết quả server trả về. */
  private async doDraw(count: number): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.msg = '';
    this.msgError = false;
    const type = this.selected;
    if (!this.pending || this.pending.type !== type || this.pending.count !== count) {
      this.pending = { key: newKey(), type, count };
    }
    this.drawButtons();
    this.drawMsg();
    try {
      const r = await api.draw(type, count, this.pending.key);
      this.pending = null;
      if (!this.alive) return;
      setTickets(r.tickets);

      const label = TICKET_LABELS[r.ticketType];
      // "Mở tất cả" (nhiều hơn số thẻ hiện được): chỉ lật top 10 thẻ xịn nhất (level cao trước, giữ thứ tự quay).
      const many = r.results.length > DrawScene.TOP_SHOWN;
      const shown = many
        ? r.results
            .map((x, i) => ({ x, i }))
            .sort((a, b) => b.x.card.level - a.x.card.level || a.i - b.i)
            .slice(0, DrawScene.TOP_SHOWN)
            .map((o) => o.x)
        : r.results;
      const rest = r.results.length - shown.length;
      const byLevel = new Map<number, number>();
      for (const x of r.results) byLevel.set(x.card.level, (byLevel.get(x.card.level) ?? 0) + 1);
      const levelSummary = [...byLevel.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([lv, n]) => `Lv.${lv} ×${n}`)
        .join(' · ');
      const first = r.results[0];
      const caption =
        r.drawn === 1 && first
          ? `Đã dùng 1 ${label} → ${first.general.name} Lv.${first.card.level}`
          : many
            ? `Đã mở ${r.drawn} thẻ bằng ${label} · ${DrawScene.TOP_SHOWN} thẻ xịn nhất · +${rest} thẻ khác`
            : `Đã dùng ${r.drawn} ${label}`;
      const gems = r.results.flatMap((x) => (x.gem ? [x.gem] : []));
      const gemNote = gems.length
        ? ` — Ngọc rớt kèm: ${gems.map((g) => `${GEM_ELEMENT_LABELS[g.element]} Cấp ${g.level}`).join(', ')}`
        : '';

      this.last = '';
      this.busy = false;
      this.drawButtons();
      this.drawLast();

      const actions = this.againActions(r.tickets.balances[r.ticketType]);
      const choice = first
        ? r.results.length === 1
          ? await playReveal(first.general, first.card.level, caption, actions, first.gem)
          : await playRevealMany(
              shown.map((x) => ({ general: x.general, level: x.card.level, gem: x.gem })),
              caption,
              actions,
            )
        : null;

      this.last = (many ? `Đã mở ${r.drawn} thẻ bằng ${label}: ${levelSummary}` : caption) + gemNote;
      this.drawLast();
      // "Quay tiếp": quay ngay cùng loại vé, y như bấm nút quay ở trang.
      if (choice && this.alive) void this.doDraw(Number(choice));
    } catch (e) {
      const err = e as ApiError;
      // Lỗi mạng: giữ key để lần bấm lại là retry an toàn (server trả kết quả cũ nếu đã ghi).
      if (err.code !== 'NETWORK') this.pending = null;
      this.msg = err.code === 'NO_TICKETS' ? 'Bạn đã hết vé loại này.' : err.message;
      this.msgError = true;
      this.busy = false;
      this.drawButtons();
      this.drawMsg();
      if (err.code === 'NO_TICKETS') void api.tickets().then(setTickets).catch(() => {});
    }
  }
}
