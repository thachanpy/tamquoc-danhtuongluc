import { PVP_TARGETING_LABELS, type PvpCombatDto } from '@tq/shared';
import { pct } from './art.ts';

/**
 * Mô tả bằng tiếng Việt cho dữ liệu chiến đấu do server tính (`PvpCombatDto`).
 * Dùng chung cho popup ngắm thẻ (Bộ sưu tập) và bảng chọn tướng (Đấu trường) để hai nơi luôn khớp nhau.
 */

/** Mô tả buff tăng sức mạnh theo kỹ năng (nhóm TEAM_ và BUFF_ALLIES): phát cho cả đội mỗi lượt, cộng dồn lớp. */
export function teamBuffNote(c: PvpCombatDto): string {
  const b = c.teamBuff;
  if (!b.damageBps && !b.hpBps && !b.critPointsBps) return '';
  const gains = [
    b.damageBps ? `+${pct(b.damageBps)} sát thương` : '',
    b.hpBps ? `+${pct(b.hpBps)} HP tối đa` : '',
    b.critPointsBps ? `+${b.critPointsBps / 100} điểm chí mạng` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `mỗi lượt: cả đội (kể cả bản thân) ${gains} · tối đa ${b.maxLayers} lớp, mỗi lớp ${b.rounds} lượt`;
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
  const buff = teamBuffNote(c);
  if (buff) parts.push(buff);
  return parts.join(' · ');
}
