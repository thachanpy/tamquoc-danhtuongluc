import { GEM_ELEMENT_LABELS, type GemElement } from '@tq/shared';
import { gemUrl, levelTier } from '../art.ts';

/**
 * Thẻ Ngọc (lưới DOM) — dùng CHUNG khung/kích thước với thẻ tướng (`.tq-card`) nên lưới nhóm,
 * khung "Đã chọn" và popup chi tiết của Ngọc trông y hệt Tướng (mục 6.8).
 * Ruột thẻ là ảnh viên Ngọc Ngũ Hành (`public/gem`); tên + cấp nằm đè ở chân thẻ đúng như thẻ tướng.
 */
export function GemCard(props: { element: GemElement; level: number; extra?: string }) {
  const label = () => `Ngọc ${GEM_ELEMENT_LABELS[props.element]}`;
  return (
    <div
      class={`tq-card gem-face e-${props.element} ${props.extra ?? ''}`}
      style={{ '--tc': levelTier(props.level).css }}
    >
      <div class="tq-body">
        <div class="tq-art">
          <img class="gem-img" src={gemUrl(props.element, props.level)} alt={`${label()} cấp ${props.level}`} loading="lazy" />
        </div>
        <div class="tq-meta">
          <div class="tq-name">{label()}</div>
          <div class="tq-sub">
            <span class="fac">Ngũ Hành</span>
            <span class="lv">{`Cấp ${props.level}`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
