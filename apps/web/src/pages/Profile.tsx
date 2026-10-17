import { For, Show, createSignal, onCleanup, type JSX } from 'solid-js';
import { DISPLAY_NAME_MAX } from '@tq/shared';
import { api, type ApiError } from '../api.ts';
import { profile, setProfile, state } from '../state.ts';
import { portraitUrl } from '../art.ts';
import { Avatar } from '../components/Avatar.tsx';
import { toast } from '../ui.ts';

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
export function ProfilePage(): JSX.Element {
  let alive = true;
  onCleanup(() => (alive = false));
  let fileInput!: HTMLInputElement;

  const [name, setName] = createSignal(profile().displayName);
  const [savingName, setSavingName] = createSignal(false);
  const [savingAvatar, setSavingAvatar] = createSignal(false);
  const [curPw, setCurPw] = createSignal('');
  const [newPw, setNewPw] = createSignal('');
  const [confirmPw, setConfirmPw] = createSignal('');
  const [savingPw, setSavingPw] = createSignal(false);

  async function saveAvatar(avatar: string | null) {
    if (savingAvatar()) return;
    setSavingAvatar(true);
    try {
      const p = await api.updateProfile({ avatar });
      if (alive) setProfile(p);
      toast('Đã cập nhật ảnh đại diện.');
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      setSavingAvatar(false);
    }
  }

  async function onPickFile(ev: Event & { currentTarget: HTMLInputElement }) {
    const file = ev.currentTarget.files?.[0];
    ev.currentTarget.value = ''; // cho phép chọn lại đúng file vừa chọn
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) return toast('Ảnh tối đa 1MB. Vui lòng chọn ảnh nhỏ hơn.');
    try {
      await saveAvatar(await fileToAvatarDataUrl(file));
    } catch (e) {
      toast((e as Error).message);
    }
  }

  async function saveName(ev: Event) {
    ev.preventDefault();
    if (savingName()) return;
    setSavingName(true);
    try {
      const p = await api.updateProfile({ displayName: name().trim() });
      if (alive) {
        setProfile(p);
        setName(p.displayName);
      }
      toast('Đã lưu tên hiển thị.');
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      setSavingName(false);
    }
  }

  async function changePassword(ev: Event) {
    ev.preventDefault();
    if (savingPw()) return;
    if (newPw() !== confirmPw()) return toast('Mật khẩu nhập lại không khớp.');
    setSavingPw(true);
    try {
      await api.changePassword(curPw(), newPw());
      if (alive) {
        setCurPw('');
        setNewPw('');
        setConfirmPw('');
      }
      toast('Đổi mật khẩu thành công.');
    } catch (e) {
      toast((e as ApiError).message);
    } finally {
      setSavingPw(false);
    }
  }

  const isPickedPortrait = (artKey: string) => profile().avatar === portraitPath(artKey);
  const nameDirty = () => name().trim() !== profile().displayName;

  return (
    <>
      <section class="panel profile-card">
        <h2>Hồ sơ</h2>
        <div class="profile-head">
          <Avatar avatar={profile().avatar} name={profile().displayName} class="avatar-lg" />
          <div class="profile-id">
            <div class="profile-name">{profile().displayName}</div>
            <div class="muted small">Tên đăng nhập: {state.username}</div>
          </div>
        </div>
      </section>

      <section class="panel">
        <h3>Ảnh đại diện</h3>
        <p class="muted small">
          Tải ảnh từ máy (tối đa 1MB — ảnh sẽ được thu nhỏ tự động) hoặc chọn chân dung tướng có sẵn.
        </p>
        <div class="row avatar-actions">
          <button class="btn primary" disabled={savingAvatar()} onClick={() => fileInput.click()}>
            Tải ảnh lên
          </button>
          <Show when={profile().avatar}>
            <button class="btn ghost" disabled={savingAvatar()} onClick={() => void saveAvatar(null)}>
              Xoá ảnh
            </button>
          </Show>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void onPickFile(e)} />
        </div>

        <h4>Chân dung tướng</h4>
        <div class="avatar-grid">
          <For each={state.generals}>
            {(g) => (
              <button
                type="button"
                class="avatar-pick"
                classList={{ on: isPickedPortrait(g.artKey) }}
                title={g.name}
                disabled={savingAvatar()}
                onClick={() => void saveAvatar(portraitPath(g.artKey))}
              >
                <img src={portraitUrl(g.artKey)} alt={g.name} loading="lazy" decoding="async" />
              </button>
            )}
          </For>
        </div>
      </section>

      <section class="panel">
        <h3>Tên hiển thị</h3>
        <p class="muted small">Tên hiển thị tối đa {DISPLAY_NAME_MAX} ký tự. Mặc định trùng với tên đăng nhập.</p>
        <form class="profile-form" onSubmit={(e) => void saveName(e)}>
          <input
            value={name()}
            maxLength={DISPLAY_NAME_MAX}
            required
            aria-label="Tên hiển thị"
            onInput={(e) => setName(e.currentTarget.value)}
          />
          <button class="btn primary" disabled={savingName() || !nameDirty()}>
            Lưu tên
          </button>
        </form>
      </section>

      <section class="panel">
        <h3>Đổi mật khẩu</h3>
        <form class="profile-form" onSubmit={(e) => void changePassword(e)}>
          <label>
            Mật khẩu hiện tại
            <input
              type="password"
              autocomplete="current-password"
              required
              minLength={6}
              value={curPw()}
              onInput={(e) => setCurPw(e.currentTarget.value)}
            />
          </label>
          <label>
            Mật khẩu mới
            <input
              type="password"
              autocomplete="new-password"
              required
              minLength={6}
              value={newPw()}
              onInput={(e) => setNewPw(e.currentTarget.value)}
            />
          </label>
          <label>
            Nhập lại mật khẩu mới
            <input
              type="password"
              autocomplete="new-password"
              required
              minLength={6}
              value={confirmPw()}
              onInput={(e) => setConfirmPw(e.currentTarget.value)}
            />
          </label>
          <div class="row">
            <button class="btn primary" disabled={savingPw()}>
              Đổi mật khẩu
            </button>
          </div>
        </form>
      </section>
    </>
  );
}
