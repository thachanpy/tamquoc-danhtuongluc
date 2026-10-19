import type { GiftCodePublicDto } from '@tq/shared';
import { STORAGE_KEYS } from '../core/constants.ts';
import { api } from '../services/api.ts';
import { state } from '../state/store.ts';
import { rewardText } from '../utils/giftcode-text.ts';
import { h } from './dom.ts';
import { openOverlay } from './modal.ts';

/**
 * Popup lần đầu đăng nhập (mục 3.9): mời nhập các giftcode gợi ý chưa nhập.
 * Chỉ hiện 1 lần cho mỗi tài khoản trên trình duyệt này (localStorage); bấm nút thì sang trang Giftcode.
 */
export async function maybeShowGiftCodePopup(): Promise<void> {
  const key = STORAGE_KEYS.gcPopupPrefix + state.username.toLowerCase();
  try {
    if (localStorage.getItem(key)) return;
  } catch {
    return; // trình duyệt chặn storage — bỏ qua popup để không lặp lại mỗi lần vào
  }

  let codes: GiftCodePublicDto[];
  try {
    codes = (await api.giftcodes()).featured.filter((c) => !c.redeemed);
  } catch {
    return;
  }
  if (!codes.length) return;

  const remember = (): void => {
    try {
      localStorage.setItem(key, '1');
    } catch {
      /* bỏ qua */
    }
  };

  const goBtn = h('button', { class: 'btn primary', text: 'Đến trang nhập Giftcode' });
  const laterBtn = h('button', { class: 'btn ghost', text: 'Để sau' });

  const close = openOverlay({
    className: 'gc-popup',
    boxClass: 'panel gc-popup-box',
    content: [
      h('h2', { text: 'Quà tân thủ' }),
      h('p', { text: `Chào mừng chủ công! Hãy nhập ${codes.length} giftcode này để nhận quà:` }),
      h(
        'ul',
        {},
        ...codes.map((c) => h('li', {}, h('b', { class: 'gc-code', text: c.code }), ` — ${rewardText(c.rewards)}`)),
      ),
      h('div', { class: 'row' }, goBtn, laterBtn),
    ],
    onClose: remember,
  });

  goBtn.addEventListener('click', () => {
    close();
    location.hash = 'giftcode';
  });
  laterBtn.addEventListener('click', () => close());
  goBtn.focus();
}
