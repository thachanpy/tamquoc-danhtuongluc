import { For, Match, Show, Switch, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { FACTIONS, FACTION_LABELS, type CardDto, type RecipientDto } from '@tq/shared';
import { api, fetchAllCards, newKey, type ApiError } from '../api.ts';
import { gen, state } from '../state.ts';
import { Card } from '../components/Card.tsx';
import { groupCardsByGeneral, type UpgradeSort } from '../upgrade-groups.ts';
import { openCardViewer } from '../viewer.tsx';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** "5 phút trước", "3 giờ trước", "2 ngày trước". */
function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 60 * 24) return `${Math.round(m / 60)} giờ trước`;
  return `${Math.round(m / 1440)} ngày trước`;
}

type GiftMsg = { kind: 'ok'; count: number; to: string } | { kind: 'error'; text: string };
type Confirm = { username: string; picked: CardDto[]; hi: number };

/**
 * Bộ sưu tập (mục 6.1) + Tặng thẻ (mục 5.6).
 * - Thẻ gom theo tướng: mọi bản sao cùng tướng nằm chung một khung, level cao → thấp.
 * - Chế độ xem "Tướng chưa có" hiện các tướng chưa sở hữu (mờ).
 * - Bật "Tặng thẻ" để chọn tối đa GIFT_MAX_CARDS thẻ và người nhận (dropdown có tìm kiếm,
 *   người giao dịch gần nhất lên đầu). Server kiểm tra lại toàn bộ và chuyển thẻ nguyên tử.
 */
export function CollectionPage(): JSX.Element {
  const MAX = state.config!.giftMaxCards;
  let alive = true;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    alive = false;
    clearTimeout(blurTimer);
  });

  // --- dữ liệu thẻ + bộ lọc
  const [cards, setCards] = createSignal<CardDto[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [q, setQ] = createSignal('');
  const [faction, setFaction] = createSignal('');
  const [level, setLevel] = createSignal('');
  const [view, setView] = createSignal('mine');
  const [sort, setSort] = createSignal<UpgradeSort>('level_desc');

  // --- trạng thái tặng thẻ
  const [giftMode, setGiftMode] = createSignal(false);
  const [selected, setSelected] = createSignal<number[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [confirm, setConfirm] = createSignal<Confirm | null>(null);
  const [recipients, setRecipients] = createSignal<RecipientDto[]>([]);
  const [recipientsLoaded, setRecipientsLoaded] = createSignal(false);
  const [toValue, setToValue] = createSignal('');
  const [listOpen, setListOpen] = createSignal(false);
  const [activeIdx, setActiveIdx] = createSignal(-1);
  const [msg, setMsg] = createSignal<GiftMsg | null>(null);
  const okMsg = () => {
    const m = msg();
    return m?.kind === 'ok' ? m : null;
  };
  const errMsg = () => {
    const m = msg();
    return m?.kind === 'error' ? m : null;
  };
  let pending: { key: string; sig: string } | null = null;
  let toEl!: HTMLInputElement;

  // Bản cũ: lỗi tải hiện thay lưới cho tới lần vẽ lại kế tiếp (đổi lọc, bật/tắt tặng, chọn thẻ…)
  const redraw = () => setLoadError(null);

  // ================= Lưới thẻ =================
  const ownedIds = createMemo(() => new Set(cards().map((c) => c.generalId)));
  const matchGeneral = (id: string) => {
    const g = gen(id);
    const fq = fold(q().trim());
    return (!faction() || g.faction === faction()) && (!fq || fold(g.name).includes(fq));
  };
  const missing = createMemo(() => state.generals.filter((g) => !ownedIds().has(g.id) && matchGeneral(g.id)));
  const filtered = createMemo(() => cards().filter((c) => matchGeneral(c.generalId) && (!level() || c.level === Number(level()))));
  // Gom theo tướng; inputCount rất lớn để không đánh dấu "đủ ghép" ở trang này
  const groups = createMemo(() => groupCardsByGeneral(filtered(), (id) => gen(id).name, sort(), Number.MAX_SAFE_INTEGER));

  function toggleCard(id: number) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, MAX)));
    closeConfirm();
    redraw();
  }

  // Giống trang Nâng cấp: chia nhóm theo level ("Lv.1 ×3"), mỗi thẻ hiện số thẻ #id
  const CardButton = (p: { card: CardDto }) => (
    <Show
      when={giftMode()}
      fallback={
        <button class="pick view" title="Xem thẻ" onClick={() => openCardViewer(gen(p.card.generalId), p.card)}>
          <Card general={gen(p.card.generalId)} level={p.card.level} extra="small" />
          <span class="cid">#{p.card.id}</span>
        </button>
      }
    >
      {(() => {
        const on = () => selected().includes(p.card.id);
        return (
          <button
            class={`pick ${on() ? 'on' : ''}`}
            disabled={!on() && (busy() || selected().length >= MAX)}
            aria-pressed={on() ? 'true' : 'false'}
            onClick={() => toggleCard(p.card.id)}
          >
            <Card general={gen(p.card.generalId)} level={p.card.level} extra="small" />
            <span class="cid">#{p.card.id}</span>
          </button>
        );
      })()}
    </Show>
  );

  // ================= Người nhận (combobox) =================
  const findRecipient = (name: string) => recipients().find((r) => r.username.toLowerCase() === name.trim().toLowerCase());
  const listItems = createMemo(() => {
    const fq = fold(toValue().trim());
    return recipients()
      .filter((r) => !fq || fold(r.username).includes(fq))
      .slice(0, 50);
  });

  async function loadRecipients() {
    try {
      const items = (await api.users()).items;
      if (!alive) return;
      setRecipients(items);
      setRecipientsLoaded(true);
    } catch (e) {
      if (alive) setMsg({ kind: 'error', text: `Không tải được danh sách người chơi: ${(e as Error).message}` });
    }
  }

  function openList() {
    setActiveIdx((i) => Math.min(i, listItems().length - 1));
    setListOpen(true);
  }
  function hideList() {
    setListOpen(false);
    setActiveIdx(-1);
  }
  function pick(name: string) {
    setToValue(name);
    toEl.value = name;
    hideList();
    closeConfirm();
    setMsg(null);
  }
  function onToKeyDown(ev: KeyboardEvent) {
    const n = recipientsLoaded() ? listItems().length : 0;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActiveIdx((i) => Math.max(0, Math.min(n - 1, Math.min(i, n - 1) + (ev.key === 'ArrowDown' ? 1 : -1))));
      setListOpen(true);
    } else if (ev.key === 'Enter' && listOpen() && activeIdx() >= 0 && activeIdx() < n) {
      ev.preventDefault();
      pick(listItems()[activeIdx()]!.username);
    } else if (ev.key === 'Escape') {
      hideList();
    }
  }

  // ================= Thanh tặng thẻ =================
  const validRecipient = () => !!findRecipient(toValue());
  function closeConfirm() {
    setConfirm(null);
  }

  function showConfirm() {
    const r = findRecipient(toValue());
    if (!r) return;
    const byId = new Map(cards().map((c) => [c.id, c]));
    const picked = selected()
      .map((id) => byId.get(id))
      .filter((c): c is CardDto => !!c);
    setConfirm({ username: r.username, picked, hi: picked.filter((c) => c.level >= 6).length });
  }

  async function send(to: string) {
    if (busy()) return;
    setBusy(true);
    const ids = [...selected()].sort((a, b) => a - b);
    const sig = `${to.toLowerCase()}|${ids.join(',')}`;
    // Giữ key khi lỗi mạng để bấm lại là retry an toàn (server không chuyển thẻ 2 lần)
    if (!pending || pending.sig !== sig) pending = { key: newKey(), sig };
    try {
      const r = await api.gift(to, ids, pending.key);
      pending = null;
      if (!alive) return;
      setSelected([]);
      closeConfirm();
      setMsg({ kind: 'ok', count: r.cards.length, to: r.toUsername });
      setBusy(false);
      await Promise.all([load(), loadRecipients()]); // người vừa nhận lên đầu danh sách
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') pending = null;
      if (!alive) return;
      setBusy(false);
      closeConfirm();
      setMsg({ kind: 'error', text: err.message });
      if (err.code === 'CARD_NOT_FOUND' || err.code === 'CARD_CONSUMED') {
        setSelected([]);
        await load();
      } else {
        redraw();
      }
    }
  }

  // ================= Sự kiện chung =================
  function toggleGift() {
    const on = !giftMode();
    setGiftMode(on);
    if (on) {
      if (view() !== 'mine') setView('mine');
      if (!recipientsLoaded()) void loadRecipients();
    } else {
      setSelected([]);
      closeConfirm();
      setMsg(null);
    }
    redraw();
  }

  async function load() {
    try {
      const list = await fetchAllCards();
      if (!alive) return;
      setCards(list);
      setSelected((s) => s.filter((id) => list.some((c) => c.id === id)));
      setLoaded(true);
      setLoadError(null);
    } catch (e) {
      if (alive) setLoadError((e as Error).message);
    }
  }
  void load();

  return (
    <>
      <section class="panel">
        <div class="coll-head">
          <div class="summary muted">
            <Show when={loaded()}>{`Đã sở hữu ${ownedIds().size}/${state.generals.length} tướng · ${cards().length} thẻ`}</Show>
          </div>
          {/* Tặng thẻ tạm tắt (server features.gift = false) => ẩn nút */}
          <Show when={state.features.gift}>
            <button class={giftMode() ? 'btn ghost small' : 'btn primary small'} onClick={toggleGift}>
              {giftMode() ? 'Đóng tặng thẻ' : '🎁 Tặng thẻ'}
            </button>
          </Show>
        </div>
        <div class="gift-panel" hidden={!giftMode()}>
          <p class="muted small">
            Chọn tối đa <b>{MAX} thẻ</b> bên dưới rồi chọn người nhận. Người nhận có thẻ ngay; thẻ đã tặng không lấy lại được.
          </p>
          <div class="gift-form">
            <div class="combo">
              <label for="gift-to">Người nhận</label>
              <input
                ref={toEl}
                id="gift-to"
                placeholder="Tìm người chơi…"
                maxLength={32}
                autocomplete="off"
                role="combobox"
                aria-expanded={listOpen() ? 'true' : 'false'}
                aria-controls="gift-to-list"
                value={toValue()}
                onFocus={() => openList()}
                onBlur={() => {
                  clearTimeout(blurTimer);
                  blurTimer = setTimeout(hideList, 100);
                }}
                onInput={(e) => {
                  setToValue(e.currentTarget.value);
                  setActiveIdx(-1);
                  closeConfirm();
                  setMsg(null);
                  setListOpen(true);
                }}
                onKeyDown={onToKeyDown}
              />
              <ul class="combo-list" id="gift-to-list" role="listbox" hidden={!listOpen()}>
                <Switch>
                  <Match when={!recipientsLoaded()}>
                    <li class="muted small">Đang tải…</li>
                  </Match>
                  <Match when={listItems().length === 0}>
                    <li class="muted small">Không tìm thấy người chơi.</li>
                  </Match>
                  <Match when={true}>
                    <For each={listItems()}>
                      {(r, i) => (
                        <li
                          role="option"
                          data-name={r.username}
                          class={i() === activeIdx() ? 'active' : ''}
                          aria-selected={i() === activeIdx() ? 'true' : 'false'}
                          onMouseDown={(ev) => {
                            ev.preventDefault(); // giữ focus, tránh blur trước khi chọn
                            pick(r.username);
                          }}
                        >
                          <span>{r.username}</span>
                          <Show when={r.lastGiftAt}>{(at) => <span class="recent">Gần đây · {ago(at())}</span>}</Show>
                        </li>
                      )}
                    </For>
                  </Match>
                </Switch>
              </ul>
            </div>
            <span class="gift-count muted">{`Đã chọn ${selected().length}/${MAX}`}</span>
            <button
              class="btn ghost small"
              onClick={() => {
                setSelected([]);
                closeConfirm();
                redraw();
              }}
            >
              Bỏ chọn
            </button>
            <button
              class="btn primary"
              disabled={busy() || !!confirm() || selected().length === 0 || !validRecipient()}
              title={!validRecipient() && toValue().trim() ? 'Chọn người nhận trong danh sách' : ''}
              onClick={() => {
                setMsg(null);
                showConfirm();
              }}
            >
              {busy() ? 'Đang tặng…' : selected().length ? `Tặng ${selected().length} thẻ` : 'Tặng'}
            </button>
          </div>
          <div class="gift-confirm">
            <Show when={confirm()}>
              {(c) => (
                <div class="quick-box">
                  <p>
                    <b>{`Xác nhận tặng ${c().picked.length} thẻ cho "${c().username}"?`}</b>
                  </p>
                  <div class="result-cards">
                    <For each={c().picked}>{(card) => <Card general={gen(card.generalId)} level={card.level} extra="small" />}</For>
                  </div>
                  <p class="warn">
                    ⚠ Thẻ sẽ chuyển ngay sang người nhận và không thể lấy lại.
                    {c().hi ? ` Trong đó có ${c().hi} thẻ từ Lv.6 trở lên.` : ''}
                  </p>
                  <button class="btn ghost" disabled={busy()} onClick={() => closeConfirm()}>
                    Huỷ
                  </button>{' '}
                  <button class="btn danger" disabled={busy()} onClick={() => void send(c().username)}>
                    Xác nhận tặng
                  </button>
                </div>
              )}
            </Show>
          </div>
          <div class="gift-msg" aria-live="polite">
            <Show when={okMsg()}>
              {(ok) => (
                <span class="ok">
                  ✓ Đã tặng {ok().count} thẻ cho <b>{ok().to}</b>.
                </span>
              )}
            </Show>
            <Show when={errMsg()}>{(er) => <span class="error">{er().text}</span>}</Show>
          </div>
        </div>
        <div class="filters">
          <input
            type="search"
            placeholder="Tìm theo tên tướng…"
            aria-label="Tìm tướng"
            onInput={(e) => {
              setQ(e.currentTarget.value);
              redraw();
            }}
          />
          <select
            aria-label="Phe"
            onInput={(e) => {
              setFaction(e.currentTarget.value);
              redraw();
            }}
          >
            <option value="">Mọi phe</option>
            <For each={FACTIONS}>{(f) => <option value={f}>{FACTION_LABELS[f]}</option>}</For>
          </select>
          <select
            aria-label="Level"
            onInput={(e) => {
              setLevel(e.currentTarget.value);
              redraw();
            }}
          >
            <option value="">Mọi level</option>
            <For each={Array.from({ length: 10 }, (_, i) => i + 1)}>{(lv) => <option value={String(lv)}>Lv.{lv}</option>}</For>
          </select>
          <select
            aria-label="Sắp xếp"
            onInput={(e) => {
              setSort(e.currentTarget.value as UpgradeSort);
              redraw();
            }}
          >
            <option value="level_desc" selected>
              Level cao nhất
            </option>
            <option value="name">Tên A→Z</option>
            <option value="count">Nhiều thẻ nhất</option>
          </select>
          <select
            aria-label="Chế độ xem"
            value={view()}
            onInput={(e) => {
              setView(e.currentTarget.value);
              redraw();
            }}
          >
            <option value="mine">Thẻ của tôi</option>
            <option value="missing">Tướng chưa có</option>
          </select>
        </div>
      </section>
      <div class="pick-grid">
        <Switch>
          <Match when={loadError()}>{(err) => <div class="state-msg error">Không tải được bộ sưu tập: {err()}</div>}</Match>
          <Match when={!loaded()}>
            <div class="state-msg">Đang tải bộ sưu tập…</div>
          </Match>
          <Match when={view() === 'missing'}>
            <Show
              when={missing().length}
              fallback={
                <div class="state-msg">
                  {ownedIds().size === state.generals.length
                    ? `Bạn đã sở hữu đủ ${state.generals.length} tướng!`
                    : 'Không có tướng phù hợp bộ lọc.'}
                </div>
              }
            >
              <div class="grid">
                <For each={missing()}>
                  {(g) => (
                    <div class="grid-item">
                      <Card general={g} level={null} />
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </Match>
          <Match when={cards().length === 0}>
            <div class="state-msg">Bạn chưa có thẻ nào. Hãy quay thẻ ở tab Quay thẻ.</div>
          </Match>
          <Match when={filtered().length === 0}>
            <div class="state-msg">Không có thẻ phù hợp bộ lọc.</div>
          </Match>
          <Match when={true}>
            <For each={groups()}>
              {(g) => {
                const f = gen(g.generalId).faction;
                return (
                  <div class={`gen-group f-${f}`}>
                    <div class="gen-head">
                      <b>{g.name}</b>
                      <span class="muted small">{`${FACTION_LABELS[f]} · ${g.total} thẻ`}</span>
                    </div>
                    <div class="gen-runs">
                      <For each={g.runs}>
                        {(r) => (
                          <div class="lv-run">
                            <div class="run-label">{`Lv.${r.level} ×${r.cards.length}`}</div>
                            <div class="run-cards">
                              <For each={r.cards}>{(c) => <CardButton card={c} />}</For>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                );
              }}
            </For>
          </Match>
        </Switch>
      </div>
    </>
  );
}
