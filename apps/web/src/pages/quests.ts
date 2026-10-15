import {
  FACTIONS,
  FACTION_LABELS,
  TICKET_LABELS,
  TICKET_TYPES,
  type AchievementGroupDto,
  type QuestItemDto,
  type QuestsDto,
} from '@tq/shared';
import { api, type ApiError } from '../api.ts';
import { setTickets } from '../state.ts';
import { esc } from '../art.ts';

type Sub = 'daily' | 'login' | 'ach';

const num = (n: number) => n.toLocaleString('vi-VN');
const rewardChip = (pool: QuestItemDto['reward']['pool'], count: number) =>
  `<span class="tb t-${pool} q-reward">+${num(count)} ${TICKET_LABELS[pool]}</span>`;
const cd = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
};

/**
 * Trang Nhiệm vụ (mục 3.10): nhiệm vụ hằng ngày (chung + theo phe), điểm danh theo tháng, thành tựu.
 * Chỉ hiển thị trạng thái server tính; bấm Nhận gửi khoá phần thưởng, server kiểm tra lại và cộng vé.
 */
export function renderQuests(root: HTMLElement): () => void {
  let alive = true;
  let busy = false;
  let data: QuestsDto | null = null;
  let sub: Sub = 'daily';
  let nextResetLocal = 0;
  root.innerHTML = `
    <section class="panel q-panel">
      <div class="q-head">
        <h2>Nhiệm vụ</h2>
        <button class="btn primary" data-claim-all disabled>Nhận tất cả</button>
      </div>
      <div class="sub-tabs" role="tablist">
        <button class="btn small on" data-sub="daily">Hằng ngày</button>
        <button class="btn small" data-sub="login">Điểm danh</button>
        <button class="btn small" data-sub="ach">Thành tựu</button>
      </div>
      <div class="q-msg" aria-live="polite"></div>
      <div class="q-body"><div class="state-msg">Đang tải nhiệm vụ…</div></div>
    </section>`;
  const body = root.querySelector<HTMLDivElement>('.q-body')!;
  const msg = root.querySelector<HTMLDivElement>('.q-msg')!;
  const allBtn = root.querySelector<HTMLButtonElement>('[data-claim-all]')!;

  const claimBtn = (i: QuestItemDto) =>
    i.status === 'claimed'
      ? '<span class="q-done">✓ Đã nhận</span>'
      : i.status === 'claimable'
        ? `<button class="btn primary small" data-claim="${esc(i.key)}" ${busy ? 'disabled' : ''}>Nhận</button>`
        : `<span class="muted small">${num(i.progress)}/${num(i.target)}</span>`;

  const questRow = (i: QuestItemDto) => `
    <div class="q-row ${i.status}">
      <div class="q-info">
        <b>${esc(i.name)}</b>
        <span class="muted small">${esc(i.desc)}</span>
        <div class="q-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${i.target}" aria-valuenow="${i.progress}"><i style="width:${Math.round((i.progress / i.target) * 100)}%"></i></div>
      </div>
      ${rewardChip(i.reward.pool, i.reward.count)}
      <div class="q-act">${claimBtn(i)}</div>
    </div>`;

  function dailyHtml(d: QuestsDto) {
    const reset = TICKET_TYPES.map((t) => `${d.resetBonus.tickets[t]} ${TICKET_LABELS[t].replace('Vé ', '')}`).join(' · ');
    return `
      <div class="q-reset">
        <span>Làm mới sau <b data-cd>${cd(nextResetLocal - performance.now())}</b> <span class="muted small">(05:00 giờ Việt Nam)</span></span>
        <span class="small">Thưởng ngày mới: ${reset} ${d.resetBonus.granted ? '<span class="q-done">✓ Đã cộng</span>' : ''}</span>
      </div>
      <h3>Nhiệm vụ chung</h3>
      <div class="q-list">${d.daily.map(questRow).join('')}</div>
      <h3>Nhiệm vụ theo phe</h3>
      <div class="q-factions">${FACTIONS.map(
        (f) => `<div class="q-faction f-${f}"><div class="q-ftitle">Phe ${FACTION_LABELS[f]}</div><div class="q-list">${d.faction[f].map(questRow).join('')}</div></div>`,
      ).join('')}</div>
      <p class="muted small">Nhiệm vụ đã đạt mà chưa bấm nhận sẽ được tự động nhận khi sang ngày mới (05:00).</p>`;
  }

  function loginHtml(d: QuestsDto) {
    const [y, m] = d.login.month.split('-');
    const cell = (x: QuestsDto['login']['days'][number]) => {
      const label =
        x.status === 'claimed' ? '✓' : x.status === 'claimable' ? 'Nhận' : x.status === 'missed' ? 'Vắng' : '';
      const inner = `<span class="q-dnum">Ngày ${x.day}</span><b>${x.reward}</b><span class="q-dlabel">${label}</span>`;
      return x.status === 'claimable'
        ? `<button class="q-day ${x.status} ${x.date === d.calendarDate ? 'today' : ''}" data-claim="login:${x.date}" ${busy ? 'disabled' : ''}>${inner}</button>`
        : `<div class="q-day ${x.status} ${x.date === d.calendarDate ? 'today' : ''}">${inner}</div>`;
    };
    return `
      <h3>Điểm danh tháng ${Number(m)}/${y}</h3>
      <p class="muted small">Mỗi ngày vào game nhận Vé thường theo ngày trong tháng (ngày 1: 10 vé … ngày 31: 40 vé). Bỏ lỡ một ngày không ảnh hưởng ngày sau. Sang tháng mới, các ngày chưa bấm nhận được tự động nhận.</p>
      <div class="q-cal">${d.login.days.map(cell).join('')}</div>`;
  }

  function groupHtml(g: AchievementGroupDto) {
    const claimable = g.items.filter((i) => i.status === 'claimable');
    const next = g.items.find((i) => i.status === 'progress');
    const done = g.items.filter((i) => i.status === 'claimed').length;
    const pool = g.items[0]?.reward.pool ?? 'normal';
    return `
      <div class="q-ach ${claimable.length ? 'has-claim' : ''}">
        <div class="q-ach-head">
          <b>${esc(g.title)}</b>
          <span class="muted small">${done}/${g.items.length} mốc</span>
        </div>
        <span class="muted small">${esc(g.desc)}: <b class="q-val">${num(g.progress)}</b></span>
        ${
          next
            ? `<div class="q-next small">Mốc kế: ${esc(next.name)} ${rewardChip(next.reward.pool, next.reward.count)}</div>
               <div class="q-bar"><i style="width:${Math.round((next.progress / next.target) * 100)}%"></i></div>`
            : claimable.length
              ? ''
              : '<div class="q-next small q-done">✓ Đã hoàn thành mọi mốc</div>'
        }
        ${
          claimable.length
            ? `<button class="btn primary small" data-claim-group="${esc(g.id)}" ${busy ? 'disabled' : ''}>Nhận ${claimable.length} mốc · +${num(
                claimable.reduce((s, i) => s + i.reward.count, 0),
              )} ${TICKET_LABELS[pool]}</button>`
            : ''
        }
        <details class="q-ms"><summary class="muted small">Xem các mốc</summary>
          <div class="q-chips">${g.items
            .map((i) => `<span class="q-chip ${i.status}" title="${esc(i.name)}">${num(i.target)} → ${num(i.reward.count)}</span>`)
            .join('')}</div>
        </details>
      </div>`;
  }

  function achHtml(d: QuestsDto) {
    const gs = d.achievements;
    const sec = (title: string, list: AchievementGroupDto[]) => `<h3>${title}</h3><div class="q-achs">${list.map(groupHtml).join('')}</div>`;
    return (
      sec('Chiêu mộ & thu thập', gs.filter((g) => g.id === 'draws' || g.id === 'cards' || g.id === 'collect')) +
      sec('Sưu tầm theo phe', gs.filter((g) => g.id.startsWith('fcollect-'))) +
      sec('Sở hữu thẻ theo cấp', gs.filter((g) => g.id.startsWith('own-'))) +
      '<p class="muted small">Mỗi mốc chỉ nhận 1 lần, không reset. Thẻ được người khác tặng không tính vào chiêu mộ/sưu tầm/số thẻ đã nhận.</p>'
    );
  }

  function render() {
    if (!data) return;
    const counts: Record<Sub, number> = {
      daily: [...data.daily, ...FACTIONS.flatMap((f) => data!.faction[f])].filter((i) => i.status === 'claimable').length,
      login: data.login.days.filter((x) => x.status === 'claimable').length,
      ach: data.achievements.flatMap((g) => g.items).filter((i) => i.status === 'claimable').length,
    };
    root.querySelectorAll<HTMLButtonElement>('[data-sub]').forEach((b) => {
      const k = b.dataset.sub as Sub;
      b.classList.toggle('on', k === sub);
      b.innerHTML = `${{ daily: 'Hằng ngày', login: 'Điểm danh', ach: 'Thành tựu' }[k]}${counts[k] ? ` <span class="q-dot">${counts[k]}</span>` : ''}`;
    });
    allBtn.disabled = busy || data.claimable === 0;
    allBtn.textContent = data.claimable ? `Nhận tất cả (${data.claimable})` : 'Nhận tất cả';
    body.innerHTML = sub === 'daily' ? dailyHtml(data) : sub === 'login' ? loginHtml(data) : achHtml(data);
  }

  async function load() {
    try {
      const d = await api.quests();
      if (!alive) return;
      data = d;
      nextResetLocal = performance.now() + (Date.parse(d.nextResetAt) - Date.now());
      render();
      window.dispatchEvent(new CustomEvent('tq:quests-changed', { detail: d.claimable }));
    } catch (e) {
      if (alive) body.innerHTML = `<div class="state-msg error">${esc((e as Error).message)}</div>`;
    }
  }

  async function claim(keys?: string[]) {
    if (busy) return;
    busy = true;
    render();
    msg.innerHTML = '';
    try {
      const r = await api.claimQuests(keys);
      if (!alive) return;
      setTickets(r.balances);
      const sum = new Map<string, number>();
      for (const c of r.claimed) sum.set(c.pool, (sum.get(c.pool) ?? 0) + c.count);
      msg.innerHTML = `<div class="notice">Đã nhận ${r.claimed.length} phần thưởng: ${[...sum]
        .map(([p, n]) => `<b>+${num(n)} ${TICKET_LABELS[p as keyof typeof TICKET_LABELS]}</b>`)
        .join(', ')}</div>`;
    } catch (e) {
      if (alive) msg.innerHTML = `<div class="warn">${esc((e as ApiError).message)}</div>`;
    } finally {
      busy = false;
      if (alive) await load();
    }
  }

  root.querySelector('.sub-tabs')!.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-sub]');
    if (!b) return;
    sub = b.dataset.sub as Sub;
    render();
  });
  allBtn.onclick = () => void claim();
  body.onclick = (ev) => {
    const t = ev.target as HTMLElement;
    const one = t.closest<HTMLElement>('[data-claim]');
    if (one) return void claim([one.dataset.claim!]);
    const grp = t.closest<HTMLElement>('[data-claim-group]');
    if (grp && data) {
      const g = data.achievements.find((x) => x.id === grp.dataset.claimGroup);
      const keys = g?.items.filter((i) => i.status === 'claimable').map((i) => i.key) ?? [];
      if (keys.length) void claim(keys);
    }
  };

  // Đồng hồ đến 05:00; tới giờ thì tải lại (server xử lý ngày mới khi nhận request)
  const timer = window.setInterval(() => {
    if (!data) return;
    const left = nextResetLocal - performance.now();
    const el = body.querySelector('[data-cd]');
    if (el) el.textContent = cd(left);
    if (left < -1500 && !busy) {
      nextResetLocal = performance.now() + 60_000; // tránh gọi dồn
      void load();
    }
  }, 1000);

  void load();
  return () => {
    alive = false;
    clearInterval(timer);
  };
}
