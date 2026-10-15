import { PVP_BUFF_SCOPE_LABELS, PVP_TARGETING_LABELS, type PvpCombatDto } from '@tq/shared';
import { pct } from './art.ts';

/**
 * Mô tả bằng tiếng Việt cho dữ liệu chiến đấu do server tính (`PvpCombatDto`).
 * Dùng chung cho popup ngắm thẻ (Bộ sưu tập) và bảng chọn tướng (Đấu trường) để hai nơi luôn khớp nhau.
 */

/** Mô tả buff tăng sức mạnh theo kỹ năng: phát cho phạm vi `buffScope` mỗi lượt, cộng dồn lớp. */
export function teamBuffNote(c: PvpCombatDto): string {
  const b = c.buff;
  if (!b.damageBps && !b.hpBps && !b.critBps && !b.critDamageBps && !b.takenDownBps) return '';
  const gains = [
    b.damageBps ? `+${pct(b.damageBps)} sát thương` : '',
    b.hpBps ? `+${pct(b.hpBps)} HP tối đa` : '',
    b.critBps ? `+${b.critBps / 100} điểm chí mạng` : '',
    b.critDamageBps ? `+${pct(b.critDamageBps)} ST chí mạng` : '',
    b.takenDownBps ? `−${pct(b.takenDownBps)} sát thương gánh chịu` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return `mỗi lượt: ${PVP_BUFF_SCOPE_LABELS[c.buffScope]} ${gains} · tối đa ${b.maxLayers} lớp, mỗi lớp ${b.rounds} lượt`;
}

/** Mô tả hiệu ứng bất lợi kỹ năng áp lên địch (SKILLS.md — phe Ngụy, thiêu đốt phe Ngô). */
export function debuffNote(c: PvpCombatDto): string {
  const d = c.skillDef.debuff;
  const parts = [
    d.damageDownBps ? `−${pct(d.damageDownBps)} sát thương` : '',
    d.hpDownBps ? `−${pct(d.hpDownBps)} HP tối đa` : '',
    d.critDownBps ? `−${d.critDownBps / 100} điểm chí mạng` : '',
    d.critDamageDownBps ? `−${pct(d.critDamageDownBps)} ST chí mạng` : '',
    d.burnBps ? `thiêu đốt ${pct(d.burnBps)} sát thương mỗi lượt (${d.burnRounds} lượt)` : '',
  ]
    .filter(Boolean)
    .join(', ');
  if (!parts) return '';
  return `gây lên địch: ${parts} · tối đa ${d.maxLayers} lớp, mỗi lớp ${d.rounds} lượt`;
}

/** Mô tả kỹ năng (mục 6, 8, 9, 11.2) bằng tiếng Việt. */
export function skillNote(c: PvpCombatDto): string {
  const d = c.skillDef;
  const parts = [`mục tiêu: ${PVP_TARGETING_LABELS[d.targeting]}`];
  if (d.damageBps) parts.push(`${pct(d.damageBps)} sát thương cơ bản`);
  // Hồi máu: tự hồi theo HP tối đa khác hồi đồng minh theo sát thương.
  if (d.selfHealBps) parts.push(`hồi ${pct(d.selfHealBps)} HP tối đa cho bản thân mỗi lượt`);
  else if (c.self.heal) parts.push(`hồi ${c.self.heal} HP cho đồng minh`);
  // Hút máu theo sát thương gây ra (vài tướng riêng) — cấp hiện tại.
  if (c.self.lifestealBps) parts.push(`hút ${pct(c.self.lifestealBps)} sát thương gây ra`);
  if (d.stun !== 'none') parts.push(`choáng ${pct(c.self.stunBps)}`);
  if (d.cleanse) parts.push(`giải choáng ${pct(c.self.cleanseBps)}`);
  if (d.purify) parts.push('thanh tẩy hiệu ứng bất lợi cho đồng minh (trừ choáng, thiêu đốt)');
  if (d.dispel) parts.push(d.dispelChanceBps < 10000 ? `xóa hiệu ứng có lợi của địch ${pct(d.dispelChanceBps)}` : 'xóa hiệu ứng có lợi của địch');
  // Phản kích bị động: đánh trả khi gánh sát thương chủ động (không tính thiêu đốt/giảm máu tối đa).
  if (d.counter.damageBps) {
    const scope = d.counter.scope === 'all' ? 'toàn bộ địch' : 'một mục tiêu';
    parts.push(`phản kích bị động ${pct(d.counter.damageBps)} sát thương cơ bản lên ${scope}`);
  }
  if (d.selfBurn) parts.push(`tự thiêu đốt bản thân ${d.selfBurnRounds} lượt`);
  // Thiêu đốt đặc biệt: Chu Du nhân thêm chí mạng cho đòn thiêu đốt, Lục Tốn hút máu cả từ thiêu đốt.
  if (d.burnCritMulBps) parts.push(`sát thương thiêu đốt +${pct(d.burnCritMulBps - 10000)} tỷ lệ chí mạng và ST chí mạng`);
  if (d.burnLifesteal) parts.push('hút máu cả từ sát thương thiêu đốt');
  const buff = teamBuffNote(c);
  if (buff) parts.push(buff);
  const debuff = debuffNote(c);
  if (debuff) parts.push(debuff);
  return parts.join(' · ');
}
