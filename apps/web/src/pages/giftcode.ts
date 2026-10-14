import { TICKET_LABELS, type GiftCodeRedemptionDto, type GiftCodeReward } from '@tq/shared';
import { api, type ApiError } from '../api.ts';
import { setTickets } from '../state.ts';
import { esc } from '../art.ts';

/** "200 Vé Thục, 20 Vé Ngụy". Dòng "thẻ" chỉ còn ở code thẻ cũ (đã tắt). */
export const rewardText = (rewards: GiftCodeReward[]) =>
  rewards
    .map((r) => ((r.kind ?? 'card') === 'ticket' ? `${r.count} ${TICKET_LABELS[r.pool]}` : `${r.count} thẻ ${TICKET_LABELS[r.pool].replace('Vé ', '')}`))
    .join(', ');

const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN');

/**
 * Trang Giftcode (mục 3.9): người chơi nhập code để nhận vé quay (server cộng vé, ghi ledger);
 * mỗi code chỉ nhập được 1 lần. Hiển thị các code gợi ý và các code đã nhập.
 */
export function renderGiftCode(root: HTMLElement): () => void {
  let alive = true;
  let busy = false;
  root.innerHTML = `
    <section class="panel gc-panel">
      <h2>Nhập Giftcode</h2>
      <form class="gc-form">
        <input data-code placeholder="VD: THUCQUOC" maxlength="32" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Giftcode" required />
        <button class="btn primary" data-redeem>Nhận thưởng</button>
      </form>
      <p class="muted small">Mỗi giftcode chỉ nhập được 1 lần. Vé quay được cộng ngay vào tài khoản.</p>
      <div class="gc-msg" aria-live="polite"></div>
    </section>
    <section class="panel">
      <h3>Giftcode dành cho bạn</h3>
      <div class="gc-featured"><div class="state-msg">Đang tải…</div></div>
      <h3>Đã nhập</h3>
      <div class="gc-redeemed muted small"></div>
    </section>`;
  const form = root.querySelector<HTMLFormElement>('.gc-form')!;
  const input = root.querySelector<HTMLInputElement>('[data-code]')!;
  const btn = root.querySelector<HTMLButtonElement>('[data-redeem]')!;
  const msg = root.querySelector<HTMLDivElement>('.gc-msg')!;

  async function load() {
    try {
      const d = await api.giftcodes();
      if (!alive) return;
      root.querySelector('.gc-featured')!.innerHTML = d.featured.length
        ? d.featured
            .map(
              (c) => `<div class="gc-item ${c.redeemed ? 'done' : ''}">
                <b class="gc-code">${esc(c.code)}</b><span>${esc(rewardText(c.rewards))}</span>
                ${c.expiresAt ? `<span class="muted small">Hạn: ${fmt(c.expiresAt)}</span>` : ''}
                ${c.redeemed ? '<span class="tag ok">Đã nhập</span>' : `<button class="btn small" data-use="${esc(c.code)}">Nhập</button>`}
              </div>`,
            )
            .join('')
        : '<div class="state-msg">Không có giftcode gợi ý.</div>';
      root.querySelector('.gc-redeemed')!.innerHTML = d.redeemed.length
        ? d.redeemed
            .map((r) => `<div><b>${esc(r.code)}</b> · ${[r.ticketCount ? `${r.ticketCount} vé` : '', r.cardCount ? `${r.cardCount} thẻ` : ''].filter(Boolean).join(' + ')} · ${fmt(r.createdAt)}</div>`)
            .join('')
        : 'Chưa nhập giftcode nào.';
    } catch (e) {
      if (alive) root.querySelector('.gc-featured')!.innerHTML = `<div class="state-msg error">${esc((e as Error).message)}</div>`;
    }
  }

  function showResult(r: GiftCodeRedemptionDto) {
    setTickets(r.balances); // cập nhật thanh vé ngay
    const ticketLine = r.tickets.length
      ? `<div class="gc-levels">${r.tickets.map((t) => `<span class="tb t-${t.pool}">+${t.count} ${TICKET_LABELS[t.pool]}</span>`).join('')}</div>`
      : '';
    msg.innerHTML = `<div class="notice"><b>Nhận thưởng thành công!</b> Giftcode <b>${esc(r.code)}</b>: ${esc(rewardText(r.rewards))}. Vào tab Quay thẻ để dùng vé.</div>${ticketLine}`;
  }

  async function redeem(code: string) {
    if (busy || !code.trim()) return;
    busy = true;
    btn.disabled = true;
    msg.innerHTML = '<div class="muted">Đang nhận thưởng…</div>';
    try {
      const r = await api.redeemGiftCode(code.trim());
      if (!alive) return;
      input.value = '';
      showResult(r);
      void load();
    } catch (e) {
      if (alive) msg.innerHTML = `<div class="warn">${esc((e as ApiError).message)}</div>`;
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }

  form.onsubmit = (ev) => {
    ev.preventDefault();
    void redeem(input.value);
  };
  root.querySelector<HTMLDivElement>('.gc-featured')!.onclick = (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-use]');
    if (b) {
      input.value = b.dataset.use!;
      void redeem(b.dataset.use!);
    }
  };
  void load();
  input.focus();
  return () => (alive = false);
}
