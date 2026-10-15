/** Thông báo nổi ngắn ở đáy màn hình (chỉ hiển thị). */
export function toast(text: string, ms = 4000) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
