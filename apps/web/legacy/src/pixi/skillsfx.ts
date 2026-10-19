import { Container, Graphics, Text } from 'pixi.js';
import type { PvpSkill } from '@tq/shared';

/**
 * Hiệu ứng kỹ năng khi thi triển / trúng đòn trong sân đấu PvP (mục 6.7).
 * Phân biệt theo 3 trục để 100 tướng đều có sắc thái riêng dù chỉ có 9 nhóm kỹ năng:
 *   1. Nhóm kỹ năng (`FxKind`) → kiểu hình khối (vòng niệm, lưỡi chém, ấn phù, hạt bay,…).
 *   2. Phe (`color`) → pha màu chủ đạo (Ngụy lam, Thục lục, Ngô đỏ, Quần tím).
 *   3. Sắc thái riêng từng tướng (`seed`) → số lưỡi/hạt, hoạ tiết phụ và accent màu khác nhau.
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

const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);

/** Pha hai màu RGB theo tỉ lệ t (0..1). */
function mix(a: number, b: number, t: number): number {
  const r = Math.round((((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t)));
  const g = Math.round((((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t)));
  const bl = Math.round(((a & 255) + (((b & 255) - (a & 255)) * t)));
  return (r << 16) | (g << 8) | bl;
}

/** Vòng tròn rỗng (viền) — dùng cho vòng niệm lan ra. */
function ringGfx(radius: number, color: number, width: number): Graphics {
  return new Graphics().circle(0, 0, radius).stroke({ width, color });
}

/** Nhiều lưỡi/tia cùng gốc toả ra đều nhau — dùng cho chém và xé (dispel). */
function bladeGfx(count: number, len: number, color: number, width: number): Graphics {
  const g = new Graphics();
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU;
    g.moveTo(Math.cos(a) * len * 0.3, Math.sin(a) * len * 0.3).lineTo(Math.cos(a) * len, Math.sin(a) * len);
  }
  return g.stroke({ width, color, cap: 'round' });
}

/** Ấn phù đa giác xoay (suy yếu/thiêu đốt/choáng) — hoạ tiết riêng của nhóm kỹ năng. */
function sigilGfx(sides: number, radius: number, color: number): Graphics {
  const pts: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * TAU;
    pts.push(Math.cos(a) * radius, Math.sin(a) * radius);
  }
  const g = new Graphics().poly(pts).stroke({ width: 2, color });
  for (let i = 0; i < sides; i++) g.moveTo(0, 0).lineTo(pts[i * 2]! * 0.55, pts[i * 2 + 1]! * 0.55);
  return g.stroke({ width: 1, color, alpha: 0.55 });
}

/** Một phần tử trong hiệu ứng, tự chạy theo thời gian (delay + thời lượng riêng). */
interface Part {
  obj: Container;
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
  private readonly root = new Container();
  private readonly parts: Part[] = [];
  private readonly ms: number;
  private t = 0;

  constructor(parent: Container, req: FxRequest) {
    const st = STYLE[req.kind];
    const cast = req.phase === 'cast';
    const seed = req.seed >>> 0;
    const color = mix(mix(KIND_COLOR[req.kind], req.color, 0.35), ACCENTS[(seed >>> 5) % ACCENTS.length]!, 0.12);
    const soft = mix(color, 0xffffff, 0.4);

    this.ms = (st.ms + (cast ? 160 : 0)) * (req.reduce ? 0.5 : 1);
    this.root.position.set(req.x, req.y);
    // Biến thể riêng từng tướng: xoay gốc + cỡ tổng thể (niệm chiêu to hơn va chạm)
    this.root.rotation = ((seed % 360) * Math.PI) / 180;
    this.root.scale.set((0.9 + ((seed >>> 4) % 6) * 0.03) * (cast ? 1.25 : 1));
    parent.addChild(this.root);

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
      this.push(ringGfx(30, color, 2.5), 0, dur, 0.5, 2, cast ? 0.35 : 0.9, 0, cast ? 0.0006 : 0);
    }
    if (motif === 1) {
      this.push(ringGfx(24, soft, 1.5), 90, dur, 0.6, 1.8, 0.8, 0, -0.0009);
    }
    if (sigil) {
      this.push(sigilGfx(sigil, 22, soft), cast ? 60 : 0, dur, 0.6, 1.35, 0.95, 0, cast ? 0.0022 : 0.0016);
    } else if (motif === 2) {
      this.push(sigilGfx(4 + (seed % 3), 20, soft), 0, dur * 0.8, 0.6, 1.2, 0.75, 0, 0.0018);
    }
    if (blades > 0) {
      this.push(bladeGfx(blades, 30, color, 3), cast ? 80 : 0, dur * 0.85, 0.5, 1.7, 1, 0, cast ? 0.0008 : 0.0012);
    }
    if (flash) {
      const g = new Graphics().circle(0, 0, 26).fill({ color: mix(color, 0xffffff, 0.5) });
      this.push(g, 0, dur * 0.4, 0.4, 1.5, 0.75, 0, 0);
    }
    for (let i = 0; i < motes; i++) {
      const a = (i / motes) * TAU + rot0;
      const rr = 14 + (i % 3) * 6;
      const spd = 0.02 + ((seed >>> (i % 8)) % 5) * 0.004;
      const vy = st.moteDir === 1 ? -spd : st.moteDir === -1 ? spd : Math.sin(a) * spd;
      const vx = st.moteDir === 0 ? Math.cos(a) * spd : Math.cos(a) * spd * 0.3;
      const g = new Graphics().circle(0, 0, 2.4 + (i % 2)).fill({ color: i % 2 ? soft : color });
      this.push(g, i * 22, dur * 0.9, 0.6, 1.25, 0.95, 0, 0, Math.cos(a) * rr, Math.sin(a) * rr, vx, vy);
    }
    for (let i = 0; i < st.stars; i++) {
      const a = rot0 + (i / Math.max(1, st.stars)) * TAU;
      const spd = 0.018;
      const s = new Text({ text: '✦', style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, fill: color } });
      s.anchor.set(0.5);
      this.push(s, i * 45, dur, 0.5, 1.1, 1, 0, 0, Math.cos(a) * 26, Math.sin(a) * 26, Math.cos(a) * spd, Math.sin(a) * spd);
    }
  }

  /** Thêm một phần tử vào hiệu ứng (mặc định đặt tại tâm hiệu ứng). */
  private push(
    obj: Container,
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
    obj.position.set(x0, y0);
    this.root.addChild(obj);
    this.parts.push({ obj, x0, y0, delay, ms, fromScale, toScale, fromAlpha, toAlpha, rot, vx, vy });
  }

  tick(dt: number): boolean {
    this.t += dt;
    for (const p of this.parts) {
      const e = easeOut(Math.min(1, Math.max(0, (this.t - p.delay) / p.ms)));
      if (p.vx || p.vy) {
        const life = Math.max(0, this.t - p.delay);
        p.obj.position.set(p.x0 + p.vx * life, p.y0 + p.vy * life);
      }
      p.obj.scale.set(p.fromScale + (p.toScale - p.fromScale) * e);
      p.obj.alpha = p.fromAlpha + (p.toAlpha - p.fromAlpha) * e;
      if (p.rot) p.obj.rotation += p.rot * dt;
    }
    return this.t >= this.ms;
  }

  destroy(): void {
    // `context: true` để hủy luôn GraphicsContext của từng Graphics con — mặc định PixiJS chỉ hủy
    // context khi `options` là `true`/rỗng, nên truyền `{ children: true }` sẽ RÒ RỈ context mỗi hiệu ứng.
    this.root.destroy({ children: true, context: true });
  }
}

/** Dựng hiệu ứng kỹ năng và gắn vào `parent` (sân đấu tự dọn khi `tick` trả về true). */
export function spawnSkillFx(parent: Container, req: FxRequest): Fx {
  return new SkillFx(parent, req);
}
