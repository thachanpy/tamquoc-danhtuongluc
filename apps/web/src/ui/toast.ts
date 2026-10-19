import { emit, GameEvents, type ToastTone } from '../core/events.ts';

/**
 * Thông báo nổi ngắn ở đáy màn hình.
 *
 * Giữ nguyên hành vi bản cũ (`ui.ts`): phần tử `.toast` gắn vào `document.body`, tự xoá sau `ms`.
 * Phát kèm sự kiện `ui:toast` để lớp khác (âm thanh, hiệu ứng) có thể bắt nếu cần.
 */
export function toast(text: string, ms = 4000, tone: ToastTone = 'info'): void {
  emit(GameEvents.Toast, { message: text, durationMs: ms, tone });
  const el = document.createElement('div');
  el.className = tone === 'info' ? 'toast' : `toast tone-${tone}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
