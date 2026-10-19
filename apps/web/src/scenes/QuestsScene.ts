import {
  FACTIONS,
  FACTION_LABELS,
  TICKET_LABELS,
  TICKET_TYPES,
  type AchievementGroupDto,
  type LoginDayDto,
  type QuestItemDto,
  type QuestsDto,
  type TicketType,
} from '@tq/shared';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api } from '../services/api.ts';
import type { ApiError } from '../services/http.ts';
import { setQuestBadge, setTickets } from '../state/store.ts';
import { h, render, type Child } from '../ui/dom.ts';
import { PageScene } from '../ui/PageScene.ts';
import { fmtClock, num } from '../utils/format.ts';

/** Ba tab của trang Nhiệm vụ. */
type Sub = 'daily' | 'login' | 'ach';
const SUB_LABEL: Record<Sub, string> = { daily: 'Hằng ngày', login: 'Điểm danh', ach: 'Thành tựu' };

/** Nhãn hiển thị của một ô điểm danh theo trạng thái server trả về. */
const DAY_LABEL: Record<LoginDayDto['status'], string> = { claimed: '✓', claimable: 'Nhận', missed: 'Vắng', future: '', progress: '' };

/** Đếm ngược tới mốc reset 05:00 → "HH:MM:SS" (âm thì kẹp về 00:00:00). */
const cd = (ms: number) => fmtClock(ms / 1000);

type Msg = { ok: true; count: number; parts: [TicketType, number][] } | { ok: false; text: string };

/** Nhãn phần thưởng "loại vé + số lượng". */
function rewardChip(pool: TicketType, count: number): HTMLElement {
  return h('span', { class: `tb t-${pool} q-reward`, text: `+${num(count)} ${TICKET_LABELS[pool]}` });
}

/** Thanh tiến độ nhiệm vụ/thành tựu. */
function bar(progress: number, target: number): HTMLElement {
  return h(
    'div',
    { class: 'q-bar', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': target, 'aria-valuenow': progress } },
    h('i', { style: { width: `${Math.round((progress / target) * 100)}%` } }),
  );
}

type TabRef = { key: Sub; btn: HTMLButtonElement; dot: HTMLElement };

/**
 * Trang Nhiệm vụ (mục 3.10): nhiệm vụ hằng ngày (chung + theo phe), điểm danh theo tháng, thành tựu.
 * Chỉ hiển thị trạng thái server tính; bấm Nhận gửi khoá phần thưởng, server kiểm tra lại và cộng vé.
 *
 * Bản Phaser không dùng reactive của Solid nên mọi thay đổi trạng thái (nạp dữ liệu, nhận thưởng,
 * đổi tab) đều gọi `refresh()` để vẽ lại tại chỗ; đồng hồ đếm ngược chỉ cập nhật đúng nút text.
 */
export class QuestsScene extends PageScene {
  constructor() {
    super(SceneKeys.Quests);
  }

  // KHÔNG dùng tên `data`: trùng thuộc tính `Scene.data` (DataManager) của Phaser.
  private quests: QuestsDto | null = null;
  private error = '';
  private busy = false;
  private sub: Sub = 'daily';
  private msg: Msg | null = null;
  /** Mốc local (performance.now) khi sang ngày mới — hiện đồng hồ đếm ngược tới mốc này. */
  private nextResetLocal = 0;
  private timer = 0;
  private alive = true;

  private claimAll!: HTMLButtonElement;
  private tabs: TabRef[] = [];
  private msgEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private cdEl: HTMLElement | null = null;

  protected build(): HTMLElement {
    const root = h('section', { class: 'panel q-panel' });

    this.claimAll = h('button', { class: 'btn primary', text: 'Nhận tất cả' });
    this.claimAll.addEventListener('click', () => void this.claim());
    root.appendChild(h('div', { class: 'q-head' }, h('h2', { text: 'Nhiệm vụ' }), this.claimAll));

    const tablist = h('div', { class: 'sub-tabs', attrs: { role: 'tablist' } });
    this.tabs = (['daily', 'login', 'ach'] as Sub[]).map((k) => {
      const dot = h('span', { class: 'q-dot', attrs: { hidden: true } });
      const btn = h('button', { class: 'btn small' }, SUB_LABEL[k], ' ', dot);
      btn.addEventListener('click', () => {
        this.sub = k;
        this.refresh();
      });
      tablist.appendChild(btn);
      return { key: k, btn, dot };
    });
    root.appendChild(tablist);

    this.msgEl = h('div', { class: 'q-msg', attrs: { 'aria-live': 'polite' } });
    root.appendChild(this.msgEl);

    this.bodyEl = h('div', { class: 'q-body' });
    root.appendChild(this.bodyEl);

    this.track(() => {
      this.alive = false;
      clearInterval(this.timer);
    });

    return root;
  }

  protected loadData(): void {
    this.refresh(); // hiện trạng thái "đang tải" ngay khi vào trang
    // Đồng hồ đến 05:00; tới giờ thì tải lại (server xử lý ngày mới khi nhận request)
    this.timer = window.setInterval(() => {
      if (!this.quests) return;
      if (this.cdEl?.isConnected) this.cdEl.textContent = cd(this.nextResetLocal - performance.now());
      if (this.nextResetLocal - performance.now() < -1500 && !this.busy) {
        this.nextResetLocal = performance.now() + 60_000; // tránh gọi dồn
        void this.loadQuests();
      }
    }, 1000);
    void this.loadQuests();
  }

  private async loadQuests(): Promise<void> {
    try {
      const d = await api.quests();
      if (!this.alive) return;
      this.nextResetLocal = performance.now() + (Date.parse(d.nextResetAt) - Date.now());
      this.error = '';
      this.quests = d;
      setQuestBadge(d.claimable);
    } catch (e) {
      if (this.alive) this.error = (e as Error).message;
    }
    this.refresh();
  }

  private async claim(keys?: string[]): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.msg = null;
    this.refresh();
    try {
      const r = await api.claimQuests(keys);
      if (!this.alive) return;
      setTickets(r.balances);
      const sum = new Map<TicketType, number>();
      for (const c of r.claimed) sum.set(c.pool, (sum.get(c.pool) ?? 0) + c.count);
      this.msg = { ok: true, count: r.claimed.length, parts: [...sum] };
    } catch (e) {
      if (this.alive) this.msg = { ok: false, text: (e as ApiError).message };
    } finally {
      this.busy = false;
      if (this.alive) await this.loadQuests();
    }
  }

  /** Vẽ lại toàn bộ phần phụ thuộc trạng thái (đầu trang, tab, thông báo, thân trang). */
  private refresh(): void {
    if (!this.alive) return;
    this.drawHead();
    this.drawTabs();
    this.drawMsg();
    this.drawBody();
  }

  private drawHead(): void {
    const d = this.quests;
    this.claimAll.disabled = this.busy || !d || d.claimable === 0;
    this.claimAll.textContent = d?.claimable ? `Nhận tất cả (${d.claimable})` : 'Nhận tất cả';
  }

  /** Số phần thưởng chờ nhận theo từng tab (badge chấm nhỏ cạnh nhãn tab). */
  private counts(d: QuestsDto | null): Record<Sub, number> {
    if (!d) return { daily: 0, login: 0, ach: 0 };
    return {
      daily: [...d.daily, ...FACTIONS.flatMap((f) => d.faction[f]), ...d.pvp, ...d.gem].filter((i) => i.status === 'claimable').length,
      login: d.login.days.filter((x) => x.status === 'claimable').length,
      ach: d.achievements.flatMap((g) => g.items).filter((i) => i.status === 'claimable').length,
    };
  }

  private drawTabs(): void {
    const counts = this.counts(this.quests);
    for (const t of this.tabs) {
      t.btn.classList.toggle('on', this.sub === t.key);
      const c = counts[t.key];
      t.dot.hidden = !c;
      t.dot.textContent = c ? String(c) : '';
    }
  }

  private drawMsg(): void {
    const m = this.msg;
    if (!m) {
      render(this.msgEl);
      return;
    }
    if (m.ok) {
      const notice = h('div', { class: 'notice' });
      notice.appendChild(document.createTextNode(`Đã nhận ${m.count} phần thưởng: `));
      m.parts.forEach(([p, n], i) => {
        if (i > 0) notice.appendChild(document.createTextNode(', '));
        notice.appendChild(h('b', { text: `+${num(n)} ${TICKET_LABELS[p]}` }));
      });
      render(this.msgEl, notice);
    } else {
      render(this.msgEl, h('div', { class: 'warn', text: m.text }));
    }
  }

  private drawBody(): void {
    this.cdEl = null;
    if (this.error && !this.quests) {
      render(this.bodyEl, h('div', { class: 'state-msg error', text: this.error }));
      return;
    }
    if (!this.quests) {
      render(this.bodyEl, h('div', { class: 'state-msg', text: 'Đang tải nhiệm vụ…' }));
      return;
    }
    const d = this.quests;
    const kids = this.sub === 'daily' ? this.dailyChildren(d) : this.sub === 'login' ? this.loginChildren(d) : this.achChildren(d);
    render(this.bodyEl, ...kids);
  }

  // ===================== Tab Hằng ngày =====================

  private dailyChildren(d: QuestsDto): HTMLElement[] {
    const cdEl = h('b', { attrs: { 'data-cd': '' }, text: cd(this.nextResetLocal - performance.now()) });
    this.cdEl = cdEl;

    const bonusText = `Thưởng ngày mới: ${TICKET_TYPES.map((t) => `${d.resetBonus.tickets[t]} ${TICKET_LABELS[t].replace('Vé ', '')}`).join(' · ')} `;
    const reset2 = h('span', { class: 'small' }, bonusText);
    if (d.resetBonus.granted) reset2.appendChild(h('span', { class: 'q-done', text: '✓ Đã cộng' }));

    const reset = h(
      'div',
      { class: 'q-reset' },
      h('span', {}, 'Làm mới sau ', cdEl, ' ', h('span', { class: 'muted small', text: '(05:00 giờ Việt Nam)' })),
      reset2,
    );

    const factions = h('div', { class: 'q-factions' });
    for (const f of FACTIONS) {
      factions.appendChild(
        h('div', { class: `q-faction f-${f}` }, h('div', { class: 'q-ftitle', text: `Phe ${FACTION_LABELS[f]}` }), this.qList(d.faction[f])),
      );
    }

    return [
      reset,
      h('h3', { text: 'Nhiệm vụ chung' }),
      this.qList(d.daily),
      h('h3', { text: 'Nhiệm vụ đấu trường' }),
      h('p', { class: 'muted small', text: 'Chỉ tính các trận bạn chủ động khiêu chiến trong ngày (không tính lúc bị khiêu chiến).' }),
      this.qList(d.pvp),
      h('h3', { text: 'Nhiệm vụ Ngọc' }),
      h('p', { class: 'muted small', text: 'Ngọc nhận khi chiêu mộ (rớt kèm) và khi ghép Ngọc. Ghép tính cả lần thất bại.' }),
      this.qList(d.gem),
      h('h3', { text: 'Nhiệm vụ theo phe' }),
      factions,
      h('p', { class: 'muted small', text: 'Nhiệm vụ đã đạt mà chưa bấm nhận sẽ được tự động nhận khi sang ngày mới (05:00).' }),
    ];
  }

  private qList(items: QuestItemDto[]): HTMLElement {
    const list = h('div', { class: 'q-list' });
    for (const i of items) list.appendChild(this.questRow(i));
    return list;
  }

  private questRow(i: QuestItemDto): HTMLElement {
    return h(
      'div',
      { class: `q-row ${i.status}` },
      h('div', { class: 'q-info' }, h('b', { text: i.name }), h('span', { class: 'muted small', text: i.desc }), bar(i.progress, i.target)),
      rewardChip(i.reward.pool, i.reward.count),
      h('div', { class: 'q-act' }, this.claimBtn(i)),
    );
  }

  private claimBtn(i: QuestItemDto): HTMLElement {
    if (i.status === 'claimed') return h('span', { class: 'q-done', text: '✓ Đã nhận' });
    if (i.status === 'claimable') {
      const b = h('button', { class: 'btn primary small', text: 'Nhận' });
      b.disabled = this.busy;
      b.addEventListener('click', () => void this.claim([i.key]));
      return b;
    }
    return h('span', { class: 'muted small', text: `${num(i.progress)}/${num(i.target)}` });
  }

  // ===================== Tab Điểm danh =====================

  private loginChildren(d: QuestsDto): HTMLElement[] {
    const ym = d.login.month.split('-');
    const cal = h('div', { class: 'q-cal' });
    for (const x of d.login.days) cal.appendChild(this.dayCell(x, d.calendarDate));
    return [
      h('h3', { text: `Điểm danh tháng ${Number(ym[1] ?? '')}/${ym[0] ?? ''}` }),
      h(
        'p',
        { class: 'muted small', text:
          'Mỗi ngày vào game nhận Vé thường theo ngày trong tháng (ngày 1: 10 vé … ngày 31: 40 vé). Bỏ lỡ một ngày không ảnh hưởng ngày sau. Sang tháng mới, các ngày chưa bấm nhận được tự động nhận.' },
      ),
      cal,
    ];
  }

  private dayCell(x: LoginDayDto, today: string): HTMLElement {
    const cls = `q-day ${x.status} ${x.date === today ? 'today' : ''}`;
    const inner = (): Child[] => [h('span', { class: 'q-dnum', text: `Ngày ${x.day}` }), h('b', { text: x.reward }), h('span', { class: 'q-dlabel', text: DAY_LABEL[x.status] })];
    if (x.status === 'claimable') {
      const b = h('button', { class: cls }, ...inner());
      b.disabled = this.busy;
      b.addEventListener('click', () => void this.claim([`login:${x.date}`]));
      return b;
    }
    return h('div', { class: cls }, ...inner());
  }

  // ===================== Tab Thành tựu =====================

  private achChildren(d: QuestsDto): HTMLElement[] {
    const out: HTMLElement[] = [];
    const sec = (title: string, list: AchievementGroupDto[]): void => {
      out.push(h('h3', { text: title }));
      const box = h('div', { class: 'q-achs' });
      for (const g of list) box.appendChild(this.group(g));
      out.push(box);
    };
    const gs = d.achievements;
    sec('Chiêu mộ & thu thập', gs.filter((g) => g.id === 'draws' || g.id === 'cards' || g.id === 'collect'));
    sec('Ngọc Ngũ Hành', gs.filter((g) => g.id.startsWith('gem-')));
    sec('Đấu trường', gs.filter((g) => g.id.startsWith('pvp-')));
    sec('Sưu tầm theo phe', gs.filter((g) => g.id.startsWith('fcollect-')));
    sec('Sở hữu thẻ theo cấp', gs.filter((g) => g.id.startsWith('own-')));
    sec('Sở hữu Ngọc theo cấp', gs.filter((g) => g.id.startsWith('gem-ownlv-')));
    out.push(
      h('p', { class: 'muted small', text:
        'Mỗi mốc chỉ nhận 1 lần, không reset. Thẻ được người khác tặng không tính vào chiêu mộ/sưu tầm/số thẻ đã nhận. Thành tựu đấu trường chỉ tính số trận bạn chủ động khiêu chiến.' }),
    );
    return out;
  }

  private group(g: AchievementGroupDto): HTMLElement {
    const claimable = g.items.filter((i) => i.status === 'claimable');
    const next = g.items.find((i) => i.status === 'progress');
    const done = g.items.filter((i) => i.status === 'claimed').length;
    const pool = g.items[0]?.reward.pool ?? 'normal';

    const box = h('div', { class: `q-ach ${claimable.length ? 'has-claim' : ''}` });
    box.appendChild(h('div', { class: 'q-ach-head' }, h('b', { text: g.title }), h('span', { class: 'muted small', text: `${done}/${g.items.length} mốc` })));
    box.appendChild(h('span', { class: 'muted small' }, `${g.desc}: `, h('b', { class: 'q-val', text: num(g.progress) })));

    if (next) {
      box.appendChild(h('div', { class: 'q-next small' }, `Mốc kế: ${next.name} `, rewardChip(next.reward.pool, next.reward.count)));
      box.appendChild(bar(next.progress, next.target));
    } else if (!claimable.length) {
      box.appendChild(h('div', { class: 'q-next small q-done', text: '✓ Đã hoàn thành mọi mốc' }));
    }

    if (claimable.length) {
      const total = claimable.reduce((s, i) => s + i.reward.count, 0);
      const b = h('button', { class: 'btn primary small', text: `Nhận ${claimable.length} mốc · +${num(total)} ${TICKET_LABELS[pool]}` });
      b.disabled = this.busy;
      b.addEventListener('click', () => void this.claim(claimable.map((i) => i.key)));
      box.appendChild(b);
    }

    const details = h('details', { class: 'q-ms' }, h('summary', { class: 'muted small', text: 'Xem các mốc' }));
    const chips = h('div', { class: 'q-chips' });
    for (const i of g.items) {
      chips.appendChild(h('span', { class: `q-chip ${i.status}`, attrs: { title: i.name }, text: `${num(i.target)} → ${num(i.reward.count)}` }));
    }
    details.appendChild(chips);
    box.appendChild(details);
    return box;
  }
}
