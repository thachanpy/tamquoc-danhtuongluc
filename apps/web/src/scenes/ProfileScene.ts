import { DISPLAY_NAME_MAX } from '@tq/shared';
import { portraitUrl } from '../assets/art.ts';
import { SceneKeys } from '../core/SceneKeys.ts';
import { api } from '../services/api.ts';
import type { ApiError } from '../services/http.ts';
import { profile, setProfile, state } from '../state/store.ts';
import { avatarEl } from '../ui/Avatar.ts';
import { h, render } from '../ui/dom.ts';
import { PageScene } from '../ui/PageScene.ts';
import { toast } from '../ui/toast.ts';

/** Ảnh tải lên tối đa 1MB (chủ dự án yêu cầu). */
const MAX_UPLOAD_BYTES = 1024 * 1024;
/** Cạnh ảnh đại diện sau khi thu nhỏ (vuông) — đủ nét khi hiển thị ở thanh trên và trang Hồ sơ. */
const AVATAR_PX = 256;

/** Đường dẫn chân dung tướng lưu ở server (không kèm ?v= của client). */
const portraitPath = (artKey: string) => `/generals/${artKey}.webp`;

/**
 * Đọc file ảnh người chơi chọn, cắt vuông ở giữa rồi thu nhỏ về AVATAR_PX và nén thành JPEG.
 * Trả về data URL đã nén (nhỏ hơn nhiều so với ảnh gốc) để gửi lên server.
 */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const sx = (img.naturalWidth - side) / 2;
      const sy = (img.naturalHeight - side) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_PX;
      canvas.height = AVATAR_PX;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Trình duyệt không hỗ trợ xử lý ảnh.'));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Không đọc được ảnh này.'));
    };
    img.src = url;
  });
}

/**
 * Trang Hồ sơ (mục 3.11): đổi ảnh đại diện (tải lên ≤1MB, ảnh được nén ở client;
 * hoặc chọn chân dung tướng gợi ý), đổi tên hiển thị và đổi mật khẩu.
 * Mọi thay đổi lưu ở server; ảnh đại diện mặc định là chữ cái đầu của tên hiển thị.
 */
export class ProfileScene extends PageScene {
  private alive = true;

  // --- trạng thái nhập liệu
  private name = '';
  private savingName = false;
  private savingAvatar = false;
  private curPw = '';
  private newPw = '';
  private confirmPw = '';
  private savingPw = false;

  // --- phần tử DOM được cập nhật tại chỗ
  private headEl!: HTMLElement;
  private actionsRow!: HTMLElement;
  private uploadBtn!: HTMLButtonElement;
  private clearBtn: HTMLButtonElement | null = null;
  private fileInput!: HTMLInputElement;
  private picks: { artKey: string; el: HTMLButtonElement }[] = [];
  private nameInput!: HTMLInputElement;
  private nameSaveBtn!: HTMLButtonElement;
  private curPwInput!: HTMLInputElement;
  private newPwInput!: HTMLInputElement;
  private confirmPwInput!: HTMLInputElement;
  private pwBtn!: HTMLButtonElement;

  constructor() {
    super(SceneKeys.Profile);
  }

  protected build(): HTMLElement {
    const root = h('div');
    this.name = profile.get().displayName;

    // ===== Thẻ hồ sơ (ảnh + tên + tên đăng nhập) =====
    this.headEl = h('div', { class: 'profile-head' });
    const card = h('section', { class: 'panel profile-card' }, h('h2', { text: 'Hồ sơ' }), this.headEl);

    // ===== Ảnh đại diện =====
    this.uploadBtn = h('button', { class: 'btn primary', text: 'Tải ảnh lên' });
    this.uploadBtn.addEventListener('click', () => this.fileInput.click());
    this.fileInput = h('input', { attrs: { type: 'file', accept: 'image/*', hidden: true } });
    this.fileInput.addEventListener('change', (e) => void this.onPickFile(e));

    this.actionsRow = h('div', { class: 'row avatar-actions' }, this.uploadBtn, this.fileInput);

    const grid = h('div', { class: 'avatar-grid' });
    for (const g of state.generals) {
      const btn = h(
        'button',
        { class: 'avatar-pick', attrs: { type: 'button', title: g.name } },
        h('img', { attrs: { src: portraitUrl(g.artKey), alt: g.name, loading: 'lazy', decoding: 'async' } }),
      );
      btn.addEventListener('click', () => void this.saveAvatar(portraitPath(g.artKey)));
      grid.appendChild(btn);
      this.picks.push({ artKey: g.artKey, el: btn });
    }

    const avatarPanel = h(
      'section',
      { class: 'panel' },
      h('h3', { text: 'Ảnh đại diện' }),
      h('p', { class: 'muted small', text: 'Tải ảnh từ máy (tối đa 1MB — ảnh sẽ được thu nhỏ tự động) hoặc chọn chân dung tướng có sẵn.' }),
      this.actionsRow,
      h('h4', { text: 'Chân dung tướng' }),
      grid,
    );

    // ===== Tên hiển thị =====
    this.nameInput = h('input', { attrs: { maxlength: DISPLAY_NAME_MAX, required: true, 'aria-label': 'Tên hiển thị' } });
    this.nameInput.value = this.name;
    this.nameInput.addEventListener('input', () => {
      this.name = this.nameInput.value;
      this.syncName();
    });
    this.nameSaveBtn = h('button', { class: 'btn primary', text: 'Lưu tên' });
    const nameForm = h('form', { class: 'profile-form' }, this.nameInput, this.nameSaveBtn);
    nameForm.addEventListener('submit', (e) => void this.saveName(e));

    const namePanel = h(
      'section',
      { class: 'panel' },
      h('h3', { text: 'Tên hiển thị' }),
      h('p', { class: 'muted small', text: `Tên hiển thị tối đa ${DISPLAY_NAME_MAX} ký tự. Mặc định trùng với tên đăng nhập.` }),
      nameForm,
    );

    // ===== Đổi mật khẩu =====
    this.curPwInput = h('input', { attrs: { type: 'password', autocomplete: 'current-password', required: true, minlength: 6 } });
    this.newPwInput = h('input', { attrs: { type: 'password', autocomplete: 'new-password', required: true, minlength: 6 } });
    this.confirmPwInput = h('input', { attrs: { type: 'password', autocomplete: 'new-password', required: true, minlength: 6 } });
    this.curPwInput.addEventListener('input', () => (this.curPw = this.curPwInput.value));
    this.newPwInput.addEventListener('input', () => (this.newPw = this.newPwInput.value));
    this.confirmPwInput.addEventListener('input', () => (this.confirmPw = this.confirmPwInput.value));
    this.pwBtn = h('button', { class: 'btn primary', text: 'Đổi mật khẩu' });
    const pwForm = h(
      'form',
      { class: 'profile-form' },
      h('label', {}, 'Mật khẩu hiện tại', this.curPwInput),
      h('label', {}, 'Mật khẩu mới', this.newPwInput),
      h('label', {}, 'Nhập lại mật khẩu mới', this.confirmPwInput),
      h('div', { class: 'row' }, this.pwBtn),
    );
    pwForm.addEventListener('submit', (e) => void this.changePassword(e));

    const pwPanel = h('section', { class: 'panel' }, h('h3', { text: 'Đổi mật khẩu' }), pwForm);

    root.append(card, avatarPanel, namePanel, pwPanel);

    this.track(() => (this.alive = false));

    return root;
  }

  protected loadData(): void {
    this.refreshHead();
    this.syncAvatar();
    this.syncName();
  }

  /** Vẽ lại khối đầu thẻ hồ sơ theo hồ sơ hiện tại. */
  private refreshHead(): void {
    const p = profile.get();
    render(
      this.headEl,
      avatarEl({ avatar: p.avatar, name: p.displayName, class: 'avatar-lg' }),
      h('div', { class: 'profile-id' }, h('div', { class: 'profile-name', text: p.displayName }), h('div', { class: 'muted small' }, 'Tên đăng nhập: ', state.username)),
    );
  }

  /** Đồng bộ nút/nút chọn ảnh theo hồ sơ + trạng thái đang lưu. */
  private syncAvatar(): void {
    const av = profile.get().avatar;
    this.uploadBtn.disabled = this.savingAvatar;
    if (av && !this.clearBtn) {
      const b = h('button', { class: 'btn ghost', text: 'Xoá ảnh' });
      b.addEventListener('click', () => void this.saveAvatar(null));
      this.actionsRow.insertBefore(b, this.fileInput);
      this.clearBtn = b;
    } else if (!av && this.clearBtn) {
      this.clearBtn.remove();
      this.clearBtn = null;
    }
    if (this.clearBtn) this.clearBtn.disabled = this.savingAvatar;
    for (const p of this.picks) {
      p.el.disabled = this.savingAvatar;
      p.el.classList.toggle('on', av === portraitPath(p.artKey));
    }
  }

  /** Nút "Lưu tên" chỉ bật khi tên khác bản đang lưu và không đang lưu. */
  private syncName(): void {
    this.nameSaveBtn.disabled = this.savingName || this.name.trim() === profile.get().displayName;
  }

  private async saveAvatar(avatar: string | null): Promise<void> {
    if (this.savingAvatar) return;
    this.savingAvatar = true;
    this.syncAvatar();
    try {
      const p = await api.updateProfile({ avatar });
      if (this.alive) {
        setProfile(p);
        this.refreshHead();
      }
      toast('Đã cập nhật ảnh đại diện.');
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      this.savingAvatar = false;
      if (this.alive) this.syncAvatar();
    }
  }

  private async onPickFile(ev: Event): Promise<void> {
    const input = ev.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // cho phép chọn lại đúng file vừa chọn
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast('Ảnh tối đa 1MB. Vui lòng chọn ảnh nhỏ hơn.');
      return;
    }
    try {
      await this.saveAvatar(await fileToAvatarDataUrl(file));
    } catch (e) {
      toast((e as Error).message);
    }
  }

  private async saveName(ev: Event): Promise<void> {
    ev.preventDefault();
    if (this.savingName) return;
    this.savingName = true;
    this.syncName();
    try {
      const p = await api.updateProfile({ displayName: this.name.trim() });
      if (this.alive) {
        setProfile(p);
        this.name = p.displayName;
        this.nameInput.value = p.displayName;
        this.refreshHead();
      }
      toast('Đã lưu tên hiển thị.');
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      this.savingName = false;
      this.syncName();
    }
  }

  private async changePassword(ev: Event): Promise<void> {
    ev.preventDefault();
    if (this.savingPw) return;
    if (this.newPw !== this.confirmPw) {
      toast('Mật khẩu nhập lại không khớp.');
      return;
    }
    this.savingPw = true;
    this.pwBtn.disabled = true;
    try {
      await api.changePassword(this.curPw, this.newPw);
      if (this.alive) {
        this.curPw = '';
        this.newPw = '';
        this.confirmPw = '';
        this.curPwInput.value = '';
        this.newPwInput.value = '';
        this.confirmPwInput.value = '';
      }
      toast('Đổi mật khẩu thành công.');
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      this.savingPw = false;
      this.pwBtn.disabled = false;
    }
  }
}
