import { Show, type JSX } from 'solid-js';
import { initials } from '../art.ts';

/**
 * Ảnh đại diện người chơi: hiển thị ảnh nếu có, ngược lại hiển thị chữ cái đầu của tên hiển thị.
 * Kích thước do class CSS quyết định (.avatar + class bổ sung).
 */
export function Avatar(props: { avatar: string | null; name: string; class?: string }): JSX.Element {
  return (
    <span class={`avatar ${props.class ?? ''}`} aria-hidden="true">
      <Show when={props.avatar} fallback={<span class="avatar-ini">{initials(props.name)}</span>}>
        {(src) => <img src={src()} alt="" />}
      </Show>
    </span>
  );
}
