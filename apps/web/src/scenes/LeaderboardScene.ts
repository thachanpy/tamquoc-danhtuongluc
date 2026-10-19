import type { LeaderboardDto, LeaderboardEntryDto } from '@tq/shared';
import { rankIconUrl } from '../assets/art.ts';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api } from '../services/api.ts';
import { setPvpTarget } from '../state/store.ts';
import { avatarEl } from '../ui/Avatar.ts';
import { h, render } from '../ui/dom.ts';
import { PageScene } from '../ui/PageScene.ts';
import { num } from '../utils/format.ts';

const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/** Mở Đấu trường với đối thủ đã chọn (#pvp/<id>, mục 6.7). */
function challenge(id: number): void {
  setPvpTarget(id);
  location.hash = '#pvp/' + id;
}

/**
 * Huy hiệu hạng (ảnh trống chữ do chủ dự án cung cấp, public/theme/rank/r1..r4.png):
 * hạng 1, 2, 3 mỗi hạng một huy hiệu riêng; hạng 4 trở đi dùng chung r4. Số hạng do app ghi giữa mặt huy hiệu.
 */
function rankBadge(rank: number | null): HTMLElement {
  if (!rank) return h('span', { class: 'lb-rank none', text: '–' });
  const tier = rank <= 3 ? rank : 4;
  const digits = String(rank).length;
  const noClass = digits >= 4 ? 'lb-rank-no d4' : digits === 3 ? 'lb-rank-no d3' : 'lb-rank-no';
  return h(
    'span',
    { class: `lb-rank rk-${tier}`, attrs: { 'aria-label': `Hạng ${rank}` } },
    h('img', { attrs: { src: rankIconUrl(tier), alt: '', decoding: 'async' } }),
    h('b', { class: noClass, text: rank }),
  );
}

/** Một dòng người chơi trên bảng xếp hạng; bấm/kéo Enter để khiêu chiến. */
function row(e: LeaderboardEntryDto): HTMLElement {
  const podium = e.rank !== null && e.rank <= 3;
  const canFight = !e.isMe;

  const attrs: Record<string, string | number> = {};
  if (e.isMe) attrs['data-me'] = '';
  if (canFight) {
    attrs['role'] = 'button';
    attrs['tabindex'] = 0;
    attrs['title'] = `Khiêu chiến ${e.displayName}`;
  }

  const el = h('div', { class: `lb-row ${e.isMe ? 'me' : ''} ${podium ? `podium p${e.rank}` : ''}`, classOn: { clickable: canFight }, attrs });

  el.appendChild(rankBadge(e.rank));
  const name = h(
    'span',
    { class: 'lb-name' },
    avatarEl({ avatar: e.avatar, name: e.displayName, class: 'lb-avatar' }),
    h('span', { class: 'lb-name-text', text: e.displayName }),
  );
  if (e.isMe) name.append(' ', h('span', { class: 'lb-you', text: 'Bạn' }));
  el.appendChild(name);
  el.appendChild(h('b', { class: 'lb-power', text: num(e.lc) }));
  if (canFight) el.appendChild(h('span', { class: 'lb-fight', attrs: { 'aria-hidden': 'true' }, text: '⚔' }));

  if (canFight) {
    el.addEventListener('click', () => challenge(e.id));
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        challenge(e.id);
      }
    });
  }
  return el;
}

/**
 * Bảng xếp hạng Lực chiến (mục 6.6). Chỉ hiển thị dữ liệu server tính sẵn.
 * Khung danh sách cao vừa top 10; cuộn trong khung để xem tới top 100. Hạng của mình hiện ở cuối bảng.
 */
export class LeaderboardScene extends PageScene {
  constructor() {
    super(SceneKeys.Leaderboard);
  }

  // KHÔNG dùng tên `data`: trùng thuộc tính `Scene.data` (DataManager) của Phaser.
  private board: LeaderboardDto | null = null;
  private error = '';
  private loading = false;
  private alive = true;

  private listEl!: HTMLElement;
  private refreshBtn!: HTMLButtonElement;
  private footEl!: HTMLElement;
  private meEl!: HTMLElement;

  protected build(): HTMLElement {
    const root = h('section', { class: 'panel lb-panel' });

    this.refreshBtn = h('button', { class: 'btn ghost small', text: 'Làm mới' });
    this.refreshBtn.addEventListener('click', () => void this.fetchBoard());
    root.appendChild(h('div', { class: 'lb-head' }, h('h2', { text: 'Bảng xếp hạng · Lực chiến' }), this.refreshBtn));

    root.appendChild(
      h('p', { class: 'muted small lb-rule', text:
        'Lực chiến = TỔNG Lực chiến (LC) của đội hình đang dùng: cộng LC từng tướng theo cấp (đội đã lưu, hoặc đội tự động 6 tướng mạnh nhất nếu chưa lưu). Nâng cấp tướng trong đội để leo hạng. Đồng Lực chiến thì đồng hạng. Bấm vào một người chơi để khiêu chiến ở Đấu trường.' }),
    );

    // Danh sách: top 10 nổi bật, sau đó vạch chia rồi tới top 100
    this.listEl = h('div', { class: 'lb-list', attrs: { tabindex: 0, 'aria-label': 'Bảng xếp hạng' } });
    root.appendChild(this.listEl);

    this.footEl = h('div', { class: 'muted small lb-foot' });
    root.appendChild(this.footEl);

    // Hạng của mình — đặt cuối bảng
    this.meEl = h('div', { class: 'lb-me', attrs: { 'aria-live': 'polite' } });
    root.appendChild(this.meEl);

    this.track(() => {
      this.alive = false;
    });

    return root;
  }

  protected loadData(): void {
    void this.fetchBoard();
  }

  private async fetchBoard(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.refresh();
    try {
      const d = await api.leaderboard();
      if (!this.alive) return;
      this.error = '';
      this.board = d;
      this.listEl.scrollTop = 0;
    } catch (e) {
      if (this.alive) this.error = (e as Error).message;
    } finally {
      this.loading = false;
      if (this.alive) this.refresh();
    }
  }

  private refresh(): void {
    if (!this.alive) return;
    this.refreshBtn.disabled = this.loading;
    this.drawList();
    this.drawFoot();
    this.drawMe();
  }

  private drawList(): void {
    const d = this.board;
    if (this.error) {
      render(this.listEl, h('div', { class: 'state-msg error', text: this.error }));
      return;
    }
    if (!d) {
      render(this.listEl, h('div', { class: 'state-msg', text: 'Đang tải bảng xếp hạng…' }));
      return;
    }
    if (!d.items.length) {
      render(this.listEl, h('div', { class: 'state-msg', text: 'Chưa có người chơi nào được xếp hạng.' }));
      return;
    }

    const kids: HTMLElement[] = [];
    for (const e of d.items.slice(0, d.top)) kids.push(row(e));
    if (d.items.length > d.top) {
      kids.push(h('div', { class: 'lb-divider', text: `Top ${d.top + 1}–${d.items.length} · cuộn để xem` }));
      for (const e of d.items.slice(d.top)) kids.push(row(e));
    }
    render(this.listEl, ...kids);
  }

  private drawFoot(): void {
    const d = this.board;
    if (!d) {
      render(this.footEl);
      return;
    }
    render(this.footEl, `${num(d.totalRanked)} người chơi được xếp hạng · cập nhật lúc ${time(d.generatedAt)}`);
  }

  private drawMe(): void {
    const d = this.board;
    if (!d) {
      render(this.meEl);
      return;
    }
    if (!d.me) {
      render(this.meEl, h('div', { class: 'lb-me-box muted', text: 'Tài khoản quản trị không tham gia xếp hạng.' }));
      return;
    }

    const me = d.me;
    if (me.rank === null) {
      render(
        this.meEl,
        h('div', { class: 'lb-me-box' }, h('b', { text: 'Bạn chưa có tướng nào' }), ' — quay thẻ và xếp đội để có tên trên bảng xếp hạng.'),
      );
      return;
    }

    const box = h(
      'div',
      { class: 'lb-me-box' },
      h('span', { class: 'muted small', text: 'Hạng của bạn' }),
      h(
        'div',
        { class: 'lb-row me' },
        rankBadge(me.rank),
        h('span', { class: 'lb-name' }, avatarEl({ avatar: me.avatar, name: me.displayName, class: 'lb-avatar' }), h('span', { class: 'lb-name-text', text: me.displayName })),
        h('b', { class: 'lb-power', text: num(me.lc) }),
      ),
    );

    if (d.items.some((e) => e.isMe) && (me.rank ?? 0) > d.top) {
      const b = h('button', { class: 'btn ghost small', text: 'Xem vị trí của tôi' });
      b.addEventListener('click', () => this.gotoMe());
      box.appendChild(b);
    }
    if (!d.items.some((e) => e.isMe)) box.appendChild(h('span', { class: 'muted small', text: `Ngoài top ${d.items.length}.` }));

    render(this.meEl, box);
  }

  private gotoMe(): void {
    const mine = this.listEl.querySelector<HTMLElement>('[data-me]');
    if (mine) this.listEl.scrollTo({ top: mine.offsetTop - this.listEl.clientHeight / 2 + mine.offsetHeight / 2, behavior: 'smooth' });
  }
}
