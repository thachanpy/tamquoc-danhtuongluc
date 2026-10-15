import { createSignal } from 'solid-js';
import type { GachaConfigDto, GeneralDto, ProfileDto, PvpSkill, PvpStyle, TicketsDto } from '@tq/shared';

/**
 * Trạng thái client — chỉ là bản sao để hiển thị; server là nguồn sự thật.
 * Phần nạp 1 lần lúc vào game (tên, quyền, roster, cấu hình) để trong object thường;
 * phần thay đổi trong phiên chơi (số dư vé, badge) là signal của Solid để UI tự cập nhật.
 */
export const state = {
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

const [ticketsSig, setTicketsSig] = createSignal<TicketsDto | null>(null);
/** Số dư vé hiện tại (reactive). */
export const tickets = ticketsSig;

export function setTickets(t: TicketsDto) {
  state.nextRecoveryLocal = performance.now() + t.msUntilNextRecovery;
  setTicketsSig(t);
}

/** Badge tab Nhiệm vụ (số phần thưởng chờ nhận) và tab Quản trị (số tài khoản chờ duyệt). */
export const [questBadge, setQuestBadge] = createSignal(0);
export const [pendingBadge, setPendingBadge] = createSignal(0);

/** Đối thủ PvP được chọn từ bảng xếp hạng (điều hướng tới #pvp/<id>, mục 6.7). */
export const [pvpTarget, setPvpTarget] = createSignal<number | null>(null);

const [profileSig, setProfileSig] = createSignal<ProfileDto>({ displayName: '', avatar: null });
/** Hồ sơ hiển thị (tên hiển thị + ảnh đại diện) — reactive vì đổi được ở trang Hồ sơ. */
export const profile = profileSig;
export const setProfile = setProfileSig;

export const gen = (id: string): GeneralDto =>
  state.generalsById.get(id) ?? { id, name: id, faction: 'qun', artKey: id };

/** Phong cách chiến đấu của tướng (mục 6.7); tướng lạ (không có trong roster) coi như Tấn công. */
export const genStyle = (id: string): PvpStyle => state.generalStyles[id] ?? 'attack';

/** Kỹ năng chiến đấu của tướng (mục 6.7); tướng lạ coi như đánh đơn mục tiêu. */
export const genSkill = (id: string): PvpSkill => state.generalSkills[id] ?? 'SINGLE';

/** Tên chiêu thật của tướng (theo SKILLS.md); thiếu dữ liệu thì trả chuỗi rỗng để UI dùng nhãn chung. */
export const genSkillName = (id: string): string => state.generalSkillNames[id] ?? '';
