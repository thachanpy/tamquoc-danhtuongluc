import { TICKET_LABELS, TICKET_TYPES, type TicketType } from '@tq/shared';
import { api } from '../services/api.ts';
import { refreshQuestBadge } from '../state/badges.ts';
import { showDailyEvents } from '../state/session.ts';
import { setTickets, state, tickets } from '../state/store.ts';
import { fmtCountdown } from '../utils/format.ts';
import { clear, h } from './dom.ts';
import { toast } from './toast.ts';

/**
 * Thanh vé ở đầu trang: số dư / trần vé hồi từng loại, tổng, và đồng hồ tới mốc hồi kế tiếp.
 *
 * Đồng hồ chỉ để HIỂN THỊ. Khi tới mốc, client hỏi server (`claim-recovery`) — server mới là nơi
 * quyết định cấp bao nhiêu vé (vé hồi theo thời gian, phần thưởng ngày mới, nhiệm vụ tự nhận).
 */
export function ticketsBar(): { el: HTMLElement; dispose: () => void } {
  const el = h('div', { class: 'tickets-bar', attrs: { 'aria-live': 'polite' } });
  let countdownEl: HTMLElement | null = null;
  let claiming = false;

  /** Vẽ lại toàn bộ thanh theo số dư vé hiện tại. */
  const draw = (): void => {
    const t = tickets.get();
    clear(el);
    countdownEl = null;
    if (!t) return;

    // Trần vé hồi theo thời gian (mỗi loại); vé từ nhiệm vụ/giftcode… có thể vượt trần.
    const cap = t.recoveryCap;
    const full = (k: TicketType) => t.balances[k] >= cap[k];
    const allFull = TICKET_TYPES.every(full);

    for (const k of TICKET_TYPES) {
      el.appendChild(
        h(
          'span',
          {
            class: `tb t-${k}`,
            classOn: { full: full(k) },
            attrs: {
              title: `${TICKET_LABELS[k]}${full(k) ? ` — đã đạt trần vé hồi ${cap[k]}, không hồi thêm loại này` : ` — vé hồi tối đa ${cap[k]}`}`,
            },
          },
          `${TICKET_LABELS[k].replace('Vé ', '')} `,
          h('b', { text: t.balances[k] }),
          h('small', { class: 'tb-cap', text: `/${cap[k]}` }),
        ),
      );
    }

    el.appendChild(h('span', { class: 'tb total' }, 'Tổng ', h('b', { text: t.total })));

    if (allFull) {
      el.appendChild(
        h('span', {
          class: 'tb timer full',
          text: 'Vé hồi đã đầy',
          attrs: {
            title: `Mọi loại vé đã đạt trần (thường ${cap.normal}, phe ${cap.shu}): vé hồi theo thời gian tạm dừng (nhiệm vụ, giftcode vẫn cộng được)`,
          },
        }),
      );
    } else {
      countdownEl = h('b', { text: fmtCountdown(state.nextRecoveryLocal - performance.now()) });
      el.appendChild(
        h(
          'span',
          {
            class: 'tb timer',
            attrs: { title: `Vé kế tiếp lúc ${new Date(t.nextRecoveryAt).toLocaleTimeString('vi-VN')}. Vé hồi tối đa: thường ${cap.normal}, mỗi loại phe ${cap.shu}` },
          },
          '+1 vé sau ',
          countdownEl,
        ),
      );
    }
  };

  const timer = window.setInterval(async () => {
    // Cập nhật đồng hồ đếm ngược mỗi 500ms.
    if (countdownEl) countdownEl.textContent = fmtCountdown(state.nextRecoveryLocal - performance.now());
    const left = state.nextRecoveryLocal - performance.now();
    if (left > -1000 || claiming) return;
    claiming = true;
    try {
      const r = await api.claimRecovery();
      setTickets(r);
      if (r.dailyEvents) showDailyEvents(r.dailyEvents);
      void refreshQuestBadge();
      if (r.grantedTotal > 0) {
        toast(`Nhận ${r.grantedTotal} vé: ${TICKET_TYPES.filter((k) => r.granted[k]).map((k) => `${TICKET_LABELS[k]} ×${r.granted[k]}`).join(', ')}`);
      }
    } catch {
      // Lỗi mạng: thử lại sau 15s, không spam server.
      state.nextRecoveryLocal = performance.now() + 15_000;
    } finally {
      claiming = false;
    }
  }, 500);

  const unsubscribe = tickets.subscribe(draw);
  draw();

  return {
    el,
    dispose: () => {
      window.clearInterval(timer);
      unsubscribe();
    },
  };
}
