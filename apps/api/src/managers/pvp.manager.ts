import {
  BPS_SCALE,
  GENERALS_BY_ID,
  LEADERBOARD_POWER_BY_LEVEL,
  PVP_BACK_DAMAGE_BPS,
  PVP_CLEANSE_CHAMP_BPS,
  PVP_CRIT_BPS_PER_LEVEL,
  PVP_DEF_BPS,
  PVP_DEF_PEN_BPS,
  PVP_FRONT_HP_BPS,
  PVP_LANES,
  PVP_MAX_ROUNDS,
  PVP_PASSIVE_EFFECT,
  PVP_TEAM_SIZE,
  pvpBaseDamage,
  pvpBaseHp,
  pvpCritDamageBps,
  pvpDodgeBps,
  pvpEffectBps,
  pvpHitBps,
  pvpLc,
  pvpPerLevelEffectBps,
  pvpPreBattleBonus,
  pvpProfile,
  pvpSkillDefAtLevel,
  pvpStyleBonus,
  ROSTER,
  type PvpRow,
} from '@tq/game-config';
import type {
  Page,
  PvpBattleDto,
  PvpBattleSummaryDto,
  PvpCombatDto,
  PvpEventDto,
  PvpFighterDto,
  PvpOpponentDto,
  PvpOutcome,
  PvpOverviewDto,
  PvpSide,
  PvpSkill,
  PvpStyle,
  PvpTeamDto,
  PvpUnitDto,
  PvpUnitStateDto,
  PvpWinner,
} from '@tq/shared';
import { AppError, type GameContext } from '../context.ts';
import { iso } from '../utils.ts';
import { findUserRow, type UserRow } from '../repositories/user.repository.ts';
import {
  findBattle,
  getRecord,
  insertBattle,
  listBattles,
  listOwnedPairs,
  listTeam,
  replaceTeam,
  type PvpBattleRow,
  type PvpTeamRow,
} from '../repositories/pvp.repository.ts';
import { tx } from '../db.ts';
import { simulatePvp, type PvpSideInput } from './pvp.engine.ts';

/**
 * Đấu trường PvP (mục 6.7 — PVP.md). Server mô phỏng trọn trận rồi trả dữ liệu phát lại.
 * Người chơi khiêu chiến một người khác trong bảng xếp hạng; không có phần thưởng, chỉ ghi thắng/thua.
 *
 * Đội hình: người chơi tự lưu (pvp_teams). Chưa lưu thì server tự xếp 6 tướng mạnh nhất (theo Lực chiến/level).
 */

const powerOfLevel = (level: number) => LEADERBOARD_POWER_BY_LEVEL[level] ?? 0;
const teamPower = (units: PvpUnitDto[]) => units.reduce((s, u) => s + powerOfLevel(u.level), 0);

const ROSTER_IDS = new Set(ROSTER.map((g) => g.id));

/** Đội hình đang lưu của người chơi (chưa xác thực lại quyền sở hữu). */
function readSaved(db: GameContext['db'], userId: number): PvpUnitDto[] {
  return (listTeam(db, userId) as PvpTeamRow[]).map((r) => ({ slot: r.slot, generalId: r.general_id, level: r.level }));
}

/**
 * Đội hình tự động: lấy tướng mạnh nhất của mỗi tướng (level cao nhất đang sở hữu),
 * sắp theo Lực chiến giảm dần rồi xếp vào slot 1–6. Mỗi tướng chỉ xuất hiện một lần.
 */
function autoTeam(ctx: GameContext, userId: number): PvpUnitDto[] {
  const best = new Map<string, number>();
  for (const p of listOwnedPairs(ctx.db, userId)) {
    const cur = best.get(p.general_id);
    if (cur === undefined || p.level > cur) best.set(p.general_id, p.level);
  }
  return [...best.entries()]
    .map(([generalId, level]) => ({ generalId, level, power: powerOfLevel(level) }))
    .sort((a, b) => b.power - a.power || b.level - a.level || a.generalId.localeCompare(b.generalId))
    .slice(0, PVP_TEAM_SIZE)
    .map((u, i) => ({ slot: i + 1, generalId: u.generalId, level: u.level }));
}

/**
 * Đội hình dùng khi ra trận: đội đã lưu (đã lọc slot không còn sở hữu) hoặc đội tự động.
 * saved = true khi đội đã lưu còn hiệu lực.
 */
function effectiveTeam(ctx: GameContext, userId: number): { units: PvpUnitDto[]; saved: boolean } {
  const saved = readSaved(ctx.db, userId);
  if (saved.length) {
    const owned = new Set(listOwnedPairs(ctx.db, userId).map((p) => `${p.general_id}|${p.level}`));
    const valid = saved.filter((u) => owned.has(`${u.generalId}|${u.level}`));
    if (valid.length) return { units: valid, saved: true };
  }
  return { units: autoTeam(ctx, userId), saved: false };
}

const toFighter = (u: UserRow): PvpFighterDto => ({
  id: u.id,
  displayName: u.display_name ?? u.username,
  avatar: u.avatar,
});

const mySideOf = (row: PvpBattleRow, userId: number): PvpSide => (row.attacker_id === userId ? 'a' : 'b');
const outcomeOf = (winner: PvpWinner, side: PvpSide): PvpOutcome =>
  winner === 'draw' ? 'draw' : winner === side ? 'win' : 'loss';

interface StoredBattle {
  units: PvpUnitStateDto[];
  events: PvpEventDto[];
}

function toBattleDto(row: PvpBattleRow, userId: number): PvpBattleDto {
  const data = JSON.parse(row.data) as StoredBattle;
  const side = mySideOf(row, userId);
  const winner = row.winner as PvpWinner;
  return {
    id: row.id,
    createdAt: row.created_at,
    attacker: {
      id: row.attacker_id,
      displayName: row.attacker_display_name ?? row.attacker_username,
      avatar: row.attacker_avatar,
    },
    defender: {
      id: row.defender_id,
      displayName: row.defender_display_name ?? row.defender_username,
      avatar: row.defender_avatar,
    },
    mySide: side,
    winner,
    result: outcomeOf(winner, side),
    rounds: row.rounds,
    units: data.units,
    events: data.events,
  };
}

// ===== API cho controller =====

/**
 * Chi tiết chiến đấu của từng tướng người chơi ĐANG SỞ HỮU, ở cấp cao nhất của tướng đó.
 * Bảng chọn tướng dùng dữ liệu này để hiện kỹ năng chi tiết mà không phải gọi thêm API.
 */
function ownedCombatOf(ctx: GameContext, userId: number): Record<string, PvpCombatDto> {
  const best = new Map<string, number>();
  for (const p of listOwnedPairs(ctx.db, userId)) {
    const cur = best.get(p.general_id);
    if (cur === undefined || p.level > cur) best.set(p.general_id, p.level);
  }
  return Object.fromEntries([...best].map(([generalId, level]) => [generalId, getCombatStats(generalId, level)]));
}

export function getOverview(ctx: GameContext, userId: number): PvpOverviewDto {
  const user = findUserRow(ctx.db, userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy người chơi.');
  const { units, saved } = effectiveTeam(ctx, userId);
  const record = getRecord(ctx.db, userId);
  return {
    me: toFighter(user),
    team: { units, power: teamPower(units) },
    saved,
    wins: record.wins,
    losses: record.losses,
    draws: record.draws,
    maxRounds: PVP_MAX_ROUNDS,
    powerByLevel: { ...LEADERBOARD_POWER_BY_LEVEL },
    ownedCombat: ownedCombatOf(ctx, userId),
  };
}

/** Phong cách chiến đấu của mọi tướng trong roster (ổn định theo id) — client hiện nhãn trên mọi thẻ tướng. */
const ROSTER_STYLES: Record<string, PvpStyle> = Object.fromEntries(ROSTER.map((g) => [g.id, pvpProfile(g.id).style]));
export const rosterStyles = (): Record<string, PvpStyle> => ROSTER_STYLES;

/** Kỹ năng của mọi tướng trong roster (ổn định theo id) — client hiện kỹ năng khi chọn tướng vào đội. */
const ROSTER_SKILLS: Record<string, PvpSkill> = Object.fromEntries(ROSTER.map((g) => [g.id, pvpProfile(g.id).skill]));
export const rosterSkills = (): Record<string, PvpSkill> => ROSTER_SKILLS;

/** Tên kỹ năng thật của mọi tướng (theo SKILLS.md) — client hiện tên chiêu thay cho nhãn chung. */
const ROSTER_SKILL_NAMES: Record<string, string> = Object.fromEntries(ROSTER.map((g) => [g.id, pvpProfile(g.id).skillName]));
export const rosterSkillNames = (): Record<string, string> => ROSTER_SKILL_NAMES;

/**
 * Chi tiết chiến đấu của một tướng ở một cấp (mục 6.7) — modal xem thẻ ở Bộ sưu tập.
 * Khi truyền `squad` (danh sách generalId trong đội, theo ĐÚNG thứ tự vị trí), trả thêm Chỉ số Nền Ra Trận
 * (mục 1): vị trí đội hình + aura Hỗ trợ + Cổng Đồng Phe cộng vào cọc Máu/Sát thương — màn chuẩn bị khiêu chiến.
 */
export function getCombatStats(generalId: string, level: number, squad?: string[]): PvpCombatDto {
  if (!ROSTER_IDS.has(generalId)) throw new AppError(404, 'GENERAL_NOT_FOUND', 'Không tìm thấy tướng.');
  const profile = pvpProfile(generalId);
  // Hệ số kỹ năng TẠI CẤP hiện tại: mọi hiệu ứng (buff/hồi/debuff/…) đã quy theo cấp — khớp engine.
  const def = pvpSkillDefAtLevel(profile.def, level);
  const passive = PVP_PASSIVE_EFFECT[profile.passive];
  const baseHp = pvpBaseHp(level);
  const baseDamage = pvpBaseDamage(level);
  // Chỉ số của riêng tướng: chỉ áp nội tại (mục 10.1). Buff theo hàng và buff đồng minh phát
  // mỗi lượt KHÔNG cộng sẵn ở đây — chỉ số đó do engine áp khi vào trận.
  const hpBps = passive.stat === 'maxHp' ? passive.bps : 0;
  const damageBps = passive.stat === 'damage' ? passive.bps : 0;
  const maxHp = Math.round(baseHp * (1 + hpBps / BPS_SCALE));
  const damage = Math.round(baseDamage * (1 + damageBps / BPS_SCALE));
  const critBps = pvpPerLevelEffectBps(PVP_CRIT_BPS_PER_LEVEL, level) + (passive.stat === 'crit' ? passive.pointsBps : 0);
  // Hồi máu mỗi lần thi triển: hồi đồng minh theo damage, tự hồi theo HP tối đa (hai loại loại trừ nhau).
  const heal =
    (def.healBps > 0 ? Math.round((damage * def.healBps) / BPS_SCALE) : 0) +
    (def.selfHealBps > 0 ? Math.round((maxHp * def.selfHealBps) / BPS_SCALE) : 0);
  // Chỉ số cộng thêm theo phong cách của CHÍNH tướng (mục 1): Tấn công +8% ST, Phòng thủ +8% HP,
  // Hỗ trợ là aura +2% HP & +2% ST — ở đây tính 1 lớp của chính tướng; khi vào trận cộng dồn theo đội.
  const styleBonus = pvpStyleBonus(profile.style, profile.style === 'support' ? 1 : 0);
  // Chỉ số Nền Ra Trận (mục 1): chỉ tính khi biết đội — đếm số lớp aura Hỗ trợ và số tướng CÙNG PHE.
  const preBattle = squad?.length ? buildPreBattle(generalId, squad, profile.style, baseHp, baseDamage, hpBps, damageBps) : null;
  return {
    generalId,
    level,
    style: profile.style,
    skill: profile.skill,
    skillName: profile.skillName,
    passive: profile.passive,
    base: { maxHp: baseHp, damage: baseDamage },
    self: {
      maxHp,
      damage,
      lc: pvpLc(profile.style, level),
      critBps,
      // ST chí mạng theo cấp — buff/debuff kỹ năng điều chỉnh quanh mốc này khi vào trận.
      critDamageBps: pvpCritDamageBps(level),
      stunBps: pvpPerLevelEffectBps(def.stunPerLevelBps, level) + (passive.stat === 'stun' ? passive.pointsBps : 0),
      // Giải choáng khớp engine: chốt 75% ở cấp 10, quy theo cấp (cấp 1 = 65%).
      cleanseBps: def.cleanse ? pvpEffectBps(PVP_CLEANSE_CHAMP_BPS, level) : 0,
      heal,
      // Hút máu ở cấp hiện tại (khớp engine): chốt ở cấp 10, quy theo cấp.
      lifestealBps: pvpPerLevelEffectBps(profile.lifestealPerLevelBps, level),
      // Bộ chỉ số Trao đổi đòn (mục 18): Chính xác/Né tránh scale theo cấp; buff/debuff cộng trừ thêm trong trận.
      hitBps: pvpHitBps(level),
      dodgeBps: pvpDodgeBps(level),
      defBps: PVP_DEF_BPS,
      defPenBps: PVP_DEF_PEN_BPS,
    },
    passiveEffect: { ...passive },
    // Hệ số kỹ năng ở đây là của riêng tướng (đã nhân hot) — khớp với engine khi vào trận.
    skillDef: {
      skill: profile.skill,
      targeting: def.targeting,
      damageBps: def.damageBps,
      healBps: def.healBps,
      selfHealBps: def.selfHealBps,
      stun: def.stun,
      stunPerLevelBps: def.stunPerLevelBps,
      cleanse: def.cleanse,
      purify: def.purify,
      dispel: def.dispel,
      dispelChanceBps: def.dispelChanceBps,
      buffs: def.buffs,
      debuff: def.debuff,
      counter: def.counter,
      revive: def.revive,
      vsDebuffBonusBps: def.vsDebuffBonusBps,
      selfBurn: def.selfBurn,
      selfBurnRounds: def.selfBurnRounds,
      burnCritMulBps: def.burnCritMulBps,
      burnLifesteal: def.burnLifesteal,
      burnCritDamageBps: def.burnCritDamageBps,
    },
    // Các kênh buff tăng sức mạnh kỹ năng phát mỗi lượt; rỗng = kỹ năng không buff.
    buffs: def.buffs,
    styleBonus,
    rowBonus: { frontHpBps: PVP_FRONT_HP_BPS, backDamageBps: PVP_BACK_DAMAGE_BPS },
    bpsScale: BPS_SCALE,
    preBattle,
  };
}

/**
 * Chỉ số Nền Ra Trận của một tướng trong ngữ cảnh đội (mục 1): HP/ST đã cộng toàn bộ % nền
 * (nội tại + vị trí đội hình + phong cách + cổng đồng phe). `hpBps`/`damageBps` truyền vào là phần nội tại.
 * `squad` là danh sách generalId theo ĐÚNG thứ tự vị trí (index + 1 = slot) nên suy ra được hàng của tướng.
 */
function buildPreBattle(
  generalId: string,
  squad: string[],
  style: PvpStyle,
  baseHp: number,
  baseDamage: number,
  passiveHpBps: number,
  passiveDamageBps: number,
): NonNullable<PvpCombatDto['preBattle']> {
  const faction = GENERALS_BY_ID.get(generalId)?.faction ?? '';
  // Cổng Đồng Phe chỉ buff tướng CÙNG PHE: đếm số tướng trong đội có cùng faction với tướng này.
  const factionCount = squad.reduce((n, id) => n + ((GENERALS_BY_ID.get(id)?.faction ?? '') === faction ? 1 : 0), 0);
  // Aura Hỗ trợ: mỗi tướng Hỗ trợ trong đội là một lớp (trần 6 lớp).
  const supportLayers = squad.reduce((n, id) => n + (ROSTER_STYLES[id] === 'support' ? 1 : 0), 0);
  // Vị trí đội hình: slot 1-3 hàng trước (+5% Máu), slot 4-6 hàng sau (+5% Sát thương).
  const slot = squad.indexOf(generalId);
  const row: PvpRow = slot >= PVP_LANES ? 'back' : 'front';
  const bonus = pvpPreBattleBonus(style, supportLayers, factionCount, row);
  const hpBps = passiveHpBps + bonus.hpBps;
  const damageBps = passiveDamageBps + bonus.damageBps;
  return {
    maxHp: Math.round(baseHp * (1 + hpBps / BPS_SCALE)),
    damage: Math.round(baseDamage * (1 + damageBps / BPS_SCALE)),
    bonus: { factionCount, supportLayers, ...bonus },
  };
}

/** Lưu đội hình: mỗi slot một tướng, không trùng tướng, và phải đang sở hữu đúng cấp đó. */
export function saveTeam(ctx: GameContext, userId: number, units: PvpUnitDto[]): PvpTeamDto {
  if (units.length > PVP_TEAM_SIZE) {
    throw new AppError(400, 'TEAM_TOO_LARGE', `Đội hình tối đa ${PVP_TEAM_SIZE} tướng.`);
  }
  const slots = new Set<number>();
  const generals = new Set<string>();
  for (const u of units) {
    if (u.slot < 1 || u.slot > PVP_TEAM_SIZE) throw new AppError(400, 'INVALID_SLOT', 'Vị trí không hợp lệ.');
    if (slots.has(u.slot)) throw new AppError(400, 'DUPLICATE_SLOT', 'Hai tướng không thể đứng cùng một vị trí.');
    if (generals.has(u.generalId)) throw new AppError(400, 'DUPLICATE_GENERAL', 'Mỗi tướng chỉ được xếp một lần.');
    if (!ROSTER_IDS.has(u.generalId)) throw new AppError(400, 'INVALID_GENERAL', 'Tướng không tồn tại.');
    slots.add(u.slot);
    generals.add(u.generalId);
  }
  const owned = new Set(listOwnedPairs(ctx.db, userId).map((p) => `${p.general_id}|${p.level}`));
  for (const u of units) {
    if (!owned.has(`${u.generalId}|${u.level}`)) {
      throw new AppError(400, 'CARD_NOT_OWNED', 'Bạn không sở hữu thẻ tướng ở cấp này.');
    }
  }
  tx(ctx.db, () =>
    replaceTeam(
      ctx.db,
      userId,
      units.map((u) => ({ slot: u.slot, general_id: u.generalId, level: u.level })),
      iso(ctx.now()),
    ),
  );
  const sorted = [...units].sort((a, b) => a.slot - b.slot);
  return { units: sorted, power: teamPower(sorted) };
}

export function getOpponent(ctx: GameContext, userId: number, opponentId: number): PvpOpponentDto {
  const opponent = requireOpponent(ctx, userId, opponentId);
  const { units, saved } = effectiveTeam(ctx, opponentId);
  return { opponent: toFighter(opponent), team: { units, power: teamPower(units) }, saved };
}

/** Kiểm tra đối thủ hợp lệ: tồn tại, đã duyệt, không phải admin, không phải chính mình. */
function requireOpponent(ctx: GameContext, userId: number, opponentId: number): UserRow {
  if (opponentId === userId) throw new AppError(400, 'SELF_CHALLENGE', 'Không thể tự khiêu chiến chính mình.');
  const opponent = findUserRow(ctx.db, opponentId);
  if (!opponent || opponent.status !== 'approved' || opponent.is_admin === 1) {
    throw new AppError(404, 'OPPONENT_NOT_FOUND', 'Không tìm thấy đối thủ.');
  }
  return opponent;
}

/** Khiêu chiến: mô phỏng trọn trận ở server rồi lưu nhật ký và trả dữ liệu phát lại. */
export function challenge(ctx: GameContext, userId: number, opponentId: number): PvpBattleDto {
  const attacker = findUserRow(ctx.db, userId);
  if (!attacker) throw new AppError(404, 'USER_NOT_FOUND', 'Không tìm thấy người chơi.');
  const defender = requireOpponent(ctx, userId, opponentId);

  const mine = effectiveTeam(ctx, userId);
  if (!mine.units.length) throw new AppError(400, 'TEAM_EMPTY', 'Bạn cần có ít nhất 1 tướng để thi đấu.');
  const theirs = effectiveTeam(ctx, opponentId);
  if (!theirs.units.length) throw new AppError(400, 'OPPONENT_NO_TEAM', 'Đối thủ chưa có tướng nào.');

  const sides: PvpSideInput[] = [
    { side: 'a', units: mine.units },
    { side: 'b', units: theirs.units },
  ];
  const sim = simulatePvp(sides, ctx.rand);

  const myPower = teamPower(mine.units);
  const oppPower = teamPower(theirs.units);
  const stored: StoredBattle = { units: sim.units, events: sim.events };
  const now = iso(ctx.now());
  const id = tx(ctx.db, () =>
    insertBattle(
      ctx.db,
      {
        attackerId: userId,
        defenderId: opponentId,
        winner: sim.winner,
        rounds: sim.rounds,
        attackerPower: myPower,
        defenderPower: oppPower,
        data: JSON.stringify(stored),
      },
      now,
    ),
  );

  return {
    id,
    createdAt: now,
    attacker: toFighter(attacker),
    defender: toFighter(defender),
    mySide: 'a',
    winner: sim.winner,
    result: outcomeOf(sim.winner, 'a'),
    rounds: sim.rounds,
    units: sim.units,
    events: sim.events,
  };
}

export function listBattleHistory(ctx: GameContext, userId: number, page: number, pageSize: number): Page<PvpBattleSummaryDto> {
  const { rows, total } = listBattles(ctx.db, userId, pageSize, (page - 1) * pageSize);
  const items: PvpBattleSummaryDto[] = rows.map((row) => {
    const role = row.attacker_id === userId ? 'attack' : 'defense';
    const winner = row.winner as PvpWinner;
    const side: PvpSide = role === 'attack' ? 'a' : 'b';
    const oppName = role === 'attack' ? row.defender_username : row.attacker_username;
    const oppDisplay = role === 'attack' ? row.defender_display_name : row.attacker_display_name;
    const oppAvatar = role === 'attack' ? row.defender_avatar : row.attacker_avatar;
    return {
      id: row.id,
      createdAt: row.created_at,
      role,
      opponent: {
        id: role === 'attack' ? row.defender_id : row.attacker_id,
        displayName: oppDisplay ?? oppName,
        avatar: oppAvatar,
      },
      winner,
      result: outcomeOf(winner, side),
      rounds: row.rounds,
      myPower: role === 'attack' ? row.attacker_power : row.defender_power,
      opponentPower: role === 'attack' ? row.defender_power : row.attacker_power,
    };
  });
  return { items, page, pageSize, total };
}

export function getBattle(ctx: GameContext, userId: number, id: number): PvpBattleDto {
  const row = findBattle(ctx.db, id, userId);
  if (!row) throw new AppError(404, 'BATTLE_NOT_FOUND', 'Không tìm thấy trận đấu.');
  return toBattleDto(row, userId);
}
