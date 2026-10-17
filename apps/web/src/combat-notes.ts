import { PVP_BUFF_SCOPE_LABELS, PVP_TARGETING_LABELS, type PvpBuffDto, type PvpCombatDto } from '@tq/shared';
import { pct, ptText } from './art.ts';

/**
 * Mô tả bằng tiếng Việt cho dữ liệu chiến đấu do server tính (`PvpCombatDto`).
 * Dùng chung cho popup ngắm thẻ (Bộ sưu tập) và bảng chọn tướng (Đấu trường) để hai nơi luôn khớp nhau.
 */

/**
 * Nhãn chi tiết Chỉ số Nền Ra Trận (màn chuẩn bị khiêu chiến) cho HP hoặc Sát thương.
 * Ví dụ: "+5% Trước, +6% Phe, +8% Thủ, +6% Hỗ trợ". Rỗng khi xem tự do (không có đội).
 */
export function preBattleNote(c: PvpCombatDto, kind: 'hp' | 'damage'): string {
  const b = c.preBattle?.bonus;
  if (!b) return '';
  const passive = c.passiveEffect;
  const parts: string[] = [];
  if (kind === 'hp') {
    if (b.rowHpBps) parts.push(`+${pct(b.rowHpBps)} Trước`);
    if (b.factionHpBps) parts.push(`+${pct(b.factionHpBps)} Phe`);
    if (b.defenseHpBps) parts.push(`+${pct(b.defenseHpBps)} Thủ`);
    if (b.supportHpBps) parts.push(`+${pct(b.supportHpBps)} Hỗ trợ`);
    if (b.gem.hpBps) parts.push(`+${pct(b.gem.hpBps)} Ngọc`);
    if (passive.stat === 'maxHp' && passive.bps) parts.push(`+${pct(passive.bps)} Nội tại`);
  } else {
    if (b.rowDamageBps) parts.push(`+${pct(b.rowDamageBps)} Sau`);
    if (b.factionDamageBps) parts.push(`+${pct(b.factionDamageBps)} Phe`);
    if (b.attackDamageBps) parts.push(`+${pct(b.attackDamageBps)} Công`);
    if (b.supportDamageBps) parts.push(`+${pct(b.supportDamageBps)} Hỗ trợ`);
    if (b.gem.damageBps) parts.push(`+${pct(b.gem.damageBps)} Ngọc`);
    if (passive.stat === 'damage' && passive.bps) parts.push(`+${pct(passive.bps)} Nội tại`);
  }
  return parts.join(', ');
}

/** Một dòng mô tả kỹ năng: nhãn ngắn bên trái + nội dung tiếng Việt bên phải. */
export interface SkillNoteLine {
  label: string;
  text: string;
}

/** Số nguyên có dấu phân cách nghìn kiểu Việt Nam (1234 → "1.234"). */
const num = (n: number) => Math.round(n).toLocaleString('vi-VN');

/** Câu mô tả thời hạn hiệu ứng: "chồng tối đa N lớp, mỗi lớp R lượt" hoặc "duy trì R lượt". */
function layerNote(rounds: number, maxLayers: number): string {
  if (maxLayers > 1) return `chồng tối đa ${maxLayers} lớp, mỗi lớp ${rounds} lượt`;
  return rounds ? `duy trì ${rounds} lượt` : '';
}

/** Các hiệu ứng có lợi mà một kênh buff phát cho phạm vi của nó. */
function buffGains(b: PvpBuffDto): string {
  return [
    b.damageBps ? `+${pct(b.damageBps)} sát thương` : '',
    b.hpBps ? `+${pct(b.hpBps)} HP tối đa` : '',
    b.critBps ? `+${b.critBps / 100} điểm chí mạng` : '',
    b.critDamageBps ? `+${pct(b.critDamageBps)} ST chí mạng` : '',
    b.takenDownBps ? `giảm ${pct(b.takenDownBps)} sát thương nhận vào` : '',
    b.lifestealBps ? `+${pct(b.lifestealBps)} hút máu` : '',
    b.hitBps ? `+${ptText(b.hitBps)} chính xác` : '',
    b.dodgeBps ? `+${ptText(b.dodgeBps)} né tránh` : '',
    b.defArmor ? `+${num(b.defArmor)} giáp` : '',
    b.defPenBps ? `+${ptText(b.defPenBps)} xuyên giáp` : '',
    b.shieldBps ? `tạo Khiên bằng ${pct(b.shieldBps)} HP tối đa` : '',
    b.hotBps ? `hồi ${pct(b.hotBps)} sát thương nền mỗi lượt (hồi theo lượt)` : '',
    b.burnUpBps ? `+${pct(b.burnUpBps)} sát thương Thiêu đốt` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/**
 * Mô tả kỹ năng (mục 6, 8, 9, 11.2) thành các DÒNG RIÊNG, mỗi dòng một hiệu ứng có nhãn rõ ràng
 * để người chơi đọc hiểu ngay thay vì một chuỗi dài.
 */
export function skillNote(c: PvpCombatDto): SkillNoteLine[] {
  const d = c.skillDef;
  const lines: SkillNoteLine[] = [];

  // Dòng đầu: kỹ năng gây sát thương lên ai / hồi máu cho ai.
  if (d.damageBps) lines.push({ label: 'Sát thương', text: `${pct(d.damageBps)} lên ${PVP_TARGETING_LABELS[d.targeting]}` });
  else if (c.self.heal) lines.push({ label: 'Hồi máu', text: `${num(c.self.heal)} HP cho ${PVP_TARGETING_LABELS[d.targeting]}` });

  // Hồi máu & hút máu.
  if (d.selfHealBps) lines.push({ label: 'Tự hồi máu', text: `hồi ${pct(d.selfHealBps)} HP tối đa mỗi lượt ra đòn` });
  if (c.self.lifestealBps) lines.push({ label: 'Hút máu', text: `hồi bản thân ${pct(c.self.lifestealBps)} sát thương gây ra` });
  if (c.self.teamLifestealBps)
    lines.push({ label: 'Hút máu đội', text: `bản thân và mọi đồng minh hồi ${pct(c.self.teamLifestealBps)} tổng sát thương gây ra` });

  // Khống chế & gỡ hiệu ứng.
  if (d.stun !== 'none') lines.push({ label: 'Choáng', text: `${pct(c.self.stunBps)} lên mục tiêu trúng đòn` });
  if (d.cleanse) lines.push({ label: 'Giải khống', text: `gỡ Choáng & Thiêu đốt cho đồng minh, tỉ lệ ${pct(c.self.cleanseBps)}` });
  if (d.purify) lines.push({ label: 'Thanh tẩy', text: `gỡ hiệu ứng bất lợi cho đồng minh (trừ Choáng & Thiêu đốt), tỉ lệ ${pct(c.self.purifyBps)} mỗi lớp` });
  if (d.dispel)
    lines.push({
      label: 'Xóa buff',
      text: `gỡ hiệu ứng có lợi của địch (tỉ lệ ${pct(d.dispelBps)})`,
    });

  // Hiệu ứng bất lợi áp lên địch.
  const down = [
    d.debuff.damageDownBps ? `giảm ${pct(d.debuff.damageDownBps)} sát thương` : '',
    d.debuff.hpDownBps ? `giảm ${pct(d.debuff.hpDownBps)} HP tối đa` : '',
    d.debuff.critDownBps ? `giảm ${d.debuff.critDownBps / 100} điểm chí mạng` : '',
    d.debuff.critDamageDownBps ? `giảm ${pct(d.debuff.critDamageDownBps)} ST chí mạng` : '',
    d.debuff.hitDownBps ? `giảm ${ptText(d.debuff.hitDownBps)} chính xác` : '',
    d.debuff.dodgeDownBps ? `giảm ${ptText(d.debuff.dodgeDownBps)} né tránh` : '',
    d.debuff.defArmorDown ? `giảm ${num(d.debuff.defArmorDown)} giáp` : '',
    d.debuff.defPenDownBps ? `giảm ${ptText(d.debuff.defPenDownBps)} xuyên giáp` : '',
  ]
    .filter(Boolean)
    .join(', ');
  if (down) {
    const layer = layerNote(d.debuff.rounds, d.debuff.maxLayers);
    lines.push({ label: 'Làm yếu địch', text: layer ? `${down} (${layer})` : down });
  }
  if (d.debuff.shieldBreakBps)
    lines.push({
      label: 'Phá Khiên',
      text: `bẻ gãy Khiên của địch — tỉ lệ ${pct(d.debuff.shieldBreakBps)}, phá ${pct(d.debuff.shieldBreakRemoveBps)} Khiên hiện có`,
    });
  if (d.debuff.burnBps) {
    const layer = d.debuff.burnMaxLayers > 1 ? `, chồng tối đa ${d.debuff.burnMaxLayers} lớp` : '';
    lines.push({
      label: 'Thiêu đốt',
      text: `${pct(d.debuff.burnBps)} sát thương mỗi lượt trong ${d.debuff.burnRounds} lượt${layer} (chịu Phòng thủ của mục tiêu)`,
    });
  }

  // Tăng cường (buff) theo từng kênh phát.
  for (const e of c.buffs) {
    const gains = buffGains(e.buff);
    if (!gains) continue;
    const layer = layerNote(e.buff.rounds, e.buff.maxLayers);
    lines.push({ label: 'Tăng cường', text: `${PVP_BUFF_SCOPE_LABELS[e.scope]}: ${gains}${layer ? ` (${layer})` : ''}` });
  }

  // Nội tại bị động & cường hóa đặc biệt của kỹ năng.
  if (d.counter.damageBps)
    lines.push({
      label: 'Phản kích',
      text: `khi bị đánh, có ${pct(d.counter.chanceBps)} cơ hội đánh trả ${d.counter.scope === 'all' ? 'toàn bộ địch' : 'kẻ tấn công'} bằng ${pct(
        d.counter.damageBps,
      )} sát thương cơ bản`,
    });
  if (d.dodgeReact?.counterDamageBps)
    lines.push({
      label: 'Phản kích Né',
      text: `né thành công thì đánh trả NGAY kẻ vừa ra đòn bằng ${pct(d.dodgeReact.counterDamageBps)} sát thương cơ bản`,
    });
  if (d.dodgeReact?.critDamageBps)
    lines.push({
      label: 'Né tích lũy',
      text: `mỗi lần né thành công cộng dồn vĩnh viễn +${pct(d.dodgeReact.critDamageBps)} ST chí mạng (tối đa ${d.dodgeReact.maxLayers} lớp)`,
    });
  if (d.guaranteedHitBelowHpBps)
    lines.push({
      label: 'Chắc chắn trúng',
      text: `bỏ qua Né khi mục tiêu còn dưới ${pct(d.guaranteedHitBelowHpBps)} HP`,
    });
  if (d.revive)
    lines.push({
      label: 'Hồi sinh',
      text: `gục lần đầu thì sống lại, hồi ${pct(d.reviveHpBps)} HP tối đa, đổi lại −50% sát thương tới hết trận`,
    });
  if (d.vsDebuffBonusBps)
    lines.push({
      label: 'Đao phủ',
      text: `+${pct(d.vsDebuffBonusBps)} sát thương khi đánh mục tiêu đang chịu từ 2 hiệu ứng bất lợi, Choáng hoặc Thiêu đốt`,
    });
  if (d.burnCritMulBps)
    lines.push({ label: 'Cường hóa đốt', text: `đòn thiêu đốt +${pct(d.burnCritMulBps - 10000)} tỉ lệ chí mạng và ST chí mạng` });
  if (d.burnLifesteal) lines.push({ label: 'Hút máu đốt', text: 'hút máu cả từ sát thương thiêu đốt (50% hiệu suất)' });
  if (d.burnCritDamageBps)
    lines.push({ label: 'Cường hóa đốt', text: `+${pct(d.burnCritDamageBps)} ST chí mạng khi đánh mục tiêu đang thiêu đốt` });
  if (d.selfBurn) lines.push({ label: 'Tự thiêu đốt', text: `bản thân chịu thiêu đốt trong ${d.selfBurnRounds} lượt` });

  return lines;
}
