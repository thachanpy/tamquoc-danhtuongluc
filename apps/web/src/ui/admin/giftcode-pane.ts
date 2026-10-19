import { TICKET_LABELS, TICKET_TYPES, type AdminGiftCodeDto, type GiftCodeReward, type TicketType } from '@tq/shared';
import { api } from '../../services/api.ts';
import { ApiError } from '../../services/http.ts';
import { state } from '../../state/store.ts';
import { fmtDateTime } from '../../utils/format.ts';
import { rewardText } from '../../utils/giftcode-text.ts';
import { clear, h } from '../dom.ts';
import { b, loadBlock, msgBox, type Load, type Msg, type MsgPart } from './shared.ts';

/** Lọc các ô nhập số vé trong form tạo giftcode. */
const rewardInputs = (form: HTMLFormElement): HTMLInputElement[] => [...form.querySelectorAll<HTMLInputElement>('[data-pool]')];

/**
 * Tab "Giftcode" (mục 3.9): tạo code tặng vé quay (nhiều loại + số lượng, hạn dùng tuỳ chọn) và bật/tắt code.
 * Giới hạn tổng vé mỗi code do server quyết định (`state.config.giftCodeMaxTickets`) — client chỉ nhắc trước.
 */
export class GiftCodePane {
  readonly el: HTMLElement;

  private readonly opts: { alive: () => boolean };
  private readonly maxTickets = state.config?.giftCodeMaxTickets ?? 0;

  private loaded = false;
  private busy = false;
  private toggling: number | null = null;
  private msg: Msg = null;
  private list: Load = { kind: 'loading' };
  private codes: AdminGiftCodeDto[] = [];
  private now = 0;

  private readonly form: HTMLFormElement;
  private readonly codeInput: HTMLInputElement;
  private readonly expiresInput: HTMLInputElement;
  private readonly featuredInput: HTMLInputElement;
  private readonly totalEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly listEl: HTMLElement;

  constructor(opts: { alive: () => boolean }) {
    this.opts = opts;

    this.codeInput = h('input', {
      attrs: { required: true, minlength: 3, maxlength: 32, pattern: '[A-Za-z0-9_\\-]+', placeholder: 'VD: TET2027', autocapitalize: 'characters' },
    });
    this.expiresInput = h('input', { attrs: { type: 'datetime-local' } });
    this.featuredInput = h('input', { attrs: { type: 'checkbox' } });

    // Mỗi loại vé một ô số lượng; gõ tới đâu cập nhật dòng "Tổng" tới đó.
    const rewards = h(
      'div',
      { class: 'gc-rewards' },
      ...TICKET_TYPES.map((t) =>
        h(
          'label',
          { class: `t-${t}` },
          `${TICKET_LABELS[t]} `,
          h('input', { attrs: { type: 'number', min: 0, max: this.maxTickets, step: 1, 'data-kind': 'ticket', 'data-pool': t, inputmode: 'numeric', placeholder: '0' } }),
        ),
      ),
    );

    this.totalEl = h('span', { class: 'gc-total muted small' });
    this.msgEl = h('div', { class: 'gc-admin-msg', attrs: { 'aria-live': 'polite' } });

    const createBtn = h('button', { class: 'btn primary', attrs: { 'data-create': true }, text: 'Tạo giftcode' });
    this.form = h(
      'form',
      { class: 'gc-create' },
      h('h3', { text: 'Tạo giftcode' }),
      h('label', {}, 'Mã giftcode ', this.codeInput),
      h('div', { class: 'muted small' }, 'Số ', h('b', { text: 'vé quay' }), ' mỗi loại (để trống hoặc 0 nếu không tặng). Giftcode chỉ tặng vé.'),
      rewards,
      h('label', {}, 'Hạn sử dụng (tuỳ chọn) ', this.expiresInput),
      h('label', { class: 'check' }, this.featuredInput, ' Hiện trong popup chào người mới & mục gợi ý'),
      h('div', { class: 'row' }, createBtn, this.totalEl),
      this.msgEl,
    );
    this.form.addEventListener('input', () => this.updateTotal());
    this.form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void this.onSubmit();
    });

    this.listEl = h('div', { class: 'gc-admin-list' });
    this.el = h('div', {}, this.form, h('h3', { text: 'Danh sách giftcode' }), this.listEl);
  }

  /** Gọi khi người dùng mở tab: nạp danh sách giftcode lần đầu. */
  ensureLoaded(): void {
    if (!this.loaded) void this.load();
  }

  /** Đọc các dòng phần thưởng đang nhập (chỉ giữ dòng có số vé > 0). */
  private readRewards(): GiftCodeReward[] {
    return rewardInputs(this.form)
      .map((i) => ({ kind: 'ticket' as const, pool: i.dataset.pool as TicketType, count: Math.floor(Number(i.value) || 0) }))
      .filter((r) => r.count > 0);
  }

  private updateTotal(): void {
    const t = this.readRewards().reduce((s, r) => s + r.count, 0);
    this.totalEl.textContent = t ? `Tổng ${t} vé${t > this.maxTickets ? ` — vượt tối đa ${this.maxTickets}` : ''}` : '';
  }

  private say(parts: MsgPart[], ok = true): void {
    this.msg = parts.length ? { ok, parts } : null;
    clear(this.msgEl);
    const box = msgBox(this.msg);
    if (box) this.msgEl.appendChild(box);
  }

  private async load(): Promise<void> {
    this.loaded = true;
    try {
      const { items } = await api.admin.giftcodes();
      if (!this.opts.alive()) return;
      this.codes = items;
      this.now = Date.now();
      this.list = { kind: 'ready' };
    } catch (e) {
      if (!this.opts.alive()) return;
      this.list = { kind: 'error', text: (e as Error).message };
    }
    this.drawList();
  }

  private async onSubmit(): Promise<void> {
    if (this.busy || !this.form.reportValidity()) return;
    const rewards = this.readRewards();
    if (!rewards.length) {
      this.say(['Hãy nhập số vé cho ít nhất 1 loại.'], false);
      return;
    }
    if (rewards.reduce((s, r) => s + r.count, 0) > this.maxTickets) {
      this.say([`Mỗi giftcode tối đa ${this.maxTickets} vé.`], false);
      return;
    }
    // datetime-local theo giờ máy admin → ISO để server lưu thống nhất.
    const raw = this.expiresInput.value;
    const expiresAt = raw ? new Date(raw).toISOString() : null;
    this.busy = true;
    try {
      const c = await api.admin.createGiftCode({ code: this.codeInput.value.trim(), rewards, expiresAt, featured: this.featuredInput.checked });
      if (!this.opts.alive()) return;
      this.form.reset();
      this.updateTotal();
      this.say(['Đã tạo giftcode ', b(c.code), `: ${rewardText(c.rewards)}${c.expiresAt ? `, hạn ${fmtDateTime(c.expiresAt)}` : ', không hạn'}.`]);
      void this.load();
    } catch (e) {
      if (this.opts.alive()) this.say([(e as ApiError).message], false);
    } finally {
      this.busy = false;
    }
  }

  private async toggle(c: AdminGiftCodeDto): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.toggling = c.id;
    try {
      const r = await api.admin.setGiftCodeActive(c.id, !c.isActive);
      if (this.opts.alive()) this.say(['Giftcode ', b(r.code), ` đã ${r.isActive ? 'bật' : 'tắt'}.`]);
    } catch (e) {
      if (this.opts.alive()) this.say([(e as ApiError).message], false);
    } finally {
      this.busy = false;
      await this.load();
      this.toggling = null;
    }
  }

  private drawList(): void {
    clear(this.listEl);
    if (this.list.kind !== 'ready' || this.codes.length === 0) {
      this.listEl.appendChild(loadBlock(this.list, 'Chưa có giftcode.'));
      return;
    }
    const table = h('div', { class: 'gc-table' });
    for (const c of this.codes) table.appendChild(this.row(c));
    this.listEl.appendChild(table);
  }

  private row(c: AdminGiftCodeDto): HTMLElement {
    const expired = c.expiresAt !== null && Date.parse(c.expiresAt) <= this.now;

    // Cột 1: mã + nhãn "Gợi ý" + người tạo
    const code = h('div', {}, h('b', { class: 'gc-code', text: c.code }));
    if (c.featured) {
      code.appendChild(document.createTextNode(' '));
      code.appendChild(h('span', { class: 'tag gacha', text: 'Gợi ý' }));
    }
    code.appendChild(h('div', { class: 'muted small', text: `${c.createdBy ? `bởi ${c.createdBy} · ` : 'mặc định · '}${fmtDateTime(c.createdAt)}` }));

    // Cột 2: phần thưởng + tổng
    const totals = [c.totalTickets ? `${c.totalTickets} vé` : '', c.totalCards ? `${c.totalCards} thẻ` : ''].filter(Boolean).join(' + ');
    const reward = h('div', {}, rewardText(c.rewards));
    reward.appendChild(h('div', { class: 'muted small' }, 'Tổng ', totals));

    // Cột 5: trạng thái hiệu lực
    const status = !c.isActive
      ? h('span', { class: 'tag bad', text: 'Đã tắt' })
      : expired
        ? h('span', { class: 'tag warn-tag', text: 'Hết hạn' })
        : h('span', { class: 'tag ok', text: 'Đang bật' });

    // Cột 6: nút bật/tắt (code thẻ cũ chỉ tặng thẻ thì không bật lại được)
    const action = h('div', {});
    if (c.totalCards > 0 && !c.isActive) {
      action.appendChild(h('span', { class: 'muted small', attrs: { title: 'Giftcode chỉ tặng vé quay; code thẻ cũ không bật lại được' }, text: 'Code thẻ cũ' }));
    } else {
      const btn = h('button', { class: 'btn ghost small', text: c.isActive ? 'Tắt' : 'Bật' });
      btn.disabled = this.toggling === c.id;
      btn.addEventListener('click', () => void this.toggle(c));
      action.appendChild(btn);
    }

    return h(
      'div',
      { class: 'gc-row' },
      code,
      reward,
      h('div', { class: 'small', text: c.expiresAt ? `Hạn ${fmtDateTime(c.expiresAt)}` : 'Không hạn' }),
      h('div', { class: 'small' }, h('b', { text: c.redemptionCount }), ' lượt nhập'),
      h('div', {}, status),
      action,
    );
  }
}
