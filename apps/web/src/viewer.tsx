import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { FACTION_LABELS, type CardDto, type GeneralDto } from '@tq/shared';
import { levelTier, prefersReducedMotion } from './art.ts';
import { Card } from './components/Card.tsx';

/**
 * Popup ngắm thẻ (chỉ hiển thị, không gọi API, không đổi dữ liệu).
 * Bấm bất kỳ đâu hoặc Esc để đóng. Di chuột lên thẻ để thẻ nghiêng nhẹ (tắt khi reduced motion).
 */
function CardViewer(props: { general: GeneralDto; card: CardDto; onClose: () => void }) {
  let overlay!: HTMLDivElement;
  let tilt!: HTMLDivElement;
  const tier = levelTier(props.card.level);
  const reduced = prefersReducedMotion();
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  onMount(() => {
    document.addEventListener('keydown', onKey);
    overlay.focus();
  });
  onCleanup(() => document.removeEventListener('keydown', onKey));
  const onMove = (e: PointerEvent) => {
    if (reduced) return;
    const r = tilt.getBoundingClientRect();
    const cx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / r.width));
    const cy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / r.height));
    tilt.style.transform = `rotateY(${cx * 12}deg) rotateX(${-cy * 12}deg)`;
    tilt.style.setProperty('--sx', `${50 + cx * 40}%`);
    tilt.style.setProperty('--sy', `${50 + cy * 40}%`);
  };
  return (
    <div
      ref={overlay}
      class="viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${props.general.name} Lv.${props.card.level}`}
      tabIndex={-1}
      onClick={() => props.onClose()}
      onPointerMove={onMove}
      onPointerLeave={() => !reduced && (tilt.style.transform = '')}
    >
      <div class="viewer-box">
        <div ref={tilt} class="viewer-tilt">
          <Card general={props.general} level={props.card.level} extra="viewer-card" />
        </div>
        <div class="viewer-info">
          <div class="viewer-name">{props.general.name}</div>
          <div class="viewer-sub">
            <span class={`fac f-${props.general.faction}`}>{FACTION_LABELS[props.general.faction]}</span>
            <span class="dot">·</span>
            <span style={{ color: tier.css }}>Lv.{props.card.level}</span>
            <span class="dot">·</span>
            <span class="muted">#{props.card.id}</span>
          </div>
          <div class="muted small">Nhận lúc {new Date(props.card.createdAt).toLocaleString('vi-VN')}</div>
          <div class="muted small viewer-hint">Chạm bất kỳ đâu để đóng</div>
        </div>
      </div>
    </div>
  );
}

/** Mở popup ngắm thẻ; gọi được từ bất kỳ trang nào. Đóng thì gỡ DOM và trả focus về chỗ cũ. */
export function openCardViewer(general: GeneralDto, card: CardDto): void {
  const prev = document.activeElement as HTMLElement | null;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(
    () => (
      <CardViewer
        general={general}
        card={card}
        onClose={() => {
          dispose();
          host.remove();
          prev?.focus?.();
        }}
      />
    ),
    host,
  );
}
