import { initials } from '../assets/art.ts';
import { h } from './dom.ts';

/**
 * Ảnh đại diện người chơi: chữ cái đầu của tên hiển thị làm lớp nền, ảnh thật phủ lên trên
 * và tự ẩn khi tải lỗi (404, đổi định dạng…) nên luôn còn chữ cái đầu làm dự phòng.
 * Kích thước do class CSS quyết định (`.avatar` + class bổ sung).
 */
export function avatarEl(input: { avatar: string | null; name: string; class?: string }): HTMLElement {
  const img = input.avatar ? h('img', { attrs: { src: input.avatar, alt: '' } }) : null;
  // Ảnh lỗi thì ẩn đi để lộ chữ cái đầu bên dưới.
  img?.addEventListener('error', () => {
    img.style.display = 'none';
  });
  return h(
    'span',
    { class: input.class ? `avatar ${input.class}` : 'avatar', attrs: { 'aria-hidden': 'true' } },
    h('span', { class: 'avatar-ini', text: initials(input.name) }),
    img,
  );
}
