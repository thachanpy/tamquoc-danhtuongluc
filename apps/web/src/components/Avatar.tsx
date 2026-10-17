import { createEffect, createSignal, Show, type JSX } from 'solid-js';
import { initials } from '../art.ts';

/**
 * Ảnh đại diện người chơi: hiển thị ảnh nếu có; nếu chưa có hoặc ảnh tải lỗi (404/định dạng hỏng)
 * thì hiển thị chữ cái đầu của tên hiển thị. Kích thước do class CSS quyết định (.avatar + class bổ sung).
 */
export function Avatar(props: { avatar: string | null; name: string; class?: string }): JSX.Element {
  const [failed, setFailed] = createSignal(false);
  // Đổi ảnh đại diện -> thử tải lại, bỏ trạng thái lỗi của ảnh cũ.
  createEffect(() => {
    props.avatar;
    setFailed(false);
  });
  return (
    <span class={`avatar ${props.class ?? ''}`} aria-hidden="true">
      <Show when={!failed() && props.avatar} fallback={<span class="avatar-ini">{initials(props.name)}</span>}>
        {(src) => <img src={src()} alt="" onError={() => setFailed(true)} />}
      </Show>
    </span>
  );
}
