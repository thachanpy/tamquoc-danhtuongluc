import { Show, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { FACTION_LABELS, type Faction, type PvpCombatDto } from '@tq/shared';
import { levelTier, prefersReducedMotion } from '../art.ts';
import { CombatDetail } from './CombatDetail.tsx';

/**
 * Modal chi tiết tướng dùng chung (mục 6.1 + 6.7): khung, tên, phe/cấp và bảng chi tiết chiến đấu.
 * - Bộ sưu tập truyền thêm `card` (thẻ lớn, nghiêng nhẹ theo chuột) và ghi chú ngày nhận.
 * - Đấu trường chỉ truyền dữ liệu chiến đấu nên modal gọn đúng phần bảng (không có thẻ lớn).
 * Bấm bất kỳ đâu hoặc Esc để đóng.
 */
export function CombatDetailModal(props: {
  name: string;
  level: number;
  /** Phe của tướng — chỉ hiện nhãn khi được truyền (bộ sưu tập). */
  faction?: Faction;
  /** Chi tiết chiến đấu; chưa có thì hiện "Đang tải chỉ số…". */
  combat?: PvpCombatDto | null;
  /** Lỗi khi tải chi tiết. */
  error?: string | null;
  /** Ảnh đại diện tướng — Đấu trường truyền vào (Bộ sưu tập đã có thẻ lớn nên không cần). */
  art?: JSX.Element;
  /** Thẻ lớn — chỉ Bộ sưu tập truyền; không có thì modal chỉ gồm ảnh đại diện + bảng chi tiết. */
  card?: JSX.Element;
  /** Ghi chú thêm dưới bảng (ví dụ "Nhận lúc …"). */
  extra?: JSX.Element;
  /** Mở trên một modal khác (Đấu trường) — cần nổi lên trên lớp phủ của modal đó. */
  above?: boolean;
  onClose: () => void;
}) {
  let overlay!: HTMLDivElement;
  let tilt: HTMLDivElement | undefined;
  const reduced = prefersReducedMotion();
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  onMount(() => {
    document.addEventListener('keydown', onKey);
    overlay.focus();
  });
  onCleanup(() => document.removeEventListener('keydown', onKey));
  const onMove = (e: PointerEvent) => {
    if (reduced || !props.card || !tilt) return;
    const r = tilt.getBoundingClientRect();
    const cx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / r.width));
    const cy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / r.height));
    tilt.style.transform = `rotateY(${cx * 12}deg) rotateX(${-cy * 12}deg)`;
    tilt.style.setProperty('--sx', `${50 + cx * 40}%`);
    tilt.style.setProperty('--sy', `${50 + cy * 40}%`);
  };
  return (
    // Portal ra body: modal này có thể mở từ trong một modal khác (Đấu trường) mà modal đó có
    // backdrop-filter — thứ tạo containing block cho position: fixed và làm hộp bị định vị sai.
    <Portal>
      <div
        ref={overlay}
        class="viewer-overlay"
        classList={{ above: props.above }}
        role="dialog"
        aria-modal="true"
        aria-label={`${props.name} Lv.${props.level}`}
        tabIndex={-1}
        onClick={() => props.onClose()}
        onPointerMove={onMove}
        onPointerLeave={() => tilt && (tilt.style.transform = '')}
      >
        <div class="viewer-box">
          <Show when={props.card}>{(c) => <div ref={tilt} class="viewer-tilt">{c()}</div>}</Show>
          <div class="viewer-info">
            <div class="viewer-head">
              {/* Ảnh đại diện tướng (Đấu trường truyền vào) — đặt cạnh tên cho dễ nhận diện */}
              <Show when={props.art}>{(a) => <span class="viewer-art">{a()}</span>}</Show>
              <div class="viewer-titles">
                <div class="viewer-name">{props.name}</div>
                <div class="viewer-sub">
                  <Show when={props.faction}>
                    {(f) => (
                      <>
                        <span class={`fac f-${f()}`}>{FACTION_LABELS[f()]}</span>
                        <span class="dot">·</span>
                      </>
                    )}
                  </Show>
                  <span style={{ color: levelTier(props.level).css }}>{`Lv.${props.level}`}</span>
                </div>
              </div>
            </div>
            {/* Kỹ năng + chỉ số chi tiết do server tính (mục 6.7) */}
            <Show
              when={props.combat}
              fallback={
                <div class="viewer-combat muted small">
                  {props.error ? `Không tải được chỉ số: ${props.error}` : 'Đang tải chỉ số…'}
                </div>
              }
            >
              {(c) => <CombatDetail c={c()} />}
            </Show>
            {props.extra}
            <div class="muted small viewer-hint">Chạm bất kỳ đâu để đóng</div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
