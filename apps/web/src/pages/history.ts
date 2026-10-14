import { TICKET_LABELS, type HistoryEntryDto } from '@tq/shared';
import { api } from '../api.ts';
import { gen } from '../state.ts';
import { esc, pct } from '../art.ts';

const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN');

function row(e: HistoryEntryDto): string {
  if (e.kind === 'ticket') {
    const label = TICKET_LABELS[e.ticketType];
    if (e.reason === 'time_recovery') {
      return `<div class="h-row"><span class="tag ok">+1 vé</span><div>Hồi vé mốc <b>${esc(fmt(e.referenceId ?? e.createdAt))}</b>: nhận <b>${label}</b></div><time>${fmt(e.createdAt)}</time></div>`;
    }
    if (e.reason === 'dev_topup') {
      return `<div class="h-row"><span class="tag ok">+${e.amountDelta} vé</span><div>Cộng vé thử nghiệm: nhận <b>${label} ×${e.amountDelta}</b></div><time>${fmt(e.createdAt)}</time></div>`;
    }
    if (e.reason === 'admin_grant') {
      return `<div class="h-row"><span class="tag ok">+${e.amountDelta} vé</span><div>Quản trị viên tặng: nhận <b>${label} ×${e.amountDelta}</b></div><time>${fmt(e.createdAt)}</time></div>`;
    }
    if (e.reason === 'signup_bonus') {
      return `<div class="h-row"><span class="tag ok">+${e.amountDelta} vé</span><div>Quà tân thủ: nhận <b>${label} ×${e.amountDelta}</b></div><time>${fmt(e.createdAt)}</time></div>`;
    }
    return `<div class="h-row"><span class="tag">−1 vé</span><div>Dùng <b>${label}</b> để quay</div><time>${fmt(e.createdAt)}</time></div>`;
  }
  if (e.kind === 'gift') {
    const list = e.cards.map((c) => `${esc(gen(c.generalId).name)} Lv.${c.level}`).join(', ');
    return e.direction === 'sent'
      ? `<div class="h-row"><span class="tag bad">Tặng ${e.cards.length}</span><div>Tặng <b>${e.cards.length} thẻ</b> cho <b>${esc(e.otherUsername)}</b><details><summary class="muted small">Xem thẻ</summary><div class="small">${list}</div></details></div><time>${fmt(e.createdAt)}</time></div>`
      : `<div class="h-row"><span class="tag ok">Nhận ${e.cards.length}</span><div>Nhận <b>${e.cards.length} thẻ</b> từ <b>${esc(e.otherUsername)}</b><details><summary class="muted small">Xem thẻ</summary><div class="small">${list}</div></details></div><time>${fmt(e.createdAt)}</time></div>`;
  }
  if (e.kind === 'gacha') {
    return `<div class="h-row"><span class="tag gacha">Quay</span><div>${TICKET_LABELS[e.ticketType]} → <b>${esc(gen(e.generalId).name)} Lv.${e.cardLevel}</b> <span class="muted">(thẻ #${e.cardId})</span></div><time>${fmt(e.createdAt)}</time></div>`;
  }
  const dist = e.failureDistribution.map((d) => `Lv.${d.level}: ${pct(d.bps)}`).join(' · ');
  return `<div class="h-row"><span class="tag ${e.outcome === 'success' ? 'ok' : 'bad'}">${e.outcome === 'success' ? 'Ghép ✓' : 'Ghép ✗'}</span>
    <div><b>${esc(gen(e.generalId).name)}</b> ${e.inputCardIds.length}× Lv.${e.inputLevel} (thẻ ${e.inputCardIds.map((i) => '#' + i).join(', ')}) → <b>Lv.${e.resultLevel}</b> (thẻ #${e.resultCardId})
    <details><summary class="muted small">Tỷ lệ đã áp dụng</summary><div class="small">Thành công ${pct(e.successBps)} · Thất bại ${pct(e.failureBps)}<br/>Phân phối thất bại: ${dist}</div></details></div>
    <time>${fmt(e.createdAt)}</time></div>`;
}

export function renderHistory(root: HTMLElement): () => void {
  let page = 1;
  let kind = '';
  let alive = true;
  const pageSize = 20;
  root.innerHTML = `
    <section class="panel">
      <div class="filters">
        <select data-kind aria-label="Loại"><option value="">Tất cả</option><option value="ticket">Vé (cấp/dùng)</option><option value="gacha">Quay thẻ</option><option value="upgrade">Nâng cấp</option><option value="gift">Tặng thẻ</option></select>
      </div>
      <div class="h-list"><div class="state-msg">Đang tải…</div></div>
      <div class="pager"><button class="btn ghost" data-prev>‹ Trước</button><span class="pinfo muted"></span><button class="btn ghost" data-next>Sau ›</button></div>
    </section>`;
  const list = root.querySelector<HTMLDivElement>('.h-list')!;
  const prev = root.querySelector<HTMLButtonElement>('[data-prev]')!;
  const next = root.querySelector<HTMLButtonElement>('[data-next]')!;

  async function load() {
    list.innerHTML = `<div class="state-msg">Đang tải…</div>`;
    try {
      const p = await api.history({ kind: kind || undefined, page, pageSize });
      if (!alive) return;
      const pages = Math.max(1, Math.ceil(p.total / pageSize));
      list.innerHTML = p.items.length ? p.items.map(row).join('') : `<div class="state-msg">Chưa có lịch sử.</div>`;
      root.querySelector('.pinfo')!.textContent = `Trang ${page}/${pages} · ${p.total} mục`;
      prev.disabled = page <= 1;
      next.disabled = page >= pages;
    } catch (e) {
      if (alive) list.innerHTML = `<div class="state-msg error">${esc((e as Error).message)}</div>`;
    }
  }
  root.querySelector<HTMLSelectElement>('[data-kind]')!.oninput = (ev) => {
    kind = (ev.target as HTMLSelectElement).value;
    page = 1;
    void load();
  };
  prev.onclick = () => {
    page--;
    void load();
  };
  next.onclick = () => {
    page++;
    void load();
  };
  void load();
  return () => (alive = false);
}
