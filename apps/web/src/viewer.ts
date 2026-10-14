import { FACTION_LABELS, type CardDto, type GeneralDto } from '@tq/shared';
import { cardHtml, esc, levelTier, prefersReducedMotion } from './art.ts';

/**
 * Popup ngắm thẻ (chỉ hiển thị, không gọi API, không đổi dữ liệu).
 * Bấm bất kỳ đâu hoặc Esc để đóng. Di chuột lên thẻ để thẻ nghiêng nhẹ (tắt khi reduced motion).
 */
export function openCardViewer(general: GeneralDto, card: CardDto): void {
  const tier = levelTier(card.level);
  const prev = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'viewer-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', `${general.name} Lv.${card.level}`);
  overlay.tabIndex = -1;
  overlay.innerHTML = `
    <div class="viewer-box">
      <div class="viewer-tilt">${cardHtml(general, card.level, 'viewer-card')}</div>
      <div class="viewer-info">
        <div class="viewer-name">${esc(general.name)}</div>
        <div class="viewer-sub">
          <span class="fac f-${general.faction}">${FACTION_LABELS[general.faction]}</span>
          <span class="dot">·</span>
          <span style="color:${tier.css}">Lv.${card.level}</span>
          <span class="dot">·</span>
          <span class="muted">#${card.id}</span>
        </div>
        <div class="muted small">Nhận lúc ${new Date(card.createdAt).toLocaleString('vi-VN')}</div>
        <div class="muted small viewer-hint">Chạm bất kỳ đâu để đóng</div>
      </div>
    </div>`;

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    prev?.focus?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  overlay.addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  if (!prefersReducedMotion()) {
    const tilt = overlay.querySelector<HTMLDivElement>('.viewer-tilt')!;
    overlay.addEventListener('pointermove', (e) => {
      const r = tilt.getBoundingClientRect();
      const x = (e.clientX - (r.left + r.width / 2)) / r.width;
      const y = (e.clientY - (r.top + r.height / 2)) / r.height;
      const cx = Math.max(-1, Math.min(1, x));
      const cy = Math.max(-1, Math.min(1, y));
      tilt.style.transform = `rotateY(${cx * 12}deg) rotateX(${-cy * 12}deg)`;
      tilt.style.setProperty('--sx', `${50 + cx * 40}%`);
      tilt.style.setProperty('--sy', `${50 + cy * 40}%`);
    });
    overlay.addEventListener('pointerleave', () => (tilt.style.transform = ''));
  }

  document.body.appendChild(overlay);
  overlay.focus();
}
