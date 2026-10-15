import type { GiftCardSnapshot, GiftResultDto, RecipientDto } from '@tq/shared';
import { GIFT_MAX_CARDS } from '@tq/game-config';
import { AppError, type GameContext } from '../context.ts';
import { iso, sha256, likeContains } from '../utils.ts';
import { tx } from '../db.ts';
import { findApprovedUserByUsername } from '../repositories/user.repository.ts';
import { findCardsByIds, transferActiveCards } from '../repositories/card.repository.ts';
import { insertGift, listGiftRecipients } from '../repositories/gift.repository.ts';
import { findIdempotent, saveIdempotent } from '../repositories/idempotency.repository.ts';

/**
 * Tặng thẻ (mục 5.6): chuyển 1–GIFT_MAX_CARDS thẻ của mình cho người chơi khác theo tên đăng nhập.
 * - Nhận ngay, không cần người nhận chấp nhận. Không tặng cho chính mình.
 * - Chỉ thẻ đang active của chính người gửi; mọi level đều tặng được.
 * - Nguyên tử: đổi chủ toàn bộ thẻ + ghi lịch sử trong 1 transaction; thiếu 1 thẻ là huỷ cả giao dịch.
 * - Idempotent theo (người gửi, key).
 */
export function giftCards(
  ctx: GameContext,
  fromUserId: number,
  toUsername: string,
  cardIds: number[],
  idempotencyKey: string,
): GiftResultDto {
  if (!Array.isArray(cardIds) || cardIds.length < 1 || cardIds.length > GIFT_MAX_CARDS) {
    throw new AppError(400, 'GIFT_CARD_COUNT', `Mỗi lần tặng từ 1 đến ${GIFT_MAX_CARDS} thẻ.`);
  }
  if (!cardIds.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new AppError(400, 'INVALID_CARD_ID', 'Card ID không hợp lệ.');
  }
  if (new Set(cardIds).size !== cardIds.length) throw new AppError(400, 'DUPLICATE_CARD', 'Không được chọn trùng một thẻ.');
  const ids = [...cardIds].sort((a, b) => a - b);
  const requestHash = sha256(JSON.stringify({ to: toUsername.toLowerCase(), ids }));

  return tx(ctx.db, () => {
    const prev = findIdempotent<GiftResultDto>(ctx.db, fromUserId, 'gift_cards', idempotencyKey, requestHash);
    if (prev) return prev;

    const to = findApprovedUserByUsername(ctx.db, toUsername);
    if (!to) throw new AppError(404, 'RECIPIENT_NOT_FOUND', `Không tìm thấy người chơi "${toUsername}".`);
    // Tài khoản quản trị không chơi game => không nhận thẻ tặng
    if (to.is_admin === 1) throw new AppError(400, 'RECIPIENT_IS_ADMIN', 'Không thể tặng thẻ cho tài khoản quản trị.');
    if (to.id === fromUserId) throw new AppError(400, 'GIFT_TO_SELF', 'Không thể tặng thẻ cho chính mình.');

    const rows = findCardsByIds(ctx.db, ids);
    if (rows.length !== ids.length || rows.some((r) => r.user_id !== fromUserId)) {
      throw new AppError(404, 'CARD_NOT_FOUND', 'Có thẻ không tồn tại hoặc không thuộc về bạn.');
    }
    if (rows.some((r) => r.status !== 'active')) throw new AppError(409, 'CARD_CONSUMED', 'Có thẻ đã bị tiêu thụ.');

    const nowIso = iso(ctx.now());
    // Đổi chủ có điều kiện: chỉ thẻ active của người gửi. Phải đổi đúng đủ số thẻ.
    const moved = transferActiveCards(ctx.db, ids, fromUserId, to.id, nowIso);
    if (moved !== ids.length) throw new AppError(409, 'CARD_CONSUMED', 'Có thẻ vừa bị thao tác khác sử dụng.');

    const cards: GiftCardSnapshot[] = rows
      .sort((a, b) => a.id - b.id)
      .map((r) => ({ id: r.id, generalId: r.general_id, level: r.level }));
    const giftId = insertGift(ctx.db, {
      fromUserId,
      toUserId: to.id,
      cardsSnapshot: JSON.stringify(cards),
      cardCount: cards.length,
      idempotencyKey,
      createdAt: nowIso,
    });

    const result: GiftResultDto = { giftId, toUsername: to.username, cards, createdAt: nowIso };
    saveIdempotent(ctx.db, fromUserId, 'gift_cards', idempotencyKey, requestHash, result, nowIso);
    return result;
  });
}

/**
 * Danh sách người nhận cho dropdown tặng thẻ: mọi người chơi trừ chính mình.
 * Sắp xếp: người có giao dịch tặng/nhận thẻ với mình gần nhất lên đầu; người chưa từng giao dịch xếp sau theo tên A→Z.
 * q: lọc theo tên (không phân biệt hoa thường, chứa chuỗi).
 */
export function listRecipients(ctx: GameContext, userId: number, q = '', limit = 200): RecipientDto[] {
  return listGiftRecipients(ctx.db, userId, likeContains(q), limit).map((r) => ({
    username: r.username,
    lastGiftAt: r.last_gift_at,
  }));
}
