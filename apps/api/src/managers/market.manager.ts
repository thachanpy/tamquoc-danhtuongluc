import { MARKET_MAX_ACTIVE_LISTINGS, MARKET_PRICE } from '@tq/game-config';
import type { Faction, MarketListingDto, MarketListingStatus, MarketPurchaseDto, Page } from '@tq/shared';
import { AppError, type GameContext } from '../context.ts';
import { searchGeneralIds, sha256, iso } from '../utils.ts';
import { invalidateMarket, invalidatePlayers, PREFIX, TTL, queryKey } from '../cache.ts';
import { tx, type DB } from '../db.ts';
import { consumeActiveCards, findCardsByIds, insertCard } from '../repositories/card.repository.ts';
import {
  countActiveListings,
  findListingView,
  insertListing,
  listActiveListings,
  listMarketHistory,
  listSellerListings,
  markListingCancelled,
  markListingSold,
  type MarketListingView,
} from '../repositories/market.repository.ts';
import { findIdempotent, saveIdempotent } from '../repositories/idempotency.repository.ts';

/**
 * Chợ thẻ tướng (chủ dự án yêu cầu): người chơi đem thẻ của mình lên bán cho người khác.
 * - Mỗi tin = MỘT thẻ (tướng + cấp). Giá hiện CỐ ĐỘNG 0 Vàng ("chỉ bán giá 0đ"); hệ thống Vàng làm sau.
 * - Đăng bán = tiêu thụ thẻ khỏi bộ sưu tập (thẻ không dùng được khi đang bán); huỷ tin trả lại thẻ cho
 *   người bán, mua xong tạo thẻ mới cho người mua.
 * - Nguyên tử + idempotent: mọi thao tác ghi nằm trong 1 transaction và theo (người chơi, key).
 */
/** Đọc lại một tin vừa ghi trong transaction; luôn tồn tại nên thiếu dòng là lỗi hệ thống. */
function listingOrThrow(db: DB, id: number): MarketListingView {
  const view = findListingView(db, id);
  if (!view) throw new AppError(500, 'INTERNAL', 'Không đọc được tin đăng bán.');
  return view;
}

function toDto(r: MarketListingView): MarketListingDto {
  return {
    id: r.id,
    generalId: r.general_id,
    level: r.level,
    price: r.price,
    status: r.status,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    buyerId: r.buyer_id,
    buyerName: r.buyer_name,
    createdAt: r.created_at,
    soldAt: r.sold_at,
    cancelledAt: r.cancelled_at,
  };
}

/** Tham số duyệt chợ (khớp schema `marketListingsQuery`). */
export interface MarketBrowseQuery {
  faction?: Faction;
  level?: number;
  q?: string;
  sort?: 'newest' | 'level_desc' | 'level_asc' | 'name';
  onlyOthers?: boolean;
  page: number;
  pageSize: number;
}

/** Tham số "Tin của tôi" (khớp schema `marketMineQuery`). */
export interface MarketMineQuery {
  status?: MarketListingStatus;
  page: number;
  pageSize: number;
}

export interface MarketHistoryQuery {
  page: number;
  pageSize: number;
}

/**
 * Duyệt chợ: danh sách tin đang bán. Kết quả không phụ thuộc người xem (chỉ `onlyOthers` là của riêng
 * người xem nên đã nằm trong khoá cache) => dùng chung cache cho mọi người chơi.
 */
export function listMarket(ctx: GameContext, userId: number, q: MarketBrowseQuery): Promise<Page<MarketListingDto>> {
  return ctx.cache.readThrough(PREFIX.marketList(queryKey(q)), TTL.marketList, () => {
    const { rows, total } = listActiveListings(ctx.db, {
      faction: q.faction,
      level: q.level,
      generalIds: q.q?.trim() ? searchGeneralIds(q.q) : undefined,
      excludeSellerId: q.onlyOthers ? userId : undefined,
      sort: q.sort,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    return { items: rows.map(toDto), page: q.page, pageSize: q.pageSize, total };
  });
}

/** Tin đăng bán của chính mình (đang bán / đã bán / đã huỷ). */
export function listMyListings(ctx: GameContext, userId: number, q: MarketMineQuery): Promise<Page<MarketListingDto>> {
  return ctx.cache.readThrough(PREFIX.marketMine(userId, queryKey(q)), TTL.marketMine, () => {
    const { rows, total } = listSellerListings(ctx.db, userId, q.status, q.pageSize, (q.page - 1) * q.pageSize);
    return { items: rows.map(toDto), page: q.page, pageSize: q.pageSize, total };
  });
}

/** Lịch sử mua/bán của chính mình (đọc từ tin đã bán, cả vai người bán lẫn người mua). */
export function listHistory(ctx: GameContext, userId: number, q: MarketHistoryQuery): Promise<Page<MarketListingDto>> {
  return ctx.cache.readThrough(PREFIX.marketHistory(userId, queryKey(q)), TTL.marketHistory, () => {
    const { rows, total } = listMarketHistory(ctx.db, userId, q.pageSize, (q.page - 1) * q.pageSize);
    return { items: rows.map(toDto), page: q.page, pageSize: q.pageSize, total };
  });
}

/** Đăng bán MỘT thẻ từ bộ sưu tập lên chợ (giá cố định MARKET_PRICE). */
export function createListing(
  ctx: GameContext,
  sellerId: number,
  cardId: number,
  idempotencyKey: string,
): MarketListingDto {
  if (!Number.isSafeInteger(cardId) || cardId <= 0) throw new AppError(400, 'INVALID_CARD_ID', 'Card ID không hợp lệ.');
  const requestHash = sha256(JSON.stringify({ cardId }));

  const result = tx(ctx.db, () => {
    const prev = findIdempotent<MarketListingDto>(ctx.db, sellerId, 'market_list', idempotencyKey, requestHash);
    if (prev) return prev;

    if (countActiveListings(ctx.db, sellerId) >= MARKET_MAX_ACTIVE_LISTINGS) {
      throw new AppError(409, 'MARKET_LISTING_LIMIT', `Bạn chỉ được đăng bán tối đa ${MARKET_MAX_ACTIVE_LISTINGS} thẻ cùng lúc.`);
    }
    const card = findCardsByIds(ctx.db, [cardId])[0];
    if (!card || card.user_id !== sellerId) throw new AppError(404, 'CARD_NOT_FOUND', 'Thẻ không tồn tại hoặc không thuộc về bạn.');
    if (card.status !== 'active') throw new AppError(409, 'CARD_CONSUMED', 'Thẻ đã bị tiêu thụ, không thể đăng bán.');

    const nowIso = iso(ctx.now());
    // Đăng bán = tiêu thụ thẻ khỏi bộ sưu tập (có điều kiện: chỉ thẻ active của chính mình).
    if (consumeActiveCards(ctx.db, [cardId], sellerId, nowIso) !== 1) {
      throw new AppError(409, 'CARD_CONSUMED', 'Thẻ vừa bị thao tác khác sử dụng.');
    }
    const listingId = insertListing(ctx.db, {
      sellerId,
      generalId: card.general_id,
      level: card.level,
      price: MARKET_PRICE,
      idempotencyKey,
      nowIso,
    });
    const dto = toDto(listingOrThrow(ctx.db, listingId));
    saveIdempotent(ctx.db, sellerId, 'market_list', idempotencyKey, requestHash, dto, nowIso);
    return dto;
  });

  invalidatePlayers(ctx.cache, sellerId);
  invalidateMarket(ctx.cache, sellerId);
  return result;
}

/** Người bán huỷ tin: đánh dấu đã huỷ và trả thẻ về bộ sưu tập. */
export function cancelListing(
  ctx: GameContext,
  sellerId: number,
  listingId: number,
  idempotencyKey: string,
): MarketListingDto {
  const requestHash = sha256(JSON.stringify({ listingId }));

  const result = tx(ctx.db, () => {
    const prev = findIdempotent<MarketListingDto>(ctx.db, sellerId, 'market_cancel', idempotencyKey, requestHash);
    if (prev) return prev;

    const listing = findListingView(ctx.db, listingId);
    if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'Tin đăng bán không tồn tại.');
    if (listing.seller_id !== sellerId) throw new AppError(403, 'NOT_LISTING_OWNER', 'Bạn không phải người đăng tin này.');
    if (listing.status !== 'active') throw new AppError(409, 'LISTING_NOT_ACTIVE', 'Tin đăng bán không còn ở trạng thái đang bán.');

    const nowIso = iso(ctx.now());
    if (markListingCancelled(ctx.db, listingId, sellerId, nowIso) !== 1) {
      throw new AppError(409, 'LISTING_GONE', 'Tin đăng bán vừa thay đổi trạng thái.');
    }
    // Trả thẻ về bộ sưu tập người bán (tạo lại thẻ active, giữ nguyên tướng + cấp).
    insertCard(ctx.db, sellerId, listing.general_id, listing.level, nowIso);
    const dto = toDto(listingOrThrow(ctx.db, listingId));
    saveIdempotent(ctx.db, sellerId, 'market_cancel', idempotencyKey, requestHash, dto, nowIso);
    return dto;
  });

  invalidatePlayers(ctx.cache, sellerId);
  invalidateMarket(ctx.cache, sellerId);
  return result;
}

/** Mua một tin đang bán: đánh dấu đã bán và tạo thẻ mới cho người mua. */
export function buyListing(
  ctx: GameContext,
  buyerId: number,
  listingId: number,
  idempotencyKey: string,
): MarketPurchaseDto {
  const requestHash = sha256(JSON.stringify({ listingId }));
  let sellerId = 0; // lấy trong transaction để xoá cache sau khi ghi xong

  const result = tx(ctx.db, () => {
    const prev = findIdempotent<MarketPurchaseDto>(ctx.db, buyerId, 'market_buy', idempotencyKey, requestHash);
    if (prev) return prev;

    const listing = findListingView(ctx.db, listingId);
    if (!listing) throw new AppError(404, 'LISTING_NOT_FOUND', 'Tin đăng bán không tồn tại.');
    if (listing.seller_id === buyerId) throw new AppError(400, 'CANNOT_BUY_OWN', 'Không thể mua thẻ của chính mình.');
    if (listing.status !== 'active') throw new AppError(409, 'LISTING_NOT_ACTIVE', 'Tin đăng bán đã được bán hoặc đã huỷ.');

    const nowIso = iso(ctx.now());
    if (markListingSold(ctx.db, listingId, buyerId, nowIso) !== 1) {
      throw new AppError(409, 'LISTING_GONE', 'Tin đăng bán vừa được người khác mua.');
    }
    const cardId = insertCard(ctx.db, buyerId, listing.general_id, listing.level, nowIso);
    const dto: MarketPurchaseDto = {
      listingId,
      generalId: listing.general_id,
      level: listing.level,
      price: listing.price,
      cardId,
      soldAt: nowIso,
    };
    saveIdempotent(ctx.db, buyerId, 'market_buy', idempotencyKey, requestHash, dto, nowIso);
    sellerId = listing.seller_id;
    return dto;
  });

  // Thẻ đổi chủ + tin/lịch sử chợ của cả hai bên đều đổi.
  invalidatePlayers(ctx.cache, buyerId, sellerId);
  invalidateMarket(ctx.cache, buyerId, sellerId);
  return result;
}
