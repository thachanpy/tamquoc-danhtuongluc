import type { DatabaseSync } from 'node:sqlite';
import { ROSTER } from '@tq/game-config';

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
