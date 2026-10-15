import { For, Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { TICKET_LABELS, TICKET_TYPES, FACTION_LABELS, type TicketType } from '@tq/shared';
import { api, newKey, type ApiError } from '../api.ts';
import { state, setTickets, tickets, gen } from '../state.ts';
import { pct, levelTier } from '../art.ts';
import { playReveal, playRevealMany, type StageAction } from '../pixi/stage.ts';

export function DrawPage(): JSX.Element {
  const [selected, setSelected] = createSignal<TicketType>('normal');
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal('');
  const [msgError, setMsgError] = createSignal(false);
  /** Dòng tóm tắt sau khi đóng màn mở thẻ. */
  const [last, setLast] = createSignal('');
  let alive = true;
  onCleanup(() => (alive = false));
  /**
   * Key giữ nguyên cho tới khi request có phản hồi xác định -> retry an toàn sau lỗi mạng.
   * Gắn với (loại vé, số lần) để không dùng lại key cho một yêu cầu khác.
   */
  let pending: { key: string; type: TicketType; count: number } | null = null;

  const cfg = state.config!;
  const counts = [...cfg.drawCountOptions].sort((a, b) => a - b);

  /** Nút "Quay tiếp" trong màn kết quả: cùng loại vé, cùng các lựa chọn số lần như ở trang. */
  function againActions(balance: number): StageAction[] {
    if (balance <= 0) return [{ label: `Hết ${TICKET_LABELS[selected()]}`, value: '', disabled: true }];
    return counts
      .filter((n) => n === 1 || balance !== 1)
      .map((n) => ({
        label: n === 1 ? 'Quay tiếp 1 vé' : balance < n ? `Quay hết ${balance} vé` : `Quay tiếp ${n} vé`,
        value: String(n),
        primary: n !== 1,
      }));
  }

  /** Nhãn nút: "Quay ×10", hoặc "Quay hết 3 vé" khi số dư ít hơn số lần. Server vẫn là bên quyết định số lượt thật. */
  function btnLabel(n: number, balance: number): string {
    if (n === 1) return 'Quay 1 lần';
    return balance > 0 && balance < n ? `Quay hết ${balance} vé` : `Quay ×${n}`;
  }

  function poolSize(t: TicketType): number {
    return state.config?.ticketTypes.find((x) => x.id === t)?.pool.length ?? 0;
  }

  const balance = () => tickets()?.balances[selected()] ?? 0;
  // Ẩn nút ×N trùng hành vi với nút ×1 khi chỉ còn 1 vé
  const shownCounts = createMemo(() => counts.filter((n) => n === 1 || balance() !== 1));
  const pool = createMemo(() => cfg.ticketTypes.find((t) => t.id === selected())?.pool ?? []);

  function pick(t: TicketType) {
    setSelected(t);
    pending = null;
    setMsg('');
  }

  async function doDraw(count: number) {
    if (busy()) return;
    setBusy(true);
    setMsg('');
    setMsgError(false);
    const type = selected();
    if (!pending || pending.type !== type || pending.count !== count) {
      pending = { key: newKey(), type, count };
    }
    try {
      const r = await api.draw(type, count, pending.key);
      pending = null;
      setTickets(r.tickets);
      const label = TICKET_LABELS[r.ticketType];
      const caption =
        r.drawn === 1
          ? `Đã dùng 1 ${label} → ${r.results[0]!.general.name} Lv.${r.results[0]!.card.level}`
          : `Đã dùng ${r.drawn} ${label}`;
      setLast('');
      setBusy(false);
      // Chỉ hiện kết quả trong màn mở thẻ (không lộ trước ở trang); sau khi đóng chỉ còn dòng tóm tắt.
      const actions = againActions(r.tickets.balances[r.ticketType]);
      const choice =
        r.results.length === 1
          ? await playReveal(r.results[0]!.general, r.results[0]!.card.level, caption, actions)
          : await playRevealMany(r.results.map((x) => ({ general: x.general, level: x.card.level })), caption, actions);
      setLast(caption);
      // "Quay tiếp": quay ngay cùng loại vé, y như bấm nút quay ở trang
      if (choice && alive) void doDraw(Number(choice));
    } catch (e) {
      const err = e as ApiError;
      // Lỗi mạng: giữ key để lần bấm lại là retry an toàn (server trả kết quả cũ nếu đã ghi).
      if (err.code !== 'NETWORK') pending = null;
      setMsg(err.code === 'NO_TICKETS' ? 'Bạn đã hết vé loại này.' : err.message);
      setMsgError(true);
      setBusy(false);
      if (err.code === 'NO_TICKETS') api.tickets().then(setTickets).catch(() => {});
    }
  }

  return (
    <>
      <section class="panel">
        <h2>Chọn loại vé</h2>
        <div class="ticket-picker" role="radiogroup">
          <For each={TICKET_TYPES}>
            {(t) => {
              const b = () => tickets()?.balances;
              const cap = () => tickets()?.recoveryCap; // trần vé hồi theo loại (vé từ nguồn khác có thể vượt)
              return (
                <button
                  role="radio"
                  aria-checked={t === selected() ? 'true' : 'false'}
                  class={`ticket t-${t}`}
                  classList={{ on: t === selected() }}
                  data-t={t}
                  onClick={() => pick(t)}
                >
                  <span class="t-name">{TICKET_LABELS[t]}</span>
                  <span
                    class="t-count"
                    classList={{ full: !!(b() && cap() && b()![t] >= cap()![t]) }}
                    title={cap() ? `Vé hồi theo thời gian tối đa ${cap()![t]}; nhiệm vụ, giftcode… vẫn cộng vượt được` : ''}
                  >
                    {b() ? b()![t] : '–'}
                    <Show when={cap()}>{(c) => <small class="t-cap"> / {c()[t]}</small>}</Show>
                  </span>
                  <span class="t-pool muted">
                    {poolSize(t)} tướng{t === 'normal' ? '' : ` ${FACTION_LABELS[t]}`}
                  </span>
                </button>
              );
            }}
          </For>
        </div>
        <div class="draw-row">
          <div class="draw-btns">
            <For each={shownCounts()}>
              {(n) => (
                <button
                  class={`btn ${n === 1 ? 'ghost' : 'primary'} big`}
                  data-n={n}
                  disabled={busy() || balance() <= 0}
                  onClick={() => void doDraw(n)}
                >
                  {busy() ? 'Đang quay…' : balance() <= 0 ? 'Hết vé loại này' : btnLabel(n, balance())}
                </button>
              )}
            </For>
          </div>
          <div class="draw-msg" classList={{ error: msgError() }} aria-live="polite">
            {msg()}
          </div>
        </div>
        <div class="last-result">
          <Show when={last()}>
            <div class="muted small">{last()}</div>
          </Show>
        </div>
      </section>
      <div class="two-col">
        <section class="panel">
          <h3>Tỷ lệ level (server đang áp dụng)</h3>
          <table class="rates">
            <tbody>
              <For each={cfg.levelRates}>
                {(r) => (
                  <tr>
                    <td>
                      <span class="lv-dot" style={{ '--tc': levelTier(r.level).css }} />
                      Lv.{r.level}
                    </td>
                    <td>{pct(r.bps, cfg.bpsScale)}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
        <section class="panel">
          <h3>
            Pool tướng{' '}
            <span class="pool-count muted">
              ({pool().length} tướng, mỗi tướng {pct(10000 / pool().length)})
            </span>
          </h3>
          <div class="pool">
            <For each={pool()}>
              {(id) => {
                const g = gen(id);
                return <span class={`chip f-${g.faction}`}>{g.name}</span>;
              }}
            </For>
          </div>
        </section>
      </div>
    </>
  );
}
