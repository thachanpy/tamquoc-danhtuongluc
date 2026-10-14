# Tam Quốc: Danh Tướng Lục — bản demo MVP

Game web sưu tầm thẻ tướng Tam Quốc, triển khai theo `CLAUDE.md`.

## Yêu cầu

- Node.js **≥ 22.18** (dùng `node:sqlite` có sẵn và chạy TypeScript trực tiếp khi test)
- pnpm 9 (`corepack enable` hoặc `npm i -g pnpm`)

## Chạy

```bash
pnpm install
pnpm dev          # API: http://127.0.0.1:3000 · Web: http://localhost:5173
pnpm test         # unit + integration test (game-config, api)
pnpm typecheck
```

Database SQLite nằm ở `data/tamquoc.db` (đổi bằng biến `DB_PATH`). Khởi động không bao giờ reset dữ liệu.

> Tài khoản mới nhận ngay **100 vé quà đăng ký** (loại vé random 20% mỗi loại, 5 loại gồm cả Vé Quần), có thể quay luôn sau khi đăng ký.
> Sau đó hồi 1 vé ở mỗi mốc 5 phút (giờ :00, :05, :10…) theo đồng hồ server. Số vé quà chỉnh ở
> `SIGNUP_BONUS_TICKETS` trong `packages/game-config/src/rates.ts`.

## Cấu trúc

```
packages/shared        enum, DTO, JSON schema dùng chung
packages/game-config   roster 100 tướng, tỷ lệ vé / gacha / nâng cấp (basis points), validate, hàm roll
apps/api               Fastify + SQLite: migration, seed, hồi vé, gacha, ghép 2 thẻ, lịch sử, auth
apps/web               Vite + PixiJS: quay thẻ, bộ sưu tập, nâng cấp, lịch sử
```

## Điểm chính

- **Server quyết định mọi thứ**: RNG (`crypto.randomInt`), số vé, loại vé, tướng, level, kết quả ghép.
- **Hồi vé** theo mốc 5 phút UTC (`RECOVERY_INTERVAL_MS`, 288 vé/ngày); offline vẫn tích lũy đủ; xử lý theo batch, mỗi batch 1 transaction;
  unique index `(user_id, reference_id)` cho `time_recovery` chặn cấp trùng mốc. Không có trần tồn kho.
- **Gacha / nâng cấp** chạy trong `BEGIN IMMEDIATE` transaction, có idempotency key gắn với người dùng + thao tác.
  Retry trả lại kết quả cũ; dùng cùng key cho yêu cầu khác → 409.
- **Nút "+50 vé" thử nghiệm** ở thanh trên cùng: mỗi lần bấm cộng 50 vé, loại random. Chỉ bật khi server có
  `ENABLE_DEV_TOPUP=1` — `pnpm dev` bật sẵn, `pnpm start` thì tắt. Số vé chỉnh ở `DEV_TOPUP_TICKETS`.
- **Quay thẻ tối đa Lv.9** (`GACHA_MAX_LEVEL`): 72 / 15 / 7 / 3.5 / 2 / 0.4 / 0.07 / 0.02 / 0.01% cho Lv.1–9 (Lv.8–9 cực hiếm). Lv.10 chỉ có qua ghép.
- **Tỷ lệ ghép**: thành công 90% (Lv1) giảm đều 10% mỗi bậc tới 10% (Lv9); thất bại giữ nguyên 80% hoặc tụt đúng 1 bậc 20% (Lv2: 90/10, Lv1 luôn giữ).
- **Trang Nâng cấp** gom thẻ theo tướng (bản sao cùng tướng luôn liền nhau, chia nhóm theo level, đánh dấu nhóm đủ 2 thẻ).
  Logic gom/sắp xếp ở `apps/web/src/upgrade-groups.ts`, có test.
- **Tặng thẻ** (`GIFT_MAX_CARDS = 20`): nằm trong trang Bộ sưu tập (nút 🎁), dropdown người nhận sắp theo giao dịch gần nhất (`GET /api/users`), chuyển chủ thẻ nguyên tử, lịch sử ở cả người gửi lẫn người nhận (bảng `card_gifts`, migration v5).
- **Nâng cấp nhanh** (`QUICK_UPGRADE_MAX_LEVEL = 5`): một nút ghép liên tục mọi cặp thẻ ≤ Lv.5, level thấp trước, trong 1 transaction.
- **Quay ×10**: số lượt = min(10, số dư loại vé); tất cả lượt trong 1 transaction, mỗi lượt 1 dòng ledger + lịch sử,
  1 idempotency key cho cả thao tác. Lựa chọn số lần ở `DRAW_COUNT_OPTIONS` trong `rates.ts`.
- **Ghép 2 thẻ** (`UPGRADE_INPUT_COUNT`) cùng tướng + cùng level (1–9). Roll thành công trước; chỉ khi thất bại mới roll bảng phân phối thất bại.
  Snapshot tỷ lệ & phân phối lưu trong `upgrade_history`.
- Mọi thay đổi số dư vé đều có dòng ledger trong `ticket_transactions`.
- **Quà đăng ký** 100 vé cấp trong cùng transaction tạo tài khoản, ledger reason `signup_bonus`,
  unique index chặn cấp lần hai. Migration v2 dựng lại bảng ledger để thêm reason này, giữ nguyên dữ liệu cũ.
- Không có Vàng, nạp tiền, cửa hàng, daily login (schema chỉ cho phép `time_recovery`/`signup_bonus`/`gacha_draw`).

## Artwork

Hiện dùng placeholder (màu phe + chữ Hán của phe + chữ viết tắt tên). Mỗi tướng có `artKey` = ID ổn định;
thay ảnh thật bằng cách map `artKey` → file ảnh trong `apps/web/src/art.ts` và `apps/web/src/pixi/stage.ts`.

## API

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Tài khoản (Bearer token) |
| GET | `/api/me` | Người chơi + số dư vé + trạng thái hồi |
| GET | `/api/generals` | 100 tướng |
| GET | `/api/cards` | Bộ sưu tập (`faction`, `level`, `q`, `sort`, `page`, `pageSize`) |
| GET | `/api/tickets` | Số dư, tổng, mốc đã xử lý, thời gian đến mốc kế |
| POST | `/api/tickets/claim-recovery` | Xử lý các mốc hồi chưa xử lý |
| POST | `/api/tickets/dev-topup` | `{ idempotencyKey }` — +50 vé thử nghiệm (404 nếu `ENABLE_DEV_TOPUP` tắt) |
| GET | `/api/gacha/config` | Loại vé, pool, tỷ lệ level |
| POST | `/api/gacha/draw` | `{ ticketType, count?: 1 \| 10, idempotencyKey }` — quay ×10, còn ít hơn 10 vé thì quay hết |
| POST | `/api/upgrades/preview` | `{ cardIds: [a,b,c] }` |
| GET | `/api/users` | Danh sách người nhận (trừ mình), người giao dịch gần nhất lên đầu; `?q=` tìm theo tên |
| POST | `/api/gifts` | `{ toUsername, cardIds[], idempotencyKey }` — tặng 1–20 thẻ cho người chơi khác |
| POST | `/api/upgrades/quick` | `{ idempotencyKey }` — Nâng cấp nhanh: tự ghép dây chuyền mọi cặp thẻ ≤ Lv.5 |
| POST | `/api/upgrades/attempt` | `{ cardIds: [a,b,c], idempotencyKey }` |
| GET | `/api/history` | Lịch sử phân trang (`kind`, `page`, `pageSize`) |

Lỗi có dạng `{ "error": { "code": "...", "message": "..." } }`. Endpoint gacha / nâng cấp / auth có rate limit.
