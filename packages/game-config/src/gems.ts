import {
  GEM_ELEMENTS,
  MAX_LEVEL,
  MIN_LEVEL,
  PVP_TEAM_GEM_COUNT,
  type GemConfigDto,
  type GemElement,
  type PvpGemStats,
} from '@tq/shared';
import { BPS_SCALE, upgradeRateTable } from './rates.ts';

/**
 * Hệ thống Ngọc Ngũ Hành (PVP). Ngọc là VẬT PHẨM RỜI theo (loại, cấp); ghép 2 viên CÙNG loại & CÙNG cấp
 * thành 1 viên cấp +1 (dùng chung công thức/tỷ lệ/tài nguyên của thẻ Tướng — xem `UPGRADE_SUCCESS_BPS`).
 *
 * Ngọc cộng TRỰC TIẾP vào Chỉ số Nền Ra Trận cho TOÀN ĐỘI (aura gốc, KHÔNG thể bị Xóa Buff) khi vào trận.
 * Một đội hình trang bị tối đa `PVP_TEAM_GEM_COUNT` viên KHÁC LOẠI; hệ thống tự lấy viên cấp cao nhất
 * đang sở hữu của loại đó. Đơn vị bps: 10000 = 100%.
 */

export { GEM_ELEMENTS, PVP_TEAM_GEM_COUNT };
export type { GemElement, PvpGemStats };

/** Danh sách loại Ngọc theo thứ tự hiển thị (Kim → Mộc → Thủy → Hỏa → Thổ). */
export const PVP_GEM_ELEMENTS = GEM_ELEMENTS;

/** Tỉ lệ rớt Ngọc đính kèm mỗi lần quay ra Tướng (bps): 5%. */
export const PVP_GEM_DROP_BPS = 500;
/** Tỉ lệ mỗi loại Ngọc khi trúng rớt (bps): 20%/loại × 5 loại = 100%. */
export const PVP_GEM_TYPE_WEIGHT_BPS = 2000;

/** Ngọc "rỗng" — không cộng chỉ số (dùng làm giá trị mặc định/điểm khởi tạo). */
export const PVP_NO_GEM_STATS: PvpGemStats = {
  damageBps: 0,
  takenDownBps: 0,
  hpBps: 0,
  lifestealBps: 0,
  hitBps: 0,
  dodgeBps: 0,
  critBps: 0,
  critDamageBps: 0,
  defBps: 0,
  defPenBps: 0,
};

/**
 * Bảng chỉ số 2 dòng của mỗi loại Ngọc theo cấp (index 0 = cấp 1 … index 9 = cấp 10).
 * `stats` = tên 2 chỉ số tương ứng, `levels[i]` = [giá trị chỉ số 1, giá trị chỉ số 2] ở cấp i+1.
 */
const GEM_TABLE: Record<GemElement, { stats: [keyof PvpGemStats, keyof PvpGemStats]; levels: readonly [number, number][] }> = {
  // Kim: Sát thương / Giảm sát thương — +5% → +25% (nhảy +4% ở cấp 10).
  kim: {
    stats: ['damageBps', 'takenDownBps'],
    levels: [
      [500, 500],
      [700, 700],
      [900, 900],
      [1100, 1100],
      [1300, 1300],
      [1500, 1500],
      [1700, 1700],
      [1900, 1900],
      [2100, 2100],
      [2500, 2500],
    ],
  },
  // Mộc: Max HP / Hút máu — HP +5% → +25%, hút máu +2% → +12%.
  moc: {
    stats: ['hpBps', 'lifestealBps'],
    levels: [
      [500, 200],
      [700, 300],
      [900, 400],
      [1100, 500],
      [1300, 600],
      [1500, 700],
      [1700, 800],
      [1900, 900],
      [2100, 1000],
      [2500, 1200],
    ],
  },
  // Thủy: Chính xác / Né tránh — chính xác +10% → +30%, né tránh +5% → +25%.
  thuy: {
    stats: ['hitBps', 'dodgeBps'],
    levels: [
      [1000, 500],
      [1200, 700],
      [1400, 900],
      [1600, 1100],
      [1800, 1300],
      [2000, 1500],
      [2200, 1700],
      [2400, 1900],
      [2600, 2100],
      [3000, 2500],
    ],
  },
  // Hỏa: Chí mạng / ST chí mạng — chí mạng +5% → +25%, ST chí mạng +10% → +40%.
  hoa: {
    stats: ['critBps', 'critDamageBps'],
    levels: [
      [500, 1000],
      [700, 1300],
      [900, 1600],
      [1100, 1900],
      [1300, 2200],
      [1500, 2500],
      [1700, 2800],
      [1900, 3100],
      [2100, 3400],
      [2500, 4000],
    ],
  },
  // Thổ: Phòng thủ / Xuyên giáp — +5% → +25% cả hai.
  tho: {
    stats: ['defBps', 'defPenBps'],
    levels: [
      [500, 500],
      [700, 700],
      [900, 900],
      [1100, 1100],
      [1300, 1300],
      [1500, 1500],
      [1700, 1700],
      [1900, 1900],
      [2100, 2100],
      [2500, 2500],
    ],
  },
};

const clampLevel = (level: number) => Math.min(Math.max(Math.floor(level), MIN_LEVEL), MAX_LEVEL);

/** Chỉ số của MỘT viên Ngọc (loại, cấp) — mọi trường khác 0. */
export function pvpGemStats(element: GemElement, level: number): PvpGemStats {
  const { stats, levels } = GEM_TABLE[element];
  const [a, b] = levels[clampLevel(level) - 1]!;
  const out: PvpGemStats = { ...PVP_NO_GEM_STATS };
  out[stats[0]] = a;
  out[stats[1]] = b;
  return out;
}

/** Cộng dồn chỉ số của các viên Ngọc đang trang bị (tối đa `PVP_TEAM_GEM_COUNT` viên khác loại). */
export function pvpGemTeamStats(gems: readonly { element: GemElement; level: number }[]): PvpGemStats {
  const out: PvpGemStats = { ...PVP_NO_GEM_STATS };
  for (const g of gems.slice(0, PVP_TEAM_GEM_COUNT)) {
    if (g.level < MIN_LEVEL) continue;
    const s = pvpGemStats(g.element, g.level);
    for (const k of Object.keys(out) as (keyof PvpGemStats)[]) out[k] += s[k];
  }
  return out;
}

/** Bảng chỉ số công khai của mọi loại Ngọc ở mọi cấp (để UI hiển thị bảng & tra cứu). */
export const PVP_GEM_STAT_TABLE: Record<GemElement, PvpGemStats[]> = Object.fromEntries(
  PVP_GEM_ELEMENTS.map((e) => [e, Array.from({ length: MAX_LEVEL }, (_, i) => pvpGemStats(e, i + 1))]),
) as Record<GemElement, PvpGemStats[]>;

/** Cấu hình Ngọc công khai cho client (bảng chỉ số + tỷ lệ ghép/rớt). */
export function pvpGemConfig(): GemConfigDto {
  return {
    bpsScale: BPS_SCALE,
    teamGemCount: PVP_TEAM_GEM_COUNT,
    dropBps: PVP_GEM_DROP_BPS,
    typeWeightBps: PVP_GEM_TYPE_WEIGHT_BPS,
    elements: [...PVP_GEM_ELEMENTS],
    table: PVP_GEM_STAT_TABLE,
    rates: upgradeRateTable(),
  };
}

/**
 * Roll Ngọc rớt đính kèm khi quay ra MỘT Tướng: `PVP_GEM_DROP_BPS` (5%) trúng, và khi trúng thì
 * chọn ĐỀU một trong 5 loại (`PVP_GEM_TYPE_WEIGHT_BPS` = 20%/loại). Ngọc nhận đúng CẤP của Tướng đó.
 * Trả `null` = lượt quay này không rớt Ngọc.
 */
export function rollGemDrop(rand: (max: number) => number): GemElement | null {
  if (rand(BPS_SCALE) >= PVP_GEM_DROP_BPS) return null;
  return PVP_GEM_ELEMENTS[rand(PVP_GEM_ELEMENTS.length)]!;
}

/**
 * Chọn loại Ngọc cho đội TỰ ĐỘNG (chưa lưu đội hình): lấy tối đa `PVP_TEAM_GEM_COUNT` loại có viên
 * cấp CAO NHẤT đang sở hữu, xếp theo cấp giảm dần (đồng cấp thì theo thứ tự Ngũ Hành).
 */
export function autoTeamGemElements(owned: readonly { element: GemElement; level: number }[]): GemElement[] {
  const best = new Map<GemElement, number>();
  for (const g of owned) best.set(g.element, Math.max(best.get(g.element) ?? 0, g.level));
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || PVP_GEM_ELEMENTS.indexOf(a[0]) - PVP_GEM_ELEMENTS.indexOf(b[0]))
    .slice(0, PVP_TEAM_GEM_COUNT)
    .map(([element]) => element);
}

/** Chỉ số cộng toàn đội của các loại Ngọc đã gắn (lấy viên cấp cao nhất của mỗi loại). */
export function pvpTeamGemStats(
  elements: readonly GemElement[],
  owned: readonly { element: GemElement; level: number }[],
): PvpGemStats {
  const best = new Map<GemElement, number>();
  for (const g of owned) best.set(g.element, Math.max(best.get(g.element) ?? 0, g.level));
  return pvpGemTeamStats(
    elements.flatMap((element) => {
      const level = best.get(element);
      return level ? [{ element, level }] : [];
    }),
  );
}

/** Kiểm tra cấu hình Ngọc tự nhất quán (gọi trong validate.ts). */
export function validateGemConfig(assert: (cond: unknown, msg: string) => void): void {
  assert(PVP_GEM_ELEMENTS.length === 5, 'Phải có đúng 5 loại Ngọc Ngũ Hành');
  assert(PVP_GEM_DROP_BPS > 0 && PVP_GEM_DROP_BPS < BPS_SCALE, 'Tỉ lệ rớt Ngọc phải trong (0, 100%)');
  assert(PVP_GEM_TYPE_WEIGHT_BPS * PVP_GEM_ELEMENTS.length === BPS_SCALE, 'Tổng tỉ lệ loại Ngọc phải bằng 100%');
  for (const e of PVP_GEM_ELEMENTS) {
    const t = GEM_TABLE[e];
    assert(t.levels.length === MAX_LEVEL, `Bảng chỉ số Ngọc ${e} phải có đủ ${MAX_LEVEL} cấp`);
    for (const [a, b] of t.levels) assert(a > 0 || b > 0, `Cấp Ngọc ${e} phải cộng ít nhất một chỉ số`);
  }
}
