import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { Faction, PvpSide, PvpSkill, PvpStyle } from '@tq/shared';
import { FACTION_STYLE, initials, levelTier, portraitUrl, prefersReducedMotion } from '../art.ts';
import { castKindOf, spawnSkillFx, type Fx, type FxKind } from './skillsfx.ts';

/**
 * Sân đấu PvP vẽ bằng PixiJS (mục 6.7).
 * Canvas chỉ HIỂN THỊ lại dữ liệu server đã mô phỏng sẵn: mỗi sự kiện phát lại trong
 * `BattleReplay` được đẩy sang đây qua `sync()` / `float()`, không tính toán gì thêm.
 * Bố cục: bên mình nửa trái, đối thủ nửa phải, ngăn giữa bằng dải phân cách; mỗi bên 2 cột
 * (hàng sau ở ngoài, hàng trước sát vạch giữa) × 3 hàng, khớp đúng sơ đồ 6 ô của engine.
 */

const W = 900;
const H = 444;
/** Bề rộng dải phân cách giữa hai đội. */
const DIV_W = 28;
const SIDE_GAP = 10;
const SIDE_W = (W - DIV_W) / 2 - SIDE_GAP;
const PAD = 6;
const COL_GAP = 8;
const COL_W = (SIDE_W - PAD * 2 - COL_GAP) / 2;
const TILE_H = 130;
const ROW_GAP = 6;
const ROW_Y0 = 26;
/** Vòng chân dung trong ô (56px, khớp ô tướng ở trang chuẩn bị chiến). */
const ART_R = 28;
const ART_CY = 16 + ART_R;
/** Thanh máu + số máu + dòng chỉ số trong ô. */
const HP_W = COL_W - 16;
const HP_Y = 96;
const HP_H = 6;
const NUM_Y = 108;
const INFO_Y = 120;
/** Tên tướng nằm ngay dưới chân dung (khớp font/màu ô tướng ở trang chuẩn bị chiến). */
const NAME_Y = 82;
/** Chip hiệu ứng trên ô: cỡ chữ tối đa/tối thiểu, khoảng cách, số hàng tối đa khi phải xuống dòng. */
const CHIP_FONT = 10;
const CHIP_FONT_MIN = 8;
const CHIP_GAP = 4;
const CHIP_MAX_ROWS = 2;

const NUM_FONT = "'Oswald', 'Arial Narrow', system-ui, sans-serif";
const UI_FONT = 'system-ui, sans-serif';

const C = {
  line: 0x2c303b,
  panel: 0x171920,
  panel2: 0x1f222b,
  text: 0xecebe6,
  gold: 0xd4a84a,
  gold2: 0xf3d58a,
  ok: 0x3fbf7f,
  bad: 0xef5b5b,
  muted: 0x9aa0ab,
  hpMine: 0x3fbf7f,
  hpFoe: 0xd9534f,
  numMine: 0xb9e8cd,
  numFoe: 0xf3b6b2,
  numLow: 0xffd75e,
  info: 0xffcf8a,
  infoUp: 0x9df3c2,
  dmg: 0xff7a66,
  heal: 0x6ef0a6,
  crit: 0xffd75e,
  stun: 0xffd75e,
  debuff: 0xc08bff,
  burn: 0xff9a4d,
};

/** Màu nhãn phong cách chiến đấu (khớp .pvp-style ở trang chuẩn bị chiến). */
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
  alive: boolean;
  stunned: boolean;
  /** Đang được tăng sức mạnh → dòng chỉ số sáng xanh. */
  buffed: boolean;
  /** Đang bị giảm sức mạnh → dòng chỉ số đổi màu tím. */
  debuffed: boolean;
  /** Sát thương hiện tại = nền + buff − debuff (chỉ để hiển thị). */
  damage: number;
  /** Tỉ lệ chí mạng hiện tại (bps) = nền + buff − debuff. */
  critBps: number;
  /** Sát thương chí mạng hiện tại (bps) = nền + buff − debuff. */
  critDamageBps: number;
  /** Hiệu ứng đang có trên tướng — hiển thị RÕ tăng/giảm chỉ số nào và bao nhiêu (chip trên ô). */
  effects: { text: string; tone: 'buff' | 'debuff' | 'burn' }[];
}

export interface ArenaSnapshot {
  view: Record<number, ArenaView>;
  acting: number | null;
  skillName: string | null;
  targets: number[];
}

export interface ArenaHandle {
  sync(s: ArenaSnapshot): void;
  /** Số sát thương/hồi máu/buff bay lên trên ô tướng. */
  float(idx: number, text: string, crit: boolean, heal?: boolean): void;
  /** Hiệu ứng niệm chiêu ở ô tướng thi triển, kiểu theo nhóm kỹ năng + phe + sắc thái riêng tướng. */
  cast(idx: number, skill: PvpSkill): void;
  /** Hiệu ứng va chạm trên ô mục tiêu, kiểu theo sự kiện (sát thương, hồi máu, buff, debuff…). */
  impact(idx: number, kind: FxKind): void;
  destroy(): void;
}

const colXLeft = (col: number) => PAD + col * (COL_W + COL_GAP);
const colXRight = (col: number) => W - SIDE_W + colXLeft(col);

/** Băm artKey thành số dương ổn định — làm "sắc thái riêng" cho hiệu ứng kỹ năng của từng tướng (FNV-1a). */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Toạ độ ô tướng: bên mình ở nửa trái, hàng trước luôn sát vạch giữa. */
function tilePos(side: PvpSide, slot: number, mySide: PvpSide) {
  const mine = side === mySide;
  const col = mine === (slot <= 3) ? 1 : 0;
  const row = (slot - 1) % 3;
  return { x: mine ? colXLeft(col) : colXRight(col), y: ROW_Y0 + row * (TILE_H + ROW_GAP) };
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

/** Số sát thương/hồi máu bay lên rồi tan. Luôn rõ nét: chỉ mờ ở 20% cuối của hoạt ảnh. */
class FloatFx {
  readonly text: Text;
  private readonly y0: number;
  private readonly crit: boolean;
  private readonly reduce: boolean;
  private readonly ms: number;
  private t = 0;

  constructor(parent: Container, x: number, y: number, label: string, crit: boolean, heal: boolean, reduce: boolean) {
    this.crit = crit;
    this.reduce = reduce;
    this.y0 = y;
    this.ms = reduce ? 500 : crit ? 1050 : 950;
    this.text = new Text({
      text: label,
      style: {
        fontFamily: NUM_FONT,
        fontSize: crit ? 40 : 26,
        fontWeight: '900',
        fill: crit ? C.crit : heal ? C.heal : C.dmg,
        stroke: { color: 0x000000, width: crit ? 5 : 4 },
      },
    });
    this.text.anchor.set(0.5);
    this.text.position.set(x, y);
    parent.addChild(this.text);
  }

  tick(dt: number): boolean {
    this.t += dt;
    const p = Math.min(1, this.t / this.ms);
    const e = easeOut(p);
    const grow = easeOut(Math.min(1, p / 0.25));
    this.text.y = this.y0 - (this.reduce ? 0 : e * (this.crit ? 36 : 26));
    this.text.scale.set(this.crit ? 0.75 + 0.25 * grow : 0.9 + 0.1 * grow);
    this.text.alpha = p < 0.8 ? 1 : 1 - (p - 0.8) / 0.2;
    return p >= 1;
  }
}

/** Một ô tướng trên sân: khung, chân dung tròn, tên, cấp, thanh máu, hiệu ứng trạng thái. */
class Tile {
  readonly root = new Container();
  private readonly u: ArenaUnit;
  private readonly baseY: number;
  private readonly color: number;
  private readonly artC = new Container();
  /** Chữ viết tắt phe/tên hiện khi CHƯA có ảnh chân dung; có ảnh thì ẩn để không lộ qua ảnh trong suốt. */
  private readonly iniT: Text;
  private readonly hpFill = new Graphics();
  private readonly hpT: Text;
  private readonly infoT: Text;
  private readonly buffFx: Graphics;
  /** Hàng chip hiệu ứng trạng thái ở góc trên phải ô: ▲ buff, ▼ suy yếu, 🔥 thiêu đốt, PK phản kích. */
  private readonly fxC = new Container();
  private readonly chips: { c: Container; bg: Graphics; t: Text; w: number }[] = [];
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

  constructor(u: ArenaUnit, mySide: PvpSide) {
    this.u = u;
    const mine = u.side === mySide;
    const { x, y } = tilePos(u.side, u.slot, mySide);
    this.baseY = y;
    this.color = mine ? C.hpMine : C.hpFoe;
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

    // Chip cấp độ góc trên trái — cùng kiểu chip với ô tướng ở trang chuẩn bị chiến
    const lv = new Text({ text: `Lv.${u.level}`, style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: '600', fill: levelTier(u.level).color } });
    const lvBg = new Graphics().roundRect(5, 5, lv.width + 14, 17, 999).fill({ color: 0xffffff, alpha: 0.04 });
    lvBg.stroke({ width: 1, color: C.line });
    lv.position.set(12, 6);

    // Chip phong cách chiến đấu xếp NGAY DƯỚI chip cấp độ (cùng canh trái): chỉ hiện icon
    // định danh — kiếm (Tấn công) / khiên (Phòng thủ) / sách (Hỗ trợ) — nhãn chữ nằm ở tooltip.
    const stY = 25;
    const stTone = STYLE_TONE[u.style];
    const stBg = new Graphics().roundRect(5, stY, 17, 17, 8).fill({ color: stTone, alpha: 0.14 });
    stBg.stroke({ width: 1, color: stTone, alpha: 0.85 });
    const stIcon = new Graphics();
    drawStyleIcon(stIcon, u.style);
    stIcon.position.set(7, stY + 2);

    // Tên tướng ngay dưới chân dung — font/màu khớp .pvp-cell-name ở trang chuẩn bị chiến
    const name = new Text({ text: u.name, style: { fontFamily: UI_FONT, fontSize: 12.5, fontWeight: '700', fill: C.text } });
    name.anchor.set(0.5);
    name.position.set(COL_W / 2, NAME_Y);

    const hpBg = new Graphics().roundRect(8, HP_Y, HP_W, HP_H, 3).fill({ color: 0xffffff, alpha: 0.1 });
    this.hpT = new Text({
      text: '',
      style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: '700', fill: mine ? C.numMine : C.numFoe },
    });
    this.hpT.anchor.set(0.5);
    this.hpT.position.set(COL_W / 2, NUM_Y);

    // Dòng chỉ số: cùng font/cỡ với .pvp-cell-stat (600 10.5px), chữ màu --text như số liệu ở trang chuẩn bị chiến
    this.infoT = new Text({ text: '', style: { fontFamily: NUM_FONT, fontSize: 10.5, fontWeight: '600', fill: C.text } });
    this.infoT.anchor.set(0.5);
    this.infoT.position.set(COL_W / 2, INFO_Y);

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
      stBg,
      stIcon,
      name,
      hpBg,
      this.hpFill,
      this.hpT,
      this.infoT,
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
    const pctv = Math.round(this.hpTarget * 100);
    const low = v.alive && this.hpTarget <= 0.25;
    this.hpT.text = v.alive ? `${num(v.hp)} · ${pctv}%` : 'Đã hạ';
    this.hpT.style.fill = v.alive ? (low ? C.numLow : this.color === C.hpMine ? C.numMine : C.numFoe) : C.muted;
    this.hpT.visible = true;

    // Dòng chỉ số sống theo buff/debuff: sát thương · tỉ lệ chí mạng · sát thương chí mạng.
    // Đang được buff thì sáng xanh, đang bị debuff thì tím, bình thường dùng màu chữ --text.
    this.infoT.text = `⚔ ${num(v.damage)} · CM ${(v.critBps / 100).toFixed(0)}% · STCM ${(v.critDamageBps / 100).toFixed(0)}%`;
    this.infoT.style.fill = v.buffed ? C.infoUp : v.debuffed ? C.debuff : C.text;
    // Chỉ số dài (số lớn / buff nhiều) có thể tràn ô: thu nhỏ vừa bề rộng ô.
    this.infoT.scale.set(1);
    if (this.infoT.width > COL_W - 8) this.infoT.scale.set((COL_W - 8) / this.infoT.width);
    this.infoT.visible = v.alive;

    this.buffFx.visible = v.buffed;
    // Chip hiệu ứng: nhìn vào ô là biết tướng đang được tăng / bị giảm chỉ số nào và bao nhiêu
    // (không dùng ký hiệu chung chung) + chip "PK" cho nội tại Phản kích.
    const toneColor = { buff: C.ok, debuff: C.debuff, burn: C.burn } as const;
    const chips = v.effects.map((e) => ({ text: e.text, color: toneColor[e.tone] }));
    if (this.u.counter) chips.push({ text: 'PK', color: C.gold2 });
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
   * Cập nhật hàng chip hiệu ứng (tạo lười, canh phải ở góc trên ô).
   * Nội dung chip là chỉ số cụ thể nên có thể dài: tự thu nhỏ cỡ chữ rồi xuống dòng (tối đa 2 hàng)
   * để không bao giờ tràn ra ngoài ô.
   */
  private setChips(items: { text: string; color: number }[]): void {
    while (this.chips.length < items.length) {
      const bg = new Graphics();
      const t = new Text({ text: '', style: { fontFamily: NUM_FONT, fontSize: CHIP_FONT, fontWeight: '800', fill: 0xffffff } });
      t.anchor.set(0.5);
      const c = new Container();
      c.addChild(bg, t);
      this.chips.push({ c, bg, t, w: 0 });
      this.fxC.addChild(c);
    }
    for (const chip of this.chips) chip.c.visible = false;
    if (!items.length) {
      this.fxC.visible = false;
      return;
    }

    const avail = COL_W - 12;
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
        return t.width + 10;
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
        const chip = this.chips[i]!;
        const w = widths[i]!;
        chip.bg
          .clear()
          .roundRect(-w / 2, -8, w, 16, 8)
          .fill({ color: 0x0a0604, alpha: 0.9 })
          .stroke({ width: 1, color: items[i]!.color, alpha: 0.85 });
        chip.c.position.set(x + w / 2, r * 16);
        chip.c.visible = true;
        x += w + CHIP_GAP;
      }
    }
    this.fxC.visible = true;
  }

  update(dt: number, time: number): void {
    // Thanh máu chạy mượt về giá trị thật
    if (Math.abs(this.hpShown - this.hpTarget) > 0.002) {
      this.hpShown += (this.hpTarget - this.hpShown) * Math.min(1, dt / 90);
      if (Math.abs(this.hpShown - this.hpTarget) <= 0.002) this.hpShown = this.hpTarget;
      this.hpFill
        .clear()
        .roundRect(8, HP_Y, Math.max(0.5, HP_W * this.hpShown), HP_H, 3)
        .fill({ color: this.color });
    }
    // Ô của tướng đang ra đòn nhô lên nhẹ
    const ty = this.baseY - (this.actFx.visible ? 3 : 0);
    this.root.y = Math.abs(this.root.y - ty) > 0.05 ? this.root.y + (ty - this.root.y) * Math.min(1, dt / 70) : ty;
    if (this.stunFx.visible) {
      this.stunRing.rotation += dt * 0.0042;
      const r = ART_R + 8;
      for (let i = 0; i < this.stars.length; i++) {
        const a = time * 0.0042 + (i * Math.PI * 2) / this.stars.length;
        this.stars[i]!.position.set(Math.cos(a) * r, Math.sin(a) * r);
      }
    }
    // Nhãn "Tới lượt" nhấp nháy nhẹ để mắt bắt ngay tướng đang đánh
    if (this.turnC.visible) this.turnC.alpha = 0.72 + 0.28 * Math.sin(time * 0.007);
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
      fontSize: 18,
      fontWeight: '900',
      letterSpacing: 0.4,
      fill: 0xfff4d2,
      stroke: { color: 0x3a1c05, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.8, blur: 6, distance: 0, angle: 0 },
    },
  });
  private skillKey = '';
  private skillW = 200;
  private skillAge = 0;
  private time = 0;
  private dead = false;

  constructor(units: ArenaUnit[], mySide: PvpSide) {
    this.units = units;
    this.mySide = mySide;
  }

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      width: W,
      height: H,
      backgroundAlpha: 0,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = 'auto';
    this.app.stage.addChild(this.root);
    host.style.aspectRatio = `${W} / ${H}`;
    host.appendChild(this.app.canvas);
    // Canvas tự vẽ nên phải tự dò toạ độ: rê chuột lên ô tướng => hiện chú thích chỉ số đầy đủ.
    const canvas = this.app.canvas;
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = ((e.clientX - r.left) * W) / r.width;
      const y = ((e.clientY - r.top) * H) / r.height;
      let title = '';
      for (const u of this.units) {
        const p = tilePos(u.side, u.slot, this.mySide);
        if (x >= p.x && x <= p.x + COL_W && y >= p.y && y <= p.y + TILE_H) {
          title = [u.info ?? '', this.fxInfo.get(u.idx) ?? ''].filter(Boolean).join('\n');
          break;
        }
      }
      canvas.title = title;
    });
    this.drawChrome();
    for (const u of this.units) {
      const t = new Tile(u, this.mySide);
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
    // Chân dung nạp nền: sân đấu dùng được ngay, ảnh xong thì gắn vào sau
    void loadPortraits(this.units.map((u) => u.artKey)).then(() => {
      if (this.dead) return;
      for (const u of this.units) {
        const tex = portraitTex.get(u.artKey);
        if (tex) this.tiles.get(u.idx)?.setPortrait(tex);
      }
    });
  }

  /** Vạch phân cách giữa hai đội (tên đội đã có ở header nên sân đấu không lặp lại). */
  private drawChrome(): void {
    const mid = W / 2;
    const line = new Graphics().roundRect(mid - 1, 8, 2, H - 16, 1).fill({ color: C.gold, alpha: 0.35 });
    const pill = new Graphics().roundRect(mid - 15, H / 2 - 11, 30, 22, 11).fill({ color: C.panel });
    pill.stroke({ width: 1, color: C.gold, alpha: 0.45 });
    const vs = new Text({ text: 'VS', style: { fontFamily: NUM_FONT, fontSize: 11, fontWeight: '800', fill: C.gold2 } });
    vs.anchor.set(0.5);
    vs.position.set(mid, H / 2);
    this.root.addChild(line, pill, vs);
  }

  sync(s: ArenaSnapshot): void {
    if (this.dead) return;
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
      const w = Math.ceil(this.skillT.width) + 34;
      const h = 27;
      this.skillW = w;
      this.skillBg
        .clear()
        .roundRect(-w / 2 - 3, -h / 2 - 3, w + 6, h + 6, 16)
        .stroke({ width: 5, color: C.gold2, alpha: 0.28 })
        .roundRect(-w / 2, -h / 2, w, h, 14)
        .fill({ color: 0x1c0f05, alpha: 0.96 })
        .stroke({ width: 2, color: C.gold2, alpha: 0.95 });
    }
    // Ghim trong sân: tên chiêu dài không được tràn ra ngoài khung canvas
    const x = Math.min(Math.max(tile.centerX, this.skillW / 2 + 4), W - this.skillW / 2 - 4);
    this.skillC.visible = true;
    this.skillC.position.set(x, tile.topY - 8);
  }

  float(idx: number, text: string, crit: boolean, heal = false): void {
    if (this.dead) return;
    const t = this.tiles.get(idx);
    if (!t) return;
    this.fx.push(new FloatFx(this.fxLayer, t.centerX, t.topY + 34, text, crit, heal, this.reduce));
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
    for (const t of this.tiles.values()) t.update(dt, this.time);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]!;
      if (f.tick(dt)) {
        f.text.destroy();
        this.fx.splice(i, 1);
      }
    }
    for (let i = this.effs.length - 1; i >= 0; i--) {
      const e = this.effs[i]!;
      if (e.tick(dt)) {
        e.destroy();
        this.effs.splice(i, 1);
      }
    }
    // Tên chiêu bật nảy: phóng vọt lên rồi co về đúng cỡ, kèm quầng vàng nhấp nháy nhẹ
    if (this.skillC.visible) {
      this.skillAge += dt;
      const grow = easeOut(Math.min(1, this.skillAge / 150));
      const settle = easeOut(Math.min(1, Math.max(0, (this.skillAge - 150) / 170)));
      this.skillC.scale.set(0.62 + 0.52 * grow - 0.14 * settle);
      this.skillC.alpha = Math.min(1, 0.25 + 1.9 * grow);
      this.skillBg.alpha = 0.94 + 0.06 * Math.sin(this.time * 0.006);
    }
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    for (const e of this.effs) e.destroy();
    this.effs.length = 0;
    try {
      this.app.destroy(true, { children: true, texture: true });
    } catch {
      /* ignore */
    }
  }
}

/** Tạo sân đấu PixiJS trong `host`. Trả về handle để đẩy trạng thái/hiệu ứng và dọn khi đóng. */
export async function createArena(host: HTMLElement, units: ArenaUnit[], mySide: PvpSide): Promise<ArenaHandle> {
  const arena = new Arena(units, mySide);
  await arena.init(host);
  return arena;
}
