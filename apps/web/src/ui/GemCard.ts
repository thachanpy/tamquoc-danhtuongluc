import { GEM_ELEMENT_LABELS, type GemElement } from '@tq/shared';
import { gemUrl, levelTier } from '../assets/art.ts';
import { h } from './dom.ts';

/**
 * Thẻ Ngọc (lưới DOM) — Ngọc là VIÊN TRÒN nên thẻ cũng là HÌNH TRÒN: ảnh viên Ngọc nằm trong ô tròn
 * viền màu theo cấp, tên + cấp là dòng chú thích ngay bên dưới (khác thẻ tướng dạng chữ nhật đứng).
 * Dùng chung ở mọi nơi hiển thị Ngọc: lưới nhóm (Nâng cấp/Bộ sưu tập), khung "Đã chọn", Quản trị, popup chi tiết.
 */
export function gemCardEl(input: { element: GemElement; level: number; extra?: string }): HTMLElement {
  const label = `Ngọc ${GEM_ELEMENT_LABELS[input.element]}`;
  const classes = ['tq-card', 'gem-face', `e-${input.element}`];
  if (input.extra) classes.push(input.extra);

  const root = h(
    'div',
    { class: classes.join(' ') },
    h(
      'div',
      { class: 'tq-body' },
      h(
        'div',
        { class: 'tq-art' },
        h('img', { class: 'gem-img', attrs: { src: gemUrl(input.element, input.level), alt: `${label} cấp ${input.level}`, loading: 'lazy' } }),
      ),
    ),
    h(
      'div',
      { class: 'tq-meta' },
      h('div', { class: 'tq-name', text: label }),
      h('div', { class: 'tq-sub' }, h('span', { class: 'fac', text: 'Ngũ Hành' }), h('span', { class: 'lv', text: `Cấp ${input.level}` })),
    ),
  );
  root.style.setProperty('--tc', levelTier(input.level).css);
  return root;
}
