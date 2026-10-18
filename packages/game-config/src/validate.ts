import { FACTIONS, TICKET_TYPES, MIN_LEVEL, MAX_LEVEL, type WeightEntry } from '@tq/shared';
import { ROSTER, ROSTER_SIZE, GENERALS_PER_FACTION } from './roster.ts';
import {
  BPS_SCALE,
  SIGNUP_BONUS_TICKETS,
  DRAW_COUNT_OPTIONS,
  DRAW_ALL_MAX,
  DEV_TOPUP_TICKETS,
  ADMIN_GRANT_MAX_TICKETS,
  GIFT_CODE_MAX_TICKETS,
  UPGRADE_INPUT_COUNT,
  QUICK_UPGRADE_MAX_LEVEL,
  GIFT_MAX_CARDS,
  MARKET_PRICE,
  MARKET_MAX_ACTIVE_LISTINGS,
  RECOVERY_CAP_PER_TYPE,
  LEADERBOARD_SIZE,
  LEADERBOARD_TOP,
  QUICK_UPGRADE_MAX_MERGES,
  TICKET_GRANT_WEIGHTS,
  TICKET_POOL_FACTION,
  GACHA_LEVEL_RATES,
  GACHA_LEVEL_SCALE,
  GACHA_MAX_LEVEL,
  UPGRADE_SUCCESS_BPS,
  UPGRADE_FAILURE_DISTRIBUTION,
} from './rates.ts';
import { validateQuestConfig } from './quests.ts';
import { validatePvpConfig } from './pvp.ts';
import { validateGemConfig } from './gems.ts';

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`[game-config] ${msg}`);
}

function checkWeights(name: string, entries: WeightEntry[], minLevel: number, maxLevel: number, scale = BPS_SCALE) {
  assert(entries.length > 0, `${name}: rỗng`);
  const seen = new Set<number>();
  let sum = 0;
  for (const e of entries) {
    assert(Number.isInteger(e.level), `${name}: level không phải số nguyên`);
    assert(e.level >= minLevel && e.level <= maxLevel, `${name}: level ${e.level} ngoài ${minLevel}-${maxLevel}`);
    assert(!seen.has(e.level), `${name}: trùng level ${e.level}`);
    seen.add(e.level);
    assert(Number.isInteger(e.bps) && e.bps >= 0, `${name}: xác suất âm/không nguyên`);
    sum += e.bps;
  }
  assert(sum === scale, `${name}: tổng ${sum} != ${scale}`);
}

/** Validate toàn bộ cấu hình. Ném lỗi nếu sai — server gọi khi khởi động. */
export function validateGameConfig(): void {
  // Roster
  assert(ROSTER.length === ROSTER_SIZE, `roster phải có ${ROSTER_SIZE} tướng, đang có ${ROSTER.length}`);
  const ids = new Set(ROSTER.map((g) => g.id));
  assert(ids.size === ROSTER_SIZE, 'roster có ID trùng');
  for (const g of ROSTER) {
    assert(/^[a-z0-9-]+$/.test(g.id), `ID không hợp lệ: ${g.id}`);
    assert((FACTIONS as readonly string[]).includes(g.faction), `phe không hợp lệ: ${g.id}`);
  }
  for (const f of FACTIONS) {
    const n = ROSTER.filter((g) => g.faction === f).length;
    assert(n === GENERALS_PER_FACTION, `phe ${f} phải có ${GENERALS_PER_FACTION} tướng, đang có ${n}`);
  }

  // Loại vé
  const ticketKeys = Object.keys(TICKET_GRANT_WEIGHTS).sort();
  assert(JSON.stringify(ticketKeys) === JSON.stringify([...TICKET_TYPES].sort()), 'loại vé không khớp enum');
  let tsum = 0;
  for (const t of TICKET_TYPES) {
    const w = TICKET_GRANT_WEIGHTS[t];
    assert(Number.isInteger(w) && w >= 0, `tỷ lệ vé ${t} không hợp lệ`);
    tsum += w;
  }
  assert(tsum === BPS_SCALE, `tổng tỷ lệ cấp vé ${tsum} != ${BPS_SCALE}`);
  // Mỗi loại vé phe phải trỏ tới đúng phe cùng tên; vé thường không giới hạn phe
  for (const t of TICKET_TYPES) {
    const f = TICKET_POOL_FACTION[t];
    assert(t === 'normal' ? f === null : f === t, `pool của ${t} không hợp lệ`);
  }
  assert(
    Number.isSafeInteger(SIGNUP_BONUS_TICKETS) && SIGNUP_BONUS_TICKETS >= 0,
    'SIGNUP_BONUS_TICKETS phải là số nguyên không âm',
  );
  assert(
    Number.isSafeInteger(DEV_TOPUP_TICKETS) && DEV_TOPUP_TICKETS > 0 && DEV_TOPUP_TICKETS <= 10_000,
    'DEV_TOPUP_TICKETS phải là số nguyên 1–10000',
  );
  assert(
    Number.isSafeInteger(ADMIN_GRANT_MAX_TICKETS) && ADMIN_GRANT_MAX_TICKETS >= 1 && ADMIN_GRANT_MAX_TICKETS <= 1_000_000,
    'ADMIN_GRANT_MAX_TICKETS phải là số nguyên 1–1000000',
  );
  assert(
    Number.isSafeInteger(GIFT_CODE_MAX_TICKETS) && GIFT_CODE_MAX_TICKETS >= 1 && GIFT_CODE_MAX_TICKETS <= 1_000_000,
    'GIFT_CODE_MAX_TICKETS phải là số nguyên 1–1000000',
  );
  assert(
    Number.isInteger(UPGRADE_INPUT_COUNT) && UPGRADE_INPUT_COUNT >= 2 && UPGRADE_INPUT_COUNT <= 10,
    'UPGRADE_INPUT_COUNT phải là số nguyên 2–10',
  );
  assert(
    Number.isInteger(QUICK_UPGRADE_MAX_LEVEL) && QUICK_UPGRADE_MAX_LEVEL >= 1 && QUICK_UPGRADE_MAX_LEVEL <= MAX_LEVEL - 1,
    'QUICK_UPGRADE_MAX_LEVEL phải trong 1–9',
  );
  assert(Number.isInteger(QUICK_UPGRADE_MAX_MERGES) && QUICK_UPGRADE_MAX_MERGES >= 1, 'QUICK_UPGRADE_MAX_MERGES không hợp lệ');
  assert(Number.isInteger(GIFT_MAX_CARDS) && GIFT_MAX_CARDS >= 1 && GIFT_MAX_CARDS <= 100, 'GIFT_MAX_CARDS phải trong 1–100');
  // Chợ thẻ tướng: giá cố định 0 (hệ thống Vàng làm sau) và trần số tin đang bán mỗi người chơi.
  assert(MARKET_PRICE === 0, 'MARKET_PRICE hiện phải là 0 (chưa mở hệ thống Vàng)');
  assert(
    Number.isInteger(MARKET_MAX_ACTIVE_LISTINGS) && MARKET_MAX_ACTIVE_LISTINGS >= 1 && MARKET_MAX_ACTIVE_LISTINGS <= 100,
    'MARKET_MAX_ACTIVE_LISTINGS phải trong 1–100',
  );
  assert(DRAW_COUNT_OPTIONS.includes(1), 'DRAW_COUNT_OPTIONS phải có lựa chọn quay 1');
  assert(new Set(DRAW_COUNT_OPTIONS).size === DRAW_COUNT_OPTIONS.length, 'DRAW_COUNT_OPTIONS trùng giá trị');
  assert(
    DRAW_COUNT_OPTIONS.every((n) => Number.isInteger(n) && n >= 1 && n <= 100),
    'DRAW_COUNT_OPTIONS phải là số nguyên 1–100',
  );
  assert(
    Number.isInteger(DRAW_ALL_MAX) && DRAW_ALL_MAX > Math.max(...DRAW_COUNT_OPTIONS) && DRAW_ALL_MAX <= 5000,
    'DRAW_ALL_MAX phải lớn hơn mọi lựa chọn quay và ≤ 5000',
  );

  // Gacha level
  assert(
    Number.isInteger(GACHA_MAX_LEVEL) && GACHA_MAX_LEVEL >= MIN_LEVEL && GACHA_MAX_LEVEL <= MAX_LEVEL,
    'GACHA_MAX_LEVEL không hợp lệ',
  );
  checkWeights('GACHA_LEVEL_RATES', GACHA_LEVEL_RATES, MIN_LEVEL, GACHA_MAX_LEVEL, GACHA_LEVEL_SCALE);

  // Nâng cấp
  for (let lv = MIN_LEVEL; lv <= MAX_LEVEL - 1; lv++) {
    const s = UPGRADE_SUCCESS_BPS[lv];
    assert(s !== undefined && Number.isInteger(s) && s >= 0 && s <= BPS_SCALE, `tỷ lệ thành công level ${lv} không hợp lệ`);
    const dist = UPGRADE_FAILURE_DISTRIBUTION[lv];
    assert(dist !== undefined, `thiếu phân phối thất bại level ${lv}`);
    checkWeights(`FAILURE[${lv}]`, dist, MIN_LEVEL, lv);
  }
  assert(UPGRADE_SUCCESS_BPS[MAX_LEVEL] === undefined, 'không được có tỷ lệ nâng cấp từ level 10');

  // Bảng xếp hạng: số người hiển thị tối đa và số hạng nổi bật
  assert(Number.isInteger(LEADERBOARD_SIZE) && LEADERBOARD_SIZE >= 1 && LEADERBOARD_SIZE <= 500, 'LEADERBOARD_SIZE phải trong 1–500');
  for (const t of TICKET_TYPES) {
    const c = RECOVERY_CAP_PER_TYPE[t];
    assert(Number.isSafeInteger(c) && c >= 1, `RECOVERY_CAP_PER_TYPE.${t} phải là số nguyên ≥ 1`);
  }
  validateQuestConfig(assert);
  validatePvpConfig(assert);
  validateGemConfig(assert);
  assert(Number.isInteger(LEADERBOARD_TOP) && LEADERBOARD_TOP >= 1 && LEADERBOARD_TOP <= LEADERBOARD_SIZE, 'LEADERBOARD_TOP không hợp lệ');
}
