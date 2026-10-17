import { For, Show, createSignal, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import {
  GEM_ELEMENT_LABELS,
  GEM_STAT_LABELS,
  type CardDto,
  type GemConfigDto,
  type GemElement,
  type GeneralDto,
  type PvpCombatDto,
  type PvpGemStats,
} from '@tq/shared';
import { api } from './api.ts';
import { gemStatText } from './art.ts';
import { Card } from './components/Card.tsx';
import { GemCard } from './components/GemCard.tsx';
import { CombatDetailModal } from './components/CombatDetailModal.tsx';

/**
 * Popup ngắm thẻ (mục 6.1): thẻ lớn + kỹ năng và chỉ số chi tiết của tướng ở đúng cấp thẻ (mục 6.7).
 * Dùng chung khung modal với Đấu trường (`CombatDetailModal`) — chỉ khác là có thêm thẻ lớn.
 * Chỉ hiển thị, không đổi dữ liệu. Bấm bất kỳ đâu hoặc Esc để đóng.
 */
function CardViewer(props: { general: GeneralDto; card: CardDto; onClose: () => void }) {
  const [combat, setCombat] = createSignal<PvpCombatDto | null>(null);
  const [combatError, setCombatError] = createSignal<string | null>(null);
  onMount(() => {
    void api
      .generalCombat(props.general.id, props.card.level)
      .then(setCombat)
      .catch((e: Error) => setCombatError(e.message));
  });
  return (
    <CombatDetailModal
      name={props.general.name}
      level={props.card.level}
      faction={props.general.faction}
      combat={combat()}
      error={combatError()}
      card={<Card general={props.general} level={props.card.level} extra="viewer-card" />}
      extra={<div class="muted small">Nhận lúc {new Date(props.card.createdAt).toLocaleString('vi-VN')}</div>}
      onClose={() => props.onClose()}
    />
  );
}

/** Mở popup ngắm thẻ; gọi được từ bất kỳ trang nào. Đóng thì gỡ DOM và trả focus về chỗ cũ. */
export function openCardViewer(general: GeneralDto, card: CardDto): void {
  const prev = document.activeElement as HTMLElement | null;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(
    () => (
      <CardViewer
        general={general}
        card={card}
        onClose={() => {
          dispose();
          host.remove();
          prev?.focus?.();
        }}
      />
    ),
    host,
  );
}

/** Chỉ số Ngọc ở ĐÚNG cấp đang xem — nội dung thay bảng chỉ số tướng trong modal (mục 6.8). */
function GemDetail(props: {
  element: GemElement;
  config: GemConfigDto;
  /** Số viên người chơi đang sở hữu loại này; bỏ trống khi xem từ trang Quản trị. */
  owned?: number;
  /** Cấp cao nhất đang sở hữu (đi kèm `owned`). */
  best?: number;
  /** Tên người chơi sở hữu viên Ngọc — chỉ trang Quản trị truyền. */
  owner?: string;
  level: number;
}) {
  // Mỗi loại Ngọc chỉ dùng ĐÚNG 2 trường khác 0 — suy ra từ cấp 1 (mục 6.8).
  const keys = () =>
    (Object.keys(GEM_STAT_LABELS) as (keyof PvpGemStats)[]).filter((k) => (props.config.table[props.element][0]?.[k] ?? 0) !== 0);
  const row = () => props.config.table[props.element][props.level - 1];
  return (
    <div class="viewer-combat">
      <Show when={props.owner}>
        {(who) => (
          <div class="cmb-row">
            <span class="cmb-key">Người chơi</span>
            <span class="cmb-val">
              <b>{who()}</b>
            </span>
          </div>
        )}
      </Show>
      <Show when={props.owned !== undefined}>
        <div class="cmb-row">
          <span class="cmb-key">Sở hữu</span>
          <span class="cmb-val">
            <b>{props.owned! > 0 ? `${props.owned} viên · cấp cao nhất ${props.best ?? 0}` : 'Chưa sở hữu viên nào'}</b>
          </span>
        </div>
      </Show>
      <div class="cmb-row">
        <span class="cmb-key">Hiệu ứng</span>
        <span class="cmb-val">
          <b>Cộng Chỉ số Nền cho toàn đội khi vào trận (không thể bị Xóa Buff)</b>
        </span>
      </div>
      <For each={keys()}>
        {(k) => (
          <div class="cmb-row">
            <span class="cmb-key">{GEM_STAT_LABELS[k]}</span>
            <span class="cmb-val">
              <b>{gemStatText(k, row()?.[k] ?? 0, props.config.bpsScale)}</b>
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

/** Thông tin một viên Ngọc cần để mở popup chi tiết (Bộ sưu tập / Nâng cấp / Quản trị truyền vào). */
export interface GemViewerOpts {
  element: GemElement;
  config: GemConfigDto;
  /** Số viên đang sở hữu của loại này (bỏ trống khi xem từ trang Quản trị). */
  owned?: number;
  /** Cấp cao nhất đang sở hữu (0 = chưa có). */
  best?: number;
  /** Tên người chơi sở hữu viên Ngọc — chỉ trang Quản trị truyền. */
  owner?: string;
  /** Cấp của viên vừa bấm; mặc định lấy cấp cao nhất đang sở hữu. */
  level?: number;
}

/**
 * Mở popup chi tiết một viên Ngọc Ngũ Hành — dùng CHUNG khung modal với tướng (`CombatDetailModal`)
 * nên UI "y hệt" popup ngắm thẻ tướng, chỉ khác ruột là chỉ số của đúng cấp đang xem.
 */
export function openGemViewer(opts: GemViewerOpts): void {
  const prev = document.activeElement as HTMLElement | null;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const level = opts.level ?? (opts.best || 1);
  const dispose = render(
    () => (
      <CombatDetailModal
        name={`Ngọc ${GEM_ELEMENT_LABELS[opts.element]}`}
        level={level}
        levelLabel={`Cấp ${level}`}
        card={<GemCard element={opts.element} level={level} extra="viewer-card" />}
        detail={
          <GemDetail
            element={opts.element}
            config={opts.config}
            owned={opts.owned}
            best={opts.best}
            owner={opts.owner}
            level={level}
          />
        }
        onClose={() => {
          dispose();
          host.remove();
          prev?.focus?.();
        }}
      />
    ),
    host,
  );
}
