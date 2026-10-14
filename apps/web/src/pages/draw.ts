import { TICKET_LABELS, TICKET_TYPES, FACTION_LABELS, type TicketType } from '@tq/shared';
import { api, newKey, type ApiError } from '../api.ts';
import { state, setTickets, onTickets, gen } from '../state.ts';
import { esc, pct, levelTier } from '../art.ts';
import { playReveal, playRevealMany } from '../pixi/stage.ts';

export function renderDraw(root: HTMLElement): () => void {
  let selected: TicketType = 'normal';
  let busy = false;
  /**
   * Key giữ nguyên cho tới khi request có phản hồi xác định -> retry an toàn sau lỗi mạng.
   * Gắn với (loại vé, số lần) để không dùng lại key cho một yêu cầu khác.
   */
  let pending: { key: string; type: TicketType; count: number } | null = null;

  const cfg = state.config!;
  const counts = [...cfg.drawCountOptions].sort((a, b) => a - b);

  root.innerHTML = `
    <section class="panel">
      <h2>Chọn loại vé</h2>
      <div class="ticket-picker" role="radiogroup"></div>
      <div class="draw-row">
        <div class="draw-btns"></div>
        <div class="draw-msg" aria-live="polite"></div>
      </div>
      <div class="last-result"></div>
    </section>
    <div class="two-col">
      <section class="panel">
        <h3>Tỷ lệ level (server đang áp dụng)</h3>
        <table class="rates"><tbody></tbody></table>
      </section>
      <section class="panel">
        <h3>Pool tướng <span class="pool-count muted"></span></h3>
        <div class="pool"></div>
      </section>
    </div>`;

  const picker = root.querySelector<HTMLDivElement>('.ticket-picker')!;
  const btnWrap = root.querySelector<HTMLDivElement>('.draw-btns')!;
  const msg = root.querySelector<HTMLDivElement>('.draw-msg')!;
  const last = root.querySelector<HTMLDivElement>('.last-result')!;

  root.querySelector('.rates tbody')!.innerHTML = cfg.levelRates
    .map((r) => `<tr><td><span class="lv-dot" style="--tc:${levelTier(r.level).css}"></span>Lv.${r.level}</td><td>${pct(r.bps, cfg.bpsScale)}</td></tr>`)
    .join('');

  /** Nhãn nút: "Quay ×10", hoặc "Quay hết 3 vé" khi số dư ít hơn số lần. Server vẫn là bên quyết định số lượt thật. */
  function btnLabel(n: number, balance: number): string {
    if (n === 1) return 'Quay 1 lần';
    return balance > 0 && balance < n ? `Quay hết ${balance} vé` : `Quay ×${n}`;
  }

  function poolSize(t: TicketType): number {
    return state.config?.ticketTypes.find((x) => x.id === t)?.pool.length ?? 0;
  }

  function renderPicker() {
    const b = state.tickets?.balances;
    picker.innerHTML = TICKET_TYPES.map(
      (t) => `
      <button role="radio" aria-checked="${t === selected}" class="ticket t-${t} ${t === selected ? 'on' : ''}" data-t="${t}">
        <span class="t-name">${TICKET_LABELS[t]}</span>
        <span class="t-count">${b ? b[t] : '–'}</span>
        <span class="t-pool muted">${poolSize(t)} tướng${t === 'normal' ? '' : ` ${FACTION_LABELS[t]}`}</span>
      </button>`,
    ).join('');
    picker.querySelectorAll<HTMLButtonElement>('[data-t]').forEach((el) => {
      el.onclick = () => {
        selected = el.dataset.t as TicketType;
        pending = null;
        msg.textContent = '';
        renderPicker();
        renderPool();
      };
    });

    const balance = b?.[selected] ?? 0;
    // Ẩn nút ×N trùng hành vi với nút ×1 khi chỉ còn 1 vé
    const shown = counts.filter((n) => n === 1 || balance !== 1);
    btnWrap.innerHTML = shown
      .map(
        (n) =>
          `<button class="btn ${n === 1 ? 'ghost' : 'primary'} big" data-n="${n}" ${busy || balance <= 0 ? 'disabled' : ''}>${
            busy ? 'Đang quay…' : balance <= 0 ? 'Hết vé loại này' : btnLabel(n, balance)
          }</button>`,
      )
      .join('');
    btnWrap.querySelectorAll<HTMLButtonElement>('[data-n]').forEach((el) => {
      el.onclick = () => void doDraw(Number(el.dataset.n));
    });
  }

  function renderPool() {
    const pool = cfg.ticketTypes.find((t) => t.id === selected)?.pool ?? [];
    root.querySelector('.pool-count')!.textContent = `(${pool.length} tướng, mỗi tướng ${pct(10000 / pool.length)})`;
    root.querySelector('.pool')!.innerHTML = pool
      .map((id) => {
        const g = gen(id);
        return `<span class="chip f-${g.faction}">${esc(g.name)}</span>`;
      })
      .join('');
  }

  async function doDraw(count: number) {
    if (busy) return;
    busy = true;
    msg.textContent = '';
    msg.className = 'draw-msg';
    renderPicker();
    if (!pending || pending.type !== selected || pending.count !== count) {
      pending = { key: newKey(), type: selected, count };
    }
    try {
      const r = await api.draw(selected, count, pending.key);
      pending = null;
      setTickets(r.tickets);
      const label = TICKET_LABELS[r.ticketType];
      const caption =
        r.drawn === 1
          ? `Đã dùng 1 ${label} → ${r.results[0]!.general.name} Lv.${r.results[0]!.card.level}`
          : `Đã dùng ${r.drawn} ${label}${r.drawn < r.requested ? '' : ''}`;
      last.textContent = '';
      busy = false;
      renderPicker();
      // Chỉ hiện kết quả trong màn mở thẻ (không lộ trước ở trang); sau khi đóng chỉ còn dòng tóm tắt.
      if (r.results.length === 1) await playReveal(r.results[0]!.general, r.results[0]!.card.level, caption);
      else await playRevealMany(r.results.map((x) => ({ general: x.general, level: x.card.level })), caption);
      last.innerHTML = `<div class="muted small">${esc(caption)}</div>`;
    } catch (e) {
      const err = e as ApiError;
      // Lỗi mạng: giữ key để lần bấm lại là retry an toàn (server trả kết quả cũ nếu đã ghi).
      if (err.code !== 'NETWORK') pending = null;
      msg.textContent = err.code === 'NO_TICKETS' ? 'Bạn đã hết vé loại này.' : err.message;
      msg.className = 'draw-msg error';
      busy = false;
      if (err.code === 'NO_TICKETS') api.tickets().then(setTickets).catch(() => {});
      renderPicker();
    }
  }

  renderPicker();
  renderPool();
  return onTickets(renderPicker);
}
