import type { LeaderboardDto, LeaderboardEntryDto } from '@tq/shared';
import { api } from '../api.ts';
import { esc, levelTier } from '../art.ts';

const num = (n: number) => n.toLocaleString('vi-VN');
const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/**
 * Bảng xếp hạng Lực chiến (mục 6.6). Chỉ hiển thị dữ liệu server tính sẵn.
 * Khung danh sách cao vừa top 10; cuộn trong khung để xem tới top 100. Hạng của mình luôn hiện phía trên.
 */
export function renderLeaderboard(root: HTMLElement): () => void {
  let alive = true;
  let loading = false;
  root.innerHTML = `
    <section class="panel lb-panel">
      <div class="lb-head">
        <h2>Bảng xếp hạng · Lực chiến</h2>
        <button class="btn ghost small" data-refresh>Làm mới</button>
      </div>
      <p class="muted small lb-rule"></p>
      <div class="lb-me" aria-live="polite"></div>
      <div class="lb-list" tabindex="0" aria-label="Bảng xếp hạng"><div class="state-msg">Đang tải bảng xếp hạng…</div></div>
      <div class="muted small lb-foot"></div>
    </section>`;
  const listEl = root.querySelector<HTMLDivElement>('.lb-list')!;
  const meEl = root.querySelector<HTMLDivElement>('.lb-me')!;
  const refreshBtn = root.querySelector<HTMLButtonElement>('[data-refresh]')!;

  const rankBadge = (rank: number | null) =>
    `<span class="lb-rank ${rank !== null && rank <= 3 ? `medal m${rank}` : ''}">${rank ?? '–'}</span>`;

  const row = (e: LeaderboardEntryDto) => {
    const tier = e.maxLevel ? levelTier(e.maxLevel) : null;
    return `<div class="lb-row ${e.isMe ? 'me' : ''} ${e.rank !== null && e.rank <= 3 ? `podium p${e.rank}` : ''}" ${e.isMe ? 'data-me' : ''}>
      ${rankBadge(e.rank)}
      <span class="lb-name">${esc(e.username)}${e.isMe ? ' <span class="lb-you">Bạn</span>' : ''}</span>
      <span class="lb-meta">${tier ? `<b style="color:${tier.css}">Lv.${e.maxLevel}</b> · ` : ''}${num(e.cardCount)} thẻ</span>
      <b class="lb-power">${num(e.power)}</b>
    </div>`;
  };

  function render(d: LeaderboardDto) {
    const lv = d.powerByLevel;
    root.querySelector('.lb-rule')!.textContent =
      `Lực chiến = tổng điểm các thẻ đang có: Lv.1 = ${lv[1]} · Lv.2 = ${lv[2]} · Lv.3 = ${lv[3]} · … · Lv.10 = ${num(lv[10] ?? 0)}. ` +
      `Ghép thẻ lên level cao để leo hạng. Đồng điểm thì đồng hạng. Không tính tài khoản quản trị.`;

    // Hạng của mình
    if (!d.me) {
      meEl.innerHTML = `<div class="lb-me-box muted">Tài khoản quản trị không tham gia xếp hạng.</div>`;
    } else if (d.me.rank === null) {
      meEl.innerHTML = `<div class="lb-me-box"><b>Bạn chưa có thẻ nào</b> — quay thẻ để có tên trên bảng xếp hạng.</div>`;
    } else {
      const inList = d.items.some((e) => e.isMe);
      meEl.innerHTML = `<div class="lb-me-box">
        <span class="muted small">Hạng của bạn</span>
        <div class="lb-row me">${rankBadge(d.me.rank)}
          <span class="lb-name">${esc(d.me.username)}</span>
          <span class="lb-meta">${d.me.maxLevel ? `<b style="color:${levelTier(d.me.maxLevel).css}">Lv.${d.me.maxLevel}</b> · ` : ''}${num(d.me.cardCount)} thẻ</span>
          <b class="lb-power">${num(d.me.power)}</b>
        </div>
        ${inList && d.me.rank > d.top ? '<button class="btn ghost small" data-goto-me>Xem vị trí của tôi</button>' : ''}
        ${!inList ? `<span class="muted small">Ngoài top ${d.items.length}.</span>` : ''}
      </div>`;
    }

    // Danh sách: top 10 nổi bật, sau đó vạch chia rồi tới top 100
    if (!d.items.length) {
      listEl.innerHTML = '<div class="state-msg">Chưa có người chơi nào được xếp hạng.</div>';
    } else {
      const head = d.items.filter((_, i) => i < d.top).map(row).join('');
      const rest = d.items.slice(d.top);
      listEl.innerHTML =
        head +
        (rest.length ? `<div class="lb-divider">Top ${d.top + 1}–${d.items.length} · cuộn để xem</div>${rest.map(row).join('')}` : '');
    }
    listEl.scrollTop = 0;
    root.querySelector('.lb-foot')!.textContent = `${num(d.totalRanked)} người chơi được xếp hạng · cập nhật lúc ${time(d.generatedAt)}`;
  }

  async function load() {
    if (loading) return;
    loading = true;
    refreshBtn.disabled = true;
    try {
      const d = await api.leaderboard();
      if (alive) render(d);
    } catch (e) {
      if (alive) listEl.innerHTML = `<div class="state-msg error">${esc((e as Error).message)}</div>`;
    } finally {
      loading = false;
      refreshBtn.disabled = false;
    }
  }

  refreshBtn.onclick = () => void load();
  meEl.onclick = (ev) => {
    if (!(ev.target as HTMLElement).closest('[data-goto-me]')) return;
    const mine = listEl.querySelector<HTMLElement>('[data-me]');
    if (mine) listEl.scrollTo({ top: mine.offsetTop - listEl.clientHeight / 2 + mine.offsetHeight / 2, behavior: 'smooth' });
  };
  void load();
  return () => (alive = false);
}
