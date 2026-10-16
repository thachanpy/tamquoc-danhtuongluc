import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import type {
  CardDto,
  Faction,
  PvpBattleDto,
  PvpBattleSummaryDto,
  PvpCombatDto,
  PvpEventDto,
  PvpOpponentDto,
  PvpOutcome,
  PvpOverviewDto,
  PvpSide,
  PvpSkill,
  PvpStyle,
  PvpUnitDto,
  PvpUnitStateDto,
} from '@tq/shared';
import { FACTIONS, FACTION_LABELS, PVP_BUFF_SCOPE_LABELS, PVP_PASSIVE_LABELS, PVP_SKILL_LABELS, PVP_STYLES, PVP_STYLE_LABELS } from '@tq/shared';
import { api, fetchAllCards } from '../api.ts';
import { gen, genStyle, pvpTarget, setPvpTarget } from '../state.ts';
import { Avatar } from '../components/Avatar.tsx';
import { CombatDetailModal } from '../components/CombatDetailModal.tsx';
import { StyleIcon } from '../components/StyleIcon.tsx';
import { StatIcon } from '../components/StatIcon.tsx';
import { FACTION_STYLE, STYLE_COLOR, initials, levelTier, pct, portraitUrl } from '../art.ts';
import { preBattleNote } from '../combat-notes.ts';
import type { IconId } from '../icons.ts';
import { createArena, type ArenaHandle, type ArenaUnit, type ArenaView, type FloatPart } from '../pixi/arena.ts';
import type { FxKind } from '../pixi/skillsfx.ts';
import { toast } from '../ui.ts';
import { playSfx, sfxPrefs, stopAllSfx, toggleSfx, type SfxName } from '../sfx.ts';

/**
 * Đấu trường PvP (mục 6.7 — PVP.md).
 * Người chơi xếp đội 6 tướng (3 hàng trước + 3 hàng sau), chọn đối thủ từ bảng xếp hạng
 * rồi khiêu chiến. Server mô phỏng trọn trận và trả dữ liệu; trang này chỉ phát lại.
 */

const num = (n: number) => n.toLocaleString('vi-VN');
const FRONT = [1, 2, 3];
const BACK = [4, 5, 6];
const SLOT_LABEL: Record<number, string> = { 1: 'Trước·Trên', 2: 'Trước·Giữa', 3: 'Trước·Dưới', 4: 'Sau·Trên', 5: 'Sau·Giữa', 6: 'Sau·Dưới' };

const OUTCOME_LABEL: Record<PvpOutcome, string> = { win: 'Thắng', loss: 'Thua', draw: 'Hòa' };
const outcomeClass = (r: PvpOutcome) => (r === 'win' ? 'win' : r === 'loss' ? 'loss' : 'draw');
const mySideOfWinner = (b: PvpBattleDto): PvpOutcome => b.result;
const time = (isoStr: string) => new Date(isoStr).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Tiếng ứng với một sự kiện trận (null = sự kiện không có âm thanh riêng). */
function sfxOf(ev: PvpEventDto): SfxName | null {
  switch (ev.t) {
    case 'damage':
      return ev.crit ? 'attackCrit' : 'attackNormal';
    case 'counter':
      return 'counter';
    case 'heal':
      return ev.lifesteal ? 'lifesteal' : 'heal';
    case 'buff':
      return ev.damageFlat > 0 ? 'buff' : 'heal';
    case 'burn':
      return 'burn';
    case 'miss':
      return 'dodge';
    case 'shield':
      return 'buff';
    case 'shieldBreak':
      return 'dispel';
    case 'revive':
      return 'heal';
    case 'stun':
      return 'stun';
    case 'dispel':
    case 'purify':
      return 'dispel';
    case 'down':
      return 'death';
    default:
      return null;
  }
}

/** Chỉ số cơ bản của một tướng để hiển thị ở bước chuẩn bị (server tính, client chỉ hiện). */
interface UnitStat {
  style: PvpStyle;
  /** Sát thương cơ bản của tướng (đã gồm hiệu ứng nền + nội tại của chính tướng + Chỉ số Nền Ra Trận). */
  damage: number;
  maxHp: number;
  /** Tỉ lệ chí mạng khi vào trận (bps, 10000 = 100%). */
  critBps: number;
  /** Sát thương chí mạng (bps; 5000 = ×1,5). */
  critDamageBps: number;
  /** Chính xác khi vào trận (bps). */
  hitBps: number;
  /** Né tránh khi vào trận (bps). */
  dodgeBps: number;
  /** Phòng thủ khi vào trận (bps): % giảm sát thương nhận vào. */
  defBps: number;
  /** Lực chiến (LC) của riêng tướng ở cấp này — chỉ số tổng hợp dùng xếp thứ tự ra đòn (mục 1). */
  lc: number;
  /**
   * Chỉ số Nền Ra Trận (màn chuẩn bị): phần cộng thêm so với chỉ số gốc + nhãn chi tiết % để hiện badge.
   * null = xem tự do (không có ngữ cảnh đội) nên không có badge.
   */
  pre?: { hpPlus: number; damagePlus: number; hpNote: string; damageNote: string } | null;
}
const statOf = (c: PvpCombatDto): UnitStat => {
  const pb = c.preBattle;
  return {
    style: c.style,
    damage: pb ? pb.damage : c.self.damage,
    maxHp: pb ? pb.maxHp : c.self.maxHp,
    critBps: c.self.critBps,
    critDamageBps: c.self.critDamageBps,
    hitBps: c.self.hitBps,
    dodgeBps: c.self.dodgeBps,
    defBps: c.self.defBps,
    lc: c.self.lc,
    pre: pb
      ? {
          hpPlus: pb.maxHp - c.self.maxHp,
          damagePlus: pb.damage - c.self.damage,
          hpNote: preBattleNote(c, 'hp'),
          damageNote: preBattleNote(c, 'damage'),
        }
      : null,
  };
};
/** Khóa tra chỉ số: gồm cả chữ ký đội (kèm vị trí) để hai đội khác nhau không dùng nhầm chỉ số nền của nhau. */
const squadKey = (units: PvpUnitDto[]) =>
  units
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((u) => `${u.generalId}@${u.slot}`)
    .join(',');
const statKey = (u: PvpUnitDto, squad: PvpUnitDto[]) => `${u.generalId}|${u.level}|${squadKey(squad)}`;

/**
 * Mô tả buff tăng sức mạnh của một kỹ năng (nhóm TEAM_ và BUFF_ALLIES) kèm LƯỢNG tăng mỗi lớp:
 * "cả đội +10% sát thương", "cả đội +10% HP tối đa", "cả đội +5 điểm chí mạng".
 */
const TEAM_BUFF_FIELDS: { key: 'damageBps' | 'hpBps' | 'critBps' | 'critDamageBps' | 'takenDownBps' | 'lifestealBps' | 'hitBps' | 'dodgeBps' | 'defBps' | 'defPenBps'; text: (v: number) => string }[] = [
  { key: 'damageBps', text: (v) => `+${pct(v)} sát thương` },
  { key: 'hpBps', text: (v) => `+${pct(v)} HP tối đa` },
  { key: 'critBps', text: (v) => `+${v / 100} điểm chí mạng` },
  { key: 'critDamageBps', text: (v) => `+${pct(v)} ST chí mạng` },
  { key: 'takenDownBps', text: (v) => `−${pct(v)} sát thương gánh chịu` },
  { key: 'lifestealBps', text: (v) => `+${pct(v)} hút máu` },
  { key: 'hitBps', text: (v) => `+${pct(v)} chính xác` },
  { key: 'dodgeBps', text: (v) => `+${pct(v)} né tránh` },
  { key: 'defBps', text: (v) => `+${pct(v)} phòng thủ` },
  { key: 'defPenBps', text: (v) => `+${pct(v)} xuyên giáp` },
];
function teamBuffText(buffs?: PvpUnitStateDto['buffs']): string {
  if (!buffs?.length) return '';
  const parts = buffs
    .map((e) => {
      const gains = TEAM_BUFF_FIELDS.filter((f) => (e.buff[f.key] ?? 0) > 0)
        .map((f) => f.text(e.buff[f.key]))
        .join(' · ');
      if (!gains) return '';
      return `${PVP_BUFF_SCOPE_LABELS[e.scope]} ${gains} (tối đa ${e.buff.maxLayers} lớp, mỗi lớp ${e.buff.rounds} lượt)`;
    })
    .filter(Boolean);
  return parts.join(' · ');
}

/** Mô tả hiệu ứng bất lợi mà kỹ năng của tướng áp lên địch (hiện kèm khi tướng thi triển). */
const DEBUFF_FIELDS: { key: 'damageDownBps' | 'hpDownBps' | 'critDownBps' | 'critDamageDownBps' | 'hitDownBps' | 'dodgeDownBps' | 'defDownBps' | 'defPenDownBps' | 'burnBps'; text: (v: number) => string }[] = [
  { key: 'damageDownBps', text: (v) => `−${pct(v)} sát thương địch` },
  { key: 'hpDownBps', text: (v) => `−${pct(v)} HP tối đa địch` },
  { key: 'critDownBps', text: (v) => `−${v / 100} điểm chí mạng địch` },
  { key: 'critDamageDownBps', text: (v) => `−${pct(v)} ST chí mạng địch` },
  { key: 'hitDownBps', text: (v) => `−${pct(v)} chính xác địch` },
  { key: 'dodgeDownBps', text: (v) => `−${pct(v)} né tránh địch` },
  { key: 'defDownBps', text: (v) => `−${pct(v)} phòng thủ địch` },
  { key: 'defPenDownBps', text: (v) => `−${pct(v)} xuyên giáp địch` },
  { key: 'burnBps', text: (v) => `thiêu đốt ${pct(v)} sát thương mỗi đầu lượt` },
];
function debuffText(debuff?: PvpUnitStateDto['debuff']): string {
  if (!debuff) return '';
  const parts = DEBUFF_FIELDS.filter((f) => (debuff[f.key] ?? 0) > 0).map((f) => f.text(debuff[f.key]));
  return parts.length ? `${parts.join(' · ')} (tối đa ${debuff.maxLayers} lớp, mỗi lớp ${debuff.rounds} lượt)` : '';
}

/** Ảnh đại diện tướng hiện trong modal chi tiết (Đấu trường không có thẻ lớn) — ảnh lỗi thì hiện chữ cái đầu. */
const artThumb = (name: string, artKey: string) => (
  <>
    <span class="viewer-art-ini">{initials(name)}</span>
    <img src={portraitUrl(artKey)} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />
  </>
);

/** Dòng chỉ số cơ bản hiện dưới mỗi ô tướng trong đội hình (không hiện chi tiết kỹ năng cho gọn). */
function StatLine(props: { stat?: UnitStat }) {
  return (
    <Show when={props.stat} fallback={<span class="pvp-cell-stat loading">…</span>}>
      {(s) => (
        <span class="pvp-cell-stat">
          {/* Hàng 1: sát thương · HP tối đa · phòng thủ (kèm badge phần cộng thêm của Chỉ số Nền Ra Trận).
              Mỗi chỉ số là một khối riêng nên tự xuống dòng khi ô hẹp, không tràn/cắt mất chữ. */}
          <span class="pvp-cell-num row1">
            <span class="pvp-stat">
              <StatIcon id="attack" size={11} /> {num(s().damage)}
              <Show when={s().pre && s().pre!.damagePlus > 0}>
                <em class="pvp-pre" title={s().pre!.damageNote}>{`(+${num(s().pre!.damagePlus)})`}</em>
              </Show>
            </span>
            <span class="pvp-stat">
              <StatIcon id="heart" size={11} /> {num(s().maxHp)}
              <Show when={s().pre && s().pre!.hpPlus > 0}>
                <em class="pvp-pre" title={s().pre!.hpNote}>{`(+${num(s().pre!.hpPlus)})`}</em>
              </Show>
            </span>
            <span class="pvp-stat">
              <StatIcon id="armor" size={11} /> {pct(s().defBps)}
            </span>
          </span>
          {/* Hàng 2: chí mạng · ST chí mạng · chính xác · né tránh (giống dòng chỉ số trên sân đấu).
              Mỗi chỉ số là một khối riêng nên tự xuống dòng khi ô hẹp, không tràn ra ngoài ô tướng. */}
          <span class="pvp-cell-num row2">
            <span class="pvp-stat">
              <StatIcon id="crit-rate" size={11} /> {pct(s().critBps)}
            </span>
            <span class="pvp-stat">
              <StatIcon id="crit-dmg" size={11} /> {pct(s().critDamageBps)}
            </span>
            <span class="pvp-stat">
              <StatIcon id="eye" size={11} /> {pct(s().hitBps)}
            </span>
            <span class="pvp-stat">
              <StatIcon id="dodge" size={11} /> {pct(s().dodgeBps)}
            </span>
          </span>
        </span>
      )}
    </Show>
  );
}

/**
 * Bảng "Quy tắc đội hình" — gộp Vị trí đội hình · Phong cách · Cùng phe của Chỉ số Nền Ra Trận
 * (SKILLS.md mục 1, 6.7) vào một popup sau nút icon để màn chuẩn bị chiến gọn hơn.
 */
const FORMATION_STYLE_RULES: readonly { style: PvpStyle; note: string }[] = [
  { style: 'attack', note: '+8% Sát thương cơ bản' },
  { style: 'defense', note: '+8% Máu cơ bản' },
  { style: 'support', note: '+2% Máu và +2% Sát thương cho toàn đội mỗi tướng Hỗ trợ (tối đa 6 lớp = +12%/+12%)' },
];
/** Thưởng Cùng phe theo số tướng cùng phe với tướng đó trong đội (`PVP_FACTION_*` trong game-config). */
const FORMATION_FACTION_RULES: readonly { count: number; note: string }[] = [
  { count: 2, note: '+2% Máu' },
  { count: 3, note: '+4% Máu · +2% Sát thương' },
  { count: 4, note: '+6% Máu · +4% Sát thương' },
  { count: 5, note: '+8% Máu · +6% Sát thương' },
  { count: 6, note: '+10% Máu · +8% Sát thương' },
];

/** Nút icon thông tin: bấm để mở/đóng bảng quy tắc đội hình + chỉ số nền ra trận. */
function FormationRules(props: { up?: boolean }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="pvp-rules" classList={{ up: props.up }}>
      <button
        type="button"
        class="pvp-rules-btn"
        classList={{ on: open() }}
        aria-expanded={open() ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)}
        title="Quy tắc đội hình & chỉ số nền ra trận"
      >
        <StatIcon id="info" size={13} />
        <span>Quy tắc đội hình</span>
      </button>
      <Show when={open()}>
        <div class="pvp-rules-pop">
          <p class="pvp-rules-sec">Vị trí đội hình</p>
          <ul class="pvp-rules-list">
            <li>
              Xếp tối đa <b>6 tướng</b> — 3 hàng trước (vị trí 1-2-3) và 3 hàng sau (vị trí 4-5-6), mỗi tướng đứng 1 vị trí.
            </li>
            <li>
              <b>Hàng trước</b> +5% Máu cơ bản.
            </li>
            <li>
              <b>Hàng sau</b> +5% Sát thương cơ bản.
            </li>
          </ul>

          <p class="pvp-rules-sec">Phong cách</p>
          <ul class="pvp-rules-list">
            <For each={FORMATION_STYLE_RULES}>
              {(r) => (
                <li>
                  <StyleIcon style={r.style} size={11} /> <b>{PVP_STYLE_LABELS[r.style]}</b>: {r.note}
                </li>
              )}
            </For>
          </ul>

          <p class="pvp-rules-sec">Cùng phe</p>
          <ul class="pvp-rules-list">
            <For each={FORMATION_FACTION_RULES}>
              {(r) => (
                <li>
                  <b>{`${r.count} tướng cùng phe`}</b>: {r.note}
                </li>
              )}
            </For>
          </ul>
          <p class="muted small pvp-rules-note">
            Thưởng Phe tính theo phe của chính tướng đó ({FACTIONS.map((f) => FACTION_LABELS[f]).join(' · ')}). Toàn bộ
            cộng thẳng vào Máu/Sát thương gốc khi ra trận — không phải buff trong trận nên không bị Xóa Buff.
          </p>
        </div>
      </Show>
    </div>
  );
}

/** Ô một tướng trên bàn đội hình (dùng cho cả đội mình và đội đối thủ). */
function UnitCell(props: {
  slot: number;
  unit?: PvpUnitDto;
  stat?: UnitStat;
  /** Bấm ô để chọn/đổi tướng (không truyền = ô chỉ để xem). */
  onClick?: (slot: number) => void;
  /** Bấm ảnh đại diện để xem chi tiết kỹ năng/chỉ số (không truyền = ảnh không bấm được). */
  onDetail?: () => void;
  /** Giữ và kéo tướng từ ô này sang ô khác (không truyền = không kéo thả được). */
  onDragStart?: (e: PointerEvent, slot: number) => void;
  dragging?: boolean;
  dropTarget?: boolean;
}) {
  const g = () => (props.unit ? gen(props.unit.generalId) : null);
  const interactive = () => !!props.onClick;
  return (
    // Dùng div thay button: ô đội địch chỉ để xem nhưng ảnh đại diện vẫn phải bấm được
    // (nút disabled chặn luôn sự kiện chuột của phần tử con).
    <div
      class="pvp-cell"
      classList={{
        empty: !props.unit,
        fill: !!props.unit,
        static: !interactive(),
        dragging: !!props.dragging,
        'drop-target': !!props.dropTarget,
      }}
      data-slot={props.slot}
      role={interactive() ? 'button' : undefined}
      tabIndex={interactive() ? 0 : undefined}
      title={props.unit ? `${g()!.name} · Lv.${props.unit.level}${props.onDragStart ? ' · kéo để đổi vị trí' : ''}` : SLOT_LABEL[props.slot]}
      onClick={() => props.onClick?.(props.slot)}
      onKeyDown={(e) => {
        if (!interactive() || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        props.onClick?.(props.slot);
      }}
      onPointerDown={(e) => props.onDragStart?.(e, props.slot)}
    >
      <span class="pvp-slot">{props.slot}</span>
      <Show when={props.unit} fallback={<span class="pvp-empty">＋</span>}>
        {(u) => (
          <>
            <span
              class="pvp-art"
              role={props.onDetail ? 'button' : undefined}
              tabIndex={props.onDetail ? 0 : undefined}
              title={props.onDetail ? `Xem chi tiết ${g()!.name}` : undefined}
              onClick={(e) => {
                if (!props.onDetail) return;
                e.stopPropagation();
                props.onDetail();
              }}
              onKeyDown={(e) => {
                if (!props.onDetail || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault();
                e.stopPropagation();
                props.onDetail();
              }}
            >
              <span class="pvp-ini">{initials(g()!.name)}</span>
              <img src={portraitUrl(g()!.artKey)} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />
            </span>
            <span class="pvp-cell-name">{g()!.name}</span>
            <span class="pvp-cell-tags">
              <span class="pvp-cell-lv" style={{ 'border-color': levelTier(u().level).css, color: levelTier(u().level).css }}>{`Lv.${u().level}`}</span>
              {/* Phe của tướng — hiện ngay trên ô đội hình để biết đội đang có những phe nào */}
              <span class="pvp-cell-faction" style={{ color: FACTION_STYLE[g()!.faction].css }} title={FACTION_LABELS[g()!.faction]}>
                {FACTION_LABELS[g()!.faction]}
              </span>
              {/* Phong cách chiến đấu: Tấn công (kiếm) / Phòng thủ (khiên) / Hỗ trợ (sách) — cùng hàng với cấp và phe */}
              <span class="pvp-cell-style" style={{ color: STYLE_COLOR[genStyle(g()!.id)] }} title={PVP_STYLE_LABELS[genStyle(g()!.id)]}>
                <StyleIcon style={genStyle(g()!.id)} size={11} />
              </span>
              {/* Lực chiến (LC) — chip cuối trong chuỗi định danh: cấp → phe → phong cách → LC */}
              <Show when={props.stat}>
                {(s) => <span class="pvp-cell-lc" title="Lực chiến">{`LC ${num(s().lc)}`}</span>}
              </Show>
            </span>
            <StatLine stat={props.stat} />
          </>
        )}
      </Show>
    </div>
  );
}

/** Lưới 3×2: cột Hàng sau / Hàng trước. Đội đối thủ lật thứ tự cột cho đối xứng. */
function TeamBoard(props: {
  units: PvpUnitDto[];
  /** Chi tiết chiến đấu theo (tướng|cấp) — dùng cho dòng chỉ số và hộp chi tiết khi bấm ảnh đại diện. */
  combat?: Record<string, PvpCombatDto>;
  foe?: boolean;
  onSlot?: (slot: number) => void;
  /** Kéo thả đổi vị trí hai ô trong đội mình (mục 6.7). */
  onMove?: (from: number, to: number) => void;
}) {
  const bySlot = createMemo(() => new Map(props.units.map((u) => [u.slot, u])));
  const [dragFrom, setDragFrom] = createSignal<number | null>(null);
  const [hoverSlot, setHoverSlot] = createSignal<number | null>(null);
  const [ghost, setGhost] = createSignal<{ x: number; y: number; unit: PvpUnitDto } | null>(null);
  /** Slot đang mở hộp chi tiết tướng (bấm vào ảnh đại diện) — null là không mở. */
  const [detailSlot, setDetailSlot] = createSignal<number | null>(null);
  const detailUnit = () => {
    const s = detailSlot();
    return s === null ? null : (bySlot().get(s) ?? null);
  };
  // Sau khi thả tướng, sự kiện click phát sinh ngay sau đó bị nuốt để không mở luôn bảng chọn tướng.
  let suppressClick = false;
  let stopDrag: (() => void) | null = null;
  onCleanup(() => stopDrag?.());

  /** Ô tướng đang nằm dưới con trỏ khi kéo thả (ảnh kéo có pointer-events: none nên không che). */
  const slotAt = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('.pvp-cell') as HTMLElement | null;
    const s = el?.dataset.slot;
    return s ? Number(s) : null;
  };

  /** Bắt đầu theo dõi con trỏ: đi quá ~6px mới tính là kéo (dưới ngưỡng là bấm mở bảng chọn tướng). */
  function beginDrag(e: PointerEvent, slot: number) {
    if (!props.onMove) return;
    const unit = bySlot().get(slot);
    if (!unit) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    const onMove = (ev: PointerEvent) => {
      if (!started && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      started = true;
      setDragFrom(slot);
      setGhost({ x: ev.clientX, y: ev.clientY, unit });
      setHoverSlot(slotAt(ev.clientX, ev.clientY));
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      stopDrag = null;
      const to = cancelled || !started ? null : slotAt(ev.clientX, ev.clientY);
      if (started) {
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 0);
        if (to && to !== slot) props.onMove?.(slot, to);
      }
      setDragFrom(null);
      setHoverSlot(null);
      setGhost(null);
    };
    const onUp = (ev: PointerEvent) => finish(ev, false);
    const onCancel = (ev: PointerEvent) => finish(ev, true);
    stopDrag = () => finish({ clientX: 0, clientY: 0 } as PointerEvent, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  const clickSlot = (s: number) => {
    if (!suppressClick) props.onSlot?.(s);
  };

  const col = (slots: number[], title: string) => (
    <div class="pvp-col">
      <div class="pvp-col-title">{title}</div>
      <For each={slots}>
        {(s) => (
          <UnitCell
            slot={s}
            unit={bySlot().get(s)}
            stat={unitStat(s)}
            onClick={props.onSlot ? clickSlot : undefined}
            onDetail={props.combat ? () => !suppressClick && setDetailSlot(s) : undefined}
            onDragStart={props.onMove ? beginDrag : undefined}
            dragging={dragFrom() === s}
            dropTarget={dragFrom() !== null && hoverSlot() === s}
          />
        )}
      </For>
    </div>
  );
  // Chi tiết chiến đấu của tướng ở slot — tra theo (tướng, cấp, đội); chưa tải xong thì undefined (hiện "…").
  const unitCombat = (slot: number) => {
    const u = bySlot().get(slot);
    return u ? props.combat?.[statKey(u, props.units)] : undefined;
  };
  const unitStat = (slot: number): UnitStat | undefined => {
    const c = unitCombat(slot);
    return c ? statOf(c) : undefined;
  };
  return (
    <>
      <div class="pvp-board" classList={{ foe: props.foe, dragging: dragFrom() !== null }}>
        {props.foe ? [col(FRONT, 'Hàng trước'), col(BACK, 'Hàng sau')] : [col(BACK, 'Hàng sau'), col(FRONT, 'Hàng trước')]}
      </div>
      <Show when={ghost()}>
        {(g) => (
          <span class="pvp-drag-ghost" style={{ left: `${g().x}px`, top: `${g().y}px` }}>
            <img src={portraitUrl(gen(g().unit.generalId).artKey)} alt="" />
            <b>{gen(g().unit.generalId).name}</b>
          </span>
        )}
      </Show>
      {/* Chi tiết tướng khi bấm ảnh đại diện trên bàn đội hình — dùng chung modal với Bộ sưu tập
          nhưng không có thẻ lớn (chỉ bảng chi tiết), đầy đủ cả kỹ năng. */}
      <Show when={detailUnit()}>
        {(u) => (
          <CombatDetailModal
            name={gen(u().generalId).name}
            level={u().level}
            combat={unitCombat(u().slot)}
            art={artThumb(gen(u().generalId).name, gen(u().generalId).artKey)}
            above
            onClose={() => setDetailSlot(null)}
          />
        )}
      </Show>
    </>
  );
}

/** Chọn tướng cho một vị trí từ thẻ đang sở hữu (gộp theo tướng, chọn từng cấp). */
interface GenOpt {
  id: string;
  name: string;
  faction: Faction;
  artKey: string;
  style: PvpStyle;
  /** Cấp cao nhất đang sở hữu — dùng để xếp đội (mỗi tướng chỉ cần một lựa chọn). */
  best: number;
  /** Lực chiến (LC) của tướng ở cấp cao nhất — dùng sắp thứ tự gợi ý. */
  lc: number;
}

function Picker(props: {
  slot: number;
  options: GenOpt[];
  /** Tướng đang có trong đội hình: generalId → vị trí (mục 6.7). */
  taken: Record<string, number>;
  /** Chi tiết chiến đấu của tướng ĐANG SỞ HỮU (cấp cao nhất) — hiện chỉ số ở mỗi dòng và mở chi tiết khi bấm ảnh. */
  combat: Record<string, PvpCombatDto>;
  onPick: (generalId: string, level: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = createSignal('');
  /** Bộ lọc nhanh: theo phe và theo phong cách chiến đấu (mục 6.7). Chọn được NHIỀU phe / nhiều lối đánh. */
  const [fac, setFac] = createSignal<Faction[]>([]);
  const [st, setSt] = createSignal<PvpStyle[]>([]);
  /** Bật/tắt một mục trong bộ lọc nhiều lựa chọn (rỗng = không lọc). */
  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const inFac = (f: Faction) => !fac().length || fac().includes(f);
  const inSt = (s: PvpStyle) => !st().length || st().includes(s);
  // Số trên nhãn lọc là số GIAO của hai bộ lọc (đang lọc phe nào thì chỉ đếm tướng phe đó, và ngược lại).
  const countFac = (f: Faction) => props.options.filter((o) => o.faction === f && inSt(o.style)).length;
  const countSt = (s: PvpStyle) => props.options.filter((o) => o.style === s && inFac(o.faction)).length;
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const filtered = createMemo(() => {
    const fq = fold(q().trim());
    return props.options.filter((o) => (!fq || fold(o.name).includes(fq)) && inFac(o.faction) && inSt(o.style));
  });
  /** Tướng đang mở xem chi tiết (bấm vào ảnh đại diện) — null là không mở. */
  const [detailId, setDetailId] = createSignal<string | null>(null);
  const detailOpt = () => props.options.find((o) => o.id === detailId());
  // Esc: chi tiết tướng (nếu đang mở) tự đóng trước — modal đó tự xử lý; ở đây chỉ đóng bảng chọn khi không có chi tiết.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || detailId()) return;
    props.onClose();
  };
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));
  return (
    <div class="pvp-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel pvp-picker">
        <div class="pvp-picker-head">
          <h3>{`Chọn tướng cho vị trí ${props.slot} (${SLOT_LABEL[props.slot]})`}</h3>
          <button class="btn ghost small" onClick={() => props.onClose()}>
            Đóng
          </button>
        </div>
        <div class="pvp-picker-tools">
          <input type="search" placeholder="Tìm tướng…" aria-label="Tìm tướng" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <button class="btn ghost small" onClick={() => props.onClear()}>
            Bỏ trống vị trí
          </button>
        </div>
        {/* Lọc theo phe và theo phong cách chiến đấu — chọn được nhiều mục, số trên nhãn là số giao của hai bộ lọc */}
        <div class="pvp-filters">
          <div class="pvp-filter-row">
            <button
              class="pvp-chip"
              classList={{ on: !fac().length }}
              title="Bỏ lọc phe"
              onClick={() => setFac([])}
            >
              {`Tất cả phe (${props.options.filter((o) => inSt(o.style)).length})`}
            </button>
            <For each={FACTIONS}>
              {(f) => (
                <button
                  class="pvp-chip"
                  classList={{ on: fac().includes(f) }}
                  style={{ '--chip': FACTION_STYLE[f].css }}
                  onClick={() => setFac(toggle(fac(), f))}
                >
                  {`${FACTION_LABELS[f]} (${countFac(f)})`}
                </button>
              )}
            </For>
          </div>
          <div class="pvp-filter-row">
            <button
              class="pvp-chip"
              classList={{ on: !st().length }}
              title="Bỏ lọc lối đánh"
              onClick={() => setSt([])}
            >
              {`Mọi lối đánh (${props.options.filter((o) => inFac(o.faction)).length})`}
            </button>
            <For each={PVP_STYLES}>
              {(s) => (
                <button class={`pvp-chip ${s}`} classList={{ on: st().includes(s) }} onClick={() => setSt(toggle(st(), s))}>
                  {`${PVP_STYLE_LABELS[s]} (${countSt(s)})`}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class="pvp-picker-list">
          <Show when={props.options.length} fallback={<div class="state-msg">Bạn chưa có tướng nào. Hãy quay thẻ trước.</div>}>
            <Show when={filtered().length} fallback={<div class="state-msg">Không tìm thấy tướng phù hợp.</div>}>
              <For each={filtered()}>
                {(o) => {
                  const c = () => props.combat[o.id];
                  // Bấm BẤT KỲ chỗ nào trên dòng để đưa tướng vào vị trí (không phải bấm đúng chip cấp).
                  return (
                    <button
                      type="button"
                      class="pvp-pick-row"
                      classList={{ taken: props.taken[o.id] !== undefined }}
                      title={`Đưa ${o.name} (Lv.${o.best}) vào vị trí ${props.slot}`}
                      onClick={() => props.onPick(o.id, o.best)}
                    >
                      <span class="pvp-pick-id">
                        <span
                          class="pvp-pick-art"
                          role="button"
                          tabIndex={0}
                          title={`Xem chi tiết ${o.name}`}
                          style={{ 'border-color': FACTION_STYLE[o.faction].css }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDetailId(o.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            e.stopPropagation();
                            setDetailId(o.id);
                          }}
                        >
                          <span class="pvp-ini">{initials(o.name)}</span>
                          <img
                            src={portraitUrl(o.artKey)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            onError={(e) => (e.currentTarget.style.display = 'none')}
                          />
                        </span>
                        <span class="lv-chip" style={{ 'border-color': levelTier(o.best).css, color: levelTier(o.best).css }}>
                          {`Lv.${o.best}`}
                        </span>
                      </span>
                      <span class="pvp-pick-meta">
                        <span class="pvp-pick-name">{o.name}</span>
                        <span class="pvp-pick-tags">
                          <span class="pvp-pick-faction" style={{ color: FACTION_STYLE[o.faction].css }}>
                            {FACTION_LABELS[o.faction]}
                          </span>
                          <span class={`pvp-pick-style ${o.style}`} title={PVP_STYLE_LABELS[o.style]}>
                            <StyleIcon style={o.style} size={11} />
                          </span>
                          <Show when={c()}>
                            {(x) => (
                              <>
                                {/* Lực chiến (LC) — cùng chuỗi định danh với cấp · phe · phong cách ở trên */}
                                <span class="pvp-pick-lc" title="Lực chiến">{`LC ${num(x().self.lc)}`}</span>
                                <span class="pvp-pick-stat-num">
                                  <StatIcon id="attack" size={11} /> {num(x().self.damage)} · <StatIcon id="heart" size={11} /> {num(x().self.maxHp)} ·{' '}
                                  <StatIcon id="armor" size={11} /> {pct(x().self.defBps)}
                                </span>
                                {/* Chính xác / Né tránh / ST chí mạng cũng scale theo cấp nên hiện luôn ở đây. */}
                                <span class="pvp-pick-stat-num">
                                  <StatIcon id="crit-rate" size={11} /> {pct(x().self.critBps)} · <StatIcon id="crit-dmg" size={11} />{' '}
                                  {pct(x().self.critDamageBps)} · <StatIcon id="eye" size={11} /> {pct(x().self.hitBps)} ·{' '}
                                  <StatIcon id="dodge" size={11} /> {pct(x().self.dodgeBps)}
                                </span>
                              </>
                            )}
                          </Show>
                        </span>
                      </span>
                      {/* Nhãn cho biết tướng đang nằm ở vị trí nào trong đội */}
                      <Show when={props.taken[o.id] !== undefined}>
                        <span class="pvp-pick-inteam">{`Đang ở vị trí ${props.taken[o.id]}`}</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </Show>
          </Show>
        </div>
      </div>
      {/* Chi tiết tướng (bấm vào ảnh đại diện mới mở) — dùng chung modal với Bộ sưu tập, đầy đủ
          kỹ năng + chỉ số, chỉ khác là không có thẻ lớn (thay bằng ảnh đại diện). */}
      <Show when={detailOpt()}>
        {(o) => (
          <CombatDetailModal
            name={o().name}
            level={o().best}
            combat={props.combat[o().id]}
            art={artThumb(o().name, o().artKey)}
            above
            onClose={() => setDetailId(null)}
          />
        )}
      </Show>
    </div>
  );
}

// ======================= Phát lại trận đấu =======================

interface CV {
  hp: number;
  /** Trần HP hiện tại = trần tĩnh + tổng HP cộng thêm từ buff − tổng HP bị giảm bởi debuff. */
  maxHp: number;
  /** Trần HP tĩnh khi vào trận (không đổi) — mốc để tính lại trần khi buff/debuff thêm/hết hạn. */
  maxHpStatic: number;
  alive: boolean;
  stunned: boolean;
  /** Ô của tướng ĐANG gây choáng (khớp engine): choáng kéo dài tới khi tướng đó ra đòn lượt kế. */
  stunnedByIdx: number | null;
  buffed: boolean;
  /** Hệ số nhân sát thương gây ra (bps): 10000 bình thường, giảm còn 5000 sau khi Hồi sinh (mục 1.14). */
  damageMulBps: number;
  /** Các lớp buff đang hiệu lực (khớp engine): sát thương/HP/chí mạng/ST chí mạng/giảm ST gánh chịu/hút máu + chỉ số trao đổi đòn + lượt hết hạn. */
  buffs: { sourceIdx: number; channel: number; flat: number; hpFlat: number; critBps: number; critDamageBps: number; takenDownBps: number; lifestealBps: number; hitBps: number; dodgeBps: number; defBps: number; defPenBps: number; expiresRound: number }[];
  /** Các lớp hiệu ứng bất lợi đang chịu (khớp engine): giảm sát thương/HP/chí mạng/ST chí mạng/chỉ số trao đổi đòn + thiêu đốt. */
  debuffs: { sourceIdx: number; damageFlat: number; hpFlat: number; critBps: number; critDamageBps: number; hitDownBps: number; dodgeDownBps: number; defDownBps: number; defPenDownBps: number; burnFlat: number; expiresRound: number }[];
  /** Các lớp Khiên đang hấp thụ sát thương (khớp engine): trừ dần khi bị đánh, tự tan theo lượt. */
  shields: { sourceIdx: number; channel: number; amount: number; expiresRound: number }[];
}

/** Trừ dần lượng khiên theo thứ tự lớp cũ nhất trước (khớp `absorbShield` của engine). */
const absorbShields = (shields: CV['shields'], amount: number): CV['shields'] => {
  let rest = amount;
  const out = shields.map((x) => ({ ...x }));
  while (rest > 0 && out.length) {
    const t = Math.min(out[0]!.amount, rest);
    out[0]!.amount -= t;
    rest -= t;
    if (out[0]!.amount <= 0) out.shift();
  }
  return out;
};

/** Trừ khiên theo lượng sát thương đã bị khiên hấp thụ (`absorbed`) — không có thì giữ nguyên danh sách. */
const absorbedOf = (s: CV, absorbed?: number): CV['shields'] => (absorbed && absorbed > 0 ? absorbShields(s.shields, absorbed) : s.shields);

/** Trần HP hiện tại = trần tĩnh − tổng HP bị giảm bởi debuff + tổng HP cộng thêm từ buff (khớp engine). */
const maxHpOf = (s: CV) =>
  Math.max(0, s.maxHpStatic - s.debuffs.reduce((sum, d) => sum + d.hpFlat, 0)) + s.buffs.reduce((sum, b) => sum + b.hpFlat, 0);

/** Tỉ lệ máu hồi thêm khi trần HP tăng (1/4) — khớp `PVP_MAXHP_GAIN_HEAL_BPS` của server. */
const MAXHP_GAIN_HEAL = 0.25;

/** Hệ số 100% (bps) — khớp `BPS_SCALE` của server (dùng cho hệ số nhân sát thương sau Hồi sinh). */
const BPS_SCALE = 10000;

/**
 * Đồng bộ máu theo trần HP mới (khớp `syncMaxHp` của engine): trần TĂNG thì chỉ hồi **1/4 lượng tăng**
 * (buff tăng trần HP không phải đòn hồi máu), trần GIẢM thì kẹp máu hiện tại xuống trần mới.
 */
const syncHp = (s: CV, patch?: Partial<CV>): CV => {
  const merged = patch ? { ...s, ...patch } : s;
  const maxHp = maxHpOf(merged);
  const delta = maxHp - s.maxHp;
  const hp = delta > 0 ? Math.min(maxHp, merged.hp + Math.round(delta * MAXHP_GAIN_HEAL)) : Math.min(merged.hp, maxHp);
  return { ...merged, maxHp, hp };
};

/**
 * Chip hiệu ứng hiển thị trên ô tướng: gộp các lớp theo TỪNG LOẠI chỉ số và ghi RÕ đang tăng/giảm
 * cái gì, bao nhiêu. Mỗi chip là MỘT icon hiệu ứng (bộ icon ở `icons.ts`) kèm giá trị cụ thể.
 * Thứ tự: buff trước, rồi tới debuff/thiêu đốt.
 */
function effectChips(s: CV): { icon?: IconId; text: string; tone: 'buff' | 'debuff' | 'burn' }[] {
  const sum = <T,>(arr: T[], pick: (x: T) => number) => arr.reduce((a, x) => a + pick(x), 0);
  const out: { icon?: IconId; text: string; tone: 'buff' | 'debuff' | 'burn' }[] = [];
  // Buff tăng sức mạnh (xanh): sát thương, HP tối đa, chí mạng, ST chí mạng, giảm ST gánh chịu
  const bDmg = sum(s.buffs, (b) => b.flat);
  const bHp = sum(s.buffs, (b) => b.hpFlat);
  const bCrit = sum(s.buffs, (b) => b.critBps);
  const bCritD = sum(s.buffs, (b) => b.critDamageBps);
  const bTaken = sum(s.buffs, (b) => b.takenDownBps);
  const bLifesteal = sum(s.buffs, (b) => b.lifestealBps);
  if (bDmg > 0) out.push({ icon: 'attack', text: `+${num(bDmg)}`, tone: 'buff' });
  if (bHp > 0) out.push({ icon: 'heart', text: `+${num(bHp)}`, tone: 'buff' });
  if (bCrit > 0) out.push({ icon: 'crit-rate', text: `+${bCrit / 100}`, tone: 'buff' });
  if (bCritD > 0) out.push({ icon: 'crit-dmg', text: `+${pct(bCritD)}`, tone: 'buff' });
  if (bTaken > 0) out.push({ icon: 'shield-reduce', text: `${pct(bTaken)}`, tone: 'buff' });
  if (bLifesteal > 0) out.push({ icon: 'blood', text: `+${pct(bLifesteal)}`, tone: 'buff' });
  // Chỉ số Trao đổi đòn (mục 18): Chính xác / Né tránh / Phòng thủ / Xuyên giáp cộng thêm.
  const bHit = sum(s.buffs, (b) => b.hitBps);
  const bDodge = sum(s.buffs, (b) => b.dodgeBps);
  const bDef = sum(s.buffs, (b) => b.defBps);
  const bDefPen = sum(s.buffs, (b) => b.defPenBps);
  if (bHit > 0) out.push({ icon: 'eye', text: `+${pct(bHit)}`, tone: 'buff' });
  if (bDodge > 0) out.push({ icon: 'dodge', text: `+${pct(bDodge)}`, tone: 'buff' });
  if (bDef > 0) out.push({ icon: 'armor', text: `+${pct(bDef)}`, tone: 'buff' });
  if (bDefPen > 0) out.push({ icon: 'bow-pen', text: `+${pct(bDefPen)}`, tone: 'buff' });
  // Khiên đang hấp thụ sát thương (mục 16) — hiện tổng lượng còn lại.
  const bShield = sum(s.shields, (x) => x.amount);
  if (bShield > 0) out.push({ icon: 'sphere-shield', text: `${num(bShield)}`, tone: 'buff' });
  // Hiệu ứng bất lợi (đỏ) + thiêu đốt (cam)
  const dDmg = sum(s.debuffs, (d) => d.damageFlat);
  const dHp = sum(s.debuffs, (d) => d.hpFlat);
  const dCrit = sum(s.debuffs, (d) => d.critBps);
  const dCritD = sum(s.debuffs, (d) => d.critDamageBps);
  const dBurn = s.debuffs.filter((d) => d.burnFlat > 0).length;
  if (dDmg > 0) out.push({ icon: 'attack', text: `−${num(dDmg)}`, tone: 'debuff' });
  if (dHp > 0) out.push({ icon: 'heart', text: `−${num(dHp)}`, tone: 'debuff' });
  if (dCrit > 0) out.push({ icon: 'crit-rate', text: `−${dCrit / 100}`, tone: 'debuff' });
  if (dCritD > 0) out.push({ icon: 'crit-dmg', text: `−${pct(dCritD)}`, tone: 'debuff' });
  const dHit = sum(s.debuffs, (d) => d.hitDownBps);
  const dDodge = sum(s.debuffs, (d) => d.dodgeDownBps);
  const dDef = sum(s.debuffs, (d) => d.defDownBps);
  const dDefPen = sum(s.debuffs, (d) => d.defPenDownBps);
  if (dHit > 0) out.push({ icon: 'eye-off', text: `−${pct(dHit)}`, tone: 'debuff' });
  if (dDodge > 0) out.push({ icon: 'dodge-off', text: `−${pct(dDodge)}`, tone: 'debuff' });
  if (dDef > 0) out.push({ icon: 'armor', text: `−${pct(dDef)}`, tone: 'debuff' });
  if (dDefPen > 0) out.push({ icon: 'bow-pen', text: `−${pct(dDefPen)}`, tone: 'debuff' });
  if (dBurn > 0) out.push({ icon: 'burn', text: `${dBurn}`, tone: 'burn' });
  return out;
}

const EVENT_MS: Record<PvpEventDto['t'], number> = {
  round: 300,
  act: 220,
  miss: 340,
  damage: 400,
  heal: 400,
  counter: 400,
  stun: 320,
  cleanse: 320,
  buff: 280,
  debuff: 320,
  burn: 380,
  shield: 320,
  shieldBreak: 320,
  dispel: 320,
  purify: 320,
  revive: 700,
  skip: 480,
  down: 380,
  end: 500,
};

/** Tổng hợp chỉ số của một tướng sau trận. */
interface Tally {
  dealt: number;
  taken: number;
  healedAllies: number;
  healedSelf: number;
  /** Tổng lượng Khiên tướng này đã TẠO ra cho bản thân lẫn đồng đội (mục 16). */
  shielded: number;
  kills: number;
  stuns: number;
  /** Số lần GIẢI CHOÁNG (& thiêu đốt) thành công cho đồng minh. */
  cleanses: number;
  /** Số lần THANH TẨY hiệu ứng bất lợi cho đồng minh (không gỡ choáng/thiêu đốt). */
  purifies: number;
  buffs: number;
}
const newTally = (): Tally => ({ dealt: 0, taken: 0, healedAllies: 0, healedSelf: 0, shielded: 0, kills: 0, stuns: 0, cleanses: 0, purifies: 0, buffs: 0 });

/** Một dòng diễn biến chi tiết (kèm avatar người thi triển / mục tiêu). */
interface DetailRow {
  id: number;
  kind:
    | 'round'
    | 'act'
    | 'skip'
    | 'miss'
    | 'damage'
    | 'counter'
    | 'heal'
    | 'stun'
    | 'cleanse'
    | 'buff'
    | 'debuff'
    | 'burn'
    | 'shield'
    | 'shieldBreak'
    | 'dispel'
    | 'purify'
    | 'revive'
    | 'down';
  actor?: number;
  target?: number;
  text: string;
  amount?: number;
  crit?: boolean;
}

/**
 * Bộ dựng "diễn biến chi tiết". Dùng chung cho cả hai chỗ: phân tích trọn trận sau khi đánh xong
 * và hiện dần từng dòng trong lúc đang đánh (cùng logic nên nội dung luôn khớp nhau).
 */
function createDetailBuilder(units: PvpUnitStateDto[]) {
  const unitByIdx = new Map(units.map((u) => [u.idx, u]));
  const nameOf = (idx: number) => {
    const u = unitByIdx.get(idx);
    return u ? gen(u.generalId).name : `#${idx}`;
  };
  const tallies = new Map<number, Tally>(units.map((u) => [u.idx, newTally()]));
  const at = (idx: number) => tallies.get(idx)!;
  const rows: DetailRow[] = [];
  let actor: number | undefined;
  let id = 0;
  const push = (row: Omit<DetailRow, 'id'>) => {
    const full: DetailRow = { ...row, id: ++id };
    rows.push(full);
    return full;
  };

  function add(ev: PvpEventDto): DetailRow | null {
    switch (ev.t) {
      case 'round':
        return push({ kind: 'round', text: `Lượt ${ev.round}` });
      case 'act': {
        actor = ev.idx;
        // Kỹ năng buff tăng sức mạnh (nhóm TEAM_/BUFF_ALLIES) và/hoặc hiệu ứng bất lợi (phe Ngụy):
        // hiện kèm LƯỢNG tăng/giảm mỗi lớp.
        const u = unitByIdx.get(ev.idx);
        const extra = [teamBuffText(u?.buffs), debuffText(u?.debuff)].filter(Boolean).join(' · ');
        const sk = u?.skillName ?? PVP_SKILL_LABELS[ev.skill];
        return push({ kind: 'act', actor: ev.idx, text: `${nameOf(ev.idx)} dùng ${sk}${extra ? ` (${extra})` : ''}` });
      }
      case 'skip':
        actor = ev.idx;
        return push({ kind: 'skip', actor: ev.idx, text: `${nameOf(ev.idx)} bị choáng — bỏ lượt` });
      case 'miss':
        // Né đòn (mục 18 — BƯỚC 1): 0 sát thương, giữ nguyên Khiên & Máu.
        return push({ kind: 'miss', actor: ev.from, target: ev.idx, text: `${nameOf(ev.idx)} né đòn của ${nameOf(ev.from)} — trượt` });
      case 'damage': {
        at(ev.from).dealt += ev.amount;
        at(ev.idx).taken += ev.amount;
        if (ev.hp === 0) at(ev.from).kills += 1;
        // Khiên hấp thụ bớt `absorbed` (mục 16) — ghi rõ phần đã bị chặn cho người xem.
        const blocked = ev.absorbed ?? 0;
        // Phòng thủ cản bớt `mitigated` (mục 18 — BƯỚC 2).
        const cut = ev.mitigated ?? 0;
        const notes = [cut > 0 ? `giáp chặn ${num(cut)}` : '', blocked > 0 ? `khiên chặn ${num(blocked)}` : ''].filter(Boolean).join(' · ');
        return push({ kind: 'damage', actor: ev.from, target: ev.idx, amount: ev.amount, crit: ev.crit, text: `${nameOf(ev.from)} đánh ${nameOf(ev.idx)}${notes ? ` · ${notes}` : ''}` });
      }
      case 'counter': {
        // Phản kích: `from` đánh trả `idx` (kẻ vừa gây sát thương chủ động cho `from`).
        at(ev.from).dealt += ev.amount;
        at(ev.idx).taken += ev.amount;
        if (ev.hp === 0) at(ev.from).kills += 1;
        const blocked = ev.absorbed ?? 0;
        const cut = ev.mitigated ?? 0;
        const notes = [cut > 0 ? `giáp chặn ${num(cut)}` : '', blocked > 0 ? `khiên chặn ${num(blocked)}` : ''].filter(Boolean).join(' · ');
        return push({ kind: 'counter', actor: ev.from, target: ev.idx, amount: ev.amount, crit: ev.crit, text: `${nameOf(ev.from)} phản kích ${nameOf(ev.idx)}${notes ? ` · ${notes}` : ''}` });
      }
      case 'heal': {
        if (ev.from === ev.idx) at(ev.idx).healedSelf += ev.amount;
        else at(ev.from).healedAllies += ev.amount;
        return push({
          kind: 'heal',
          actor: ev.from,
          target: ev.idx,
          amount: ev.amount,
          crit: ev.crit,
          text: ev.from === ev.idx ? `${nameOf(ev.idx)} tự hồi máu` : `${nameOf(ev.from)} hồi máu cho ${nameOf(ev.idx)}`,
        });
      }
      case 'stun':
        if (actor !== undefined) at(actor).stuns += 1;
        return push({ kind: 'stun', actor, target: ev.idx, text: `${actor !== undefined ? nameOf(actor) : 'Kẻ địch'} làm choáng ${nameOf(ev.idx)}` });
      case 'cleanse':
        if (actor !== undefined) at(actor).cleanses += 1;
        return push({ kind: 'cleanse', actor, target: ev.idx, text: `${actor !== undefined ? nameOf(actor) : 'Đồng minh'} giải choáng cho ${nameOf(ev.idx)}` });
      case 'buff': {
        if (actor !== undefined) at(actor).buffs += 1;
        const gains = [
          ev.damageFlat > 0 ? `+${num(ev.damageFlat)} sát thương` : '',
          ev.hpFlat > 0 ? `+${num(ev.hpFlat)} HP tối đa` : '',
          ev.critBps > 0 ? `+${ev.critBps / 100} điểm chí mạng` : '',
          ev.critDamageBps > 0 ? `+${pct(ev.critDamageBps)} ST chí mạng` : '',
          ev.takenDownBps > 0 ? `−${pct(ev.takenDownBps)} sát thương gánh chịu` : '',
          ev.lifestealBps > 0 ? `+${pct(ev.lifestealBps)} hút máu` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return push({
          kind: 'buff',
          actor,
          target: ev.idx,
          crit: ev.crit,
          text: `${actor !== undefined ? nameOf(actor) : 'Đồng minh'} tăng sức mạnh cho ${nameOf(ev.idx)} (${gains}${ev.crit ? ' · CHÍ MẠNG' : ''})`,
        });
      }
      case 'debuff': {
        // Hiệu ứng bất lợi: actor là tướng vừa thi triển (đặt ở sự kiện 'act' trước đó).
        const parts = [
          ev.damageFlat > 0 ? `−${num(ev.damageFlat)} sát thương` : '',
          ev.hpFlat > 0 ? `−${num(ev.hpFlat)} HP tối đa` : '',
          ev.critBps > 0 ? `−${ev.critBps / 100} điểm chí mạng` : '',
          ev.critDamageBps > 0 ? `−${pct(ev.critDamageBps)} ST chí mạng` : '',
          ev.burnFlat > 0 ? `thiêu đốt ${num(ev.burnFlat)}/lượt` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        return push({
          kind: 'debuff',
          actor,
          target: ev.idx,
          text: `${actor !== undefined ? nameOf(actor) : 'Kẻ địch'} áp hiệu ứng bất lợi lên ${nameOf(ev.idx)} (${parts})`,
        });
      }
      case 'burn':
        // Thiêu đốt gây sát thương vào đầu mỗi lượt — tính vào lượng sát thương mục tiêu phải chịu.
        at(ev.idx).taken += ev.amount;
        return push({ kind: 'burn', target: ev.idx, amount: ev.amount, crit: ev.crit, text: `${nameOf(ev.idx)} bị thiêu đốt${ev.crit ? ' · CHÍ MẠNG' : ''}` });
      case 'shield':
        // Tạo khiên: hấp thụ sát thương nhận vào trước HP, tự tan sau vài lượt (số lượng đã ghi trong câu).
        // Tính vào cột "Khiên" của người TẠO khiên (kể cả khi tạo cho đồng đội).
        if (ev.from !== undefined) at(ev.from).shielded += ev.amount;
        return push({ kind: 'shield', actor: ev.from, target: ev.idx, text: `${nameOf(ev.from)} tạo khiên ${num(ev.amount)} cho ${nameOf(ev.idx)}` });
      case 'shieldBreak':
        return push({ kind: 'shieldBreak', actor: ev.from, target: ev.idx, text: `${nameOf(ev.from)} phá khiên của ${nameOf(ev.idx)}` });
      case 'dispel':
        return push({ kind: 'dispel', actor, target: ev.idx, text: `${actor !== undefined ? nameOf(actor) : 'Kẻ địch'} xóa hiệu ứng có lợi của ${nameOf(ev.idx)}` });
      case 'purify':
        if (actor !== undefined) at(actor).purifies += 1;
        return push({ kind: 'purify', actor, target: ev.idx, text: `${actor !== undefined ? nameOf(actor) : 'Đồng minh'} thanh tẩy hiệu ứng bất lợi cho ${nameOf(ev.idx)}` });
      case 'revive':
        // Hồi sinh: tướng gục lần đầu nhưng sống lại (chỉ 1 lần/trận), đổi lại bị giảm sát thương vĩnh viễn.
        return push({
          kind: 'revive',
          target: ev.idx,
          amount: ev.hp,
          text: `${nameOf(ev.idx)} HỒI SINH với ${num(ev.hp)} máu nhưng giảm ${pct(ev.damageDownBps)} sát thương tới hết trận`,
        });
      case 'down':
        return push({ kind: 'down', target: ev.idx, text: `${nameOf(ev.idx)} bị hạ` });
      case 'end':
        return null;
    }
  }
  return { rows, tallies, add };
}

/**
 * Phân tích trọn bộ sự kiện một lần: danh sách diễn biến chi tiết + tổng hợp chỉ số từng tướng.
 * Tất định theo dữ liệu server trả về (không phụ thuộc tốc độ phát lại).
 */
function analyzeBattle(units: PvpUnitStateDto[], events: PvpEventDto[]): { detail: DetailRow[]; tallies: Map<number, Tally> } {
  const b = createDetailBuilder(units);
  for (const ev of events) b.add(ev);
  return { detail: b.rows, tallies: b.tallies };
}

/** Avatar nhỏ trong dòng diễn biến (viền đỏ khi là tướng địch). */
function MiniArt(props: { unit?: PvpUnitStateDto; mine: boolean }) {
  return (
    <span class="rp-mini" classList={{ foe: !props.mine }}>
      <span class="rp-mini-ini">{props.unit ? initials(gen(props.unit.generalId).name) : '?'}</span>
      <Show when={props.unit}>
        {(x) => (
          <img src={portraitUrl(gen(x().generalId).artKey)} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />
        )}
      </Show>
    </span>
  );
}

/**
 * Danh sách diễn biến chi tiết — dùng chung cho lúc ĐANG ĐÁNH và bảng kết quả sau trận.
 * Mỗi dòng có nhãn "Ta"/"Địch" để biết hành động của bên nào.
 */
function DetailList(props: { rows: DetailRow[]; units: PvpUnitStateDto[]; mySide: PvpSide; /** Tự cuộn xuống dòng mới nhất (chế độ đang đánh). */ follow?: boolean }) {
  const byIdx = createMemo(() => new Map(props.units.map((u) => [u.idx, u])));
  const unitOf = (idx?: number) => (idx === undefined ? undefined : byIdx().get(idx));
  const isMine = (idx: number) => byIdx().get(idx)?.side === props.mySide;
  let box!: HTMLDivElement;
  createEffect(() => {
    if (props.follow && box && props.rows.length) box.scrollTop = box.scrollHeight;
  });
  return (
    <div class="rp-drows" classList={{ scroll: !!props.follow }} ref={box}>
      <For each={props.rows}>
        {(d) => (
          <div class={`rp-drow ${d.kind}`}>
            <Show
              when={d.kind === 'round'}
              fallback={
                <>
                  <Show when={d.actor !== undefined}>
                    <MiniArt unit={unitOf(d.actor)} mine={isMine(d.actor!)} />
                    <span class="rp-drow-side" classList={{ foe: !isMine(d.actor!) }}>
                      {isMine(d.actor!) ? 'Ta' : 'Địch'}
                    </span>
                  </Show>
                  <span class="rp-drow-text">{d.text}</span>
                  <Show when={d.target !== undefined && d.target !== d.actor}>
                    <span class="rp-drow-arrow">→</span>
                    <MiniArt unit={unitOf(d.target)} mine={isMine(d.target!)} />
                  </Show>
                  <Show when={d.amount !== undefined}>
                    <span class="rp-drow-amt" classList={{ heal: d.kind === 'heal', crit: d.crit }}>
                      {d.kind === 'heal' ? `+${num(d.amount!)}` : `-${num(d.amount!)}`}
                      <Show when={d.crit}>
                        <span class="rp-drow-crit">CHÍ MẠNG</span>
                      </Show>
                    </span>
                  </Show>
                </>
              }
            >
              <span class="rp-dround">{d.text}</span>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

/** Bảng kết quả trận đấu: diễn biến chi tiết (có avatar) + tổng kết chỉ số từng tướng. */
function BattleReport(props: { units: PvpUnitStateDto[]; mySide: PvpSide; analysis: { detail: DetailRow[]; tallies: Map<number, Tally> } }) {
  const [tab, setTab] = createSignal<'summary' | 'detail'>('summary');
  const unitByIdx = createMemo(() => new Map(props.units.map((u) => [u.idx, u])));
  const ordered = createMemo(() => props.units.slice().sort((a, b) => a.idx - b.idx));
  const nameOf = (idx: number) => {
    const u = unitByIdx().get(idx);
    return u ? gen(u.generalId).name : `#${idx}`;
  };
  /** Phe của tướng ở ô `idx` (null nếu ô không có tướng). */
  const factionOf = (idx: number): Faction | null => {
    const u = unitByIdx().get(idx);
    return u ? gen(u.generalId).faction : null;
  };
  /** Tướng ở ô `idx` (null nếu ô trống) — dùng cho chip cấp độ và phong cách trong bảng tổng kết. */
  const unitAt = (idx: number) => unitByIdx().get(idx) ?? null;
  const artOf = (idx: number) => {
    const u = unitByIdx().get(idx);
    return <MiniArt unit={u} mine={u?.side === props.mySide} />;
  };
  const row = (t: Tally, idx: number) => (
    <tr>
      <td class="rp-t-name">
        {artOf(idx)}
        <span>{nameOf(idx)}</span>
        {/* Chip theo thứ tự cấp độ → phe → phong cách, khớp ô tướng ở đội hình */}
        <span class="rp-t-tags">
          <Show when={unitAt(idx)}>
            {(u) => (
              <span class="rp-t-lv" style={{ 'border-color': levelTier(u().level).css, color: levelTier(u().level).css }}>{`Lv.${u().level}`}</span>
            )}
          </Show>
          <Show when={factionOf(idx)}>
            {(f) => (
              <span class="rp-t-faction" style={{ color: FACTION_STYLE[f()].css }} title={FACTION_LABELS[f()]}>
                {FACTION_LABELS[f()]}
              </span>
            )}
          </Show>
          <Show when={unitAt(idx)}>
            {(u) => (
              <span class="rp-t-style" style={{ color: STYLE_COLOR[u().style] }} title={PVP_STYLE_LABELS[u().style]}>
                <StyleIcon style={u().style} size={11} />
              </span>
            )}
          </Show>
          {/* Lực chiến (LC) — chip cuối trong chuỗi định danh: cấp → phe → phong cách → LC */}
          <Show when={unitAt(idx)}>
            {(u) => <span class="rp-t-lc" title="Lực chiến">{`LC ${num(u().lc)}`}</span>}
          </Show>
        </span>
      </td>
      <td class="rp-t-num dmg">{num(t.dealt)}</td>
      <td class="rp-t-num taken">{num(t.taken)}</td>
      <td class="rp-t-num heal">{num(t.healedAllies + t.healedSelf)}</td>
      <td class="rp-t-num shield">{num(t.shielded)}</td>
      <td class="rp-t-num">{t.kills || '—'}</td>
      <td class="rp-t-num">{t.stuns || '—'}</td>
      <td class="rp-t-num">{t.cleanses || '—'}</td>
      <td class="rp-t-num">{t.purifies || '—'}</td>
      <td class="rp-t-num">{t.buffs || '—'}</td>
    </tr>
  );

  return (
    <div class="rp-report">
      <div class="rp-report-tabs">
        <button class="btn ghost small" classList={{ on: tab() === 'summary' }} onClick={() => setTab('summary')}>
          Tổng kết chỉ số
        </button>
        <button class="btn ghost small" classList={{ on: tab() === 'detail' }} onClick={() => setTab('detail')}>
          Diễn biến chi tiết
        </button>
      </div>

      <Show when={tab() === 'summary'} fallback={<div class="rp-report-body">
        <DetailList rows={props.analysis.detail} units={props.units} mySide={props.mySide} />
      </div>}>
        <div class="rp-report-body">
          <table class="rp-table">
            <thead>
              <tr>
                <th>Tướng</th>
                <th>Sát thương</th>
                <th>Đã chịu</th>
                <th>Hồi máu</th>
                <th>Khiên</th>
                <th>Hạ</th>
                <th>Choáng</th>
                <th>Giải choáng</th>
                <th>Thanh tẩy</th>
                <th>Buff</th>
              </tr>
            </thead>
            <tbody>
              <For each={ordered().filter((u) => u.side === props.mySide)}>{(u) => row(props.analysis.tallies.get(u.idx)!, u.idx)}</For>
              <tr class="rp-t-sep">
                <td colSpan={10}>Đối thủ</td>
              </tr>
              <For each={ordered().filter((u) => u.side !== props.mySide)}>{(u) => row(props.analysis.tallies.get(u.idx)!, u.idx)}</For>
            </tbody>
          </table>
          <p class="muted small">Sát thương = tổng ST tướng này gây ra. Đã chịu = tổng ST nhận vào. Hồi máu = máu hồi cho bản thân + đồng đội. Khiên = tổng lượng khiên tạo ra. Giải choáng = gỡ choáng &amp; thiêu đốt. Thanh tẩy = gỡ hiệu ứng bất lợi (không gỡ choáng/thiêu đốt).</p>
        </div>
      </Show>
    </div>
  );
}

function BattleReplay(props: { battle: PvpBattleDto; onClose: () => void; onRematch?: (opponentId: number) => void }) {
  const units = props.battle.units;
  const byIdx = new Map(units.map((u) => [u.idx, u]));
  const nameOf = (idx: number) => {
    const u = byIdx.get(idx);
    return u ? gen(u.generalId).name : `#${idx}`;
  };
  /** Tên chiêu đang thi triển của tướng ở ô idx (ưu tiên tên thật trong snapshot). */
  const skillNameAt = (idx: number, fallback: PvpSkill) => byIdx.get(idx)?.skillName ?? PVP_SKILL_LABELS[fallback];
  const initView = () => {
    const o: Record<number, CV> = {};
    // Máu đầu trận lấy từ snapshot server (vào trận luôn đầy 100% theo trần đã gồm aura phong cách).
    for (const u of units) o[u.idx] = { hp: u.hp, maxHp: u.maxHp, maxHpStatic: u.maxHp, alive: true, stunned: false, stunnedByIdx: null, buffed: false, damageMulBps: BPS_SCALE, buffs: [], debuffs: [], shields: [] };
    return o;
  };

  const [view, setView] = createSignal<Record<number, CV>>(initView());
  const [cursor, setCursor] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(2);
  const [round, setRound] = createSignal(0);
  const [acting, setActing] = createSignal<number | null>(null);
  const [actingSkill, setActingSkill] = createSignal<PvpSkill | null>(null);
  const [targets, setTargets] = createSignal<number[]>([]);
  /** Diễn biến chi tiết hiện dần trong lúc đang đánh (cùng nội dung với bảng kết quả). */
  const [detail, setDetail] = createSignal<DetailRow[]>([]);
  const [done, setDone] = createSignal(false);
  /** Đang xem bảng kết quả trận (bấm "Kết quả" hoặc trận kết thúc tự động). */
  const [report, setReport] = createSignal(false);
  /** Phân tích trọn trận (diễn biến chi tiết + tổng kết chỉ số) — chỉ hiện ở mục kết quả. */
  const analysis = createMemo(() => analyzeBattle(units, props.battle.events));
  let builder = createDetailBuilder(units);
  let timer: number | undefined;
  /** Đang tua nhanh tới cuối trận: bỏ qua cập nhật sân đấu/diễn biến theo từng sự kiện (gộp một lần ở cuối). */
  let fastForward = false;
  /** Ô chứa canvas sân đấu PixiJS (chỉ hiển thị lại dữ liệu server đã mô phỏng). */
  let field!: HTMLDivElement;
  let arena: ArenaHandle | undefined;

  const upd = (idx: number, fn: (s: CV) => CV) =>
    setView((v) => {
      const s = v[idx];
      if (!s) return v;
      return { ...v, [idx]: fn(s) };
    });

  /** Đẩy trạng thái tức thời của cả sân sang canvas (số liệu chỉ để hiển thị, không tính toán tại client). */
  function pushArena() {
    if (!arena) return;
    const cur = view();
    const snap: Record<number, ArenaView> = {};
    for (const u of units) {
      const s = cur[u.idx];
      if (!s) continue;
      snap[u.idx] = {
        hp: s.hp,
        maxHp: s.maxHp,
        // Trần HP cơ bản khi vào trận = chỉ số đã cộng hết buff nền (cùng phe, hàng trước/sau, phong cách).
        maxHpBase: u.maxHp,
        alive: s.alive,
        stunned: s.stunned,
        buffed: s.buffed,
        // Sát thương hiện tại = sát thương nền + lớp buff đang hiệu lực − lớp debuff giảm sát thương,
        // nhân hệ số Hồi sinh (giảm 50% vĩnh viễn sau khi sống lại — mục 1.14)
        damage: Math.round(
          Math.max(0, u.damage + s.buffs.reduce((acc, b) => acc + b.flat, 0) - s.debuffs.reduce((acc, d) => acc + d.damageFlat, 0)) *
            (s.damageMulBps / BPS_SCALE),
        ),
        // Phòng thủ hiện tại = phòng thủ nền + lớp buff − lớp debuff giảm phòng thủ (khớp engine)
        defBps: Math.max(0, u.defBps + s.buffs.reduce((acc, b) => acc + b.defBps, 0) - s.debuffs.reduce((acc, d) => acc + d.defDownBps, 0)),
        // Chí mạng / ST chí mạng hiện tại = chỉ số nền + lớp buff − lớp debuff (khớp engine)
        critBps: Math.max(0, u.critBps + s.buffs.reduce((acc, b) => acc + b.critBps, 0) - s.debuffs.reduce((acc, d) => acc + d.critBps, 0)),
        critDamageBps: Math.max(
          0,
          u.critDamageBps + s.buffs.reduce((acc, b) => acc + b.critDamageBps, 0) - s.debuffs.reduce((acc, d) => acc + d.critDamageBps, 0),
        ),
        // Chính xác / Né tránh hiện tại = chỉ số nền (theo cấp) + lớp buff − lớp debuff (khớp engine)
        hitBps: Math.max(0, u.hitBps + s.buffs.reduce((acc, b) => acc + b.hitBps, 0) - s.debuffs.reduce((acc, d) => acc + d.hitDownBps, 0)),
        dodgeBps: Math.max(0, u.dodgeBps + s.buffs.reduce((acc, b) => acc + b.dodgeBps, 0) - s.debuffs.reduce((acc, d) => acc + d.dodgeDownBps, 0)),
        // Chỉ số CƠ BẢN (đã cộng hết buff nền: cùng phe, hàng trước/sau, phong cách — nhưng chưa
        // tính lớp buff/debuff trong trận) theo đúng thứ tự icon trên ô, để arena tô màu từng chỉ số.
        statBases: [u.damage, u.defBps, u.critBps, u.critDamageBps, u.hitBps, u.dodgeBps],
        // Tổng lượng khiên đang hấp thụ (vẽ thanh trắng nhạt dưới thanh máu — mục 16)
        shield: s.shields.reduce((acc, x) => acc + x.amount, 0),
        // Hiệu ứng đang có, hiển thị rõ tăng/giảm cái gì và bao nhiêu (chip trên ô tướng)
        effects: effectChips(s),
      };
    }
    const a = acting();
    const sk = actingSkill();
    arena.sync({ view: snap, acting: a, skillName: a !== null && sk ? skillNameAt(a, sk) : null, targets: targets() });
  }

  /** Số sát thương/hồi máu bay lên trên ô tướng (vẽ bằng PixiJS; mỗi mảnh có thể kèm icon hiệu ứng). */
  const addFloat = (idx: number, parts: FloatPart[], crit: boolean, heal = false) => {
    // Tua nhanh: không tạo hiệu ứng bay để tránh dựng hàng nghìn đối tượng PixiJS trong một lúc.
    if (fastForward) return;
    arena?.float(idx, parts, crit, heal);
  };

  /** Hiệu ứng kỹ năng trên ô tướng (niệm chiêu ở người ra đòn / va chạm trên mục tiêu). */
  const addFx = (idx: number, kind: FxKind) => {
    if (fastForward) return;
    arena?.impact(idx, kind);
  };

  function apply(ev: PvpEventDto) {
    builder.add(ev);
    if (!fastForward) setDetail(builder.rows.slice());
    if (!fastForward) {
      const s = sfxOf(ev);
      if (s) playSfx(s);
    }
    switch (ev.t) {
      case 'round':
        setRound(ev.round);
        setActing(null);
        setActingSkill(null);
        setTargets([]);
        // Bỏ các lớp buff/debuff đã hết hạn đúng như engine; tính lại trần HP theo lớp còn lại
        // (hồi/kẹp máu tương ứng). Choáng gỡ theo lượt của tướng gây choáng (xử lý ở sự kiện 'act').
        setView((v) => {
          const next: Record<number, CV> = {};
          for (const k in v) {
            const s = v[k]!;
            const buffs = s.buffs.some((b) => b.expiresRound < ev.round) ? s.buffs.filter((b) => b.expiresRound >= ev.round) : s.buffs;
            const debuffs = s.debuffs.some((d) => d.expiresRound < ev.round) ? s.debuffs.filter((d) => d.expiresRound >= ev.round) : s.debuffs;
            // Khiên hết lượt cũng tự tan (mục 16) — khớp engine.
            const shields = s.shields.some((x) => x.expiresRound < ev.round) ? s.shields.filter((x) => x.expiresRound >= ev.round) : s.shields;
            next[k] = syncHp({ ...s, buffs, debuffs, shields });
          }
          return next;
        });
        break;
      case 'act':
        setActing(ev.idx);
        setActingSkill(ev.skill);
        setTargets(ev.targets);
        // Hiệu ứng niệm chiêu ở người ra đòn (kiểu theo nhóm kỹ năng + phe + sắc thái riêng tướng)
        if (!fastForward) arena?.cast(ev.idx, ev.skill);
        // Tướng ra đòn → gỡ choáng do CHÍNH tướng này gây (khớp engine).
        setView((v) => {
          let changed = false;
          const next: Record<number, CV> = {};
          for (const k in v) {
            const s = v[k]!;
            if (s.stunnedByIdx === ev.idx) {
              next[k] = { ...s, stunned: false, stunnedByIdx: null };
              changed = true;
            } else next[k] = s;
          }
          return changed ? next : v;
        });
        break;
      case 'skip':
        setActing(ev.idx);
        setActingSkill(null);
        break;
      case 'miss':
        // Né đòn (mục 18 — BƯỚC 1): không gây sát thương, Khiên & Máu giữ nguyên.
        setActing(ev.from);
        addFloat(ev.idx, [{ text: 'NÉ' }], false, true);
        break;
      case 'damage':
        setActing(ev.from);
        // Khiên hấp thụ bớt phần sát thương `absorbed` (mục 16): trừ khiên rồi mới cập nhật HP.
        upd(ev.idx, (s) => ({ ...s, hp: ev.hp, shields: absorbedOf(s, ev.absorbed) }));
        addFloat(ev.idx, [{ text: `-${num(ev.amount)}` }], ev.crit);
        addFx(ev.idx, 'damage');
        break;
      case 'counter':
        // Phản kích: `from` đánh trả `idx` (kẻ vừa gây sát thương chủ động cho `from`).
        setActing(ev.from);
        upd(ev.idx, (s) => ({ ...s, hp: ev.hp, shields: absorbedOf(s, ev.absorbed) }));
        addFloat(ev.idx, [{ text: `-${num(ev.amount)}` }], ev.crit);
        addFx(ev.idx, 'damage');
        break;
      case 'heal':
        setActing(ev.from);
        upd(ev.idx, (s) => ({ ...s, hp: ev.hp }));
        addFloat(ev.idx, [{ text: `+${num(ev.amount)}` }], ev.crit, true);
        addFx(ev.idx, 'heal');
        break;
      case 'stun':
        upd(ev.idx, (s) => ({ ...s, stunned: true, stunnedByIdx: ev.byIdx }));
        addFx(ev.idx, 'stun');
        break;
      case 'cleanse':
        upd(ev.idx, (s) => ({ ...s, stunned: false, stunnedByIdx: null }));
        addFx(ev.idx, 'purify');
        break;
      case 'buff': {
        // Thêm MỘT lớp cho tướng: cộng thẳng sát thương + tăng trần HP (hồi đúng lượng tăng).
        // Trần `maxLayers` tính theo TỪNG (nguồn, kênh) (khớp engine): chỉ bỏ lớp cũ nhất cùng người thi triển + kênh.
        upd(ev.idx, (s) => {
          const buffs = [
            ...s.buffs,
            {
              sourceIdx: ev.from,
              channel: ev.channel,
              flat: ev.damageFlat,
              hpFlat: ev.hpFlat,
              critBps: ev.critBps,
              critDamageBps: ev.critDamageBps,
              takenDownBps: ev.takenDownBps,
              lifestealBps: ev.lifestealBps,
              hitBps: ev.hitBps ?? 0,
              dodgeBps: ev.dodgeBps ?? 0,
              defBps: ev.defBps ?? 0,
              defPenBps: ev.defPenBps ?? 0,
              expiresRound: ev.expiresRound,
            },
          ];
          while (buffs.filter((b) => b.sourceIdx === ev.from && b.channel === ev.channel).length > ev.maxLayers) {
            const at = buffs.findIndex((b) => b.sourceIdx === ev.from && b.channel === ev.channel);
            if (at < 0) break;
            buffs.splice(at, 1);
          }
          return syncHp({ ...s, buffed: true, buffs });
        });
        const gains: FloatPart[] = [
          ...(ev.damageFlat > 0 ? [{ text: `+${num(ev.damageFlat)}` }] : []),
          ...(ev.hpFlat > 0 ? [{ text: `+${num(ev.hpFlat)}` }] : []),
          ...(ev.lifestealBps > 0 ? [{ icon: 'blood' as const, text: `+${pct(ev.lifestealBps)}` }] : []),
        ];
        if (gains.length) addFloat(ev.idx, gains, ev.crit, true);
        addFx(ev.idx, 'buff');
        break;
      }
      case 'debuff': {
        // Thêm MỘT lớp hiệu ứng bất lợi: giảm sát thương/HP tối đa/chí mạng + thiêu đốt mỗi lượt.
        // Trần `maxLayers` tính theo TỪNG nguồn (khớp engine): chỉ bỏ lớp cũ nhất của cùng người thi triển.
        upd(ev.idx, (s) => {
          const debuffs = [
            ...s.debuffs,
            {
              sourceIdx: ev.from,
              damageFlat: ev.damageFlat,
              hpFlat: ev.hpFlat,
              critBps: ev.critBps,
              critDamageBps: ev.critDamageBps,
              hitDownBps: ev.hitDownBps ?? 0,
              dodgeDownBps: ev.dodgeDownBps ?? 0,
              defDownBps: ev.defDownBps ?? 0,
              defPenDownBps: ev.defPenDownBps ?? 0,
              burnFlat: ev.burnFlat,
              expiresRound: ev.expiresRound,
            },
          ];
          while (debuffs.filter((d) => d.sourceIdx === ev.from).length > ev.maxLayers) {
            const at = debuffs.findIndex((d) => d.sourceIdx === ev.from);
            if (at < 0) break;
            debuffs.splice(at, 1);
          }
          return syncHp({ ...s, debuffs });
        });
        addFx(ev.idx, 'debuff');
        break;
      }
      case 'burn':
        // Thiêu đốt gây sát thương vào đầu mỗi lượt (có thể ăn chí mạng theo chỉ số người thi triển).
        upd(ev.idx, (s) => ({ ...s, hp: ev.hp, shields: absorbedOf(s, ev.absorbed) }));
        addFloat(ev.idx, [{ icon: 'burn', text: `-${num(ev.amount)}` }], ev.crit);
        addFx(ev.idx, 'burn');
        break;
      case 'shield':
        // Tạo MỘT lớp Khiên (mục 16): trần `maxLayers` theo TỪNG (nguồn, kênh) — bỏ lớp cũ nhất cùng nguồn+kênh.
        upd(ev.idx, (s) => {
          const shields = [...s.shields, { sourceIdx: ev.from, channel: ev.channel, amount: ev.amount, expiresRound: ev.expiresRound }];
          while (shields.filter((x) => x.sourceIdx === ev.from && x.channel === ev.channel).length > ev.maxLayers) {
            const at = shields.findIndex((x) => x.sourceIdx === ev.from && x.channel === ev.channel);
            if (at < 0) break;
            shields.splice(at, 1);
          }
          return { ...s, shields };
        });
        addFloat(ev.idx, [{ icon: 'sphere-shield', text: `+${num(ev.amount)}` }], false, true);
        break;
      case 'shieldBreak':
        // Xóa Khiên (mục 17): bẻ gãy TOÀN BỘ lớp khiên của mục tiêu trúng đòn.
        upd(ev.idx, (s) => ({ ...s, shields: [] }));
        break;
      case 'dispel':
        // Xóa toàn bộ hiệu ứng có lợi của đối thủ — trần HP giảm theo (kẹp máu xuống trần mới).
        upd(ev.idx, (s) => syncHp({ ...s, buffed: false, buffs: [] }));
        addFx(ev.idx, 'dispel');
        break;
      case 'purify':
        // Thanh tẩy hiệu ứng bất lợi cho đồng minh, TRỪ thiêu đốt: zero hóa giảm sát thương/HP/chí mạng,
        // gỡ hẳn lớp không còn thiêu đốt (khớp engine). Trần HP hồi lại phần bị giảm.
        upd(ev.idx, (s) => {
          const debuffs = s.debuffs
            .map((d) => (d.burnFlat > 0 ? { ...d, damageFlat: 0, hpFlat: 0, critBps: 0, critDamageBps: 0, hitDownBps: 0, dodgeDownBps: 0, defDownBps: 0, defPenDownBps: 0 } : null))
            .filter((d): d is CV['debuffs'][number] => d !== null);
          return syncHp({ ...s, debuffs });
        });
        addFx(ev.idx, 'purify');
        break;
      case 'revive':
        // Hồi sinh (mục 1.14): tướng sống lại với `hp` máu và giảm sát thương vĩnh viễn → cập nhật hệ số nhân.
        upd(ev.idx, (s) => ({ ...s, alive: true, hp: ev.hp, damageMulBps: Math.max(0, BPS_SCALE - ev.damageDownBps) }));
        addFloat(ev.idx, [{ text: `HỒI SINH +${num(ev.hp)}` }], false, true);
        addFx(ev.idx, 'heal');
        break;
      case 'down':
        // Tướng bị hạ: đánh dấu chết + gỡ mọi choáng do chính tướng này gây (khớp engine).
        setView((v) => {
          const next: Record<number, CV> = {};
          for (const k in v) {
            const s = v[k]!;
            const patch: Partial<CV> =
              k === String(ev.idx)
                ? { alive: false, hp: 0, stunned: false, stunnedByIdx: null }
                : s.stunnedByIdx === ev.idx
                  ? { stunned: false, stunnedByIdx: null }
                  : {};
            next[k] = { ...s, ...patch };
          }
          return next;
        });
        break;
      case 'end':
        setPlaying(false);
        setDone(true);
        setReport(true);
        break;
    }
    if (!fastForward) pushArena();
  }

  function step() {
    const evs = props.battle.events;
    const c = cursor();
    if (c >= evs.length) {
      setDone(true);
      setPlaying(false);
      return;
    }
    apply(evs[c]!);
    setCursor(c + 1);
    if (cursor() >= evs.length) setDone(true);
  }

  function schedule() {
    clearTimeout(timer);
    const ev = props.battle.events[cursor()];
    if (!ev || !playing()) return;
    const ms = EVENT_MS[ev.t] ?? 250;
    timer = window.setTimeout(() => {
      if (!playing()) return;
      step();
      if (playing() && !done()) schedule();
      else setPlaying(false);
    }, ms / speed());
  }

  function play() {
    if (done()) reset();
    setPlaying(true);
    schedule();
  }
  function pause() {
    setPlaying(false);
    clearTimeout(timer);
  }
  function reset() {
    clearTimeout(timer);
    stopAllSfx();
    builder = createDetailBuilder(units);
    setView(initView());
    setCursor(0);
    setRound(0);
    setActing(null);
    setActingSkill(null);
    setTargets([]);
    setDetail([]);
    setDone(false);
    setReport(false);
    pushArena();
  }
  function toEnd() {
    pause();
    const evs = props.battle.events;
    // Trận dài (nhất là trận HOÀ phải chạy hết PVP_MAX_ROUNDS) có thể tới hàng nghìn sự kiện.
    // Tính trạng thái ở chế độ "tua nhanh" rồi cập nhật sân đấu + diễn biến MỘT LẦN để không bị đơ.
    fastForward = true;
    try {
      for (let c = cursor(); c < evs.length; c++) apply(evs[c]!);
    } finally {
      fastForward = false;
    }
    setCursor(evs.length);
    setDetail(builder.rows.slice());
    setDone(true);
    pushArena();
  }
  /** "Kết quả": nhảy tới cuối trận rồi mở bảng kết quả (diễn biến + tổng kết chỉ số). */
  function showResult() {
    toEnd();
    setReport(true);
  }
  function stepOnce() {
    pause();
    step();
  }

  const me = () => (props.battle.mySide === 'a' ? props.battle.attacker : props.battle.defender);
  const foe = () => (props.battle.mySide === 'a' ? props.battle.defender : props.battle.attacker);

  /** Tướng trên sân (bất biến trong trận) — dựng một lần cho sân đấu PixiJS. */
  const arenaUnits: ArenaUnit[] = units.map((u) => {
    const g = gen(u.generalId);
    return {
      idx: u.idx,
      side: u.side,
      slot: u.slot,
      name: g.name,
      level: u.level,
      lc: u.lc,
      artKey: g.artKey,
      style: u.style,
      // Nhóm kỹ năng + phe: dùng chọn kiểu và pha màu hiệu ứng kỹ năng trên sân (arena.ts)
      skill: u.skill,
      faction: g.faction,
      damage: u.damage,
      // Tướng có nội tại Phản kích: luôn hiện chip "PK" trên ô để biết nó đánh trả khi bị đánh
      counter: u.counter !== undefined,
      // Chú thích đầy đủ khi rê chuột lên ô tướng (giống dòng chỉ số cũ)
      info:
        `Phong cách: ${PVP_STYLE_LABELS[u.style]} · Nội tại: ${PVP_PASSIVE_LABELS[u.passive]} · Kỹ năng: ${u.skillName} · Choáng ${(u.stunBps / 100).toFixed(0)}%` +
        (u.lifestealBps > 0 ? ` · Hút máu ${(u.lifestealBps / 100).toFixed(0)}%` : ''),
    };
  });

  let disposed = false;
  onCleanup(() => {
    disposed = true;
    clearTimeout(timer);
    stopAllSfx();
    arena?.destroy();
  });
  // Canvas PixiJS dựng bất đồng bộ; xong thì đẩy trạng thái đầu trận rồi tự phát lại
  onMount(() => {
    void createArena(field, arenaUnits, props.battle.mySide).then((a) => {
      if (disposed) {
        a.destroy();
        return;
      }
      arena = a;
      pushArena();
      setTimeout(play, 300);
    });
  });

  return (
    <div class="pvp-modal rp-modal" role="dialog" aria-modal="true">
      <div class="panel rp-box">
        <div class="rp-head">
          <div class="rp-side mine">
            <Avatar avatar={me().avatar} name={me().displayName} class="rp-avatar" />
            <span class="rp-side-name">{me().displayName}</span>
          </div>
          <div class="rp-mid">
            <span class="rp-round">{round() ? `Lượt ${round()}` : 'Bắt đầu'}</span>
            <Show when={done()}>
              <span class={`rp-result ${outcomeClass(mySideOfWinner(props.battle))}`}>
                {props.battle.winner === 'draw' ? 'HÒA' : OUTCOME_LABEL[props.battle.result]}
              </span>
            </Show>
          </div>
          <div class="rp-side foe">
            <span class="rp-side-name">{foe().displayName}</span>
            <Avatar avatar={foe().avatar} name={foe().displayName} class="rp-avatar" />
          </div>
        </div>

        {/* Sân đấu + diễn biến: luôn nằm trong DOM để canvas PixiJS không bị hủy khi mở bảng kết quả */}
        <div class="rp-live" hidden={report()}>
          {/* Tên kỹ năng đang thi triển: keyed để mỗi lần ra chiêu khối được dựng lại -> chạy lại hoạt ảnh bật nảy */}
          <div class="rp-cast" classList={{ on: !!actingSkill() }}>
            <Show
              when={actingSkill() && acting() !== null ? { idx: acting()!, skill: actingSkill()! } : null}
              keyed
              fallback={<span class="rp-cast-hint">Diễn biến trận đấu</span>}
            >
              {(v) => (
                <>
                  <span class="rp-cast-who">{nameOf(v.idx)}</span>
                  <span class="rp-cast-tag">dùng</span>
                  <span class="rp-cast-skill">{skillNameAt(v.idx, v.skill)}</span>
                </>
              )}
            </Show>
          </div>

          {/* Sân đấu vẽ bằng PixiJS: 2 đội 2 bên, ngăn bằng dải phân cách giữa (dựng trong arena.ts) */}
          <div class="rp-canvas" ref={field} />

          {/* Diễn biến chi tiết hiện dần trong lúc đang đánh (giống hệt bảng kết quả sau trận) */}
          <DetailList rows={detail()} units={units} mySide={props.battle.mySide} follow />

          <div class="rp-progress">
            <i style={{ width: `${props.battle.events.length ? (cursor() / props.battle.events.length) * 100 : 0}%` }} />
          </div>
        </div>
        <Show when={report()}>
          <div class="rp-report-wrap">
            <BattleReport units={units} mySide={props.battle.mySide} analysis={analysis()} />
          </div>
        </Show>

        <div class="rp-controls">
          <Show
            when={!report()}
            fallback={
              <>
                <button class="btn ghost small" onClick={() => setReport(false)}>
                  Xem diễn biến
                </button>
                <button class="btn ghost small" onClick={reset}>
                  Chơi lại
                </button>
                <Show when={props.onRematch}>
                  <button class="btn primary small" onClick={() => props.onRematch?.(foe().id)}>
                    Khiêu chiến lại
                  </button>
                </Show>
              </>
            }
          >
            <button class="btn primary small" onClick={() => (playing() ? pause() : play())}>
              {playing() ? 'Tạm dừng' : 'Phát'}
            </button>
            <button class="btn ghost small" onClick={stepOnce}>
              Bước
            </button>
            <button class="btn ghost small" onClick={reset}>
              Chơi lại
            </button>
            <button class="btn ghost small" onClick={toEnd}>
              Tua nhanh
            </button>
            <span class="rp-speeds">
              <For each={[1, 2, 4]}>
                {(s) => (
                  <button class="btn ghost small" classList={{ on: speed() === s }} onClick={() => setSpeed(s)}>
                    {`${s}×`}
                  </button>
                )}
              </For>
            </span>
            <button class={`btn ghost small rp-sfx ${sfxPrefs().on ? '' : 'muted'}`} onClick={toggleSfx} title={sfxPrefs().on ? 'Tắt âm thanh trận đấu' : 'Bật âm thanh trận đấu'} aria-pressed={sfxPrefs().on ? 'true' : 'false'}>
              <svg viewBox="0 0 32 32" width="16" height="16" aria-hidden="true">
                <g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
                  <path d="M6 12v8h5l6 5V7l-6 5H6z" fill="currentColor" fill-opacity=".18" />
                  <path d="M21 12.5a6 6 0 0 1 0 7M24.5 9.5a10.5 10.5 0 0 1 0 13" stroke-width="1.6" />
                </g>
                <path class="mute-slash" d="M4 28L28 4" stroke="#d8432f" stroke-width="3" stroke-linecap="round" />
              </svg>
              {sfxPrefs().on ? 'Âm thanh' : 'Tắt tiếng'}
            </button>
            <button class="btn primary small" onClick={showResult}>
              Kết quả
            </button>
          </Show>
          <button class="btn ghost small rp-close" onClick={() => props.onClose()}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

// ======================= Trang Đấu trường =======================

export function PvpPage() {
  let alive = true;
  let lastOppId = 0;
  onCleanup(() => (alive = false));

  const [overview, setOverview] = createSignal<PvpOverviewDto | null>(null);
  const [team, setTeam] = createSignal<PvpUnitDto[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pickerSlot, setPickerSlot] = createSignal<number | null>(null);
  /** Modal chuẩn bị khiêu chiến (tự mở khi chọn đối thủ) — cho phép xem 2 đội và sửa đội ngay tại đây. */
  const [challengeOpen, setChallengeOpen] = createSignal(false);

  const [cards, setCards] = createSignal<CardDto[] | null>(null);
  const [opponent, setOpponent] = createSignal<PvpOpponentDto | null>(null);
  const [oppError, setOppError] = createSignal('');
  const [oppBusy, setOppBusy] = createSignal(false);
  const [battle, setBattle] = createSignal<PvpBattleDto | null>(null);
  const [history, setHistory] = createSignal<PvpBattleSummaryDto[]>([]);

  // Lực chiến (LC) của một tướng ở cấp cao nhất đang sở hữu — server tính sẵn trong `ownedCombat`.
  const unitLc = (generalId: string) => overview()?.ownedCombat[generalId]?.self.lc ?? 0;
  // Tổng LC đội hình đang dựng (mỗi tướng đã mang sẵn LC; tướng mới gán lấy LC từ `unitLc`).
  const teamLc = () => team().reduce((s, u) => s + (u.lc || unitLc(u.generalId)), 0);

  /**
   * Chi tiết chiến đấu của từng tướng theo (tướng|cấp|đội) — dùng chung cho cả 2 đội:
   * dòng chỉ số dưới ô tướng lấy từ đây, và hộp chi tiết khi bấm ảnh đại diện cũng dùng luôn.
   * Gửi kèm danh sách tướng trong đội để server tính Chỉ số Nền Ra Trận (vị trí + aura Hỗ trợ + Cổng Đồng Phe).
   */
  const [combat, setCombat] = createSignal<Record<string, PvpCombatDto>>({});
  const pendingStats = new Set<string>();
  async function ensureStats(units: PvpUnitDto[]) {
    // Gửi theo ĐÚNG thứ tự vị trí (slot 1→6) để server suy ra hàng (trước/sau) cho Chỉ số Nền Ra Trận.
    const squad = units.slice().sort((a, b) => a.slot - b.slot).map((u) => u.generalId);
    const jobs = units.filter((u) => {
      const k = statKey(u, units);
      if (untrack(combat)[k] || pendingStats.has(k)) return false;
      pendingStats.add(k);
      return true;
    });
    await Promise.all(
      jobs.map(async (u) => {
        try {
          const dto = await api.generalCombat(u.generalId, u.level, squad);
          if (!alive) return;
          setCombat((s) => ({ ...s, [statKey(u, units)]: dto }));
        } catch {
          /* lỗi tải chỉ số thì bỏ qua — ô tướng hiện dấu "…" */
        } finally {
          pendingStats.delete(statKey(u, units));
        }
      }),
    );
  }

  const options = createMemo<GenOpt[]>(() => {
    const cs = cards();
    if (!cs) return [];
    // Mỗi tướng chỉ cần một lựa chọn: cấp cao nhất đang sở hữu
    const best = new Map<string, number>();
    for (const c of cs) {
      const cur = best.get(c.generalId);
      if (cur === undefined || c.level > cur) best.set(c.generalId, c.level);
    }
    return [...best.entries()]
      .map(([id, lv]) => ({
        id,
        name: gen(id).name,
        faction: gen(id).faction,
        artKey: gen(id).artKey,
        style: genStyle(id),
        best: lv,
        lc: unitLc(id),
      }))
      .sort((a, b) => b.lc - a.lc || b.best - a.best || a.name.localeCompare(b.name));
  });

  async function loadOverview() {
    try {
      const d = await api.pvp();
      if (!alive) return;
      setError('');
      setOverview(d);
      setTeam(d.team.units);
      setDirty(false);
    } catch (e) {
      if (alive) setError((e as Error).message);
    }
  }
  async function loadHistory() {
    try {
      const p = await api.pvpBattles({ pageSize: 12 });
      if (alive) setHistory(p.items);
    } catch {
      /* lịch sử trống thì bỏ qua */
    }
  }
  async function loadCards() {
    try {
      const list = await fetchAllCards();
      if (alive) setCards(list);
    } catch {
      if (alive) setCards([]);
    }
  }
  async function loadOpponent(id: number) {
    setOppBusy(true);
    setOppError('');
    try {
      const d = await api.pvpOpponent(id);
      if (alive) {
        setOpponent(d);
        setChallengeOpen(true); // tự mở modal chuẩn bị khiêu chiến khi chọn đối thủ
      }
    } catch (e) {
      if (!alive) return;
      setOpponent(null);
      setOppError((e as Error).message);
    } finally {
      if (alive) setOppBusy(false);
    }
  }

  onMount(() => {
    void loadOverview();
    void loadHistory();
  });

  // Nạp chỉ số cơ bản cho đội mình + đội đối thủ để hiển thị ở bước chuẩn bị khiêu chiến
  createEffect(() => {
    const t = team();
    if (t.length) void ensureStats(t);
    const o = opponent();
    if (o) void ensureStats(o.team.units);
  });

  // Đối thủ chọn từ bảng xếp hạng (#pvp/<id>)
  createEffect(() => {
    const id = pvpTarget();
    const ov = overview();
    if (!id || !ov) return;
    if (ov.me.id === id) {
      setOpponent(null);
      return;
    }
    if (id === lastOppId) return;
    lastOppId = id;
    void loadOpponent(id);
  });

  function openPicker(slot: number) {
    setPickerSlot(slot);
    if (!cards()) void loadCards();
  }

  function assign(slot: number, generalId: string, level: number) {
    setTeam((prev) => {
      // Bỏ tướng này khỏi slot cũ (mỗi tướng chỉ xếp một lần) rồi gán vào slot được chọn
      const rest = prev.filter((u) => u.slot !== slot && u.generalId !== generalId);
      return [...rest, { slot, generalId, level, lc: unitLc(generalId) }].sort((a, b) => a.slot - b.slot);
    });
    setDirty(true);
    setPickerSlot(null);
  }
  function clearSlot(slot: number) {
    setTeam((prev) => prev.filter((u) => u.slot !== slot));
    setDirty(true);
    setPickerSlot(null);
  }
  /** Kéo-thả đổi vị trí hai ô trong đội mình (mục 6.7): hoán đổi tướng giữa hai slot. */
  function moveSlot(from: number, to: number) {
    if (from === to) return;
    setTeam((prev) => {
      const a = prev.find((u) => u.slot === from);
      const b = prev.find((u) => u.slot === to);
      const rest = prev.filter((u) => u.slot !== from && u.slot !== to);
      const next = [...rest];
      if (b) next.push({ ...b, slot: from });
      if (a) next.push({ ...a, slot: to });
      return next.sort((x, y) => x.slot - y.slot);
    });
    setDirty(true);
  }
  /** Tướng đang có trong đội: generalId → vị trí (Picker hiện "Đang ở vị trí X"). */
  const takenSlots = createMemo<Record<string, number>>(() => Object.fromEntries(team().map((u) => [u.generalId, u.slot])));
  /** Chi tiết chiến đấu của tướng đang sở hữu (cấp cao nhất) — Picker hiện kỹ năng chi tiết (server tính). */
  const ownedCombat = createMemo(() => overview()?.ownedCombat ?? {});
  /** Đối thủ đang mở trong modal chuẩn bị khiêu chiến. */
  const challengeOpp = createMemo(() => (challengeOpen() ? opponent() : null));
  /** Đang lưu đội hình (tự động) — chỉ để hiện trạng thái, không khoá thao tác. */
  const [saving, setSaving] = createSignal(false);

  /**
   * Lưu đội hình lên server. Không cần nút "Lưu": người chơi chỉnh xong là tự lưu (mục 6.7).
   * Chỉ nhận kết quả server chuẩn hoá khi đội chưa bị sửa tiếp trong lúc đang lưu.
   */
  async function saveTeam(snapshot: PvpUnitDto[]) {
    if (saving() || !alive) return;
    setSaving(true);
    try {
      const r = await api.pvpSaveTeam(snapshot);
      if (!alive) return;
      batch(() => {
        if (team() === snapshot) {
          setTeam(r.units);
          setDirty(false);
        }
      });
    } catch (e) {
      if (alive) toast((e as Error).message, 5000);
    } finally {
      if (alive) setSaving(false);
    }
  }

  /** Trạng thái lưu đội hình hiển thị cho người chơi (không còn nút Lưu — tự động). */
  const saveHint = () => (saving() || dirty() ? 'Đang tự động lưu đội hình…' : 'Đội hình được lưu tự động.');
  let saveTimer: number | undefined;
  onCleanup(() => clearTimeout(saveTimer));
  // Người chơi ngừng chỉnh ~700ms thì tự lưu đội hình.
  createEffect(() => {
    const t = team();
    if (!dirty() || !t.length) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveTeam(t), 700);
  });

  async function challenge() {
    const opp = opponent();
    if (!opp || busy()) return;
    setBusy(true);
    try {
      const b = await api.pvpChallenge(opp.opponent.id);
      if (!alive) return;
      setChallengeOpen(false); // đóng modal chuẩn bị để xem trận đấu
      setBattle(b);
      void loadOverview(); // cập nhật thành tích Thắng/Thua/Hòa
      // KHÔNG nạp lại lịch sử ở đây: trận vừa đánh sẽ được đưa vào lịch sử khi người chơi
      // đóng màn xem lại trận (xem `closeBattle`), để lịch sử không đổi sau lưng lúc đang xem.
    } catch (e) {
      if (alive) toast((e as Error).message, 5000);
    } finally {
      if (alive) setBusy(false);
    }
  }

  /** Khiêu chiến lại cùng đối thủ ngay từ màn kết quả trận. */
  async function rematch(opponentId: number) {
    if (busy()) return;
    setBusy(true);
    try {
      const b = await api.pvpChallenge(opponentId);
      if (!alive) return;
      setBattle(b);
      void loadOverview();
    } catch (e) {
      if (alive) toast((e as Error).message, 5000);
    } finally {
      if (alive) setBusy(false);
    }
  }

  /** Đóng màn xem lại trận — lúc này mới nạp lại lịch sử trận đấu (đã gồm trận vừa đánh). */
  function closeBattle() {
    setBattle(null);
    void loadHistory();
  }

  async function openHistoryBattle(id: number) {
    try {
      const b = await api.pvpBattle(id);
      if (alive) setBattle(b);
    } catch (e) {
      if (alive) toast((e as Error).message, 5000);
    }
  }

  const gotoLeaderboard = () => {
    setPvpTarget(null);
    location.hash = 'leaderboard';
  };

  return (
    <>
      <section class="panel pvp-panel">
        <div class="pvp-head">
          <h2>Đấu trường</h2>
          <Show when={overview()}>
            {(ov) => (
              <div class="pvp-record" aria-label="Thành tích">
                <span class="rec win">{`Thắng ${ov().wins}`}</span>
                <span class="rec loss">{`Thua ${ov().losses}`}</span>
                <span class="rec draw">{`Hòa ${ov().draws}`}</span>
              </div>
            )}
          </Show>
        </div>
        <div class="pvp-rulebar">
          <FormationRules />
        </div>

        <Show when={error()}>
          <div class="state-msg error">{error()}</div>
        </Show>

        <Show when={overview()} fallback={<div class="state-msg">Đang tải sân đấu…</div>}>
          {(ov) => (
            <>
              <div class="pvp-myteam">
                <div class="pvp-team-head">
                  <h3>Đội hình của bạn</h3>
                  <span class="pvp-power" title="Tổng Lực chiến của đội">{`Lực chiến ${num(teamLc())}`}</span>
                </div>
                <TeamBoard units={team()} combat={combat()} onSlot={openPicker} onMove={moveSlot} />
                <div class="pvp-team-actions">
                  <span class="muted small">{saveHint()}</span>
                </div>
              </div>

              <div class="pvp-opp">
                <div class="pvp-team-head">
                  <h3>Đối thủ</h3>
                  <button class="btn ghost small" onClick={gotoLeaderboard}>
                    Chọn từ bảng xếp hạng
                  </button>
                </div>
                <Show when={oppBusy()}>
                  <div class="state-msg">Đang tải đối thủ…</div>
                </Show>
                <Show when={!oppBusy() && oppError()}>
                  <div class="state-msg error">{oppError()}</div>
                </Show>
                <Show when={!oppBusy() && opponent()}>
                  {(o) => (
                    <div class="pvp-opp-row">
                      <Avatar avatar={o().opponent.avatar} name={o().opponent.displayName} class="pvp-opp-avatar" />
                      <div class="pvp-opp-row-info">
                        <b>{o().opponent.displayName}</b>
                        <span class="muted small">{`Lực chiến ${num(o().team.lc)}${o().saved ? '' : ' · đội gợi ý'}`}</span>
                      </div>
                      <button class="btn primary small" onClick={() => setChallengeOpen(true)}>
                        Chuẩn bị khiêu chiến
                      </button>
                    </div>
                  )}
                </Show>
                <Show when={!oppBusy() && !opponent() && !oppError()}>
                  <div class="state-msg">
                    Mở <b>Bảng xếp hạng</b> và bấm vào một người chơi để khiêu chiến.
                  </div>
                </Show>
              </div>

              <div class="pvp-hist">
                <h3>Lịch sử trận đấu</h3>
                <Show when={history().length} fallback={<div class="state-msg">Chưa có trận đấu nào.</div>}>
                  <div class="pvp-hist-list">
                    <For each={history()}>
                      {(h) => (
                        <button class="pvp-hist-row" onClick={() => void openHistoryBattle(h.id)}>
                          <span class={`hist-res ${outcomeClass(h.result)}`}>{OUTCOME_LABEL[h.result]}</span>
                          <span class="hist-role">{h.role === 'attack' ? 'Tấn công' : 'Phòng thủ'}</span>
                          <Avatar avatar={h.opponent.avatar} name={h.opponent.displayName} class="hist-avatar" />
                          <span class="hist-name">{h.opponent.displayName}</span>
                          <span class="hist-power muted small">{`${num(h.myLc)} vs ${num(h.opponentLc)}`}</span>
                          <span class="hist-time muted small">{time(h.createdAt)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </>
          )}
        </Show>
      </section>

      {/* Modal chuẩn bị khiêu chiến: xem 2 đội cạnh nhau và chỉnh đội mình ngay tại đây */}
      <Show when={challengeOpp()}>
        {(o) => (
          <div class="pvp-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && setChallengeOpen(false)}>
            <div class="panel pvp-challenge">
              <div class="pvp-picker-head">
                <h3>{`Chuẩn bị khiêu chiến · ${o().opponent.displayName}`}</h3>
                <button class="btn ghost small" onClick={() => setChallengeOpen(false)}>
                  Đóng
                </button>
              </div>
              <div class="pvp-duel">
                <div class="pvp-duel-side mine">
                  <div class="pvp-duel-head">
                    <Avatar avatar={overview()?.me.avatar ?? null} name={overview()?.me.displayName ?? ''} class="pvp-opp-avatar" />
                    <div>
                      <b>{overview()?.me.displayName}</b>
                      <div class="muted small">{`Lực chiến ${num(teamLc())}`}</div>
                    </div>
                  </div>
                  <TeamBoard units={team()} combat={combat()} onSlot={openPicker} onMove={moveSlot} />
                </div>
                <div class="pvp-duel-vs" aria-hidden="true">
                  VS
                </div>
                <div class="pvp-duel-side foe">
                  <div class="pvp-duel-head">
                    <Avatar avatar={o().opponent.avatar} name={o().opponent.displayName} class="pvp-opp-avatar" />
                    <div>
                      <b>{o().opponent.displayName}</b>
                      <div class="muted small">{`Lực chiến ${num(o().team.lc)}${o().saved ? '' : ' · đội gợi ý'}`}</div>
                    </div>
                  </div>
                  <TeamBoard units={o().team.units} combat={combat()} foe />
                </div>
              </div>
              <div class="pvp-rulebar">
                <p class="muted small pvp-challenge-hint">Bấm vào ô tướng để đổi, hoặc kéo-thả để thay đổi vị trí.</p>
                <FormationRules up />
              </div>
              <div class="pvp-team-actions">
                <span class="muted small">{saveHint()}</span>
                <button class="btn primary" disabled={busy() || team().length === 0} onClick={() => void challenge()}>
                  {busy() ? 'Đang giao chiến…' : 'Khiêu chiến'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      <Show when={pickerSlot()}>
        {(slot) => (
          <Picker
            slot={slot()}
            options={options()}
            taken={takenSlots()}
            combat={ownedCombat()}
            onPick={(gid, lv) => assign(slot(), gid, lv)}
            onClear={() => clearSlot(slot())}
            onClose={() => setPickerSlot(null)}
          />
        )}
      </Show>

      <Show keyed when={battle()}>{(b) => <BattleReplay battle={b} onClose={closeBattle} onRematch={(id) => void rematch(id)} />}</Show>
    </>
  );
}
