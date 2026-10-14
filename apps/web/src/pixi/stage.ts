import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from 'pixi.js';
import type { GeneralDto, UpgradeOutcome } from '@tq/shared';
import { FACTION_STYLE, FRAME_LAYOUT, frameUrl, levelTier, portraitUrl, prefersReducedMotion } from '../art.ts';

const W = 520;
const H = 460;
const CARD_W = 180;
const CARD_H = 260;

/**
 * Sân khấu PixiJS dạng overlay cho animation mở thẻ & nâng cấp.
 * Animation chỉ HIỂN THỊ kết quả server đã xác nhận; lỗi animation không ảnh hưởng dữ liệu.
 * Mỗi lần mở tạo Application mới và destroy toàn bộ (texture, children) khi đóng.
 */
/** Nút hành động thêm ở màn kết quả (VD "Quay tiếp 1 vé"). */
export interface StageAction {
  label: string;
  value: string;
  primary?: boolean;
  disabled?: boolean;
}

class Stage {
  app = new Application();
  root = new Container();
  overlay: HTMLDivElement;
  skipping = prefersReducedMotion();
  private closed: Promise<string | null>;
  private resolveClosed!: (choice: string | null) => void;
  private done = false;
  private skipBtn: HTMLButtonElement;
  private closeBtn: HTMLButtonElement;
  caption: HTMLDivElement;

  constructor() {
    this.overlay = document.createElement('div');
    this.overlay.className = 'stage-overlay';
    this.overlay.innerHTML = `
      <div class="stage-box">
        <div class="stage-canvas"></div>
        <div class="stage-caption" aria-live="polite"></div>
        <div class="stage-actions">
          <button class="btn ghost" data-skip>Bỏ qua</button>
          <span class="stage-extra"></span>
          <button class="btn primary" data-close hidden>Đóng</button>
        </div>
      </div>`;
    this.skipBtn = this.overlay.querySelector('[data-skip]')!;
    this.closeBtn = this.overlay.querySelector('[data-close]')!;
    this.caption = this.overlay.querySelector('.stage-caption')!;
    this.skipBtn.onclick = () => (this.skipping = true);
    this.closed = new Promise((r) => (this.resolveClosed = r));
    this.closeBtn.onclick = () => this.destroy(null);
    document.body.appendChild(this.overlay);
  }

  async init() {
    await this.app.init({
      width: W,
      height: H,
      backgroundAlpha: 0,
      antialias: true,
      // Canvas được CSS phóng to tới ~2 lần kích thước logic (popup to) => render dày hơn cho nét
      resolution: Math.min(window.devicePixelRatio || 1, 2) * 2,
      autoDensity: true,
    });
    this.app.canvas.style.width = '100%';
    this.app.canvas.style.height = 'auto';
    this.overlay.querySelector('.stage-canvas')!.appendChild(this.app.canvas);
    this.app.stage.addChild(this.root);
  }

  /** Tween đơn giản trên ticker. Bỏ qua => nhảy thẳng tới trạng thái cuối. */
  tween(ms: number, step: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      if (this.skipping || ms <= 0) {
        step(1);
        return resolve();
      }
      let elapsed = 0;
      const tick = () => {
        elapsed += this.app.ticker.deltaMS;
        const t = this.skipping ? 1 : Math.min(1, elapsed / ms);
        step(t);
        if (t >= 1) {
          this.app.ticker.remove(tick);
          resolve();
        }
      };
      this.app.ticker.add(tick);
    });
  }

  wait = (ms: number) => this.tween(ms, () => {});

  /**
   * Kết thúc animation. tapToClose: bấm bất kỳ đâu trên màn che (hoặc Esc) để đóng.
   * actions: các nút thêm (VD "Quay tiếp"); bấm nút => đóng màn và waitClosed() trả về `value` của nút.
   */
  finish(caption: string, tapToClose = false, actions: StageAction[] = []) {
    this.caption.textContent = caption;
    this.skipBtn.hidden = true;
    this.closeBtn.hidden = false;
    const extra = this.overlay.querySelector<HTMLSpanElement>('.stage-extra')!;
    extra.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn ${a.primary ? 'primary' : 'ghost'}`;
      b.textContent = a.label;
      b.disabled = !!a.disabled;
      b.onclick = (e) => {
        e.stopPropagation(); // không để cú bấm lan ra màn che (tap-to-close)
        this.destroy(a.value);
      };
      extra.appendChild(b);
    }
    this.closeBtn.focus();
    if (tapToClose) {
      this.overlay.classList.add('tap-close');
      this.closeBtn.textContent = 'Đóng';
      // Gắn sau 1 nhịp để cú bấm "Bỏ qua" vừa rồi không đóng luôn màn hình
      setTimeout(() => {
        this.overlay.addEventListener('click', () => this.destroy(null), { once: true });
        this.overlay.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') this.destroy(null);
        });
      }, 0);
    }
  }

  waitClosed() {
    return this.closed;
  }

  destroy(choice: string | null = null) {
    if (this.done) return;
    this.done = true;
    try {
      this.app.destroy(true, { children: true, texture: true });
    } catch {
      /* ignore */
    }
    this.overlay.remove();
    this.resolveClosed(choice);
  }
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mặt sau thẻ (ảnh chủ dự án cung cấp). Thiếu ảnh thì vẽ mặt sau dự phòng bằng Graphics. */
const CARD_BACK_URL = '/theme/card-back.jpg';
let backTex: Texture | null = null;
async function ensureCardBack(): Promise<void> {
  if (backTex) return;
  try {
    backTex = (await Assets.load(CARD_BACK_URL)) as Texture;
  } catch {
    /* dùng mặt sau dự phòng */
  }
}

function makeCardBack(): Container {
  const c = new Container();
  if (backTex) {
    const sprite = new Sprite(new Texture({ source: backTex.source }));
    sprite.anchor.set(0.5);
    sprite.width = CARD_W;
    sprite.height = CARD_H;
    const mask = new Graphics().roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 10).fill({ color: 0xffffff });
    sprite.mask = mask;
    c.addChild(mask, sprite);
    return c;
  }
  const g = new Graphics()
    .roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 14)
    .fill({ color: 0x2a1d10 })
    .stroke({ width: 4, color: 0xd4a84a });
  g.roundRect(-CARD_W / 2 + 12, -CARD_H / 2 + 12, CARD_W - 24, CARD_H - 24, 8).stroke({ width: 2, color: 0x8a6a2a });
  const t = new Text({ text: '將', style: { fontSize: 84, fill: 0xd4a84a, fontWeight: '700' } });
  t.anchor.set(0.5);
  c.addChild(g, t);
  return c;
}

/**
 * Khung thẻ theo cấp (cùng bộ ảnh với thẻ DOM). Ảnh được Assets cache dùng chung;
 * mỗi sprite dùng một Texture mới trỏ tới cùng source, nên destroy stage (texture:true)
 * không làm hỏng cache. Nếu tải ảnh lỗi, thẻ vẫn hiển thị với viền vẽ bằng Graphics.
 */
const frameTex = new Map<number, Texture>();
const portraitTex = new Map<string, Texture>();
async function ensureFrames(levels: number[], artKeys: string[] = []): Promise<void> {
  await ensureCardBack();
  const keys = [...new Set(artKeys)].filter((k) => !portraitTex.has(k));
  await Promise.all(
    keys.map(async (k) => {
      try {
        portraitTex.set(k, (await Assets.load(portraitUrl(k))) as Texture);
      } catch {
        /* thiếu chân dung: dùng placeholder */
      }
    }),
  );
  const need = [...new Set(levels.map((l) => Math.min(Math.max(l, 1), 10)))].filter((l) => !frameTex.has(l));
  await Promise.all(
    need.map(async (l) => {
      try {
        frameTex.set(l, (await Assets.load(frameUrl(l))) as Texture);
      } catch {
        /* thiếu ảnh khung: dùng viền dự phòng */
      }
    }),
  );
}

function makeCard(general: GeneralDto, level: number): Container {
  const f = FACTION_STYLE[general.faction];
  const tier = levelTier(level);
  const c = new Container();
  const body = new Graphics()
    .roundRect(-CARD_W / 2, -CARD_H / 2, CARD_W, CARD_H, 14)
    .fill({ color: 0x14161c })
    .stroke({ width: frameTex.has(Math.min(Math.max(level, 1), 10)) ? 0 : 4, color: tier.color });
  const art = new Graphics().roundRect(-CARD_W / 2 + 10, -CARD_H / 2 + 10, CARD_W - 20, 170, 8).fill({ color: f.color, alpha: 0.85 });
  const glyph = new Text({ text: f.glyph, style: { fontSize: 96, fill: 0xffffff, fontWeight: '700' } });
  glyph.anchor.set(0.5);
  glyph.alpha = 0.35;
  glyph.y = -CARD_H / 2 + 95;
  const name = new Text({
    text: general.name,
    style: { fontSize: 20, fill: 0xffffff, fontWeight: '700', fontFamily: 'system-ui, sans-serif' },
  });
  name.anchor.set(0.5);
  name.y = CARD_H / 2 - 56;
  const lv = new Text({
    text: `Lv.${level}`,
    style: { fontSize: 22, fill: tier.color, fontWeight: '800', fontFamily: 'system-ui, sans-serif' },
  });
  lv.anchor.set(0.5);
  lv.y = CARD_H / 2 - 26;
  c.addChild(body, art, glyph, name, lv);
  const pt = portraitTex.get(general.artKey);
  if (pt) {
    // Chân dung phủ kín ô art (cover), canh phía trên để giữ khuôn mặt; cắt theo góc bo bằng mask
    const ax = -CARD_W / 2 + 10;
    const ay = -CARD_H / 2 + 10;
    const aw = CARD_W - 20;
    const ah = 170;
    const sprite = new Sprite(new Texture({ source: pt.source }));
    const k = Math.max(aw / pt.width, ah / pt.height);
    sprite.width = pt.width * k;
    sprite.height = pt.height * k;
    sprite.x = ax + (aw - sprite.width) / 2;
    sprite.y = ay - (sprite.height - ah) * 0.12;
    const mask = new Graphics().roundRect(ax, ay, aw, ah, 8).fill({ color: 0xffffff });
    sprite.mask = mask;
    c.addChild(mask, sprite);
  }
  const lvl = Math.min(Math.max(level, 1), 10);
  const cached = frameTex.get(lvl);
  if (cached) {
    const l = FRAME_LAYOUT[lvl]!;
    const frame = new Sprite(new Texture({ source: cached.source }));
    frame.x = -CARD_W / 2 + (l.left / 100) * CARD_W;
    frame.y = -CARD_H / 2 + (l.top / 100) * CARD_H;
    frame.width = (l.width / 100) * CARD_W;
    frame.height = (l.height / 100) * CARD_H;
    c.addChild(frame);
  }
  return c;
}

function makeRays(color: number): Graphics {
  const g = new Graphics();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const a2 = a + 0.08;
    g.poly([0, 0, Math.cos(a) * 320, Math.sin(a) * 320, Math.cos(a2) * 320, Math.sin(a2) * 320]).fill({ color, alpha: 0.18 });
  }
  return g;
}

function burst(stage: Stage, color: number, count: number) {
  if (stage.skipping) return;
  const parts: { g: Graphics; vx: number; vy: number }[] = [];
  for (let i = 0; i < count; i++) {
    const g = new Graphics().circle(0, 0, 2 + Math.random() * 3).fill({ color });
    g.position.set(W / 2, H / 2);
    const a = Math.random() * Math.PI * 2;
    const s = 2 + Math.random() * 5;
    parts.push({ g, vx: Math.cos(a) * s, vy: Math.sin(a) * s });
    stage.root.addChild(g);
  }
  void stage.tween(900, (t) => {
    for (const p of parts) {
      p.g.x += p.vx;
      p.g.y += p.vy;
      p.g.alpha = 1 - t;
    }
  });
}

/** Animation mở thẻ sau khi /api/gacha/draw trả kết quả. */
export async function playReveal(general: GeneralDto, level: number, caption: string, actions: StageAction[] = []): Promise<string | null> {
  const stage = new Stage();
  try {
    await stage.init();
    await ensureFrames([level], [general.artKey]);
    const tier = levelTier(level);
    const rays = makeRays(tier.color);
    rays.position.set(W / 2, H / 2);
    rays.alpha = 0;
    stage.root.addChild(rays);

    const back = makeCardBack();
    back.position.set(W / 2, H / 2);
    stage.root.addChild(back);
    await stage.tween(350, (t) => back.scale.set(lerp(0.4, 1, easeOut(t))));
    await stage.wait(250);
    await stage.tween(180, (t) => (back.scale.x = 1 - t));
    back.visible = false;

    const front = makeCard(general, level);
    front.position.set(W / 2, H / 2);
    front.scale.set(0, 1);
    stage.root.addChild(front);
    await stage.tween(200, (t) => (front.scale.x = easeOut(t)));
    rays.alpha = level >= 3 ? 1 : 0.4;
    burst(stage, tier.color, 12 + level * 8);
    if (!stage.skipping) stage.app.ticker.add(() => (rays.rotation += 0.004));
    stage.finish(caption, true, actions);
  } catch {
    // Lỗi render không đổi kết quả server — vẫn hiển thị chú thích để người chơi biết.
    stage.finish(caption, true, actions);
  }
  return stage.waitClosed();
}

/** Animation mở nhiều thẻ (quay ×10) — lật lần lượt từng thẻ theo đúng thứ tự server trả về. */
export async function playRevealMany(
  items: { general: GeneralDto; level: number }[],
  caption: string,
  actions: StageAction[] = [],
): Promise<string | null> {
  const stage = new Stage();
  try {
    await stage.init();
    await ensureFrames(
      items.map((i) => i.level),
      items.map((i) => i.general.artKey),
    );
    const n = items.length;
    // Tối đa 5 thẻ mỗi hàng; 6–10 thẻ => 2 hàng
    const perRow = 5;
    const rows = Math.ceil(n / perRow);
    const scale = rows > 1 ? 0.5 : 0.52;
    const gap = 102;
    const rowGap = CARD_H * scale + 18;
    const pos = (i: number) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      const col = i % perRow;
      return {
        x: W / 2 - ((inRow - 1) * gap) / 2 + col * gap,
        y: H / 2 - ((rows - 1) * rowGap) / 2 + row * rowGap,
      };
    };
    const best = Math.max(...items.map((i) => i.level));

    const rays = makeRays(levelTier(best).color);
    rays.position.set(W / 2, H / 2);
    rays.alpha = 0;
    stage.root.addChild(rays);

    const backs = items.map((_, i) => {
      const b = makeCardBack();
      const p = pos(i);
      b.position.set(p.x, p.y);
      b.scale.set(0);
      stage.root.addChild(b);
      return b;
    });
    await stage.tween(350, (t) => backs.forEach((b) => b.scale.set(scale * easeOut(t))));
    await stage.wait(200);

    for (let i = 0; i < n; i++) {
      const back = backs[i]!;
      const it = items[i]!;
      // 10 thẻ: lật nhanh hơn một chút để tổng thời gian không quá dài
      const flip = n > 5 ? 80 : 120;
      await stage.tween(flip, (t) => (back.scale.x = scale * (1 - t)));
      back.visible = false;
      const front = makeCard(it.general, it.level);
      const baseY = back.y;
      front.position.set(back.x, baseY);
      front.scale.set(0, scale);
      stage.root.addChild(front);
      await stage.tween(flip + 20, (t) => (front.scale.x = scale * easeOut(t)));
      if (it.level >= 3 && !stage.skipping) {
        // Thẻ hiếm nhảy nhẹ lên để nổi bật
        void stage.tween(300, (t) => (front.y = baseY - Math.sin(t * Math.PI) * 14));
      }
    }

    rays.alpha = best >= 3 ? 1 : 0.35;
    burst(stage, levelTier(best).color, 10 + best * 8);
    if (!stage.skipping) stage.app.ticker.add(() => (rays.rotation += 0.004));
    stage.finish(caption, true, actions);
  } catch {
    stage.finish(caption, true, actions);
  }
  return stage.waitClosed();
}

/** Animation ghép thẻ sau khi /api/upgrades/attempt trả kết quả. */
export async function playUpgrade(
  general: GeneralDto,
  inputLevel: number,
  resultLevel: number,
  outcome: UpgradeOutcome,
  caption: string,
  inputCount = 2,
): Promise<void> {
  const stage = new Stage();
  try {
    await stage.init();
    await ensureFrames([inputLevel, resultLevel], [general.artKey]);
    // Xếp các thẻ đầu vào đều quanh tâm (2 thẻ: hai bên; 3 thẻ: trái-giữa-phải)
    const xs = Array.from({ length: inputCount }, (_, i) => W / 2 + (i - (inputCount - 1) / 2) * 160);
    const inputs = xs.map((x) => {
      const c = makeCard(general, inputLevel);
      c.scale.set(0.55);
      c.position.set(x, H / 2);
      stage.root.addChild(c);
      return c;
    });
    await stage.wait(300);
    await stage.tween(600, (t) => {
      inputs.forEach((c, i) => {
        c.x = lerp(xs[i]!, W / 2, easeOut(t));
        c.alpha = 1 - t * 0.6;
      });
    });

    const flash = new Graphics().circle(0, 0, 200).fill({ color: 0xffffff });
    flash.position.set(W / 2, H / 2);
    stage.root.addChild(flash);
    inputs.forEach((c) => (c.visible = false));
    await stage.tween(300, (t) => {
      flash.scale.set(lerp(0.1, 1.2, t));
      flash.alpha = 1 - t;
    });

    const result = makeCard(general, resultLevel);
    result.position.set(W / 2, H / 2);
    if (outcome === 'success') {
      const rays = makeRays(0xffd76a);
      rays.position.set(W / 2, H / 2);
      stage.root.addChildAt(rays, 0);
      if (!stage.skipping) stage.app.ticker.add(() => (rays.rotation += 0.006));
      stage.root.addChild(result);
      await stage.tween(400, (t) => result.scale.set(lerp(0.5, 1, easeOut(t))));
      burst(stage, 0xffd76a, 60);
    } else {
      stage.root.addChild(result);
      const cracks = new Graphics();
      for (let i = 0; i < 5; i++) {
        let x = 0;
        let y = 0;
        cracks.moveTo(0, 0);
        for (let k = 0; k < 4; k++) {
          x += (Math.random() - 0.5) * 70;
          y += (Math.random() - 0.5) * 90;
          cracks.lineTo(x, y);
        }
      }
      cracks.stroke({ width: 3, color: 0xff4d4d, alpha: 0.9 });
      cracks.position.set(W / 2, H / 2);
      stage.root.addChild(cracks);
      await stage.tween(500, (t) => {
        result.x = W / 2 + Math.sin(t * 40) * 10 * (1 - t);
        cracks.alpha = 1 - t;
      });
      result.x = W / 2;
    }
    stage.finish(caption, true);
  } catch {
    stage.finish(caption, true);
  }
  await stage.waitClosed();
}
