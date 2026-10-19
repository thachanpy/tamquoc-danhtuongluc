import { TICKET_LABELS, TICKET_TYPES, type AdminUserDto, type AppSettingsDto, type TicketType } from '@tq/shared';
import { api } from '../../services/api.ts';
import { ApiError, newKey } from '../../services/http.ts';
import { refreshPendingBadge } from '../../state/badges.ts';
import { state } from '../../state/store.ts';
import { fmtDateTime } from '../../utils/format.ts';
import { clear, h } from '../dom.ts';
import { b, createPager, loadBlock, msgBox, type Load, type Msg, type MsgPart, type PagerInfo } from './shared.ts';

/** Số người chơi mỗi trang. */
const PAGE_SIZE = 50;

/**
 * Tab "Người chơi": duyệt/từ chối đăng ký, xem số vé & số thẻ, cộng vé, cấp/thu quyền admin.
 *
 * Bản Phaser không có reactive của Solid nên mọi thay đổi (nạp xong, mở form cộng vé, xác nhận
 * từ chối, lỗi mạng) đều gọi `draw()` để vẽ lại danh sách. Riêng ô nhập số vé là uncontrolled —
 * gõ không kích hoạt vẽ lại nên không mất focus.
 */
export class UsersPane {
  readonly el: HTMLElement;

  private readonly opts: { alive: () => boolean; viewCards: (userId: number) => void };
  private readonly f = { q: '', status: '', page: 1 };

  private items: AdminUserDto[] = [];
  private listState: Load = { kind: 'loading' };
  private grantMax = 10000;
  private openGrant: number | null = null;
  private grantKey: { key: string; sig: string } | null = null;
  private grantType: TicketType = 'normal';
  private grantAmount = '10';
  private focusGrant = false;
  private confirmReject: number | null = null;
  private busy = false;
  private msg: Msg = null;
  private summary: { total: number; pending: number } | null = null;
  private pagerInfo: PagerInfo | null = null;
  private hasFilter = false;
  private approvalOn: boolean | null = null;
  private approvalDisabled = true;
  private searchTimer?: ReturnType<typeof setTimeout>;

  private readonly approvalInput: HTMLInputElement;
  private readonly approvalState: HTMLElement;
  private readonly summaryEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly usersEl: HTMLElement;
  private readonly pager: ReturnType<typeof createPager>;

  constructor(opts: { alive: () => boolean; viewCards: (userId: number) => void }) {
    this.opts = opts;

    // --- Cài đặt "Duyệt tài khoản" (lưu ở server, áp dụng cho các lượt đăng ký sau đó)
    this.approvalInput = h('input', { attrs: { type: 'checkbox', 'data-approval': true } });
    this.approvalInput.disabled = true;
    this.approvalInput.addEventListener('change', () => void this.onApprovalChange());
    this.approvalState = h('span', { class: 'adm-setting-state muted small' });
    const approvalLabel = h(
      'label',
      { class: 'adm-setting' },
      this.approvalInput,
      h(
        'span',
        {},
        h('b', { text: 'Duyệt tài khoản đăng ký' }),
        ' — bật: người đăng ký mới phải chờ admin duyệt mới vào được game; tắt: đăng ký là chơi ngay.',
      ),
      this.approvalState,
    );

    // --- Bộ lọc: tìm tên (debounce 250ms) + trạng thái
    const search = h('input', { attrs: { type: 'search', placeholder: 'Tìm tên đăng nhập…', maxlength: 32, 'aria-label': 'Tìm người chơi' } });
    search.addEventListener('input', () => this.onSearch(search.value));
    const status = h(
      'select',
      { attrs: { 'aria-label': 'Trạng thái' } },
      h('option', { attrs: { value: '' }, text: 'Mọi trạng thái' }),
      h('option', { attrs: { value: 'pending' }, text: 'Chờ duyệt' }),
      h('option', { attrs: { value: 'approved' }, text: 'Đã duyệt' }),
    );
    status.addEventListener('input', () => {
      this.f.status = status.value;
      this.f.page = 1;
      void this.load();
    });
    const filters = h('div', { class: 'filters' }, search, status);

    this.summaryEl = h('div', { class: 'adm-summary muted small' });
    this.msgEl = h('div', { class: 'adm-msg', attrs: { 'aria-live': 'polite' } });
    this.usersEl = h('div', { class: 'adm-users' });
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

    this.el = h('div', {}, approvalLabel, filters, this.summaryEl, this.msgEl, this.usersEl, this.pager.el);

    void api.admin
      .settings()
      .then((s) => {
        if (!this.opts.alive()) return;
        this.showApproval(s.requireApproval);
        this.approvalDisabled = false;
        this.approvalInput.disabled = false;
      })
      .catch((e: ApiError) => this.opts.alive() && this.say([e.message], false));

    void this.load();
  }

  /** Nạp danh sách người chơi theo bộ lọc hiện tại. */
  private async load(): Promise<void> {
    try {
      const p = await api.admin.users({ q: this.f.q, status: this.f.status || undefined, page: this.f.page, pageSize: PAGE_SIZE });
      if (!this.opts.alive()) return;
      this.hasFilter = !!(this.f.q || this.f.status);
      this.items = p.items;
      this.grantMax = p.grantMaxTickets;
      this.summary = { total: p.total, pending: p.pendingCount };
      this.pagerInfo = { page: this.f.page, pages: Math.max(1, Math.ceil(p.total / PAGE_SIZE)) };
      this.listState = { kind: 'ready' };
    } catch (e) {
      if (!this.opts.alive()) return;
      this.listState = { kind: 'error', text: (e as Error).message };
    }
    this.draw();
  }

  /** Ghi thông báo rồi vẽ lại. */
  private say(parts: MsgPart[], ok = true): void {
    this.msg = parts.length ? { ok, parts } : null;
    this.draw();
  }

  private showApproval(on: boolean): void {
    this.approvalOn = on;
    this.approvalInput.checked = on;
    this.approvalState.textContent = on ? 'Đang bật' : 'Đang tắt';
  }

  private async onApprovalChange(): Promise<void> {
    const want = this.approvalInput.checked;
    this.approvalDisabled = true;
    this.approvalInput.disabled = true;
    try {
      const s: AppSettingsDto = await api.admin.setSettings({ requireApproval: want });
      if (!this.opts.alive()) return;
      this.showApproval(s.requireApproval);
      this.say(
        s.requireApproval
          ? ['Đã ', b('bật'), ' duyệt tài khoản: người đăng ký mới sẽ chờ duyệt.']
          : ['Đã ', b('tắt'), ' duyệt tài khoản: người đăng ký mới vào game ngay. Tài khoản đang chờ (nếu có) vẫn cần duyệt tay.'],
      );
    } catch (e) {
      if (!this.opts.alive()) return;
      this.showApproval(!want);
      this.say([(e as ApiError).message], false);
    } finally {
      this.approvalDisabled = false;
      this.approvalInput.disabled = false;
    }
  }

  /** Chạy một thao tác có khoá chống bấm trùng rồi nạp lại danh sách. */
  private async run(action: () => Promise<MsgPart[]>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const parts = await action();
      if (this.opts.alive()) this.say(parts);
    } catch (e) {
      if (this.opts.alive()) this.say([(e as ApiError).message], false);
    } finally {
      this.busy = false;
      await this.load();
    }
  }

  private onSearch(value: string): void {
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => {
      this.f.q = value;
      this.f.page = 1;
      void this.load();
    }, 250);
  }

  // ======================= Thao tác =======================

  private approve(id: number): void {
    void this.run(async () => {
      const r = await api.admin.approve(id);
      void refreshPendingBadge();
      return ['Đã duyệt ', b(r.user.username), ` — nhận quà tân thủ ${r.user.ticketTotal} vé.`];
    });
  }

  private reject(id: number): void {
    this.confirmReject = null;
    void this.run(async () => {
      const r = await api.admin.reject(id);
      void refreshPendingBadge();
      return ['Đã từ chối và xoá đăng ký ', b(r.username), '.'];
    });
  }

  private toggleGrant(id: number): void {
    const opening = this.openGrant !== id;
    if (opening) {
      this.grantType = 'normal';
      this.grantAmount = '10';
      this.focusGrant = true;
    }
    this.openGrant = opening ? id : null;
    this.grantKey = null;
    this.drawList();
  }

  private cancelGrant(): void {
    this.openGrant = null;
    this.grantKey = null;
    this.drawList();
  }

  private grant(id: number): void {
    const amount = Number(this.grantAmount);
    const max = this.grantMax;
    if (!Number.isInteger(amount) || amount < 1 || amount > max) {
      this.say([`Số vé phải là số nguyên từ 1 đến ${max}.`], false);
      return;
    }
    const sig = `${id}:${this.grantType}:${amount}`;
    if (!this.grantKey || this.grantKey.sig !== sig) this.grantKey = { key: newKey(), sig };
    const key = this.grantKey.key;
    void this.run(async () => {
      try {
        const r = await api.admin.grant(id, this.grantType, amount, key);
        this.grantKey = null;
        this.openGrant = null;
        return ['Đã cộng ', b(`${r.amount} ${TICKET_LABELS[r.ticketType]}`), ' cho ', b(r.username), ` (còn ${r.balances[r.ticketType]}).`];
      } catch (e) {
        // Lỗi mạng: giữ key để bấm lại là retry an toàn, không cộng vé hai lần.
        if ((e as ApiError).code !== 'NETWORK') this.grantKey = null;
        throw e;
      }
    });
  }

  private setAdmin(u: AdminUserDto, on: boolean): void {
    void this.run(async () => {
      const r = await api.admin.setAdmin(u.id, on);
      return on ? ['Đã cấp quyền quản trị cho ', b(r.username), '.'] : ['Đã thu quyền quản trị của ', b(u.username), '.'];
    });
  }

  // ======================= Vẽ =======================

  private draw(): void {
    this.summaryEl.textContent = this.summary ? `${this.summary.total.toLocaleString('vi-VN')} người chơi` : '';
    if (this.summary && this.summary.pending) {
      this.summaryEl.appendChild(document.createTextNode(' · '));
      this.summaryEl.appendChild(h('b', { class: 'warn-text', text: `${this.summary.pending} chờ duyệt` }));
    }

    clear(this.msgEl);
    const box = msgBox(this.msg);
    if (box) this.msgEl.appendChild(box);

    this.drawList();
    this.pager.set(this.pagerInfo);
    this.approvalInput.disabled = this.approvalDisabled;
  }

  private drawList(): void {
    clear(this.usersEl);
    if (this.listState.kind !== 'ready' || this.items.length === 0) {
      this.usersEl.appendChild(loadBlock(this.listState, this.hasFilter ? 'Không có người chơi phù hợp.' : 'Chưa có người chơi.'));
      return;
    }
    this.usersEl.appendChild(
      h(
        'div',
        { class: 'adm-head muted small' },
        h('div', { text: 'Người chơi' }),
        h('div', { text: 'Trạng thái' }),
        h('div', { text: 'Vé' }),
        h('div', { text: 'Thẻ' }),
        h('div', { text: 'Thao tác' }),
      ),
    );
    for (const u of this.items) this.usersEl.appendChild(this.row(u));
  }

  private row(u: AdminUserDto): HTMLElement {
    const self = u.username === state.username;
    const row = h('div', { class: `adm-row ${u.status}` });

    // Cột 1: tên + mã + mốc thời gian
    const name = h('div', { class: 'adm-name' }, h('b', { text: u.username }));
    if (u.isAdmin) {
      name.appendChild(document.createTextNode(' '));
      name.appendChild(h('span', { class: 'tag gacha', text: 'Admin' }));
    }
    if (self) {
      name.appendChild(document.createTextNode(' '));
      name.appendChild(h('span', { class: 'muted small', text: '(bạn)' }));
    }
    const approved = u.approvedAt && u.status === 'approved' ? ` · duyệt ${fmtDateTime(u.approvedAt)}` : '';
    name.appendChild(h('div', { class: 'muted small', text: `#${u.id} · đăng ký ${fmtDateTime(u.createdAt)}${approved}` }));
    row.appendChild(name);

    // Cột 2: trạng thái duyệt
    row.appendChild(
      h(
        'div',
        {},
        u.status === 'pending' ? h('span', { class: 'tag warn-tag', text: 'Chờ duyệt' }) : h('span', { class: 'tag ok', text: 'Đã duyệt' }),
      ),
    );

    // Cột 3: số vé theo loại
    const tix = h('div', { class: 'adm-tix' });
    if (u.status !== 'approved') {
      tix.appendChild(h('span', { class: 'muted small', text: 'Chưa kích hoạt' }));
    } else {
      tix.appendChild(h('span', { class: 'tb total' }, 'Tổng ', h('b', { text: u.ticketTotal })));
      for (const t of TICKET_TYPES) {
        if ((u.tickets[t] ?? 0) <= 0) continue;
        tix.appendChild(h('span', { class: `tb t-${t}` }, `${TICKET_LABELS[t].replace('Vé ', '')} `, h('b', { text: u.tickets[t] })));
      }
    }
    row.appendChild(tix);

    // Cột 4: số thẻ sở hữu
    const cards = h('div', { class: 'adm-cards' });
    if (u.cardCount) {
      cards.appendChild(h('b', { text: u.cardCount }));
      cards.appendChild(document.createTextNode(` thẻ${u.maxLevel ? ` · cao nhất Lv.${u.maxLevel}` : ''}`));
    } else {
      cards.appendChild(h('span', { class: 'muted small', text: '0 thẻ' }));
    }
    row.appendChild(cards);

    // Cột 5: thao tác
    row.appendChild(this.actions(u, self));

    if (this.openGrant === u.id) row.appendChild(this.grantForm(u));
    return row;
  }

  private actions(u: AdminUserDto, self: boolean): HTMLElement {
    const act = h('div', { class: 'adm-act' });
    if (u.status === 'pending') {
      act.appendChild(this.btn('btn primary small', 'Duyệt', () => this.approve(u.id)));
      if (this.confirmReject === u.id) {
        act.appendChild(this.btn('btn danger small', 'Xác nhận từ chối', () => this.reject(u.id)));
        act.appendChild(this.btn('btn ghost small', 'Huỷ', () => {
          this.confirmReject = null;
          this.drawList();
        }));
      } else {
        act.appendChild(
          this.btn('btn ghost small', 'Từ chối', () => {
            this.confirmReject = u.id;
            this.drawList();
          }),
        );
      }
      return act;
    }

    // Admin không chơi game ⇒ server không cho cộng vé cho admin (trả TARGET_IS_ADMIN).
    if (!u.isAdmin) act.appendChild(this.btn('btn small', '+ Cộng vé', () => this.toggleGrant(u.id)));

    const viewCards = this.btn('btn ghost small', 'Xem thẻ', () => this.opts.viewCards(u.id));
    viewCards.disabled = !u.cardCount;
    act.appendChild(viewCards);

    if (u.isAdmin) {
      if (!self) act.appendChild(this.btn('btn ghost small', 'Thu quyền admin', () => this.setAdmin(u, false)));
    } else {
      act.appendChild(this.btn('btn ghost small', 'Cấp quyền admin', () => this.setAdmin(u, true)));
    }
    return act;
  }

  private grantForm(u: AdminUserDto): HTMLElement {
    const type = h(
      'select',
      {},
      ...TICKET_TYPES.map((t) => h('option', { attrs: { value: t }, text: TICKET_LABELS[t] })),
    );
    type.value = this.grantType;
    type.addEventListener('change', () => (this.grantType = type.value as TicketType));

    const amount = h('input', { attrs: { type: 'number', min: 1, max: this.grantMax, step: 1, inputmode: 'numeric' } });
    amount.value = this.grantAmount;
    amount.addEventListener('input', () => (this.grantAmount = amount.value));
    if (this.focusGrant) {
      this.focusGrant = false;
      queueMicrotask(() => amount.focus());
    }

    const form = h(
      'div',
      { class: 'grant-form' },
      h('label', {}, 'Loại vé ', type),
      h('label', {}, 'Số lượng ', amount),
      this.btn('btn primary small', 'Cộng vé', () => this.grant(u.id)),
      this.btn('btn ghost small', 'Huỷ', () => this.cancelGrant()),
      h('span', { class: 'muted small', text: `Tối đa ${this.grantMax.toLocaleString('vi-VN')} vé mỗi lần. Ghi lịch sử “Quản trị viên tặng”.` }),
    );
    return form;
  }

  private btn(cls: string, label: string, onClick: () => void): HTMLButtonElement {
    const el = h('button', { class: cls, text: label });
    el.addEventListener('click', onClick);
    return el;
  }

  /** Dỡ pane: huỷ debounce tìm kiếm còn treo. */
  dispose(): void {
    clearTimeout(this.searchTimer);
  }
}
