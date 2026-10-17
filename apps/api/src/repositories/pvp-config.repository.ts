import type {
  Faction,
  GemElement,
  PvpPassive,
  PvpSkill,
  PvpStyle,
  PvpTargeting,
} from '@tq/shared';
import type { DB } from '../db.ts';

/**
 * Truy vấn bảng CẤU HÌNH PvP chỉnh trên trang Quản trị: `pvp_heroes` (hồ sơ chiến đấu từng tướng)
 * và `pvp_gems` (bảng chỉ số Ngọc Ngũ Hành theo Cấp 1 → Cấp 10). Đây là nguồn dữ liệu cho
 * `PvpConfigRegistry` — đọc vào memory cache để engine PvP không phải truy vấn DB mỗi trận.
 */
export interface PvpHeroRow {
  id: string;
  name: string;
  faction: Faction;
  is_hot: number;
  style: PvpStyle;
  passive_type: PvpPassive;
  base_hp: number;
  base_atk: number;
  base_def: number;
  skill_name: string;
  skill_description: string;
  skill: PvpSkill;
  target_type: PvpTargeting;
  damage_rate: number;
  skill_effects: string;
  updated_at: string;
}

export interface PvpGemRow {
  element: GemElement;
  stat1_type: string;
  stat1_min: number;
  stat1_max: number;
  stat2_type: string;
  stat2_min: number;
  stat2_max: number;
  /** Bảng giá trị đầy đủ 10 cấp dạng JSON `[[chỉ số 1, chỉ số 2] × 10]`. */
  levels: string;
  updated_at: string;
}

const HERO_COLS = `id, name, faction, is_hot, style, passive_type, base_hp, base_atk, base_def,
  skill_name, skill_description, skill, target_type, damage_rate, skill_effects, updated_at`;

export function listHeroRows(db: DB): PvpHeroRow[] {
  return db.prepare(`SELECT ${HERO_COLS} FROM pvp_heroes ORDER BY faction, name`).all() as unknown as PvpHeroRow[];
}

export function findHeroRow(db: DB, id: string): PvpHeroRow | undefined {
  return db.prepare(`SELECT ${HERO_COLS} FROM pvp_heroes WHERE id = ?`).get(id) as unknown as PvpHeroRow | undefined;
}

export function insertHeroRow(db: DB, r: PvpHeroRow): void {
  db.prepare(`
    INSERT INTO pvp_heroes (${HERO_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    r.id,
    r.name,
    r.faction,
    r.is_hot,
    r.style,
    r.passive_type,
    r.base_hp,
    r.base_atk,
    r.base_def,
    r.skill_name,
    r.skill_description,
    r.skill,
    r.target_type,
    r.damage_rate,
    r.skill_effects,
    r.updated_at,
  );
}

export function updateHeroRow(db: DB, r: PvpHeroRow): number {
  return Number(
    db.prepare(`
      UPDATE pvp_heroes SET name=?, faction=?, is_hot=?, style=?, passive_type=?, base_hp=?, base_atk=?, base_def=?,
        skill_name=?, skill_description=?, skill=?, target_type=?, damage_rate=?, skill_effects=?, updated_at=?
      WHERE id=?
    `).run(
      r.name,
      r.faction,
      r.is_hot,
      r.style,
      r.passive_type,
      r.base_hp,
      r.base_atk,
      r.base_def,
      r.skill_name,
      r.skill_description,
      r.skill,
      r.target_type,
      r.damage_rate,
      r.skill_effects,
      r.updated_at,
      r.id,
    ).changes,
  );
}

export function deleteHeroRow(db: DB, id: string): number {
  return Number(db.prepare('DELETE FROM pvp_heroes WHERE id = ?').run(id).changes);
}

const GEM_COLS = 'element, stat1_type, stat1_min, stat1_max, stat2_type, stat2_min, stat2_max, levels, updated_at';

export function listGemRows(db: DB): PvpGemRow[] {
  return db.prepare(`SELECT ${GEM_COLS} FROM pvp_gems`).all() as unknown as PvpGemRow[];
}

export function findGemRow(db: DB, element: GemElement): PvpGemRow | undefined {
  return db.prepare(`SELECT ${GEM_COLS} FROM pvp_gems WHERE element = ?`).get(element) as unknown as PvpGemRow | undefined;
}

export function upsertGemRow(db: DB, r: PvpGemRow): void {
  db.prepare(`
    INSERT INTO pvp_gems (element, stat1_type, stat1_min, stat1_max, stat2_type, stat2_min, stat2_max, levels, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(element) DO UPDATE SET
      stat1_type=excluded.stat1_type, stat1_min=excluded.stat1_min, stat1_max=excluded.stat1_max,
      stat2_type=excluded.stat2_type, stat2_min=excluded.stat2_min, stat2_max=excluded.stat2_max,
      levels=excluded.levels, updated_at=excluded.updated_at
  `).run(r.element, r.stat1_type, r.stat1_min, r.stat1_max, r.stat2_type, r.stat2_min, r.stat2_max, r.levels, r.updated_at);
}
