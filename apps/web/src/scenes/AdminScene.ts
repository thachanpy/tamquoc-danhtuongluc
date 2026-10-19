import { SceneKeys } from '../core/SceneKeys.ts';
import { state } from '../state/store.ts';
import { CardsPane } from '../ui/admin/cards-pane.ts';
import { GachaRatesPane } from '../ui/admin/gacha-rates-pane.ts';
import { GemsPane } from '../ui/admin/gems-pane.ts';
import { GiftCodePane } from '../ui/admin/giftcode-pane.ts';
import { PvpGemsPane } from '../ui/admin/pvp-gems-pane.ts';
import { PvpHeroesPane } from '../ui/admin/pvp-heroes-pane.ts';
import { UsersPane } from '../ui/admin/users-pane.ts';
import { h } from '../ui/dom.ts';
import { PageScene } from '../ui/PageScene.ts';

/** Bảy tab của trang Quản trị. */
type Sub = 'users' | 'cards' | 'gems' | 'giftcode' | 'pvpheros' | 'pvpgems' | 'gacharates';

/** Nhãn tab, theo đúng thứ tự của bản SolidJS cũ. */
const TABS: [Sub, string][] = [
  ['users', 'Người chơi'],
  ['cards', 'Thẻ tướng'],
  ['gems', 'Ngọc'],
  ['giftcode', 'Giftcode'],
  ['pvpheros', 'Cấu hình Tướng'],
  ['pvpgems', 'Cấu hình Ngọc'],
  ['gacharates', 'Tỉ lệ quay'],
];

/** Pane đã dựng, kèm cách gọi `ensureLoaded` và dỡ khi rời trang. */
type ManagedPane = { el: HTMLElement; ensureLoaded: () => void; dispose: () => void };

/**
 * Trang Quản trị (mục 3.8): chỉ admin thấy tab này; server vẫn kiểm tra quyền ở mọi route `/api/admin/*`.
 *
 * Mỗi tab là một lớp "pane" riêng trong `src/ui/admin/` (xem `shared.ts`); Scene chỉ giữ thanh tab,
 * ẩn/hiện vùng chứa và gọi `ensureLoaded()` cho pane vừa mở. Pane được DỰNG LƯỜI ở lần mở đầu tiên
 * nên vào trang Quản trị không gọi dữ liệu của cả 7 tab cùng lúc.
 */
export class AdminScene extends PageScene {
  private alive = true;
  private sub: Sub = 'users';

  private readonly tabBtns = new Map<Sub, HTMLButtonElement>();
  private readonly hosts = new Map<Sub, HTMLElement>();
  private readonly panes = new Map<Sub, ManagedPane>();
  /** Tham chiếu riêng tab Thẻ tướng để nhảy sang đúng người chơi vừa bấm "Xem thẻ". */
  private cards: CardsPane | null = null;

  constructor() {
    super(SceneKeys.Admin);
  }

  protected build(): HTMLElement {
    this.track(() => {
      this.alive = false;
      for (const p of this.panes.values()) p.dispose();
      this.panes.clear();
    });

    const tabbar = h('div', { class: 'sub-tabs', attrs: { role: 'tablist' } });
    for (const [id, label] of TABS) {
      const btn = h('button', { class: 'btn small', attrs: { 'data-sub': id, role: 'tab' }, text: label });
      btn.addEventListener('click', () => this.switchTo(id));
      this.tabBtns.set(id, btn);
      tabbar.appendChild(btn);
    }

    const body = h('div');
    for (const [id] of TABS) {
      const host = h('div', { attrs: { 'data-pane': id } });
      host.hidden = id !== this.sub;
      this.hosts.set(id, host);
      body.appendChild(host);
    }

    return h('section', { class: 'panel admin' }, tabbar, body);
  }

  protected loadData(): void {
    // Chốt chặn cuối: tuyến đã lọc theo quyền, nhưng vẫn không mở trang này cho người chơi thường.
    if (!state.isAdmin) {
      queueMicrotask(() => this.goHome());
      return;
    }
    this.activate(this.sub);
    this.ensurePane(this.sub).ensureLoaded();
  }

  /** Đổi tab: đánh dấu nút đang chọn + ẩn/hiện vùng chứa. */
  private activate(id: Sub): void {
    this.sub = id;
    for (const [k, btn] of this.tabBtns) btn.classList.toggle('on', k === id);
    for (const [k, host] of this.hosts) host.hidden = k !== id;
  }

  private switchTo(id: Sub): void {
    this.activate(id);
    this.ensurePane(id).ensureLoaded();
  }

  /** Nhảy sang tab Thẻ tướng với bộ lọc đúng người chơi (gọi từ tab Người chơi). */
  private viewCards(userId: number): void {
    this.ensurePane('cards');
    this.activate('cards');
    // `showUser` tự nạp lại danh sách nên không gọi thêm `ensureLoaded` (tránh 2 lượt gọi trùng).
    this.cards?.showUser(userId);
  }

  private ensurePane(id: Sub): ManagedPane {
    const existing = this.panes.get(id);
    if (existing) return existing;
    const pane = this.createPane(id);
    this.hosts.get(id)?.appendChild(pane.el);
    this.panes.set(id, pane);
    return pane;
  }

  private createPane(id: Sub): ManagedPane {
    const alive = (): boolean => this.alive;
    switch (id) {
      case 'users':
        return wrap(new UsersPane({ alive, viewCards: (uid) => this.viewCards(uid) }));
      case 'cards': {
        const pane = new CardsPane({ alive });
        this.cards = pane;
        return wrap(pane);
      }
      case 'gems':
        return wrap(new GemsPane({ alive }));
      case 'giftcode':
        return wrap(new GiftCodePane({ alive }));
      case 'pvpheros':
        return wrap(new PvpHeroesPane({ alive }));
      case 'pvpgems':
        return wrap(new PvpGemsPane({ alive }));
      case 'gacharates':
        return wrap(new GachaRatesPane({ alive }));
    }
  }
}

/**
 * Bọc một pane (tự dựng DOM, tự nạp dữ liệu) thành điều khiển thống nhất cho Scene.
 * Tab Người chơi tự nạp ngay khi dựng nên không cần `ensureLoaded`.
 */
function wrap(pane: { el: HTMLElement; ensureLoaded?: () => void; dispose?: () => void }): ManagedPane {
  return {
    el: pane.el,
    ensureLoaded: () => pane.ensureLoaded?.(),
    dispose: () => pane.dispose?.(),
  };
}
