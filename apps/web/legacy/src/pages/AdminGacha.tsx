import { For, Match, Show, Switch, createSignal, type JSX } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  GACHA_ADMIN_MAX_LEVEL,
  GEM_ELEMENTS,
  GEM_ELEMENT_LABELS,
  MIN_LEVEL,
  type GachaRatesAdminDto,
  type GemElement,
  type WeightEntry,
} from '@tq/shared';
import { api, type ApiError } from '../api.ts';

/**
 * Tab "Tỉ lệ quay" ở trang Quản trị: chỉnh bảng tỉ lệ CẤP TƯỚNG khi quay (Lv1–Lv9) và cấu hình
 * RỚT NGỌC (tỉ lệ rớt mỗi lượt + trọng số 5 hệ). Server kiểm tra tổng mỗi bảng phải bằng 100%,
 * lưu DB rồi nạp lại cache ⇒ lượt quay kế tiếp áp dụng ngay, không cần khởi động lại API.
 */

type Load = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready' };
type Notice = { ok: boolean; text: string } | null;
type Ctl = { ensureLoaded: () => void };

/** Tỉ lệ % từ bps, gọn số (bỏ số 0 thừa ở cuối). */
const pctText = (bps: number, scale: number) => `${Number(((bps / scale) * 100).toFixed(4))}%`;
const intOr0 = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

type Draft = {
  levelRates: WeightEntry[];
  gemDropBps: number;
  gemTypeWeights: Record<GemElement, number>;
};

export function GachaRatesPane(props: { alive: () => boolean; ctl: (c: Ctl) => void }): JSX.Element {
  let loaded = false;
  const [listState, setListState] = createSignal<Load>({ kind: 'loading' });
  const [notice, setNotice] = createSignal<Notice>(null);
  // Bản nháp đang sửa (`v: null` = chưa tải xong). Dùng STORE (không phải signal) để ghi tại chỗ:
  // giữ nguyên danh tính từng dòng `<For>` — thay object mới sẽ dựng lại DOM mỗi phím gõ → mất focus.
  const [draft, setDraft] = createStore<{ v: Draft | null }>({ v: null });
  const [levelScale, setLevelScale] = createSignal(100_000);
  const [bpsScale, setBpsScale] = createSignal(10_000);
  const [updatedAt, setUpdatedAt] = createSignal<string | null>(null);
  const [dirty, setDirty] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const say = (text: string, ok = true) => setNotice(text ? { ok, text } : null);

  function apply(dto: GachaRatesAdminDto) {
    setDraft('v', {
      levelRates: dto.levelRates.map((e) => ({ ...e })),
      gemDropBps: dto.gemDropBps,
      gemTypeWeights: { ...dto.gemTypeWeights },
    });
    setLevelScale(dto.levelScale);
    setBpsScale(dto.bpsScale);
    setUpdatedAt(dto.updatedAt);
    setDirty(false);
  }

  async function load() {
    loaded = true;
    setListState({ kind: 'loading' });
    try {
      const dto = await api.admin.gachaRates();
      if (!props.alive()) return;
      apply(dto);
      setListState({ kind: 'ready' });
    } catch (e) {
      if (props.alive()) setListState({ kind: 'error', text: (e as Error).message });
    }
  }
  props.ctl({ ensureLoaded: () => !loaded && void load() });
  void load();

  const levelTotal = () => draft.v?.levelRates.reduce((s, e) => s + e.bps, 0) ?? 0;
  const weightTotal = () => {
    const d = draft.v;
    return d ? GEM_ELEMENTS.reduce((s, e) => s + (d.gemTypeWeights[e] ?? 0), 0) : 0;
  };
  const valid = () => !!draft.v && levelTotal() === levelScale() && weightTotal() === bpsScale();

  /** Ghi tại chỗ theo `level` (giữ danh tính dòng) để `<For>` không dựng lại DOM khi đang gõ. */
  function setLevel(level: number, bps: number) {
    const i = draft.v?.levelRates.findIndex((e) => e.level === level) ?? -1;
    if (i < 0) return;
    setDraft('v', 'levelRates', i, 'bps', bps);
    setDirty(true);
  }
  function setWeight(element: GemElement, value: number) {
    setDraft('v', 'gemTypeWeights', element, value);
    setDirty(true);
  }
  function setDrop(value: number) {
    setDraft('v', 'gemDropBps', value);
    setDirty(true);
  }

  async function save() {
    const d = draft.v;
    if (!d || saving()) return;
    if (!valid()) return say('Tổng mỗi bảng tỉ lệ phải bằng 100% mới lưu được.', false);
    setSaving(true);
    try {
      const saved = await api.admin.gachaRatesUpdate({ levelRates: d.levelRates, gemDropBps: d.gemDropBps, gemTypeWeights: d.gemTypeWeights });
      if (!props.alive()) return;
      apply(saved);
      say('Đã lưu tỉ lệ quay — áp dụng ngay cho lượt quay kế tiếp.');
    } catch (e) {
      if (props.alive()) say((e as ApiError).message, false);
    } finally {
      if (props.alive()) setSaving(false);
    }
  }

  return (
    <>
      <div class="cfg-toolbar">
        <span class="muted small">
          Nhập tỉ lệ theo đơn vị gốc; ô bên dưới quy đổi ra %. Tổng tỉ lệ cấp tướng và tổng trọng số 5 hệ đều <b>phải bằng 100%</b>.
        </span>
        <Show when={updatedAt()}>
          {(t) => <span class="muted small">Cập nhật: {new Date(t()).toLocaleString('vi-VN')}</span>}
        </Show>
      </div>
      <div class="adm-msg" aria-live="polite">
        <Show when={notice()}>{(n) => <div class={n().ok ? 'notice' : 'warn'}>{n().text}</div>}</Show>
      </div>
      <Switch>
        <Match when={listState().kind === 'loading'}>
          <div class="state-msg">Đang tải…</div>
        </Match>
        <Match when={listState().kind === 'error'}>
          <div class="state-msg error">{(listState() as { text: string }).text}</div>
        </Match>
        <Match when={draft.v}>
          {(d) => (
            <>
              <h3>Tỉ lệ cấp tướng khi quay</h3>
              <div class="cfg-grid">
                <For each={d().levelRates}>
                  {(e) => (
                    <label class="cfg-field">
                      <span>Lv{e.level}</span>
                      <input
                        data-g={`lv-${e.level}`}
                        type="number"
                        min="0"
                        step="1"
                        inputmode="numeric"
                        value={e.bps}
                        onInput={(ev) => setLevel(e.level, intOr0(ev.currentTarget.value))}
                      />
                      <span class="muted small">{pctText(e.bps, levelScale())}</span>
                    </label>
                  )}
                </For>
              </div>
              <div class={levelTotal() === levelScale() ? 'cfg-help muted small' : 'cfg-help warn small'}>
                Tổng: {levelTotal().toLocaleString('vi-VN')} / {levelScale().toLocaleString('vi-VN')} ({pctText(levelTotal(), levelScale())})
                {levelTotal() === levelScale() ? '' : ' — phải bằng 100%'}
              </div>

              <h3>Rớt Ngọc Ngũ Hành</h3>
              <div class="cfg-grid">
                <label class="cfg-field">
                  <span>Tỉ lệ rớt mỗi lượt quay</span>
                  <input
                    data-g="drop"
                    type="number"
                    min="0"
                    max={bpsScale()}
                    step="1"
                    inputmode="numeric"
                    value={d().gemDropBps}
                    onInput={(ev) => setDrop(intOr0(ev.currentTarget.value))}
                  />
                  <span class="muted small">{pctText(d().gemDropBps, bpsScale())}</span>
                </label>
                <For each={GEM_ELEMENTS}>
                  {(element) => (
                    <label class="cfg-field">
                      <span>
                        Trọng số hệ{' '}
                        <b class={`cfg-fac e-${element}`}>{GEM_ELEMENT_LABELS[element]}</b>
                      </span>
                      <input
                        data-g={`w-${element}`}
                        type="number"
                        min="0"
                        step="1"
                        inputmode="numeric"
                        value={d().gemTypeWeights[element]}
                        onInput={(ev) => setWeight(element, intOr0(ev.currentTarget.value))}
                      />
                      <span class="muted small">{pctText(d().gemTypeWeights[element], bpsScale())}</span>
                    </label>
                  )}
                </For>
              </div>
              <div class={weightTotal() === bpsScale() ? 'cfg-help muted small' : 'cfg-help warn small'}>
                Tổng trọng số 5 hệ: {weightTotal().toLocaleString('vi-VN')} / {bpsScale().toLocaleString('vi-VN')} (
                {pctText(weightTotal(), bpsScale())}){weightTotal() === bpsScale() ? '' : ' — phải bằng 100%'}
              </div>

              <div class="cfg-toolbar">
                <button class="btn primary" data-act="save-rates" disabled={saving() || !dirty() || !valid()} onClick={() => void save()}>
                  Lưu tỉ lệ quay
                </button>
                <Show when={dirty()}>
                  <button class="btn ghost" disabled={saving()} onClick={() => void load()}>
                    Hoàn tác
                  </button>
                </Show>
                <span class="muted small">Lv được quay trực tiếp: Lv{MIN_LEVEL}–Lv{GACHA_ADMIN_MAX_LEVEL} (Lv10 chỉ đạt được qua ghép thẻ).</span>
              </div>
            </>
          )}
        </Match>
      </Switch>
    </>
  );
}
