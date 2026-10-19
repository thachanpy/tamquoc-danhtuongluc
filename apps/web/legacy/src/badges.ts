import { api } from './api.ts';
import { setPendingBadge, setQuestBadge, state } from './state.ts';

/** Số tài khoản chờ duyệt (badge tab Quản trị, chỉ admin). Trang Quản trị gọi lại sau khi duyệt/từ chối. */
export async function refreshPendingBadge() {
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
export async function refreshQuestBadge() {
  const seq = ++questSeq;
  try {
    const q = await api.quests();
    if (seq === questSeq) setQuestBadge(q.claimable);
  } catch {
    /* chỉ là badge hiển thị */
  }
}
