import { For, Match, Show, Switch, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  FACTIONS,
  FACTION_LABELS,
  GEM_ELEMENT_LABELS,
  GEM_STAT_LABELS,
  PVP_ACTIVE_EFFECT_TYPES,
  PVP_BUFF_EFFECT_TYPES,
  PVP_BUFF_SCOPES,
  PVP_BUFF_SCOPE_LABELS,
  PVP_DEBUFF_EFFECT_TYPES,
  PVP_EFFECT_LABELS,
  PVP_FORMULA_LABELS,
  PVP_FORMULA_TYPES,
  PVP_GEM_STAT_KEYS,
  PVP_PASSIVES,
  PVP_PASSIVE_LABELS,
  PVP_SKILL_LABELS,
  PVP_STYLES,
  PVP_STYLE_LABELS,
  PVP_TARGETINGS,
  PVP_TARGETING_LABELS,
  type Faction,
  type PvpEffectType,
  type PvpFormulaType,
  type PvpGemAdminDto,
  type PvpHeroAdminDto,
  type PvpPassive,
  type PvpSkillEffectDto,
  type PvpStyle,
  type PvpTargeting,
} from '@tq/shared';
import { api, type ApiError } from '../api.ts';
import { gemUrl, initials, pct, portraitUrl } from '../art.ts';
import { StyleIcon } from '../components/StyleIcon.tsx';

/**
 * Cấu hình PvP trên trang Quản trị (mục 6.7): Tướng (chỉ số nền + kỹ năng + hiệu ứng) và
 * Ngọc Ngũ Hành (2 chỉ số × Cấp 1 / Cấp 10 cho mỗi hệ).
 *
 * Server lưu DB rồi nạp lại `PvpConfigRegistry` ⇒ trận PvP tạo sau khi lưu áp dụng cấu hình mới
 * NGAY, không cần khởi động lại API. Toàn bộ công thức/xác suất vẫn nằm ở server; trang này chỉ
 * là bảng nhập liệu có kiểm tra phía client cho tiện.
 */

type Load = { kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'ready' };
type Notice = { ok: boolean; text: string } | null;
type Ctl = { ensureLoaded: () => void };

const num = (n: number) => n.toLocaleString('vi-VN');

/** Định danh dự kiến của tướng mới — giữ đúng quy tắc `slugify` ở server để xem trước chân dung. */
const slugify = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/**
 * Ảnh thu nhỏ (chân dung tướng / viên Ngọc): chữ viết tắt làm lớp nền, ảnh thật phủ lên và tự ẩn
 * khi thiếu ảnh (tướng mới chưa có artwork) nên ô luôn nhìn thấy được.
 */
function Thumb(props: { src: string; label: string; class?: string }) {
  return (
    <span class={`cfg-thumb ${props.class ?? ''}`} aria-hidden="true">
      <span class="cfg-thumb-ini">{initials(props.label)}</span>
      <img src={props.src} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />
    </span>
  );
}

/** Nhóm hiệu ứng dùng cho dropdown có phân nhóm (theo SKILLS.md). */
const EFFECT_GROUPS: { label: string; types: readonly PvpEffectType[] }[] = [
  { label: 'Tức thì / Nội tại', types: PVP_ACTIVE_EFFECT_TYPES },
  { label: 'Buff (có lợi)', types: PVP_BUFF_EFFECT_TYPES },
  { label: 'Debuff (bất lợi)', types: PVP_DEBUFF_EFFECT_TYPES },
];

/** Hiệu ứng tính theo điểm Giáp nguyên; còn lại tính theo bps (10000 = 100%). */
const ARMOR_EFFECTS = new Set<PvpEffectType>(['BUFF_DEF_ARMOR', 'DEBUFF_DEF_ARMOR_DOWN']);
const valueUnit = (t: PvpEffectType) => (ARMOR_EFFECTS.has(t) ? 'điểm Giáp' : 'bps (10000 = 100%)');

/** Số lượt mặc định của hiệu ứng mới (Thiêu đốt cháy lâu hơn — khớp server). */
const newEffect = (): PvpSkillEffectDto => ({
  type: 'BUFF_DAMAGE',
  value: 0,
  duration: 3,
  maxLayers: 3,
  rate: 0,
  formulaType: 'FIXED_CAP_MINUS_10',
});

function Notice(props: { n: Notice }) {
  return (
    <Show when={props.n}>
      {(n) => <div class={n().ok ? 'notice' : 'warn'}>{n().text}</div>}
    </Show>
  );
}

/** Khung modal dùng chung: nền tối trung tính, bấm vùng nền hoặc Esc để đóng. */
function ConfigModal(props: { title: string; wide?: boolean; onClose: () => void; children: JSX.Element }) {
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));
  return (
    <Portal>
      <div class="cfg-modal" role="dialog" aria-modal="true" aria-label={props.title} onClick={() => props.onClose()}>
        <div class="cfg-box" classList={{ wide: props.wide }} onClick={(e) => e.stopPropagation()}>
          <div class="cfg-head">
            <h3>{props.title}</h3>
            <button class="btn ghost small" onClick={() => props.onClose()}>
              Đóng
            </button>
          </div>
          {props.children}
        </div>
      </div>
    </Portal>
  );
}

// ======================= Tab 1: Quản lý Tướng PvP =======================

/**
 * Danh sách cấu hình Tướng kèm bộ lọc Phe / Phong cách / Tìm theo tên.
 * "Thêm Tướng Mới" chỉ cần Tên + Phe; mọi cấu hình khác lấy mặc định mức sàn ở server.
 */
export function PvpHeroesPane(props: { alive: () => boolean; ctl: (c: Ctl) => void }) {
  let loaded = false;
  const f = { faction: '', style: '', q: '' };
  let seq = 0;
  const [items, setItems] = createSignal<PvpHeroAdminDto[]>([]);
  const [listState, setListState] = createSignal<Load>({ kind: 'loading' });
  const [notice, setNotice] = createSignal<Notice>(null);
  const [busy, setBusy] = createSignal(false);
  const [draft, setDraft] = createSignal<PvpHeroAdminDto | null>(null);
  const [creating, setCreating] = createSignal(false);
  const [newName, setNewName] = createSignal('');
  const [newFaction, setNewFaction] = createSignal<Faction>('wei');
  const [confirmDelete, setConfirmDelete] = createSignal<string | null>(null);

  const say = (text: string, ok = true) => setNotice(text ? { ok, text } : null);

  async function load() {
    loaded = true;
    const my = ++seq;
    setListState({ kind: 'loading' });
    try {
      const dto = await api.admin.pvpHeroes({
        faction: (f.faction || undefined) as Faction | undefined,
        style: (f.style || undefined) as PvpStyle | undefined,
        q: f.q || undefined,
      });
      if (!props.alive() || my !== seq) return;
      setItems(dto.items);
      setListState({ kind: 'ready' });
    } catch (e) {
      if (props.alive() && my === seq) setListState({ kind: 'error', text: (e as Error).message });
    }
  }

  let t: number | undefined;
  onCleanup(() => clearTimeout(t));
  const onFilter = (key: 'faction' | 'style' | 'q', value: string) => {
    const apply = () => {
      f[key] = value;
      void load();
    };
    clearTimeout(t);
    if (key === 'q') t = window.setTimeout(apply, 250);
    else apply();
  };

  props.ctl({ ensureLoaded: () => !loaded && void load() });
  void load();

  const patch = (p: Partial<PvpHeroAdminDto>) => setDraft((d) => (d ? { ...d, ...p } : d));
  const patchEffect = (i: number, p: Partial<PvpSkillEffectDto>) =>
    setDraft((d) => (d ? { ...d, skillEffects: d.skillEffects.map((e, j) => (j === i ? { ...e, ...p } : e)) } : d));
  const addEffect = () => setDraft((d) => (d ? { ...d, skillEffects: [...d.skillEffects, newEffect()] } : d));
  const removeEffect = (i: number) =>
    setDraft((d) => (d ? { ...d, skillEffects: d.skillEffects.filter((_, j) => j !== i) } : d));

  async function save() {
    const d = draft();
    if (!d || busy() || !props.alive()) return;
    setBusy(true);
    try {
      const { id, ...body } = d;
      await api.admin.pvpHeroUpdate(id, body);
      if (!props.alive()) return;
      setDraft(null);
      say(`Đã lưu cấu hình tướng "${d.name}". Trận PvP tạo sau đây áp dụng ngay.`);
    } catch (e) {
      if (props.alive()) say((e as ApiError).message, false);
    } finally {
      setBusy(false);
      await load();
    }
  }

  async function create() {
    const name = newName().trim();
    if (!name) return say('Hãy nhập tên tướng.', false);
    setBusy(true);
    try {
      const hero = await api.admin.pvpHeroCreate({ name, faction: newFaction() });
      if (!props.alive()) return;
      setCreating(false);
      setNewName('');
      say(`Đã thêm tướng "${hero.name}" với cấu hình mặc định — bấm "Sửa" để chỉnh kỹ năng.`);
      await load();
      setDraft(hero);
    } catch (e) {
      if (props.alive()) say((e as ApiError).message, false);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setConfirmDelete(null);
    setBusy(true);
    try {
      await api.admin.pvpHeroDelete(id);
      if (!props.alive()) return;
      say('Đã xoá cấu hình tướng. Nếu tướng thuộc roster gốc, nó trở về đúng cấu hình trong code.');
      await load();
    } catch (e) {
      if (props.alive()) say((e as ApiError).message, false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div class="cfg-toolbar">
        <button class="btn primary small" data-act="add-hero" onClick={() => setCreating(true)}>
          + Thêm Tướng Mới
        </button>
        <span class="muted small">Sửa chỉ số nền, kỹ năng và hiệu ứng; thay đổi áp dụng ngay cho trận PvP mới.</span>
      </div>
      <div class="filters">
        <input
          type="search"
          data-f="q"
          placeholder="Tìm theo tên tướng…"
          maxLength={64}
          aria-label="Tìm tướng PvP"
          onInput={(e) => onFilter('q', e.currentTarget.value)}
        />
        <select data-f="faction" aria-label="Phe" onInput={(e) => onFilter('faction', e.currentTarget.value)}>
          <option value="">Mọi phe</option>
          <For each={FACTIONS}>{(x) => <option value={x}>{FACTION_LABELS[x]}</option>}</For>
        </select>
        <select data-f="style" aria-label="Phong cách" onInput={(e) => onFilter('style', e.currentTarget.value)}>
          <option value="">Mọi phong cách</option>
          <For each={PVP_STYLES}>{(x) => <option value={x}>{PVP_STYLE_LABELS[x]}</option>}</For>
        </select>
      </div>
      <div class="adm-summary muted small">{listState().kind === 'ready' ? `${num(items().length)} tướng PvP` : ''}</div>
      <div class="adm-msg" aria-live="polite">
        <Notice n={notice()} />
      </div>
      <div class="cfg-heroes">
        <Switch>
          <Match when={listState().kind === 'loading'}>
            <div class="state-msg">Đang tải…</div>
          </Match>
          <Match when={listState().kind === 'error'}>
            <div class="state-msg error">{(listState() as { text: string }).text}</div>
          </Match>
          <Match when={items().length > 0}>
            <div class="cfg-hero-head muted small">
              <div>Tướng</div>
              <div>Phe</div>
              <div>Phong cách · Nội tại</div>
              <div>Chỉ số nền (Lv.1)</div>
              <div>Kỹ năng</div>
              <div>Thao tác</div>
            </div>
            <For each={items()}>
              {(h) => (
                <div class="cfg-hero-row" data-hero={h.id}>
                  <div class="cfg-name">
                    <Thumb class="hero" src={portraitUrl(h.id)} label={h.name} />
                    <div class="cfg-name-txt">
                      <b>{h.name}</b>
                      <Show when={h.isHot}>
                        {' '}
                        <span class="tag gacha">Nổi bật</span>
                      </Show>
                      <div class="muted small">{h.id}</div>
                    </div>
                  </div>
                  <div>
                    <span class={`cfg-fac f-${h.faction}`}>{FACTION_LABELS[h.faction]}</span>
                  </div>
                  <div class="cfg-style">
                    <span class={`pvp-pick-style ${h.style}`} title={PVP_STYLE_LABELS[h.style]}>
                      <StyleIcon style={h.style} />
                    </span>
                    <span class="muted small">{PVP_PASSIVE_LABELS[h.passiveType]}</span>
                  </div>
                  <div class="small">
                    {num(h.baseHp)} HP · {num(h.baseAtk)} ST · {num(h.baseDef)} Giáp
                  </div>
                  <div class="small">
                    <b>{h.skillName}</b> <span class="tag">{PVP_SKILL_LABELS[skillOf(h)]}</span>
                    <div class="muted small">
                      {PVP_TARGETING_LABELS[h.targetType]} · {pct(h.damageRate)} · {h.skillEffects.length} hiệu ứng
                    </div>
                  </div>
                  <div class="cfg-actions">
                    <button class="btn ghost small" data-act="edit" onClick={() => setDraft(h)}>
                      Sửa
                    </button>
                    <Show
                      when={confirmDelete() === h.id}
                      fallback={
                        <button class="btn ghost small" data-act="del-ask" disabled={busy()} onClick={() => setConfirmDelete(h.id)}>
                          Xoá
                        </button>
                      }
                    >
                      <button class="btn danger small" data-act="del" disabled={busy()} onClick={() => void remove(h.id)}>
                        Xác nhận xoá
                      </button>
                      <button class="btn ghost small" disabled={busy()} onClick={() => setConfirmDelete(null)}>
                        Huỷ
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Match>
          <Match when={true}>
            <div class="state-msg">Không có tướng phù hợp.</div>
          </Match>
        </Switch>
      </div>

      <Show when={creating()}>
        <ConfigModal title="Thêm Tướng Mới" onClose={() => setCreating(false)}>
          <div class="cfg-form">
            <div class="cfg-hero-preview">
              <Thumb class="hero big" src={portraitUrl(slugify(newName()))} label={newName() || 'Tướng mới'} />
              <div class="cfg-hero-preview-txt">
                <b>{newName().trim() || 'Tướng mới'}</b>
                <span class="muted small">
                  Định danh dự kiến: <b>{slugify(newName()) || '—'}</b>
                </span>
                <span class="muted small">Chân dung lấy theo định danh (thiếu ảnh thì hiện chữ viết tắt).</span>
              </div>
            </div>
            <label class="cfg-field">
              <span>Tên tướng</span>
              <input
                data-g="new-name"
                value={newName()}
                maxLength={64}
                placeholder="VD: Lữ Bố"
                onInput={(e) => setNewName(e.currentTarget.value)}
                ref={(el: HTMLInputElement) => queueMicrotask(() => el.focus())}
              />
            </label>
            <label class="cfg-field">
              <span>Phe</span>
              <select data-g="new-faction" value={newFaction()} onChange={(e) => setNewFaction(e.currentTarget.value as Faction)}>
                <For each={FACTIONS}>{(x) => <option value={x}>{FACTION_LABELS[x]}</option>}</For>
              </select>
            </label>
            <div class="cfg-help muted small">
              Cấu hình mặc định: phong cách <b>Tấn công</b>, nội tại <b>+10% sát thương</b>, 1000 HP / 100 ST / 14 Giáp,
              kỹ năng <b>Tấn công thường</b> đánh 1 mục tiêu 100% và chưa có hiệu ứng. Mở “Sửa” để chỉnh tiếp.
            </div>
            <div class="cfg-actions">
              <button class="btn primary" data-act="create" disabled={busy()} onClick={() => void create()}>
                Tạo tướng
              </button>
              <button class="btn ghost" disabled={busy()} onClick={() => setCreating(false)}>
                Huỷ
              </button>
            </div>
          </div>
        </ConfigModal>
      </Show>

      <Show when={draft()}>
        {(d) => (
          <ConfigModal wide title={`Cấu hình tướng — ${d().name}`} onClose={() => setDraft(null)}>
            <div class="cfg-form">
              <h4>Định danh</h4>
              <div class="cfg-hero-preview">
                <Thumb class="hero big" src={portraitUrl(d().id)} label={d().name} />
                <div class="cfg-hero-preview-txt">
                  <b>{d().name}</b>
                  <span class="muted small">
                    {d().id} · {FACTION_LABELS[d().faction]} · {PVP_STYLE_LABELS[d().style]} ·{' '}
                    {PVP_PASSIVE_LABELS[d().passiveType]}
                  </span>
                  <span class="muted small">Tướng nổi bật: {d().isHot ? 'Có' : 'Không'}</span>
                </div>
              </div>
              <div class="cfg-grid">
                <label class="cfg-field">
                  <span>Tên tướng</span>
                  <input data-g="name" value={d().name} maxLength={64} onInput={(e) => patch({ name: e.currentTarget.value })} />
                </label>
                <label class="cfg-field">
                  <span>Phe</span>
                  <select data-g="faction" value={d().faction} onChange={(e) => patch({ faction: e.currentTarget.value as Faction })}>
                    <For each={FACTIONS}>{(x) => <option value={x}>{FACTION_LABELS[x]}</option>}</For>
                  </select>
                </label>
                <label class="cfg-field">
                  <span>Phong cách</span>
                  <select data-g="style" value={d().style} onChange={(e) => patch({ style: e.currentTarget.value as PvpStyle })}>
                    <For each={PVP_STYLES}>{(x) => <option value={x}>{PVP_STYLE_LABELS[x]}</option>}</For>
                  </select>
                </label>
                <label class="cfg-field">
                  <span>Nội tại</span>
                  <select
                    data-g="passive"
                    value={d().passiveType}
                    onChange={(e) => patch({ passiveType: e.currentTarget.value as PvpPassive })}
                  >
                    <For each={PVP_PASSIVES}>{(x) => <option value={x}>{PVP_PASSIVE_LABELS[x]}</option>}</For>
                  </select>
                </label>
                <label class="cfg-field cfg-check">
                  <input type="checkbox" data-g="hot" checked={d().isHot} onChange={(e) => patch({ isHot: e.currentTarget.checked })} />
                  <span>Tướng nổi bật (ưu tiên hiển thị)</span>
                </label>
              </div>

              <h4>Chỉ số nền</h4>
              <div class="cfg-help muted small">
                Chỉ số gốc tại Lv.1 — server nhân theo cấp của thẻ khi vào trận (mốc chuẩn: 2000 HP / 200 ST / 14 Giáp).
              </div>
              <div class="cfg-grid">
                <label class="cfg-field">
                  <span>HP nền</span>
                  <input
                    data-g="hp"
                    type="number"
                    min="1"
                    step="1"
                    value={d().baseHp}
                    onInput={(e) => patch({ baseHp: Math.max(1, Math.floor(Number(e.currentTarget.value) || 0)) })}
                  />
                </label>
                <label class="cfg-field">
                  <span>Sát thương nền</span>
                  <input
                    data-g="atk"
                    type="number"
                    min="1"
                    step="1"
                    value={d().baseAtk}
                    onInput={(e) => patch({ baseAtk: Math.max(1, Math.floor(Number(e.currentTarget.value) || 0)) })}
                  />
                </label>
                <label class="cfg-field">
                  <span>Giáp nền</span>
                  <input
                    data-g="def"
                    type="number"
                    min="0"
                    step="1"
                    value={d().baseDef}
                    onInput={(e) => patch({ baseDef: Math.max(0, Math.floor(Number(e.currentTarget.value) || 0)) })}
                  />
                </label>
              </div>

              <h4>Kỹ năng</h4>
              <div class="cfg-grid">
                <label class="cfg-field">
                  <span>Tên kỹ năng</span>
                  <input data-g="skill-name" value={d().skillName} maxLength={64} onInput={(e) => patch({ skillName: e.currentTarget.value })} />
                </label>
                <label class="cfg-field">
                  <span>Mục tiêu</span>
                  <select
                    data-g="target"
                    value={d().targetType}
                    onChange={(e) => patch({ targetType: e.currentTarget.value as PvpTargeting })}
                  >
                    <For each={PVP_TARGETINGS}>{(x) => <option value={x}>{PVP_TARGETING_LABELS[x]}</option>}</For>
                  </select>
                </label>
                <label class="cfg-field">
                  <span>% Sát thương kỹ năng</span>
                  <input
                    data-g="damage-rate"
                    type="number"
                    min="0"
                    step="1"
                    value={d().damageRate / 100}
                    onInput={(e) => patch({ damageRate: Math.max(0, Math.round((Number(e.currentTarget.value) || 0) * 100)) })}
                  />
                </label>
              </div>
              <label class="cfg-field cfg-field-full">
                <span>Mô tả kỹ năng</span>
                <textarea
                  data-g="skill-desc"
                  rows={2}
                  maxLength={1000}
                  value={d().skillDescription}
                  onInput={(e) => patch({ skillDescription: e.currentTarget.value })}
                />
              </label>

              <h4>
                Hiệu ứng kỹ năng <span class="muted small">({d().skillEffects.length})</span>
              </h4>
              <div class="cfg-help muted small">
                Mỗi dòng là một hiệu ứng theo SKILLS.md. Loại kỹ năng (Tấn công / Choáng / Hồi máu / Buff / Debuff /
                Thiêu đốt / Xóa / Thanh tẩy) được server suy ra từ danh sách hiệu ứng.
              </div>
              <div class="cfg-effects">
                <For each={d().skillEffects}>
                  {(e, i) => (
                    <div class="cfg-effect" data-effect={i()}>
                      <label class="cfg-field cfg-field-full">
                        <span>Hiệu ứng</span>
                        <select value={e.type} onChange={(ev) => patchEffect(i(), { type: ev.currentTarget.value as PvpEffectType })}>
                          <For each={EFFECT_GROUPS}>
                            {(g) => (
                              <optgroup label={g.label}>
                                <For each={g.types}>{(x) => <option value={x}>{PVP_EFFECT_LABELS[x]}</option>}</For>
                              </optgroup>
                            )}
                          </For>
                        </select>
                      </label>
                      <label class="cfg-field">
                        <span>Giá trị ({valueUnit(e.type)})</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={e.value}
                          onInput={(ev) => patchEffect(i(), { value: Math.max(0, Math.floor(Number(ev.currentTarget.value) || 0)) })}
                        />
                      </label>
                      <Show when={e.formulaType === 'LEVEL_SPAN'}>
                        <label class="cfg-field">
                          <span>Giá trị tại Cấp 1</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={e.minValue ?? 0}
                            onInput={(ev) => patchEffect(i(), { minValue: Math.max(0, Math.floor(Number(ev.currentTarget.value) || 0)) })}
                          />
                        </label>
                      </Show>
                      <label class="cfg-field">
                        <span>Công thức theo cấp</span>
                        <select
                          value={e.formulaType}
                          onChange={(ev) => patchEffect(i(), { formulaType: ev.currentTarget.value as PvpFormulaType })}
                        >
                          <For each={PVP_FORMULA_TYPES}>{(x) => <option value={x}>{PVP_FORMULA_LABELS[x]}</option>}</For>
                        </select>
                      </label>
                      <label class="cfg-field">
                        <span>Số lượt</span>
                        <input
                          type="number"
                          min="0"
                          max="50"
                          step="1"
                          value={e.duration}
                          onInput={(ev) => patchEffect(i(), { duration: Math.max(0, Math.floor(Number(ev.currentTarget.value) || 0)) })}
                        />
                      </label>
                      <label class="cfg-field">
                        <span>Lớp tối đa</span>
                        <input
                          type="number"
                          min="1"
                          max="10"
                          step="1"
                          value={e.maxLayers}
                          onInput={(ev) => patchEffect(i(), { maxLayers: Math.max(1, Math.floor(Number(ev.currentTarget.value) || 1)) })}
                        />
                      </label>
                      <label class="cfg-field">
                        <span>Tỉ lệ (%)</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={e.rate / 100}
                          onInput={(ev) => patchEffect(i(), { rate: Math.max(0, Math.round((Number(ev.currentTarget.value) || 0) * 100)) })}
                        />
                      </label>
                      <label class="cfg-field">
                        <span>Phạm vi (buff)</span>
                        <select
                          value={e.scope ?? ''}
                          onChange={(ev) => patchEffect(i(), { scope: (ev.currentTarget.value || undefined) as never })}
                        >
                          <option value="">— Không đặt —</option>
                          <For each={PVP_BUFF_SCOPES}>{(x) => <option value={x}>{PVP_BUFF_SCOPE_LABELS[x]}</option>}</For>
                        </select>
                      </label>
                      <label class="cfg-field">
                        <span>Hình dạng</span>
                        <select
                          value={e.mode ?? ''}
                          onChange={(ev) => patchEffect(i(), { mode: (ev.currentTarget.value || undefined) as never })}
                        >
                          <option value="">— Không đặt —</option>
                          <option value="single">Một mục tiêu</option>
                          <option value="row">Cả hàng</option>
                          <option value="all">Toàn bộ</option>
                        </select>
                      </label>
                      <div class="cfg-effect-actions">
                        <button class="btn danger small" data-act="rm-effect" onClick={() => removeEffect(i())}>
                          Xoá
                        </button>
                      </div>
                    </div>
                  )}
                </For>
                <Show when={!d().skillEffects.length}>
                  <div class="muted small">Chưa có hiệu ứng — kỹ năng chỉ gây sát thương cơ bản.</div>
                </Show>
                <button class="btn ghost small" data-act="add-effect" onClick={addEffect}>
                  + Thêm hiệu ứng
                </button>
              </div>

              <div class="cfg-actions">
                <button class="btn primary" data-act="save" disabled={busy()} onClick={() => void save()}>
                  Lưu cấu hình
                </button>
                <button class="btn ghost" disabled={busy()} onClick={() => setDraft(null)}>
                  Huỷ
                </button>
              </div>
            </div>
          </ConfigModal>
        )}
      </Show>
    </>
  );
}

/** Loại kỹ năng hiển thị (nhãn tag) — suy ra từ hiệu ứng, khớp `deriveSkill` ở server. */
function skillOf(h: PvpHeroAdminDto): keyof typeof PVP_SKILL_LABELS {
  const has = (types: readonly PvpEffectType[]) => h.skillEffects.some((e) => types.includes(e.type));
  if (has(['STUN'])) return 'STUN';
  if (has(['HEAL', 'HEAL_SELF'])) return 'HEAL';
  if (has(['PURIFY'])) return 'PURIFY';
  if (has(['DISPEL'])) return 'DISPEL';
  if (has(['DEBUFF_BURN'])) return 'BURN';
  if (has(PVP_DEBUFF_EFFECT_TYPES)) return 'DEBUFF';
  if (has(PVP_BUFF_EFFECT_TYPES)) return 'BUFF';
  return 'ATTACK';
}

// ======================= Tab 2: Quản lý Ngọc Ngũ Hành =======================

type GemDraft = PvpGemAdminDto;
type GemRowState = { draft: GemDraft; saving: boolean; dirty: boolean };

/**
 * Bảng cấu hình 5 hệ Ngọc: mỗi hệ 2 chỉ số, nhập giá trị tại Cấp 1 và Cấp 10.
 * Server nội suy tuyến tính các cấp ở giữa cho chỉ số vừa đổi; chỉ số còn lại giữ nguyên đường cong.
 */
export function PvpGemsPane(props: { alive: () => boolean; ctl: (c: Ctl) => void }) {
  let loaded = false;
  const [listState, setListState] = createSignal<Load>({ kind: 'loading' });
  const [notice, setNotice] = createSignal<Notice>(null);
  const [rows, setRows] = createSignal<GemRowState[]>([]);
  const say = (text: string, ok = true) => setNotice(text ? { ok, text } : null);

  async function load() {
    loaded = true;
    setListState({ kind: 'loading' });
    try {
      const dto = await api.admin.pvpGems();
      if (!props.alive()) return;
      setRows(dto.items.map((g) => ({ draft: { ...g }, saving: false, dirty: false })));
      setListState({ kind: 'ready' });
    } catch (e) {
      if (props.alive()) setListState({ kind: 'error', text: (e as Error).message });
    }
  }

  props.ctl({ ensureLoaded: () => !loaded && void load() });
  void load();

  const update = (element: string, p: Partial<GemDraft>) =>
    setRows((rs) => rs.map((r) => (r.draft.element === element ? { ...r, dirty: true, draft: { ...r.draft, ...p } } : r)));

  async function save(element: string) {
    const row = rows().find((r) => r.draft.element === element);
    if (!row || row.saving) return;
    const d = row.draft;
    if (d.stat1Min > d.stat1Max || d.stat2Min > d.stat2Max) {
      return say('Giá trị Cấp 1 không được lớn hơn Cấp 10.', false);
    }
    setRows((rs) => rs.map((r) => (r.draft.element === element ? { ...r, saving: true } : r)));
    try {
      const saved = await api.admin.pvpGemUpdate(d);
      if (!props.alive()) return;
      setRows((rs) =>
        rs.map((r) => (r.draft.element === element ? { draft: { ...saved }, saving: false, dirty: false } : r)),
      );
      say(`Đã lưu Ngọc hệ ${GEM_ELEMENT_LABELS[saved.element]} — áp dụng ngay cho trận PvP mới.`);
    } catch (e) {
      if (props.alive()) say((e as ApiError).message, false);
      setRows((rs) => rs.map((r) => (r.draft.element === element ? { ...r, saving: false } : r)));
    }
  }

  const statField = (element: string, idx: 1 | 2, d: GemDraft) => {
    const typeKey: 'stat1Type' | 'stat2Type' = idx === 1 ? 'stat1Type' : 'stat2Type';
    const minKey: 'stat1Min' | 'stat2Min' = idx === 1 ? 'stat1Min' : 'stat2Min';
    const maxKey: 'stat1Max' | 'stat2Max' = idx === 1 ? 'stat1Max' : 'stat2Max';
    const isArmor = d[typeKey] === 'defArmor';
    return (
      <>
        <label class="cfg-field">
          <span>Chỉ số {idx}</span>
          <select value={d[typeKey]} onChange={(e) => update(element, { [typeKey]: e.currentTarget.value } as never)}>
            <For each={PVP_GEM_STAT_KEYS}>{(k) => <option value={k}>{GEM_STAT_LABELS[k]}</option>}</For>
          </select>
        </label>
        <label class="cfg-field">
          <span>Cấp 1</span>
          <input
            data-g={`${element}-${idx}-min`}
            type="number"
            min="0"
            step="1"
            value={d[minKey]}
            onInput={(e) => update(element, { [minKey]: Math.max(0, Math.floor(Number(e.currentTarget.value) || 0)) } as never)}
          />
        </label>
        <label class="cfg-field">
          <span>Cấp 10</span>
          <input
            data-g={`${element}-${idx}-max`}
            type="number"
            min="0"
            step="1"
            value={d[maxKey]}
            onInput={(e) => update(element, { [maxKey]: Math.max(0, Math.floor(Number(e.currentTarget.value) || 0)) } as never)}
          />
        </label>
        <div class="cfg-help muted small">
          {isArmor ? 'Đơn vị: điểm Giáp nguyên' : `Đơn vị bps — Cấp 1 ≈ ${pct(d[minKey])}, Cấp 10 ≈ ${pct(d[maxKey])}`}
        </div>
      </>
    );
  };

  return (
    <>
      <div class="cfg-toolbar">
        <span class="muted small">
          Mỗi hệ Ngọc có 2 chỉ số. Nhập giá trị tại <b>Cấp 1</b> và <b>Cấp 10</b>; server nội suy tuyến tính các cấp ở giữa.
        </span>
      </div>
      <div class="adm-msg" aria-live="polite">
        <Notice n={notice()} />
      </div>
      <Switch>
        <Match when={listState().kind === 'loading'}>
          <div class="state-msg">Đang tải…</div>
        </Match>
        <Match when={listState().kind === 'error'}>
          <div class="state-msg error">{(listState() as { text: string }).text}</div>
        </Match>
        <Match when={true}>
          <div class="cfg-gems">
            <For each={rows()}>
              {(r) => (
                <div class="cfg-gem" data-gem={r.draft.element}>
                  <div class="cfg-gem-head">
                    <span class="cfg-gem-art">
                      <Thumb class="gem" src={gemUrl(r.draft.element, 1)} label={GEM_ELEMENT_LABELS[r.draft.element]} />
                      <Thumb class="gem" src={gemUrl(r.draft.element, 10)} label={GEM_ELEMENT_LABELS[r.draft.element]} />
                    </span>
                    <b class={`cfg-fac e-${r.draft.element}`}>{GEM_ELEMENT_LABELS[r.draft.element]}</b>
                    <span class="muted small">Cấp 1 → 10</span>
                    <Show when={r.dirty}>
                      <span class="tag warn-tag">Chưa lưu</span>
                    </Show>
                    <button
                      class="btn primary small"
                      data-act="save-gem"
                      disabled={r.saving || !r.dirty}
                      onClick={() => void save(r.draft.element)}
                    >
                      Lưu
                    </button>
                  </div>
                  <div class="cfg-gem-body">
                    {statField(r.draft.element, 1, r.draft)}
                    {statField(r.draft.element, 2, r.draft)}
                  </div>
                </div>
              )}
            </For>
          </div>
        </Match>
      </Switch>
      <div class="cfg-help muted small">
        Lưu ý: cấp Ngọc tối đa là 10. Nếu chỉ số bị đổi loại, toàn bộ đường cong 10 cấp được nội suy lại từ 2 mốc mới.
      </div>
    </>
  );
}
