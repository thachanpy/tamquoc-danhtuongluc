# Tam Quốc: Vô Song — bản demo MVP

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

Frontend viết bằng **SolidJS** + Vite (`vite-plugin-solid`); sân khấu mở thẻ/ghép thẻ (`pixi/stage.ts`) và sân đấu PvP (`pixi/arena.ts`) dựng bằng **PixiJS**. Cấu trúc: xem CLAUDE.md mục 2.

Database SQLite nằm ở `data/tamquoc.db` (đổi bằng biến `DB_PATH`). Khởi động không bao giờ reset dữ liệu.

> **Duyệt tài khoản** bật/tắt ở trang Quản trị → Người chơi (mặc định tắt: đăng ký là vào game ngay). Khi bật, tài khoản mới
> phải chờ quản trị viên duyệt mới đăng nhập được (màn đăng ký báo rõ). Khi được duyệt, tài khoản nhận
> **100 vé quà đăng ký** (loại vé random 20% mỗi loại). **Tài khoản đầu tiên** tạo trên database mới tự thành admin và được duyệt ngay.
> Sau đó hồi 1 vé ở mỗi mốc 1 phút theo đồng hồ server. Số vé quà chỉnh ở
> `SIGNUP_BONUS_TICKETS` trong `packages/game-config/src/rates.ts`.

## Triển khai lên server

Mô hình: **nginx** phục vụ frontend đã build (`apps/web/dist`) và chuyển `/api/*` sang **API Fastify** chạy ở `127.0.0.1:3000` bằng **pm2**. Database SQLite nằm ở `data/tamquoc.db` trong thư mục repo.

```
Trình duyệt ──80/443──> nginx ──/api/*──> pm2: tamquoc-api (127.0.0.1:3000) ──> SQLite data/tamquoc.db
                           └──── còn lại ──> apps/web/dist (file tĩnh)
```

File cấu hình ở gốc repo:

- `nginx.conf` — site nginx: phục vụ `apps/web/dist`, proxy `/api/`, gzip, cache ảnh/JS.
- `pm2.config.json` — chạy API (`apps/api/src/index.ts`) bằng Node, tự khởi động lại khi lỗi.

API tự nén response (`@fastify/compress`, br/gzip) nên payload lớn như nhật ký/chi tiết trận PvP gọn hơn nhiều cả khi không qua nginx (ví dụ chạy dev); gzip ở nginx chỉ là lớp bổ sung.

Ví dụ dưới đây dùng Ubuntu/Debian và đặt repo ở `/opt/tamquoc-gacha`.

### 1. Cài phần mềm (1 lần)

```bash
sudo apt update
sudo apt install -y nginx git curl
# Node.js 22 (cần >= 22.18: dùng node:sqlite và chạy thẳng TypeScript)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v                    # phải >= v22.18
sudo corepack enable       # pnpm đúng version trong package.json
sudo npm install -g pm2
```

### 2. Lấy code, cài dependency, build frontend

```bash
sudo mkdir -p /opt/tamquoc-gacha && sudo chown $USER:$USER /opt/tamquoc-gacha
git clone <repo-url> /opt/tamquoc-gacha     # hoặc rsync/scp code lên (bỏ node_modules, dist)
cd /opt/tamquoc-gacha
pnpm install --frozen-lockfile
pnpm test                  # tuỳ chọn
pnpm build                 # tạo apps/web/dist
mkdir -p data
# nginx (user www-data) cần đọc được thư mục dist
chmod o+x /opt/tamquoc-gacha /opt/tamquoc-gacha/apps /opt/tamquoc-gacha/apps/web
chmod -R o+rX /opt/tamquoc-gacha/apps/web/dist
```

### 3. Chạy API bằng pm2

```bash
cd /opt/tamquoc-gacha
pm2 start pm2.config.json          # chạy từ gốc repo
pm2 status                         # tamquoc-api phải "online"
curl -s http://127.0.0.1:3000/api/gacha/config | head -c 200   # phải ra JSON
pm2 save                           # lưu danh sách app
pm2 startup                        # in ra 1 lệnh sudo — chạy lệnh đó để pm2 tự bật khi reboot
```

Lệnh hay dùng: `pm2 logs tamquoc-api`, `pm2 restart tamquoc-api`, `pm2 stop tamquoc-api`.

Ghi chú:

- Giữ `instances: 1` (fork mode): SQLite chỉ có một tiến trình ghi và rate limit lưu trong bộ nhớ.
- Biến môi trường chỉnh trong `env` của `pm2.config.json`: `PORT`, `HOST`, `DB_PATH` (mặc định `data/tamquoc.db`), `LOG_LEVEL`, `TRUST_PROXY`, `ENABLE_GIFT` (tặng thẻ, mặc định tắt), `REDIS_URL` (cache, mặc định `redis://127.0.0.1:6379`; đặt `off` để tắt). (Bật/tắt duyệt tài khoản nằm ở trang Quản trị, không phải biến môi trường.) **Không** đặt `ENABLE_DEV_TOPUP` khi chạy thật. Sửa xong chạy `pm2 restart pm2.config.json --update-env`.
- Cache: mặc định bật Redis/Dragonfly ở `redis://127.0.0.1:6379` cho bảng xếp hạng, phiên đăng nhập, cài đặt game, bộ sưu tập/đội hình, nhiệm vụ, lịch sử, nhật ký trận PvP, đội hình đối thủ, chỉ số chiến đấu theo tướng và danh sách Quản trị. Đặt `REDIS_URL=off` để tắt hẳn; Redis chưa chạy hoặc lỗi kết nối thì API tự đọc thẳng SQLite như trước (cache hỏng không làm hỏng request). Xem chi tiết ở `CLAUDE.md` mục 7.11.
- Migration chạy tự động khi API khởi động, không bao giờ xoá dữ liệu.

### 4. Cấu hình nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/tamquoc
sudo nano /etc/nginx/sites-available/tamquoc     # sửa server_name (tên miền/IP) và root nếu repo không ở /opt/tamquoc-gacha
sudo ln -s /etc/nginx/sites-available/tamquoc /etc/nginx/sites-enabled/tamquoc
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Mở trình duyệt vào `http://tên-miền-hoặc-IP`.

### 5. HTTPS (khi có tên miền trỏ về server)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d game.example.com
```

Certbot tự thêm cấu hình 443, chuyển hướng 80 → 443 và tự gia hạn. Tường lửa: `sudo ufw allow 'Nginx Full'`; **không** mở cổng 3000.

### 6. Tài khoản admin đầu tiên

- Database mới: người **đăng ký đầu tiên** tự thành admin — đăng ký tài khoản của bạn ngay sau khi chạy.
- Tài khoản admin **chỉ quản trị, không chơi game** (không quay thẻ, không nhận vé/thẻ, không vào bảng xếp hạng). Muốn chơi thì đăng ký thêm một tài khoản người chơi riêng.
- Dùng lại database cũ: dừng API (`pm2 stop tamquoc-api`), copy file `.db` vào `data/tamquoc.db`, rồi `pm2 start tamquoc-api`. Tài khoản id nhỏ nhất là admin.
- Sau đó mọi đăng ký mới phải chờ admin duyệt ở tab **Quản trị**.

### Cập nhật phiên bản mới

```bash
cd /opt/tamquoc-gacha
git pull                         # hoặc rsync code mới
pnpm install --frozen-lockfile
pnpm build
chmod -R o+rX apps/web/dist
pm2 restart tamquoc-api
```

Không cần reload nginx khi chỉ cập nhật code.

### Sao lưu database

```bash
sudo apt install -y sqlite3
sqlite3 /opt/tamquoc-gacha/data/tamquoc.db ".backup '/opt/tamquoc-gacha/data/backup-$(date +%F).db'"
```

`.backup` an toàn khi API đang chạy (WAL). Có thể đặt cron chạy hằng ngày.

### Xử lý sự cố

| Triệu chứng | Kiểm tra |
|---|---|
| 502 Bad Gateway | API chưa chạy: `pm2 status`, `pm2 logs tamquoc-api --lines 100` |
| 403/404 ở trang chủ | Chưa `pnpm build`, sai `root` trong nginx, hoặc nginx không có quyền đọc (chmod ở bước 2) |
| pm2 báo lỗi ts-node / không chạy được `.ts` | Node < 22.18, hoặc thiếu `"interpreter": "node"` trong `pm2.config.json` |
| "Thao tác quá nhanh" với mọi người | Rate limit đang thấy mọi người cùng IP: kiểm tra nginx gửi `X-Forwarded-For`, `TRUST_PROXY` (mặc định tin 127.0.0.1) |

## Cấu trúc

```
packages/shared        enum, DTO, JSON schema dùng chung
packages/game-config   roster 100 tướng, tỷ lệ vé / gacha / nâng cấp (basis points), validate, hàm roll
apps/api               Fastify + SQLite: migration, seed, hồi vé, gacha, ghép 2 thẻ, lịch sử, auth
apps/web               Vite + SolidJS: quay thẻ, bộ sưu tập, nâng cấp, lịch sử
```

## Điểm chính

- **Server quyết định mọi thứ**: RNG (`crypto.randomInt`), số vé, loại vé, tướng, level, kết quả ghép.
- **Hồi vé** theo mốc 1 phút UTC (`RECOVERY_INTERVAL_MS`, 1440 vé/ngày); offline vẫn tích lũy đủ; xử lý theo batch, mỗi batch 1 transaction;
  unique index `(user_id, reference_id)` cho `time_recovery` chặn cấp trùng mốc. Vé hồi dừng ở trần: Vé thường 5000,
  mỗi vé phe 2000 (`RECOVERY_CAP_PER_TYPE`); nguồn khác (nhiệm vụ, giftcode, admin…) vẫn cộng vượt trần.
- **Gacha / nâng cấp** chạy trong `BEGIN IMMEDIATE` transaction, có idempotency key gắn với người dùng + thao tác.
  Retry trả lại kết quả cũ; dùng cùng key cho yêu cầu khác → 409.
- **Cộng vé thử nghiệm**: không còn nút trên UI; endpoint `/api/tickets/dev-topup` chỉ chạy khi server có
  `ENABLE_DEV_TOPUP=1` (mặc định tắt, kể cả `pnpm dev`). Cộng vé cho người chơi dùng trang Quản trị.
- **Quay thẻ tối đa Lv.9** (`GACHA_MAX_LEVEL`): 65.075 / 18 / 9 / 5.5 / 2 / 0.32 / 0.08 / 0.02 / 0.005% cho Lv.1–9 (Lv.6–9 cực hiếm). Lv.10 chỉ có qua ghép. Mỗi Tướng quay ra có 10% rớt kèm 1 Ngọc Ngũ Hành cùng cấp.
- **Tỷ lệ ghép**: thành công 90% (Lv1) giảm đều 10% mỗi bậc tới 10% (Lv9); thất bại giữ nguyên 80% hoặc tụt đúng 1 bậc 20% (Lv2: 90/10, Lv1 luôn giữ).
- **Trang Nâng cấp** gom thẻ theo tướng (bản sao cùng tướng luôn liền nhau, chia nhóm theo level, đánh dấu nhóm đủ 2 thẻ).
  Logic gom/sắp xếp ở `apps/web/src/upgrade-groups.ts`, có test.
- **Tặng thẻ** — **đang tạm tắt** (chủ dự án yêu cầu): API trả 404 `FEATURE_DISABLED`, UI ẩn nút. Bật lại bằng biến môi trường `ENABLE_GIFT=1`. Khi bật (`GIFT_MAX_CARDS = 20`): nằm trong trang Bộ sưu tập (nút 🎁), dropdown người nhận sắp theo giao dịch gần nhất (`GET /api/users`), chuyển chủ thẻ nguyên tử, lịch sử ở cả người gửi lẫn người nhận (bảng `card_gifts`, migration v5).
- **Nâng cấp nhanh** (`QUICK_UPGRADE_MAX_LEVEL = 5` là mức chọn sẵn mặc định): một nút ghép liên tục mọi cặp thẻ thuộc các level người chơi tick chọn (Lv.1–9; mặc định Lv.1–5), level thấp trước, trong 1 transaction.
- **Quay ×10**: số lượt = min(10, số dư loại vé); tất cả lượt trong 1 transaction, mỗi lượt 1 dòng ledger + lịch sử,
  1 idempotency key cho cả thao tác. Lựa chọn số lần ở `DRAW_COUNT_OPTIONS` trong `rates.ts`.
- **Ghép 2 thẻ** (`UPGRADE_INPUT_COUNT`) cùng tướng + cùng level (1–9). Roll thành công trước; chỉ khi thất bại mới roll bảng phân phối thất bại.
  Snapshot tỷ lệ & phân phối lưu trong `upgrade_history`.
- **Trang Quản trị** (tab chỉ admin thấy, `users.is_admin`): duyệt/từ chối đăng ký, danh sách người chơi (số vé, số thẻ),
  cộng vé cho người chơi (chọn loại + số lượng, tối đa `ADMIN_GRANT_MAX_TICKETS` mỗi lần, ledger `admin_grant`),
  cấp/thu quyền admin, xem mọi thẻ của mọi người chơi. Migration v6: tài khoản cũ coi như đã duyệt, tài khoản id nhỏ nhất thành admin.
- **Nhiệm vụ** (tab Nhiệm vụ): nhiệm vụ hằng ngày (chung + theo phe, reset 05:00 giờ Việt Nam), thưởng ngày mới 25 vé,
  điểm danh theo ngày trong tháng và thành tựu dài hạn; bấm Nhận (nhiệm vụ ngày quên nhận được tự nhận khi sang ngày).
- **Xếp hạng** (tab Xếp hạng): bảng xếp hạng Lực chiến = tổng điểm thẻ đang có, mỗi tướng + cấp tính 1 lần (Lv.n = 2^(n−1), Lv.10 = 512);
  top 10 nổi bật, cuộn tới top 100, luôn hiện hạng của mình; không tính tài khoản quản trị.
- **Giftcode** (tab Giftcode): người chơi nhập code nhận **vé quay** (chỉ vé, không tặng thẻ), mỗi code 1 lần/người,
  hạn sử dụng tuỳ chọn. Admin tạo/bật/tắt code ở tab Quản trị → Giftcode. Có sẵn 4 code tân thủ
  `THUCQUOC`, `NGUYQUOC`, `NGOQUOC`, `QUANQUOC` (200 vé mỗi phe, không hạn); người chơi mới thấy popup mời nhập.
- **Phiên đăng nhập** lưu trong SQLite (bảng `sessions`, chỉ lưu hash của token), không hết hạn; khởi động lại server không phải đăng nhập lại. Đăng xuất xoá phiên.
- Mọi thay đổi số dư vé đều có dòng ledger trong `ticket_transactions`.
- **Quà đăng ký** 100 vé cấp trong cùng transaction duyệt tài khoản, ledger reason `signup_bonus`,
  unique index chặn cấp lần hai. Migration v2 dựng lại bảng ledger để thêm reason này, giữ nguyên dữ liệu cũ.
- Không có Vàng, nạp tiền, cửa hàng (ledger chỉ cho phép `time_recovery`/`signup_bonus`/`dev_topup`/`admin_grant`/`giftcode`/`gacha_draw`/`daily_reset`/`mission`/`achievement`).

## Artwork

Hiện dùng placeholder (màu phe + chữ Hán của phe + chữ viết tắt tên). Mỗi tướng có `artKey` = ID ổn định;
thay ảnh thật bằng cách map `artKey` → file ảnh trong `apps/web/src/art.ts`.

## API

| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Tài khoản (Bearer token). Đăng ký trả `status: pending`; đăng nhập khi chờ duyệt → 403 `ACCOUNT_PENDING` |
| GET | `/api/me` | Người chơi + số dư vé + trạng thái hồi |
| GET | `/api/generals` | 100 tướng |
| GET | `/api/cards` | Bộ sưu tập (`faction`, `level`, `q`, `sort`, `page`, `pageSize` ≤ 500) |
| GET | `/api/cards/all` | Toàn bộ thẻ đang sở hữu trong 1 request (`{ items }`) — client dùng thay vì lặp từng trang |
| GET | `/api/tickets` | Số dư, tổng, mốc đã xử lý, thời gian đến mốc kế |
| POST | `/api/tickets/claim-recovery` | Xử lý các mốc hồi chưa xử lý |
| POST | `/api/tickets/dev-topup` | `{ idempotencyKey }` — +50 vé thử nghiệm (404 nếu `ENABLE_DEV_TOPUP` tắt) |
| GET | `/api/gacha/config` | Loại vé, pool, tỷ lệ level |
| POST | `/api/gacha/draw` | `{ ticketType, count?: 1 \| 10, idempotencyKey }` — quay ×10, còn ít hơn 10 vé thì quay hết |
| POST | `/api/upgrades/preview` | `{ cardIds: [a,b,c] }` |
| GET | `/api/users` | Danh sách người nhận (trừ mình, admin), người giao dịch gần nhất lên đầu; `?q=` tìm theo tên (404 nếu `ENABLE_GIFT` tắt) |
| POST | `/api/gifts` | `{ toUsername, cardIds[], idempotencyKey }` — tặng 1–20 thẻ cho người chơi khác (404 nếu `ENABLE_GIFT` tắt) |
| POST | `/api/upgrades/quick` | `{ idempotencyKey, levels?: number[] }` — Nâng cấp nhanh: tự ghép dây chuyền mọi cặp thẻ thuộc các level đã chọn (mặc định Lv.1–5) |
| POST | `/api/upgrades/attempt` | `{ cardIds: [a,b,c], idempotencyKey }` |
| GET | `/api/history` | Lịch sử phân trang (`kind`, `page`, `pageSize`) |
| GET | `/api/admin/users` | (admin) Người chơi: `q`, `status=pending\|approved`, phân trang; chờ duyệt lên đầu |
| POST | `/api/admin/users/:id/approve` · `/reject` | (admin) Duyệt (cấp quà đăng ký) / từ chối (xoá đăng ký chờ duyệt) |
| GET/POST | `/api/admin/settings` | (admin) `{ requireApproval }` — bật/tắt duyệt tài khoản đăng ký |
| POST | `/api/admin/users/:id/admin` | (admin) `{ isAdmin }` — cấp/thu quyền admin (không tự thu của mình) |
| POST | `/api/admin/tickets/grant` | (admin) `{ userId, ticketType, amount, idempotencyKey }` — cộng vé |
| GET | `/api/quests` | Nhiệm vụ ngày, điểm danh, thành tựu (tiến trình + trạng thái) |
| POST | `/api/quests/claim` | `{ keys? }` — nhận thưởng (bỏ trống = nhận tất cả) |
| GET | `/api/leaderboard` | Bảng xếp hạng Lực chiến (top 100 + hạng của mình) |
| GET | `/api/giftcodes` | Code gợi ý (+ đã nhập chưa) và các code mình đã nhập |
| POST | `/api/giftcodes/redeem` | `{ code }` — nhập giftcode, nhận vé quay |
| GET/POST | `/api/admin/giftcodes` | (admin) Danh sách / tạo giftcode `{ code, rewards: [{pool,count}], expiresAt?, featured? }` (chỉ vé quay) |
| POST | `/api/admin/giftcodes/:id/active` | (admin) `{ isActive }` — bật/tắt giftcode |
| GET | `/api/admin/cards` | (admin) Mọi thẻ của mọi người chơi: `userId`, `faction`, `level`, `q`, `sort`, phân trang |

Lỗi có dạng `{ "error": { "code": "...", "message": "..." } }`. Endpoint gacha / nâng cấp / auth có rate limit.
