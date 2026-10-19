import { TICKET_LABELS, TICKET_TYPES, type DailyEventsDto } from '@tq/shared';
import { ApiError, hasToken } from '../services/http.ts';
import { api } from '../services/api.ts';
import { refreshPendingBadge } from './badges.ts';
import { applySession } from './store.ts';
import { toast } from '../ui/toast.ts';

/** Kết quả khởi tạo phiên: thành công, phiên hết hạn, hoặc lỗi khác (kèm thông báo). */
export type BootResult = { ok: true } | { ok: false; message: string; expired?: boolean };

/** Thông báo sự kiện ngày mới do server xử lý (thưởng reset 05:00, nhiệm vụ hôm trước tự nhận). */
export function showDailyEvents(ev: DailyEventsDto): void {
  if (ev.resetBonus) {
    const b = ev.resetBonus;
    const total = TICKET_TYPES.reduce((s, t) => s + b[t], 0);
    toast(`Ngày mới! Nhận ${total} vé thưởng (${TICKET_TYPES.map((t) => `${TICKET_LABELS[t]} ×${b[t]}`).join(', ')})`, 6000);
  }
  if (ev.autoClaimed.length) {
    const total = ev.autoClaimed.reduce((s, a) => s + a.count, 0);
    setTimeout(() => toast(`Tự nhận ${ev.autoClaimed.length} phần thưởng nhiệm vụ chưa nhận: +${total} vé`, 6000), ev.resetBonus ? 6200 : 0);
  }
}

/**
 * Khởi tạo phiên chơi: nạp hồ sơ + roster + cấu hình quay, nhận vé hồi còn nợ, rồi ghi vào state.
 * Trả về kết quả để nơi gọi quyết định vào màn Đăng nhập hay vào game — server luôn là nguồn sự thật.
 */
export async function bootstrapSession(): Promise<BootResult> {
  if (!hasToken()) return { ok: false, message: '' };
  try {
    const [me, roster, config] = await Promise.all([api.me(), api.generals(), api.gachaConfig()]);
    // Người chơi: nhận các mốc chưa xử lý ngay khi vào (offline vẫn tích lũy) — server quyết định.
    // Tài khoản quản trị không chơi game (server chặn ADMIN_NOT_PLAYER) nên bỏ qua.
    const claimed = me.isAdmin ? null : await api.claimRecovery();
    const bal = claimed ?? me.tickets;
    applySession({ me, roster, config, tickets: bal });

    if (claimed && claimed.grantedTotal > 0) toast(`Nhận ${claimed.grantedTotal} vé hồi trong lúc vắng mặt`);
    // Request đầu tiên trong ngày (me hoặc claimRecovery) mang sự kiện ngày mới.
    const daily = me.dailyEvents ?? claimed?.dailyEvents;
    if (claimed && daily) setTimeout(() => showDailyEvents(daily), claimed.grantedTotal > 0 ? 4200 : 0);
    void refreshPendingBadge();
    return { ok: true };
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) return { ok: false, message: 'Phiên đăng nhập đã hết hạn.', expired: true };
    return { ok: false, message: err.message };
  }
}
