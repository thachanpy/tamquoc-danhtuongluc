import {
  FACTIONS,
  FACTION_LABELS,
  PVP_ACTIVE_EFFECT_TYPES,
  PVP_BUFF_EFFECT_TYPES,
  PVP_BUFF_SCOPES,
  PVP_BUFF_SCOPE_LABELS,
  PVP_DEBUFF_EFFECT_TYPES,
  PVP_EFFECT_LABELS,
  PVP_FORMULA_LABELS,
  PVP_FORMULA_TYPES,
  PVP_PASSIVES,
  PVP_PASSIVE_LABELS,
  PVP_SKILL_LABELS,
  PVP_STYLES,
  PVP_STYLE_LABELS,
  PVP_TARGETINGS,
  PVP_TARGETING_LABELS,
  type Faction,
  type PvpBuffScope,
  type PvpEffectType,
  type PvpHeroAdminDto,
  type PvpSkillEffectDto,
  type PvpStyle,
  type PvpTargeting,
} from '@tq/shared';
import { initials, pct, portraitUrl } from '../../assets/art.ts';
import { api } from '../../services/api.ts';
import { ApiError } from '../../services/http.ts';
import { num } from '../../utils/format.ts';
import { clear, h, type Child } from '../dom.ts';
import { openOverlay } from '../modal.ts';
import { styleIcon } from '../StyleIcon.ts';
import { loadBlock, type Load } from './shared.ts';

type Notice = { ok: boolean; text: string } | null;

/** Nhóm hiệu ứng cho dropdown có phân nhóm (theo SKILLS.md). */
const EFFECT_GROUPS: { label: string; types: readonly PvpEffectType[] }[] = [
  { label: 'Tức thì / Nội tại', types: PVP_ACTIVE_EFFECT_TYPES },
  { label: 'Buff (có lợi)', types: PVP_BUFF_EFFECT_TYPES },
  { label: 'Debuff (bất lợi)', types: PVP_DEBUFF_EFFECT_TYPES },
];

/** Toàn bộ loại hiệu ứng (gộp 3 nhóm) — dùng cho dropdown trong từng dòng hiệu ứng. */
const ALL_EFFECT_TYPES: readonly PvpEffectType[] = EFFECT_GROUPS.flatMap((g) => g.types);

/** Hiệu ứng tính theo điểm Giáp nguyên; còn lại tính theo bps (10000 = 100%). */
const ARMOR_EFFECTS = new Set<PvpEffectType>(['BUFF_DEF_ARMOR', 'DEBUFF_DEF_ARMOR_DOWN']);
const valueUnit = (t: PvpEffectType): string => (ARMOR_EFFECTS.has(t) ? 'điểm Giáp' : 'bps (10000 = 100%)');

/** Hiệu ứng mới mặc định (Thiêu đốt cháy lâu hơn — khớp server). */
const newEffect = (): PvpSkillEffectDto => ({ type: 'BUFF_DAMAGE', value: 0, duration: 3, maxLayers: 3, rate: 0, formulaType: 'FIXED_CAP_MINUS_10' });

/** Định danh dự kiến của tướng mới — giữ đúng quy tắc `slugify` ở server để xem trước chân dung. */
const slugify = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

/** Loại kỹ năng hiển thị (nhãn tag) — suy ra từ hiệu ứng, khớp `deriveSkill` ở server. */
function skillOf(x: PvpHeroAdminDto): keyof typeof PVP_SKILL_LABELS {
  const has = (types: readonly PvpEffectType[]): boolean => x.skillEffects.some((e) => types.includes(e.type));
  if (has(['STUN'])) return 'STUN';
  if (has(['HEAL', 'HEAL_SELF'])) return 'HEAL';
  if (has(['PURIFY'])) return 'PURIFY';
  if (has(['DISPEL'])) return 'DISPEL';
  if (has(['DEBUFF_BURN'])) return 'BURN';
  if (has(PVP_DEBUFF_EFFECT_TYPES)) return 'DEBUFF';
  if (has(PVP_BUFF_EFFECT_TYPES)) return 'BUFF';
  return 'ATTACK';
}

/** Ảnh thu nhỏ chân dung tướng; thiếu ảnh thì lộ chữ viết tắt làm nền. */
function heroThumb(src: string, label: string, cls: string): HTMLElement {
  const img = h('img', { attrs: { src, alt: '', loading: 'lazy', decoding: 'async' } });
  img.addEventListener('error', () => img.remove());
  return h('span', { class: `cfg-thumb ${cls}`, attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'cfg-thumb-ini', text: initials(label) }), img);
}

/** Một ô nhập liệu có nhãn phía trên. */
function field(label: string, control: HTMLElement, cls = 'cfg-field'): HTMLLabelElement {
  return h('label', { class: cls }, h('span', { text: label }), control);
}

/** `<select>` từ danh sách giá trị + bảng nhãn. */
function selectOf<T extends string>(values: readonly T[], labels: Record<T, string>, value: T, onChange: (v: T) => void): HTMLSelectElement {
  const sel = h('select', {}, ...values.map((v) => h('option', { attrs: { value: v }, text: labels[v] })));
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value as T));
  return sel;
}

/** `<select>` cho trường tuỳ chọn: thêm dòng "Không đặt" (giá trị rỗng ⇒ bỏ trường). */
function optionalSelect<T extends string>(values: readonly T[], labels: Record<T, string>, value: T | undefined, onChange: (v: T | undefined) => void): HTMLSelectElement {
  const sel = h('select', {}, h('option', { attrs: { value: '' }, text: '— Không đặt —' }), ...values.map((v) => h('option', { attrs: { value: v }, text: labels[v] })));
  sel.value = value ?? '';
  sel.addEventListener('change', () => onChange((sel.value || undefined) as T | undefined));
  return sel;
}

/**
 * Tab "Cấu hình Tướng" (mục 6.7): chỉ số nền + kỹ năng + hiệu ứng của từng tướng PvP.
 * Server lưu DB rồi nạp lại `PvpConfigRegistry` ⇒ trận PvP tạo sau khi lưu áp dụng cấu hình mới ngay.
 *
 * Bản nháp khi sửa được MUTATE trực tiếp (không tạo object mới) nên gõ số không mất focus;
 * chỉ riêng danh sách hiệu ứng được vẽ lại khi thêm/xoá/đổi công thức.
 */
export class PvpHeroesPane {
  readonly el: HTMLElement;

  private readonly opts: { alive: () => boolean };
  private readonly f = { faction: '', style: '', effect: '', target: '', q: '' };

  private loaded = false;
  private seq = 0;
  private items: PvpHeroAdminDto[] = [];
  private listState: Load = { kind: 'loading' };
  private notice: Notice = null;
  private busy = false;
  private draft: PvpHeroAdminDto | null = null;
  private newName = '';
  private newFaction: Faction = 'wei';
  private confirmDelete: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;

  private closeCreate: (() => void) | null = null;
  private closeEdit: (() => void) | null = null;
  private effectsEl: HTMLElement | null = null;
  private effectsCountEl: HTMLElement | null = null;

  private readonly summaryEl: HTMLElement;
  private readonly msgEl: HTMLElement;
  private readonly heroesEl: HTMLElement;

  constructor(opts: { alive: () => boolean }) {
    this.opts = opts;

    const addBtn = h('button', { class: 'btn primary small', text: '+ Thêm Tướng Mới' });
    addBtn.addEventListener('click', () => {
      if (!this.closeCreate) this.openCreate();
    });
    const toolbar = h(
      'div',
      { class: 'cfg-toolbar' },
      addBtn,
      h('span', { class: 'muted small', text: 'Sửa chỉ số nền, kỹ năng và hiệu ứng; thay đổi áp dụng ngay cho trận PvP mới.' }),
    );

    const q = h('input', { attrs: { type: 'search', placeholder: 'Tìm theo tên tướng…', maxlength: 64, 'aria-label': 'Tìm tướng PvP' } });
    q.addEventListener('input', () => this.onFilter('q', q.value));

    const faction = h('select', { attrs: { 'aria-label': 'Phe' } }, h('option', { attrs: { value: '' }, text: 'Mọi phe' }));
    for (const x of FACTIONS) faction.appendChild(h('option', { attrs: { value: x }, text: FACTION_LABELS[x] }));
    faction.addEventListener('input', () => this.onFilter('faction', faction.value));

    const style = h('select', { attrs: { 'aria-label': 'Phong cách' } }, h('option', { attrs: { value: '' }, text: 'Mọi phong cách' }));
    for (const x of PVP_STYLES) style.appendChild(h('option', { attrs: { value: x }, text: PVP_STYLE_LABELS[x] }));
    style.addEventListener('input', () => this.onFilter('style', style.value));

    const effect = h('select', { class: 'f-effect', attrs: { 'aria-label': 'Hiệu ứng kỹ năng' } }, h('option', { attrs: { value: '' }, text: 'Mọi hiệu ứng kỹ năng' }));
    for (const g of EFFECT_GROUPS) {
      const og = h('optgroup', { attrs: { label: g.label } });
      for (const t of g.types) og.appendChild(h('option', { attrs: { value: t }, text: PVP_EFFECT_LABELS[t] }));
      effect.appendChild(og);
    }
    effect.addEventListener('input', () => this.onFilter('effect', effect.value));

    const target = h('select', { class: 'f-target', attrs: { 'aria-label': 'Mục tiêu kỹ năng' } }, h('option', { attrs: { value: '' }, text: 'Mọi mục tiêu' }));
    for (const x of PVP_TARGETINGS) target.appendChild(h('option', { attrs: { value: x }, text: PVP_TARGETING_LABELS[x] }));
    target.addEventListener('input', () => this.onFilter('target', target.value));

    this.summaryEl = h('div', { class: 'adm-summary muted small' });
    this.msgEl = h('div', { class: 'adm-msg', attrs: { 'aria-live': 'polite' } });
    this.heroesEl = h('div', { class: 'cfg-heroes' });

    this.el = h('div', {}, toolbar, h('div', { class: 'filters' }, q, faction, style, effect, target), this.summaryEl, this.msgEl, this.heroesEl);

    void this.load();
  }

  /** Gọi khi người dùng mở tab (dữ liệu đã nạp ngay khi pane được tạo). */
  ensureLoaded(): void {
    if (!this.loaded) void this.load();
  }

  private onFilter(key: 'faction' | 'style' | 'effect' | 'target' | 'q', value: string): void {
    const apply = (): void => {
      this.f[key] = value;
      void this.load();
    };
    clearTimeout(this.timer);
    if (key === 'q') this.timer = setTimeout(apply, 250);
    else apply();
  }

  private say(text: string, ok = true): void {
    this.notice = text ? { ok, text } : null;
    this.drawNotice();
  }

  private drawNotice(): void {
    clear(this.msgEl);
    if (this.notice) this.msgEl.appendChild(h('div', { class: this.notice.ok ? 'notice' : 'warn', text: this.notice.text }));
  }

  private async load(): Promise<void> {
    this.loaded = true;
    const my = ++this.seq;
    this.listState = { kind: 'loading' };
    this.drawList();
    try {
      const dto = await api.admin.pvpHeroes({
        faction: (this.f.faction || undefined) as Faction | undefined,
        style: (this.f.style || undefined) as PvpStyle | undefined,
        effect: (this.f.effect || undefined) as PvpEffectType | undefined,
        target: (this.f.target || undefined) as PvpTargeting | undefined,
        q: this.f.q || undefined,
      });
      if (!this.opts.alive() || my !== this.seq) return;
      this.items = dto.items;
      this.listState = { kind: 'ready' };
    } catch (e) {
      if (!this.opts.alive() || my !== this.seq) return;
      this.listState = { kind: 'error', text: (e as Error).message };
    }
    this.drawList();
  }

  // ======================= Danh sách =======================

  private drawList(): void {
    this.summaryEl.textContent = this.listState.kind === 'ready' ? `${num(this.items.length)} tướng PvP` : '';
    this.drawNotice();
    clear(this.heroesEl);
    if (this.listState.kind !== 'ready' || this.items.length === 0) {
      this.heroesEl.appendChild(loadBlock(this.listState, 'Không có tướng phù hợp.'));
      return;
    }
    this.heroesEl.appendChild(
      h(
        'div',
        { class: 'cfg-hero-head muted small' },
        h('div', { text: 'Tướng' }),
        h('div', { text: 'Phe' }),
        h('div', { text: 'Phong cách · Nội tại' }),
        h('div', { text: 'Chỉ số nền (Lv.1)' }),
        h('div', { text: 'Kỹ năng' }),
        h('div', { text: 'Thao tác' }),
      ),
    );
    for (const x of this.items) this.heroesEl.appendChild(this.row(x));
  }

  private row(x: PvpHeroAdminDto): HTMLElement {
    const nameText = h('div', { class: 'cfg-name-txt' }, h('b', { text: x.name }));
    if (x.isHot) {
      nameText.appendChild(document.createTextNode(' '));
      nameText.appendChild(h('span', { class: 'tag gacha', text: 'Nổi bật' }));
    }
    nameText.appendChild(h('div', { class: 'muted small', text: x.id }));
    const name = h('div', { class: 'cfg-name' }, heroThumb(portraitUrl(x.id), x.name, 'hero'), nameText);

    const fac = h('div', {}, h('span', { class: `cfg-fac f-${x.faction}`, text: FACTION_LABELS[x.faction] }));

    const style = h(
      'div',
      { class: 'cfg-style' },
      h('span', { class: `pvp-pick-style ${x.style}`, attrs: { title: PVP_STYLE_LABELS[x.style] } }, styleIcon(x.style)),
      h('span', { class: 'muted small', text: PVP_PASSIVE_LABELS[x.passiveType] }),
    );

    const stats = h('div', { class: 'small', text: `${num(x.baseHp)} HP · ${num(x.baseAtk)} ST · ${num(x.baseDef)} Giáp` });

    const skill = h(
      'div',
      { class: 'small' },
      h('b', { text: x.skillName }),
      ' ',
      h('span', { class: 'tag', text: PVP_SKILL_LABELS[skillOf(x)] }),
      h('div', { class: 'muted small', text: `${PVP_TARGETING_LABELS[x.targetType]} · ${pct(x.damageRate)} · ${x.skillEffects.length} hiệu ứng` }),
    );

    const actions = h('div', { class: 'cfg-actions' });
    const edit = h('button', { class: 'btn ghost small', text: 'Sửa' });
    edit.addEventListener('click', () => this.openEdit(x));
    actions.appendChild(edit);
    if (this.confirmDelete === x.id) {
      const del = h('button', { class: 'btn danger small', text: 'Xác nhận xoá' });
      del.addEventListener('click', () => void this.remove(x.id));
      const cancel = h('button', { class: 'btn ghost small', text: 'Huỷ' });
      cancel.addEventListener('click', () => {
        this.confirmDelete = null;
        this.drawList();
      });
      actions.appendChild(del);
      actions.appendChild(cancel);
    } else {
      const ask = h('button', { class: 'btn ghost small', text: 'Xoá' });
      ask.disabled = this.busy;
      ask.addEventListener('click', () => {
        this.confirmDelete = x.id;
        this.drawList();
      });
      actions.appendChild(ask);
    }

    return h('div', { class: 'cfg-hero-row', attrs: { 'data-hero': x.id } }, name, fac, style, stats, skill, actions);
  }

  private async remove(id: string): Promise<void> {
    this.confirmDelete = null;
    this.busy = true;
    try {
      await api.admin.pvpHeroDelete(id);
      if (!this.opts.alive()) return;
      this.say('Đã xoá cấu hình tướng. Nếu tướng thuộc roster gốc, nó trở về đúng cấu hình trong code.');
      await this.load();
    } catch (e) {
      if (this.opts.alive()) this.say((e as ApiError).message, false);
    } finally {
      this.busy = false;
    }
  }

  // ======================= Modal: thêm tướng mới =======================

  private openCreate(): void {
    const nameInput = h('input', { attrs: { maxlength: 64, placeholder: 'VD: Lữ Bố' } });
    nameInput.value = this.newName;
    const faction = selectOf(FACTIONS, FACTION_LABELS, this.newFaction, (v) => (this.newFaction = v));

    const previewImg = h('img', { attrs: { alt: '', loading: 'lazy', decoding: 'async' } });
    previewImg.addEventListener('error', () => previewImg.remove());
    const previewIni = h('span', { class: 'cfg-thumb-ini' });
    const previewName = h('b');
    const previewId = h('b');
    const preview = h(
      'div',
      { class: 'cfg-hero-preview' },
      h('span', { class: 'cfg-thumb hero big', attrs: { 'aria-hidden': 'true' } }, previewIni, previewImg),
      h(
        'div',
        { class: 'cfg-hero-preview-txt' },
        previewName,
        h('span', { class: 'muted small' }, 'Định danh dự kiến: ', previewId),
        h('span', { class: 'muted small', text: 'Chân dung lấy theo định danh (thiếu ảnh thì hiện chữ viết tắt).' }),
      ),
    );
    const drawPreview = (): void => {
      const text = this.newName.trim();
      previewIni.textContent = initials(text || 'Tướng mới');
      previewName.textContent = text || 'Tướng mới';
      const slug = slugify(text);
      previewId.textContent = slug || '—';
      if (slug) previewImg.src = portraitUrl(slug);
      else previewImg.remove();
    };
    drawPreview();
    nameInput.addEventListener('input', () => {
      this.newName = nameInput.value;
      drawPreview();
    });

    const createBtn = h('button', { class: 'btn primary', text: 'Tạo tướng' });
    createBtn.addEventListener('click', () => void this.create());
    const cancelBtn = h('button', { class: 'btn ghost', text: 'Huỷ' });
    cancelBtn.addEventListener('click', () => this.closeCreate?.());

    this.closeCreate = this.modal('Thêm Tướng Mới', false, [
      h(
        'div',
        { class: 'cfg-form' },
        preview,
        field('Tên tướng', nameInput),
        field('Phe', faction),
        h(
          'div',
          { class: 'cfg-help muted small' },
          'Cấu hình mặc định: phong cách ',
          h('b', { text: 'Tấn công' }),
          ', nội tại ',
          h('b', { text: '+10% sát thương' }),
          ', 1000 HP / 100 ST / 14 Giáp, kỹ năng ',
          h('b', { text: 'Tấn công thường' }),
          ' đánh 1 mục tiêu 100% và chưa có hiệu ứng. Mở “Sửa” để chỉnh tiếp.',
        ),
        h('div', { class: 'cfg-actions' }, createBtn, cancelBtn),
      ),
    ]);
    queueMicrotask(() => nameInput.focus());
  }

  private async create(): Promise<void> {
    const name = this.newName.trim();
    if (!name) {
      this.say('Hãy nhập tên tướng.', false);
      return;
    }
    this.busy = true;
    try {
      const hero = await api.admin.pvpHeroCreate({ name, faction: this.newFaction });
      if (!this.opts.alive()) return;
      this.closeCreate?.();
      this.newName = '';
      this.say(`Đã thêm tướng "${hero.name}" với cấu hình mặc định — bấm "Sửa" để chỉnh kỹ năng.`);
      await this.load();
      this.openEdit(hero);
    } catch (e) {
      if (this.opts.alive()) this.say((e as ApiError).message, false);
    } finally {
      this.busy = false;
    }
  }

  // ======================= Modal: sửa cấu hình =======================

  private openEdit(hero: PvpHeroAdminDto): void {
    if (this.closeEdit) return;
    // Bản nháp tách khỏi `hero` để bấm Huỷ là bỏ mọi thay đổi.
    const d: PvpHeroAdminDto = { ...hero, skillEffects: hero.skillEffects.map((e) => ({ ...e })) };
    this.draft = d;

    const grid = h(
      'div',
      { class: 'cfg-grid' },
      field('Tên tướng', this.textInput(d.name, (v) => (d.name = v), 64)),
      field('Phe', selectOf(FACTIONS, FACTION_LABELS, d.faction, (v) => (d.faction = v))),
      field('Phong cách', selectOf(PVP_STYLES, PVP_STYLE_LABELS, d.style, (v) => (d.style = v))),
      field('Nội tại', selectOf(PVP_PASSIVES, PVP_PASSIVE_LABELS, d.passiveType, (v) => (d.passiveType = v))),
      this.checkField('Tướng nổi bật (ưu tiên hiển thị)', d.isHot, (v) => (d.isHot = v)),
    );

    const stats = h(
      'div',
      { class: 'cfg-grid' },
      field('HP nền', this.numInput(d.baseHp, (v) => (d.baseHp = v), 1)),
      field('Sát thương nền', this.numInput(d.baseAtk, (v) => (d.baseAtk = v), 1)),
      field('Giáp nền', this.numInput(d.baseDef, (v) => (d.baseDef = v), 0)),
    );

    const skill = h(
      'div',
      { class: 'cfg-grid' },
      field('Tên kỹ năng', this.textInput(d.skillName, (v) => (d.skillName = v), 64)),
      field('Mục tiêu', selectOf(PVP_TARGETINGS, PVP_TARGETING_LABELS, d.targetType, (v) => (d.targetType = v))),
      // Server nhận bps (10000 = 100%); ô nhập hiển thị % cho dễ đọc.
      field('% Sát thương kỹ năng', this.numInput(d.damageRate / 100, (v) => (d.damageRate = Math.round(v * 100)), 0, 1)),
    );

    const desc = h('textarea', { attrs: { rows: 2, maxlength: 1000 } });
    desc.value = d.skillDescription;
    desc.addEventListener('input', () => (d.skillDescription = desc.value));

    this.effectsEl = h('div', { class: 'cfg-effects' });
    const effectsHead = h('h4', {}, 'Hiệu ứng kỹ năng ', h('span', { class: 'muted small' }));
    this.effectsCountEl = effectsHead.querySelector('span');

    const saveBtn = h('button', { class: 'btn primary', text: 'Lưu cấu hình' });
    saveBtn.addEventListener('click', () => void this.save());
    const cancelBtn = h('button', { class: 'btn ghost', text: 'Huỷ' });
    cancelBtn.addEventListener('click', () => this.closeEdit?.());

    const content = h(
      'div',
      { class: 'cfg-form' },
      h('h4', { text: 'Định danh' }),
      h(
        'div',
        { class: 'cfg-hero-preview' },
        heroThumb(portraitUrl(d.id), d.name, 'hero big'),
        h(
          'div',
          { class: 'cfg-hero-preview-txt' },
          h('b', { text: d.name }),
          h('span', { class: 'muted small', text: `${d.id} · ${FACTION_LABELS[d.faction]} · ${PVP_STYLE_LABELS[d.style]} · ${PVP_PASSIVE_LABELS[d.passiveType]}` }),
          h('span', { class: 'muted small', text: `Tướng nổi bật: ${d.isHot ? 'Có' : 'Không'}` }),
        ),
      ),
      grid,
      h('h4', { text: 'Chỉ số nền' }),
      h('div', { class: 'cfg-help muted small' }, 'Chỉ số gốc tại Lv.1 — server nhân theo cấp của thẻ khi vào trận (mốc chuẩn: 2000 HP / 200 ST / 14 Giáp).'),
      stats,
      h('h4', { text: 'Kỹ năng' }),
      skill,
      field('Mô tả kỹ năng', desc, 'cfg-field cfg-field-full'),
      effectsHead,
      h(
        'div',
        { class: 'cfg-help muted small' },
        'Mỗi dòng là một hiệu ứng theo SKILLS.md. Loại kỹ năng (Tấn công / Choáng / Hồi máu / Buff / Debuff / Thiêu đốt / Xóa / Thanh tẩy) được server suy ra từ danh sách hiệu ứng.',
      ),
      this.effectsEl,
      h('div', { class: 'cfg-actions' }, saveBtn, cancelBtn),
    );

    this.closeEdit = this.modal(`Cấu hình tướng — ${d.name}`, true, [content], () => {
      this.draft = null;
      this.effectsEl = null;
      this.effectsCountEl = null;
    });
    this.drawEffects();
  }

  private drawEffects(): void {
    const d = this.draft;
    const host = this.effectsEl;
    if (!d || !host) return;
    clear(host);
    if (this.effectsCountEl) this.effectsCountEl.textContent = `(${d.skillEffects.length})`;

    d.skillEffects.forEach((e, i) => {
      const row = h(
        'div',
        { class: 'cfg-effect' },
        field(
          'Hiệu ứng',
          selectOf(ALL_EFFECT_TYPES, PVP_EFFECT_LABELS, e.type, (v) => {
            e.type = v;
            this.drawEffects();
          }),
          'cfg-field cfg-field-full',
        ),
        field(`Giá trị (${valueUnit(e.type)})`, this.numInput(e.value, (v) => (e.value = v), 0)),
      );

      if (e.formulaType === 'LEVEL_SPAN') row.appendChild(field('Giá trị tại Cấp 1', this.numInput(e.minValue ?? 0, (v) => (e.minValue = v), 0)));

      row.appendChild(
        field(
          'Công thức theo cấp',
          selectOf(PVP_FORMULA_TYPES, PVP_FORMULA_LABELS, e.formulaType, (v) => {
            e.formulaType = v;
            this.drawEffects();
          }),
        ),
      );
      row.appendChild(field('Số lượt', this.numInput(e.duration, (v) => (e.duration = v), 0, 1, 50)));
      row.appendChild(field('Lớp tối đa', this.numInput(e.maxLayers, (v) => (e.maxLayers = v), 1, 1, 10)));
      row.appendChild(field('Tỉ lệ (%)', this.numInput(e.rate / 100, (v) => (e.rate = Math.round(v * 100)), 0, 0.01)));
      row.appendChild(field('Phạm vi (buff)', optionalSelect<PvpBuffScope>(PVP_BUFF_SCOPES, PVP_BUFF_SCOPE_LABELS, e.scope, (v) => (e.scope = v))));
      row.appendChild(
        field(
          'Hình dạng',
          optionalSelect<'single' | 'row' | 'all'>(
            ['single', 'row', 'all'],
            { single: 'Một mục tiêu', row: 'Cả hàng', all: 'Toàn bộ' },
            e.mode,
            (v) => (e.mode = v),
          ),
        ),
      );

      const rm = h('button', { class: 'btn danger small', text: 'Xoá' });
      rm.addEventListener('click', () => {
        d.skillEffects.splice(i, 1);
        this.drawEffects();
      });
      row.appendChild(h('div', { class: 'cfg-effect-actions' }, rm));

      host.appendChild(row);
    });

    if (!d.skillEffects.length) host.appendChild(h('div', { class: 'muted small', text: 'Chưa có hiệu ứng — kỹ năng chỉ gây sát thương cơ bản.' }));

    const add = h('button', { class: 'btn ghost small', text: '+ Thêm hiệu ứng' });
    add.addEventListener('click', () => {
      d.skillEffects.push(newEffect());
      this.drawEffects();
    });
    host.appendChild(add);
  }

  private async save(): Promise<void> {
    const d = this.draft;
    if (!d || this.busy || !this.opts.alive()) return;
    this.busy = true;
    try {
      const { id, ...body } = d;
      await api.admin.pvpHeroUpdate(id, body);
      if (!this.opts.alive()) return;
      this.closeEdit?.();
      this.say(`Đã lưu cấu hình tướng "${d.name}". Trận PvP tạo sau đây áp dụng ngay.`);
    } catch (e) {
      if (this.opts.alive()) this.say((e as ApiError).message, false);
    } finally {
      this.busy = false;
      await this.load();
    }
  }

  // ======================= Tiện ích dựng control =======================

  private textInput(value: string, onChange: (v: string) => void, maxLength: number): HTMLInputElement {
    const el = h('input', { attrs: { maxlength: maxLength } });
    el.value = value;
    el.addEventListener('input', () => onChange(el.value));
    return el;
  }

  /** Ô nhập số: tự kẹp về `min`; `step` lẻ (tỉ lệ %) thì giữ phần thập phân. */
  private numInput(value: number, onChange: (n: number) => void, min: number, step = 1, max?: number): HTMLInputElement {
    const el = h('input', { attrs: { type: 'number', min, max, step } });
    el.value = String(value);
    el.addEventListener('input', () => {
      const raw = Number(el.value) || 0;
      onChange(Math.max(min, step < 1 ? raw : Math.floor(raw)));
    });
    return el;
  }

  private checkField(label: string, checked: boolean, onChange: (v: boolean) => void): HTMLLabelElement {
    const box = h('input', { attrs: { type: 'checkbox' } });
    box.checked = checked;
    box.addEventListener('change', () => onChange(box.checked));
    return h('label', { class: 'cfg-field cfg-check' }, box, h('span', { text: label }));
  }

  /** Mở modal cấu hình (khung `.cfg-modal` dùng chung), trả về hàm đóng. */
  private modal(title: string, wide: boolean, content: Child[], onClose?: () => void): () => void {
    let close = (): void => {};
    const closeBtn = h('button', { class: 'btn ghost small', text: 'Đóng' });
    closeBtn.addEventListener('click', () => close());
    close = openOverlay({
      className: 'cfg-modal',
      boxClass: wide ? 'cfg-box wide' : 'cfg-box',
      content: [h('div', { class: 'cfg-head' }, h('h3', { text: title }), closeBtn), ...content],
      onClose,
    });
    return close;
  }

  /** Dỡ pane: huỷ debounce và đóng modal còn mở. */
  dispose(): void {
    clearTimeout(this.timer);
    this.closeCreate?.();
    this.closeEdit?.();
  }
}
