import type { DB } from '../db.ts';

/** Truy vấn đội hình và nhật ký trận PvP (mục 6.7 — PVP.md). */

export interface PvpTeamRow {
  slot: number;
  general_id: string;
  level: number;
}

/** Cặp (tướng, cấp) người chơi đang sở hữu — dùng để xác thực đội hình. */
export interface OwnedPairRow {
  general_id: string;
  level: number;
}

export function listTeam(db: DB, userId: number): PvpTeamRow[] {
  return db
    .prepare('SELECT slot, general_id, level FROM pvp_teams WHERE user_id = ? ORDER BY slot')
    .all(userId) as unknown as PvpTeamRow[];
}

/** Ghi đè toàn bộ đội hình (6 slot). Gọi trong transaction cùng bước xác thực ở manager. */
export function replaceTeam(db: DB, userId: number, units: PvpTeamRow[], nowIso: string): void {
  db.prepare('DELETE FROM pvp_teams WHERE user_id = ?').run(userId);
  const ins = db.prepare('INSERT INTO pvp_teams (user_id, slot, general_id, level, updated_at) VALUES (?,?,?,?,?)');
  for (const u of units) ins.run(userId, u.slot, u.general_id, u.level, nowIso);
}

/** Mọi cặp (tướng, cấp) đang sở hữu (thẻ active) — dùng xác thực đội hình. */
export function listOwnedPairs(db: DB, userId: number): OwnedPairRow[] {
  return db
    .prepare(
      `SELECT DISTINCT general_id, level FROM user_cards
        WHERE user_id = ? AND status = 'active' ORDER BY level DESC, general_id`,
    )
    .all(userId) as unknown as OwnedPairRow[];
}

export interface PvpBattleInsert {
  attackerId: number;
  defenderId: number;
  winner: string;
  rounds: number;
  attackerPower: number;
  defenderPower: number;
  data: string;
}

export function insertBattle(db: DB, b: PvpBattleInsert, nowIso: string): number {
  const r = db
    .prepare(
      `INSERT INTO pvp_battles (attacker_id, defender_id, winner, rounds, attacker_power, defender_power, data, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(b.attackerId, b.defenderId, b.winner, b.rounds, b.attackerPower, b.defenderPower, b.data, nowIso);
  return Number(r.lastInsertRowid);
}

export interface PvpBattleRow {
  id: number;
  attacker_id: number;
  defender_id: number;
  winner: string;
  rounds: number;
  attacker_power: number;
  defender_power: number;
  data: string;
  created_at: string;
  attacker_username: string;
  attacker_display_name: string | null;
  attacker_avatar: string | null;
  defender_username: string;
  defender_display_name: string | null;
  defender_avatar: string | null;
}

const BATTLE_SELECT = `SELECT b.id, b.attacker_id, b.defender_id, b.winner, b.rounds, b.attacker_power, b.defender_power,
         b.data, b.created_at,
         ua.username AS attacker_username, ua.display_name AS attacker_display_name, ua.avatar AS attacker_avatar,
         ud.username AS defender_username, ud.display_name AS defender_display_name, ud.avatar AS defender_avatar
    FROM pvp_battles b
    JOIN users ua ON ua.id = b.attacker_id
    JOIN users ud ON ud.id = b.defender_id`;

/** Nhật ký trận của người chơi (cả khi khiêu chiến lẫn khi bị khiêu chiến), mới nhất trước. */
export function listBattles(db: DB, userId: number, limit: number, offset: number): { rows: PvpBattleRow[]; total: number } {
  const where = 'WHERE b.attacker_id = ? OR b.defender_id = ?';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM pvp_battles b ${where}`).get(userId, userId) as { n: number }).n;
  const rows = db
    .prepare(`${BATTLE_SELECT} ${where} ORDER BY b.id DESC LIMIT ? OFFSET ?`)
    .all(userId, userId, limit, offset) as unknown as PvpBattleRow[];
  return { rows, total };
}

/** Một trận theo id; chỉ trả khi người gọi là một trong hai bên. */
export function findBattle(db: DB, id: number, userId: number): PvpBattleRow | undefined {
  return db.prepare(`${BATTLE_SELECT} WHERE b.id = ? AND (b.attacker_id = ? OR b.defender_id = ?)`).get(id, userId, userId) as
    | PvpBattleRow
    | undefined;
}

export interface PvpRecord {
  wins: number;
  losses: number;
  draws: number;
}

/** Thành tích Thắng/Thua/Hòa của người chơi theo cả hai vai. */
export function getRecord(db: DB, userId: number): PvpRecord {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN winner = 'draw' THEN 1 ELSE 0 END) AS draws,
         SUM(CASE WHEN (attacker_id = ? AND winner = 'a') OR (defender_id = ? AND winner = 'b') THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN (attacker_id = ? AND winner = 'b') OR (defender_id = ? AND winner = 'a') THEN 1 ELSE 0 END) AS losses
       FROM pvp_battles WHERE attacker_id = ? OR defender_id = ?`,
    )
    .get(userId, userId, userId, userId, userId, userId) as { draws: number | null; wins: number | null; losses: number | null };
  return { wins: row.wins ?? 0, losses: row.losses ?? 0, draws: row.draws ?? 0 };
}
