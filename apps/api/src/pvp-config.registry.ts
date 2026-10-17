import {
  PVP_GEM_ELEMENTS,
  heroConfigToProfile,
  pvpGemTable,
  setPvpGemTableOverride,
  setPvpProfileOverride,
  type PvpGemRowTable,
  type PvpProfile,
} from '@tq/game-config';
import { MAX_LEVEL, type GemElement, type PvpGemStats, type PvpSkillEffectDto } from '@tq/shared';
import type { DB } from './db.ts';
import { listGemRows, listHeroRows, type PvpHeroRow, type PvpGemRow } from './repositories/pvp-config.repository.ts';

/**
 * Registry cấu hình PvP (Tướng & Ngọc Ngũ Hành) — SINGLETON trong tiến trình API.
 *
 * Vì sao cần: engine mô phỏng (`pvp.engine.ts`) và mọi chỗ tính Lực chiến gọi `pvpProfile()` /
 * `pvpGemStats()` hàng nghìn lần mỗi trận, không thể truy vấn SQLite mỗi lần. Registry nạp DB MỘT LẦN
 * vào memory cache lúc khởi động, rồi cài vào `@tq/game-config` qua provider override:
 * - `setPvpProfileOverride`: hồ sơ tướng theo DB (rơi về bảng cứng nếu tướng chưa có trong DB).
 * - `setPvpGemTableOverride`: bảng chỉ số Ngọc 10 cấp theo DB.
 *
 * Nhờ vậy Admin sửa cấu hình ⇒ gọi `reload()` ⇒ cache và engine đổi NGAY, không cần restart server.
 */

/** Nội suy tuyến tính giá trị chỉ số Ngọc từ Cấp 1 → Cấp 10 (chỉ dùng khi DB thiếu bảng giá trị đầy đủ). */
export function interpolateGemLevels(min: number, max: number): number[] {
  return Array.from({ length: MAX_LEVEL }, (_, i) => Math.round(min + ((max - min) * i) / (MAX_LEVEL - 1)));
}

/** Đọc JSON `pvp_gems.levels`; dữ liệu hỏng/thiếu ⇒ nội suy tuyến tính từ 2 mốc Cấp 1/Cấp 10 của dòng. */
function parseGemLevels(row: PvpGemRow): [number, number][] {
  try {
    const parsed: unknown = JSON.parse(row.levels);
    if (Array.isArray(parsed) && parsed.length === MAX_LEVEL) {
      const pairs = parsed.filter((p): p is [number, number] => Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number'));
      if (pairs.length === MAX_LEVEL) return pairs;
    }
  } catch {
    // Rơi xuống nội suy bên dưới.
  }
  const s1 = interpolateGemLevels(row.stat1_min, row.stat1_max);
  const s2 = interpolateGemLevels(row.stat2_min, row.stat2_max);
  return s1.map((v, i) => [v, s2[i]!] as [number, number]);
}

/** Dựng bảng chỉ số Ngọc cho engine từ các dòng DB (hệ nào chưa có dòng thì giữ bảng cứng trong code). */
function buildGemTable(rows: PvpGemRow[]): PvpGemRowTable {
  const fallback = pvpGemTable();
  const out = {} as PvpGemRowTable;
  const byElement = new Map<GemElement, PvpGemRow>(rows.map((r) => [r.element, r]));
  for (const element of PVP_GEM_ELEMENTS) {
    const row = byElement.get(element);
    if (!row) {
      out[element] = fallback[element];
      continue;
    }
    out[element] = {
      stats: [row.stat1_type as keyof PvpGemStats, row.stat2_type as keyof PvpGemStats],
      levels: parseGemLevels(row),
    };
  }
  return out;
}

/** Một dòng `pvp_heroes` → hồ sơ chiến đấu cho engine (hiệu ứng JSON được dựng lại thành `PvpSkillDef`). */
export function heroRowToProfile(row: PvpHeroRow): PvpProfile {
  let effects: PvpSkillEffectDto[] = [];
  try {
    const parsed: unknown = JSON.parse(row.skill_effects);
    if (Array.isArray(parsed)) effects = parsed as PvpSkillEffectDto[];
  } catch {
    effects = [];
  }
  return heroConfigToProfile({
    id: row.id,
    name: row.name,
    faction: row.faction,
    isHot: row.is_hot === 1,
    style: row.style,
    passive: row.passive_type,
    baseHp: row.base_hp,
    baseAtk: row.base_atk,
    baseDef: row.base_def,
    skill: row.skill,
    skillName: row.skill_name,
    skillDescription: row.skill_description,
    targetType: row.target_type,
    damageRate: row.damage_rate,
    effects,
  });
}

export class PvpConfigRegistry {
  private readonly db: DB;
  private heroes = new Map<string, PvpProfile>();
  private gems: PvpGemRowTable = pvpGemTable();
  private loadedAt = 0;

  constructor(db: DB) {
    this.db = db;
    this.reload();
  }

  /** Đọc lại toàn bộ cấu hình từ DB và ghi đè memory cache + provider của game-config. */
  reload(): void {
    const heroRows = listHeroRows(this.db);
    this.heroes = new Map(heroRows.map((r) => [r.id, heroRowToProfile(r)]));
    this.gems = buildGemTable(listGemRows(this.db));
    this.loadedAt = Date.now();
    // Tướng chưa có trong DB ⇒ trả undefined để `pvpProfile()` rơi về bảng cứng của game-config.
    setPvpProfileOverride((id) => this.heroes.get(id));
    setPvpGemTableOverride(this.gems);
  }

  /** Thời điểm nạp cache gần nhất (epoch ms) — dùng để hiển thị ở trang Quản trị. */
  get updatedAt(): number {
    return this.loadedAt;
  }

  /** Số tướng đang có cấu hình trong DB. */
  get heroCount(): number {
    return this.heroes.size;
  }
}

let active: PvpConfigRegistry | undefined;

/** Cài registry cho tiến trình hiện tại (gọi ngay sau khi mở/migrate/seed database). */
export function installPvpConfigRegistry(db: DB): PvpConfigRegistry {
  active = new PvpConfigRegistry(db);
  return active;
}

/** Registry đang hiệu lực. */
export function pvpConfigRegistry(): PvpConfigRegistry {
  if (!active) throw new Error('PvpConfigRegistry chưa được cài — gọi installPvpConfigRegistry(db) trước');
  return active;
}

/** Nạp lại cache sau khi Admin Update/Create/Delete cấu hình (không cần restart server). */
export function reloadPvpConfig(): void {
  active?.reload();
}
