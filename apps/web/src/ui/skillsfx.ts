import Phaser from 'phaser';
import type { PvpSkill } from '@tq/shared';

/**
 * Hiệu ứng kỹ năng khi thi triển / trúng đòn trong sân đấu PvP (mục 6.7) — bản Phaser.
 * Phân biệt theo 3 trục để 100 tướng đều có sắc thái riêng dù chỉ có 9 nhóm kỹ năng:
 *   1. Nhóm kỹ năng (`FxKind`) → kiểu hình khối (vòng niệm, lưỡi chém, ấn phù, hạt bay,…).
 *   2. Phe (`color`) → pha màu chủ đạo (Ngụy lam, Thục lục, Ngô đỏ, Quần tím).
 *   3. Sắc thái riêng từng tướng (`seed`) → số lưỡi/hạt, hoạ tiết phụ và accent màu khác nhau.
 *
 * Bản cũ dùng PixiJS (`legacy/src/pixi/skillsfx.ts`): cấu trúc hình khối giữ nguyên, chỉ đổi
 * cách vẽ (Pixi vẽ theo path tích luỹ, Phaser phải gọi thẳng `fillX/strokeX` hoặc
 * `beginPath/moveTo/lineTo/strokePath`).
 */

/** Loại hiệu ứng: theo nhóm kỹ năng khi thi triển, hoặc theo sự kiện khi trúng đòn. */
export type FxKind = 'damage' | 'heal' | 'buff' | 'debuff' | 'burn' | 'stun' | 'dispel' | 'purify';

/** Nhóm kỹ năng → kiểu hiệu ứng "niệm chiêu" ở người thi triển. */
const SKILL_KIND: Record<PvpSkill, FxKind> = {
  ATTACK: 'damage',
  STUN: 'stun',
  BUFF: 'buff',
  HEAL: 'heal',
  DEBUFF: 'debuff',
  BURN: 'burn',
  DISPEL: 'dispel',
  PURIFY: 'purify',
  CLEANSE: 'purify',
};

/** Nhóm kỹ năng → kiểu hiệu ứng (dùng cho hoạt ảnh niệm chiêu của người thi triển). */
export const castKindOf = (skill: PvpSkill): FxKind => SKILL_KIND[skill];

/**
 * Màu đặc trưng từng loại hiệu ứng (pha tiếp với màu phe và accent riêng tướng).
 * Theo QUY CHUẨN màu hiển thị Combat (khớp palette `C` trong `arena.ts` và `.rp-drow-*` ở theme.css):
 * sát thương bạch ngân · hồi máu/buff/khiên/choáng bích ngọc · thiêu đốt xích hỏa · debuff/xóa buff chu tước.
 */
const KIND_COLOR: Record<FxKind, number> = {
  damage: 0xe0d8c3,
  heal: 0x6FBE73,
  buff: 0x6FBE73,
  debuff: 0xDB5151,
  burn: 0xFF772E,
  stun: 0xA8A8A8,
  dispel: 0xDB5151,
  purify: 0x6FBE73,
};

/** Accent phụ để mỗi tướng (cùng nhóm + cùng phe) vẫn khác sắc độ. */
const ACCENTS = [0xffe6a0, 0x9ad7ff, 0xffb0d8, 0xb7ff9a] as const;

interface Style {
  /** Số vòng niệm lan ra (0 = không). */
  ring: number;
  /** Số lưỡi/tia toả ra (0 = không). */
  blades: number;
  /** Số hạt (0 = không). */
  motes: number;
  /** Hướng hạt: 1 bay lên, −1 rơi xuống, 0 toả tròn từ tâm. */
  moteDir: 1 | -1 | 0;
  /** Số cạnh ấn phù xoay (0 = không). */
  sigil: number;
  /** Chớp sáng ở tâm khi va chạm. */
  flash: boolean;
  /** Số ngôi sao văng ra (choáng). */
  stars: number;
  /** Thời lượng cơ bản (ms). */
  ms: number;
}

/** Kiểu hình khối theo từng loại hiệu ứng. */
const STYLE: Record<FxKind, Style> = {
  damage: { ring: 0, blades: 7, motes: 6, moteDir: 0, sigil: 0, flash: true, stars: 0, ms: 430 },
  heal: { ring: 1, blades: 0, motes: 8, moteDir: 1, sigil: 0, flash: false, stars: 0, ms: 640 },
  buff: { ring: 1, blades: 0, motes: 7, moteDir: 1, sigil: 0, flash: false, stars: 0, ms: 660 },
  debuff: { ring: 0, blades: 0, motes: 7, moteDir: -1, sigil: 5, flash: false, stars: 0, ms: 680 },
  burn: { ring: 0, blades: 0, motes: 9, moteDir: 1, sigil: 0, flash: true, stars: 0, ms: 580 },
  stun: { ring: 1, blades: 0, motes: 0, moteDir: 0, sigil: 0, flash: false, stars: 3, ms: 540 },
  dispel: { ring: 0, blades: 8, motes: 6, moteDir: 0, sigil: 0, flash: false, stars: 0, ms: 500 },
  purify: { ring: 1, blades: 0, motes: 8, moteDir: 1, sigil: 0, flash: false, stars: 0, ms: 660 },
};

/** Yêu cầu dựng một hiệu ứng tại một ô tướng. */
export interface FxRequest {
  /** Tâm ô tướng (toạ độ lớp hiệu ứng của sân đấu). */
  x: number;
  y: number;
  kind: FxKind;
  /** Màu phe để pha vào màu nhóm kỹ năng. */
  color: number;
  /** Sắc thái riêng từng tướng (băm từ artKey). */
  seed: number;
  /** 'cast' = niệm chiêu ở người thi triển (to hơn, chậm hơn), 'hit' = va chạm trên mục tiêu. */
  phase: 'cast' | 'hit';
  /** Người dùng bật "giảm chuyển động": hiệu ứng ngắn và nhẹ hơn. */
  reduce: boolean;
}

/** Hiệu ứng đang chạy; `tick` trả về true khi kết thúc để lớp gọi dọn nó. */
export interface Fx {
  tick(dt: number): boolean;
  destroy(): void;
}

const TAU = Math.PI * 2;
const UI_FONT = 'system-ui, sans-serif';

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Pha hai màu RGB theo tỉ lệ t (0..1). */
function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t));
  const g = Math.round(((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t));
  const bl = Math.round((a & 255) + (((b & 255) - (a & 255)) * t));
  return (r << 16) | (g << 8) | bl;
}

const css = (color: number) => `#${color.toString(16).padStart(6, '0')}`;

/** Vòng tròn rỗng (viền) — dùng cho vòng niệm lan ra. */
function ringGfx(scene: Phaser.Scene, radius: number, color: number, width: number): Phaser.GameObjects.Graphics {
  const g = new Phaser.GameObjects.Graphics(scene);
  g.lineStyle(width, color, 1);
  g.strokeCircle(0, 0, radius);
  return g;
}

/** Nhiều lưỡi/tia cùng gốc toả ra đều nhau — dùng cho chém và xé (dispel). */
function bladeGfx(scene: Phaser.Scene, count: number, len: number, color: number, width: number): Phaser.GameObjects.Graphics {
  const g = new Phaser.GameObjects.Graphics(scene);
  g.lineStyle(width, color, 1);
  g.beginPath();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    g.moveTo(Math.cos(a) * len * 0.3, Math.sin(a) * len * 0.3);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
  }
  g.strokePath();
  return g;
}

/** Ấn phù đa giác xoay (suy yếu/thiêu đốt/choáng) — hoạ tiết riêng của nhóm kỹ năng. */
function sigilGfx(scene: Phaser.Scene, sides: number, radius: number, color: number): Phaser.GameObjects.Graphics {
  const pts: Phaser.Math.Vector2[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    pts.push(new Phaser.Math.Vector2(Math.cos(a) * radius, Math.sin(a) * radius));
  }
  const g = new Phaser.GameObjects.Graphics(scene);
  g.lineStyle(2, color, 1);
  g.strokePoints(pts, true, true);
  // Nan hoa nối tâm ra từng đỉnh — nét mảnh, mờ hơn viền ấn phù.
  g.lineStyle(1, color, 0.55);
  g.beginPath();
  for (const p of pts) {
    g.moveTo(0, 0);
    g.lineTo(p.x * 0.55, p.y * 0.55);
  }
  g.strokePath();
  return g;
}

/** Phần tử hiệu ứng: chỉ cần thuộc tính biến đổi mà mọi GameObject đều có. */
type FxObj = Phaser.GameObjects.Graphics | Phaser.GameObjects.Text;

/** Một phần tử trong hiệu ứng, tự chạy theo thời gian (delay + thời lượng riêng). */
interface Part {
  obj: FxObj;
  x0: number;
  y0: number;
  delay: number;
  ms: number;
  fromScale: number;
  toScale: number;
  fromAlpha: number;
  toAlpha: number;
  /** Tốc độ xoay (rad/ms). */
  rot: number;
  /** Vận tốc di chuyển (px/ms). */
  vx: number;
  vy: number;
}

class SkillFx implements Fx {
  private readonly root: Phaser.GameObjects.Container;
  private readonly parts: Part[] = [];
  private readonly ms: number;
  private t = 0;

  constructor(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, req: FxRequest) {
    const st = STYLE[req.kind];
    const cast = req.phase === 'cast';
    const seed = req.seed >>> 0;
    const color = mix(mix(KIND_COLOR[req.kind], req.color, 0.35), ACCENTS[(seed >>> 5) % ACCENTS.length]!, 0.12);
    const soft = mix(color, 0xffffff, 0.4);

    this.root = new Phaser.GameObjects.Container(scene, req.x, req.y);
    this.ms = (st.ms + (cast ? 160 : 0)) * (req.reduce ? 0.5 : 1);
    // Biến thể riêng từng tướng: xoay gốc + cỡ tổng thể (niệm chiêu to hơn va chạm)
    this.root.rotation = ((seed % 360) * Math.PI) / 180;
    this.root.setScale((0.9 + ((seed >>> 4) % 6) * 0.03) * (cast ? 1.25 : 1));
    parent.add(this.root);

    const rot0 = ((seed % 360) * Math.PI) / 180;
    const dur = st.ms;
    // Niệm chiêu luôn có vòng + lưỡi (ATTACK/DISPEL) hoặc ấn phù (DEBUFF/BURN/STUN) để khác sự kiện trúng đòn
    const blades = (cast && st.blades === 0 ? (req.kind === 'damage' || req.kind === 'dispel' ? 6 : 0) : st.blades) + (seed % 3);
    const motes = (cast ? Math.max(st.motes, 5) : st.motes) + ((seed >>> 2) % 3);
    const rings = st.ring || cast ? 1 : 0;
    const sigil = st.sigil || (cast && (req.kind === 'debuff' || req.kind === 'burn' || req.kind === 'stun') ? 5 : 0);
    const flash = cast ? false : st.flash;
    // Sắc thái riêng tướng: nhóm 1 thêm vòng ngoài, nhóm 2 thêm ấn phù nếu chưa có
    const motif = seed % 3;

    if (rings) {
      this.push(ringGfx(scene, 30, color, 2.5), 0, dur, 0.5, 2, cast ? 0.35 : 0.9, 0, cast ? 0.0006 : 0);
    }
    if (motif === 1) {
      this.push(ringGfx(scene, 24, soft, 1.5), 90, dur, 0.6, 1.8, 0.8, 0, -0.0009);
    }
    if (sigil) {
      this.push(sigilGfx(scene, sigil, 22, soft), cast ? 60 : 0, dur, 0.6, 1.35, 0.95, 0, cast ? 0.0022 : 0.0016);
    } else if (motif === 2) {
      this.push(sigilGfx(scene, 4 + (seed % 3), 20, soft), 0, dur * 0.8, 0.6, 1.2, 0.75, 0, 0.0018);
    }
    if (blades > 0) {
      this.push(bladeGfx(scene, blades, 30, color, 3), cast ? 80 : 0, dur * 0.85, 0.5, 1.7, 1, 0, cast ? 0.0008 : 0.0012);
    }
    if (flash) {
      const g = new Phaser.GameObjects.Graphics(scene);
      g.fillStyle(mix(color, 0xffffff, 0.5), 1);
      g.fillCircle(0, 0, 26);
      this.push(g, 0, dur * 0.4, 0.4, 1.5, 0.75, 0, 0);
    }
    for (let i = 0; i < motes; i++) {
      const a = (i / motes) * TAU + rot0;
      const rr = 14 + (i % 3) * 6;
      const spd = 0.02 + ((seed >>> (i % 8)) % 5) * 0.004;
      const vy = st.moteDir === 1 ? -spd : st.moteDir === -1 ? spd : Math.sin(a) * spd;
      const vx = st.moteDir === 0 ? Math.cos(a) * spd : Math.cos(a) * spd * 0.3;
      const g = new Phaser.GameObjects.Graphics(scene);
      g.fillStyle(i % 2 ? soft : color, 1);
      g.fillCircle(0, 0, 2.4 + (i % 2));
      this.push(g, i * 22, dur * 0.9, 0.6, 1.25, 0.95, 0, 0, Math.cos(a) * rr, Math.sin(a) * rr, vx, vy);
    }
    for (let i = 0; i < st.stars; i++) {
      const a = rot0 + (i / Math.max(1, st.stars)) * TAU;
      const spd = 0.018;
      const s = new Phaser.GameObjects.Text(scene, 0, 0, '✦', { fontFamily: UI_FONT, fontSize: '16px', color: css(color) });
      s.setOrigin(0.5, 0.5);
      this.push(s, i * 45, dur, 0.5, 1.1, 1, 0, 0, Math.cos(a) * 26, Math.sin(a) * 26, Math.cos(a) * spd, Math.sin(a) * spd);
    }
  }

  /** Thêm một phần tử vào hiệu ứng (mặc định đặt tại tâm hiệu ứng). */
  private push(
    obj: FxObj,
    delay: number,
    ms: number,
    fromScale: number,
    toScale: number,
    fromAlpha: number,
    toAlpha: number,
    rot: number,
    x0 = 0,
    y0 = 0,
    vx = 0,
    vy = 0,
  ): void {
    obj.setPosition(x0, y0);
    this.root.add(obj);
    this.parts.push({ obj, x0, y0, delay, ms, fromScale, toScale, fromAlpha, toAlpha, rot, vx, vy });
  }

  tick(dt: number): boolean {
    this.t += dt;
    for (const p of this.parts) {
      const e = easeOut(Math.min(1, Math.max(0, (this.t - p.delay) / p.ms)));
      const o = p.obj as Phaser.GameObjects.Graphics;
      if (p.vx || p.vy) {
        const life = Math.max(0, this.t - p.delay);
        o.setPosition(p.x0 + p.vx * life, p.y0 + p.vy * life);
      }
      o.setScale(p.fromScale + (p.toScale - p.fromScale) * e);
      o.setAlpha(p.fromAlpha + (p.toAlpha - p.fromAlpha) * e);
      if (p.rot) o.rotation += p.rot * dt;
    }
    return this.t >= this.ms;
  }

  destroy(): void {
    // Container mặc định `exclusive = true` nên hủy luôn mọi phần tử con (và texture chữ của chúng).
    this.root.destroy();
  }
}

/** Dựng hiệu ứng kỹ năng và gắn vào `parent` (sân đấu tự dọn khi `tick` trả về true). */
export function spawnSkillFx(scene: Phaser.Scene, parent: Phaser.GameObjects.Container, req: FxRequest): Fx {
  return new SkillFx(scene, parent, req);
}
