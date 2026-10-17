import { For, Show } from 'solid-js';
import { PVP_PASSIVE_LABELS, PVP_STYLE_LABELS, type PvpCombatDto, type PvpGemStats } from '@tq/shared';
import { STYLE_COLOR, pct } from '../art.ts';
import { preBattleNote, skillNote } from '../combat-notes.ts';
import { StyleIcon } from './StyleIcon.tsx';

/**
 * Khối "chi tiết chiến đấu" của một tướng (mục 6.7): phong cách, kỹ năng, nội tại và các chỉ số
 * ở đúng cấp đang xét — dữ liệu do server tính, client chỉ hiển thị.
 * Dùng chung cho popup ngắm thẻ (Bộ sưu tập) và bảng chọn tướng (Đấu trường) để hai nơi khớp nhau.
 */

/** Ghi chú phần Ngọc Ngũ Hành cộng thêm cho một chỉ số (aura nền cả đội, mục 6.8); rỗng nếu không có. */
function gemNote(c: PvpCombatDto, key: keyof PvpGemStats): string | undefined {
  const v = c.preBattle?.bonus.gem[key] ?? 0;
  return v > 0 ? `Ngọc +${pct(v)}` : undefined;
}

/** Ghi chú phần Ngọc cộng Giáp — Giáp là điểm nguyên nên in số thô, không quy ra %. */
function gemArmorNote(c: PvpCombatDto): string | undefined {
  const v = c.preBattle?.bonus.gem.defArmor ?? 0;
  return v > 0 ? `Ngọc +${v}` : undefined;
}

/** Các dòng chỉ số chi tiết: giá trị thực tế, kèm ghi chú chỉ số nền + phần % được cộng. */
export function statRows(c: PvpCombatDto): { label: string; value: string; note?: string }[] {
  // Phần % cộng thêm vào chỉ số của riêng tướng gồm nội tại (mục 10.1) + Chỉ số Nền Ra Trận (mục 1):
  // phong cách + cổng đồng phe khi có ngữ cảnh đội (`preBattle`), hoặc phong cách 1 lớp khi xem tự do.
  // Buff theo hàng và buff đồng minh phát mỗi lượt do engine áp khi vào trận, không cộng sẵn ở đây.
  const styleHpBps = c.preBattle ? c.preBattle.bonus.hpBps : c.styleBonus.hpBps;
  const styleDmgBps = c.preBattle ? c.preBattle.bonus.damageBps : c.styleBonus.damageBps;
  const hpPct = (c.passiveEffect.stat === 'maxHp' ? c.passiveEffect.bps : 0) + styleHpBps;
  const dmgPct = (c.passiveEffect.stat === 'damage' ? c.passiveEffect.bps : 0) + styleDmgBps;
  const note = (p: number, base: number, detail: string) =>
    p > 0 ? `+${Math.round((base * p) / c.bpsScale)} (+${pct(p)})${detail ? ` (${detail})` : ''}` : undefined;
  const rows: { label: string; value: string; note?: string }[] = [
    // HP/Sát thương: số chính là chỉ số cơ bản, phần cộng thêm (nền tướng + Ngọc) nằm ở ghi chú.
    {
      label: 'HP tối đa',
      value: `${c.base.maxHp}`,
      note: note(hpPct, c.base.maxHp, preBattleNote(c, 'hp')),
    },
    {
      label: 'Sát thương',
      value: `${c.base.damage}`,
      note: note(dmgPct, c.base.damage, preBattleNote(c, 'damage')),
    },
    // LC đã hiện cạnh cấp ở đầu modal (ngang hàng Lv) nên không lặp lại trong bảng chỉ số.
    // Toàn bộ 9 chỉ số còn lại của ô tướng — tướng không có chỉ số nền thì hiện 0%, phần Ngọc ở ghi chú.
    { label: 'Giáp', value: `${c.self.defArmor}`, note: gemArmorNote(c) },
    { label: 'Xuyên giáp', value: pct(c.self.defPenBps), note: gemNote(c, 'defPenBps') },
    { label: 'Chí mạng', value: pct(c.self.critBps), note: gemNote(c, 'critBps') },
    { label: 'ST chí mạng', value: pct(c.self.critDamageBps), note: gemNote(c, 'critDamageBps') },
    { label: 'Chính xác', value: pct(c.self.hitBps), note: gemNote(c, 'hitBps') },
    { label: 'Né tránh', value: pct(c.self.dodgeBps), note: gemNote(c, 'dodgeBps') },
    { label: 'Hút máu', value: `${pct(c.self.lifestealBps)} ST gây ra`, note: gemNote(c, 'lifestealBps') },
    { label: 'Giảm ST nhận', value: '0%', note: gemNote(c, 'takenDownBps') },
  ];
  if (c.skillDef.stun !== 'none') rows.push({ label: 'Choáng', value: pct(c.self.stunBps) });
  if (c.skillDef.cleanse) rows.push({ label: 'Giải choáng & thiêu đốt', value: pct(c.self.cleanseBps) });
  if (c.skillDef.purify) rows.push({ label: 'Thanh tẩy', value: `${pct(c.self.purifyBps)} mỗi lớp` });
  if (c.self.heal) rows.push({ label: 'Hồi máu', value: `${c.self.heal} HP` });
  if (c.self.teamLifestealBps) rows.push({ label: 'Hút máu đội', value: `${pct(c.self.teamLifestealBps)} tổng sát thương` });
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
          <span class="cmb-skillnote">
            <For each={skillNote(props.c)}>
              {(l) => (
                <span class="cmb-note-row">
                  <em>{l.label}</em>
                  <span>{l.text}</span>
                </span>
              )}
            </For>
          </span>
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
