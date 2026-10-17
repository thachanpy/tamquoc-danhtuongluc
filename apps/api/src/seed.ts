import type { DatabaseSync } from 'node:sqlite';
import { PVP_GEM_ELEMENTS, ROSTER, pvpGemTable, pvpProfile, skillDefToEffects } from '@tq/game-config';

/**
 * Seed roster vào bảng generals. Chạy lặp an toàn: upsert theo ID ổn định,
 * chỉ cập nhật metadata hiển thị, không đụng dữ liệu người chơi.
 * Tướng đã bị bỏ khỏi roster chỉ bị xóa nếu không còn thẻ/lịch sử nào tham chiếu
 * (nếu còn thì giữ lại để không phá dữ liệu; tướng đó không còn nằm trong pool quay).
 */
export function seedGenerals(db: DatabaseSync): void {
  const stmt = db.prepare(`
    INSERT INTO generals (id, name, faction, art_key) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, faction = excluded.faction, art_key = excluded.art_key
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const g of ROSTER) stmt.run(g.id, g.name, g.faction, g.artKey);
    const ids = ROSTER.map((g) => g.id);
    db.prepare(`
      DELETE FROM generals
      WHERE id NOT IN (${ids.map(() => '?').join(',')})
        AND NOT EXISTS (SELECT 1 FROM user_cards c WHERE c.general_id = generals.id)
        AND NOT EXISTS (SELECT 1 FROM gacha_history h WHERE h.general_id = generals.id)
        AND NOT EXISTS (SELECT 1 FROM upgrade_history u WHERE u.input_general_id = generals.id)
    `).run(...ids);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * Seed cấu hình PvP (bảng `pvp_heroes` + `pvp_gems`) từ bảng CỨNG trong `@tq/game-config`
 * (SKILLS.md: `PVP_ROSTER_ROWS`/`PVP_SKILL_DEF` và `GEM_TABLE`). Nhờ đọc thẳng config nên
 * dữ liệu khởi tạo trong DB khớp 100% với game hiện tại, không phải nhập tay.
 *
 * Dùng `INSERT OR IGNORE`: chỉ ĐIỀN CHỖ TRỐNG. Cấu hình Admin đã sửa (hoặc Tướng thêm mới)
 * không bị ghi đè mỗi lần khởi động server; tướng mới bổ sung vào roster vẫn được nạp thêm.
 */
export function seedPvpConfig(db: DatabaseSync): void {
  const heroStmt = db.prepare(`
    INSERT OR IGNORE INTO pvp_heroes (id, name, faction, is_hot, style, passive_type, base_hp, base_atk, base_def,
      skill_name, skill_description, skill, target_type, damage_rate, skill_effects, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const gemStmt = db.prepare(`
    INSERT OR IGNORE INTO pvp_gems (element, stat1_type, stat1_min, stat1_max, stat2_type, stat2_min, stat2_max, levels, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const nowIso = new Date().toISOString();
  const gems = pvpGemTable();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const g of ROSTER) {
      const p = pvpProfile(g.id);
      heroStmt.run(
        g.id,
        g.name,
        p.faction,
        p.hot ? 1 : 0,
        p.style,
        p.passive,
        p.baseHp,
        p.baseAtk,
        p.baseDef,
        p.skillName,
        p.skillDescription,
        p.skill,
        p.def.targeting,
        p.def.damageBps,
        JSON.stringify(skillDefToEffects(p.def, p)),
        nowIso,
      );
    }
    for (const element of PVP_GEM_ELEMENTS) {
      const { stats, levels } = gems[element];
      const first = levels[0]!;
      const last = levels[levels.length - 1]!;
      gemStmt.run(
        element,
        stats[0],
        first[0],
        last[0],
        stats[1],
        first[1],
        last[1],
        JSON.stringify(levels.map(([a, b]) => [a, b])),
        nowIso,
      );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
