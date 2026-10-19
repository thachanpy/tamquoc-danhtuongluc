import Phaser from 'phaser';
import { SceneKeys, type SceneKey } from '../core/SceneKeys.ts';
import { PAGES, readRoute, tabsFor, type PageId } from '../core/routes.ts';
import { api } from '../services/api.ts';
import { setToken } from '../services/http.ts';
import { pendingBadge, profile, questBadge, resetSession, setPvpTarget, state } from '../state/store.ts';
import { refreshQuestBadge } from '../state/badges.ts';
import { audioControl } from '../ui/AudioControl.ts';
import { avatarEl } from '../ui/Avatar.ts';
import { h } from '../ui/dom.ts';
import { maybeShowGiftCodePopup } from '../ui/giftcode-popup.ts';
import { ticketsBar } from '../ui/TicketsBar.ts';

/**
 * Khung game: thanh trên (thương hiệu, thanh vé, tài khoản) + thanh tab + vùng nội dung `<main id="page">`.
 *
 * Scene này giữ nguyên suốt phiên chơi; mỗi trang là một Scene riêng được `launch`/`stop` theo
 * hash định tuyến, và tự gắn DOM của nó vào `#page` (xem `PageScene`). Nhờ vậy chuyển tab không
 * phải dựng lại thanh trên, còn mỗi trang vẫn có vòng đời riêng để nạp/dỡ dữ liệu.
 */
export class ShellScene extends Phaser.Scene {
  private root?: HTMLElement;
  private navEl?: HTMLElement;
  private current?: SceneKey;
  private disposers: (() => void)[] = [];

  constructor() {
    super(SceneKeys.Shell);
  }

  create(): void {
    const ui = document.getElementById('ui-root');
    if (!ui) {
      console.warn('[Shell] thiếu #ui-root');
      return;
    }

    this.root = this.buildShell();
    ui.appendChild(this.root);
    this.track(() => this.root?.remove());

    this.bindRouting();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('hashchange', this.onHash);
      this.stopCurrent();
      for (const d of this.disposers) d();
      this.disposers = [];
    });

    if (!state.isAdmin) void maybeShowGiftCodePopup();
    this.openRoute(readRoute());
  }

  // ======================= Dựng DOM khung =======================

  private buildShell(): HTMLElement {
    const head = h('div', { class: 'app-head' });

    const user = h('div', { class: 'user' }, audioControl());
    user.appendChild(
      h(
        'span',
        { class: 'user-id' },
        avatarEl({ avatar: profile.get().avatar, name: profile.get().displayName, class: 'head-avatar' }),
        h('span', { class: 'user-name', text: profile.get().displayName || state.username }),
      ),
    );
    const logoutBtn = h('button', { class: 'btn ghost small', text: 'Đăng xuất' });
    logoutBtn.addEventListener('click', () => void this.logout());
    user.appendChild(logoutBtn);

    const top = h(
      'header',
      { class: 'top' },
      h(
        'div',
        { class: 'brand' },
        h('img', { class: 'logo', attrs: { src: '/icons/icon-192.png', alt: '', 'aria-hidden': 'true' } }),
        'Tam Quốc',
        h('i', { class: 'brand-sep', text: ':' }),
        ' ',
        h('span', { text: 'Vô Song' }),
      ),
    );
    if (!state.isAdmin) {
      const bar = ticketsBar();
      top.appendChild(bar.el);
      this.track(bar.dispose);
    }
    top.appendChild(user);

    this.navEl = h('nav', { class: 'tabs' });
    this.drawTabs();

    head.append(top, this.navEl);
    const page = h('main', { attrs: { id: 'page' } });

    // Đo chiều cao thanh trên để các phần dính khác (VD khung "Đã chọn" ở Nâng cấp) nằm ngay dưới.
    const sync = (): void => document.documentElement.style.setProperty('--head-h', `${head.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(head);
    this.track(() => ro.disconnect());

    return h('div', {}, head, page);
  }

  /** Vẽ thanh tab + badge (Nhiệm vụ: phần thưởng chờ nhận; Quản trị: tài khoản chờ duyệt). */
  private drawTabs(): void {
    const nav = this.navEl;
    if (!nav) return;
    nav.replaceChildren();
    for (const [id, def] of tabsFor(state.isAdmin)) {
      const badgeValue = def.adminOnly ? pendingBadge.get() : id === 'quests' ? questBadge.get() : 0;
      const badge = h('span', { class: 'badge', text: badgeValue, attrs: { hidden: badgeValue === 0 } });
      const a = h('a', { class: 'tabs-link', attrs: { href: `#${id}`, 'data-tab': id } }, def.label, ' ', badge);
      nav.appendChild(a);
    }
    this.markActive();
  }

  /** Đánh dấu tab đang mở, đồng thời đưa tab đó vào tầm nhìn (thanh tab cuộn ngang trên mobile). */
  private markActive(): void {
    const id = this.routeId;
    const nav = this.navEl;
    if (!nav) return;
    for (const a of nav.querySelectorAll<HTMLAnchorElement>('[data-tab]')) a.classList.toggle('on', a.dataset.tab === id);
    queueMicrotask(() => nav.querySelector<HTMLAnchorElement>(`[data-tab="${id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }

  // ======================= Định tuyến =======================

  private routeId: PageId = 'collection';

  private bindRouting(): void {
    window.addEventListener('hashchange', this.onHash);
    // Badge thay đổi (nhận nhiệm vụ, duyệt tài khoản…) thì vẽ lại thanh tab.
    this.track(questBadge.subscribe(() => this.drawTabs()));
    this.track(pendingBadge.subscribe(() => this.drawTabs()));
  }

  private onHash = (): void => this.openRoute(readRoute());

  /** Mở trang theo hash: dừng trang cũ, chạy Scene của trang mới. */
  private openRoute(route: { id: PageId; pvpOpponentId: number | null }): void {
    this.routeId = route.id;
    setPvpTarget(route.pvpOpponentId);
    const key = PAGES[route.id].scene;
    // Đấu trường: đổi đối thủ trên cùng hash cũng phải khởi động lại để nạp đúng đối thủ.
    if (key === this.current && route.id !== 'pvp') {
      this.markActive();
      return;
    }
    this.markActive();
    if (route.id !== 'quests' && !state.isAdmin) void refreshQuestBadge();
    this.openScene(key, { opponentId: route.pvpOpponentId });
  }

  /** Dừng trang đang mở rồi chạy Scene trang mới (nếu Scene đó đã được đăng ký). */
  private openScene(key: SceneKey, data?: object): void {
    this.stopCurrent();
    if (!(key in this.scene.manager.keys)) {
      // Trang chưa port xong: hiện thông báo tạm trong #page.
      const page = document.getElementById('page');
      if (page) page.innerHTML = '<div class="state-msg">Trang này đang được chuyển đổi sang Phaser — sắp có.</div>';
      return;
    }
    this.current = key;
    this.scene.launch(key, data);
  }

  private stopCurrent(): void {
    if (!this.current) return;
    this.scene.stop(this.current);
    this.current = undefined;
  }

  private async logout(): Promise<void> {
    await api.logout().catch(() => {});
    setToken(null);
    resetSession();
    this.stopCurrent();
    const page = document.getElementById('page');
    if (page) page.replaceChildren();
    this.scene.start(SceneKeys.Login);
  }

  /** Đăng ký hàm dỡ, chạy khi khung bị đóng. */
  private track(dispose: () => void): void {
    this.disposers.push(dispose);
  }
}
