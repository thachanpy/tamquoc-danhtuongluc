import {
  FACTIONS,
  FACTION_LABELS,
  MAX_LEVEL,
  TICKET_TYPES,
  type AchievementGroupDto,
  type DailyEventsDto,
  type Faction,
  type LoginDayDto,
  type QuestClaimResultDto,
  type QuestItemDto,
  type QuestsDto,
  type TicketBalances,
  type TicketReason,
  type TicketType,
} from '@tq/shared';
import {
  ACH_CARDS_RECEIVED,
  ACH_COLLECT,
  ACH_DRAWS,
  ACH_FACTION_COLLECT,
  ACH_OWN_MAX,
  ACH_PVP_BATTLES,
  ACH_PVP_WINS,
  DAILY_MISSIONS,
  DAILY_RESET_BONUS,
  DAILY_RESET_HOUR,
  FACTION_MISSIONS,
  PVP_DAILY_MISSIONS,
  VN_UTC_OFFSET_MS,
  loginDayReward,
  ownLevelReward,
  type Milestones,
} from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso } from '../utils.ts';
import { tx, type DB } from '../db.ts';
import { applyTicketDelta } from '../repositories/ticket.repository.ts';
import {
  listClaimedKeys,
  insertClaim,
  hasClaim,
  insertClaimIgnoring,
  insertLoginDayIgnoring,
  hasLoginDay,
  listLoginDays,
  listUnclaimedOldCalendarDates,
  countDrawsByTicketType,
  countDrawsByFaction,
  countPvpAttacks,
  countUpgradeSuccess,
  countTotalDraws,
  sumLegacyGiftCodeCards,
  countCollectedByFaction,
  countOwnedByLevel,
  findDailyState,
  upsertDailyState,
} from '../repositories/quest.repository.ts';
import { getTickets } from './ticket.manager.ts';

/**
 * Nhiệm vụ hằng ngày, thưởng reset, điểm danh theo tháng và thành tựu (mục 3.10).
 *
 * - Tiến trình được TÍNH TỪ LỊCH SỬ đã ghi ở server (gacha_history, upgrade_history, login_days, user_cards),
 *   không có bộ đếm riêng để lệch. Thành tựu tính cả lịch sử cũ.
 * - Mỗi phần thưởng có một khoá duy nhất; bảng reward_claims (PK user + khoá) bảo đảm chỉ nhận 1 lần.
 *   Cộng vé + ghi ledger + ghi claim trong cùng transaction.
 * - Ngày game reset lúc 05:00 giờ Việt Nam. Điểm danh theo tháng dùng ngày dương lịch Việt Nam.
 *
 * Khoá phần thưởng:
 *   d:{ngày}:{id}            nhiệm vụ chung       f:{ngày}:{phe}:{id}   nhiệm vụ phe
 *   p:{ngày}:{id}            nhiệm vụ đấu trường  reset:{ngày}          thưởng reset 05:00
 *   login:{YYYY-MM-DD}       điểm danh ngày trong tháng
 *   a:draws:{n} a:collect:{n} a:fcollect:{phe}:{n} a:own:{lv}:{n} a:cards:{n} a:pvp:{n} a:pvpw:{n}   thành tựu
 */

const DAY_MS = 86_400_000;
const RESET_MS = DAILY_RESET_HOUR * 3_600_000;

/** Ngày game (YYYY-MM-DD) chứa thời điểm ms. Ngày game bắt đầu lúc 05:00 giờ Việt Nam. */
export const gameDayOf = (ms: number) => new Date(ms + VN_UTC_OFFSET_MS - RESET_MS).toISOString().slice(0, 10);
/** Thời điểm bắt đầu (epoch ms UTC) của ngày game. */
export const gameDayStart = (day: string) => Date.parse(`${day}T00:00:00Z`) - VN_UTC_OFFSET_MS + RESET_MS;
/** Ngày dương lịch Việt Nam (YYYY-MM-DD). */
export const calendarDateOf = (ms: number) => new Date(ms + VN_UTC_OFFSET_MS).toISOString().slice(0, 10);

interface Grant {
  key: string;
  name: string;
  pool: TicketType;
  count: number;
  reason: TicketReason;
}

const claimedSet = (db: DB, userId: number, like: string): Set<string> => new Set(listClaimedKeys(db, userId, like));

/** Ghi nhận 1 phần thưởng: claim (PK chặn trùng) + cộng vé + ledger. Gọi bên trong transaction. */
function grant(db: DB, userId: number, g: Grant, auto: boolean, nowIso: string): void {
  insertClaim(db, userId, g.key, auto, nowIso);
  applyTicketDelta(db, userId, g.pool, g.count, g.reason, g.key, null, nowIso);
}

const status = (done: boolean, claimed: boolean): QuestItemDto['status'] => (claimed ? 'claimed' : done ? 'claimable' : 'progress');

// ======================= Nhiệm vụ hằng ngày =======================

interface DayMetrics {
  login: boolean;
  draws: number;
  upgradeSuccess: number;
  cardsReceived: number;
  factionDraws: Record<Faction, number>;
  factionCards: Record<Faction, number>;
  /** Số trận đấu trường chủ động khiêu chiến trong ngày. */
  pvpBattles: number;
  /** Số trận thắng trong đó. */
  pvpWins: number;
}

const zeroFactions = (): Record<Faction, number> => ({ wei: 0, shu: 0, wu: 0, qun: 0 });

function dayMetrics(db: DB, userId: number, day: string): DayMetrics {
  const start = iso(gameDayStart(day));
  const end = iso(gameDayStart(day) + DAY_MS);
  const m: DayMetrics = {
    login: hasLoginDay(db, userId, 'game', day),
    draws: 0,
    upgradeSuccess: 0,
    cardsReceived: 0,
    factionDraws: zeroFactions(),
    factionCards: zeroFactions(),
    pvpBattles: 0,
    pvpWins: 0,
  };
  for (const r of countDrawsByTicketType(db, userId, start, end)) {
    m.draws += r.n;
    if (r.t !== 'normal') m.factionDraws[r.t] += r.n;
  }
  // Thẻ nhận trong ngày = thẻ từ chiêu mộ (không tính thẻ tạo ra khi ghép, không tính thẻ được tặng)
  m.cardsReceived = m.draws;
  for (const r of countDrawsByFaction(db, userId, start, end)) m.factionCards[r.f] = r.n;
  m.upgradeSuccess = countUpgradeSuccess(db, userId, start, end);
  // Đấu trường: chỉ tính trận người chơi tự khiêu chiến (không tính lúc bị khiêu chiến)
  const pvp = countPvpAttacks(db, userId, start, end);
  m.pvpBattles = pvp.battles;
  m.pvpWins = pvp.wins;
  return m;
}

function dailyItems(
  m: DayMetrics,
  day: string,
  claimed: Set<string>,
): { general: QuestItemDto[]; faction: Record<Faction, QuestItemDto[]>; pvp: QuestItemDto[] } {
  const value = (metric: string): number =>
    metric === 'login' ? (m.login ? 1 : 0) : metric === 'draws' ? m.draws : metric === 'upgradeSuccess' ? m.upgradeSuccess : m.cardsReceived;
  const base = DAILY_MISSIONS.filter((d) => d.metric !== 'dailyDone').map((d) => ({ d, progress: value(d.metric) }));
  const doneOthers = base.filter((x) => x.progress >= x.d.target).length;
  const general = DAILY_MISSIONS.map((d) => {
    const progress = d.metric === 'dailyDone' ? doneOthers : value(d.metric);
    const key = `d:${day}:${d.id}`;
    return {
      key,
      name: d.name,
      desc: d.desc,
      progress: Math.min(progress, d.target),
      target: d.target,
      reward: { pool: 'normal' as TicketType, count: d.reward },
      status: status(progress >= d.target, claimed.has(key)),
    };
  });
  const faction = {} as Record<Faction, QuestItemDto[]>;
  for (const f of FACTIONS) {
    faction[f] = FACTION_MISSIONS.map((d) => {
      const progress = d.metric === 'factionDraws' ? m.factionDraws[f] : m.factionCards[f];
      const key = `f:${day}:${f}:${d.id}`;
      return {
        key,
        name: `${d.name} ${FACTION_LABELS[f]}`,
        desc: d.desc.replace('{f}', FACTION_LABELS[f]),
        progress: Math.min(progress, d.target),
        target: d.target,
        reward: { pool: f, count: d.reward },
        status: status(progress >= d.target, claimed.has(key)),
      };
    });
  }
  const pvp = PVP_DAILY_MISSIONS.map((d) => {
    const progress = d.metric === 'pvpBattles' ? m.pvpBattles : m.pvpWins;
    const key = `p:${day}:${d.id}`;
    return {
      key,
      name: d.name,
      desc: d.desc,
      progress: Math.min(progress, d.target),
      target: d.target,
      reward: { pool: 'normal' as TicketType, count: d.reward },
      status: status(progress >= d.target, claimed.has(key)),
    };
  });
  return { general, faction, pvp };
}

// ======================= Điểm danh theo tháng =======================

const daysInMonth = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();

function loginView(db: DB, userId: number, today: string, claimed: Set<string>): { month: string; days: LoginDayDto[] } {
  const month = today.slice(0, 7);
  const logged = new Set(listLoginDays(db, userId, `${month}-%`));
  const days: LoginDayDto[] = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    const key = `login:${date}`;
    days.push({
      date,
      day: d,
      reward: loginDayReward(d),
      status: claimed.has(key) ? 'claimed' : logged.has(date) ? 'claimable' : date < today ? 'missed' : 'future',
    });
  }
  return { month, days };
}

// ======================= Thành tựu =======================

function milestoneItems(
  prefix: string,
  label: (n: number) => string,
  ms: Milestones,
  progress: number,
  pool: TicketType,
  claimed: Set<string>,
): QuestItemDto[] {
  return ms.map(([n, r]) => {
    const key = `${prefix}:${n}`;
    return {
      key,
      name: label(n),
      desc: '',
      progress: Math.min(progress, n),
      target: n,
      reward: { pool, count: r },
      status: status(progress >= n, claimed.has(key)),
    };
  });
}

function achievementView(db: DB, userId: number, claimed: Set<string>): AchievementGroupDto[] {
  const draws = countTotalDraws(db, userId);
  // Thẻ nhận từ giftcode thẻ cũ (trước khi giftcode chỉ tặng vé) cũng là thẻ người chơi nhận được
  const legacyCodeCards = sumLegacyGiftCodeCards(db, userId);
  // Tướng khác nhau đã thu thập: từ chiêu mộ + giftcode thẻ cũ (không tính thẻ được người khác tặng)
  const perFaction = zeroFactions();
  for (const r of countCollectedByFaction(db, userId)) perFaction[r.f] = r.n;
  const totalCollected = FACTIONS.reduce((s, f) => s + perFaction[f], 0);
  const owned = new Map(countOwnedByLevel(db, userId).map((r) => [r.level, r.n]));
  // Đấu trường: thành tựu tính toàn bộ lịch sử (chỉ trận người chơi chủ động khiêu chiến)
  const pvpTotal = countPvpAttacks(db, userId, null, null);

  const groups: AchievementGroupDto[] = [
    {
      id: 'draws',
      title: 'Chiêu mộ',
      desc: 'Tổng số lần quay bằng mọi loại vé',
      progress: draws,
      items: milestoneItems('a:draws', (n) => `Chiêu mộ ${n.toLocaleString('vi-VN')} lần`, ACH_DRAWS, draws, 'normal', claimed),
    },
    {
      id: 'collect',
      title: 'Sưu tầm tướng',
      desc: 'Số tướng khác nhau đã thu thập (trên 100)',
      progress: totalCollected,
      items: milestoneItems('a:collect', (n) => `Sưu tầm ${n} tướng`, ACH_COLLECT, totalCollected, 'normal', claimed),
    },
    ...FACTIONS.map((f) => ({
      id: `fcollect-${f}`,
      title: `Sưu tầm phe ${FACTION_LABELS[f]}`,
      desc: `Số tướng ${FACTION_LABELS[f]} khác nhau đã thu thập (trên 25)`,
      progress: perFaction[f],
      items: milestoneItems(`a:fcollect:${f}`, (n) => `Sưu tầm ${n} tướng ${FACTION_LABELS[f]}`, ACH_FACTION_COLLECT, perFaction[f], f, claimed),
    })),
    ...Array.from({ length: MAX_LEVEL }, (_, i) => {
      const lv = i + 1;
      const have = owned.get(lv) ?? 0;
      const ms: [number, number][] = Array.from({ length: ACH_OWN_MAX }, (_, k) => [k + 1, ownLevelReward(lv, k + 1)]);
      return {
        id: `own-${lv}`,
        title: `Sở hữu thẻ Lv.${lv}`,
        desc: `Số thẻ Lv.${lv} đang sở hữu (tính cả thẻ trùng)`,
        progress: have,
        items: milestoneItems(`a:own:${lv}`, (n) => `Sở hữu ${n} thẻ Lv.${lv}`, ms, have, 'normal', claimed),
      };
    }),
    {
      id: 'cards',
      title: 'Tổng số thẻ đã nhận',
      desc: 'Thẻ nhận từ chiêu mộ trong suốt quá trình chơi (tính cả thẻ trùng và thẻ đã ghép)',
      progress: draws + legacyCodeCards,
      items: milestoneItems('a:cards', (n) => `Nhận ${n.toLocaleString('vi-VN')} thẻ`, ACH_CARDS_RECEIVED, draws + legacyCodeCards, 'normal', claimed),
    },
    {
      id: 'pvp-battles',
      title: 'Đấu trường — khiêu chiến',
      desc: 'Tổng số trận bạn chủ động khiêu chiến (không tính lúc bị khiêu chiến)',
      progress: pvpTotal.battles,
      items: milestoneItems('a:pvp', (n) => `Khiêu chiến ${n.toLocaleString('vi-VN')} trận`, ACH_PVP_BATTLES, pvpTotal.battles, 'normal', claimed),
    },
    {
      id: 'pvp-wins',
      title: 'Đấu trường — thắng trận',
      desc: 'Tổng số trận đấu trường bạn đã thắng khi chủ động khiêu chiến',
      progress: pvpTotal.wins,
      items: milestoneItems('a:pvpw', (n) => `Thắng ${n.toLocaleString('vi-VN')} trận đấu trường`, ACH_PVP_WINS, pvpTotal.wins, 'normal', claimed),
    },
  ];
  return groups;
}

// ======================= Tổng hợp =======================

function buildView(ctx: GameContext, userId: number): QuestsDto {
  const now = ctx.now();
  const day = gameDayOf(now);
  const today = calendarDateOf(now);
  const db = ctx.db;
  const daily = dailyItems(dayMetrics(db, userId, day), day, new Set([
    ...claimedSet(db, userId, `d:${day}:%`),
    ...claimedSet(db, userId, `f:${day}:%`),
    ...claimedSet(db, userId, `p:${day}:%`),
  ]));
  const login = loginView(db, userId, today, claimedSet(db, userId, `login:${today.slice(0, 7)}-%`));
  const achievements = achievementView(db, userId, claimedSet(db, userId, 'a:%'));
  const all = [
    ...daily.general,
    ...FACTIONS.flatMap((f) => daily.faction[f]),
    ...daily.pvp,
    ...achievements.flatMap((g) => g.items),
  ];
  const claimable = all.filter((i) => i.status === 'claimable').length + login.days.filter((d) => d.status === 'claimable').length;
  return {
    gameDay: day,
    nextResetAt: iso(gameDayStart(day) + DAY_MS),
    calendarDate: today,
    resetBonus: {
      tickets: { ...DAILY_RESET_BONUS },
      granted: hasClaim(db, userId, `reset:${day}`),
    },
    daily: daily.general,
    faction: daily.faction,
    pvp: daily.pvp,
    login,
    achievements,
    claimable,
  };
}

/** Mọi phần thưởng đang nhận được (đạt điều kiện, chưa nhận) theo trạng thái hiện tại. */
function claimableGrants(view: QuestsDto): Grant[] {
  const out: Grant[] = [];
  const add = (i: QuestItemDto, reason: TicketReason) => {
    if (i.status === 'claimable') out.push({ key: i.key, name: i.name, pool: i.reward.pool, count: i.reward.count, reason });
  };
  view.daily.forEach((i) => add(i, 'mission'));
  FACTIONS.forEach((f) => view.faction[f].forEach((i) => add(i, 'mission')));
  view.pvp.forEach((i) => add(i, 'mission'));
  for (const d of view.login.days) {
    if (d.status === 'claimable') out.push({ key: `login:${d.date}`, name: `Điểm danh ngày ${d.day}`, pool: 'normal', count: d.reward, reason: 'achievement' });
  }
  view.achievements.forEach((g) => g.items.forEach((i) => add(i, 'achievement')));
  return out;
}

export function getQuests(ctx: GameContext, userId: number): QuestsDto {
  return buildView(ctx, userId);
}

/**
 * Bấm Nhận. keys bỏ trống = nhận tất cả. Server tính lại điều kiện; khoá không đạt/đã nhận bị bỏ qua.
 * Không có gì để nhận => 409 NOTHING_TO_CLAIM. Mọi phần thưởng của 1 lần bấm nằm trong 1 transaction.
 * Bấm lại (retry) không cộng thêm vì mỗi khoá chỉ nhận được 1 lần.
 */
export function claimQuests(ctx: GameContext, userId: number, keys?: string[]): QuestClaimResultDto {
  const claimed = tx(ctx.db, () => {
    let grants = claimableGrants(buildView(ctx, userId));
    if (keys) {
      const want = new Set(keys);
      grants = grants.filter((g) => want.has(g.key));
    }
    if (!grants.length) throw new AppError(409, 'NOTHING_TO_CLAIM', 'Không có phần thưởng nào để nhận.');
    const nowIso = iso(ctx.now());
    for (const g of grants) grant(ctx.db, userId, g, false, nowIso);
    return grants.map(({ key, name, pool, count }) => ({ key, name, pool, count }));
  });
  return { claimed, balances: getTickets(ctx, userId) };
}

/**
 * Gọi ở mọi request đã xác thực. Rẻ khi không có gì mới (1 câu SELECT).
 * Khi sang ngày game mới / ngày dương lịch mới (một lần, trong 1 transaction):
 *  1. Ghi nhận đăng nhập (ngày game + ngày dương lịch).
 *  2. Tự nhận các nhiệm vụ của ngày game trước đã đạt mà chưa bấm nhận.
 *  3. Cộng thưởng reset 05:00 cho ngày game hiện tại (chỉ ngày hiện tại, không cộng bù ngày vắng mặt).
 *  4. Sang tháng mới: tự nhận các ngày điểm danh của tháng trước chưa bấm nhận.
 */
export function touchDaily(ctx: GameContext, userId: number): DailyEventsDto | null {
  const now = ctx.now();
  const day = gameDayOf(now);
  const today = calendarDateOf(now);
  const read = () => findDailyState(ctx.db, userId);
  const pre = read();
  if (pre && pre.last_game_day === day && pre.last_cal_date === today) return null;

  return tx(ctx.db, () => {
    const st = read(); // đọc lại trong transaction (request đồng thời)
    if (st && st.last_game_day === day && st.last_cal_date === today) return null;
    const db = ctx.db;
    const nowIso = iso(now);
    const events: DailyEventsDto = { resetBonus: null, autoClaimed: [] };
    insertLoginDayIgnoring(db, userId, 'game', day, nowIso);
    insertLoginDayIgnoring(db, userId, 'calendar', today, nowIso);

    if (!st || st.last_game_day !== day) {
      // 2. Ngày game trước (ngày gần nhất người chơi có vào game) — tự nhận nhiệm vụ đạt mà chưa nhận
      if (st && st.last_game_day < day) {
        const prev = st.last_game_day;
        const claimed = new Set([
          ...claimedSet(db, userId, `d:${prev}:%`),
          ...claimedSet(db, userId, `f:${prev}:%`),
          ...claimedSet(db, userId, `p:${prev}:%`),
        ]);
        const v = dailyItems(dayMetrics(db, userId, prev), prev, claimed);
        for (const i of [...v.general, ...FACTIONS.flatMap((f) => v.faction[f]), ...v.pvp]) {
          if (i.status !== 'claimable') continue;
          const g: Grant = { key: i.key, name: i.name, pool: i.reward.pool, count: i.reward.count, reason: 'mission' };
          grant(db, userId, g, true, nowIso);
          events.autoClaimed.push({ key: g.key, name: g.name, pool: g.pool, count: g.count });
        }
      }
      // 3. Thưởng reset của ngày hiện tại
      const key = `reset:${day}`;
      if (insertClaimIgnoring(db, userId, key, nowIso) === 1) {
        const got = {} as TicketBalances;
        for (const t of TICKET_TYPES) {
          got[t] = DAILY_RESET_BONUS[t];
          if (got[t] > 0) applyTicketDelta(db, userId, t, got[t], 'daily_reset', key, null, nowIso);
        }
        events.resetBonus = got;
      }
    }

    if (st && st.last_cal_date.slice(0, 7) < today.slice(0, 7)) {
      // 4. Tháng mới: tự nhận ngày điểm danh của các tháng trước chưa nhận
      for (const d of listUnclaimedOldCalendarDates(db, userId, `${today.slice(0, 7)}-01`)) {
        const g: Grant = { key: `login:${d}`, name: `Điểm danh ngày ${Number(d.slice(8))}`, pool: 'normal', count: loginDayReward(Number(d.slice(8))), reason: 'achievement' };
        grant(db, userId, g, true, nowIso);
        events.autoClaimed.push({ key: g.key, name: g.name, pool: g.pool, count: g.count });
      }
    }

    upsertDailyState(db, userId, day, today, nowIso);
    return events.resetBonus || events.autoClaimed.length ? events : null;
  });
}
