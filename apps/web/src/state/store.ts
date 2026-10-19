import type { GachaConfigDto, GeneralDto, MeDto, ProfileDto, PvpSkill, PvpStyle, TicketsDto } from '@tq/shared';
import { readonly, signal, type ReadonlySignal } from './signal.ts';

/**
 * Trạng thái client — chỉ là bản sao để hiển thị; server là nguồn sự thật.
 * Phần nạp 1 lần lúc vào game (tên, quyền, roster, cấu hình) để trong object thường;
 * phần đổi trong phiên chơi (số dư vé, badge, hồ sơ) là signal để UI tự cập nhật.
 */
export const state = {
  /** Id người chơi (từ `/api/me`) — dùng để phân biệt vai mua/bán ở Chợ thẻ. */
  userId: 0,
  username: '',
  isAdmin: false,
  features: { devTopup: false, devTopupAmount: 0, gift: false },
  generals: [] as GeneralDto[],
  generalsById: new Map<string, GeneralDto>(),
  /** Phong cách chiến đấu từng tướng (mục 6.7) — server quyết định, client chỉ hiển thị. */
  generalStyles: {} as Record<string, PvpStyle>,
  /** Kỹ năng chiến đấu từng tướng (mục 6.7) — client hiện kỹ năng khi chọn tướng vào đội hình. */
  generalSkills: {} as Record<string, PvpSkill>,
  /** Tên chiêu thật từng tướng (theo SKILLS.md, ví dụ "Hiệu lệnh thiên hạ") — client hiện thay nhãn chung. */
  generalSkillNames: {} as Record<string, string>,
  config: null as GachaConfigDto | null,
  /** Mốc local (performance.now) khi tới lượt hồi kế tiếp — tính từ msUntilNextRecovery của server. */
  nextRecoveryLocal: 0,
};

/** Dữ liệu roster tướng trả về từ `/api/generals`. */
export type RosterPayload = {
  items: GeneralDto[];
  styles: Record<string, PvpStyle>;
  skills: Record<string, PvpSkill>;
  skillNames: Record<string, string>;
};

const ticketsSig = signal<TicketsDto | null>(null);
/** Số dư vé hiện tại (reactive). */
export const tickets: ReadonlySignal<TicketsDto | null> = readonly(ticketsSig);

export function setTickets(t: TicketsDto): void {
  state.nextRecoveryLocal = performance.now() + t.msUntilNextRecovery;
  ticketsSig.set(t);
}

const profileSig = signal<ProfileDto>({ displayName: '', avatar: null });
/** Hồ sơ hiển thị (tên hiển thị + ảnh đại diện) — reactive vì đổi được ở trang Hồ sơ. */
export const profile: ReadonlySignal<ProfileDto> = readonly(profileSig);
export const setProfile = (p: ProfileDto): void => profileSig.set(p);

/** Badge tab Nhiệm vụ (số phần thưởng chờ nhận) và tab Quản trị (số tài khoản chờ duyệt). */
const questBadgeSig = signal(0);
const pendingBadgeSig = signal(0);
export const questBadge: ReadonlySignal<number> = readonly(questBadgeSig);
export const pendingBadge: ReadonlySignal<number> = readonly(pendingBadgeSig);
export const setQuestBadge = (n: number): void => questBadgeSig.set(n);
export const setPendingBadge = (n: number): void => pendingBadgeSig.set(n);

/** Đối thủ PvP được chọn từ bảng xếp hạng (điều hướng tới Đấu trường, mục 6.7). */
const pvpTargetSig = signal<number | null>(null);
export const pvpTarget: ReadonlySignal<number | null> = readonly(pvpTargetSig);
export const setPvpTarget = (id: number | null): void => pvpTargetSig.set(id);

/**
 * Ghi dữ liệu phiên đăng nhập vào state (gọi ngay sau khi `me` + roster + cấu hình sẵn sàng).
 * `tickets` là số dư sau khi đã nhận vé hồi — server quyết định con số cuối cùng.
 */
export function applySession(input: { me: MeDto; roster: RosterPayload; config: GachaConfigDto; tickets: TicketsDto }): void {
  const { me, roster, config, tickets: bal } = input;
  state.userId = me.id;
  state.username = me.username;
  state.isAdmin = me.isAdmin;
  state.features = me.features;
  setProfile({ displayName: me.displayName, avatar: me.avatar });
  state.generals = roster.items;
  state.generalsById = new Map(roster.items.map((g) => [g.id, g]));
  state.generalStyles = roster.styles;
  state.generalSkills = roster.skills;
  state.generalSkillNames = roster.skillNames;
  state.config = config;
  setTickets(bal);
}

/** Xóa sạch state khi đăng xuất — tránh rò rỉ dữ liệu sang phiên/tài khoản kế tiếp. */
export function resetSession(): void {
  state.userId = 0;
  state.username = '';
  state.isAdmin = false;
  state.features = { devTopup: false, devTopupAmount: 0, gift: false };
  state.generals = [];
  state.generalsById = new Map();
  state.generalStyles = {};
  state.generalSkills = {};
  state.generalSkillNames = {};
  state.config = null;
  state.nextRecoveryLocal = 0;
  ticketsSig.set(null);
  setProfile({ displayName: '', avatar: null });
  setQuestBadge(0);
  setPendingBadge(0);
  setPvpTarget(null);
}

export const gen = (id: string): GeneralDto => state.generalsById.get(id) ?? { id, name: id, faction: 'qun', artKey: id };

/** Phong cách chiến đấu của tướng (mục 6.7); tướng lạ (không có trong roster) coi như Tấn công. */
export const genStyle = (id: string): PvpStyle => state.generalStyles[id] ?? 'attack';

/** Kỹ năng chiến đấu của tướng (mục 6.7); tướng lạ coi như đánh đơn mục tiêu. */
export const genSkill = (id: string): PvpSkill => state.generalSkills[id] ?? 'ATTACK';

/** Tên chiêu thật của tướng (theo SKILLS.md); thiếu dữ liệu thì trả chuỗi rỗng để UI dùng nhãn chung. */
export const genSkillName = (id: string): string => state.generalSkillNames[id] ?? '';
