import type { GachaConfigDto, GeneralDto, TicketsDto } from '@tq/shared';

/** Trạng thái client — chỉ là bản sao để hiển thị; server là nguồn sự thật. */
export const state = {
  username: '',
  isAdmin: false,
  features: { devTopup: false, devTopupAmount: 0 },
  generals: [] as GeneralDto[],
  generalsById: new Map<string, GeneralDto>(),
  config: null as GachaConfigDto | null,
  tickets: null as TicketsDto | null,
  /** Mốc local (performance.now) khi tới lượt hồi kế tiếp — tính từ msUntilNextRecovery của server. */
  nextRecoveryLocal: 0,
  listeners: new Set<() => void>(),
};

export function setTickets(t: TicketsDto) {
  state.tickets = t;
  state.nextRecoveryLocal = performance.now() + t.msUntilNextRecovery;
  state.listeners.forEach((fn) => fn());
}

export function onTickets(fn: () => void): () => void {
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export const gen = (id: string): GeneralDto =>
  state.generalsById.get(id) ?? { id, name: id, faction: 'qun', artKey: id };
