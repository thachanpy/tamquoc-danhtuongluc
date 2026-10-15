import type { Faction, TicketType } from '@tq/shared';
import type { DB } from '../db.ts';

/**
 * Truy vấn phục vụ nhiệm vụ/thành tựu: reward_claims, login_days, daily_state
 * và các số liệu tổng hợp từ lịch sử (gacha_history, upgrade_history, user_cards).
 */

export function listClaimedKeys(db: DB, userId: number, like: string): string[] {
  return (
    db.prepare('SELECT reward_key FROM reward_claims WHERE user_id = ? AND reward_key LIKE ?').all(userId, like) as {
      reward_key: string;
    }[]
  ).map((r) => r.reward_key);
}

export function insertClaim(db: DB, userId: number, key: string, auto: boolean, nowIso: string): void {
  db.prepare('INSERT INTO reward_claims (user_id, reward_key, auto, created_at) VALUES (?,?,?,?)').run(
    userId,
    key,
    auto ? 1 : 0,
    nowIso,
  );
}

export function hasClaim(db: DB, userId: number, key: string): boolean {
  return !!db.prepare('SELECT 1 FROM reward_claims WHERE user_id = ? AND reward_key = ?').get(userId, key);
}

/** Ghi claim tự động, bỏ qua nếu đã có; trả về số dòng đổi được. */
export function insertClaimIgnoring(db: DB, userId: number, key: string, nowIso: string): number {
  return Number(
    db
      .prepare('INSERT OR IGNORE INTO reward_claims (user_id, reward_key, auto, created_at) VALUES (?,?,1,?)')
      .run(userId, key, nowIso).changes,
  );
}

export function insertLoginDayIgnoring(db: DB, userId: number, kind: string, day: string, nowIso: string): void {
  db.prepare(`INSERT OR IGNORE INTO login_days (user_id, kind, day, created_at) VALUES (?, ?, ?, ?)`).run(
    userId,
    kind,
    day,
    nowIso,
  );
}

export function hasLoginDay(db: DB, userId: number, kind: string, day: string): boolean {
  return !!db.prepare(`SELECT 1 FROM login_days WHERE user_id = ? AND kind = ? AND day = ?`).get(userId, kind, day);
}

export function listLoginDays(db: DB, userId: number, like: string): string[] {
  return (
    db.prepare(`SELECT day FROM login_days WHERE user_id = ? AND kind = 'calendar' AND day LIKE ?`).all(userId, like) as {
      day: string;
    }[]
  ).map((r) => r.day);
}

/** Các ngày điểm danh cũ (trước mốc `beforeIso`) chưa được nhận thưởng. */
export function listUnclaimedOldCalendarDates(db: DB, userId: number, beforeIso: string): string[] {
  return (
    db
      .prepare(
        `SELECT l.day FROM login_days l WHERE l.user_id = ? AND l.kind = 'calendar' AND l.day < ?
           AND NOT EXISTS (SELECT 1 FROM reward_claims c WHERE c.user_id = l.user_id AND c.reward_key = 'login:' || l.day)`,
      )
      .all(userId, beforeIso) as { day: string }[]
  ).map((r) => r.day);
}

export function countDrawsByTicketType(
  db: DB,
  userId: number,
  startIso: string,
  endIso: string,
): { t: TicketType; n: number }[] {
  return db
    .prepare(
      'SELECT ticket_type AS t, COUNT(*) AS n FROM gacha_history WHERE user_id = ? AND created_at >= ? AND created_at < ? GROUP BY ticket_type',
    )
    .all(userId, startIso, endIso) as { t: TicketType; n: number }[];
}

export function countDrawsByFaction(db: DB, userId: number, startIso: string, endIso: string): { f: Faction; n: number }[] {
  return db
    .prepare(
      `SELECT g.faction AS f, COUNT(*) AS n FROM gacha_history h JOIN generals g ON g.id = h.general_id
        WHERE h.user_id = ? AND h.created_at >= ? AND h.created_at < ? GROUP BY g.faction`,
    )
    .all(userId, startIso, endIso) as { f: Faction; n: number }[];
}

export function countUpgradeSuccess(db: DB, userId: number, startIso: string, endIso: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM upgrade_history WHERE user_id = ? AND outcome = 'success' AND created_at >= ? AND created_at < ?`,
      )
      .get(userId, startIso, endIso) as { n: number }
  ).n;
}

export function countTotalDraws(db: DB, userId: number): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM gacha_history WHERE user_id = ?').get(userId) as { n: number }).n;
}

/** Thẻ nhận từ giftcode thẻ cũ (trước khi giftcode chỉ tặng vé). */
export function sumLegacyGiftCodeCards(db: DB, userId: number): number {
  return (
    db.prepare('SELECT COALESCE(SUM(card_count), 0) AS n FROM gift_code_redemptions WHERE user_id = ?').get(userId) as {
      n: number;
    }
  ).n;
}

/** Tướng khác nhau đã thu thập (chiêu mộ + giftcode thẻ cũ), gộp theo phe. */
export function countCollectedByFaction(db: DB, userId: number): { f: Faction; n: number }[] {
  return db
    .prepare(
      `SELECT g.faction AS f, COUNT(*) AS n FROM generals g WHERE g.id IN (
         SELECT general_id FROM gacha_history WHERE user_id = ?
         UNION
         SELECT json_extract(j.value, '$.generalId') FROM gift_code_redemptions r, json_each(r.cards_snapshot) j WHERE r.user_id = ?
       ) GROUP BY g.faction`,
    )
    .all(userId, userId) as { f: Faction; n: number }[];
}

export function countOwnedByLevel(db: DB, userId: number): { level: number; n: number }[] {
  return db
    .prepare(`SELECT level, COUNT(*) AS n FROM user_cards WHERE user_id = ? AND status = 'active' GROUP BY level`)
    .all(userId) as { level: number; n: number }[];
}

export function findDailyState(db: DB, userId: number): { last_game_day: string; last_cal_date: string } | undefined {
  return db.prepare('SELECT last_game_day, last_cal_date FROM daily_state WHERE user_id = ?').get(userId) as
    | { last_game_day: string; last_cal_date: string }
    | undefined;
}

export function upsertDailyState(db: DB, userId: number, day: string, today: string, nowIso: string): void {
  db.prepare(
    `INSERT INTO daily_state (user_id, last_game_day, last_cal_date, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET last_game_day = excluded.last_game_day, last_cal_date = excluded.last_cal_date, updated_at = excluded.updated_at`,
  ).run(userId, day, today, nowIso);
}
