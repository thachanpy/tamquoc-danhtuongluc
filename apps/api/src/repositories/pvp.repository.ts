import { deflateSync, inflateSync } from 'node:zlib';
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
  attackerLc: number;
  defenderLc: number;
  data: string;
}

/**
 * Ghi dữ liệu phát lại đã NÉN (deflate) thay vì JSON thuần: một trận 6v6 ~190KB JSON chỉ còn
 * ~12KB trên đĩa (giảm ~94%), tránh `pvp_battles` phình theo số trận. Cột `data` lưu BLOB;
 * bản ghi cũ (TEXT JSON) vẫn đọc được nhờ `decodeBattleData`.
 */
export function insertBattle(db: DB, b: PvpBattleInsert, nowIso: string): number {
  const r = db
    .prepare(
      `INSERT INTO pvp_battles (attacker_id, defender_id, winner, rounds, attacker_lc, defender_lc, data, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(b.attackerId, b.defenderId, b.winner, b.rounds, b.attackerLc, b.defenderLc, deflateSync(b.data), nowIso);
  return Number(r.lastInsertRowid);
}

/** Cột `data` đọc từ DB: TEXT (bản ghi cũ) hoặc BLOB nén (bản ghi mới). */
type BattleData = string | Uint8Array;

function decodeBattleData(raw: BattleData): string {
  return typeof raw === 'string' ? raw : inflateSync(raw).toString('utf8');
}

export interface PvpBattleRow {
  id: number;
  attacker_id: number;
  defender_id: number;
  winner: string;
  rounds: number;
  attacker_lc: number;
  defender_lc: number;
  data: string;
  created_at: string;
  attacker_username: string;
  attacker_display_name: string | null;
  attacker_avatar: string | null;
  defender_username: string;
  defender_display_name: string | null;
  defender_avatar: string | null;
}

/** Dòng nhật ký (không kèm `data`): trang lịch sử chỉ cần phần tóm tắt nên bỏ qua blob phát lại. */
export type PvpBattleSummaryRow = Omit<PvpBattleRow, 'data'>;

const BATTLE_COLUMNS = `b.id, b.attacker_id, b.defender_id, b.winner, b.rounds, b.attacker_lc, b.defender_lc, b.created_at,
         ua.username AS attacker_username, ua.display_name AS attacker_display_name, ua.avatar AS attacker_avatar,
         ud.username AS defender_username, ud.display_name AS defender_display_name, ud.avatar AS defender_avatar`;
const BATTLE_FROM = `FROM pvp_battles b
    JOIN users ua ON ua.id = b.attacker_id
    JOIN users ud ON ud.id = b.defender_id`;

/** Nhật ký trận của người chơi (cả khi khiêu chiến lẫn khi bị khiêu chiến), mới nhất trước. */
export function listBattles(db: DB, userId: number, limit: number, offset: number): { rows: PvpBattleSummaryRow[]; total: number } {
  const where = 'WHERE b.attacker_id = ? OR b.defender_id = ?';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM pvp_battles b ${where}`).get(userId, userId) as { n: number }).n;
  const rows = db
    .prepare(`SELECT ${BATTLE_COLUMNS} ${BATTLE_FROM} ${where} ORDER BY b.id DESC LIMIT ? OFFSET ?`)
    .all(userId, userId, limit, offset) as unknown as PvpBattleSummaryRow[];
  return { rows, total };
}

/** Một trận theo id; chỉ trả khi người gọi là một trong hai bên. `data` được giải nén về JSON. */
export function findBattle(db: DB, id: number, userId: number): PvpBattleRow | undefined {
  const row = db
    .prepare(`SELECT ${BATTLE_COLUMNS}, b.data ${BATTLE_FROM} WHERE b.id = ? AND (b.attacker_id = ? OR b.defender_id = ?)`)
    .get(id, userId, userId) as unknown as (Omit<PvpBattleRow, 'data'> & { data: BattleData }) | undefined;
  return row ? { ...row, data: decodeBattleData(row.data) } : undefined;
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
