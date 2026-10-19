import { FACTION_LABELS, TICKET_LABELS, type Faction, type GiftCardSnapshot, type HistoryEntryDto } from '@tq/shared';
import { pct } from '../assets/art.ts';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api } from '../services/api.ts';
import { gen } from '../state/store.ts';
import { h, render, type Child } from '../ui/dom.ts';
import { PageScene } from '../ui/PageScene.ts';
import { fmtDateTime } from '../utils/format.ts';

/** Số mục lịch sử mỗi trang. */
const PAGE_SIZE = 20;

/** Nhãn dòng ledger nhiệm vụ/thành tựu từ khoá phần thưởng (mục 3.10). */
function questLabel(key: string): string {
  const p = key.split(':');
  const n = (x?: string) => Number(x ?? 0).toLocaleString('vi-VN');
  const dm = (d?: string) => (d ? `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}` : '');
  switch (p[0]) {
    case 'reset':
      return `Thưởng ngày mới ${dm(p[1])}`;
    case 'd':
      return `Nhiệm vụ hằng ngày ${dm(p[1])}`;
    case 'f':
      return `Nhiệm vụ phe ${FACTION_LABELS[p[2] as Faction] ?? ''} ${dm(p[1])}`;
    case 'login':
      return `Điểm danh ngày ${dm(p[1])}`;
    case 'a':
      if (p[1] === 'draws') return `Thành tựu: chiêu mộ ${n(p[2])} lần`;
      if (p[1] === 'collect') return `Thành tựu: sưu tầm ${n(p[2])} tướng`;
      if (p[1] === 'fcollect') return `Thành tựu: sưu tầm ${n(p[3])} tướng ${FACTION_LABELS[p[2] as Faction] ?? ''}`;
      if (p[1] === 'own') return `Thành tựu: sở hữu ${n(p[3])} thẻ Lv.${p[2]}`;
      if (p[1] === 'cards') return `Thành tựu: nhận ${n(p[2])} thẻ`;
      return 'Thành tựu';
    default:
      return 'Nhiệm vụ';
  }
}

const cardList = (cards: GiftCardSnapshot[]) => cards.map((c) => `${gen(c.generalId).name} Lv.${c.level}`).join(', ');

/** Khung chung một dòng lịch sử: nhãn, nội dung, thời điểm. */
function hrRow(tag: string, createdAt: string, children: Child[], tagClass?: string): HTMLElement {
  return h(
    'div',
    { class: 'h-row' },
    h('span', { class: tagClass ? `tag ${tagClass}` : 'tag', text: tag }),
    h('div', {}, ...children),
    h('time', { text: fmtDateTime(createdAt) }),
  );
}

/** Mục "Xem thẻ" liệt kê các thẻ trong giao dịch tặng/nhập giftcode. */
function cardsDetails(cards: GiftCardSnapshot[]): HTMLElement {
  return h('details', {}, h('summary', { class: 'muted small', text: 'Xem thẻ' }), h('div', { class: 'small', text: cardList(cards) }));
}

/** Một dòng lịch sử — phân nhánh theo `kind` và lý do của giao dịch. */
function row(e: HistoryEntryDto): HTMLElement {
  if (e.kind === 'ticket') {
    const label = TICKET_LABELS[e.ticketType];
    const plus = `+${e.amountDelta} vé`;
    const got = h('b', { text: `${label} ×${e.amountDelta}` });

    if (e.reason === 'time_recovery') {
      return hrRow('+1 vé', e.createdAt, ['Hồi vé mốc ', h('b', { text: fmtDateTime(e.referenceId ?? e.createdAt) }), ': nhận ', h('b', { text: label })], 'ok');
    }
    if (e.reason === 'dev_topup') return hrRow(plus, e.createdAt, ['Cộng vé thử nghiệm: nhận ', got], 'ok');
    if (e.reason === 'giftcode') return hrRow(plus, e.createdAt, ['Giftcode: nhận ', got], 'ok');
    if (e.reason === 'admin_grant') return hrRow(plus, e.createdAt, ['Quản trị viên tặng: nhận ', got], 'ok');
    if (e.reason === 'daily_reset' || e.reason === 'mission' || e.reason === 'achievement') {
      return hrRow(plus, e.createdAt, [`${questLabel(e.referenceId ?? '')}: nhận `, got], 'ok');
    }
    if (e.reason === 'signup_bonus') return hrRow(plus, e.createdAt, ['Quà tân thủ: nhận ', got], 'ok');
    return hrRow('−1 vé', e.createdAt, ['Dùng ', h('b', { text: label }), ' để quay']);
  }

  if (e.kind === 'giftcode') {
    const got = [...(e.tickets ?? []).map((t) => `${TICKET_LABELS[t.pool]} ×${t.count}`), e.cards.length ? `${e.cards.length} thẻ` : ''].filter(Boolean).join(', ');
    const children: Child[] = ['Nhập giftcode ', h('b', { text: e.code }), ': nhận ', h('b', { text: got })];
    if (e.cards.length) children.push(cardsDetails(e.cards));
    return hrRow('Giftcode', e.createdAt, children, 'ok');
  }

  if (e.kind === 'gift') {
    const count = h('b', { text: `${e.cards.length} thẻ` });
    if (e.direction === 'sent') {
      return hrRow(`Tặng ${e.cards.length}`, e.createdAt, ['Tặng ', count, ' cho ', h('b', { text: e.otherUsername }), cardsDetails(e.cards)], 'bad');
    }
    return hrRow(`Nhận ${e.cards.length}`, e.createdAt, ['Nhận ', count, ' từ ', h('b', { text: e.otherUsername }), cardsDetails(e.cards)], 'ok');
  }

  if (e.kind === 'gacha') {
    return hrRow(
      'Quay',
      e.createdAt,
      [`${TICKET_LABELS[e.ticketType]} → `, h('b', { text: `${gen(e.generalId).name} Lv.${e.cardLevel}` }), ' ', h('span', { class: 'muted', text: `(thẻ #${e.cardId})` })],
      'gacha',
    );
  }

  const dist = e.failureDistribution.map((d) => `Lv.${d.level}: ${pct(d.bps)}`).join(' · ');
  const details = h(
    'details',
    {},
    h('summary', { class: 'muted small', text: 'Tỷ lệ đã áp dụng' }),
    h('div', { class: 'small' }, `Thành công ${pct(e.successBps)} · Thất bại ${pct(e.failureBps)}`, h('br'), `Phân phối thất bại: ${dist}`),
  );
  return hrRow(
    e.outcome === 'success' ? 'Ghép ✓' : 'Ghép ✗',
    e.createdAt,
    [
      h('b', { text: gen(e.generalId).name }),
      ' ',
      `${e.inputCardIds.length}× Lv.${e.inputLevel} (thẻ ${e.inputCardIds.map((i) => '#' + i).join(', ')}) → `,
      h('b', { text: `Lv.${e.resultLevel}` }),
      ` (thẻ #${e.resultCardId})`,
      details,
    ],
    e.outcome === 'success' ? 'ok' : 'bad',
  );
}

type ListState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; items: HistoryEntryDto[] };

/**
 * Trang Lịch sử: bảng ledger các giao dịch (vé, quay thẻ, nâng cấp, tặng thẻ, giftcode) có lọc theo loại
 * và phân trang. Bản Phaser bỏ reactive của Solid nên mỗi lần đổi lọc/trang đều gọi lại `fetch()` rồi vẽ.
 */
export class HistoryScene extends PageScene {
  constructor() {
    super(SceneKeys.History);
  }

  private page = 1;
  private kind = '';
  private list: ListState = { kind: 'loading' };
  private pinfo = '';
  private prevDisabled = false;
  private nextDisabled = false;
  private alive = true;

  private listEl!: HTMLElement;
  private prevBtn!: HTMLButtonElement;
  private nextBtn!: HTMLButtonElement;
  private pinfoEl!: HTMLElement;

  protected build(): HTMLElement {
    const root = h('section', { class: 'panel' });

    const kindSel = h(
      'select',
      { attrs: { 'data-kind': '', 'aria-label': 'Loại' } },
      h('option', { attrs: { value: '' }, text: 'Tất cả' }),
      h('option', { attrs: { value: 'ticket' }, text: 'Vé (cấp/dùng)' }),
      h('option', { attrs: { value: 'gacha' }, text: 'Quay thẻ' }),
      h('option', { attrs: { value: 'upgrade' }, text: 'Nâng cấp' }),
      h('option', { attrs: { value: 'gift' }, text: 'Tặng thẻ' }),
      h('option', { attrs: { value: 'giftcode' }, text: 'Giftcode' }),
    );
    kindSel.addEventListener('input', () => {
      this.kind = kindSel.value;
      this.page = 1;
      void this.fetch();
    });
    root.appendChild(h('div', { class: 'filters' }, kindSel));

    this.listEl = h('div', { class: 'h-list' });
    root.appendChild(this.listEl);

    this.prevBtn = h('button', { class: 'btn ghost', text: '‹ Trước', attrs: { 'data-prev': '' } });
    this.prevBtn.addEventListener('click', () => {
      this.page -= 1;
      void this.fetch();
    });
    this.pinfoEl = h('span', { class: 'pinfo muted' });
    this.nextBtn = h('button', { class: 'btn ghost', text: 'Sau ›', attrs: { 'data-next': '' } });
    this.nextBtn.addEventListener('click', () => {
      this.page += 1;
      void this.fetch();
    });
    root.appendChild(h('div', { class: 'pager' }, this.prevBtn, this.pinfoEl, this.nextBtn));

    this.track(() => {
      this.alive = false;
    });

    return root;
  }

  protected loadData(): void {
    void this.fetch();
  }

  private async fetch(): Promise<void> {
    this.list = { kind: 'loading' };
    this.refresh();
    const pg = this.page;
    try {
      const p = await api.history({ kind: this.kind || undefined, page: pg, pageSize: PAGE_SIZE });
      if (!this.alive) return;
      const pages = Math.max(1, Math.ceil(p.total / PAGE_SIZE));
      this.list = { kind: 'ok', items: p.items };
      this.pinfo = `Trang ${pg}/${pages} · ${p.total} mục`;
      this.prevDisabled = pg <= 1;
      this.nextDisabled = pg >= pages;
    } catch (e) {
      if (this.alive) this.list = { kind: 'error', message: (e as Error).message };
    }
    this.refresh();
  }

  private refresh(): void {
    if (!this.alive) return;
    this.drawList();
    this.prevBtn.disabled = this.prevDisabled;
    this.nextBtn.disabled = this.nextDisabled;
    this.pinfoEl.textContent = this.pinfo;
  }

  private drawList(): void {
    const l = this.list;
    if (l.kind === 'loading') {
      render(this.listEl, h('div', { class: 'state-msg', text: 'Đang tải…' }));
      return;
    }
    if (l.kind === 'error') {
      render(this.listEl, h('div', { class: 'state-msg error', text: l.message }));
      return;
    }
    if (!l.items.length) {
      render(this.listEl, h('div', { class: 'state-msg', text: 'Chưa có lịch sử.' }));
      return;
    }
    render(this.listEl, ...l.items.map((e) => row(e)));
  }
}
