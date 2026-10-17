import {
  BPS_SCALE,
  PVP_BACK_DAMAGE_BPS,
  PVP_CRIT_BPS_PER_LEVEL,
  PVP_DEF_PEN_BPS,
  PVP_FRONT_HP_BPS,
  PVP_LANES,
  PVP_MAX_ROUNDS,
  PVP_NO_GEM_STATS,
  PVP_PASSIVE_EFFECT,
  PVP_SHIELD_BREAK_REMOVE_BPS,
  PVP_TEAM_GEM_COUNT,
  PVP_TEAM_SIZE,
  autoTeamGemElements,
  pvpCleanseBps,
  pvpCounterChanceBps,
  pvpCritDamageBps,
  pvpDispelBps,
  pvpDodgeBps,
  pvpHeroBaseDamage,
  pvpHeroBaseHp,
  pvpHeroDefArmor,
  pvpHitBps,
  pvpGemTeamStats,
  pvpLc,
  pvpPerLevelEffectBps,
  pvpPreBattleBonus,
  pvpProfile,
  pvpPurifyBps,
  pvpReviveHpBps,
  pvpShieldBreakChanceBps,
  pvpSkillDefAtLevel,
  pvpStyleBonus,
  pvpTeamLc,
  pvpUnitLc,
  ROSTER,
  type PvpProfile,
  type PvpRow,
} from '@tq/game-config';
import {
  GEM_ELEMENTS,
  type GemElement,
  type Page,
  type PvpBattleDto,
  type PvpBattleSummaryDto,
  type PvpCombatDto,
  type PvpEventDto,
  type PvpFighterDto,
  type PvpGemStats,
  type PvpOpponentDto,
  type PvpOutcome,
  type PvpOverviewDto,
  type PvpSide,
  type PvpSkill,
  type PvpStyle,
  type PvpTeamDto,
  type PvpTeamGemDto,
  type PvpUnitDto,
  type PvpUnitStateDto,
  type PvpWinner,
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
import { listActiveGems, listTeamGemElements, replaceTeamGems } from '../repositories/gem.repository.ts';
import { tx } from '../db.ts';
import { simulatePvp, type PvpSideInput } from './pvp.engine.ts';

/**
 * Đấu trường PvP (mục 6.7 — PVP.md). Server mô phỏng trọn trận rồi trả dữ liệu phát lại.
 * Người chơi khiêu chiến một người khác trong bảng xếp hạng; không có phần thưởng, chỉ ghi thắng/thua.
 *
 * Đội hình: người chơi tự lưu (pvp_teams). Chưa lưu thì server tự xếp 6 tướng mạnh nhất (theo Lực chiến/level).
 */

/** Tổng Lực chiến (LC) của một đội hình: cộng LC từng tướng ở cấp đang xét (mục 6.6/6.7). */
const teamLc = (units: PvpUnitDto[], gem: PvpGemStats) => pvpTeamLc(units, gem);

const ROSTER_IDS = new Set(ROSTER.map((g) => g.id));

/** Ngọc đang sở hữu của người chơi dạng (loại, cấp) — để giải cấp cao nhất cho mỗi loại gắn vào đội. */
const ownedGemPairs = (ctx: GameContext, userId: number) =>
  listActiveGems(ctx.db, userId).map((g) => ({ element: g.element, level: g.level }));

/**
 * Giải danh sách LOẠI Ngọc đã gắn thành các viên cụ thể: mỗi loại lấy viên CẤP CAO NHẤT đang sở hữu
 * (loại không còn viên nào thì bỏ). Thứ tự hiển thị theo bảng Ngũ Hành (Kim → Mộc → Thủy → Hỏa → Thổ).
 */
export function resolveTeamGems(elements: GemElement[], owned: { element: GemElement; level: number }[]): PvpTeamGemDto[] {
  const best = new Map<GemElement, number>();
  for (const g of owned) best.set(g.element, Math.max(best.get(g.element) ?? 0, g.level));
  return GEM_ELEMENTS.filter((e) => elements.includes(e)).flatMap((e) => {
    const level = best.get(e);
    return level ? [{ element: e, level }] : [];
  });
}

/** Đội hình + LOẠI Ngọc đang lưu của người chơi (chưa xác thực lại quyền sở hữu). */
function readSaved(ctx: GameContext, userId: number): { units: PvpUnitDto[]; gemElements: GemElement[] } {
  return {
    units: (listTeam(ctx.db, userId) as PvpTeamRow[]).map((r) => ({
      slot: r.slot,
      generalId: r.general_id,
      level: r.level,
      lc: pvpUnitLc(r.general_id, r.level),
    })),
    gemElements: listTeamGemElements(ctx.db, userId),
  };
}

/**
 * Đội hình tự động: lấy tướng mạnh nhất của mỗi tướng (level cao nhất đang sở hữu),
 * sắp theo Lực chiến (LC) giảm dần rồi xếp vào slot 1–6. Mỗi tướng chỉ xuất hiện một lần.
 */
function autoTeam(ctx: GameContext, userId: number, gem: PvpGemStats): PvpUnitDto[] {
  const best = new Map<string, number>();
  for (const p of listOwnedPairs(ctx.db, userId)) {
    const cur = best.get(p.general_id);
    if (cur === undefined || p.level > cur) best.set(p.general_id, p.level);
  }
  return [...best.entries()]
    .map(([generalId, level]) => ({ generalId, level, lc: pvpUnitLc(generalId, level, gem) }))
    .sort((a, b) => b.lc - a.lc || b.level - a.level || a.generalId.localeCompare(b.generalId))
    .slice(0, PVP_TEAM_SIZE)
    .map((u, i) => ({ slot: i + 1, generalId: u.generalId, level: u.level, lc: u.lc }));
}

/**
 * Đội hình dùng khi ra trận: đội đã lưu (đã lọc slot không còn sở hữu) hoặc đội tự động.
 * Ngọc gắn kèm: đội đã lưu dùng LOẠI đã chọn, đội tự động tự chọn loại có viên cấp cao nhất;
 * cấp mỗi loại luôn lấy viên cao nhất đang sở hữu. saved = true khi đội đã lưu còn hiệu lực.
 */
function effectiveTeam(
  ctx: GameContext,
  userId: number,
): { units: PvpUnitDto[]; gems: PvpTeamGemDto[]; gem: PvpGemStats; saved: boolean } {
  const owned = ownedGemPairs(ctx, userId);
  const saved = readSaved(ctx, userId);
  if (saved.units.length) {
    const has = new Set(listOwnedPairs(ctx.db, userId).map((p) => `${p.general_id}|${p.level}`));
    const valid = saved.units.filter((u) => has.has(`${u.generalId}|${u.level}`));
    if (valid.length) {
      const gems = resolveTeamGems(saved.gemElements, owned);
      const gem = pvpGemTeamStats(gems);
      return { units: valid.map((u) => ({ ...u, lc: pvpUnitLc(u.generalId, u.level, gem) })), gems, gem, saved: true };
    }
  }
  const gems = resolveTeamGems(autoTeamGemElements(owned), owned);
  const gem = pvpGemTeamStats(gems);
  return { units: autoTeam(ctx, userId, gem), gems, gem, saved: false };
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
  const { units, gems, gem, saved } = effectiveTeam(ctx, userId);
  const record = getRecord(ctx.db, userId);
  return {
    me: toFighter(user),
    team: { units, gems, lc: teamLc(units, gem) },
    saved,
    wins: record.wins,
    losses: record.losses,
    draws: record.draws,
    maxRounds: PVP_MAX_ROUNDS,
    ownedCombat: ownedCombatOf(ctx, userId),
  };
}

/**
 * Chỉ số Ngọc cộng toàn đội của người chơi theo danh sách LOẠI đã gắn — dùng cho màn chuẩn bị khiêu chiến
 * (`/api/pvp/generals/:id/combat?gems=...`) để Chỉ số Nền Ra Trận hiển thị khớp khi vào trận.
 */
export function ownedGemStats(ctx: GameContext, userId: number, elements: GemElement[]): PvpGemStats {
  return pvpGemTeamStats(resolveTeamGems(elements, ownedGemPairs(ctx, userId)));
}

/** Phong cách chiến đấu của mọi tướng trong roster — đọc cấu hình ĐANG hiệu lực (Admin sửa là đổi ngay). */
const rosterMapOf = <T>(pick: (p: PvpProfile) => T): Record<string, T> =>
  Object.fromEntries(ROSTER.map((g) => [g.id, pick(pvpProfile(g.id))]));
export const rosterStyles = (): Record<string, PvpStyle> => rosterMapOf((p) => p.style);

/** Kỹ năng của mọi tướng trong roster (ổn định theo id) — client hiện kỹ năng khi chọn tướng vào đội. */
export const rosterSkills = (): Record<string, PvpSkill> => rosterMapOf((p) => p.skill);

/** Tên kỹ năng thật của mọi tướng (theo SKILLS.md) — client hiện tên chiêu thay cho nhãn chung. */
export const rosterSkillNames = (): Record<string, string> => rosterMapOf((p) => p.skillName);

/**
 * Chi tiết chiến đấu của một tướng ở một cấp (mục 6.7) — modal xem thẻ ở Bộ sưu tập.
 * Khi truyền `squad` (danh sách generalId trong đội, theo ĐÚNG thứ tự vị trí), trả thêm Chỉ số Nền Ra Trận
 * (mục 1): vị trí đội hình + aura Hỗ trợ + Cổng Đồng Phe cộng vào cọc Máu/Sát thương — màn chuẩn bị khiêu chiến.
 */
export function getCombatStats(generalId: string, level: number, squad?: string[], gem: PvpGemStats = PVP_NO_GEM_STATS): PvpCombatDto {
  if (!ROSTER_IDS.has(generalId)) throw new AppError(404, 'GENERAL_NOT_FOUND', 'Không tìm thấy tướng.');
  const profile = pvpProfile(generalId);
  // Hệ số kỹ năng TẠI CẤP hiện tại: mọi hiệu ứng (buff/hồi/debuff/…) đã quy theo cấp — khớp engine.
  const def = pvpSkillDefAtLevel(profile.def, level);
  const passive = PVP_PASSIVE_EFFECT[profile.passive];
  const baseHp = pvpHeroBaseHp(profile, level);
  const baseDamage = pvpHeroBaseDamage(profile, level);
  // Chỉ số của riêng tướng: chỉ áp nội tại (mục 10.1). Buff theo hàng và buff đồng minh phát
  // mỗi lượt KHÔNG cộng sẵn ở đây — chỉ số đó do engine áp khi vào trận.
  const hpBps = passive.stat === 'maxHp' ? passive.bps : 0;
  const damageBps = passive.stat === 'damage' ? passive.bps : 0;
  const maxHp = Math.round(baseHp * (1 + hpBps / BPS_SCALE));
  const damage = Math.round(baseDamage * (1 + damageBps / BPS_SCALE));
  const critBps = pvpPerLevelEffectBps(PVP_CRIT_BPS_PER_LEVEL, level) + (passive.stat === 'crit' ? passive.pointsBps : 0);
  // Hồi máu ĐỒNG MINH mỗi lần thi triển (theo damage). Tự hồi máu theo HP tối đa (`selfHealBps`)
  // KHÔNG gộp vào đây: đây là lượng hồi theo PHẠM VI kỹ năng nên gộp sẽ khiến UI hiển thị nhầm
  // "hồi máu cho toàn bộ đồng minh" (ví dụ Vu Cấm). Tự hồi máu có dòng riêng "Tự hồi máu".
  const heal = def.healBps > 0 ? Math.round((damage * def.healBps) / BPS_SCALE) : 0;
  // Chỉ số cộng thêm theo phong cách của CHÍNH tướng (mục 1): Tấn công +8% ST, Phòng thủ +8% HP,
  // Hỗ trợ là aura +2% HP & +2% ST — ở đây tính 1 lớp của chính tướng; khi vào trận cộng dồn theo đội.
  const styleBonus = pvpStyleBonus(profile.style, profile.style === 'support' ? 1 : 0);
  // Chỉ số Nền Ra Trận (mục 1): chỉ tính khi biết đội — đếm số lớp aura Hỗ trợ và số tướng CÙNG PHE.
  const preBattle = squad?.length ? buildPreBattle(generalId, squad, profile.style, baseHp, baseDamage, hpBps, damageBps, gem) : null;
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
      // Lực chiến của riêng tướng: có Ngọc trong ngữ cảnh đội thì tính luôn phần Ngọc (mục 6.8) —
      // khớp LC từng slot mà server trả cho đội hình và bảng xếp hạng.
      lc: pvpLc(profile.style, level, profile.passive, gem),
      critBps,
      // ST chí mạng theo cấp — buff/debuff kỹ năng điều chỉnh quanh mốc này khi vào trận.
      critDamageBps: pvpCritDamageBps(level),
      stunBps: pvpPerLevelEffectBps(def.stunPerLevelBps, level),
      // Giải choáng khớp engine: mặc định chốt 75% ở cấp 10 (Hoa Đà ghi đè 55% → 100%).
      cleanseBps: pvpCleanseBps(def, level),
      // Thanh tẩy khớp engine: gỡ MỖI lớp suy yếu theo tỉ lệ cấp × 7.5% (cấp 10 = 75%).
      purifyBps: pvpPurifyBps(def, level),
      heal,
      // Hút máu ở cấp hiện tại (khớp engine): chốt ở cấp 10, quy theo cấp.
      lifestealBps: pvpPerLevelEffectBps(profile.lifestealPerLevelBps, level),
      // Hút máu ĐỘI ở cấp hiện tại: hồi cả bản thân lẫn mọi đồng minh theo % tổng sát thương gây ra.
      teamLifestealBps: pvpPerLevelEffectBps(profile.teamLifestealPerLevelBps, level),
      // Bộ chỉ số Trao đổi đòn (mục 18): Chính xác/Né tránh scale theo cấp; buff/debuff cộng trừ thêm trong trận.
      hitBps: pvpHitBps(level),
      dodgeBps: pvpDodgeBps(level),
      defArmor: pvpHeroDefArmor(profile, level) + (passive.stat === 'def' ? passive.armor : 0),
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
      // Xóa buff địch khớp engine: tỉ lệ cấp × 7.5% (cấp 10 = 75%), roll riêng mỗi mục tiêu (mục 14).
      dispelBps: pvpDispelBps(def, level),
      buffs: def.buffs,
      // Tỉ lệ bẻ gãy Khiên TẠI CẤP (span 20% → 80%) để UI in ra con số thật thay vì khoảng cấp.
      debuff: {
        ...def.debuff,
        shieldBreakBps: def.debuff.shieldBreakPerLevelBps > 0 ? pvpShieldBreakChanceBps(level) : 0,
        shieldBreakRemoveBps: def.debuff.shieldBreakPerLevelBps > 0 ? PVP_SHIELD_BREAK_REMOVE_BPS : 0,
      },
      // Tỉ lệ phản kích TẠI CẤP đã kẹp trần — khớp engine (`tryCounter`).
      counter: { ...def.counter, chanceBps: pvpCounterChanceBps(def.counter.perLevelBps, level) },
      // Nội tại "Né thành công → phản ứng" (Triệu Vân phản kích / Mã Siêu tích lũy) — khớp engine.
      dodgeReact: def.dodgeReact,
      // Ngưỡng HP "chắc chắn trúng" của Hoàng Trung — khớp engine (`hits`).
      guaranteedHitBelowHpBps: def.guaranteedHitBelowHpBps ?? 0,
      revive: def.revive,
      // Hồi sinh hồi lại cấp × 5% HP tối đa (trần 100%) — khớp engine (`fell`).
      reviveHpBps: def.revive ? pvpReviveHpBps(level) : 0,
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
  gem: PvpGemStats,
): NonNullable<PvpCombatDto['preBattle']> {
  // Phe lấy từ hồ sơ ĐANG hiệu lực (DB) — không đọc bảng cứng để Admin đổi Phe là áp dụng ngay.
  const faction = pvpProfile(generalId).faction;
  // Cổng Đồng Phe chỉ buff tướng CÙNG PHE: đếm số tướng trong đội có cùng faction với tướng này.
  const factionCount = squad.reduce((n, id) => n + (pvpProfile(id).faction === faction ? 1 : 0), 0);
  // Aura Hỗ trợ: mỗi tướng Hỗ trợ trong đội là một lớp (trần 6 lớp).
  const supportLayers = squad.reduce((n, id) => n + (pvpProfile(id).style === 'support' ? 1 : 0), 0);
  // Vị trí đội hình: slot 1-3 hàng trước (+5% Máu), slot 4-6 hàng sau (+5% Sát thương).
  const slot = squad.indexOf(generalId);
  const row: PvpRow = slot >= PVP_LANES ? 'back' : 'front';
  const bonus = pvpPreBattleBonus(style, supportLayers, factionCount, row);
  const hpBps = passiveHpBps + bonus.hpBps + gem.hpBps;
  const damageBps = passiveDamageBps + bonus.damageBps + gem.damageBps;
  return {
    maxHp: Math.round(baseHp * (1 + hpBps / BPS_SCALE)),
    damage: Math.round(baseDamage * (1 + damageBps / BPS_SCALE)),
    // `hpBps`/`damageBps` trong bonus là TỔNG (vị trí + phong cách + cổng đồng phe + Ngọc) — khớp mô tả DTO.
    bonus: { factionCount, supportLayers, ...bonus, gem, hpBps: bonus.hpBps + gem.hpBps, damageBps: bonus.damageBps + gem.damageBps },
  };
}

/**
 * Chuẩn hoá danh sách LOẠI Ngọc gắn vào đội: bỏ trùng, giữ thứ tự Ngũ Hành, tối đa `PVP_TEAM_GEM_COUNT` loại.
 * Loại không còn viên nào đang sở hữu (do đã ghép tiêu hao) bị bỏ qua — đội vẫn lưu bình thường.
 */
function normalizeGemElements(elements: GemElement[], owned: { element: GemElement; level: number }[]): GemElement[] {
  for (const e of elements) if (!GEM_ELEMENTS.includes(e)) throw new AppError(400, 'INVALID_GEM', 'Ngọc không hợp lệ.');
  const has = new Set(owned.map((g) => g.element));
  const unique = GEM_ELEMENTS.filter((e) => elements.includes(e) && has.has(e));
  if (unique.length > PVP_TEAM_GEM_COUNT) {
    throw new AppError(400, 'TOO_MANY_GEMS', `Đội hình chỉ được gắn tối đa ${PVP_TEAM_GEM_COUNT} Ngọc khác loại.`);
  }
  return unique;
}

/** Lưu đội hình: mỗi slot một tướng, không trùng tướng, và phải đang sở hữu đúng cấp đó. */
export function saveTeam(ctx: GameContext, userId: number, units: PvpUnitDto[], gemElements: GemElement[] = []): PvpTeamDto {
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
  const pairs = ownedGemPairs(ctx, userId);
  const elements = normalizeGemElements(gemElements, pairs);
  const now = iso(ctx.now());
  tx(ctx.db, () => {
    replaceTeam(
      ctx.db,
      userId,
      units.map((u) => ({ slot: u.slot, general_id: u.generalId, level: u.level })),
      now,
    );
    replaceTeamGems(ctx.db, userId, elements, now);
  });
  const gems = resolveTeamGems(elements, pairs);
  const gem = pvpGemTeamStats(gems);
  const sorted = [...units]
    .sort((a, b) => a.slot - b.slot)
    .map((u) => ({ ...u, lc: pvpUnitLc(u.generalId, u.level, gem) }));
  return { units: sorted, gems, lc: teamLc(sorted, gem) };
}

export function getOpponent(ctx: GameContext, userId: number, opponentId: number): PvpOpponentDto {
  const opponent = requireOpponent(ctx, userId, opponentId);
  const { units, gems, gem, saved } = effectiveTeam(ctx, opponentId);
  return { opponent: toFighter(opponent), team: { units, gems, lc: teamLc(units, gem) }, saved };
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
    { side: 'a', units: mine.units, gems: mine.gems },
    { side: 'b', units: theirs.units, gems: theirs.gems },
  ];
  const sim = simulatePvp(sides, ctx.rand);

  const myLc = teamLc(mine.units, mine.gem);
  const oppLc = teamLc(theirs.units, theirs.gem);
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
        attackerLc: myLc,
        defenderLc: oppLc,
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
      myLc: role === 'attack' ? row.attacker_lc : row.defender_lc,
      opponentLc: role === 'attack' ? row.defender_lc : row.attacker_lc,
    };
  });
  return { items, page, pageSize, total };
}

export function getBattle(ctx: GameContext, userId: number, id: number): PvpBattleDto {
  const row = findBattle(ctx.db, id, userId);
  if (!row) throw new AppError(404, 'BATTLE_NOT_FOUND', 'Không tìm thấy trận đấu.');
  return toBattleDto(row, userId);
}
