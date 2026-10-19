import { SceneKeys, type SceneKey } from './SceneKeys.ts';
import { state } from '../state/store.ts';

/** Một mục trong thanh tab: nhãn hiển thị + Scene tương ứng. */
export type PageDef = { label: string; scene: SceneKey; adminOnly?: boolean };

/**
 * Danh mục trang của game — một nguồn sự thật cho cả thanh tab lẫn định tuyến theo hash.
 * Thứ tự trong object cũng là thứ tự tab hiển thị (giữ nguyên như bản SolidJS cũ).
 */
export const PAGES = {
  collection: { label: 'Bộ sưu tập', scene: SceneKeys.Collection },
  pvp: { label: 'Đấu trường', scene: SceneKeys.Pvp },
  draw: { label: 'Quay thẻ', scene: SceneKeys.Draw },
  upgrade: { label: 'Nâng cấp', scene: SceneKeys.Upgrade },
  market: { label: 'Chợ thẻ', scene: SceneKeys.Market },
  quests: { label: 'Nhiệm vụ', scene: SceneKeys.Quests },
  leaderboard: { label: 'Xếp hạng', scene: SceneKeys.Leaderboard },
  history: { label: 'Lịch sử', scene: SceneKeys.History },
  giftcode: { label: 'Giftcode', scene: SceneKeys.GiftCode },
  profile: { label: 'Hồ sơ', scene: SceneKeys.Profile },
  admin: { label: 'Quản trị', scene: SceneKeys.Admin, adminOnly: true },
} satisfies Record<string, PageDef>;

export type PageId = keyof typeof PAGES;

/** Kết quả đọc hash: trang cần mở + đối thủ PvP (nếu hash dạng `#pvp/<id>`). */
export type Route = { id: PageId; pvpOpponentId: number | null };

/**
 * Đọc trang hiện tại từ hash. Tài khoản quản trị chỉ thấy trang Quản trị (chủ dự án yêu cầu);
 * hash hợp lệ nhưng không có quyền thì rơi về Bộ sưu tập (hoặc Quản trị với admin).
 */
export function readRoute(): Route {
  const fallback: PageId = state.isAdmin ? 'admin' : 'collection';
  const raw = location.hash.slice(1) || fallback;
  // Đấu trường nhận thêm id đối thủ: #pvp/<id> (bấm người chơi ở bảng xếp hạng, mục 6.7)
  const [base, arg] = raw.split('/');
  const id = (base === 'gift' ? 'collection' : base) as PageId;
  const def: PageDef | undefined = PAGES[id];
  if (!def || !!def.adminOnly !== state.isAdmin) return { id: fallback, pvpOpponentId: null };
  return { id, pvpOpponentId: id === 'pvp' && arg ? Number(arg) || null : null };
}

/** Danh sách tab hiển thị theo quyền: admin chỉ có tab Quản trị, người chơi có mọi tab còn lại. */
export function tabsFor(isAdmin: boolean): [PageId, PageDef][] {
  return (Object.entries(PAGES) as [PageId, PageDef][]).filter(([, p]) => !!p.adminOnly === isAdmin);
}
