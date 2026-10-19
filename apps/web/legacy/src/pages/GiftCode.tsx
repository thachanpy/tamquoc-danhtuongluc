import { For, Match, Show, Switch, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { TICKET_LABELS, type GiftCodePublicDto, type GiftCodeRedemptionDto } from '@tq/shared';
import { api, type ApiError } from '../api.ts';
import { setTickets } from '../state.ts';
import { rewardText } from '../giftcode-text.ts';

const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN');

type Redeemed = { code: string; cardCount: number; ticketCount: number; createdAt: string };
type Featured = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; items: GiftCodePublicDto[] };
type Msg = { kind: 'loading' } | { kind: 'ok'; r: GiftCodeRedemptionDto } | { kind: 'warn'; text: string } | null;

/**
 * Trang Giftcode (mục 3.9): người chơi nhập code để nhận vé quay (server cộng vé, ghi ledger);
 * mỗi code chỉ nhập được 1 lần. Hiển thị các code gợi ý và các code đã nhập.
 */
export function GiftCodePage(): JSX.Element {
  let alive = true;
  onCleanup(() => (alive = false));
  let input!: HTMLInputElement;
  const [code, setCode] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [msg, setMsg] = createSignal<Msg>(null);
  const [featured, setFeatured] = createSignal<Featured>({ kind: 'loading' });
  /** null = chưa tải (khối trống như bản cũ). */
  const [redeemed, setRedeemed] = createSignal<Redeemed[] | null>(null);

  async function load() {
    try {
      const d = await api.giftcodes();
      if (!alive) return;
      setFeatured({ kind: 'ok', items: d.featured });
      setRedeemed(d.redeemed);
    } catch (e) {
      if (alive) setFeatured({ kind: 'error', message: (e as Error).message });
    }
  }

  async function redeem(c: string) {
    if (busy() || !c.trim()) return;
    setBusy(true);
    setMsg({ kind: 'loading' });
    try {
      const r = await api.redeemGiftCode(c.trim());
      if (!alive) return;
      setCode('');
      setTickets(r.balances); // cập nhật thanh vé ngay
      setMsg({ kind: 'ok', r });
      void load();
    } catch (e) {
      if (alive) setMsg({ kind: 'warn', text: (e as ApiError).message });
    } finally {
      setBusy(false);
    }
  }

  void load();
  onMount(() => input.focus());

  return (
    <>
      <section class="panel gc-panel">
        <h2>Nhập Giftcode</h2>
        <form
          class="gc-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            void redeem(input.value);
          }}
        >
          <input
            ref={input}
            data-code
            placeholder="VD: THUCQUOC"
            maxLength={32}
            autocomplete="off"
            autocapitalize="characters"
            spellcheck={false}
            aria-label="Giftcode"
            required
            value={code()}
            onInput={(ev) => setCode(ev.currentTarget.value)}
          />
          <button class="btn primary" data-redeem disabled={busy()}>
            Nhận thưởng
          </button>
        </form>
        <p class="muted small">Mỗi giftcode chỉ nhập được 1 lần. Vé quay được cộng ngay vào tài khoản.</p>
        <div class="gc-msg" aria-live="polite">
          <Switch>
            <Match when={msg()?.kind === 'loading'}>
              <div class="muted">Đang nhận thưởng…</div>
            </Match>
            <Match when={(() => { const m = msg(); return m?.kind === 'warn' ? m : null; })()}>
              {(m) => <div class="warn">{m().text}</div>}
            </Match>
            <Match when={(() => { const m = msg(); return m?.kind === 'ok' ? m.r : null; })()}>
              {(r) => (
                <>
                  <div class="notice">
                    <b>Nhận thưởng thành công!</b> Giftcode <b>{r().code}</b>: {rewardText(r().rewards)}. Vào tab Quay thẻ để dùng vé.
                  </div>
                  <Show when={r().tickets.length}>
                    <div class="gc-levels">
                      <For each={r().tickets}>
                        {(t) => (
                          <span class={`tb t-${t.pool}`}>
                            +{t.count} {TICKET_LABELS[t.pool]}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                </>
              )}
            </Match>
          </Switch>
        </div>
      </section>
      <section class="panel">
        <h3>Giftcode dành cho bạn</h3>
        <div class="gc-featured">
          <Switch>
            <Match when={featured().kind === 'loading'}>
              <div class="state-msg">Đang tải…</div>
            </Match>
            <Match when={(() => { const f = featured(); return f.kind === 'error' ? f : null; })()}>
              {(f) => <div class="state-msg error">{f().message}</div>}
            </Match>
            <Match when={(() => { const f = featured(); return f.kind === 'ok' ? f.items : null; })()}>
              {(items) => (
                <Show when={items().length} fallback={<div class="state-msg">Không có giftcode gợi ý.</div>}>
                  <For each={items()}>
                    {(c) => (
                      <div class="gc-item" classList={{ done: c.redeemed }}>
                        <b class="gc-code">{c.code}</b>
                        <span>{rewardText(c.rewards)}</span>
                        <Show when={c.expiresAt}>
                          <span class="muted small">Hạn: {fmt(c.expiresAt!)}</span>
                        </Show>
                        <Show
                          when={!c.redeemed}
                          fallback={<span class="tag ok">Đã nhập</span>}
                        >
                          <button
                            class="btn small"
                            data-use={c.code}
                            onClick={() => {
                              setCode(c.code);
                              void redeem(c.code);
                            }}
                          >
                            Nhập
                          </button>
                        </Show>
                      </div>
                    )}
                  </For>
                </Show>
              )}
            </Match>
          </Switch>
        </div>
        <h3>Đã nhập</h3>
        <div class="gc-redeemed muted small">
          <Show when={redeemed()}>
            {(list) => (
              <Show when={list().length} fallback={'Chưa nhập giftcode nào.'}>
                <For each={list()}>
                  {(r) => (
                    <div>
                      <b>{r.code}</b> ·{' '}
                      {[r.ticketCount ? `${r.ticketCount} vé` : '', r.cardCount ? `${r.cardCount} thẻ` : ''].filter(Boolean).join(' + ')} · {fmt(r.createdAt)}
                    </div>
                  )}
                </For>
              </Show>
            )}
          </Show>
        </div>
      </section>
    </>
  );
}
