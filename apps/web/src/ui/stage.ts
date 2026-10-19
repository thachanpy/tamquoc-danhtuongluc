import type { GemDto, GemElement, GeneralDto, UpgradeOutcome } from '@tq/shared';
import { levelTier, prefersReducedMotion } from '../assets/art.ts';
import { cardEl } from './Card.ts';
import { h } from './dom.ts';
import { gemCardEl } from './GemCard.ts';

/**
 * Sân khấu hiệu ứng toàn màn hình cho mở thẻ & nâng cấp — bản thay thế DOM cho `pixi/stage.ts`.
 *
 * Bản cũ dựng một `Application` PixiJS (520×460) trong lớp phủ `.stage-overlay`; nay giữ NGUYÊN
 * cấu trúc DOM/CSS đó nhưng thay canvas Pixi bằng thẻ DOM thật (`.tq-card`) và tween bằng
 * Web Animations/rAF. Nhờ vậy hiệu ứng dùng lại đúng bộ khung ảnh + CSS cổ phong, không phải
 * nạp texture thủ công, mà vẫn giữ được "Bỏ qua", "Đóng", nút hành động phụ và bấm nền để đóng.
 *
 * Hiệu ứng chỉ HIỂN THỊ kết quả server đã xác nhận — lỗi hiệu ứng không ảnh hưởng dữ liệu.
 */

/** Nút hành động thêm ở màn kết quả (VD "Quay tiếp 1 vé"). */
export interface StageAction {
  label: string;
  value: string;
  primary?: boolean;
  disabled?: boolean;
}

/** Toạ độ logic của sân khấu (khớp tỉ lệ khung `.stage-canvas` = 520/460). */
const W = 520;
const H = 460;
const CARD_W = 180;
/** Chân dung/thẻ hiển thị ở màn mở thẻ đơn: rộng 180px đúng tỉ lệ thẻ dọc 286/378. */
const easeOut = (t: number): number => 1 - Math.pow(1 - t, 3);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Đặt phần tử tại toạ độ logic (tâm phần tử) với tỉ lệ phóng theo trục. */
function place(el: HTMLElement, x: number, y: number, sx = 1, sy = sx): void {
  el.style.left = `${(x / W) * 100}%`;
  el.style.top = `${(y / H) * 100}%`;
  el.style.transform = `translate(-50%, -50%) scale(${sx}, ${sy})`;
}

/** Thẻ tướng dạng phần tử tuyệt đối trong sân khấu, bề rộng cố định để `scale` phóng đều. */
function cardNode(general: GeneralDto, level: number, widthPx = CARD_W): HTMLElement {
  const el = cardEl({ general, level });
  el.style.position = 'absolute';
  el.style.setProperty('--cw', `${widthPx}px`);
  el.style.transformOrigin = 'center';
  return el;
}

/** Viên Ngọc rớt kèm — dùng lại thẻ Ngọc tròn của UI (bỏ dòng chú thích cho gọn). */
function gemNode(element: GemElement, level: number, widthPx: number): HTMLElement {
  const el = gemCardEl({ element, level });
  el.style.position = 'absolute';
  el.style.setProperty('--cw', `${widthPx}px`);
  el.style.transformOrigin = 'center';
  el.querySelector<HTMLElement>('.tq-meta')?.remove();
  return el;
}

/** Mặt sau thẻ: ảnh `/theme/card-back.webp`, thiếu ảnh thì lộ chữ 將 vẽ bằng CSS. */
function backNode(): HTMLElement {
  const el = h('div', { attrs: { 'aria-hidden': 'true' } });
  el.style.cssText = `position:absolute; width:${CARD_W}px; height:${((CARD_W * 378) / 286).toFixed(1)}px; border-radius:14px;
    background:#2a1d10; border:4px solid #d4a84a; box-sizing:border-box; overflow:hidden; display:grid; place-items:center; transform-origin:center;`;
  const glyph = h('span', { text: '將' });
  glyph.style.cssText = 'grid-area:1/1; font-size:84px; font-weight:700; color:#d4a84a;';
  const img = h('img', { attrs: { src: '/theme/card-back.webp', alt: '', 'aria-hidden': 'true' } });
  img.style.cssText = 'grid-area:1/1; width:100%; height:100%; object-fit:cover;';
  img.addEventListener('error', () => img.remove());
  el.append(img, glyph);
  return el;
}

/** Hào quang toả tia quanh tâm — bản CSS của `makeRays` (Pixi Graphics). */
function raysNode(css: string): HTMLElement {
  const el = h('div', { attrs: { 'aria-hidden': 'true' } });
  el.style.cssText = `position:absolute; left:50%; top:50%; width:640px; height:640px; pointer-events:none; opacity:0;
    transform:translate(-50%,-50%); border-radius:50%;
    background:repeating-conic-gradient(color-mix(in srgb, ${css} 18%, transparent) 0deg 3.6deg, transparent 3.6deg 22.5deg);
    -webkit-mask-image:radial-gradient(circle, rgba(0,0,0,.95) 0%, rgba(0,0,0,0) 72%);
    mask-image:radial-gradient(circle, rgba(0,0,0,.95) 0%, rgba(0,0,0,0) 72%);`;
  return el;
}

/** Vết nứt đỏ khi nâng cấp thất bại. */
function cracksNode(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '-160 -160 320 320');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute; left:50%; top:50%; width:320px; height:320px; transform:translate(-50%,-50%); pointer-events:none;';
  for (let i = 0; i < 5; i++) {
    let x = 0;
    let y = 0;
    let d = 'M0 0';
    for (let k = 0; k < 4; k++) {
      x += (Math.random() - 0.5) * 70;
      y += (Math.random() - 0.5) * 90;
      d += ` L${x.toFixed(0)} ${y.toFixed(0)}`;
    }
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', '#ff4d4d');
    p.setAttribute('stroke-width', '3');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-linecap', 'round');
    svg.appendChild(p);
  }
  return svg;
}

/**
 * Một phiên sân khấu: lớp phủ + khung + chú thích + hàng nút.
 * Mỗi lần mở tạo mới và gỡ hoàn toàn khi đóng (không giữ trạng thái giữa các lần).
 */
class Stage {
  readonly overlay: HTMLDivElement;
  readonly canvas: HTMLElement;
  readonly caption: HTMLElement;
  /** Bật khi người chơi bấm "Bỏ qua" hoặc máy bật chế độ giảm chuyển động. */
  skipping = prefersReducedMotion();
  private readonly skipBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly extra: HTMLElement;
  private readonly closed: Promise<string | null>;
  private resolveClosed!: (choice: string | null) => void;
  private done = false;

  constructor() {
    this.overlay = h('div', { class: 'stage-overlay', attrs: { role: 'dialog', 'aria-modal': 'true' } });
    this.canvas = h('div', { class: 'stage-canvas', attrs: { 'aria-hidden': 'true' } });
    this.canvas.style.cssText = 'position:relative; width:100%; aspect-ratio:520 / 460;';
    this.caption = h('div', { class: 'stage-caption', attrs: { 'aria-live': 'polite' } });
    this.skipBtn = h('button', { class: 'btn ghost', text: 'Bỏ qua' });
    this.closeBtn = h('button', { class: 'btn primary', text: 'Đóng', attrs: { hidden: true } });
    this.extra = h('span', { class: 'stage-extra' });

    this.skipBtn.addEventListener('click', () => (this.skipping = true));
    this.closeBtn.addEventListener('click', () => this.destroy(null));

    const box = h(
      'div',
      { class: 'stage-box' },
      this.canvas,
      this.caption,
      h('div', { class: 'stage-actions' }, this.skipBtn, this.extra, this.closeBtn),
    );
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);
    this.closed = new Promise((r) => (this.resolveClosed = r));
  }

  /** Tween trên trục thời gian thật; "Bỏ qua" thì nhảy thẳng tới trạng thái cuối. */
  tween(ms: number, step: (t: number) => void): Promise<void> {
    return new Promise((resolve) => {
      if (this.skipping || ms <= 0) {
        step(1);
        resolve();
        return;
      }
      const start = performance.now();
      const tick = (now: number): void => {
        const t = this.skipping ? 1 : Math.min(1, (now - start) / ms);
        step(t);
        if (t >= 1) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  wait = (ms: number): Promise<void> => this.tween(ms, () => {});

  /** Xoay hào quang liên tục (tự dừng khi phần tử bị gỡ). */
  spinRays(el: HTMLElement): void {
    if (this.skipping) return;
    el.animate([{ transform: 'translate(-50%,-50%) rotate(0deg)' }, { transform: 'translate(-50%,-50%) rotate(360deg)' }], {
      duration: 9000,
      iterations: Infinity,
    });
  }

  /** Bắn hạt sáng từ tâm (tương đương `burst` của bản Pixi). */
  burst(css: string, count: number): void {
    if (this.skipping) return;
    for (let i = 0; i < count; i++) {
      const size = 2 + Math.random() * 3;
      const p = h('div', { attrs: { 'aria-hidden': 'true' } });
      p.style.cssText = `position:absolute; left:50%; top:50%; width:${size.toFixed(1)}px; height:${size.toFixed(1)}px;
        border-radius:50%; background:${css}; box-shadow:0 0 8px ${css}; pointer-events:none; transform:translate(-50%,-50%);`;
      this.canvas.appendChild(p);
      const a = Math.random() * Math.PI * 2;
      const s = (2 + Math.random() * 5) * 54;
      p.animate(
        [
          { transform: 'translate(-50%,-50%)' },
          { transform: `translate(calc(-50% + ${(Math.cos(a) * s).toFixed(1)}px), calc(-50% + ${(Math.sin(a) * s).toFixed(1)}px))` },
        ],
        { duration: 900, easing: 'ease-out', fill: 'forwards' },
      );
      p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 900, fill: 'forwards' });
    }
  }

  /**
   * Kết thúc hiệu ứng, hiện chú thích + hàng nút. `tapToClose`: bấm vùng nền hoặc Esc để đóng.
   * Nút hành động phụ trả `value` cho `waitClosed()` — dùng cho "Quay tiếp".
   */
  finish(caption: string, tapToClose = false, actions: StageAction[] = []): void {
    this.caption.textContent = caption;
    this.skipBtn.hidden = true;
    this.closeBtn.hidden = false;
    for (const a of actions) {
      const b = h('button', { class: `btn ${a.primary ? 'primary' : 'ghost'}`, text: a.label });
      b.disabled = !!a.disabled;
      b.addEventListener('click', (e) => {
        e.stopPropagation(); // không để cú bấm lan ra màn che (tap-to-close)
        this.destroy(a.value);
      });
      this.extra.appendChild(b);
    }
    this.closeBtn.focus();
    if (tapToClose) {
      this.overlay.classList.add('tap-close');
      // Gắn sau 1 nhịp để cú bấm "Bỏ qua" vừa rồi không đóng luôn màn hình.
      setTimeout(() => {
        this.overlay.addEventListener('click', (e) => {
          if (e.target === this.overlay) this.destroy(null);
        });
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') this.destroy(null);
        });
      }, 0);
    }
  }

  waitClosed(): Promise<string | null> {
    return this.closed;
  }

  destroy(choice: string | null = null): void {
    if (this.done) return;
    this.done = true;
    this.overlay.remove();
    this.resolveClosed(choice);
  }
}

/** Animation mở thẻ sau khi `/api/gacha/draw` trả kết quả. `gem` = Ngọc rớt kèm (hiện cạnh thẻ). */
export async function playReveal(
  general: GeneralDto,
  level: number,
  caption: string,
  actions: StageAction[] = [],
  gem?: GemDto | null,
): Promise<string | null> {
  const stage = new Stage();
  try {
    const tier = levelTier(level);
    const rays = raysNode(tier.css);
    stage.canvas.appendChild(rays);

    const back = backNode();
    place(back, W / 2, H / 2, 0.4);
    stage.canvas.appendChild(back);
    await stage.tween(350, (t) => place(back, W / 2, H / 2, lerp(0.4, 1, easeOut(t))));
    await stage.wait(250);
    await stage.tween(180, (t) => place(back, W / 2, H / 2, 1 - t));
    back.remove();

    const front = cardNode(general, level);
    place(front, W / 2, H / 2, 0, 1);
    stage.canvas.appendChild(front);
    await stage.tween(200, (t) => place(front, W / 2, H / 2, easeOut(t), 1));

    if (gem) {
      const orb = gemNode(gem.element, gem.level, 74);
      const gx = W / 2 + CARD_W / 2 - 14;
      const gy = H / 2 + 150 - 20;
      place(orb, gx, gy, 0);
      stage.canvas.appendChild(orb);
      await stage.tween(240, (t) => {
        const e = easeOut(t);
        place(orb, gx, gy, e * (1 + Math.sin(t * Math.PI) * 0.22));
      });
    }

    rays.style.opacity = level >= 3 ? '1' : '0.4';
    stage.burst(tier.css, 12 + level * 8);
    stage.spinRays(rays);
  } catch {
    /* lỗi hiệu ứng không đổi kết quả server — vẫn hiện chú thích bên dưới */
  }
  stage.finish(caption, true, actions);
  return stage.waitClosed();
}

/** Animation mở nhiều thẻ (quay ×10) — lật lần lượt từng thẻ theo đúng thứ tự server trả về. */
export async function playRevealMany(
  items: { general: GeneralDto; level: number; gem?: GemDto | null }[],
  caption: string,
  actions: StageAction[] = [],
): Promise<string | null> {
  const stage = new Stage();
  try {
    const n = items.length;
    const perRow = 5;
    const rows = Math.ceil(n / perRow);
    const scale = rows > 1 ? 0.5 : 0.52;
    const gap = 102;
    const rowGap = ((CARD_W * 378) / 286) * scale + 18;
    const pos = (i: number): { x: number; y: number } => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      const col = i % perRow;
      return {
        x: W / 2 - ((inRow - 1) * gap) / 2 + col * gap,
        y: H / 2 - ((rows - 1) * rowGap) / 2 + row * rowGap,
      };
    };
    const best = Math.max(...items.map((i) => i.level));

    const rays = raysNode(levelTier(best).css);
    stage.canvas.appendChild(rays);

    const backs = items.map((_, i) => {
      const b = backNode();
      const p = pos(i);
      place(b, p.x, p.y, 0);
      stage.canvas.appendChild(b);
      return b;
    });
    await stage.tween(350, (t) => {
      const s = scale * easeOut(t);
      backs.forEach((b, i) => {
        const p = pos(i);
        place(b, p.x, p.y, s);
      });
    });
    await stage.wait(200);

    for (let i = 0; i < n; i++) {
      const back = backs[i]!;
      const it = items[i]!;
      const p = pos(i);
      // 10 thẻ: lật nhanh hơn một chút để tổng thời gian không quá dài.
      const flip = n > 5 ? 80 : 120;
      await stage.tween(flip, (t) => place(back, p.x, p.y, scale * (1 - t)));
      back.remove();

      const front = cardNode(it.general, it.level);
      place(front, p.x, p.y, 0, scale);
      stage.canvas.appendChild(front);
      await stage.tween(flip + 20, (t) => place(front, p.x, p.y, scale * easeOut(t), scale));

      if (it.gem) {
        const orb = gemNode(it.gem.element, it.gem.level, 74);
        const gx = p.x + CARD_W * scale * 0.5 - 6;
        const gy = p.y + ((CARD_W * 378) / 286) * scale * 0.5 - 8;
        place(orb, gx, gy, 0);
        stage.canvas.appendChild(orb);
        await stage.tween(160, (t) => place(orb, gx, gy, 0.46 * easeOut(t)));
      }
      if (it.level >= 3 && !stage.skipping) {
        // Thẻ hiếm nhảy nhẹ lên để nổi bật.
        void stage.tween(300, (t) => place(front, p.x, p.y - Math.sin(t * Math.PI) * 14, scale, scale));
      }
    }

    rays.style.opacity = best >= 3 ? '1' : '0.35';
    stage.burst(levelTier(best).css, 10 + best * 8);
    stage.spinRays(rays);
  } catch {
    /* lỗi hiệu ứng không đổi kết quả server */
  }
  stage.finish(caption, true, actions);
  return stage.waitClosed();
}

/** Animation ghép thẻ sau khi `/api/upgrades/attempt` trả kết quả. */
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
    // Xếp các thẻ đầu vào đều quanh tâm (2 thẻ: hai bên; 3 thẻ: trái–giữa–phải).
    const xs = Array.from({ length: inputCount }, (_, i) => W / 2 + (i - (inputCount - 1) / 2) * 160);
    const inputs = xs.map((x) => {
      const c = cardNode(general, inputLevel);
      place(c, x, H / 2, 0.55);
      stage.canvas.appendChild(c);
      return c;
    });
    await stage.wait(300);
    await stage.tween(600, (t) => {
      inputs.forEach((c, i) => {
        place(c, lerp(xs[i]!, W / 2, easeOut(t)), H / 2, 0.55);
        c.style.opacity = String(1 - t * 0.6);
      });
    });

    const flash = h('div', { attrs: { 'aria-hidden': 'true' } });
    flash.style.cssText = 'position:absolute; left:50%; top:50%; width:400px; height:400px; border-radius:50%; background:#fff; pointer-events:none; transform:translate(-50%,-50%);';
    stage.canvas.appendChild(flash);
    inputs.forEach((c) => (c.style.visibility = 'hidden'));
    await stage.tween(300, (t) => {
      flash.style.transform = `translate(-50%,-50%) scale(${lerp(0.1, 1.2, t)})`;
      flash.style.opacity = String(1 - t);
    });
    flash.remove();

    const result = cardNode(general, resultLevel);
    place(result, W / 2, H / 2, 0.5);
    if (outcome === 'success') {
      const rays = raysNode('#ffd76a');
      stage.canvas.insertBefore(rays, stage.canvas.firstChild);
      stage.canvas.appendChild(result);
      stage.spinRays(rays);
      await stage.tween(400, (t) => place(result, W / 2, H / 2, lerp(0.5, 1, easeOut(t))));
      stage.burst('#ffd76a', 60);
    } else {
      stage.canvas.appendChild(result);
      const cracks = cracksNode();
      stage.canvas.appendChild(cracks);
      await stage.tween(500, (t) => {
        place(result, W / 2 + Math.sin(t * 40) * 10 * (1 - t), H / 2, 1);
        cracks.style.opacity = String(1 - t);
      });
      cracks.remove();
      place(result, W / 2, H / 2, 1);
    }
  } catch {
    /* lỗi hiệu ứng không đổi kết quả server */
  }
  stage.finish(caption, true);
  await stage.waitClosed();
}

/**
 * Animation ghép Ngọc Ngũ Hành sau khi `/api/gems/merge` trả kết quả — dựng y hệt `playUpgrade`
 * (2 viên Ngọc đầu vào lao vào tâm → loé sáng → viên kết quả bung ra), chỉ khác đối tượng là Ngọc.
 */
export async function playGemUpgrade(
  element: GemElement,
  inputLevel: number,
  resultLevel: number,
  outcome: UpgradeOutcome,
  caption: string,
  inputCount = 2,
): Promise<void> {
  const stage = new Stage();
  try {
    const xs = Array.from({ length: inputCount }, (_, i) => W / 2 + (i - (inputCount - 1) / 2) * 160);
    const inputs = xs.map((x) => {
      const o = gemNode(element, inputLevel, 114);
      place(o, x, H / 2, 0.6);
      stage.canvas.appendChild(o);
      return o;
    });
    await stage.wait(300);
    await stage.tween(600, (t) => {
      inputs.forEach((o, i) => {
        place(o, lerp(xs[i]!, W / 2, easeOut(t)), H / 2, 0.6);
        o.style.opacity = String(1 - t * 0.6);
      });
    });

    const flash = h('div', { attrs: { 'aria-hidden': 'true' } });
    flash.style.cssText = 'position:absolute; left:50%; top:50%; width:400px; height:400px; border-radius:50%; background:#fff; pointer-events:none; transform:translate(-50%,-50%);';
    stage.canvas.appendChild(flash);
    inputs.forEach((o) => (o.style.visibility = 'hidden'));
    await stage.tween(300, (t) => {
      flash.style.transform = `translate(-50%,-50%) scale(${lerp(0.1, 1.2, t)})`;
      flash.style.opacity = String(1 - t);
    });
    flash.remove();

    const result = gemNode(element, resultLevel, 114);
    place(result, W / 2, H / 2, 1);
    if (outcome === 'success') {
      const rays = raysNode('#ffd76a');
      stage.canvas.insertBefore(rays, stage.canvas.firstChild);
      stage.canvas.appendChild(result);
      place(result, W / 2, H / 2, 0.5);
      stage.spinRays(rays);
      await stage.tween(400, (t) => place(result, W / 2, H / 2, lerp(0.5, 1, easeOut(t))));
      stage.burst('#ffd76a', 60);
    } else {
      stage.canvas.appendChild(result);
      const cracks = cracksNode();
      stage.canvas.appendChild(cracks);
      await stage.tween(500, (t) => {
        place(result, W / 2 + Math.sin(t * 40) * 10 * (1 - t), H / 2, 1);
        cracks.style.opacity = String(1 - t);
      });
      cracks.remove();
      place(result, W / 2, H / 2, 1);
    }
  } catch {
    /* lỗi hiệu ứng không đổi kết quả server */
  }
  stage.finish(caption, true);
  await stage.waitClosed();
}
