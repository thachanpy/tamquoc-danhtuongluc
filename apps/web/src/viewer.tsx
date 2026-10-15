import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import {
  FACTION_LABELS,
  PVP_PASSIVE_LABELS,
  PVP_SKILL_LABELS,
  PVP_STYLE_LABELS,
  PVP_TARGETING_LABELS,
  type CardDto,
  type GeneralDto,
  type PvpCombatDto,
} from '@tq/shared';
import { STYLE_COLOR, levelTier, pct, prefersReducedMotion } from './art.ts';
import { api } from './api.ts';
import { Card } from './components/Card.tsx';

/** Phong cách chỉ còn quyết định thứ tự hành động (LC) — hiệu ứng chỉ số nay theo kỹ năng (SKILLS.md). */
function styleNote(c: PvpCombatDto): string {
  if (c.style === 'attack') return 'ra đòn trước tiên';
  if (c.style === 'defense') return 'ra đòn sau cùng';
  return 'ra đòn sau Tấn công, trước Phòng thủ';
}

/** Mô tả hiệu ứng nền (aura) theo kỹ năng: tự buff bản thân + buff toàn đội (kể cả bản thân). */
function auraNote(c: PvpCombatDto): string {
  const a = c.aura;
  return [
    a.damageBps ? `tự +${pct(a.damageBps)} sát thương` : '',
    a.hpBps ? `tự +${pct(a.hpBps)} HP` : '',
    a.teamDamageBps ? `cả đội (kể cả bản thân) +${pct(a.teamDamageBps)} sát thương` : '',
    a.teamHpBps ? `cả đội (kể cả bản thân) +${pct(a.teamHpBps)} HP` : '',
    a.teamCritPointsBps ? `cả đội (kể cả bản thân) +${a.teamCritPointsBps / 100} điểm chí mạng` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Mô tả kỹ năng (mục 6, 8, 9, 11.2) bằng tiếng Việt. */
function skillNote(c: PvpCombatDto): string {
  const d = c.skillDef;
  const parts = [`mục tiêu: ${PVP_TARGETING_LABELS[d.targeting]}`];
  if (d.damageBps) parts.push(`${pct(d.damageBps)} sát thương cơ bản`);
  if (c.self.heal) parts.push(`hồi ${c.self.heal} HP`);
  if (d.stun !== 'none') parts.push(`choáng ${pct(c.self.stunBps)}`);
  if (d.cleanse) parts.push(`giải choáng ${pct(c.self.cleanseBps)}`);
  if (d.buff) parts.push(`buff đồng minh +${pct(c.teamBuff.damageBps)} sát thương, +${c.teamBuff.critPointsBps / 100} điểm chí mạng`);
  const aura = auraNote(c);
  if (aura) parts.push(aura);
  return parts.join(' · ');
}

/** Các dòng chỉ số chi tiết ở đúng cấp thẻ: giá trị thực tế, kèm ghi chú chỉ số nền + phần % được cộng. */
function statRows(c: PvpCombatDto): { label: string; value: string; note?: string }[] {
  // Phần trăm cộng thêm từ hiệu ứng nền theo kỹ năng (gồm buff toàn đội tướng tự hưởng) + nội tại:
  // chỉ số thực tế = nền × (1 + tổng %).
  const a = c.aura;
  const hpPct = a.hpBps + a.teamHpBps + (c.passiveEffect.stat === 'maxHp' ? c.passiveEffect.bps : 0);
  const dmgPct = a.damageBps + a.teamDamageBps + (c.passiveEffect.stat === 'damage' ? c.passiveEffect.bps : 0);
  const note = (p: number, base: number) => (p > 0 ? `nền ${base} · +${pct(p)}` : undefined);
  const rows: { label: string; value: string; note?: string }[] = [
    { label: 'HP tối đa', value: `${c.self.maxHp}`, note: note(hpPct, c.base.maxHp) },
    { label: 'Sát thương', value: `${c.self.damage}`, note: note(dmgPct, c.base.damage) },
    { label: 'Lực chiến (LC)', value: `${c.self.lc}` },
    { label: 'Chí mạng', value: pct(c.self.critBps) },
  ];
  if (c.skillDef.stun !== 'none') rows.push({ label: 'Choáng', value: pct(c.self.stunBps) });
  if (c.skillDef.cleanse) rows.push({ label: 'Giải choáng', value: pct(c.self.cleanseBps) });
  if (c.self.heal) rows.push({ label: 'Hồi máu', value: `${c.self.heal} HP` });
  return rows;
}

/**
 * Popup ngắm thẻ (mục 6.1): thẻ lớn + kỹ năng và chỉ số chi tiết của tướng ở đúng cấp thẻ (mục 6.7).
 * Chỉ hiển thị, không đổi dữ liệu. Bấm bất kỳ đâu hoặc Esc để đóng.
 * Di chuột lên thẻ để thẻ nghiêng nhẹ (tắt khi reduced motion).
 */
function CardViewer(props: { general: GeneralDto; card: CardDto; onClose: () => void }) {
  let overlay!: HTMLDivElement;
  let tilt!: HTMLDivElement;
  const tier = levelTier(props.card.level);
  const reduced = prefersReducedMotion();
  const [combat, setCombat] = createSignal<PvpCombatDto | null>(null);
  const [combatError, setCombatError] = createSignal<string | null>(null);
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  onMount(() => {
    document.addEventListener('keydown', onKey);
    overlay.focus();
    void api
      .generalCombat(props.general.id, props.card.level)
      .then(setCombat)
      .catch((e: Error) => setCombatError(e.message));
  });
  onCleanup(() => document.removeEventListener('keydown', onKey));
  const onMove = (e: PointerEvent) => {
    if (reduced) return;
    const r = tilt.getBoundingClientRect();
    const cx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / r.width));
    const cy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / r.height));
    tilt.style.transform = `rotateY(${cx * 12}deg) rotateX(${-cy * 12}deg)`;
    tilt.style.setProperty('--sx', `${50 + cx * 40}%`);
    tilt.style.setProperty('--sy', `${50 + cy * 40}%`);
  };
  return (
    <div
      ref={overlay}
      class="viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`${props.general.name} Lv.${props.card.level}`}
      tabIndex={-1}
      onClick={() => props.onClose()}
      onPointerMove={onMove}
      onPointerLeave={() => !reduced && (tilt.style.transform = '')}
    >
      <div class="viewer-box">
        <div ref={tilt} class="viewer-tilt">
          <Card general={props.general} level={props.card.level} extra="viewer-card" />
        </div>
        <div class="viewer-info">
          <div class="viewer-name">{props.general.name}</div>
          <div class="viewer-sub">
            <span class={`fac f-${props.general.faction}`}>{FACTION_LABELS[props.general.faction]}</span>
            <span class="dot">·</span>
            <span style={{ color: tier.css }}>Lv.{props.card.level}</span>
          </div>
          {/* Kỹ năng + chỉ số chi tiết do server tính (mục 6.7) */}
          <Show
            when={combat()}
            fallback={<div class="viewer-combat muted small">{combatError() ? `Không tải được chỉ số: ${combatError()}` : 'Đang tải chỉ số…'}</div>}
          >
            {(c) => (
              <div class="viewer-combat">
                <div class="cmb-row">
                  <span class="cmb-key">Phong cách</span>
                  <span class="cmb-val">
                    <b style={{ color: STYLE_COLOR[c().style] }}>{PVP_STYLE_LABELS[c().style]}</b>
                    <i>{styleNote(c())}</i>
                  </span>
                </div>
                <div class="cmb-row">
                  <span class="cmb-key">Kỹ năng</span>
                  <span class="cmb-val">
                    <b>{PVP_SKILL_LABELS[c().skill]}</b>
                    <i>{skillNote(c())}</i>
                  </span>
                </div>
                <div class="cmb-row">
                  <span class="cmb-key">Nội tại</span>
                  <span class="cmb-val">
                    <b>{PVP_PASSIVE_LABELS[c().passive]}</b>
                  </span>
                </div>
                <div class="cmb-stats">
                  <For each={statRows(c())}>
                    {(r) => (
                      <span class="cmb-stat">
                        <i>{r.label}</i>
                        <b>{r.value}</b>
                        <Show when={r.note}>
                          <em class="cmb-note">{r.note}</em>
                        </Show>
                      </span>
                    )}
                  </For>
                </div>
                <div class="cmb-foot">
                  {`Vào trận: hàng trước +${pct(c().rowBonus.frontHpBps)} HP · hàng sau +${pct(c().rowBonus.backDamageBps)} sát thương`}
                </div>
              </div>
            )}
          </Show>
          <div class="muted small">Nhận lúc {new Date(props.card.createdAt).toLocaleString('vi-VN')}</div>
          <div class="muted small viewer-hint">Chạm bất kỳ đâu để đóng</div>
        </div>
      </div>
    </div>
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
