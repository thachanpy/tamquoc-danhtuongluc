import type { GiftCardSnapshot, GiftResultDto, RecipientDto } from '@tq/shared';
import { GIFT_MAX_CARDS } from '@tq/game-config';
import { AppError, iso, sha256, findIdempotent, saveIdempotent, type GameContext } from './context.ts';
import { tx } from './db.ts';

const marks = (ids: number[]) => ids.map(() => '?').join(',');

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

    const to = ctx.db.prepare('SELECT id, username FROM users WHERE username = ?').get(toUsername) as
      | { id: number; username: string }
      | undefined;
    if (!to) throw new AppError(404, 'RECIPIENT_NOT_FOUND', `Không tìm thấy người chơi "${toUsername}".`);
    if (to.id === fromUserId) throw new AppError(400, 'GIFT_TO_SELF', 'Không thể tặng thẻ cho chính mình.');

    const rows = ctx.db
      .prepare(`SELECT id, user_id, general_id, level, status FROM user_cards WHERE id IN (${marks(ids)})`)
      .all(...ids) as { id: number; user_id: number; general_id: string; level: number; status: string }[];
    if (rows.length !== ids.length || rows.some((r) => r.user_id !== fromUserId)) {
      throw new AppError(404, 'CARD_NOT_FOUND', 'Có thẻ không tồn tại hoặc không thuộc về bạn.');
    }
    if (rows.some((r) => r.status !== 'active')) throw new AppError(409, 'CARD_CONSUMED', 'Có thẻ đã bị tiêu thụ.');

    const nowIso = iso(ctx.now());
    // Đổi chủ có điều kiện: chỉ thẻ active của người gửi. Phải đổi đúng đủ số thẻ.
    const moved = ctx.db
      .prepare(
        `UPDATE user_cards SET user_id = ?, updated_at = ?
         WHERE id IN (${marks(ids)}) AND user_id = ? AND status = 'active'`,
      )
      .run(to.id, nowIso, ...ids, fromUserId);
    if (moved.changes !== ids.length) throw new AppError(409, 'CARD_CONSUMED', 'Có thẻ vừa bị thao tác khác sử dụng.');

    const cards: GiftCardSnapshot[] = rows
      .sort((a, b) => a.id - b.id)
      .map((r) => ({ id: r.id, generalId: r.general_id, level: r.level }));
    const ins = ctx.db
      .prepare(
        `INSERT INTO card_gifts (from_user_id, to_user_id, cards_snapshot, card_count, idempotency_key, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      .run(fromUserId, to.id, JSON.stringify(cards), cards.length, idempotencyKey, nowIso);

    const result: GiftResultDto = { giftId: Number(ins.lastInsertRowid), toUsername: to.username, cards, createdAt: nowIso };
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
  const needle = `%${q.trim().replace(/[%_\\]/g, (m) => '\\' + m)}%`;
  const rows = ctx.db
    .prepare(
      `SELECT u.username,
              (SELECT MAX(g.created_at) FROM card_gifts g
                WHERE (g.from_user_id = $me AND g.to_user_id = u.id) OR (g.from_user_id = u.id AND g.to_user_id = $me)) AS last_gift_at
         FROM users u
        WHERE u.id <> $me AND u.username LIKE $q ESCAPE '\\'
        ORDER BY last_gift_at IS NULL, last_gift_at DESC, u.username COLLATE NOCASE ASC
        LIMIT $limit`,
    )
    .all({ me: userId, q: needle, limit }) as { username: string; last_gift_at: string | null }[];
  return rows.map((r) => ({ username: r.username, lastGiftAt: r.last_gift_at }));
}
