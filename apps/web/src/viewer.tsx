import { createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { CardDto, GeneralDto, PvpCombatDto } from '@tq/shared';
import { api } from './api.ts';
import { Card } from './components/Card.tsx';
import { CombatDetailModal } from './components/CombatDetailModal.tsx';

/**
 * Popup ngắm thẻ (mục 6.1): thẻ lớn + kỹ năng và chỉ số chi tiết của tướng ở đúng cấp thẻ (mục 6.7).
 * Dùng chung khung modal với Đấu trường (`CombatDetailModal`) — chỉ khác là có thêm thẻ lớn.
 * Chỉ hiển thị, không đổi dữ liệu. Bấm bất kỳ đâu hoặc Esc để đóng.
 */
function CardViewer(props: { general: GeneralDto; card: CardDto; onClose: () => void }) {
  const [combat, setCombat] = createSignal<PvpCombatDto | null>(null);
  const [combatError, setCombatError] = createSignal<string | null>(null);
  onMount(() => {
    void api
      .generalCombat(props.general.id, props.card.level)
      .then(setCombat)
      .catch((e: Error) => setCombatError(e.message));
  });
  return (
    <CombatDetailModal
      name={props.general.name}
      level={props.card.level}
      faction={props.general.faction}
      combat={combat()}
      error={combatError()}
      card={<Card general={props.general} level={props.card.level} extra="viewer-card" />}
      extra={<div class="muted small">Nhận lúc {new Date(props.card.createdAt).toLocaleString('vi-VN')}</div>}
      onClose={() => props.onClose()}
    />
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
