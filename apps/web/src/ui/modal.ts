import { h, type Child } from './dom.ts';

/** Tham số mở một lớp phủ (modal) dùng chung cho các trang. */
export type OverlayOptions = {
  /** Class của lớp phủ toàn màn hình (VD `gc-popup`, `market-modal`). */
  className: string;
  /** Class của hộp nội dung bên trong (VD `panel gc-popup-box`). */
  boxClass: string;
  content: Child[];
  /** Bấm vùng nền để đóng — mặc định BẬT (sở thích của chủ dự án). */
  closeOnBackdrop?: boolean;
  /** Nhấn Esc để đóng — mặc định BẬT. */
  esc?: boolean;
  /** Gọi sau khi lớp phủ đã bị gỡ (dọn state, nạp lại dữ liệu…). */
  onClose?: () => void;
};

/**
 * Mở một lớp phủ gắn vào `document.body` và trả về hàm đóng.
 *
 * Dùng chung cho mọi modal của game (xem thẻ, mua bán ở Chợ, xác nhận…) để hành vi nhất quán:
 * bấm nền ngoài hoặc Esc là đóng, nền mờ `backdrop-filter` do CSS của từng lớp phủ quyết định.
 */
export function openOverlay(opts: OverlayOptions): () => void {
  const box = h('div', { class: opts.boxClass }, ...opts.content);
  const root = h('div', { class: opts.className, attrs: { role: 'dialog', 'aria-modal': 'true' } }, box);
  document.body.appendChild(root);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (opts.esc !== false) document.removeEventListener('keydown', onKey);
    root.remove();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  if (opts.closeOnBackdrop !== false) {
    root.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) close();
    });
  }
  if (opts.esc !== false) document.addEventListener('keydown', onKey);

  return close;
}

/**
 * Bảng "đang tải" / thông báo trạng thái / lỗi dùng chung cho các trang.
 * `retry` (nếu có) hiện thêm nút "Thử lại".
 */
export function stateMessage(text: string, opts?: { error?: boolean; retry?: () => void }): HTMLElement {
  const el = h('div', { class: opts?.error ? 'state-msg error' : 'state-msg' }, text);
  if (opts?.retry) {
    el.appendChild(document.createTextNode(' '));
    el.appendChild(h('button', { class: 'btn ghost', text: 'Thử lại', on: { click: opts.retry } }));
  }
  return el;
}
