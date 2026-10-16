import { For, Show, createMemo, createSignal, onCleanup, type JSX } from 'solid-js';
import {
  FACTIONS,
  FACTION_LABELS,
  GEM_ELEMENT_LABELS,
  MAX_LEVEL,
  PVP_STYLES,
  PVP_STYLE_LABELS,
  type CardDto,
  type GemConfigDto,
  type GemDto,
  type GemElement,
  type UpgradePreviewDto,
} from '@tq/shared';
import { api, fetchAllCards, newKey, type ApiError } from '../api.ts';
import { gen, genStyle, state } from '../state.ts';
import { pct } from '../art.ts';
import { playUpgrade } from '../pixi/stage.ts';
import { groupCardsByGeneral, type UpgradeSort } from '../upgrade-groups.ts';
import { Card } from '../components/Card.tsx';
import { GemCard } from '../components/GemCard.tsx';

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
  /** Sub-tab: nâng cấp Tướng (mặc định) hoặc nâng cấp Ngọc Ngũ Hành (DESIGN PROMPT — mục 1.1). */
  const [sub, setSub] = createSignal<'tuong' | 'ngoc'>('tuong');
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
      <div class="sub-tabs" role="tablist">
        <button class="btn small" classList={{ on: sub() === 'tuong' }} role="tab" onClick={() => setSub('tuong')}>
          Tướng
        </button>
        <button class="btn small" classList={{ on: sub() === 'ngoc' }} role="tab" onClick={() => setSub('ngoc')}>
          Ngọc
        </button>
      </div>
      <Show when={sub() === 'tuong'}>
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
      </Show>
      <Show when={sub() === 'ngoc'}>
        <GemUpgradeTab />
      </Show>
    </>
  );
}

/** Tổng kết sau khi Ghép nhanh Ngọc (hoặc lỗi). */
type GemQuickSummary =
  | { kind: 'ok'; merges: number; successes: number; failures: number; best: number; byLevel: [number, { n: number; ok: number }][]; hasMore: boolean }
  | { kind: 'error'; message: string };

/**
 * Tab "Ngọc" (DESIGN PROMPT — mục 1.1): ghép 2 viên Ngọc CÙNG loại & CÙNG cấp thành 1 viên cấp +1.
 * Dùng chung công thức, tỷ lệ và tài nguyên với thẻ Tướng (`api.gems` trả bảng tỷ lệ `rates`).
 */
function GemUpgradeTab(): JSX.Element {
  /** Ngọc luôn ghép 2 → 1 (khác với Tướng dùng `upgradeInputCount`). */
  const GN = 2;
  let alive = true;
  onCleanup(() => (alive = false));

  const [gems, setGems] = createSignal<GemDto[]>([]);
  const [config, setConfig] = createSignal<GemConfigDto | null>(null);
  const [loaded, setLoaded] = createSignal(false);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<number[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [confirming, setConfirming] = createSignal(false);
  const [msg, setMsg] = createSignal('');
  const [quickConfirming, setQuickConfirming] = createSignal(false);
  const [quickSummary, setQuickSummary] = createSignal<GemQuickSummary | null>(null);
  const [quickLevels, setQuickLevels] = createSignal<number[]>([]);
  let pendingKey: string | null = null;
  let quickKey: string | null = null;

  const byId = createMemo(() => new Map(gems().map((g) => [g.id, g])));
  /** Mọi cấp có thể chọn ghép nhanh (Cấp 1–9; Cấp 10 không ghép tiếp được). */
  const allLevels = () => (config()?.rates ?? []).map((r) => r.level);
  const pickedGem = (i: number) => byId().get(selected()[i] ?? -1);
  /** Tỷ lệ ghép của cấp đầu vào đang chọn (null khi chưa chọn đủ / cấp tối đa). */
  const previewRate = () => (config()?.rates ?? []).find((r) => r.level === pickedGem(0)?.level) ?? null;

  /** Nhóm theo loại Ngọc, trong mỗi loại chia nhỏ theo cấp (cao trước) — giống nhóm tướng (mục 6.8). */
  const groups = createMemo(() => {
    const byEl = new Map<GemElement, Map<number, GemDto[]>>();
    for (const g of gems()) {
      const lvls = byEl.get(g.element) ?? new Map<number, GemDto[]>();
      lvls.set(g.level, [...(lvls.get(g.level) ?? []), g]);
      byEl.set(g.element, lvls);
    }
    const els = config()?.elements ?? [];
    return els
      .map((element) => {
        const lvls = byEl.get(element);
        const runs = lvls ? [...lvls.entries()].sort((a, b) => b[0] - a[0]).map(([level, list]) => ({ level, gems: list })) : [];
        return { element, total: runs.reduce((s, r) => s + r.gems.length, 0), runs };
      })
      .filter((g) => g.total > 0);
  });

  /** Số cặp ghép được ngay trong các cấp đã chọn (chỉ hiển thị; server tự tính lại). */
  const quickPairs = createMemo(() => {
    const sel = new Set(quickLevels());
    return groups()
      .flatMap((g) => g.runs)
      .filter((r) => sel.has(r.level))
      .reduce((s, r) => s + Math.floor(r.gems.length / GN), 0);
  });
  const quickRates = createMemo(() => {
    const sel = new Set(quickLevels());
    return (config()?.rates ?? []).filter((r) => sel.has(r.level));
  });

  function toggleQuickLevel(lv: number) {
    if (busy()) return;
    const cur = quickLevels();
    setQuickLevels(cur.includes(lv) ? cur.filter((x) => x !== lv) : [...cur, lv].sort((a, b) => a - b));
  }

  function selectable(g: GemDto): boolean {
    if (g.level >= MAX_LEVEL) return false;
    const first = pickedGem(0);
    if (!first) return true;
    return g.element === first.element && g.level === first.level;
  }

  function togglePick(g: GemDto) {
    if (busy()) return;
    setMsg('');
    setConfirming(false);
    pendingKey = null;
    const sel = selected();
    if (sel.includes(g.id)) setSelected(sel.filter((x) => x !== g.id));
    else if (sel.length < GN) setSelected([...sel, g.id]);
  }

  function clearSel() {
    if (busy()) return;
    setSelected([]);
    setConfirming(false);
    setMsg('');
    pendingKey = null;
  }

  async function load() {
    try {
      const dto = await api.gems();
      if (!alive) return;
      setGems(dto.gems);
      setConfig(dto.config);
      setLoaded(true);
      setLoadError(null);
      setSelected((s) => s.filter((id) => dto.gems.some((g) => g.id === id)));
      // Mặc định chọn sẵn Cấp 1 → mức ghép nhanh của Tướng (mặc định 5)
      if (!quickLevels().length) setQuickLevels(dto.config.rates.map((r) => r.level).filter((lv) => lv <= state.config!.quickUpgradeMaxLevel));
    } catch (e) {
      if (alive) setLoadError((e as Error).message);
    }
  }
  void load();

  async function attempt() {
    if (busy() || selected().length !== GN) return;
    setBusy(true);
    pendingKey ??= newKey();
    const ids = [...selected()];
    try {
      const r = await api.gemMerge(ids, pendingKey);
      pendingKey = null;
      setSelected([]);
      setConfirming(false);
      setMsg(
        r.outcome === 'success'
          ? `Thành công! ${GEM_ELEMENT_LABELS[r.element]} Cấp ${r.inputLevel} ×2 → Cấp ${r.resultGem.level}`
          : `Thất bại. 2 viên ${GEM_ELEMENT_LABELS[r.element]} Cấp ${r.inputLevel} → nhận Cấp ${r.resultGem.level}`,
      );
      setBusy(false);
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') pendingKey = null;
      setBusy(false);
      setConfirming(false);
      setMsg(err.message);
      if (err.code === 'GEM_CONSUMED' || err.code === 'GEM_NOT_FOUND') {
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
      const r = await api.gemMergeQuick(quickKey, quickLevels());
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
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') quickKey = null;
      setQuickSummary({ kind: 'error', message: err.message });
      setBusy(false);
      if (err.code === 'NOTHING_TO_UPGRADE') await load();
      else setQuickConfirming(false);
    }
  }

  return (
    <>
      <section class="panel">
        <h2>Ghép 2 Ngọc</h2>
        <p class="muted">
          Chọn đúng 2 viên Ngọc <b>cùng loại</b> và <b>cùng cấp</b> (Cấp 1–9) để ghép thành 1 viên cấp cao hơn. Dùng chung công thức, tỷ lệ và tài nguyên với
          Tướng.
        </p>
        <div class="quick">
          <Show when={loaded()}>
            <div class="quick-box">
              <div class="quick-head">
                <button
                  class="btn primary"
                  disabled={busy() || quickLevels().length === 0 || quickPairs() === 0 || quickConfirming()}
                  onClick={() => setQuickConfirming(true)}
                >
                  ⚡ Ghép nhanh
                </button>
                <span class="muted small">
                  {quickPairs() > 0
                    ? `${quickPairs()} cặp Ngọc có thể ghép ngay. Tự ghép liên tục mọi cặp 2 viên cùng loại, cùng cấp trong các mức đã chọn.`
                    : 'Chưa có cặp Ngọc nào trong các mức đã chọn để ghép nhanh.'}
                </span>
              </div>
              <div class="quick-levels">
                <span class="muted small">Cấp ghép nhanh:</span>
                <For each={allLevels()}>
                  {(lv) => (
                    <label class="lv-chk" classList={{ on: quickLevels().includes(lv) }}>
                      <input type="checkbox" checked={quickLevels().includes(lv)} disabled={busy()} onChange={() => toggleQuickLevel(lv)} />
                      Cấp {lv}
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
                                Cấp {r.level} → {r.level + 1}
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
                    ⚠ Mỗi lần ghép tiêu thụ 2 viên Ngọc, có thể thất bại hoặc tụt cấp. Ngọc mới tạo ra thuộc mức đã chọn sẽ được ghép tiếp. Ngọc ở mức không
                    chọn không bị đụng tới.
                  </p>
                  <button class="btn ghost" onClick={() => setQuickConfirming(false)}>
                    Huỷ
                  </button>{' '}
                  <button class="btn danger" disabled={busy()} onClick={() => void runQuick()}>
                    {busy() ? 'Đang ghép…' : 'Xác nhận ghép nhanh'}
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
                          <span class="bad">{q.failures} thất bại</span>. Cấp cao nhất đạt được: <b>Cấp {q.best}</b>.
                          <div class="small muted">{q.byLevel.map(([lv, b]) => `Cấp ${lv}: ${b.ok}/${b.n} thành công`).join(' · ')}</div>
                          <Show when={q.hasMore}>
                            <div class="small">Vẫn còn cặp có thể ghép — bấm Ghép nhanh lần nữa.</div>
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
      </section>
      <div class="two-col upgrade-layout">
        <section class="panel">
          <Show when={!loadError()} fallback={<div class="state-msg error">Không tải được Ngọc: {loadError()}</div>}>
            <Show when={loaded()} fallback={<div class="state-msg">Đang tải Ngọc…</div>}>
              <Show when={gems().length > 0} fallback={<div class="state-msg">Bạn chưa có viên Ngọc nào. Quay thẻ để nhận Ngọc rớt kèm.</div>}>
                <div class="pick-grid">
                  <For each={groups()}>
                    {(grp) => (
                      <div class={`gen-group e-${grp.element}`}>
                        <div class="gen-head">
                          <b>{`Ngọc ${GEM_ELEMENT_LABELS[grp.element]}`}</b>
                          <span class="muted small">{`Ngũ Hành · ${grp.total} viên`}</span>
                          <Show when={grp.runs.some((r) => r.gems.length >= GN && r.level < MAX_LEVEL)}>
                            <span class="ready-tag">Ghép được</span>
                          </Show>
                        </div>
                        <div class="gen-runs">
                          <For each={grp.runs}>
                            {(r) => {
                              const ready = () => r.gems.length >= GN && r.level < MAX_LEVEL;
                              return (
                                <div class="lv-run" classList={{ ready: ready() }}>
                                  <div class="run-label">
                                    Cấp {r.level} ×{r.gems.length}
                                    {ready() ? ` · đủ ghép${r.gems.length >= 2 * GN ? ` ${Math.floor(r.gems.length / GN)} lần` : ''}` : ''}
                                  </div>
                                  <div class="run-cards">
                                    <For each={r.gems}>
                                      {(g) => {
                                        const on = () => selected().includes(g.id);
                                        return (
                                          <button
                                            class="pick"
                                            classList={{ on: on() }}
                                            disabled={!on() && (!selectable(g) || selected().length >= GN)}
                                            aria-pressed={on() ? 'true' : 'false'}
                                            onClick={() => togglePick(g)}
                                          >
                                            <GemCard element={g.element} level={g.level} />
                                          </button>
                                        );
                                      }}
                                    </For>
                                  </div>
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </Show>
        </section>
        <section class="panel side" classList={{ 'has-sel': selected().length > 0 }}>
          <h3>
            Đã chọn <span class="sel-count">{selected().length}</span>/{GN}
          </h3>
          <div class="sel-slots" style={{ 'grid-template-columns': `repeat(${GN}, minmax(0, 1fr))` }}>
            <For each={Array.from({ length: GN }, (_, i) => i)}>
              {(i) => (
                <Show when={pickedGem(i)} fallback={<div class="slot empty">Trống</div>}>
                  {(g) => (
                    <button class="slot" title="Bỏ chọn viên Ngọc này" disabled={busy()} onClick={() => togglePick(g())}>
                      <GemCard element={g().element} level={g().level} />
                    </button>
                  )}
                </Show>
              )}
            </For>
          </div>
          <div class="preview">
            <Show
              when={selected().length >= GN}
              fallback={
                <>
                  <p class="muted">Chọn thêm {GN - selected().length} viên Ngọc cùng loại & cùng cấp.</p>
                  <Show when={selected().length > 0}>
                    <div class="confirm-area">
                      <button class="btn ghost" disabled={busy()} onClick={clearSel}>
                        Huỷ
                      </button>
                    </div>
                  </Show>
                </>
              }
            >
              <Show when={previewRate()} fallback={<p class="warn">Ngọc Cấp 10 đã ở mức tối đa — không ghép tiếp được.</p>}>
                {(r) => (
                  <>
                    <div class="odds">
                      <div class="ok">
                        Thành công <b>{pct(r().successBps)}</b> → Cấp {r().level + 1}
                      </div>
                      <div class="bad">
                        Thất bại <b>{pct(10000 - r().successBps)}</b>
                      </div>
                    </div>
                    <h4>Nếu thất bại, Ngọc nhận được:</h4>
                    <table class="rates">
                      <tbody>
                        <For each={r().failureDistribution}>
                          {(e) => (
                            <tr>
                              <td>{e.level === r().level ? `Giữ nguyên Cấp ${e.level}` : `Về Cấp ${e.level}`}</td>
                              <td>{pct(e.bps)}</td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                    <p class="warn">
                      ⚠ Cả 2 viên Ngọc đầu vào sẽ bị tiêu thụ dù thành công hay thất bại. Bạn luôn nhận lại đúng 1 viên Ngọc{' '}
                      {GEM_ELEMENT_LABELS[pickedGem(0)!.element]}.
                    </p>
                    <p class="muted small">Tỷ lệ chỉ để tham khảo; server tính lại khi thực hiện.</p>
                    <div class="confirm-area">
                      <Show
                        when={confirming()}
                        fallback={
                          <>
                            <button class="btn ghost" disabled={busy()} onClick={clearSel}>
                              Huỷ
                            </button>{' '}
                            <button class="btn primary" disabled={busy()} onClick={() => setConfirming(true)}>
                              Ghép Ngọc
                            </button>
                          </>
                        }
                      >
                        <p>
                          <b>Xác nhận ghép?</b> 2 viên Ngọc sẽ bị tiêu thụ.
                        </p>
                        <button
                          class="btn ghost"
                          disabled={busy()}
                          onClick={() => {
                            setConfirming(false);
                            setMsg('');
                          }}
                        >
                          Quay lại
                        </button>{' '}
                        <button class="btn danger" disabled={busy()} onClick={() => void attempt()}>
                          Xác nhận ghép
                        </button>
                      </Show>
                    </div>
                    <div class="up-msg error" aria-live="polite">
                      {msg()}
                    </div>
                  </>
                )}
              </Show>
            </Show>
          </div>
        </section>
      </div>
    </>
  );
}
