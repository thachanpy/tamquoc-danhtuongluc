import { TICKET_LABELS, TICKET_TYPES } from '@tq/shared';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api } from '../services/api.ts';
import { ApiError, setToken } from '../services/http.ts';
import { bootstrapSession } from '../state/session.ts';
import { state } from '../state/store.ts';
import { h, render } from '../ui/dom.ts';
import { PageScene } from '../ui/PageScene.ts';
import { toast } from '../ui/toast.ts';

/**
 * Màn Đăng nhập / Tạo tài khoản (mục 3.8).
 *
 * Đây là màn toàn màn hình đầu tiên của game: gắn trực tiếp vào `#ui-root`, không nằm trong
 * khung Shell. Đăng nhập/đăng ký xong thì khởi tạo phiên rồi chuyển sang khung Shell.
 * Tham số `init` nhận `{ message }` khi phiên cũ hết hạn (do Preload hoặc lúc Đăng xuất).
 */
export class LoginScene extends PageScene {
  protected override hostId = 'ui-root';

  private infoBox!: HTMLElement;
  private errorBox!: HTMLElement;
  private busy = false;
  private buttons: HTMLButtonElement[] = [];

  constructor() {
    super(SceneKeys.Login);
  }

  init(data?: { message?: string }): void {
    this.pendingMessage = data?.message ?? '';
    this.pendingInfo = '';
  }

  private pendingMessage = '';
  private pendingInfo = '';

  protected build(): HTMLElement {
    const logo = h('img', { class: 'logo big', attrs: { src: '/icons/icon-192.png', alt: '', 'aria-hidden': 'true' } });
    const username = h('input', { attrs: { name: 'username', autocomplete: 'username', required: true, minlength: 3, maxlength: 32, pattern: '[A-Za-z0-9_]+' } });
    const password = h('input', { attrs: { name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: 6 } });

    const loginBtn = h('button', { class: 'btn primary', attrs: { type: 'submit' }, text: 'Đăng nhập' });
    const registerBtn = h('button', { class: 'btn ghost', attrs: { type: 'button' }, text: 'Tạo tài khoản' });
    this.buttons = [loginBtn, registerBtn];

    this.infoBox = h('div', { class: 'notice', attrs: { role: 'status' } });
    this.errorBox = h('div', { class: 'error', attrs: { 'aria-live': 'polite' }, text: this.pendingMessage });

    const form = h(
      'form',
      { class: 'panel', attrs: { novalidate: false } },
      h('label', {}, 'Tên đăng nhập ', username),
      h('label', {}, 'Mật khẩu ', password),
      h('div', { class: 'row' }, loginBtn, registerBtn),
      this.infoBox,
      this.errorBox,
    );

    loginBtn.addEventListener('click', (e) => void this.submit(e, form, username, password, 'login'));
    registerBtn.addEventListener('click', (e) => void this.submit(e, form, username, password, 'register'));
    form.addEventListener('submit', (e) => void this.submit(e, form, username, password, 'login'));

    return h('div', { class: 'login' }, logo, h('h1', { text: 'Tam Quốc: ' }), h('h1', { text: 'Vô Song' }), form);
  }

  protected loadData(): void {
    if (this.pendingInfo) this.showInfo(this.pendingInfo);
  }

  private showInfo(text: string): void {
    render(this.infoBox, text);
  }

  private setBusy(v: boolean): void {
    this.busy = v;
    for (const b of this.buttons) b.disabled = v;
  }

  /** Gửi đăng nhập hoặc đăng ký rồi vào game khi thành công. */
  private async submit(ev: Event, form: HTMLFormElement, username: HTMLInputElement, password: HTMLInputElement, act: 'login' | 'register'): Promise<void> {
    ev.preventDefault();
    if (this.busy) return;
    if (!form.reportValidity()) return;
    const u = username.value;
    const p = password.value;
    this.errorBox.textContent = '';
    this.setBusy(true);
    try {
      if (act === 'register') {
        const r = await api.register(u, p);
        if (r.status === 'pending') {
          // Tài khoản mới phải chờ admin duyệt mới đăng nhập được (mục 3.8)
          this.showInfo(`Đăng ký thành công! Tài khoản ${u} đang chờ quản trị viên duyệt. Bạn sẽ đăng nhập được sau khi được duyệt; vé quà tân thủ được cấp lúc duyệt.`);
          return;
        }
        setToken(r.token);
        await this.enterGame();
        const total = TICKET_TYPES.reduce((s, k) => s + r.signupBonus[k], 0);
        if (!state.isAdmin) {
          toast(
            `Quà tân thủ: ${total} vé — ${TICKET_TYPES.filter((k) => r.signupBonus[k])
              .map((k) => `${TICKET_LABELS[k]} ×${r.signupBonus[k]}`)
              .join(', ')}`,
            7000,
          );
        }
      } else {
        const r = await api.login(u, p);
        setToken(r.token);
        await this.enterGame();
      }
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'ACCOUNT_PENDING') {
        this.showInfo(`Tài khoản ${u} đang chờ quản trị viên duyệt. Vui lòng quay lại sau khi được duyệt.`);
      } else {
        this.errorBox.textContent = err.message;
      }
    } finally {
      this.setBusy(false);
    }
  }

  /** Khởi tạo phiên sau khi có token rồi mở khung Shell (hoặc báo lỗi ngay trên form). */
  private async enterGame(): Promise<void> {
    const res = await bootstrapSession();
    if (!res.ok) {
      this.errorBox.textContent = res.message || 'Không tải được dữ liệu người chơi.';
      return;
    }
    this.scene.start(SceneKeys.Shell);
  }
}
