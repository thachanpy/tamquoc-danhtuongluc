import { Show, createSignal } from 'solid-js';
import { FACTION_LABELS, type GeneralDto } from '@tq/shared';
import { FACTION_STYLE, FRAME_LAYOUT, frameUrl, initials, levelTier, portraitUrl } from '../art.ts';

/**
 * Thẻ tướng (lưới DOM): chân dung tướng, placeholder (glyph phe + chữ viết tắt) nằm dưới làm dự phòng,
 * khung theo cấp phủ lên trên. level = null => tướng chưa sở hữu (hiển thị mờ).
 * Class CSS giữ nguyên như bản HTML cũ (.tq-card, .framed, .tier-N, .unowned …).
 */
export function Card(props: { general: GeneralDto; level: number | null; extra?: string }) {
  // Ghi nhớ artKey bị lỗi ảnh (không phải cờ boolean) để thẻ đổi tướng tại chỗ (VD ô "Đã chọn") thử lại ảnh mới
  const [failedArt, setFailedArt] = createSignal<string | null>(null);
  const imgFailed = () => failedArt() === props.general.artKey;
  const f = () => FACTION_STYLE[props.general.faction];
  const lv = () => (props.level ? Math.min(Math.max(props.level, 1), 10) : null);
  const tier = () => (props.level ? levelTier(props.level) : null);
  return (
    <div
      class={`tq-card ${lv() ? `framed tier-${lv()}` : 'unowned'} ${props.extra ?? ''}`}
      style={{ '--fc': f().css, '--fd': f().dark, '--tc': tier()?.css ?? '#444' }}
      data-art={props.general.artKey}
    >
      <div class="tq-body">
        <div class="tq-art">
          <span class="glyph">{f().glyph}</span>
          <span class="ini">{initials(props.general.name)}</span>
          <Show when={!imgFailed()}>
            <img
              class="portrait"
              src={portraitUrl(props.general.artKey)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailedArt(props.general.artKey)}
            />
          </Show>
        </div>
        <div class="tq-meta">
          <div class="tq-name">{props.general.name}</div>
          <div class="tq-sub">
            <span class="fac">{FACTION_LABELS[props.general.faction]}</span>
            <Show when={props.level} fallback={<span class="lv dim">Chưa có</span>}>
              <span class="lv">Lv.{props.level}</span>
            </Show>
          </div>
        </div>
      </div>
      <Show when={lv()}>
        {(l) => {
          const fl = () => FRAME_LAYOUT[l()]!;
          return (
            <span
              class="tq-frame"
              aria-hidden="true"
              style={{
                'background-image': `url(${frameUrl(l())})`,
                left: `${fl().left}%`,
                top: `${fl().top}%`,
                width: `${fl().width}%`,
                height: `${fl().height}%`,
              }}
            />
          );
        }}
      </Show>
    </div>
  );
}
