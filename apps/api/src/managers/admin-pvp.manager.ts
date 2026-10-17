import {
  PVP_BUFF_EFFECT_TYPES,
  PVP_DEBUFF_EFFECT_TYPES,
  PVP_EFFECT_TYPES,
  type Faction,
  type PvpEffectType,
  type PvpGemAdminDto,
  type PvpGemsAdminDto,
  type PvpHeroAdminDto,
  type PvpHeroesAdminDto,
  type PvpSkill,
  type PvpSkillEffectDto,
  type PvpStyle,
} from '@tq/shared';
import { AppError, type GameContext } from '../context.ts';
import { tx } from '../db.ts';
import { iso } from '../utils.ts';
import { interpolateGemLevels, reloadPvpConfig } from '../pvp-config.registry.ts';
import {
  deleteHeroRow,
  findGemRow,
  findHeroRow,
  insertHeroRow,
  listGemRows,
  listHeroRows,
  updateHeroRow,
  upsertGemRow,
  type PvpHeroRow,
  type PvpGemRow,
} from '../repositories/pvp-config.repository.ts';

/**
 * Quản trị CẤU HÌNH PvP (mục 6.7 — Tướng & Ngọc Ngũ Hành) trên trang Quản trị.
 *
 * Mọi thao tác ghi ở đây đều: (1) lưu DB trong 1 transaction, (2) gọi `reloadPvpConfig()` để
 * `PvpConfigRegistry` đọc lại DB ⇒ engine PvP áp dụng NGAY, không cần restart API Server.
 */

/** Số lượt mặc định của hiệu ứng (Thiêu đốt cháy lâu hơn theo SKILLS.md). */
const DEFAULT_EFFECT_DURATION = 3;
const BURN_EFFECT_DURATION = 4;
const DEFAULT_EFFECT_MAX_LAYERS = 3;

/** Giá trị mặc định của Tướng mới (mức sàn): Tấn công thường đánh 1 mục tiêu, 100% sát thương. */
const NEW_HERO_DEFAULTS = {
  style: 'attack',
  passiveType: 'DAMAGE_10',
  baseHp: 1000,
  baseAtk: 100,
  baseDef: 14,
  skillName: 'Tấn công thường',
  targetType: 'single',
  damageRate: 10000,
} as const;

function parseEffects(json: string): PvpSkillEffectDto[] {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as PvpSkillEffectDto[]) : [];
  } catch {
    return [];
  }
}

function heroToDto(r: PvpHeroRow): PvpHeroAdminDto {
  return {
    id: r.id,
    name: r.name,
    faction: r.faction,
    isHot: r.is_hot === 1,
    style: r.style,
    passiveType: r.passive_type,
    baseHp: r.base_hp,
    baseAtk: r.base_atk,
    baseDef: r.base_def,
    skillName: r.skill_name,
    skillDescription: r.skill_description,
    targetType: r.target_type,
    damageRate: r.damage_rate,
    skillEffects: parseEffects(r.skill_effects),
  };
}

function gemToDto(r: PvpGemRow): PvpGemAdminDto {
  return {
    element: r.element,
    stat1Type: r.stat1_type as PvpGemAdminDto['stat1Type'],
    stat1Min: r.stat1_min,
    stat1Max: r.stat1_max,
    stat2Type: r.stat2_type as PvpGemAdminDto['stat2Type'],
    stat2Min: r.stat2_min,
    stat2Max: r.stat2_max,
  };
}

/** Chuẩn hoá một dòng hiệu ứng: điền mặc định số lượt/lớp/tỉ lệ/công thức còn thiếu. */
function normalizeEffect(e: PvpSkillEffectDto): PvpSkillEffectDto {
  return {
    ...e,
    duration: e.duration ?? (e.type === 'DEBUFF_BURN' ? BURN_EFFECT_DURATION : DEFAULT_EFFECT_DURATION),
    maxLayers: e.maxLayers ?? DEFAULT_EFFECT_MAX_LAYERS,
    rate: e.rate ?? 0,
    formulaType: e.formulaType ?? 'FIXED_CAP_MINUS_10',
  };
}

/** Kiểm tra danh sách hiệu ứng hợp lệ (chặn dữ liệu lạ ngoài danh mục của SKILLS.md). */
function validateEffects(effects: PvpSkillEffectDto[]): void {
  for (const e of effects) {
    if (!(PVP_EFFECT_TYPES as readonly string[]).includes(e.type)) {
      throw new AppError(400, 'INVALID_EFFECT', `Hiệu ứng không hợp lệ: ${e.type}`);
    }
    if (!Number.isSafeInteger(e.value) || e.value < 0) {
      throw new AppError(400, 'INVALID_EFFECT_VALUE', 'Giá trị hiệu ứng phải là số nguyên không âm.');
    }
  }
}

/**
 * Loại kỹ năng dùng cho hiệu ứng hình ảnh phía client — suy ra từ danh sách hiệu ứng
 * nên Admin không phải khai báo thêm trường này.
 */
function deriveSkill(effects: PvpSkillEffectDto[]): PvpSkill {
  const has = (types: readonly PvpEffectType[]) => effects.some((e) => types.includes(e.type));
  if (has(['STUN'])) return 'STUN';
  if (has(['HEAL', 'HEAL_SELF'])) return 'HEAL';
  if (has(['PURIFY'])) return 'PURIFY';
  if (has(['DISPEL'])) return 'DISPEL';
  if (has(['DEBUFF_BURN'])) return 'BURN';
  if (has([...PVP_DEBUFF_EFFECT_TYPES])) return 'DEBUFF';
  if (has([...PVP_BUFF_EFFECT_TYPES])) return 'BUFF';
  return 'ATTACK';
}

/** Bỏ dấu tiếng Việt để sinh định danh tướng mới từ tên. */
function slugify(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
  return ascii.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

/** Định danh duy nhất cho tướng mới: slug theo tên, thêm hậu tố số nếu đã tồn tại. */
function uniqueHeroId(ctx: GameContext, name: string): string {
  const base = slugify(name) || 'tuong-moi';
  let id = base;
  for (let i = 2; findHeroRow(ctx.db, id); i++) id = `${base}-${i}`;
  return id;
}

export interface AdminPvpHeroesQuery {
  faction?: Faction;
  style?: PvpStyle;
  q?: string;
}

/** Danh sách cấu hình Tướng PvP kèm bộ lọc Phe / Phong cách / Tìm theo tên (mục 4.1). */
export function adminListPvpHeroes(ctx: GameContext, query: AdminPvpHeroesQuery): PvpHeroesAdminDto {
  const keyword = query.q?.trim().toLowerCase();
  const items = listHeroRows(ctx.db)
    .filter((r) => !query.faction || r.faction === query.faction)
    .filter((r) => !query.style || r.style === query.style)
    .filter((r) => !keyword || r.name.toLowerCase().includes(keyword) || r.id.includes(keyword))
    .map(heroToDto);
  return { items, total: items.length };
}

export interface AdminPvpHeroCreateInput {
  name: string;
  faction: Faction;
  id?: string;
}

/** Thêm Tướng mới: chỉ cần Tên + Phe, mọi cấu hình khác lấy mặc định mức sàn. */
export function adminCreatePvpHero(ctx: GameContext, body: AdminPvpHeroCreateInput): PvpHeroAdminDto {
  const name = body.name.trim();
  if (!name) throw new AppError(400, 'INVALID_NAME', 'Tên tướng không được để trống.');
  const id = body.id ?? uniqueHeroId(ctx, name);
  if (findHeroRow(ctx.db, id)) throw new AppError(409, 'HERO_EXISTS', 'Tướng đã tồn tại.');
  const row: PvpHeroRow = {
    id,
    name,
    faction: body.faction,
    is_hot: 0,
    style: NEW_HERO_DEFAULTS.style,
    passive_type: NEW_HERO_DEFAULTS.passiveType,
    base_hp: NEW_HERO_DEFAULTS.baseHp,
    base_atk: NEW_HERO_DEFAULTS.baseAtk,
    base_def: NEW_HERO_DEFAULTS.baseDef,
    skill_name: NEW_HERO_DEFAULTS.skillName,
    skill_description: '',
    skill: 'ATTACK',
    target_type: NEW_HERO_DEFAULTS.targetType,
    damage_rate: NEW_HERO_DEFAULTS.damageRate,
    skill_effects: '[]',
    updated_at: iso(ctx.now()),
  };
  insertHeroRow(ctx.db, row);
  reloadPvpConfig();
  return heroToDto(row);
}

export type AdminPvpHeroUpdateInput = Omit<PvpHeroAdminDto, 'id'>;

/** Cập nhật cấu hình một Tướng: chỉ số nền, phong cách, nội tại, kỹ năng và danh sách hiệu ứng. */
export function adminUpdatePvpHero(ctx: GameContext, id: string, body: AdminPvpHeroUpdateInput): PvpHeroAdminDto {
  const existing = findHeroRow(ctx.db, id);
  if (!existing) throw new AppError(404, 'HERO_NOT_FOUND', 'Không tìm thấy tướng PvP.');
  validateEffects(body.skillEffects);
  const effects = body.skillEffects.map(normalizeEffect);
  const name = body.name.trim();
  const skillName = body.skillName.trim();
  if (!name) throw new AppError(400, 'INVALID_NAME', 'Tên tướng không được để trống.');
  if (!skillName) throw new AppError(400, 'INVALID_SKILL_NAME', 'Tên kỹ năng không được để trống.');
  const row: PvpHeroRow = {
    id,
    name,
    faction: body.faction,
    is_hot: body.isHot ? 1 : 0,
    style: body.style,
    passive_type: body.passiveType,
    base_hp: body.baseHp,
    base_atk: body.baseAtk,
    base_def: body.baseDef,
    skill_name: skillName,
    skill_description: body.skillDescription ?? '',
    skill: deriveSkill(effects),
    target_type: body.targetType,
    damage_rate: body.damageRate,
    skill_effects: JSON.stringify(effects),
    updated_at: iso(ctx.now()),
  };
  updateHeroRow(ctx.db, row);
  reloadPvpConfig();
  return heroToDto(row);
}

/**
 * Xoá cấu hình Tướng trong DB. Tướng thuộc roster game sẽ quay về bảng cứng trong code
 * (tức trở lại đúng cấu hình gốc của SKILLS.md), tướng thêm tay thì biến mất khỏi danh sách.
 */
export function adminDeletePvpHero(ctx: GameContext, id: string): { ok: true } {
  const changes = deleteHeroRow(ctx.db, id);
  if (!changes) throw new AppError(404, 'HERO_NOT_FOUND', 'Không tìm thấy tướng PvP.');
  reloadPvpConfig();
  return { ok: true as const };
}

/** Bảng cấu hình Ngọc Ngũ Hành hiện tại (5 hệ × 2 chỉ số × Cấp 1/Cấp 10). */
export function adminListPvpGems(ctx: GameContext): PvpGemsAdminDto {
  return { items: listGemRows(ctx.db).map(gemToDto) };
}

/** Đọc cột `levels` đã lưu; thiếu/hỏng thì nội suy từ 2 mốc để không mất dữ liệu. */
function existingLevels(row: PvpGemRow): [number, number][] {
  try {
    const parsed: unknown = JSON.parse(row.levels);
    if (Array.isArray(parsed) && parsed.length) return parsed as [number, number][];
  } catch {
    // Nội suy bên dưới.
  }
  const s1 = interpolateGemLevels(row.stat1_min, row.stat1_max);
  const s2 = interpolateGemLevels(row.stat2_min, row.stat2_max);
  return s1.map((v, i) => [v, s2[i]!] as [number, number]);
}

/**
 * Cập nhật 2 chỉ số của một hệ Ngọc theo 2 mốc Cấp 1 / Cấp 10.
 *
 * Chỉ số nào KHÔNG bị đổi mốc (hoặc đổi loại) thì giữ nguyên đường cong giữa các cấp đang lưu;
 * chỉ số nào bị đổi mốc thì nội suy tuyến tính lại Cấp 1 → Cấp 10 theo giá trị mới.
 */
export function adminUpdatePvpGem(ctx: GameContext, body: PvpGemAdminDto): PvpGemAdminDto {
  const existing = findGemRow(ctx.db, body.element);
  if (!existing) throw new AppError(404, 'GEM_NOT_FOUND', `Không có cấu hình Ngọc hệ ${body.element}.`);
  if (body.stat1Min > body.stat1Max || body.stat2Min > body.stat2Max) {
    throw new AppError(400, 'INVALID_RANGE', 'Giá trị Cấp 1 không được lớn hơn Cấp 10.');
  }
  const old = existingLevels(existing);
  const column = (i: 0 | 1, typeChanged: boolean, min: number, max: number): number[] =>
    typeChanged || existing[`stat${i + 1}_min` as 'stat1_min'] !== min || existing[`stat${i + 1}_max` as 'stat1_max'] !== max
      ? interpolateGemLevels(min, max)
      : old.map((p) => p[i]);
  const c1 = column(0, existing.stat1_type !== body.stat1Type, body.stat1Min, body.stat1Max);
  const c2 = column(1, existing.stat2_type !== body.stat2Type, body.stat2Min, body.stat2Max);
  const row: PvpGemRow = {
    element: body.element,
    stat1_type: body.stat1Type,
    stat1_min: body.stat1Min,
    stat1_max: body.stat1Max,
    stat2_type: body.stat2Type,
    stat2_min: body.stat2Min,
    stat2_max: body.stat2Max,
    levels: JSON.stringify(c1.map((v, i) => [v, c2[i]!])),
    updated_at: iso(ctx.now()),
  };
  upsertGemRow(ctx.db, row);
  reloadPvpConfig();
  return gemToDto(row);
}
