import { FACTION_LABELS, type Faction, type PvpCombatDto } from '@tq/shared';
import { levelTier, prefersReducedMotion } from '../assets/art.ts';
import { combatDetailEl } from './CombatDetail.ts';
import { h } from './dom.ts';

const num = (n: number) => n.toLocaleString('vi-VN');

/** Tham số mở modal chi tiết tướng (dùng chung cho Bộ sưu tập và Đấu trường). */
export type CombatDetailOptions = {
  name: string;
  level: number;
  /** Phe của tướng — chỉ hiện nhãn khi được truyền (bộ sưu tập). */
  faction?: Faction;
  /** Chi tiết chiến đấu; chưa có thì hiện "Đang tải chỉ số…". */
  combat?: PvpCombatDto | null;
  /** Lỗi khi tải chi tiết. */
  error?: string | null;
  /** Ảnh đại diện tướng — Đấu trường truyền vào (Bộ sưu tập đã có thẻ lớn nên không cần). */
  art?: HTMLElement;
  /** Thẻ lớn — chỉ Bộ sưu tập truyền; không có thì modal chỉ gồm ảnh đại diện + bảng chi tiết. */
  card?: HTMLElement;
  /** Ghi chú thêm dưới bảng (ví dụ "Nhận lúc …"). */
  extra?: HTMLElement;
  /** Khối nội dung thay bảng chỉ số tướng — dùng cho Ngọc (bảng chỉ số theo từng cấp). */
  detail?: HTMLElement;
  /** Nhãn cấp thay cho "Lv.n" (VD "Cấp 5" của Ngọc). */
  levelLabel?: string;
  /** Mở trên một modal khác (Đấu trường) — cần nổi lên trên lớp phủ của modal đó. */
  above?: boolean;
  /** Gọi sau khi modal đã bị gỡ. */
  onClose?: () => void;
};

/**
 * Modal chi tiết tướng dùng chung (mục 6.1 + 6.7): khung, tên, phe/cấp và bảng chi tiết chiến đấu.
 * - Bộ sưu tập truyền thêm `card` (thẻ lớn, nghiêng nhẹ theo chuột) và ghi chú ngày nhận.
 * - Đấu trường chỉ truyền dữ liệu chiến đấu nên modal gọn đúng phần bảng (không có thẻ lớn).
 * Bấm bất kỳ đâu hoặc Esc để đóng. Trả về hàm đóng.
 */
export function openCombatDetail(opts: CombatDetailOptions): () => void {
  const reduced = prefersReducedMotion();

  const titles = h('div', { class: 'viewer-titles' }, h('div', { class: 'viewer-name', text: opts.name }));
  const sub = h('div', { class: 'viewer-sub' });
  if (opts.faction) {
    sub.appendChild(h('span', { class: `fac f-${opts.faction}`, text: FACTION_LABELS[opts.faction] }));
    sub.appendChild(h('span', { class: 'dot', text: '·' }));
  }
  const lvEl = h('span', { text: opts.levelLabel ?? `Lv.${opts.level}` });
  lvEl.style.color = levelTier(opts.level).css;
  sub.appendChild(lvEl);
  if (opts.combat) {
    sub.appendChild(h('span', { class: 'dot', text: '·' }));
    sub.appendChild(h('span', { class: 'viewer-lc', text: `LC ${num(opts.combat.self.lc)}`, attrs: { title: 'Lực chiến' } }));
  }
  titles.appendChild(sub);

  const head = h('div', { class: 'viewer-head' });
  if (opts.art) head.appendChild(h('span', { class: 'viewer-art' }, opts.art));
  head.appendChild(titles);

  const info = h('div', { class: 'viewer-info' }, head);
  if (opts.detail) info.appendChild(opts.detail);
  else if (opts.combat) info.appendChild(combatDetailEl(opts.combat));
  else
    info.appendChild(
      h('div', { class: 'viewer-combat muted small', text: opts.error ? `Không tải được chỉ số: ${opts.error}` : 'Đang tải chỉ số…' }),
    );
  if (opts.extra) info.appendChild(opts.extra);
  info.appendChild(h('div', { class: 'muted small viewer-hint', text: 'Chạm bất kỳ đâu để đóng' }));

  const box = h('div', { class: 'viewer-box' });
  let tilt: HTMLElement | undefined;
  if (opts.card) {
    tilt = h('div', { class: 'viewer-tilt' }, opts.card);
    box.appendChild(tilt);
  }
  box.appendChild(info);

  const classes = opts.above ? 'viewer-overlay above' : 'viewer-overlay';
  const overlay = h('div', {
    class: classes,
    attrs: {
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': `${opts.name} ${opts.levelLabel ?? `Lv.${opts.level}`}`,
      tabindex: '-1',
    },
  });
  overlay.appendChild(box);

  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    opts.onClose?.();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };

  // Nghiêng thẻ nhẹ theo con trỏ (bỏ qua khi người dùng chọn giảm chuyển động).
  overlay.addEventListener('pointermove', (e) => {
    if (reduced || !tilt) return;
    const r = tilt.getBoundingClientRect();
    const cx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / r.width));
    const cy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / r.height));
    tilt.style.transform = `rotateY(${cx * 12}deg) rotateX(${-cy * 12}deg)`;
    tilt.style.setProperty('--sx', `${50 + cx * 40}%`);
    tilt.style.setProperty('--sy', `${50 + cy * 40}%`);
  });
  overlay.addEventListener('pointerleave', () => {
    if (tilt) tilt.style.transform = '';
  });
  overlay.addEventListener('click', () => close());

  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.focus();
  return close;
}
