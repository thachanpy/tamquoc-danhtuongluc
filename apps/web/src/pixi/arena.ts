import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import { FACTION_LABELS, type Faction, type PvpSide, type PvpSkill, type PvpStyle } from '@tq/shared';
import { FACTION_STYLE, initials, levelTier, portraitUrl, prefersReducedMotion } from '../art.ts';
import { iconSvg, iconViewBox, type IconId } from '../icons.ts';
import { castKindOf, spawnSkillFx, type Fx, type FxKind } from './skillsfx.ts';

/**
 * Sân đấu PvP vẽ bằng PixiJS (mục 6.7).
 * Canvas chỉ HIỂN THỊ lại dữ liệu server đã mô phỏng sẵn: mỗi sự kiện phát lại trong
 * `BattleReplay` được đẩy sang đây qua `sync()` / `float()`, không tính toán gì thêm.
 * Bố cục NGANG (màn rộng): bên mình nửa trái, đối thủ nửa phải, ngăn giữa bằng dải phân cách;
 * mỗi bên 2 cột (hàng sau ở ngoài, hàng trước sát vạch giữa) × 3 hàng. Bố cục DỌC (màn hẹp):
 * mỗi bên 3 cột × 2 hàng, hai đội xếp trên/dưới vạch ngang — khung chỉ rộng đúng 3 ô nên ô tướng
 * to hơn hẳn khi xem trên mobile. Cả hai đều khớp sơ đồ 6 ô của engine (hàng trước sát vạch giữa).
 */

/** Bố cục sân đấu (xem docblock đầu tệp): `landscape` cho màn rộng, `portrait` cho màn hẹp. */
export type ArenaLayout = 'landscape' | 'portrait';

/** Bề rộng khung vẽ bố cục NGANG: 2 đội × 2 cột ô. */
const LAND_W = 900;
/**
 * Chiều cao khung vẽ bố cục NGANG: 3 hàng ô + khoảng cách, cộng lề trên `ROW_Y0` (chừa chỗ cho nhãn
 * tên chiêu của hàng đầu) và 7px lề đáy — canh sao cho canvas giữ tỉ lệ 900:560 khi lấp hết bề ngang.
 */
const LAND_H = 560;
/** Bề rộng dải phân cách giữa hai đội. */
const DIV_W = 28;
const SIDE_GAP = 10;
const SIDE_W = (LAND_W - DIV_W) / 2 - SIDE_GAP;
const PAD = 6;
const COL_GAP = 14;
const COL_W = (SIDE_W - PAD * 2 - COL_GAP) / 2;
/**
 * Ô tướng cao rộng rãi (164px) để chân dung, thanh máu, số máu và BA hàng chỉ số không còn
 * chen chúc; 3 hàng ô cộng khoảng cách vẫn nằm gọn trong chiều cao khung vẽ bố cục ngang.
 */
const TILE_H = 164;
/** Khoảng cách DỌC giữa hai ô liền kề trong cùng một cột (ô 1–2, 2–3) — lấy ĐÚNG bằng khoảng cách
    NGANG giữa ô 1 và ô 4 (`COL_GAP`) để các ô dàn đều, nhìn không bị lệch một chiều. */
const ROW_GAP = COL_GAP;
/**
 * Lề trên của hàng ô đầu tiên — chừa đủ chỗ cho nhãn tên chiêu của slot 1/4 nằm TRÊN ô
 * (đúng `topY - 8` như mọi hàng khác) mà không bị kẹp xuống đè lên chân dung.
 */
const ROW_Y0 = 33;

const PORT_COLS = 3;
/** Khoảng hở giữa hai đội ở bố cục dọc — đủ chỗ cho vạch ngang và pill "VS" ở giữa. */
const PORT_DIV_GAP = 30;
/** Bố cục DỌC: khung rộng ĐÚNG 3 ô (không còn lề thừa hai bên) nên ô tướng phóng to hơn hẳn. */
const PORT_W = PORT_COLS * COL_W + (PORT_COLS - 1) * COL_GAP + PAD * 2;
/** 4 hàng ô (2 hàng mỗi đội) + khoảng hở vạch ngang + lề trên/dưới. */
const PORT_H = ROW_Y0 + 4 * TILE_H + 3 * ROW_GAP + PORT_DIV_GAP + 7;

/** Kích thước khung vẽ theo từng bố cục. */
const ARENA_SIZE: Record<ArenaLayout, { w: number; h: number }> = {
  landscape: { w: LAND_W, h: LAND_H },
  portrait: { w: PORT_W, h: PORT_H },
};
/** Vòng chân dung trong ô (56px, khớp ô tướng ở trang chuẩn bị chiến). */
const ART_R = 28;
const ART_CY = 14 + ART_R;
/** Thanh máu + số máu + dòng chỉ số trong ô. */
const HP_W = COL_W - 16;
const HP_Y = 94;
const HP_H = 6;
/** Bo góc thanh máu/khiên. Đầu NGOÀI của thanh thì bo, còn chỗ thanh khiên nối vào thanh máu thì vuông. */
const BAR_R = 3;
const NUM_Y = 108;
/** Bán kính icon cạnh số máu (trái tim) và khoảng cách tới con số. */
const HP_ICO = 11;
const HP_ICO_GAP = 3;
/**
 * BA hàng chỉ số trong ô, mỗi hàng ĐÚNG 3 chỉ số (dàn đều ngang hàng nhau, không có hàng nào lẻ):
 * hàng 1 = sát thương · phòng thủ · xuyên giáp; hàng 2 = chí mạng · ST chí mạng · chính xác;
 * hàng 3 = né tránh · hút máu · giảm ST nhận. Mỗi hàng tự canh giữa và tự thu nhỏ nếu tràn bề rộng ô.
 */
const INFO_FONT = 10.5;
const INFO_ROWS: readonly (readonly IconId[])[] = [
  ['attack', 'armor', 'bow-pen'],
  ['crit-rate', 'crit-dmg', 'eye'],
  ['dodge', 'blood', 'shield-reduce'],
];
/** Danh sách icon theo thứ tự phẳng (khớp `infoIcons`/`infoVals`). */
const INFO_ITEMS: readonly IconId[] = INFO_ROWS.flat();
/**
 * Vị trí các chỉ số hiện theo ĐIỂM (1 điểm = 1%) trong dãy 9 chỉ số của ô tướng:
 * 2 = xuyên giáp · 5 = chính xác · 6 = né tránh. Các vị trí còn lại hiện theo %.
 */
const POINT_STAT_IDX = new Set([2, 5, 6]);
/** Toạ độ y của từng hàng chỉ số (dưới số máu) — cách đều 15px, hàng dưới vẫn chừa lề đáy trong ô. */
const INFO_ROW_Y: readonly number[] = [124, 139, 154];
/** Tên tướng nằm ngay dưới chân dung (khớp font/màu ô tướng ở trang chuẩn bị chiến). */
const NAME_Y = 82;
/**
 * Bốn chip ở góc trên-trái ô: **cấp → phe → phong cách → LC**, xếp dọc. Mỗi chip ôm vừa nội dung
 * (không kéo dãn) nhưng cả bốn **canh giữa trên cùng một trục dọc** nên trông đều nhau.
 */
const TAG_X = 5;
/** Toạ độ y của chip đầu tiên (cấp độ); các chip dưới xếp tiếp theo. */
const TAG_Y0 = 5;
const TAG_H = 15;
const TAG_GAP = 2;
const TAG_FONT = 10.5;
/** Lề ngang trong chip chữ (cấp độ, phe); chuỗi chỉ có icon dùng lề hẹp hơn cho khỏi bị kéo dài. */
const TAG_PAD = 7;
/** Lề ngang của chip phong cách — khớp `padding: 1px 5px` của `.pvp-pick-style`. */
const TAG_ICON_PAD = 5;
/** Cỡ icon phong cách (khung vẽ của `drawStyleIcon` là 13×13). */
const TAG_ICON = 13;
/** Chip hiệu ứng trên ô: cỡ chữ tối đa/tối thiểu, khoảng cách, số hàng tối đa khi phải xuống dòng. */
const CHIP_FONT = 10;
const CHIP_FONT_MIN = 8;
const CHIP_GAP = 4;
const CHIP_MAX_ROWS = 2;
/** Lề an toàn (px) khi kẹp số bay lên trong khung sân — chừa chỗ cho viền chữ đậm. */
const FLOAT_PAD = 6;

const NUM_FONT = "'Oswald', 'Arial Narrow', system-ui, sans-serif";
const UI_FONT = 'system-ui, sans-serif';

/**
 * Bảng màu hiển thị Combat — QUY CHUẨN dùng chung cho mọi màn chiến đấu (sân đấu PixiJS, dòng diễn
 * biến và bảng tổng kết chỉ số). Đổi màu ở đây thì phải đổi tương ứng ở `theme.css` (`.rp-drow-*`,
 * `.rp-t-num.*`) và `skillsfx.ts` (`KIND_COLOR`) để không lệch tông:
 * - Sát thương thường `#E0D8C3` (bạch ngân / trắng ngà) · Chí mạng `#FFB300` (hoàng kim) · Thiêu đốt `#FF772E` (xích hỏa)
 * - Buff có lợi / Hồi máu / Khiên / Choáng `#6FBE73` (bích ngọc) · Debuff / Xóa buff `#DB5151` (chu tước)
 */
const C = {
  line: 0x2c303b,
  panel: 0x171920,
  panel2: 0x1f222b,
  text: 0xecebe6,
  gold: 0xd4a84a,
  gold2: 0xf3d58a,
  /** Buff có lợi (quầng quanh chân dung + chip hiệu ứng). */
  ok: 0x6FBE73,
  bad: 0xef5b5b,
  muted: 0x9aa0ab,
  /** Thanh máu phe TA — xanh lá. */
  hp: 0x3fbf7f,
  /** Thanh máu phe ĐỊCH — đỏ, nhìn là biết ngay bên nào. */
  hpEnemy: 0xef5b5b,
  info: 0xffcf8a,
  /** Chỉ số đang CAO hơn nền (được buff) → xanh lá. */
  infoUp: 0x6FBE73,
  /** Sát thương thường — bạch ngân / trắng ngà. */
  dmg: 0xe0d8c3,
  /** Hồi máu — bích ngọc (cùng nhóm "buff có lợi"). */
  heal: 0x6FBE73,
  /** Sát thương chí mạng — hoàng kim / vàng đế vương. */
  crit: 0xffb300,
  /** Khống chế (choáng) — xanh lục (bích ngọc): sao váng đầu nhìn là thấy rõ, không lẫn với sát thương. */
  stun: 0xA8A8A8,
  /** Debuff / Xóa buff — chu tước (đỏ máu). */
  debuff: 0xDB5151,
  /** Sát thương Thiêu đốt theo lượt (DoT) — xích hỏa / cam lửa trầm. */
  burn: 0xFF772E,
};

/** Mã màu hex cho bộ nạp SVG của PixiJS (nó không hiểu `currentColor`). */
const hex = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/**
 * Vẽ icon hiệu ứng chiến đấu (bộ icon trong `icons.ts`) với gốc ở góc trên-trái khung `size`×`size`.
 * Dùng `Graphics#svg` của PixiJS v8 nên hình dạng luôn khớp đúng icon ở giao diện DOM.
 */
function drawIcon(g: Graphics, id: IconId, size: number, color: number): void {
  g.clear().svg(iconSvg(id, hex(color)));
  // PixiJS bỏ qua viewBox nên tự quy đổi theo khung gốc của từng icon (mặc định 24).
  g.scale.set(size / iconViewBox(id));
}

/** Màu nhãn phong cách chiến đấu (khớp `STYLE_COLOR` và chip `.pvp-cell-style` ở trang chuẩn bị chiến). */
const STYLE_TONE: Record<PvpStyle, number> = {
  attack: 0xef6f6a,
  defense: 0x5aa2ff,
  support: 0x3fbf7f,
};

/**
 * Vẽ icon định danh phong cách (đơn sắc, khớp hình dạng với StyleIcon ở giao diện DOM):
 * Tấn công = kiếm dựng đứng, Phòng thủ = khiên, Hỗ trợ = sách mở.
 * Hình vẽ trong khung 13×13, gốc ở góc trên-trái.
 */
function drawStyleIcon(g: Graphics, style: PvpStyle): void {
  const ink = { color: STYLE_TONE[style] };
  g.clear();
  if (style === 'attack') {
    // Lưỡi kiếm nhọn hướng lên + đốc ngang + chuôi + núm
    g.poly([6.5, 0.4, 8.3, 2.6, 8.3, 7.6, 4.7, 7.6, 4.7, 2.6]).fill(ink);
    g.rect(2.6, 7.8, 7.8, 1.6).fill(ink);
    g.rect(5.6, 9.4, 1.8, 2.1).fill(ink);
    g.circle(6.5, 12.1, 1.1).fill(ink);
  } else if (style === 'defense') {
    // Khiên: vai vuông hai bên, thót nhọn xuống đáy
    g.poly([6.5, 0.5, 12, 2.5, 12, 6.3, 6.5, 12.6, 1, 6.3, 1, 2.5]).fill(ink);
  } else {
    // Sách mở: hai trang đối xứng qua gáy
    g.poly([0.7, 2.3, 3.2, 1.1, 6.1, 2.5, 6.1, 11.9, 3.2, 10.6, 0.7, 11.9]).fill(ink);
    g.poly([12.3, 2.3, 9.8, 1.1, 6.9, 2.5, 6.9, 11.9, 9.8, 10.6, 12.3, 11.9]).fill(ink);
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const num = (n: number) => n.toLocaleString('vi-VN');

/** Tướng trên sân (bất biến trong suốt trận). */
export interface ArenaUnit {
  idx: number;
  side: PvpSide;
  slot: number;
  name: string;
  level: number;
  /** Lực chiến (LC) của tướng ở cấp này — hiện chip thứ 4 trong chuỗi định danh góc trên-trái. */
  lc: number;
  artKey: string;
  /** Phong cách chiến đấu — hiện nhãn trên ô (Tấn công / Phòng thủ / Hỗ trợ). */
  style: PvpStyle;
  /** Nhóm kỹ năng — chọn kiểu hiệu ứng niệm chiêu khi tướng ra đòn. */
  skill: PvpSkill;
  /** Phe — pha màu hiệu ứng kỹ năng (Ngụy lam, Thục lục, Ngô đỏ, Quần tím). */
  faction: Faction;
  /** Sát thương hiện tại = sát thương nền + các lớp buff đang hiệu lực. */
  damage: number;
  /** Tướng có nội tại Phản kích (luôn hiện chip "PK" trên ô). */
  counter: boolean;
  /** Chú thích đầy đủ khi rê chuột lên ô (phong cách · nội tại · kỹ năng · choáng% · hút máu%). */
  info?: string;
}

/** Trạng thái sống của một tướng tại thời điểm đang phát lại. */
export interface ArenaView {
  hp: number;
  maxHp: number;
  /**
   * Trần HP CƠ BẢN khi vào trận (đã gồm mọi buff nền: cùng phe, hàng trước/sau, phong cách)
   * — mốc so sánh để tô màu số máu như các chỉ số khác.
   */
  maxHpBase: number;
  /** Tổng lượng khiên đang hấp thụ (mọi lớp) — hiện thành thanh trắng nhạt trên thanh máu. */
  shield: number;
  alive: boolean;
  stunned: boolean;
  /** Đang được tăng sức mạnh → hiện vầng sáng quanh ô. */
  buffed: boolean;
  /** Sát thương hiện tại = nền + buff − debuff (chỉ để hiển thị). */
  damage: number;
  /** Giáp hiện tại (số nguyên điểm) = nền + buff − debuff (chỉ để hiển thị). */
  defArmor: number;
  /** Tỉ lệ chí mạng hiện tại (bps) = nền + buff − debuff. */
  critBps: number;
  /** Sát thương chí mạng hiện tại (bps) = nền + buff − debuff. */
  critDamageBps: number;
  /** Chính xác hiện tại (bps) = nền + buff − debuff (chỉ để hiển thị). */
  hitBps: number;
  /** Né tránh hiện tại (bps) = nền + buff − debuff (chỉ để hiển thị). */
  dodgeBps: number;
  /** Xuyên giáp hiện tại (bps) = nền + buff − debuff (chỉ để hiển thị). */
  defPenBps: number;
  /** Hút máu hiện tại (bps) = nền + buff (chỉ để hiển thị). */
  lifestealBps: number;
  /** Giảm sát thương nhận vào (bps) — chỉ đến từ buff/Ngọc nên nền luôn 0. */
  takenDownBps: number;
  /**
   * Chỉ số NỀN (chưa cộng buff / trừ debuff) theo đúng thứ tự `INFO_ITEMS`
   * — dùng để tô màu từng chỉ số: cao hơn nền → xanh, thấp hơn → đỏ, bằng → trắng.
   */
  statBases: number[];
  /** Hiệu ứng đang có trên tướng — mỗi chip là MỘT icon chỉ số kèm giá trị tăng/giảm cụ thể. */
  effects: { icon?: IconId; text: string; tone: 'buff' | 'debuff' | 'burn' }[];
}

export interface ArenaSnapshot {
  view: Record<number, ArenaView>;
  acting: number | null;
  skillName: string | null;
  targets: number[];
}

export interface ArenaHandle {
  sync(s: ArenaSnapshot): void;
  /** Số sát thương/hồi máu/buff bay lên trên ô tướng (mỗi mảnh có thể kèm icon hiệu ứng). */
  float(idx: number, parts: FloatPart[], crit: boolean, tone?: FloatTone): void;
  /** Hiệu ứng niệm chiêu ở ô tướng thi triển, kiểu theo nhóm kỹ năng + phe + sắc thái riêng tướng. */
  cast(idx: number, skill: PvpSkill): void;
  /** Hiệu ứng va chạm trên ô mục tiêu, kiểu theo sự kiện (sát thương, hồi máu, buff, debuff…). */
  impact(idx: number, kind: FxKind): void;
  destroy(): void;
}

const colXLeft = (col: number) => PAD + col * (COL_W + COL_GAP);
const colXRight = (col: number) => LAND_W - SIDE_W + colXLeft(col);

/** Băm artKey thành số dương ổn định — làm "sắc thái riêng" cho hiệu ứng kỹ năng của từng tướng (FNV-1a). */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Toạ độ ô tướng theo bố cục.
 * - `landscape`: bên mình ở nửa trái, hàng trước (slot 1–3) luôn sát vạch giữa; slot 4–6 ra ngoài.
 * - `portrait`: mỗi đội là 3 cột (slot 1–3 / 4–6 theo thứ tự trái→phải) × 2 hàng; đội mình ở TRÊN,
 *   hàng trước sát vạch giữa — khớp sơ đồ `4 5 6 / 1 2 3 — VS — 1 2 3 / 4 5 6`.
 */
function tilePos(side: PvpSide, slot: number, mySide: PvpSide, layout: ArenaLayout) {
  const mine = side === mySide;
  const idx = (slot - 1) % 3;
  if (layout === 'landscape') {
    const col = mine === (slot <= 3) ? 1 : 0;
    return { x: mine ? colXLeft(col) : colXRight(col), y: ROW_Y0 + idx * (TILE_H + ROW_GAP) };
  }
  const front = slot <= 3;
  const row = mine ? (front ? 1 : 0) : front ? 2 : 3;
  return {
    x: PAD + idx * (COL_W + COL_GAP),
    y: ROW_Y0 + row * (TILE_H + ROW_GAP) + (row >= 2 ? PORT_DIV_GAP : 0),
  };
}

/** Bảng chân dung đã nạp (Assets tự cache theo URL nên mở nhiều trận vẫn dùng chung). */
const portraitTex = new Map<string, Texture>();
async function loadPortraits(keys: string[]): Promise<void> {
  await Promise.all(
    [...new Set(keys)]
      .filter((k) => !portraitTex.has(k))
      .map(async (k) => {
        try {
          portraitTex.set(k, (await Assets.load(portraitUrl(k))) as Texture);
        } catch {
          /* thiếu chân dung: giữ chữ viết tắt */
        }
      }),
  );
}

/** Một mảnh của số bay lên trên ô tướng: icon hiệu ứng (tuỳ chọn) + chữ. */
export interface FloatPart {
  icon?: IconId;
  text: string;
}

/** Sắc thái màu của số bay lên (khớp quy chuẩn màu hiển thị Combat ở `C`). */
export type FloatTone = 'damage' | 'heal' | 'burn';

/** Số sát thương/hồi máu bay lên rồi tan. Luôn rõ nét: chỉ mờ ở 20% cuối của hoạt ảnh. */
class FloatFx {
  readonly c = new Container();
  private readonly y0: number;
  private readonly crit: boolean;
  private readonly reduce: boolean;
  private readonly ms: number;
  /** Nửa chiều cao chữ (ở cỡ lớn nhất) — chặn số bay lên khỏi mép trên khung sân. */
  private readonly halfH: number;
  /** Quãng bay lên tối đa; 0 khi là hiệu ứng giảm chỉ số (đứng yên tại chỗ). */
  private readonly climb: number;
  private t = 0;

  constructor(parent: Container, w: number, x: number, y: number, parts: FloatPart[], crit: boolean, tone: FloatTone, reduce: boolean) {
    this.crit = crit;
    this.reduce = reduce;
    this.y0 = y;
    this.ms = reduce ? 500 : crit ? 1050 : 950;
    const size = crit ? 50 : 36;
    // Chí mạng luôn vàng kim; còn lại theo sắc thái: hồi máu/buff xanh lá, thiêu đốt đỏ nhẹ, sát thương xám.
    const fill = crit ? C.crit : tone === 'heal' ? C.heal : tone === 'burn' ? C.burn : C.dmg;
    // Mỗi mảnh là một dòng chữ; mảnh có icon thì icon đứng ngay trước số (cùng cỡ, cùng màu).
    const texts = parts.map((p) => {
      const t = new Text({
        text: p.text,
        style: { fontFamily: NUM_FONT, fontSize: size, fontWeight: '900', fill, stroke: { color: 0x0C0D0C, width: crit ? 4 : 3 } },
      });
      t.anchor.set(0, 0.5);
      return t;
    });
    const gap = size * 0.18;
    const icoSize = size * 0.78;
    const total = parts.reduce((a, p, i) => a + (i ? gap : 0) + (p.icon ? icoSize + gap * 0.4 : 0) + texts[i]!.width, 0);
    let x0 = -total / 2;
    for (let i = 0; i < parts.length; i++) {
      if (i) x0 += gap;
      if (parts[i]!.icon) {
        const g = new Graphics();
        drawIcon(g, parts[i]!.icon!, icoSize, fill);
        g.position.set(x0, -icoSize / 2);
        this.c.addChild(g);
        x0 += icoSize + gap * 0.4;
      }
      texts[i]!.position.set(x0, 0);
      this.c.addChild(texts[i]!);
      x0 += texts[i]!.width;
    }
    this.climb = reduce ? 0 : crit ? 36 : 26;
    this.halfH = size / 2;
    // Kẹp NGANG: canh giữa quanh ô tướng nhưng không cho số tràn ra ngoài khung sân
    // (cỡ chữ lớn + tên dài như "HỒI SINH +5000" rất dễ vượt mép trái/phải).
    const halfW = total / 2;
    const cx = total + FLOAT_PAD * 2 <= w ? Math.min(Math.max(x, halfW + FLOAT_PAD), w - halfW - FLOAT_PAD) : w / 2;
    this.c.position.set(cx, y);
    parent.addChild(this.c);
  }

  tick(dt: number): boolean {
    this.t += dt;
    const p = Math.min(1, this.t / this.ms);
    const e = easeOut(p);
    const grow = easeOut(Math.min(1, p / 0.25));
    // Kẹp DỌC: bay lên nhưng không vượt khỏi mép trên khung sân (hàng tướng trên cùng rất sát mép).
    this.c.y = Math.max(this.halfH + FLOAT_PAD, this.y0 - this.climb * e);
    this.c.scale.set(this.crit ? 0.75 + 0.25 * grow : 0.9 + 0.1 * grow);
    this.c.alpha = p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
    return p >= 1;
  }
}

/** Một ô tướng trên sân: khung, chân dung tròn, tên, cấp, thanh máu, hiệu ứng trạng thái. */
class Tile {
  readonly root = new Container();
  private readonly u: ArenaUnit;
  /** Ô của phe TA hay phe ĐỊCH — quyết định màu thanh máu (xanh / đỏ). */
  private readonly mine: boolean;
  private readonly baseY: number;
  private readonly artC = new Container();
  /** Chữ viết tắt phe/tên hiện khi CHƯA có ảnh chân dung; có ảnh thì ẩn để không lộ qua ảnh trong suốt. */
  private readonly iniT: Text;
  private readonly hpFill = new Graphics();
  /** Thanh khiên (trắng nhạt) neo ở mép phải của thanh máu ĐANG CÓ rồi mọc dài về bên trái. */
  private readonly shieldFill = new Graphics();
  private readonly hpT: Text;
  /** Icon trái tim đứng ngay trước số máu. */
  private readonly hpIco = new Graphics();
  /** Màu đang dùng cho icon máu (đổi theo phe/trạng thái máu thấp) — chỉ vẽ lại khi màu đổi. */
  private hpTone = -1;
  /** Hai hàng chỉ số kèm icon: hàng 1 [kiếm] sát thương · [giáp] phòng thủ; hàng 2 [tia sét] chí mạng… */
  private readonly infoC = new Container();
  private readonly infoRows: { c: Container; icons: Graphics[]; vals: Text[]; seps: Text[] }[] = [];
  /** Icon theo thứ tự phẳng khớp `INFO_ITEMS` — dùng khi vẽ lại theo màu buff/debuff. */
  private readonly infoIcons: Graphics[] = [];
  /** Màu đang dùng của TỪNG icon chỉ số (khớp `INFO_ITEMS`) — chỉ vẽ lại icon nào đổi màu. */
  private readonly infoTones: number[] = INFO_ITEMS.map(() => -1);
  private readonly buffFx: Graphics;
  /** Hàng chip hiệu ứng trạng thái ở góc trên phải ô: icon chỉ số + giá trị tăng/giảm. */
  private readonly fxC = new Container();
  private readonly chips: { c: Container; bg: Graphics; ico: Graphics; t: Text; w: number; icoKey: string }[] = [];
  /** Chữ ký nội dung hàng chip — trùng thì bỏ qua toàn bộ việc dựng lại (đỡ vẽ lại nền/kéo chữ mỗi sự kiện). */
  private chipSig = '\u0000';
  private readonly stunFx = new Container();
  private readonly stunRing = new Graphics();
  private readonly stars: Text[] = [];
  private readonly actFx: Graphics;
  private readonly tgtFx: Graphics;
  /** Nhãn "Tới lượt" trên ô của tướng đang hành động. */
  private readonly turnC = new Container();
  private readonly turnT: Text;
  private hpShown = 0;
  private hpTarget = 1;
  private shieldShown = 0;
  private shieldTarget = 0;

  constructor(u: ArenaUnit, mySide: PvpSide, layout: ArenaLayout) {
    this.u = u;
    const mine = u.side === mySide;
    this.mine = mine;
    const { x, y } = tilePos(u.side, u.slot, mySide, layout);
    this.baseY = y;
    this.root.position.set(x, y);

    const body = new Graphics().roundRect(0, 0, COL_W, TILE_H, 10).fill({ color: 0x0a0604, alpha: 0.45 });
    body.stroke({ width: 1, color: mine ? C.line : C.bad, alpha: mine ? 1 : 0.35 });

    // Viền đỏ khi bị nhắm tới; viền vàng + quầng sáng khi đang ra đòn
    this.tgtFx = new Graphics().roundRect(-2, -2, COL_W + 4, TILE_H + 4, 12).stroke({ width: 2, color: C.bad, alpha: 0.95 });
    this.tgtFx.visible = false;
    this.actFx = new Graphics();
    this.actFx.roundRect(-3, -3, COL_W + 6, TILE_H + 6, 13).stroke({ width: 7, color: C.gold2, alpha: 0.22 });
    this.actFx.roundRect(-2, -2, COL_W + 4, TILE_H + 4, 12).stroke({ width: 2, color: C.gold2, alpha: 0.95 });
    this.actFx.visible = false;

    // Chân dung tròn: ảnh canh mép trên để giữ khuôn mặt (như object-position: 50% 0).
    // Nền + viền + kích thước khớp ô tướng ở trang chuẩn bị chiến (.pvp-art).
    this.artC.position.set(COL_W / 2, ART_CY);
    const artBg = new Graphics().circle(0, 0, ART_R).fill({ color: C.panel2 });
    artBg.stroke({ width: 1, color: C.line });
    const ini = new Text({ text: initials(u.name), style: { fontFamily: UI_FONT, fontSize: 16, fontWeight: '800', fill: C.gold2 } });
    ini.anchor.set(0.5);
    this.iniT = ini;
    this.artC.addChild(artBg, ini);

    // Quầng xanh quanh chân dung khi tướng được tăng sức mạnh
    this.buffFx = new Graphics().circle(0, 0, ART_R + 4).stroke({ width: 2, color: C.ok, alpha: 0.9 });
    this.buffFx.position.set(COL_W / 2, ART_CY);
    this.buffFx.visible = false;

    // Bốn chip góc trên trái (cùng kiểu chip với ô tướng ở trang chuẩn bị chiến), xếp dọc:
    // cấp độ → phe → phong cách chiến đấu → lực chiến (LC). Chip ôm vừa chữ/icon rồi cả bốn canh giữa chung một trục.
    const tagY = (i: number) => TAG_Y0 + i * (TAG_H + TAG_GAP);
    const lvTone = levelTier(u.level).color;
    const facTone = FACTION_STYLE[u.faction].color;
    const stTone = STYLE_TONE[u.style];
    const mkTag = (text: string, tone: number) =>
      new Text({ text, style: { fontFamily: NUM_FONT, fontSize: TAG_FONT, fontWeight: '600', fill: tone } });
    const lv = mkTag(`Lv.${u.level}`, lvTone);
    const fac = mkTag(FACTION_LABELS[u.faction], facTone);
    // Lực chiến dùng tông vàng (khớp chip LC ở ô đội hình / bảng chọn tướng).
    const lc = mkTag(`LC ${num(u.lc)}`, C.gold2);
    // Bề rộng riêng: chip chữ theo độ dài chữ, chip phong cách chỉ ôm vừa icon (không kéo dài).
    // Cả bốn vẫn canh giữa chung một trục dọc nên xếp thẳng hàng.
    const lvW = Math.max(TAG_H, lv.width + TAG_PAD * 2);
    const facW = Math.max(TAG_H, fac.width + TAG_PAD * 2);
    const stW = TAG_ICON + TAG_ICON_PAD * 2;
    const lcW = Math.max(TAG_H, lc.width + TAG_PAD * 2);
    const cx = TAG_X + Math.max(lvW, facW, stW, lcW) / 2;

    const lvY = tagY(0);
    lv.anchor.set(0.5);
    lv.position.set(cx, lvY + TAG_H / 2);
    const lvBg = new Graphics().roundRect(cx - lvW / 2, lvY, lvW, TAG_H, 999).fill({ color: 0xffffff, alpha: 0.04 });
    lvBg.stroke({ width: 1, color: C.line });

    // Chip phe (Ngụy/Thục/Ngô/Quần) — tô màu theo phe như ô tướng ở trang chuẩn bị chiến.
    const facY = tagY(1);
    fac.anchor.set(0.5);
    fac.position.set(cx, facY + TAG_H / 2);
    const facBg = new Graphics().roundRect(cx - facW / 2, facY, facW, TAG_H, 999).fill({ color: facTone, alpha: 0.12 });
    facBg.stroke({ width: 1, color: facTone, alpha: 0.85 });

    // Chip phong cách chiến đấu: chỉ hiện icon định danh — kiếm (Tấn công) / khiên (Phòng thủ) /
    // sách (Hỗ trợ) — nhãn chữ đầy đủ nằm ở tooltip.
    const stY = tagY(2);
    const stBg = new Graphics().roundRect(cx - stW / 2, stY, stW, TAG_H, 999).fill({ color: stTone, alpha: 0.14 });
    stBg.stroke({ width: 1, color: stTone, alpha: 0.85 });
    const stIcon = new Graphics();
    drawStyleIcon(stIcon, u.style);
    stIcon.position.set(cx - TAG_ICON / 2, stY + (TAG_H - TAG_ICON) / 2);

    // Chip lực chiến (LC) — chip thứ tư, tông vàng, cùng kiểu chip ở ô đội hình/trang chuẩn bị chiến.
    const lcY = tagY(3);
    lc.anchor.set(0.5);
    lc.position.set(cx, lcY + TAG_H / 2);
    const lcBg = new Graphics().roundRect(cx - lcW / 2, lcY, lcW, TAG_H, 999).fill({ color: C.gold2, alpha: 0.12 });
    lcBg.stroke({ width: 1, color: C.gold2, alpha: 0.85 });

    // Tên tướng ngay dưới chân dung — font/màu khớp .pvp-cell-name ở trang chuẩn bị chiến
    const name = new Text({ text: u.name, style: { fontFamily: UI_FONT, fontSize: 12.5, fontWeight: '700', fill: C.text } });
    name.anchor.set(0.5);
    name.position.set(COL_W / 2, NAME_Y);

    const hpBg = new Graphics().roundRect(8, HP_Y, HP_W, HP_H, BAR_R).fill({ color: 0xffffff, alpha: 0.1 });
    this.hpT = new Text({
      text: '',
      style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: '700', fill: C.text },
    });
    // Canh trái để icon trái tim + con số luôn được canh giữa cùng nhau (đặt vị trí trong `apply`).
    this.hpT.anchor.set(0, 0.5);

    // Ba hàng chỉ số (cùng font/cỡ với .pvp-cell-stat: 600 10.5px) có ICON thay ký hiệu chữ:
    // hàng 1 = [kiếm] sát thương · [giáp] phòng thủ · [xuyên] xuyên giáp; hàng 2 = [tia sét] chí mạng ·
    // [vụ nổ] ST chí mạng · [mắt] chính xác; hàng 3 = [gió] né tránh · [giọt máu] hút máu · [khiên] giảm ST nhận.
    // Mỗi hàng là một container riêng để tự canh giữa/thu nhỏ.
    for (let r = 0; r < INFO_ROWS.length; r++) {
      const items = INFO_ROWS[r]!;
      const c = new Container();
      const icons: Graphics[] = [];
      const vals: Text[] = [];
      const seps: Text[] = [];
      for (let i = 0; i < items.length; i++) {
        if (i) {
          const sep = new Text({ text: '·', style: { fontFamily: NUM_FONT, fontSize: INFO_FONT, fontWeight: '600', fill: C.text } });
          sep.anchor.set(0.5);
          seps.push(sep);
          c.addChild(sep);
        }
        const ico = new Graphics();
        const val = new Text({ text: '', style: { fontFamily: NUM_FONT, fontSize: INFO_FONT, fontWeight: '600', fill: C.text } });
        val.anchor.set(0, 0.5);
        icons.push(ico);
        vals.push(val);
        this.infoIcons.push(ico);
        c.addChild(ico, val);
      }
      this.infoRows.push({ c, icons, vals, seps });
      this.infoC.addChild(c);
    }
    this.root.addChild(this.infoC);

    // Hàng chip hiệu ứng trạng thái ở góc trên phải ô (chip tạo lười khi cần).
    this.fxC.position.set(0, 5);

    this.stunRing.clear();
    const seg = 14;
    const r = ART_R + 8;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      this.stunRing.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a0 + (Math.PI * 2 / seg) * 0.55);
    }
    this.stunRing.stroke({ width: 2, color: C.stun, alpha: 0.85 });
    this.stunFx.addChild(this.stunRing);
    for (let i = 0; i < 3; i++) {
      const s = new Text({ text: '✦', style: { fontFamily: UI_FONT, fontSize: 15, fill: C.stun } });
      s.anchor.set(0.5);
      this.stars.push(s);
      this.stunFx.addChild(s);
    }
    this.stunFx.position.set(COL_W / 2, ART_CY);
    this.stunFx.visible = false;

    // Nhãn "Tới lượt": hiện trên đỉnh ô của tướng đang hành động để biết rõ ai đang đánh
    this.turnT = new Text({ text: 'Tới lượt', style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: '900', fill: 0xffe8a8 } });
    this.turnT.anchor.set(0.5);
    const tw = this.turnT.width + 16;
    const turnBg = new Graphics().roundRect(-tw / 2, -8, tw, 16, 8).fill({ color: 0x0a0604, alpha: 0.95 });
    turnBg.stroke({ width: 1, color: C.gold, alpha: 0.9 });
    this.turnC.position.set(COL_W / 2, 10);
    this.turnC.addChild(turnBg, this.turnT);
    this.turnC.visible = false;

    this.root.addChild(
      body,
      this.tgtFx,
      this.actFx,
      this.artC,
      this.buffFx,
      lvBg,
      lv,
      facBg,
      fac,
      stBg,
      stIcon,
      lcBg,
      lc,
      name,
      hpBg,
      this.hpFill,
      this.shieldFill,
      this.hpIco,
      this.hpT,
      this.infoC,
      this.stunFx,
      this.fxC,
      this.turnC,
    );
  }

  /** Gắn chân dung sau khi ảnh tải xong (thiếu ảnh thì giữ chữ viết tắt). */
  setPortrait(tex: Texture): void {
    const sp = new Sprite(new Texture({ source: tex.source }));
    const k = Math.max((ART_R * 2) / tex.width, (ART_R * 2) / tex.height);
    sp.width = tex.width * k;
    sp.height = tex.height * k;
    sp.position.set(-sp.width / 2, -ART_R);
    // Cắt thành hình tròn: ảnh chân dung là chữ nhật, không mask sẽ tràn ra ngoài ô và đè lên tên tướng
    const mask = new Graphics().circle(0, 0, ART_R).fill({ color: 0xffffff });
    sp.mask = mask;
    // Ẩn chữ viết tắt: khi tướng bị choáng/gục, khung chân dung mờ đi sẽ lộ chữ nằm sau ảnh
    this.iniT.visible = false;
    this.artC.addChild(mask, sp);
  }

  /** Toạ độ tâm ô (để đặt số sát thương bay lên và hiệu ứng kỹ năng). */
  get centerX(): number {
    return this.root.x + COL_W / 2;
  }
  get centerY(): number {
    return this.baseY + ART_CY;
  }
  get topY(): number {
    return this.baseY;
  }

  apply(v: ArenaView, acting: boolean, targeted: boolean): void {
    this.hpTarget = v.maxHp > 0 ? Math.max(0, Math.min(1, v.hp / v.maxHp)) : 0;
    this.shieldTarget = v.maxHp > 0 ? Math.max(0, Math.min(1, v.shield / v.maxHp)) : 0;
    const pctv = Math.round(this.hpTarget * 100);
    this.hpT.text = v.alive ? `${num(v.hp)} · ${pctv}%` : 'Đã hạ';
    // Số máu tô màu như mọi chỉ số khác, so trần HP HIỆN TẠI với trần HP CƠ BẢN khi vào trận:
    // trần cao hơn (được buff) → xanh, thấp hơn (bị giảm) → đỏ, bằng → trắng.
    const hpTone = !v.alive ? C.muted : v.maxHp > v.maxHpBase ? C.infoUp : v.maxHp < v.maxHpBase ? C.debuff : C.text;
    this.hpT.style.fill = hpTone;
    this.hpT.visible = true;
    // Icon trái tim đứng trước số máu, cùng màu với con số; tướng đã gục thì ẩn icon cho gọn.
    if (this.hpTone !== hpTone) {
      this.hpTone = hpTone;
      drawIcon(this.hpIco, 'heart', HP_ICO, hpTone);
    }
    const hpW = HP_ICO + HP_ICO_GAP + this.hpT.width;
    const hpX = (COL_W - hpW) / 2;
    this.hpIco.position.set(hpX, NUM_Y - HP_ICO / 2);
    this.hpIco.visible = v.alive;
    this.hpT.position.set(hpX + HP_ICO + HP_ICO_GAP, NUM_Y);

    // Ba hàng chỉ số: [kiếm] sát thương · [giáp] phòng thủ · [xuyên] xuyên giáp /
    // [tia sét] chí mạng · [vụ nổ] ST chí mạng · [mắt] chính xác /
    // [gió] né tránh · [giọt máu] hút máu · [khiên] giảm ST nhận. Từng chỉ số tự tô màu theo so sánh với nền.
    this.setInfoLine(
      [v.damage, v.defArmor, v.defPenBps, v.critBps, v.critDamageBps, v.hitBps, v.dodgeBps, v.lifestealBps, v.takenDownBps],
      v.statBases,
      v.alive,
    );

    this.buffFx.visible = v.buffed;
    // Chip hiệu ứng: mỗi chip là MỘT icon chỉ số kèm giá trị tăng/giảm cụ thể
    // + chip "PK" cho nội tại Phản kích.
    const toneColor = { buff: C.ok, debuff: C.debuff, burn: C.burn } as const;
    const chips = v.effects.map((e) => ({ icon: e.icon, text: e.text, color: toneColor[e.tone] }));
    if (this.u.counter) chips.push({ icon: undefined, text: 'PK', color: C.gold2 });
    this.setChips(v.alive ? chips : []);
    this.stunFx.visible = v.stunned;
    this.tgtFx.visible = targeted;
    this.actFx.visible = acting;
    // "Tới lượt": chỉ hiện ở tướng đang hành động (kể cả lượt bị bỏ do choáng)
    this.turnC.visible = acting;

    // Tướng gục mờ hẳn; tướng bị choáng làm dịu chân dung nhưng số liệu vẫn rõ nét
    this.root.alpha = v.alive ? 1 : 0.35;
    this.artC.alpha = v.alive ? (v.stunned ? 0.6 : 1) : 0.5;
  }

  /**
   * Ba hàng chỉ số có ICON: hàng 1 = [kiếm] sát thương · [giáp] phòng thủ · [xuyên] xuyên giáp;
   * hàng 2 = [tia sét] chí mạng · [vụ nổ] ST chí mạng · [mắt] chính xác;
   * hàng 3 = [gió] né tránh · [giọt máu] hút máu · [khiên] giảm ST nhận.
   * Mỗi hàng đúng 3 chỉ số nên các hàng luôn ngang hàng nhau; tự canh giữa và tự thu nhỏ khi tràn ô.
   * Màu tô theo TỪNG chỉ số: hiện tại cao hơn chỉ số nền → xanh, thấp hơn → đỏ, bằng → trắng.
   * Icon chỉ vẽ lại khi MÀU của chính nó đổi để không phải nạp lại SVG mỗi sự kiện.
   */
  private setInfoLine(values: number[], bases: number[], alive: boolean): void {
    const texts = values.map((v) => num(v));
    // Sát thương (0) và Giáp (1) giữ số thô. Xuyên giáp (2) · Chính xác (5) · Né tránh (6) hiện theo
    // ĐIỂM (1 điểm = 1%, số thô, không kèm %); các chỉ số còn lại hiện theo %.
    for (let i = 2; i < texts.length; i++) {
      const v = (values[i]! / 100).toFixed(0);
      texts[i] = POINT_STAT_IDX.has(i) ? v : `${v}%`;
    }
    let k = 0;
    for (const row of this.infoRows) {
      for (const t of row.vals) {
        const tone = values[k]! > bases[k]! ? C.infoUp : values[k]! < bases[k]! ? C.debuff : C.text;
        t.text = texts[k]!;
        t.style.fill = tone;
        if (this.infoTones[k] !== tone) {
          this.infoTones[k] = tone;
          drawIcon(this.infoIcons[k]!, INFO_ITEMS[k]!, INFO_FONT + 2, tone);
        }
        k += 1;
      }
    }
    const size = INFO_FONT + 2;
    const gap = 2;
    for (let r = 0; r < this.infoRows.length; r++) {
      const row = this.infoRows[r]!;
      const sepW = row.seps.length ? row.seps[0]!.width : 0;
      let total = row.vals.length * (size + gap) + row.seps.length * (sepW + gap * 2);
      for (const t of row.vals) total += t.width;
      // Chỉ số dài (số lớn / nhiều chữ số) thu nhỏ vừa bề rộng ô thay vì tràn ra ngoài.
      const scale = total > COL_W - 8 ? (COL_W - 8) / total : 1;
      row.c.scale.set(scale);
      row.c.position.set((COL_W - total * scale) / 2, INFO_ROW_Y[r]!);
      let x = 0;
      for (let i = 0; i < row.vals.length; i++) {
        if (i) {
          const sep = row.seps[i - 1]!;
          sep.position.set(x + gap + sepW / 2, 0);
          x += gap + sepW + gap;
        }
        row.icons[i]!.position.set(x, -size / 2);
        x += size + gap;
        row.vals[i]!.position.set(x, 0);
        x += row.vals[i]!.width;
      }
    }
    this.infoC.visible = alive;
  }

  /**
   * Cập nhật hàng chip hiệu ứng (tạo lười, canh phải ở góc trên ô).
   * Mỗi chip = icon chỉ số + giá trị tăng/giảm; nội dung có thể dài nên tự thu nhỏ cỡ chữ
   * rồi xuống dòng (tối đa 2 hàng) để không bao giờ tràn ra ngoài ô.
   */
  private setChips(items: { icon?: IconId; text: string; color: number }[]): void {
    // Nội dung y hệt lần trước (đa số sự kiện chỉ đổi máu, không đổi hiệu ứng) → giữ nguyên, khỏi dựng lại.
    const sig = items.map((it) => `${it.icon ?? '-'}:${it.color}:${it.text}`).join('|');
    if (sig === this.chipSig) return;
    this.chipSig = sig;
    while (this.chips.length < items.length) {
      const bg = new Graphics();
      const ico = new Graphics();
      const t = new Text({ text: '', style: { fontFamily: NUM_FONT, fontSize: CHIP_FONT, fontWeight: '800', fill: 0xffffff } });
      t.anchor.set(0.5);
      const c = new Container();
      c.addChild(bg, ico, t);
      this.chips.push({ c, bg, ico, t, w: 0, icoKey: '' });
      this.fxC.addChild(c);
    }
    for (const chip of this.chips) chip.c.visible = false;
    if (!items.length) {
      this.fxC.visible = false;
      return;
    }

    const avail = COL_W - 12;
    const pad = 5;
    const gap = 3;
    let font = CHIP_FONT;
    let widths: number[] = [];
    let rows: number[][] = [];
    // Giảm dần cỡ chữ cho tới khi xếp vừa trong 2 hàng (hoặc chạm cỡ nhỏ nhất).
    for (;;) {
      widths = items.map((it, i) => {
        const t = this.chips[i]!.t;
        t.text = it.text;
        t.style.fill = it.color;
        t.style.fontSize = font;
        return t.width + pad * 2 + (it.icon ? font + 2 + gap : 0);
      });
      rows = [];
      let cur: number[] = [];
      let curW = 0;
      for (let i = 0; i < widths.length; i++) {
        const w = widths[i]!;
        const add = cur.length === 0 ? w : w + CHIP_GAP;
        if (cur.length > 0 && curW + add > avail) {
          rows.push(cur);
          cur = [i];
          curW = w;
        } else {
          cur.push(i);
          curW += add;
        }
      }
      if (cur.length) rows.push(cur);
      if (rows.length <= CHIP_MAX_ROWS || font <= CHIP_FONT_MIN) break;
      font -= 0.5;
    }

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r]!;
      const total = row.reduce((a, i, k) => a + widths[i]! + (k ? CHIP_GAP : 0), 0);
      let x = COL_W - 6 - total;
      for (const i of row) {
        const item = items[i]!;
        const chip = this.chips[i]!;
        const w = widths[i]!;
        const icoSize = font + 2;
        const textW = chip.t.width;
        chip.bg
          .clear()
          .roundRect(-w / 2, -8, w, 16, 8)
          .fill({ color: 0x0a0604, alpha: 0.9 })
          .stroke({ width: 1, color: item.color, alpha: 0.85 });
        // Icon chỉ vẽ lại khi đổi hình hoặc đổi màu (nạp chuỗi SVG khá tốn).
        const key = item.icon ? `${item.icon}:${item.color}` : '';
        if (chip.icoKey !== key) {
          chip.icoKey = key;
          if (item.icon) drawIcon(chip.ico, item.icon, icoSize, item.color);
          else chip.ico.clear();
        }
        chip.ico.visible = !!item.icon;
        const left = -w / 2 + pad;
        if (item.icon) chip.ico.position.set(left, -icoSize / 2);
        chip.t.position.set(left + (item.icon ? icoSize + gap : 0) + textW / 2, 0);
        chip.c.position.set(x + w / 2, r * 16);
        chip.c.visible = true;
        x += w + CHIP_GAP;
      }
    }
    this.fxC.visible = true;
  }

  /**
   * Vẽ lại thanh máu + thanh khiên.
   * Thanh khiên neo ở MÉP PHẢI CỦA THANH MÁU ĐANG CÓ (đi theo máu, không cố định ở cuối ô)
   * rồi mọc dài về bên trái, nên khi máu tụt thì khiên trôi theo và luôn dính liền thanh máu.
   * Chỗ NỐI giữa khiên và máu để VUÔNG (không bo) — hai thanh trông liền một mạch, chỉ bo ở hai
   * đầu NGOÀI của cả thanh.
   */
  private drawBars(): void {
    const hpW = Math.max(0.5, HP_W * this.hpShown);
    // Thanh máu: bo cả hai đầu; đầu NGOÀI (phải) trùng khít với thanh khiên khi có khiên phủ lên.
    this.hpFill.clear().roundRect(8, HP_Y, hpW, HP_H, BAR_R).fill({ color: this.mine ? C.hp : C.hpEnemy });

    this.shieldFill.clear();
    if (this.shieldShown > 0.001) {
      const w = Math.max(0.5, HP_W * this.shieldShown);
      const x0 = 8 + hpW - w;
      this.shieldFill
        .roundRect(x0, HP_Y, w, HP_H, BAR_R)
        // Mép TRÁI thanh khiên là mối nối với thanh máu → vuông, chỉ bo mép phải (đầu ngoài).
        .rect(x0, HP_Y, Math.min(BAR_R, w), HP_H)
        .fill({ color: 0xe8edf2, alpha: 0.92 });
    }
  }

  /** Cập nhật hoạt ảnh của ô; trả về `true` nếu còn thay đổi hình (để sân biết khi nào ngừng vẽ). */
  update(dt: number, time: number): boolean {
    let moved = false;
    // Thanh máu chạy mượt về giá trị thật
    if (Math.abs(this.hpShown - this.hpTarget) > 0.002) {
      this.hpShown += (this.hpTarget - this.hpShown) * Math.min(1, dt / 90);
      if (Math.abs(this.hpShown - this.hpTarget) <= 0.002) this.hpShown = this.hpTarget;
      moved = true;
    }
    // Thanh khiên (trắng nhạt) chạy mượt và tự ẩn khi hết khiên.
    if (Math.abs(this.shieldShown - this.shieldTarget) > 0.002) {
      this.shieldShown += (this.shieldTarget - this.shieldShown) * Math.min(1, dt / 120);
      if (Math.abs(this.shieldShown - this.shieldTarget) <= 0.002) this.shieldShown = this.shieldTarget;
      moved = true;
    }
    if (moved) this.drawBars();
    // Ô của tướng đang ra đòn nhô lên nhẹ
    const ty = this.baseY - (this.actFx.visible ? 3 : 0);
    if (Math.abs(this.root.y - ty) > 0.05) {
      this.root.y += (ty - this.root.y) * Math.min(1, dt / 70);
      moved = true;
    } else if (this.root.y !== ty) {
      this.root.y = ty;
      moved = true;
    }
    if (this.stunFx.visible) {
      this.stunRing.rotation += dt * 0.0042;
      const r = ART_R + 8;
      for (let i = 0; i < this.stars.length; i++) {
        const a = time * 0.0042 + (i * Math.PI * 2) / this.stars.length;
        this.stars[i]!.position.set(Math.cos(a) * r, Math.sin(a) * r);
      }
      moved = true;
    }
    // Nhãn "Tới lượt" nhấp nháy nhẹ để mắt bắt ngay tướng đang đánh
    if (this.turnC.visible) {
      this.turnC.alpha = 0.72 + 0.28 * Math.sin(time * 0.007);
      moved = true;
    }
    return moved;
  }
}

class Arena implements ArenaHandle {
  private readonly app = new Application();
  private readonly root = new Container();
  private readonly fxLayer = new Container();
  private readonly tiles = new Map<number, Tile>();
  private readonly fx: FloatFx[] = [];
  /** Hiệu ứng kỹ năng đang chạy (niệm chiêu ở người thi triển + va chạm trên mục tiêu). */
  private readonly effs: Fx[] = [];
  private readonly reduce = prefersReducedMotion();
  private readonly units: ArenaUnit[];
  private readonly mySide: PvpSide;
  /** Bố cục sân (ngang/dọc) — chọn theo bề rộng khung lúc dựng sân. */
  private readonly layout: ArenaLayout;
  /** Kích thước khung vẽ của bố cục đang dùng (dùng để kẹp số bay, dò toạ độ chuột, vẽ vạch giữa). */
  private readonly W: number;
  private readonly H: number;
  /** Mô tả hiệu ứng đang có của từng tướng — ghép vào chú thích khi rê chuột lên ô. */
  private readonly fxInfo = new Map<number, string>();
  /**
   * Nhãn tên chiêu đang thi triển. Đặt riêng TRÊN lớp hiệu ứng (không nằm trong ô tướng) nên
   * không bị ô tướng choáng/gục làm mờ và không bị ô khác che — luôn nổi rõ trên sân đấu.
   */
  private readonly skillC = new Container();
  private readonly skillBg = new Graphics();
  private readonly skillT = new Text({
    text: '',
    style: {
      fontFamily: NUM_FONT,
      fontSize: 20,
      fontWeight: '900',
      letterSpacing: 0.4,
      fill: 0xfff4d2,
      stroke: { color: 0x3a1c05, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.8, blur: 6, distance: 0, angle: 0 },
    },
  });
  private skillKey = '';
  private skillW = 200;
  private skillH = 31;
  private skillAge = 0;
  private time = 0;
  private dead = false;
  /**
   * Có thay đổi cần vẽ lại không. Ta gỡ `render` khỏi ticker và TỰ gọi `render` khi cần:
   * sân đứng yên (hết hoạt ảnh) thì không vẽ nữa — đỡ đốt GPU/CPU liên tục (nguồn nóng máy → giật trên iPhone).
   */
  private dirty = true;
  /** Handler `visibilitychange` (dừng vẽ khi tab ẩn) — giữ lại để gỡ khi dọn sân. */
  private onVis: (() => void) | undefined;

  constructor(units: ArenaUnit[], mySide: PvpSide, layout: ArenaLayout) {
    this.units = units;
    this.mySide = mySide;
    this.layout = layout;
    const { w, h } = ARENA_SIZE[layout];
    this.W = w;
    this.H = h;
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      width: this.W,
      height: this.H,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    // Sân đấu là hoạt ảnh 2D đơn giản: khoá 60fps để trên máy tần số quét cao (iPhone ProMotion 120Hz)
    // không phải vẽ gấp đôi mỗi giây — nguồn gây giật chính trên mobile, còn laptop 60Hz giữ nguyên.
    this.app.ticker.maxFPS = 60;
    // Gỡ `render` tự động khỏi ticker: ta tự gọi `this.app.render()` trong `tick` CHỈ khi sân còn thay đổi
    // hình. Sân đứng yên mà vẫn vẽ 60fps là nguồn nóng máy → throttle → giật trên mobile.
    this.app.ticker.remove(this.app.render, this.app);
    // Kích thước do CSS quyết định (`.rp-canvas canvas`): co VỪA KHUNG theo cả bề ngang lẫn chiều cao
    // mà vẫn giữ tỉ lệ 900:560 — nên ép về `auto` để `max-width/max-height: 100%` phát huy tác dụng.
    this.app.canvas.style.width = 'auto';
    this.app.canvas.style.height = 'auto';
    this.app.stage.addChild(this.root);
    host.appendChild(this.app.canvas);
    // Canvas tự vẽ nên phải tự dò toạ độ: rê chuột lên ô tướng => hiện chú thích chỉ số đầy đủ.
    const canvas = this.app.canvas;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * this.W) / r.width;
      const y = ((e.clientY - r.top) * this.H) / r.height;
      let title = '';
      for (const u of this.units) {
        const p = tilePos(u.side, u.slot, this.mySide, this.layout);
        if (x >= p.x && x <= p.x + COL_W && y >= p.y && y <= p.y + TILE_H) {
          title = [u.info ?? '', this.fxInfo.get(u.idx) ?? ''].filter(Boolean).join('\n');
          break;
        }
      }
      canvas.title = title;
    });
    this.drawChrome();
    for (const u of this.units) {
      const t = new Tile(u, this.mySide, this.layout);
      this.tiles.set(u.idx, t);
      this.root.addChild(t.root);
    }
    this.root.addChild(this.fxLayer);
    // Nhãn tên chiêu nằm trên cùng: luôn nổi rõ, không bị ô tướng hay hiệu ứng khác che
    this.skillT.anchor.set(0.5);
    this.skillC.addChild(this.skillBg, this.skillT);
    this.skillC.visible = false;
    this.root.addChild(this.skillC);
    this.app.ticker.add((ticker) => this.tick(ticker.deltaMS));
    // Tab bị ẩn (chuyển app / tắt màn hình trên mobile) thì dừng vẽ — không đốt GPU khi không ai xem.
    this.onVis = () => {
      if (document.visibilityState === 'hidden') this.app.ticker.stop();
      else {
        // Quay lại tab: nội dung canvas có thể đã bị hệ điều hành xoá → vẽ lại một khung cho chắc.
        this.dirty = true;
        this.app.ticker.start();
      }
    };
    document.addEventListener('visibilitychange', this.onVis);
    // Chân dung nạp nền: sân đấu dùng được ngay, ảnh xong thì gắn vào sau
    void loadPortraits(this.units.map((u) => u.artKey)).then(() => {
      if (this.dead) return;
      for (const u of this.units) {
        const tex = portraitTex.get(u.artKey);
        if (tex) this.tiles.get(u.idx)?.setPortrait(tex);
      }
      this.dirty = true;
    });
  }

  /** Vạch phân cách giữa hai đội (tên đội đã có ở header nên sân đấu không lặp lại). */
  private drawChrome(): void {
    const line = new Graphics();
    const vs = new Text({ text: 'VS', style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: '800', fill: C.gold2 } });
    vs.anchor.set(0.5);
    let px: number;
    let py: number;
    if (this.layout === 'portrait') {
      // Bố cục dọc: vạch NGANG nằm đúng giữa hai hàng trước (đội mình ở trên, đội địch ở dưới)
      const top = ROW_Y0 + 2 * TILE_H + ROW_GAP;
      const bottom = ROW_Y0 + 2 * (TILE_H + ROW_GAP) + PORT_DIV_GAP;
      px = this.W / 2;
      py = (top + bottom) / 2;
      line.roundRect(8, py - 1, this.W - 16, 2, 1).fill({ color: C.gold, alpha: 0.35 });
    } else {
      px = this.W / 2;
      py = this.H / 2;
      line.roundRect(px - 1, 8, 2, this.H - 16, 1).fill({ color: C.gold, alpha: 0.35 });
    }
    const pill = new Graphics().roundRect(px - 15, py - 11, 30, 22, 11).fill({ color: C.panel });
    pill.stroke({ width: 1, color: C.gold, alpha: 0.45 });
    vs.position.set(px, py);
    this.root.addChild(line, pill, vs);
  }

  sync(s: ArenaSnapshot): void {
    if (this.dead) return;
    this.dirty = true;
    for (const [idx, t] of this.tiles) {
      const v = s.view[idx];
      if (!v) continue;
      t.apply(v, s.acting === idx, s.targets.includes(idx));
      this.fxInfo.set(idx, v.effects.length ? `Hiệu ứng đang có: ${v.effects.map((e) => e.text).join(' · ')}` : '');
    }
    this.setSkillName(s.acting, s.skillName);
  }

  /** Hiện tên chiêu đang thi triển trên ô của tướng ra đòn; `null` thì ẩn. */
  private setSkillName(acting: number | null, name: string | null): void {
    this.dirty = true;
    const tile = acting === null ? undefined : this.tiles.get(acting);
    if (!name || !tile) {
      this.skillC.visible = false;
      this.skillKey = '';
      return;
    }
    const key = `${acting}:${name}`;
    if (key !== this.skillKey) {
      this.skillKey = key;
      this.skillAge = 0;
      this.skillT.text = name;
      // Khung nền ôm theo tên chiêu: nền nâu đậm + viền vàng kép (viền ngoài mờ làm quầng sáng)
      const w = Math.ceil(this.skillT.width) + 36;
      const h = 31;
      this.skillW = w;
      this.skillH = h;
      this.skillBg
        .clear()
        .roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 19)
        .stroke({ width: 5, color: C.gold2, alpha: 0.28 })
        .roundRect(-w / 2, -h / 2, w, h, 17)
        .fill({ color: 0x1c0f05, alpha: 0.96 })
        .stroke({ width: 2, color: C.gold2, alpha: 0.95 });
    }
    // Ghim trong sân: tên chiêu dài không được tràn ra ngoài khung canvas
    const x = Math.min(Math.max(tile.centerX, this.skillW / 2 + 4), this.W - this.skillW / 2 - 4);
    // Nhãn luôn nằm NGAY TRÊN ô tướng (`topY - 8`) cho mọi slot, kể cả hàng đầu (1/4) nhờ lề trên
    // `ROW_Y0` đã chừa sẵn chỗ; hai đầu kẹp chỉ còn là chốt an toàn khi tên chiêu quá dài.
    const halfH = (this.skillH / 2 + 6) * 1.14;
    const y = Math.min(Math.max(tile.topY - 8, halfH), this.H - halfH);
    this.skillC.visible = true;
    this.skillC.position.set(x, y);
  }

  float(idx: number, parts: FloatPart[], crit: boolean, tone: FloatTone = 'damage'): void {
    if (this.dead) return;
    const t = this.tiles.get(idx);
    if (!t) return;
    this.dirty = true;
    this.fx.push(new FloatFx(this.fxLayer, this.W, t.centerX, t.topY + 34, parts, crit, tone, this.reduce));
  }

  /** Hiệu ứng niệm chiêu ở người thi triển (kiểu theo nhóm kỹ năng; màu + sắc thái theo tướng). */
  cast(idx: number, skill: PvpSkill): void {
    const t = this.tiles.get(idx);
    const u = this.units.find((x) => x.idx === idx);
    if (this.dead || !t || !u) return;
    this.spawn(t, u, castKindOf(skill), 'cast');
  }

  /** Hiệu ứng va chạm trên mục tiêu (kiểu theo sự kiện; màu + sắc thái theo tướng trúng đòn). */
  impact(idx: number, kind: FxKind): void {
    const t = this.tiles.get(idx);
    const u = this.units.find((x) => x.idx === idx);
    if (this.dead || !t || !u) return;
    this.spawn(t, u, kind, 'hit');
  }

  private spawn(t: Tile, u: ArenaUnit, kind: FxKind, phase: 'cast' | 'hit'): void {
    this.dirty = true;
    this.effs.push(
      spawnSkillFx(this.fxLayer, {
        x: t.centerX,
        y: t.centerY,
        kind,
        color: FACTION_STYLE[u.faction].color,
        seed: seedOf(u.artKey) + (phase === 'hit' ? 7 : 0),
        phase,
        reduce: this.reduce,
      }),
    );
  }

  private tick(dt: number): void {
    this.time += dt;
    // `active` = còn thứ gì đó đang đổi hình (ô tướng, số bay, hiệu ứng kỹ năng, nhãn tên chiêu).
    // Chỉ khi `active` (hoặc có thay đổi chờ vẽ) mới gọi `render` — sân đứng yên thì bỏ qua hẳn.
    let active = false;
    for (const t of this.tiles.values()) if (t.update(dt, this.time)) active = true;
    if (this.fx.length) active = true;
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!;
      if (f.tick(dt)) {
        // `context: true` để hủy luôn GraphicsContext của icon trong số bay (tránh rò rỉ context mỗi lần).
        f.c.destroy({ children: true, context: true });
        this.fx.splice(i, 1);
      }
    }
    if (this.effs.length) active = true;
    for (let i = this.effs.length - 1; i >= 0; i--) {
      const e = this.effs[i]!;
      if (e.tick(dt)) {
        e.destroy();
        this.effs.splice(i, 1);
      }
    }
    // Tên chiêu bật nảy: phóng vọt lên rồi co về đúng cỡ, kèm quầng vàng nhấp nháy nhẹ
    if (this.skillC.visible) {
      active = true;
      this.skillAge += dt;
      const grow = easeOut(Math.min(1, this.skillAge / 150));
      const settle = easeOut(Math.min(1, Math.max(0, (this.skillAge - 150) / 170)));
      this.skillC.scale.set(0.62 + 0.52 * grow - 0.14 * settle);
      this.skillC.alpha = Math.min(1, 0.25 + 1.9 * grow);
      this.skillBg.alpha = 0.94 + 0.06 * Math.sin(this.time * 0.006);
    }
    if (active || this.dirty) {
      this.app.render();
      this.dirty = false;
    }
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    if (this.onVis) {
      document.removeEventListener('visibilitychange', this.onVis);
      this.onVis = undefined;
    }
    for (const e of this.effs) e.destroy();
    this.effs.length = 0;
    try {
      // `context: true` để hủy cả GraphicsContext của mọi Graphics con (ô tướng, icon…) khi đóng sân.
      this.app.destroy(true, { children: true, texture: true, context: true });
    } catch {
      /* ignore */
    }
  }
}

/** Bố cục phù hợp cho khung rộng `px`: khung hẹp (mobile) dùng sân DỌC để ô tướng phóng to hơn hẳn. */
export const arenaLayoutFor = (px: number): ArenaLayout => (px <= 640 ? 'portrait' : 'landscape');

/** Tạo sân đấu PixiJS trong `host`. Trả về handle để đẩy trạng thái/hiệu ứng và dọn khi đóng. */
export async function createArena(
  host: HTMLElement,
  units: ArenaUnit[],
  mySide: PvpSide,
  layout: ArenaLayout = 'landscape',
): Promise<ArenaHandle> {
  const arena = new Arena(units, mySide, layout);
  await arena.init(host);
  return arena;
}
