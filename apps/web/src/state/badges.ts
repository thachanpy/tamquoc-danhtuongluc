import { api } from '../services/api.ts';
import { setPendingBadge, setQuestBadge, state } from './store.ts';

/** Số tài khoản chờ duyệt (badge tab Quản trị, chỉ admin). Trang Quản trị gọi lại sau khi duyệt/từ chối. */
export async function refreshPendingBadge(): Promise<void> {
  if (!state.isAdmin) return;
  try {
    const p = await api.admin.users({ status: 'pending', pageSize: 1 });
    setPendingBadge(p.pendingCount);
  } catch {
    /* chỉ là badge hiển thị */
  }
}

/** Số phần thưởng nhiệm vụ/thành tựu đang chờ nhận (badge tab Nhiệm vụ). */
let questSeq = 0;
export async function refreshQuestBadge(): Promise<void> {
  // Đánh số lượt gọi: chỉ lượt mới nhất được ghi badge, tránh kết quả cũ ghi đè kết quả mới.
  const seq = ++questSeq;
  try {
    const q = await api.quests();
    if (seq === questSeq) setQuestBadge(q.claimable);
  } catch {
    /* chỉ là badge hiển thị */
  }
}
