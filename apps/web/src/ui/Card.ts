import { FACTION_LABELS, PVP_STYLE_LABELS, type GeneralDto } from '@tq/shared';
import { FACTION_STYLE, FRAME_LAYOUT, STYLE_COLOR, frameUrl, initials, levelTier, portraitUrl } from '../assets/art.ts';
import { genStyle } from '../state/store.ts';
import { h } from './dom.ts';
import { styleIcon } from './StyleIcon.ts';

/**
 * Thẻ tướng (lưới DOM): chân dung tướng, placeholder (glyph phe + chữ viết tắt) nằm dưới làm dự phòng,
 * khung theo cấp phủ lên trên. level = null => tướng chưa sở hữu (hiển thị mờ).
 * Huy hiệu góc trên-trái cho biết phong cách chiến đấu (mục 6.7): Tấn công / Phòng thủ / Hỗ trợ.
 * Class CSS giữ nguyên như bản HTML cũ (.tq-card, .framed, .tier-N, .unowned …).
 */
export function cardEl(input: { general: GeneralDto; level: number | null; extra?: string }): HTMLElement {
  const { general } = input;
  const f = FACTION_STYLE[general.faction];
  const style = genStyle(general.id);
  const lv = input.level ? Math.min(Math.max(input.level, 1), 10) : null;
  const tier = input.level ? levelTier(input.level) : null;

  // Ảnh lỗi thì gỡ hẳn để lộ placeholder (glyph phe + chữ viết tắt) bên dưới.
  const portrait = h('img', {
    class: 'portrait',
    attrs: { src: portraitUrl(general.artKey), alt: '', loading: 'lazy', decoding: 'async' },
  });
  portrait.addEventListener('error', () => portrait.remove());

  const art = h(
    'div',
    { class: 'tq-art' },
    h('span', { class: 'glyph', text: f.glyph }),
    h('span', { class: 'ini', text: initials(general.name) }),
    portrait,
    // Huy hiệu phong cách: chỉ dùng icon (kiếm/khiên/sách), nhãn chữ nằm ở tooltip
    h('span', { class: 'tq-role', attrs: { title: PVP_STYLE_LABELS[style] } }, styleIcon(style)),
  );
  art.querySelector<HTMLElement>('.tq-role')!.style.color = STYLE_COLOR[style];

  const sub = h('div', { class: 'tq-sub' }, h('span', { class: 'fac', text: FACTION_LABELS[general.faction] }));
  if (input.level) sub.appendChild(h('span', { class: 'lv', text: `Lv.${input.level}` }));
  else sub.appendChild(h('span', { class: 'lv dim', text: 'Chưa có' }));

  const body = h(
    'div',
    { class: 'tq-body' },
    art,
    h('div', { class: 'tq-meta' }, h('div', { class: 'tq-name', text: general.name }), sub),
  );

  const classes = ['tq-card', lv ? `framed tier-${lv}` : 'unowned'];
  if (input.extra) classes.push(input.extra);
  const root = h('div', { class: classes.join(' '), attrs: { 'data-art': general.artKey } }, body);

  root.style.setProperty('--fc', f.css);
  root.style.setProperty('--fd', f.dark);
  root.style.setProperty('--tc', tier?.css ?? '#444');

  if (lv) {
    const fl = FRAME_LAYOUT[lv]!;
    const frame = h('span', { class: 'tq-frame', attrs: { 'aria-hidden': 'true' } });
    frame.style.backgroundImage = `url(${frameUrl(lv)})`;
    frame.style.left = `${fl.left}%`;
    frame.style.top = `${fl.top}%`;
    frame.style.width = `${fl.width}%`;
    frame.style.height = `${fl.height}%`;
    root.appendChild(frame);
  }

  return root;
}
