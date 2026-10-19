import {
  GEM_ELEMENT_LABELS,
  GEM_STAT_LABELS,
  type CardDto,
  type GemConfigDto,
  type GemElement,
  type GeneralDto,
  type PvpGemStats,
} from '@tq/shared';
import { gemStatText } from '../assets/art.ts';
import { api } from '../services/api.ts';
import { cardEl } from './Card.ts';
import { combatDetailEl } from './CombatDetail.ts';
import { openCombatDetail } from './CombatDetailModal.ts';
import { h } from './dom.ts';
import { gemCardEl } from './GemCard.ts';

/**
 * Popup ngắm thẻ (mục 6.1): thẻ lớn + kỹ năng và chỉ số chi tiết của tướng ở đúng cấp thẻ (mục 6.7).
 * Dùng chung khung modal với Đấu trường (`openCombatDetail`) — chỉ khác là có thêm thẻ lớn.
 * Chỉ hiển thị, không đổi dữ liệu. Bấm bất kỳ đâu hoặc Esc để đóng.
 */
export function openCardViewer(general: GeneralDto, card: CardDto): void {
  const prev = document.activeElement as HTMLElement | null;
  // Khối chi tiết hiện "đang tải" rồi được thay bằng bảng chỉ số khi server trả về.
  const detail = h('div', { class: 'viewer-combat muted small', text: 'Đang tải chỉ số…' });
  openCombatDetail({
    name: general.name,
    level: card.level,
    faction: general.faction,
    card: cardEl({ general, level: card.level, extra: 'viewer-card' }),
    detail,
    extra: h('div', { class: 'muted small', text: `Nhận lúc ${new Date(card.createdAt).toLocaleString('vi-VN')}` }),
    onClose: () => prev?.focus?.(),
  });
  void api.generalCombat(general.id, card.level).then(
    (combat) => detail.replaceWith(combatDetailEl(combat)),
    (e: Error) => {
      detail.className = 'viewer-combat muted small';
      detail.textContent = `Không tải được chỉ số: ${e.message}`;
    },
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

/** Chỉ số Ngọc ở ĐÚNG cấp đang xem — nội dung thay bảng chỉ số tướng trong modal (mục 6.8). */
function gemDetailEl(o: { element: GemElement; config: GemConfigDto; owned?: number; best?: number; owner?: string; level: number }): HTMLElement {
  // Mỗi loại Ngọc chỉ dùng ĐÚNG 2 trường khác 0 — suy ra từ cấp 1 (mục 6.8).
  const keys = (Object.keys(GEM_STAT_LABELS) as (keyof PvpGemStats)[]).filter((k) => (o.config.table[o.element][0]?.[k] ?? 0) !== 0);
  const row = o.config.table[o.element][o.level - 1];

  const root = h('div', { class: 'viewer-combat' });
  if (o.owner !== undefined) {
    root.appendChild(h('div', { class: 'cmb-row' }, h('span', { class: 'cmb-key', text: 'Người chơi' }), h('span', { class: 'cmb-val' }, h('b', { text: o.owner }))));
  }
  if (o.owned !== undefined) {
    root.appendChild(
      h(
        'div',
        { class: 'cmb-row' },
        h('span', { class: 'cmb-key', text: 'Sở hữu' }),
        h('span', { class: 'cmb-val' }, h('b', { text: o.owned > 0 ? `${o.owned} viên · cấp cao nhất ${o.best ?? 0}` : 'Chưa sở hữu viên nào' })),
      ),
    );
  }
  root.appendChild(
    h(
      'div',
      { class: 'cmb-row' },
      h('span', { class: 'cmb-key', text: 'Hiệu ứng' }),
      h('span', { class: 'cmb-val' }, h('b', { text: 'Cộng Chỉ số Nền cho toàn đội khi vào trận (không thể bị Xóa Buff)' })),
    ),
  );
  for (const k of keys) {
    root.appendChild(
      h(
        'div',
        { class: 'cmb-row' },
        h('span', { class: 'cmb-key', text: GEM_STAT_LABELS[k] }),
        h('span', { class: 'cmb-val' }, h('b', { text: gemStatText(k, row?.[k] ?? 0, o.config.bpsScale) })),
      ),
    );
  }
  return root;
}

/**
 * Mở popup chi tiết một viên Ngọc Ngũ Hành — dùng CHUNG khung modal với tướng (`openCombatDetail`)
 * nên UI "y hệt" popup ngắm thẻ tướng, chỉ khác ruột là chỉ số của đúng cấp đang xem.
 */
export function openGemViewer(opts: GemViewerOpts): void {
  const prev = document.activeElement as HTMLElement | null;
  const level = opts.level ?? (opts.best || 1);
  openCombatDetail({
    name: `Ngọc ${GEM_ELEMENT_LABELS[opts.element]}`,
    level,
    levelLabel: `Cấp ${level}`,
    card: gemCardEl({ element: opts.element, level, extra: 'viewer-card' }),
    detail: gemDetailEl({ element: opts.element, config: opts.config, owned: opts.owned, best: opts.best, owner: opts.owner, level }),
    onClose: () => prev?.focus?.(),
  });
}
