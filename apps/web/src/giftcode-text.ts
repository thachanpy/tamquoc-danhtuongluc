import { TICKET_LABELS, type GiftCodeReward } from '@tq/shared';

/** "200 Vé Thục, 20 Vé Ngụy". Dòng "thẻ" chỉ còn ở code thẻ cũ (đã tắt). */
export const rewardText = (rewards: GiftCodeReward[]) =>
  rewards
    .map((r) => ((r.kind ?? 'card') === 'ticket' ? `${r.count} ${TICKET_LABELS[r.pool]}` : `${r.count} thẻ ${TICKET_LABELS[r.pool].replace('Vé ', '')}`))
    .join(', ');
