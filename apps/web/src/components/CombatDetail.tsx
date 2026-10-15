import { For, Show } from 'solid-js';
import { PVP_PASSIVE_LABELS, PVP_STYLE_LABELS, type PvpCombatDto } from '@tq/shared';
import { STYLE_COLOR, pct } from '../art.ts';
import { skillNote } from '../combat-notes.ts';
import { StyleIcon } from './StyleIcon.tsx';

/**
 * Khối "chi tiết chiến đấu" của một tướng (mục 6.7): phong cách, kỹ năng, nội tại và các chỉ số
 * ở đúng cấp đang xét — dữ liệu do server tính, client chỉ hiển thị.
 * Dùng chung cho popup ngắm thẻ (Bộ sưu tập) và bảng chọn tướng (Đấu trường) để hai nơi khớp nhau.
 */

/** Các dòng chỉ số chi tiết: giá trị thực tế, kèm ghi chú chỉ số nền + phần % được cộng. */
export function statRows(c: PvpCombatDto): { label: string; value: string; note?: string }[] {
  // Phần % cộng thêm vào chỉ số của riêng tướng chỉ đến từ nội tại (buff theo hàng và buff
  // đồng minh phát mỗi lượt do engine áp khi vào trận, không cộng sẵn ở chỉ số "self").
  const hpPct = c.passiveEffect.stat === 'maxHp' ? c.passiveEffect.bps : 0;
  const dmgPct = c.passiveEffect.stat === 'damage' ? c.passiveEffect.bps : 0;
  const note = (p: number, base: number) => (p > 0 ? `nền ${base} · +${pct(p)}` : undefined);
  const rows: { label: string; value: string; note?: string }[] = [
    { label: 'HP tối đa', value: `${c.self.maxHp}`, note: note(hpPct, c.base.maxHp) },
    { label: 'Sát thương', value: `${c.self.damage}`, note: note(dmgPct, c.base.damage) },
    { label: 'Lực chiến (LC)', value: `${c.self.lc}` },
    { label: 'Chí mạng', value: pct(c.self.critBps) },
    { label: 'ST chí mạng', value: pct(c.self.critDamageBps) },
  ];
  if (c.skillDef.stun !== 'none') rows.push({ label: 'Choáng', value: pct(c.self.stunBps) });
  if (c.skillDef.cleanse) rows.push({ label: 'Giải choáng', value: pct(c.self.cleanseBps) });
  if (c.self.heal) rows.push({ label: 'Hồi máu', value: `${c.self.heal} HP` });
  if (c.self.lifestealBps) rows.push({ label: 'Hút máu', value: `${pct(c.self.lifestealBps)} sát thương gây ra` });
  return rows;
}

/** Toàn bộ chi tiết chiến đấu của tướng — giống hệt khối hiện khi mở thẻ tướng. */
export function CombatDetail(props: { c: PvpCombatDto }) {
  return (
    <div class="viewer-combat">
      <div class="cmb-row">
        <span class="cmb-key">Phong cách</span>
        <span class="cmb-val">
          <b class="cmb-style" style={{ color: STYLE_COLOR[props.c.style] }}>
            <StyleIcon style={props.c.style} size={12} />
            {PVP_STYLE_LABELS[props.c.style]}
          </b>
        </span>
      </div>
      <div class="cmb-row">
        <span class="cmb-key">Kỹ năng</span>
        <span class="cmb-val">
          <b>{props.c.skillName}</b>
          <i>{skillNote(props.c)}</i>
        </span>
      </div>
      <div class="cmb-row">
        <span class="cmb-key">Nội tại</span>
        <span class="cmb-val">
          <b>{PVP_PASSIVE_LABELS[props.c.passive]}</b>
        </span>
      </div>
      <div class="cmb-stats">
        <For each={statRows(props.c)}>
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
        {`Vào trận: hàng trước +${pct(props.c.rowBonus.frontHpBps)} HP · hàng sau +${pct(props.c.rowBonus.backDamageBps)} sát thương`}
      </div>
    </div>
  );
}
