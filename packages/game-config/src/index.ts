import type { GeneralDto, TicketType, WeightEntry } from '@tq/shared';
import { TICKET_TYPES } from '@tq/shared';
import { ROSTER } from './roster.ts';
import { BPS_SCALE, TICKET_GRANT_WEIGHTS, TICKET_POOL_FACTION } from './rates.ts';

export * from './roster.ts';
export * from './rates.ts';
export * from './quests.ts';
export { validateGameConfig } from './validate.ts';

/** Nguồn số ngẫu nhiên: trả về số nguyên trong [0, max). Backend dùng crypto.randomInt. */
export type RandomInt = (max: number) => number;

/** Roll theo trọng số bps. Thuật toán dùng chung cho mọi bảng tỷ lệ. */
export function rollWeighted<T>(items: readonly T[], weightOf: (t: T) => number, rand: RandomInt): T {
  let total = 0;
  for (const it of items) total += weightOf(it);
  if (total <= 0) throw new Error('rollWeighted: tổng trọng số phải > 0');
  const r = rand(total);
  let acc = 0;
  for (const it of items) {
    acc += weightOf(it);
    if (r < acc) return it;
  }
  throw new Error('rollWeighted: không chọn được phần tử');
}

export function rollLevel(table: readonly WeightEntry[], rand: RandomInt): number {
  return rollWeighted(table, (e) => e.bps, rand).level;
}

export function rollTicketType(rand: RandomInt): TicketType {
  return rollWeighted(TICKET_TYPES, (t) => TICKET_GRANT_WEIGHTS[t], rand);
}

/**
 * Roll loại vé chỉ trong các loại được phép (giữ tỷ lệ tương đối theo TICKET_GRANT_WEIGHTS).
 * Không còn loại nào hợp lệ (hoặc tổng trọng số 0) => null.
 */
export function rollTicketTypeAmong(rand: RandomInt, allowed: readonly TicketType[]): TicketType | null {
  const items = allowed.filter((t) => TICKET_GRANT_WEIGHTS[t] > 0);
  if (!items.length) return null;
  return rollWeighted(items, (t) => TICKET_GRANT_WEIGHTS[t], rand);
}

export function poolForTicket(ticketType: TicketType): GeneralDto[] {
  const faction = TICKET_POOL_FACTION[ticketType];
  return faction === null ? [...ROSTER] : ROSTER.filter((g) => g.faction === faction);
}

/** Roll thành công: r < successBps trong thang BPS_SCALE. */
export function rollSuccess(successBps: number, rand: RandomInt): boolean {
  return rand(BPS_SCALE) < successBps;
}
