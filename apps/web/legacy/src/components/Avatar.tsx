import { Show, type JSX } from 'solid-js';
import { initials } from '../art.ts';

/**
 * Ảnh đại diện người chơi: chữ cái đầu của tên hiển thị là lớp nền (đúng pattern `.rp-mini` / thẻ tướng),
 * ảnh thật phủ lên trên và tự ẩn khi tải lỗi (404, đổi định dạng…) nên luôn còn chữ cái đầu làm dự phòng.
 * Kích thước do class CSS quyết định (.avatar + class bổ sung).
 */
export function Avatar(props: { avatar: string | null; name: string; class?: string }): JSX.Element {
  return (
    <span class={`avatar ${props.class ?? ''}`} aria-hidden="true">
      <span class="avatar-ini">{initials(props.name)}</span>
      <Show when={props.avatar}>
        {(src) => <img src={src()} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />}
      </Show>
    </span>
  );
}
