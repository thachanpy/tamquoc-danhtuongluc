import type { GemElement } from '@tq/shared';
import type { DB } from '../db.ts';

/**
 * Truy vấn dữ liệu Bảng xếp hạng Lực chiến (mục 6.6).
 * Bảng xếp hạng xếp theo TỔNG LC của ĐỘI HÌNH (mỗi tướng × cấp) — không còn theo số thẻ / cấp thẻ.
 * LC được tính ở manager bằng cấu hình tướng, nên repository chỉ trả về dữ liệu đội hình thô:
 *  - đội hình đã lưu & còn hợp lệ (mọi slot vẫn sở hữu đúng cấp);
 *  - cặp (tướng, cấp) tốt nhất của người CHƯA có đội hợp lệ — dùng dựng đội tự động.
 */

export interface EligibleUserRow {
  id: number;
  username: string;
  display_name: string | null;
  avatar: string | null;
}

/** Một slot đội hình đã lưu và còn hợp lệ. */
export interface TeamUnitRow {
  user_id: number;
  slot: number;
  general_id: string;
  level: number;
}

/** Cặp (tướng, cấp cao nhất đang sở hữu) — nguyên liệu dựng đội tự động. */
export interface BestPairRow {
  user_id: number;
  general_id: string;
  level: number;
}

/** Người chơi đủ điều kiện xếp hạng: đã duyệt và không phải admin. */
export function listEligibleUsers(db: DB): EligibleUserRow[] {
  return db
    .prepare('SELECT id, username, display_name, avatar FROM users WHERE status = ? AND is_admin = 0')
    .all('approved') as unknown as EligibleUserRow[];
}

/**
 * Mọi slot đội hình đã lưu CÒN HỢP LỆ của người chơi đủ điều kiện (vẫn sở hữu đúng tướng ở đúng cấp).
 * Slot đã mất thẻ (do ghép) tự động bị bỏ qua — khớp `effectiveTeam` ở pvp.manager.
 */
export function listValidTeams(db: DB): TeamUnitRow[] {
  return db
    .prepare(
      `SELECT t.user_id, t.slot, t.general_id, t.level
         FROM pvp_teams t
         JOIN users u ON u.id = t.user_id AND u.status = 'approved' AND u.is_admin = 0
        WHERE EXISTS (SELECT 1 FROM user_cards c
                       WHERE c.user_id = t.user_id AND c.general_id = t.general_id
                         AND c.level = t.level AND c.status = 'active')`,
    )
    .all() as unknown as TeamUnitRow[];
}

/**
 * Cặp (tướng, cấp cao nhất) của người chơi KHÔNG có slot đội hình hợp lệ nào — dùng dựng đội tự động.
 * Mỗi tướng chỉ lấy cấp cao nhất đang sở hữu (thẻ đã tiêu thụ không tính).
 */
export function listBestPairsForAutoTeams(db: DB): BestPairRow[] {
  return db
    .prepare(
      `SELECT c.user_id, c.general_id, MAX(c.level) AS level
         FROM user_cards c
         JOIN users u ON u.id = c.user_id AND u.status = 'approved' AND u.is_admin = 0
        WHERE c.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM pvp_teams t
                           WHERE t.user_id = c.user_id
                             AND EXISTS (SELECT 1 FROM user_cards c2
                                          WHERE c2.user_id = t.user_id AND c2.general_id = t.general_id
                                            AND c2.level = t.level AND c2.status = 'active'))
        GROUP BY c.user_id, c.general_id`,
    )
    .all() as unknown as BestPairRow[];
}

/** Một loại Ngọc đã gắn cho đội đã lưu của người chơi. */
export interface TeamGemRow {
  user_id: number;
  element: GemElement;
}

/** Cặp (loại Ngọc, cấp cao nhất đang sở hữu) — nguyên liệu chọn Ngọc cho đội tự động. */
export interface OwnedGemRow {
  user_id: number;
  element: GemElement;
  level: number;
}

/** Mọi loại Ngọc đã gắn của người chơi đủ điều kiện (đọc cùng `listValidTeams` khi tính LC đội đã lưu). */
export function listTeamGemElements(db: DB): TeamGemRow[] {
  return db
    .prepare(
      `SELECT g.user_id, g.element
         FROM pvp_team_gems g
         JOIN users u ON u.id = g.user_id AND u.status = 'approved' AND u.is_admin = 0`,
    )
    .all() as unknown as TeamGemRow[];
}

/** Loại Ngọc (kèm cấp cao nhất) mỗi người chơi đang sở hữu — khớp `autoTeamGemElements` ở pvp.manager. */
export function listOwnedGems(db: DB): OwnedGemRow[] {
  return db
    .prepare(
      `SELECT g.user_id, g.element, MAX(g.level) AS level
         FROM user_gems g
         JOIN users u ON u.id = g.user_id AND u.status = 'approved' AND u.is_admin = 0
        WHERE g.status = 'active'
        GROUP BY g.user_id, g.element`,
    )
    .all() as unknown as OwnedGemRow[];
}
