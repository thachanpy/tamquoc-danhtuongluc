import { For, Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import { FACTIONS, FACTION_LABELS, PVP_STYLES, PVP_STYLE_LABELS, type CardDto, type UpgradePreviewDto } from '@tq/shared';
import { api, fetchAllCards, newKey, type ApiError } from '../api.ts';
import { gen, genStyle, state } from '../state.ts';
import { pct } from '../art.ts';
import { playUpgrade } from '../pixi/stage.ts';
import { groupCardsByGeneral, type UpgradeSort } from '../upgrade-groups.ts';
import { Card } from '../components/Card.tsx';

/** Tổng kết sau khi Nâng cấp nhanh (hoặc lỗi). */
type QuickSummary =
  | {
      kind: 'ok';
      merges: number;
      successes: number;
      failures: number;
      best: number;
      byLevel: [number, { n: number; ok: number }][];
      hasMore: boolean;
    }
  | { kind: 'error'; message: string };

export function UpgradePage(): JSX.Element {
  /** Số thẻ mỗi lần ghép — lấy từ cấu hình server. */
  const N = state.config!.upgradeInputCount;
  /** Mức level mặc định được chọn sẵn cho Nâng cấp nhanh (cấu hình server, mặc định 5). */
  const Q = state.config!.quickUpgradeMaxLevel;
  /** Mọi level có thể chọn ở Nâng cấp nhanh (Lv.1–9; Lv.10 không ghép tiếp được). */
  const allLevels = state.config!.upgradeRates.map((r) => r.level);

  /** null = chưa tải xong lần nào. */
  const [cards, setCards] = createSignal<CardDto[] | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<number[]>([]);
  const [preview, setPreview] = createSignal<UpgradePreviewDto | null>(null);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  /** Đang ở bước "Xác nhận ghép?". */
  const [confirming, setConfirming] = createSignal(false);
  const [upMsg, setUpMsg] = createSignal('');
  const [quickConfirming, setQuickConfirming] = createSignal(false);
  const [quickSummary, setQuickSummary] = createSignal<QuickSummary | null>(null);
  /** Các level đầu vào tham gia Nâng cấp nhanh; mặc định chọn sẵn Lv.1–Q. */
  const [quickLevels, setQuickLevels] = createSignal<number[]>(allLevels.filter((lv) => lv <= Q));
  const [fFaction, setFFaction] = createSignal('');
  const [fStyle, setFStyle] = createSignal('');
  const [fLevel, setFLevel] = createSignal('');
  const [fSort, setFSort] = createSignal<UpgradeSort>('level_desc');

  let pendingKey: string | null = null;
  let quickKey: string | null = null;
  let alive = true;
  onCleanup(() => (alive = false));

  const list = () => cards() ?? [];
  const byId = createMemo(() => new Map(list().map((c) => [c.id, c])));

  /** Số cặp có thể ghép NGAY trong các level đã chọn (chỉ để hiển thị; server tự tính lại và ghép dây chuyền). */
  const quickPairs = createMemo(() => {
    const sel = new Set(quickLevels());
    const count = new Map<string, number>();
    for (const c of list()) if (sel.has(c.level)) count.set(`${c.generalId}|${c.level}`, (count.get(`${c.generalId}|${c.level}`) ?? 0) + 1);
    return [...count.values()].reduce((s, n) => s + Math.floor(n / N), 0);
  });
  /** Bảng tỷ lệ của đúng các level đang chọn. */
  const quickRates = createMemo(() => {
    const sel = new Set(quickLevels());
    return state.config!.upgradeRates.filter((r) => sel.has(r.level));
  });

  /** Bật/tắt một level trong danh sách ghép nhanh. */
  function toggleQuickLevel(lv: number) {
    if (busy()) return;
    const cur = quickLevels();
    setQuickLevels(cur.includes(lv) ? cur.filter((x) => x !== lv) : [...cur, lv].sort((a, b) => a - b));
  }

  /** Các nhóm đủ N thẻ cùng tướng + cùng level (chip chọn nhanh). */
  const readyGroups = createMemo(() => {
    const groups = new Map<string, CardDto[]>();
    for (const c of list()) {
      if (c.level >= 10) continue;
      const k = `${c.generalId}|${c.level}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    return [...groups.values()].filter((g) => g.length >= N).sort((a, b) => b[0]!.level - a[0]!.level);
  });

  const filtered = createMemo(() =>
    list().filter((c) => {
      if (fFaction() && gen(c.generalId).faction !== fFaction()) return false;
      if (fStyle() && genStyle(c.generalId) !== fStyle()) return false;
      if (fLevel() && c.level !== Number(fLevel())) return false;
      return true;
    }),
  );
  // Gom theo tướng: mọi bản sao cùng tướng nằm liền nhau, chia nhóm con theo level.
  const genGroups = createMemo(() => groupCardsByGeneral(filtered(), (id) => gen(id).name, fSort(), N));

  function selectable(c: CardDto): boolean {
    if (c.level >= 10) return false;
    const first = byId().get(selected()[0] ?? -1);
    if (!first) return true;
    return c.generalId === first.generalId && c.level === first.level;
  }

  /** Card đang ở ô thứ i của khung "Đã chọn". */
  const slotCard = (i: number) => byId().get(selected()[i] ?? -1);

  async function onSelectionChange() {
    setPreview(null);
    setPreviewError(null);
    setConfirming(false);
    setUpMsg('');
    pendingKey = null;
    if (selected().length === N) {
      const ids = [...selected()];
      try {
        const p = await api.upgradePreview(ids);
        if (alive && ids.join() === selected().join()) setPreview(p);
      } catch (e) {
        if (alive && ids.join() === selected().join()) setPreviewError((e as Error).message);
      }
    }
  }

  function select(ids: number[]) {
    setSelected(ids);
    void onSelectionChange();
  }

  function togglePick(id: number) {
    const sel = selected();
    select(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  }

  function unpick(id: number) {
    if (busy()) return;
    select(selected().filter((x) => x !== id));
  }

  function clearSel() {
    if (busy()) return;
    select([]);
  }

  async function attempt() {
    if (busy() || selected().length !== N) return;
    setBusy(true);
    pendingKey ??= newKey();
    const ids = [...selected()];
    const inputCard = byId().get(ids[0]!)!;
    try {
      const r = await api.upgradeAttempt(ids, pendingKey);
      pendingKey = null;
      setSelected([]);
      setPreview(null);
      const g = gen(r.resultCard.generalId);
      const caption =
        r.outcome === 'success'
          ? `Thành công! ${g.name} Lv.${r.inputLevel} ×${r.inputCardIds.length} → Lv.${r.resultCard.level}`
          : `Thất bại. ${r.inputCardIds.length} thẻ Lv.${r.inputLevel} → nhận ${g.name} Lv.${r.resultCard.level}`;
      setBusy(false);
      await load();
      await playUpgrade(g, inputCard.level, r.resultCard.level, r.outcome, caption, r.inputCardIds.length);
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') pendingKey = null;
      setBusy(false);
      setConfirming(false);
      setUpMsg(err.message);
      if (err.code === 'CARD_CONSUMED' || err.code === 'CARD_NOT_FOUND') {
        setSelected([]);
        await load();
      }
    }
  }

  async function runQuick() {
    if (busy()) return;
    setBusy(true);
    quickKey ??= newKey();
    try {
      const r = await api.upgradeQuick(quickKey, quickLevels());
      quickKey = null;
      const byLevel = new Map<number, { n: number; ok: number }>();
      for (const x of r.results) {
        const b = byLevel.get(x.inputLevel) ?? { n: 0, ok: 0 };
        b.n++;
        if (x.outcome === 'success') b.ok++;
        byLevel.set(x.inputLevel, b);
      }
      setQuickSummary({
        kind: 'ok',
        merges: r.merges,
        successes: r.successes,
        failures: r.failures,
        best: Math.max(...r.results.map((x) => x.resultLevel)),
        byLevel: [...byLevel.entries()].sort((a, b) => a[0] - b[0]),
        hasMore: r.hasMore,
      });
      setBusy(false);
      setSelected([]);
      setPreview(null);
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') quickKey = null; // lỗi mạng: giữ key để bấm lại là retry an toàn
      setQuickSummary({ kind: 'error', message: err.message });
      setBusy(false);
      if (err.code === 'NOTHING_TO_UPGRADE') await load();
      else setQuickConfirming(false);
    }
  }

  async function load() {
    try {
      const all = await fetchAllCards();
      if (!alive) return;
      setCards(all);
      setLoadError(null);
      setSelected((sel) => sel.filter((id) => all.some((c) => c.id === id)));
      // Như bản cũ: tải lại thì đóng bước xác nhận và xoá thông báo lỗi ghép.
      setQuickConfirming(false);
      setConfirming(false);
      setUpMsg('');
    } catch (e) {
      if (alive) setLoadError((e as Error).message);
    }
  }
  void load();

  const cancelBtn = () => (
    <button class="btn ghost" data-clear disabled={busy()} onClick={clearSel}>
      Huỷ
    </button>
  );

  const pickBtn = (c: CardDto) => {
    const on = () => selected().includes(c.id);
    const dis = () => !on() && (!selectable(c) || selected().length >= N);
    return (
      <button
        class="pick"
        classList={{ on: on() }}
        data-id={c.id}
        disabled={dis()}
        aria-pressed={on() ? 'true' : 'false'}
        onClick={() => togglePick(c.id)}
      >
        <Card general={gen(c.generalId)} level={c.level} extra="small" />
      </button>
    );
  };

  return (
    <>
      <section class="panel">
        <h2>Ghép {N} thẻ</h2>
        <p class="muted">
          Chọn đúng {N} thẻ <b>cùng tướng</b> và <b>cùng level</b> (Lv.1–9).
        </p>
        <div class="quick">
          <Show when={cards()}>
            <div class="quick-box">
              <div class="quick-head">
                <button class="btn primary" data-quick disabled={busy() || quickLevels().length === 0 || quickPairs() === 0 || quickConfirming()} onClick={() => setQuickConfirming(true)}>
                  ⚡ Nâng cấp nhanh
                </button>
                <span class="muted small">
                  {quickPairs() > 0
                    ? `${quickPairs()} cặp có thể ghép ngay. Tự ghép liên tục mọi cặp ${N} thẻ cùng tướng, cùng level trong các mức đã chọn.`
                    : 'Chưa có cặp thẻ nào trong các mức đã chọn để ghép nhanh.'}
                </span>
              </div>
              <div class="quick-levels">
                <span class="muted small">Level ghép nhanh:</span>
                <For each={allLevels}>
                  {(lv) => (
                    <label class="lv-chk" classList={{ on: quickLevels().includes(lv) }}>
                      <input type="checkbox" checked={quickLevels().includes(lv)} disabled={busy()} onChange={() => toggleQuickLevel(lv)} />
                      Lv.{lv}
                    </label>
                  )}
                </For>
              </div>
              <Show when={quickConfirming()}>
                <div class="quick-confirm">
                  <table class="rates">
                    <thead>
                      <tr>
                        <td>Ghép</td>
                        <td>Thành công</td>
                        <td>Giữ nguyên</td>
                        <td>Tụt</td>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={quickRates()}>
                        {(r) => {
                          const fail = 10000 - r.successBps;
                          const keep = r.failureDistribution.find((e) => e.level === r.level)?.bps ?? 0;
                          return (
                            <tr>
                              <td>
                                Lv.{r.level} → {r.level + 1}
                              </td>
                              <td>{pct(r.successBps)}</td>
                              <td>{pct((fail * keep) / 10000)}</td>
                              <td>{pct(fail - (fail * keep) / 10000)}</td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                  <p class="warn">
                    ⚠ Mỗi lần ghép tiêu thụ {N} thẻ, có thể thất bại hoặc tụt level. Thẻ mới tạo ra thuộc mức đã chọn sẽ được ghép tiếp. Thẻ ở mức không chọn không bị
                    đụng tới.
                  </p>
                  <button class="btn ghost" data-quick-no onClick={() => setQuickConfirming(false)}>
                    Huỷ
                  </button>{' '}
                  <button class="btn danger" data-quick-yes disabled={busy()} onClick={() => void runQuick()}>
                    {busy() ? 'Đang ghép…' : 'Xác nhận nâng cấp nhanh'}
                  </button>
                </div>
              </Show>
              <Show when={quickSummary()}>
                {(s) => (
                  <div class="quick-summary" aria-live="polite">
                    {(() => {
                      const q = s();
                      if (q.kind === 'error') return <span class="error">{q.message}</span>;
                      return (
                        <>
                          <b>Đã ghép {q.merges} lần:</b> <span class="ok">{q.successes} thành công</span>,{' '}
                          <span class="bad">{q.failures} thất bại</span>. Level cao nhất đạt được: <b>Lv.{q.best}</b>.
                          <div class="small muted">{q.byLevel.map(([lv, b]) => `Lv.${lv}: ${b.ok}/${b.n} thành công`).join(' · ')}</div>
                          <Show when={q.hasMore}>
                            <div class="small">Vẫn còn cặp có thể ghép — bấm Nâng cấp nhanh lần nữa.</div>
                          </Show>
                        </>
                      );
                    })()}
                  </div>
                )}
              </Show>
            </div>
          </Show>
        </div>
        <div class="groups">
          <Show when={cards()}>
            <Show when={readyGroups().length > 0} fallback={<div class="muted small">Chưa có nhóm {N} thẻ cùng tướng & cùng level nào.</div>}>
              <div class="muted small">Nhóm đủ điều kiện:</div>
              <For each={readyGroups()}>
                {(g) => (
                  <button class={`chip f-${gen(g[0]!.generalId).faction}`} onClick={() => select(g.slice(0, N).map((c) => c.id))}>
                    {gen(g[0]!.generalId).name} Lv.{g[0]!.level} ×{g.length}
                  </button>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </section>
      <div class="two-col upgrade-layout">
        <section class="panel">
          <div class="filters">
            <select data-f="faction" aria-label="Phe" onInput={(e) => setFFaction(e.currentTarget.value)}>
              <option value="">Mọi phe</option>
              <For each={FACTIONS}>{(f) => <option value={f}>{FACTION_LABELS[f]}</option>}</For>
            </select>
            <select data-f="style" aria-label="Phong cách" onInput={(e) => setFStyle(e.currentTarget.value)}>
              <option value="">Mọi phong cách</option>
              <For each={PVP_STYLES}>{(st) => <option value={st}>{PVP_STYLE_LABELS[st]}</option>}</For>
            </select>
            <select data-f="level" aria-label="Level" onInput={(e) => setFLevel(e.currentTarget.value)}>
              <option value="">Mọi level</option>
              <For each={Array.from({ length: 10 }, (_, i) => i + 1)}>{(lv) => <option value={lv}>Lv.{lv}</option>}</For>
            </select>
            <select data-f="sort" aria-label="Sắp xếp nhóm tướng" onInput={(e) => setFSort(e.currentTarget.value as UpgradeSort)}>
              <option value="level_desc" selected>
                Level cao nhất
              </option>
              <option value="ready">Ghép được trước</option>
              <option value="count">Nhiều thẻ nhất</option>
              <option value="name">Tên A→Z</option>
            </select>
          </div>
          <div class="pick-grid">
            <Show when={!loadError()} fallback={<div class="state-msg error">Không tải được thẻ: {loadError()}</div>}>
              <Show when={cards()} fallback={<div class="state-msg">Đang tải thẻ…</div>}>
                <Show when={list().length > 0} fallback={<div class="state-msg">Bạn chưa có thẻ nào để ghép.</div>}>
                  <Show when={filtered().length > 0} fallback={<div class="state-msg">Không có thẻ phù hợp bộ lọc.</div>}>
                    <For each={genGroups()}>
                      {(g) => {
                        const f = gen(g.generalId).faction;
                        return (
                          <div class={`gen-group f-${f}`}>
                            <div class="gen-head">
                              <b>{g.name}</b>
                              <span class="muted small">
                                {FACTION_LABELS[f]} · {g.total} thẻ
                              </span>
                              <Show when={g.bestReadyLevel}>
                                <span class="ready-tag">Ghép được</span>
                              </Show>
                            </div>
                            <div class="gen-runs">
                              <For each={g.runs}>
                                {(r) => (
                                  <div class="lv-run" classList={{ ready: r.ready }}>
                                    <div class="run-label">
                                      Lv.{r.level} ×{r.cards.length}
                                      {r.ready ? ` · đủ ghép${r.cards.length >= 2 * N ? ` ${Math.floor(r.cards.length / N)} lần` : ''}` : ''}
                                    </div>
                                    <div class="run-cards">
                                      <For each={r.cards}>{pickBtn}</For>
                                    </div>
                                  </div>
                                )}
                              </For>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        </section>
        {/* Mobile: khung "Đã chọn" dính đáy màn hình khi đang chọn thẻ (CSS .side.has-sel) */}
        <section class="panel side" classList={{ 'has-sel': selected().length > 0 }}>
          <h3>
            Đã chọn <span class="sel-count">{selected().length}</span>/{N}
          </h3>
          <div class="sel-slots" style={{ 'grid-template-columns': `repeat(${N}, minmax(0, 1fr))` }}>
            <Show when={cards()}>
              <For each={Array.from({ length: N }, (_, i) => i)}>
                {(i) => (
                  <Show when={slotCard(i)} fallback={<div class="slot empty">Trống</div>}>
                    {(c) => (
                      <button class="slot" data-unpick={c().id} title="Bỏ chọn thẻ này" disabled={busy()} onClick={() => unpick(c().id)}>
                        <Card general={gen(c().generalId)} level={c().level} extra="small" />
                      </button>
                    )}
                  </Show>
                )}
              </For>
            </Show>
          </div>
          <div class="preview">
            <Show when={cards()}>
              <Show when={!previewError()} fallback={<p class="error">{previewError()}</p>}>
                <Show
                  when={selected().length >= N}
                  fallback={
                    <>
                      <p class="muted">Chọn thêm {N - selected().length} thẻ.</p>
                      <Show when={selected().length > 0}>
                        <div class="confirm-area">{cancelBtn()}</div>
                      </Show>
                    </>
                  }
                >
                  <Show
                    when={preview()}
                    fallback={
                      <>
                        <p class="muted">Đang tính tỷ lệ…</p>
                        <div class="confirm-area">{cancelBtn()}</div>
                      </>
                    }
                  >
                    {(p) => (
                      <>
                        <div class="odds">
                          <div class="ok">
                            Thành công <b>{pct(p().successBps, p().bpsScale)}</b> → Lv.{p().successLevel}
                          </div>
                          <div class="bad">
                            Thất bại <b>{pct(p().failureBps, p().bpsScale)}</b>
                          </div>
                        </div>
                        <h4>Nếu thất bại, thẻ nhận được:</h4>
                        <table class="rates">
                          <tbody>
                            <For each={p().failureDistribution}>
                              {(e) => (
                                <tr>
                                  <td>{e.level === p().inputLevel ? `Giữ nguyên Lv.${e.level}` : `Về Lv.${e.level}`}</td>
                                  <td>{pct(e.bps, p().bpsScale)}</td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                        <p class="warn">
                          ⚠ Cả {N} thẻ đầu vào sẽ bị tiêu thụ dù thành công hay thất bại. Bạn luôn nhận lại đúng 1 thẻ {gen(p().generalId).name}.
                        </p>
                        <p class="muted small">Tỷ lệ chỉ để tham khảo; server tính lại khi thực hiện.</p>
                        <div class="confirm-area">
                          <Show
                            when={confirming()}
                            fallback={
                              <>
                                {cancelBtn()}{' '}
                                <button class="btn primary" data-go disabled={busy()} onClick={() => setConfirming(true)}>
                                  Ghép thẻ
                                </button>
                              </>
                            }
                          >
                            <p>
                              <b>Xác nhận ghép?</b> {N} thẻ sẽ bị tiêu thụ.
                            </p>
                            <button class="btn ghost" data-no disabled={busy()} onClick={() => {
                                setConfirming(false);
                                setUpMsg('');
                              }}>
                              Quay lại
                            </button>{' '}
                            <button class="btn danger" data-yes disabled={busy()} onClick={() => void attempt()}>
                              Xác nhận ghép
                            </button>
                          </Show>
                        </div>
                        <div class="up-msg error" aria-live="polite">
                          {upMsg()}
                        </div>
                      </>
                    )}
                  </Show>
                </Show>
              </Show>
            </Show>
          </div>
        </section>
      </div>
    </>
  );
}
