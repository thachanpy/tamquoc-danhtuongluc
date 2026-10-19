import type { AdminUserDto } from '@tq/shared';
import { api } from '../../services/api.ts';
import { h } from '../dom.ts';

/**
 * Phần dùng chung cho các pane của trang Quản trị.
 *
 * Trang Quản trị gồm 7 tab; mỗi tab là một lớp "pane" độc lập (file riêng) tự dựng DOM và tự
 * nạp dữ liệu của mình — chủ dự án ưu tiên tách module rõ ràng thay vì dồn hết vào một Scene.
 * `AdminScene` chỉ giữ danh sách tab và gọi `ensureLoaded()` cho pane vừa được mở.
 */

/** Điều khiển pane: Scene gọi khi người dùng mở tab (chỉ nạp lần đầu). */
export interface PaneCtl {
  ensureLoaded(): void;
}

/** Trạng thái nạp của một danh sách. */
export type Load = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready' };

/** Thông báo có đoạn in đậm xen giữa (thay HTML `<b>` của bản cũ). */
export type MsgPart = string | { b: string };
export type Msg = { ok: boolean; parts: MsgPart[] } | null;

/** Đánh dấu một đoạn in đậm trong thông báo. */
export const b = (s: string | number): MsgPart => ({ b: String(s) });

/** Dựng hộp thông báo; trả `null` khi không có gì để hiện. */
export function msgBox(msg: Msg): HTMLElement | null {
  if (!msg) return null;
  const el = h('div', { class: msg.ok ? 'notice' : 'warn' });
  for (const p of msg.parts) {
    if (typeof p === 'string') el.appendChild(document.createTextNode(p));
    else el.appendChild(h('b', { text: p.b }));
  }
  return el;
}

/** Khối trạng thái vùng danh sách: đang tải / lỗi / rỗng. */
export function loadBlock(s: Load, emptyText = 'Không có dữ liệu phù hợp.'): HTMLElement {
  if (s.kind === 'loading') return h('div', { class: 'state-msg', text: 'Đang tải…' });
  if (s.kind === 'error') return h('div', { class: 'state-msg error', text: s.text });
  return h('div', { class: 'state-msg', text: emptyText });
}

/** Thông tin phân trang hiển thị dưới danh sách. */
export type PagerInfo = { page: number; pages: number };

/**
 * Thanh phân trang ‹ Trước / Trang x/y / Sau ›.
 * Trả kèm hàm `set(info)` để pane cập nhật nhãn và trạng thái nút tại chỗ (không dựng lại DOM).
 */
export function createPager(opts: { onPrev: () => void; onNext: () => void }): { el: HTMLElement; set: (info: PagerInfo | null) => void } {
  const prev = h('button', { class: 'btn ghost', attrs: { 'data-prev': true }, text: '‹ Trước' });
  const label = h('span', { class: 'pinfo muted' });
  const next = h('button', { class: 'btn ghost', attrs: { 'data-next': true }, text: 'Sau ›' });
  prev.addEventListener('click', () => opts.onPrev());
  next.addEventListener('click', () => opts.onNext());
  const el = h('div', { class: 'pager' }, prev, label, next);
  const set = (info: PagerInfo | null): void => {
    prev.disabled = !!info && info.page <= 1;
    next.disabled = !!info && info.page >= info.pages;
    label.textContent = info ? `Trang ${info.page}/${info.pages}` : '';
  };
  return { el, set };
}

/**
 * Đổ lại danh sách `<option>` của một `<select>`, giữ nguyên giá trị đang chọn nếu còn.
 * Option đầu tiên có giá trị rỗng (vd "Mọi phe", "Mọi level") luôn được giữ lại làm dòng mặc định.
 */
export function fillOptions(sel: HTMLSelectElement, items: { value: string; label: string }[], keep = true): void {
  const current = keep ? sel.value : '';
  const head = sel.firstElementChild;
  const placeholder = head instanceof HTMLOptionElement && head.value === '' ? head : null;
  while (sel.firstChild) sel.removeChild(sel.firstChild);
  if (placeholder) sel.appendChild(placeholder);
  for (const it of items) sel.appendChild(h('option', { attrs: { value: it.value }, text: it.label }));
  sel.value = current;
}

/** Ô chọn người chơi (dùng chung tab Thẻ tướng và tab Ngọc). */
export interface UserSelect {
  el: HTMLSelectElement;
  /** Nạp danh sách người chơi đã duyệt (chỉ gọi API một lần). */
  load(): Promise<void>;
}

/**
 * Dựng `<select>` "Mọi người chơi" nạp một lần danh sách tài khoản đã duyệt (tối đa 500).
 * Lỗi mạng thì cho phép gọi lại ở lần mở tab sau (`req` được đặt lại null).
 */
export function createUserSelect(alive: () => boolean, onChange: (value: string) => void): UserSelect {
  const sel = h('select', { attrs: { 'aria-label': 'Người chơi' } }, h('option', { attrs: { value: '' }, text: 'Mọi người chơi' }));
  sel.addEventListener('input', () => onChange(sel.value));

  let req: Promise<void> | null = null;
  async function fetchUsers(): Promise<void> {
    try {
      const p = await api.admin.users({ status: 'approved', pageSize: 500 });
      if (!alive()) return;
      const list: AdminUserDto[] = p.items.slice().sort((a, c) => a.username.localeCompare(c.username));
      const cur = sel.value;
      while (sel.children.length > 1) sel.removeChild(sel.lastChild!);
      for (const u of list) sel.appendChild(h('option', { attrs: { value: u.id }, text: `${u.username} (${u.cardCount})` }));
      sel.value = cur;
    } catch {
      req = null;
    }
  }

  return {
    el: sel,
    load: () => (req ??= fetchUsers()),
  };
}
