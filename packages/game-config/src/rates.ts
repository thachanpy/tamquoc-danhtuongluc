import type { TicketType, WeightEntry, Faction } from '@tq/shared';

/** Mọi tỷ lệ dùng basis points (bps). 10000 bps = 100%. */
export const BPS_SCALE = 10_000;

/** Mốc hồi vé: mỗi 5 phút theo đồng hồ server (UTC). Mục 3.6. (Trước đây 10 phút; chủ dự án đổi thành 5.) */
export const RECOVERY_INTERVAL_MS = 5 * 60 * 1000;
/** Số mốc tối đa xử lý trong MỘT transaction nội bộ. Không phải trần vé — vòng lặp xử lý đến hết. */
export const RECOVERY_BATCH_SIZE = 1_000;

/**
 * Quà đăng ký: số vé cấp MỘT LẦN khi tạo tài khoản (mục 3.7).
 * Mỗi vé được roll loại độc lập theo TICKET_GRANT_WEIGHTS, giống vé hồi.
 */
export const SIGNUP_BONUS_TICKETS = 100;

/**
 * Nút cộng vé thử nghiệm (mục 3.7): mỗi lần bấm cấp số vé này, loại vé roll độc lập theo TICKET_GRANT_WEIGHTS.
 * Chỉ hoạt động khi server bật ENABLE_DEV_TOPUP (script `pnpm dev` bật sẵn; `start` thì tắt).
 */
export const DEV_TOPUP_TICKETS = 50;

/**
 * Admin cộng vé cho người chơi (mục 3.7): số vé tối đa mỗi lần cộng. Admin chọn loại vé và số lượng.
 * Đây là trần mỗi thao tác để tránh nhập nhầm, KHÔNG phải trần tồn kho.
 */
export const ADMIN_GRANT_MAX_TICKETS = 10_000;

/**
 * Các lựa chọn số lần quay trong 1 request (mục 4.4).
 * Nếu số vé loại đã chọn ít hơn số lần yêu cầu, server quay hết số vé còn lại.
 */
export const DRAW_COUNT_OPTIONS: readonly number[] = [1, 10];

/** Xác suất loại vé khi cấp (mục 3.5): 5 loại, mỗi loại 20%. */
export const TICKET_GRANT_WEIGHTS: Record<TicketType, number> = {
  normal: 2000,
  shu: 2000,
  wei: 2000,
  wu: 2000,
  qun: 2000,
};

/** Pool phe của từng loại vé. null = toàn bộ 100 tướng. */
export const TICKET_POOL_FACTION: Record<TicketType, Faction | null> = {
  normal: null,
  shu: 'shu',
  wei: 'wei',
  wu: 'wu',
  qun: 'qun',
};

/**
 * Level cao nhất có thể nhận trực tiếp từ quay thẻ (mục 4.3).
 * Chủ dự án đổi từ 5 lên 9. Level 10 chỉ đạt được qua ghép thẻ.
 */
export const GACHA_MAX_LEVEL = 9;

/**
 * Tỷ lệ level khi quay (mục 4.3). Chỉ level 1–GACHA_MAX_LEVEL.
 * Chủ dự án yêu cầu Lv8–9 cực kỳ hiếm: Lv8 = 2/10.000, Lv9 = 1/10.000 (mức nhỏ nhất của thang bps).
 */
export const GACHA_LEVEL_RATES: WeightEntry[] = [
  { level: 1, bps: 7200 }, // 72%
  { level: 2, bps: 1500 }, // 15%
  { level: 3, bps: 700 }, // 7%
  { level: 4, bps: 350 }, // 3.5%
  { level: 5, bps: 200 }, // 2%
  { level: 6, bps: 40 }, // 0.4%
  { level: 7, bps: 7 }, // 0.07%
  { level: 8, bps: 2 }, // 0.02%
  { level: 9, bps: 1 }, // 0.01%
];

/**
 * Số thẻ đầu vào cho mỗi lần ghép (mục 5.1): cùng tướng, cùng level.
 * Trước đây là 3; chủ dự án đổi thành 2.
 */
export const UPGRADE_INPUT_COUNT = 2;

/** Tặng thẻ (mục 5.6): số thẻ tối đa trong một lần tặng. */
export const GIFT_MAX_CARDS = 20;

/**
 * Nâng cấp nhanh (mục 5.5): tự ghép mọi cặp thẻ có level đầu vào ≤ mức này.
 * QUICK_UPGRADE_MAX_MERGES: số lần ghép tối đa trong 1 lần bấm (an toàn); còn nữa thì bấm lại.
 */
export const QUICK_UPGRADE_MAX_LEVEL = 5;
export const QUICK_UPGRADE_MAX_MERGES = 1_000;

/**
 * Tỷ lệ thành công khi ghép theo level đầu vào (mục 5.2). Thất bại = BPS_SCALE - thành công.
 * Bảng chủ dự án duyệt: giảm đều 10% mỗi bậc, 90% → 10%.
 */
export const UPGRADE_SUCCESS_BPS: Record<number, number> = {
  1: 9000,
  2: 8000,
  3: 7000,
  4: 6000,
  5: 5000,
  6: 4000,
  7: 3000,
  8: 2000,
  9: 1000,
};

/**
 * Phân phối level nhận được KHI ĐÃ THẤT BẠI (mục 5.3). Mỗi hàng tổng = 10000.
 * Lv1: luôn giữ nguyên. Lv2: giữ nguyên 90%, về Lv1 10%. Lv3–9: giữ nguyên 80%, tụt đúng 1 bậc 20%.
 */
export const UPGRADE_FAILURE_DISTRIBUTION: Record<number, WeightEntry[]> = {
  1: [{ level: 1, bps: 10000 }],
  2: [
    { level: 1, bps: 1000 },
    { level: 2, bps: 9000 },
  ],
  ...Object.fromEntries(
    [3, 4, 5, 6, 7, 8, 9].map((lv) => [
      lv,
      [
        { level: lv - 1, bps: 2000 },
        { level: lv, bps: 8000 },
      ],
    ]),
  ),
};
