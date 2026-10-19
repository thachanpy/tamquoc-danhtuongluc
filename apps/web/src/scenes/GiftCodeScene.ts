import { TICKET_LABELS, type GiftCodePublicDto, type GiftCodeRedemptionDto } from '@tq/shared';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api } from '../services/api.ts';
import type { ApiError } from '../services/http.ts';
import { setTickets } from '../state/store.ts';
import { h, render, type Child } from '../ui/dom.ts';
import { PageScene } from '../ui/PageScene.ts';
import { fmtDateTime } from '../utils/format.ts';
import { rewardText } from '../utils/giftcode-text.ts';

type Redeemed = { code: string; cardCount: number; ticketCount: number; createdAt: string };
type Featured = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; items: GiftCodePublicDto[] };
type Msg = { kind: 'loading' } | { kind: 'ok'; r: GiftCodeRedemptionDto } | { kind: 'warn'; text: string } | null;

/**
 * Trang Giftcode (mục 3.9): người chơi nhập code để nhận vé quay (server cộng vé, ghi ledger);
 * mỗi code chỉ nhập được 1 lần. Hiển thị các code gợi ý và các code đã nhập.
 */
export class GiftCodeScene extends PageScene {
  private alive = true;
  private code = '';
  private busy = false;
  private msg: Msg = null;
  private featured: Featured = { kind: 'loading' };
  /** null = chưa tải (khối trống như bản cũ). */
  private redeemed: Redeemed[] | null = null;

  // --- phần tử DOM được cập nhật tại chỗ
  private inputEl!: HTMLInputElement;
  private redeemBtn!: HTMLButtonElement;
  private msgEl!: HTMLElement;
  private featuredEl!: HTMLElement;
  private redeemedEl!: HTMLElement;

  constructor() {
    super(SceneKeys.GiftCode);
  }

  protected build(): HTMLElement {
    const root = h('div');

    this.inputEl = h('input', {
      attrs: {
        'data-code': true,
        placeholder: 'VD: THUCQUOC',
        maxlength: 32,
        autocomplete: 'off',
        autocapitalize: 'characters',
        spellcheck: 'false',
        'aria-label': 'Giftcode',
        required: true,
      },
      on: { input: (ev) => (this.code = (ev.currentTarget as HTMLInputElement).value) },
    });
    this.redeemBtn = h('button', { class: 'btn primary', attrs: { 'data-redeem': true }, text: 'Nhận thưởng' });

    const form = h('form', { class: 'gc-form' });
    form.append(this.inputEl, this.redeemBtn);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void this.redeem(this.inputEl.value);
    });

    this.msgEl = h('div', { class: 'gc-msg', attrs: { 'aria-live': 'polite' } });

    const panel1 = h(
      'section',
      { class: 'panel gc-panel' },
      h('h2', { text: 'Nhập Giftcode' }),
      form,
      h('p', { class: 'muted small', text: 'Mỗi giftcode chỉ nhập được 1 lần. Vé quay được cộng ngay vào tài khoản.' }),
      this.msgEl,
    );

    this.featuredEl = h('div', { class: 'gc-featured' });
    this.redeemedEl = h('div', { class: 'gc-redeemed muted small' });

    const panel2 = h(
      'section',
      { class: 'panel' },
      h('h3', { text: 'Giftcode dành cho bạn' }),
      this.featuredEl,
      h('h3', { text: 'Đã nhập' }),
      this.redeemedEl,
    );

    root.append(panel1, panel2);

    this.track(() => (this.alive = false));

    return root;
  }

  protected loadData(): void {
    this.inputEl.focus();
    this.drawMsg();
    this.drawFeatured();
    this.drawRedeemed();
    void this.loadGiftCodes();
  }

  private async loadGiftCodes(): Promise<void> {
    try {
      const d = await api.giftcodes();
      if (!this.alive) return;
      this.featured = { kind: 'ok', items: d.featured };
      this.redeemed = d.redeemed;
      this.drawFeatured();
      this.drawRedeemed();
    } catch (e) {
      if (this.alive) {
        this.featured = { kind: 'error', message: (e as Error).message };
        this.drawFeatured();
      }
    }
  }

  private async redeem(c: string): Promise<void> {
    if (this.busy || !c.trim()) return;
    this.busy = true;
    this.redeemBtn.disabled = true;
    this.msg = { kind: 'loading' };
    this.drawMsg();
    try {
      const r = await api.redeemGiftCode(c.trim());
      if (!this.alive) return;
      this.inputEl.value = '';
      this.code = '';
      setTickets(r.balances); // cập nhật thanh vé ngay
      this.msg = { kind: 'ok', r };
      this.drawMsg();
      void this.loadGiftCodes();
    } catch (e) {
      if (this.alive) {
        this.msg = { kind: 'warn', text: (e as ApiError).message };
        this.drawMsg();
      }
    } finally {
      this.busy = false;
      this.redeemBtn.disabled = false;
    }
  }

  /** Vẽ khối thông báo dưới form nhập code. */
  private drawMsg(): void {
    const m = this.msg;
    if (!m) {
      render(this.msgEl);
      return;
    }
    if (m.kind === 'loading') {
      render(this.msgEl, h('div', { class: 'muted', text: 'Đang nhận thưởng…' }));
      return;
    }
    if (m.kind === 'warn') {
      render(this.msgEl, h('div', { class: 'warn', text: m.text }));
      return;
    }
    const r = m.r;
    const notice = h('div', { class: 'notice' });
    notice.append(
      h('b', { text: 'Nhận thưởng thành công!' }),
      ' Giftcode ',
      h('b', { text: r.code }),
      ': ',
      rewardText(r.rewards),
      '. Vào tab Quay thẻ để dùng vé.',
    );
    const children: Child[] = [notice];
    if (r.tickets.length) {
      const levels = h('div', { class: 'gc-levels' });
      for (const t of r.tickets) levels.appendChild(h('span', { class: `tb t-${t.pool}`, text: `+${t.count} ${TICKET_LABELS[t.pool]}` }));
      children.push(levels);
    }
    render(this.msgEl, ...children);
  }

  /** Vẽ danh sách giftcode gợi ý. */
  private drawFeatured(): void {
    const f = this.featured;
    if (f.kind === 'loading') {
      render(this.featuredEl, h('div', { class: 'state-msg', text: 'Đang tải…' }));
      return;
    }
    if (f.kind === 'error') {
      render(this.featuredEl, h('div', { class: 'state-msg error', text: f.message }));
      return;
    }
    if (!f.items.length) {
      render(this.featuredEl, h('div', { class: 'state-msg', text: 'Không có giftcode gợi ý.' }));
      return;
    }
    const children: Child[] = [];
    for (const c of f.items) {
      const item = h('div', { class: 'gc-item', classOn: { done: c.redeemed } });
      item.appendChild(h('b', { class: 'gc-code', text: c.code }));
      item.appendChild(h('span', { text: rewardText(c.rewards) }));
      if (c.expiresAt) item.appendChild(h('span', { class: 'muted small', text: `Hạn: ${fmtDateTime(c.expiresAt)}` }));
      if (c.redeemed) {
        item.appendChild(h('span', { class: 'tag ok', text: 'Đã nhập' }));
      } else {
        const btn = h('button', { class: 'btn small', attrs: { 'data-use': c.code }, text: 'Nhập' });
        btn.addEventListener('click', () => {
          this.inputEl.value = c.code;
          this.code = c.code;
          void this.redeem(c.code);
        });
        item.appendChild(btn);
      }
      children.push(item);
    }
    render(this.featuredEl, ...children);
  }

  /** Vẽ danh sách giftcode đã nhập. */
  private drawRedeemed(): void {
    const list = this.redeemed;
    if (list === null) {
      render(this.redeemedEl);
      return;
    }
    if (!list.length) {
      render(this.redeemedEl, 'Chưa nhập giftcode nào.');
      return;
    }
    const children: Child[] = [];
    for (const r of list) {
      const parts = [r.ticketCount ? `${r.ticketCount} vé` : '', r.cardCount ? `${r.cardCount} thẻ` : ''].filter(Boolean).join(' + ');
      children.push(h('div', {}, h('b', { text: r.code }), ' · ', `${parts} · ${fmtDateTime(r.createdAt)}`));
    }
    render(this.redeemedEl, ...children);
  }
}
