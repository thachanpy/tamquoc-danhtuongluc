import { PVP_TARGETING_LABELS, type PvpCombatDto } from '@tq/shared';
import { pct } from './art.ts';

/**
 * Mô tả bằng tiếng Việt cho dữ liệu chiến đấu do server tính (`PvpCombatDto`).
 * Dùng chung cho popup ngắm thẻ (Bộ sưu tập) và bảng chọn tướng (Đấu trường) để hai nơi luôn khớp nhau.
 */

/** Mô tả hiệu ứng nền (aura) theo kỹ năng: tự buff bản thân + buff toàn đội (kể cả bản thân). */
export function auraNote(c: PvpCombatDto): string {
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
export function skillNote(c: PvpCombatDto): string {
  const d = c.skillDef;
  const parts = [`mục tiêu: ${PVP_TARGETING_LABELS[d.targeting]}`];
  if (d.damageBps) parts.push(`${pct(d.damageBps)} sát thương cơ bản`);
  // Hồi máu: tự hồi theo HP tối đa (SELF_HP — hồi mỗi lượt ra đòn) khác hồi đồng minh theo sát thương.
  if (d.selfHealBps) parts.push(`hồi ${pct(d.selfHealBps)} HP tối đa cho bản thân mỗi lượt`);
  else if (c.self.heal) parts.push(`hồi ${c.self.heal} HP cho đồng minh`);
  // Hút máu theo sát thương gây ra (vài tướng riêng) — cấp hiện tại.
  if (c.self.lifestealBps) parts.push(`hút ${pct(c.self.lifestealBps)} sát thương gây ra`);
  if (d.stun !== 'none') parts.push(`choáng ${pct(c.self.stunBps)}`);
  if (d.cleanse) parts.push(`giải choáng ${pct(c.self.cleanseBps)}`);
  if (d.buff) parts.push(`buff đồng minh +${pct(c.teamBuff.damageBps)} sát thương, +${c.teamBuff.critPointsBps / 100} điểm chí mạng`);
  const aura = auraNote(c);
  if (aura) parts.push(aura);
  return parts.join(' · ');
}
