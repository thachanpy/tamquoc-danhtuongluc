# CLAUDE.md — Tam Quốc: Danh Tướng Lục

Tên game hiển thị: **Tam Quốc: Danh Tướng Lục** (tiêu đề trang, thanh trên, trang đăng nhập). Tên package/thư mục kỹ thuật vẫn là `tamquoc-gacha`.

Icon game (chủ dự án cung cấp: chân dung Gia Cát Lượng trong khung vàng bo góc): `apps/web/public/favicon.ico`, `apps/web/public/icons/icon-32|192|512.png` (nền trong suốt ở góc bo), `apps/web/public/icons/apple-touch-icon.png` (180×180, full-bleed), khai báo trong `apps/web/index.html` và `apps/web/public/manifest.webmanifest`. Icon này cũng là logo cạnh tên game ở thanh trên và trang đăng nhập (thay con dấu 三國).

## 1. Mục tiêu dự án

Xây dựng game web gacha thu thập thẻ tướng Tam Quốc. Trọng tâm:

- Sưu tầm tướng.
- Quay thẻ bằng vé miễn phí.
- Nâng cấp thẻ bằng cách ghép 2 thẻ cùng level.
- Quản lý bộ sưu tập.
- Tặng thẻ cho người chơi khác (tối đa 20 thẻ mỗi lần) — **đang tạm tắt** (mục 5.6).
- Trang quản trị: duyệt tài khoản đăng ký, danh sách người chơi, cộng vé, xem mọi thẻ, tạo giftcode (mục 3.8).
- Giftcode tặng vé quay (mục 3.9).
- Nhiệm vụ hằng ngày, thưởng reset 05:00, điểm danh theo tháng và thành tựu — chỉ thưởng vé (mục 3.10).
- Bảng xếp hạng Lực chiến (mục 6.6).
- Hồ sơ người chơi: đổi ảnh đại diện, tên hiển thị và mật khẩu (mục 3.11).
- Đấu trường PvP: dàn đội 6 tướng rồi khiêu chiến người chơi khác (chọn từ bảng xếp hạng), server mô phỏng trọn trận và trả dữ liệu để client phát lại; không thưởng, chỉ thắng/thua (mục 6.7).
- Hiệu ứng hình ảnh và trải nghiệm mở thẻ.

Ngoài Đấu trường PvP (mục 6.7), không có gameplay chiến thuật nào khác trong MVP.

Claude Code phải đọc file này trước khi sửa code. Trước khi triển khai, hãy kiểm tra repository, cấu trúc, package manager, scripts và quy ước hiện có. Ưu tiên tái sử dụng cấu trúc hiện tại, không viết lại toàn bộ dự án nếu không cần thiết.

Các nguyên tắc bắt buộc:

- Backend là nguồn dữ liệu có thẩm quyền đối với vé, quyền sở hữu thẻ, tỷ lệ và kết quả ngẫu nhiên.
- Không có tính năng nạp tiền, thanh toán thật, mua vé bằng Vàng hoặc trừ Vàng để quay trong MVP.
- Vé miễn phí được cấp tự động theo thời gian, cộng 100 vé quà đăng ký một lần cho tài khoản mới (cấp lúc được admin duyệt).
- Duyệt tài khoản (mục 3.8) bật/tắt **trên trang Quản trị** (cài đặt lưu ở server, bảng `app_settings`); mặc định tắt: đăng ký là được duyệt ngay.
- Không còn nút "+50 vé" trên UI (chủ dự án yêu cầu bỏ); endpoint cộng vé thử nghiệm chỉ còn ở server, mặc định tắt (mục 3.7). Cộng vé cho người chơi dùng trang Quản trị.
- Có nhiệm vụ hằng ngày (gồm nhiệm vụ đăng nhập), thưởng reset 05:00 giờ Việt Nam, điểm danh theo tháng và thành tựu (mục 3.10, chủ dự án yêu cầu; trước đây MVP không có thưởng đăng nhập). Chỉ thưởng vé.
- Vé được chia thành 5 loại (thường, Thục, Ngụy, Ngô, Quần) và được xác định ngẫu nhiên khi cấp.
- **Trần vé hồi theo loại: Vé thường 1000, mỗi loại vé phe 500** (`RECOVERY_CAP_PER_TYPE`, chủ dự án yêu cầu): chỉ chặn vé hồi theo thời gian; vé từ nguồn khác vẫn cộng vượt trần (VD 510/500 vé phe) và được giữ nguyên (mục 3.6). Ngoài ra không giới hạn số vé tích trữ.
- Mỗi lần nâng cấp cần đúng 2 thẻ cùng level và cùng tướng; không có thẻ chính hoặc thẻ mồi.
- Mọi thao tác thay đổi nhiều dữ liệu liên quan phải nguyên tử.
- Các quy tắc game và tỷ lệ phải cấu hình được, có kiểm thử.
- Không tự ý thay đổi quy tắc sản phẩm đã được chủ dự án duyệt.
- Không thêm tính năng ngoài phạm vi nếu chưa được yêu cầu.
- Không tuyên bố đã chạy test, lint hoặc build nếu chưa thực sự chạy.

## 2. Công nghệ và cấu trúc

Công nghệ mục tiêu:

- Monorepo TypeScript.
- Frontend: **SolidJS** cho toàn bộ UI; riêng sân khấu mở thẻ/nâng cấp và sân đấu PvP dùng **PixiJS** (engine đồ hoạ ngoài) vì hiệu ứng SolidJS + CSS không đạt yêu cầu trực quan.
- Backend: Fastify REST API.
- Database: SQLite.
- Shared package: types, schema validation, DTO và enum dùng chung.
- Game config package: roster 100 tướng, loại vé, tỷ lệ gacha, tỷ lệ nâng cấp và cấu hình game.
- pnpm workspace nếu repository chưa có package manager hoặc cấu trúc tương đương.

Cấu trúc gợi ý:

- `apps/web`: frontend, UI và hiệu ứng (SolidJS + CSS).
- `apps/api`: Fastify, authentication, game logic và persistence.
- `packages/shared`: types, schemas, DTO và constants.
- `packages/game-config`: roster 100 tướng và các cấu hình game.
- Triển khai server (hướng dẫn ở `README.md`, mục "Triển khai lên server"): `nginx.conf` ở gốc repo (phục vụ `apps/web/dist`, proxy `/api/` sang `127.0.0.1:3000`), `pm2.config.json` ở gốc repo (chạy API `apps/api/src/index.ts` bằng `node`, fork 1 instance). API đặt `trustProxy` (biến `TRUST_PROXY`, mặc định tin 127.0.0.1) để rate limit theo IP thật sau nginx.

Cấu trúc frontend (SolidJS, `apps/web/src`):

- `main.tsx`: nạp CSS, tia lửa nền, nhạc, `render(<App/>)`. `App.tsx`: đăng nhập/đăng ký, khung game (thanh trên, thanh vé + đồng hồ hồi vé, tab, router theo hash `#id`), popup giftcode lần đầu, toast sự kiện ngày mới.
- `pages/*.tsx`: mỗi tab một component (`CollectionPage`, `DrawPage`, `UpgradePage`, `QuestsPage`, `LeaderboardPage`, `PvpPage`, `HistoryPage`, `GiftCodePage`, `ProfilePage`, `AdminPage`); router mount/unmount bằng `<Dynamic>`, rời trang thì component bị dispose (timer/listener dọn trong `onCleanup`).
- `state.ts`: dữ liệu nạp lúc vào game (object `state`) + signal `tickets()` (số dư vé), `profile()` (tên hiển thị + ảnh đại diện), `questBadge`/`pendingBadge`; `badges.ts` tải lại badge; `ui.ts` toast.
- `components/Card.tsx` (thẻ tướng DOM, dùng chung mọi trang), `components/Avatar.tsx` (ảnh đại diện, dùng ở thanh trên + trang Hồ sơ), `components/MusicControl.tsx`, `components/CombatDetail.tsx` (bảng chi tiết chiến đấu của tướng) + `components/CombatDetailModal.tsx` (modal chi tiết dùng chung cho popup ngắm thẻ và Đấu trường), `viewer.tsx` (popup ngắm thẻ, `openCardViewer`).
- `pixi/stage.ts` (sân khấu mở thẻ / ghép thẻ: PixiJS, `playReveal`/`playRevealMany`/`playUpgrade` gọi từ trang), `pixi/arena.ts` (sân đấu PvP: PixiJS, `createArena` dựng 12 ô tướng + thanh máu + số sát thương/hồi máu bay lên + vòng choáng; trang `Pvp.tsx` chỉ đẩy trạng thái qua `sync()`/`float()`), `art.ts` (màu phe, bậc khung, `FRAME_LAYOUT`, URL ảnh), `upgrade-groups.ts` (gom thẻ, có test), `api.ts` giữ dạng TypeScript thường.
- Không dùng innerHTML cho dữ liệu: JSX tự escape. Class CSS/markup giữ như bản cũ nên `style.css`/`theme.css` không đổi.
- Build cần `vite-plugin-solid`; tsconfig `jsx: preserve`, `jsxImportSource: solid-js`.

Nếu repository đã có cấu trúc hợp lý, hãy giữ cấu trúc hiện tại và điều chỉnh theo thực tế.

Quy ước:

- Frontend không truy cập SQLite trực tiếp.
- Không đặt business logic quan trọng trong UI component.
- Không tin dữ liệu client gửi lên về số vé, xác suất, level kết quả hoặc quyền sở hữu thẻ.
- Không abstraction quá mức cho MVP.
- Ưu tiên code rõ ràng, dễ đọc, dễ kiểm thử và dễ thay thế artwork.

## 3. Quy tắc sản phẩm

### 3.1. Các phe và danh mục tướng

Game có chính xác 100 tướng, chia đều thành 4 phe, mỗi phe 25 tướng (trước đây 80 tướng / 20 mỗi phe; chủ dự án đã mở rộng roster, bỏ Chu Trị khỏi phe Ngô và thay Thư Thụ bằng Mạnh Hoạch ở phe Quần):

- Ngụy (`wei`): 25 tướng.
- Thục (`shu`): 25 tướng.
- Ngô (`wu`): 25 tướng.
- Quần (`qun`): 25 tướng.

#### Phe Ngụy — `wei`

1. Tào Tháo
2. Tào Phi
3. Tào Nhân
4. Tào Hồng
5. Tào Chân
6. Hạ Hầu Đôn
7. Hạ Hầu Uyên
8. Trương Liêu
9. Nhạc Tiến
10. Vu Cấm
11. Trương Cáp
12. Từ Hoảng
13. Điển Vi
14. Hứa Chử
15. Quách Gia
16. Tuân Úc
17. Tuân Du
18. Giả Hủ
19. Tư Mã Ý
20. Bàng Đức
21. Chân Cơ
22. Biện Ngọc Nhi
23. Tào Hoa
24. Tào Tiết
25. Tân Hiến Anh

#### Phe Thục — `shu`

1. Lưu Bị
2. Quan Vũ
3. Trương Phi
4. Gia Cát Lượng
5. Triệu Vân
6. Mã Siêu
7. Hoàng Trung
8. Ngụy Diên
9. Khương Duy
10. Bàng Thống
11. Pháp Chính
12. Từ Thứ
13. Hoàng Nguyệt Anh
14. Quan Bình
15. Quan Hưng
16. Mã Đại
17. Vương Bình
18. Liêu Hóa
19. Giản Ung
20. Mi Trúc
21. Quan Ngân Bình
22. Mi Trinh
23. Gia Cát Quả
24. Bao Tam Nương
25. Ngô Ý

#### Phe Ngô — `wu`

1. Tôn Kiên
2. Tôn Sách
3. Tôn Quyền
4. Chu Du
5. Lục Tốn
6. Lữ Mông
7. Hoàng Cái
8. Trình Phổ
9. Hàn Đương
10. Thái Sử Từ
11. Cam Ninh
12. Lăng Thống
13. Chu Thái
14. Từ Thịnh
15. Đinh Phụng
16. Chu Hoàn
17. Trương Chiêu
18. Trương Hoành
19. Lỗ Túc
20. Tôn Thượng Hương
21. Đại Kiều
22. Tiểu Kiều
23. Bộ Luyện Sư
24. Tôn Lỗ Dục
25. Tôn Lỗ Ban

#### Phe Quần — `qun`

1. Đổng Trác
2. Lữ Bố
3. Điêu Thuyền
4. Viên Thiệu
5. Viên Thuật
6. Công Tôn Toản
7. Trương Giác
8. Trương Bảo
9. Trương Lương
10. Hoa Hùng
11. Cao Thuận
12. Trần Cung
13. Nhan Lương
14. Văn Sú
15. Điền Phong
16. Mạnh Hoạch
17. Mã Đằng
18. Hàn Toại
19. Đào Khiêm
20. Trương Lỗ
21. Thái Văn Cơ
22. Trâu Ngọc
23. Chúc Dung
24. Đổng Bạch
25. Trương Xuân Hoa

#### Quy tắc dữ liệu tướng

- Đây là roster chính thức của MVP.
- Không tự ý thêm, xóa hoặc chuyển phe tướng nếu chưa được chủ dự án yêu cầu.
- Mỗi tướng có ID ổn định, tên hiển thị, phe và `artKey`; có thể có mô tả ngắn và metadata bổ sung.
- ID không phụ thuộc tên hiển thị. Ưu tiên slug ASCII ổn định, ví dụ `cao-cao`, `liu-bei`, `sun-quan`, `lu-bu`.
- Phe sử dụng enum thống nhất: `wei`, `shu`, `wu`, `qun`.
- Không dùng tên hiển thị làm khóa chính.
- Roster được khai báo trong package cấu hình game và seed vào bảng `generals`.
- Seed phải chạy lặp an toàn, không tạo tướng trùng và không ghi đè dữ liệu người chơi.
- Vé thường quay trong toàn bộ 100 tướng.
- Vé Thục, Ngụy, Ngô và Quần chỉ quay trong 25 tướng của phe tương ứng.
- Trong pool hợp lệ, xác suất chọn mỗi tướng bằng nhau.
- Level thẻ được roll độc lập theo cấu hình gacha.
- Nếu chưa có artwork chính thức, dùng placeholder nhất quán, có thể thay thế sau.
- Giữ nguyên ID của tướng hiện có khi chỉnh sửa metadata để không phá vỡ dữ liệu thẻ và lịch sử gacha.

### 3.2. Cấp thẻ

- Level từ 1 đến 10.
- Mỗi bản thẻ người chơi sở hữu có level riêng.
- Người chơi có thể sở hữu nhiều bản thẻ của cùng một tướng, mỗi bản có level riêng.
- Thẻ không có chỉ số chiến đấu riêng; level là cơ sở tính Lực chiến (mục 6.6) và sức mạnh khi vào trận (Đấu trường PvP, mục 6.7).
- Level 10 là tối đa và không thể nâng cấp thành level cao hơn.
- Quay thẻ ra level 1–9; level 10 chỉ có qua ghép thẻ.

### 3.3. Kinh tế game

MVP không có hệ thống Vàng và không có giao dịch tiền tệ.

Không triển khai:

- Nạp Vàng.
- Thanh toán thật.
- Mua vé bằng Vàng.
- Trừ Vàng để quay.
- Cửa hàng bán vé.
- Dev top-up dạng nạp tiền/Vàng. (Ngoại lệ đã được chủ dự án duyệt: nút cộng vé thử nghiệm miễn phí tại mục 3.7, bật/tắt bằng cấu hình server.)
- Ví tiền tệ trong game nếu không có tính năng nào cần đến.

Không tạo endpoint hoặc UI giả lập nạp tiền. Nếu tương lai cần bổ sung kinh tế game, phải được yêu cầu và cập nhật đặc tả riêng.

### 3.4. Các loại vé

Game có đúng 5 loại vé:

| Loại vé | ID | Pool tướng |
|---|---|---|
| Vé thường | `normal` | Toàn bộ 100 tướng |
| Vé Thục | `shu` | 25 tướng Thục |
| Vé Ngụy | `wei` | 25 tướng Ngụy |
| Vé Ngô | `wu` | 25 tướng Ngô |
| Vé Quần | `qun` | 25 tướng Quần |

Quy tắc:

- Tất cả vé đều miễn phí.
- Có vé Quần (`qun`), quay trong 25 tướng Quần. (Trước đây MVP không có vé Quần; chủ dự án đã yêu cầu bổ sung.)
- Không có hệ thống mua vé.
- Mỗi vé chỉ sử dụng một lần.
- Vé thường không bị giới hạn theo phe.
- Vé phe chỉ sử dụng trong pool của phe tương ứng.
- Vé không tự chuyển đổi thành loại khác.
- Vé không thể quy đổi thành tiền hoặc tài nguyên khác.
- Mỗi loại vé có số dư riêng.
- UI hiển thị số lượng từng loại vé và tổng số vé.
- Vé **hồi theo thời gian** dừng khi loại vé đó đạt trần: **Vé thường 1000, mỗi loại vé phe 500** (`RECOVERY_CAP_PER_TYPE`, mục 3.6). Đây là trần duy nhất: các nguồn khác (quà đăng ký, giftcode, admin, nhiệm vụ, thành tựu, thưởng 05:00, cộng vé thử nghiệm) vẫn cộng vượt trần, số dư vượt trần được giữ nguyên, không bị cắt.
- Ngoài trần vé hồi, số lượng vé không bị giới hạn bởi mức trần nghiệp vụ nào khác.
- Backend vẫn phải chống số âm, integer overflow, dữ liệu sai và thao tác cộng vé trùng.

### 3.5. Cấp vé ngẫu nhiên

Mỗi lần người chơi được cấp một vé miễn phí, server chọn ngẫu nhiên một trong năm loại vé:

- Vé thường.
- Vé Thục.
- Vé Ngụy.
- Vé Ngô.
- Vé Quần.

Mặc định, xác suất cấp từng loại bằng nhau:

| Loại vé | Xác suất |
|---|---:|
| Vé thường | 20% |
| Vé Thục | 20% |
| Vé Ngụy | 20% |
| Vé Ngô | 20% |
| Vé Quần | 20% |
| **Tổng** | **100%** |

Quy tắc:

- Đây là xác suất loại vé được cấp, không phải xác suất chọn tướng hoặc level thẻ.
- Xác suất loại vé phải nằm trong cấu hình server.
- Tổng xác suất phải bằng 100%.
- Không có cơ chế bảo đảm cân bằng số lượng từng loại.
- Không tự động đổi vé phe thành vé thường khi số lượng một loại cao hoặc thấp.
- Không dùng RNG phía client.
- Việc roll loại vé và ghi nhận vé phải nằm trong cùng transaction với sự kiện cấp vé.
- Kết quả loại vé phải được ghi nhận để lịch sử có thể giải thích chính xác loại vé đã nhận.
- Khi retry cùng một sự kiện cấp vé, không roll và cấp thêm một vé khác.
- Có thể thay đổi tỷ lệ trong tương lai qua cấu hình, không cần sửa business logic.

### 3.6. Vé hồi theo thời gian

**Cứ đến mỗi mốc 5 phút của đồng hồ server, người chơi được cấp 1 vé miễn phí ngẫu nhiên** (288 vé/ngày). Chu kỳ nằm trong cấu hình server (`RECOVERY_INTERVAL_MS`). Trước đây là 10 phút; chủ dự án đã đổi thành 5 phút. Các mốc 10 phút đã xử lý trước đó vẫn là mốc 5 phút hợp lệ, nên không cần migration và không mất hoặc cấp trùng vé.

Các mốc trong mỗi giờ:

- Phút 00, 05, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55.

Ví dụ: 14:00, 14:05, 14:10, …, 14:55 theo thời gian server.

Quy tắc:

- Mốc hồi dựa trên đồng hồ server, không dựa trên đồng hồ client.
- Không tính chu kỳ riêng từ thời điểm đăng nhập.
- Người chơi offline vẫn tích lũy vé theo các mốc hợp lệ đã qua.
- Khi người chơi quay lại, server xác định các mốc hợp lệ chưa xử lý kể từ trạng thái đã ghi nhận gần nhất.
- Mỗi mốc hợp lệ tạo ra tối đa 1 vé ngẫu nhiên.
- Loại vé được roll độc lập cho từng mốc, theo bảng xác suất tại mục 3.5.
- **Trần vé hồi theo loại** (`RECOVERY_CAP_PER_TYPE`, chủ dự án yêu cầu): **Vé thường 1000**; Vé Thục/Ngụy/Ngô/Quần **mỗi loại 500**.
  - Mỗi mốc chỉ random trong các loại vé có số dư **dưới trần của loại đó** (giữ tỷ lệ tương đối của mục 3.5 giữa các loại còn chỗ).
  - Cả 5 loại đều đạt trần thì mốc đó vẫn được đánh dấu đã xử lý nhưng **không cấp vé**, không ghi ledger và **không cộng bù** sau này (response `skippedFull`).
  - Trần chỉ áp dụng cho vé hồi. Vé từ nguồn khác cộng vượt trần vẫn được giữ (VD nhiệm vụ đưa Vé Thục lên 510 thì giữ 510, Vé thường lên 1010 thì giữ 1010; vé hồi không cấp thêm loại đó cho tới khi xuống dưới trần).
- Khi người chơi offline trong thời gian dài, server xử lý đủ mọi mốc chưa xử lý (theo batch), cấp vé cho tới khi chạm trần như trên.
- Không cấp trùng vé cho cùng một mốc.
- Không bỏ mất các mốc đã đến hạn chỉ vì request bị retry hoặc server khởi động lại.
- Server phải lưu trạng thái đủ để xác định các mốc đã xử lý.
- Tính toán số mốc và ghi nhận vé phải an toàn khi nhiều request đồng thời.
- Mỗi mốc được xử lý phải ghi rõ loại vé đã được cấp.
- Client chỉ hiển thị số dư và đồng hồ đếm ngược đến mốc tiếp theo.
- Client không quyết định hoặc ghi nhận vé.

Nên lưu timestamp UTC và chuẩn hóa mốc hồi theo các ranh giới 5 phút. Không phụ thuộc múi giờ của máy người chơi.

Ví dụ:

- Người chơi đã xử lý mốc 10:00.
- Người chơi offline đến 10:30.
- Khi quay lại, server xử lý các mốc 10:05, 10:10, 10:15, 10:20, 10:25 và 10:30.
- Server cấp đúng 6 vé, từng vé được random loại độc lập.
- Refresh hoặc gửi lại request không được cấp thêm vé cho các mốc này.

Nếu cần xử lý lượng mốc rất lớn sau thời gian offline dài, có thể chia thành các batch nội bộ, nhưng phải bảo đảm tiến trình có thể tiếp tục an toàn mà không bỏ sót hoặc cấp trùng mốc. Trần duy nhất là trần vé hồi (Vé thường 1000, mỗi loại vé phe 500) ở trên.

### 3.7. Nguồn vé trong MVP

MVP có các nguồn cấp vé sau:

1. **Hồi vé theo mốc 5 phút** (mục 3.6).
2. **Quà đăng ký (tân thủ)**: khi tài khoản được admin duyệt, người chơi nhận **100 vé** một lần duy nhất.
3. **Cộng vé thử nghiệm** (endpoint server, **không còn nút trên UI** — chủ dự án đã yêu cầu bỏ nút "+50 vé"): mỗi lần gọi cộng **50 vé**, chỉ hoạt động khi server bật cấu hình (xem bên dưới).
4. **Admin cộng vé** (chủ dự án yêu cầu): admin chọn người chơi, loại vé và số lượng tại trang Quản trị (mục 3.8).
5. **Giftcode** (chủ dự án yêu cầu): giftcode có dòng phần thưởng vé cộng đúng loại + số lượng đã cấu hình, mỗi người chơi 1 lần (mục 3.9). Ledger reason `giftcode`.
6. **Thưởng reset 05:00** (mục 3.10): 5 vé mỗi loại khi vào game lần đầu trong ngày game. Ledger reason `daily_reset`.
7. **Nhiệm vụ hằng ngày** (chung + theo phe, mục 3.10). Ledger reason `mission`.
8. **Điểm danh theo tháng và thành tựu** (mục 3.10). Ledger reason `achievement`.

Quy tắc quà đăng ký:

- Số vé nằm trong cấu hình server (`SIGNUP_BONUS_TICKETS`, mặc định 100).
- Mỗi vé được roll loại độc lập theo bảng xác suất tại mục 3.5, bằng RNG server.
- Cấp trong cùng transaction **duyệt tài khoản** (tài khoản đầu tiên tự duyệt: cấp trong transaction tạo tài khoản); nếu thao tác thất bại thì không cấp vé.
- Tài khoản chờ duyệt chưa có số dư vé; mốc hồi vé bắt đầu tính từ mốc 5 phút gần nhất đã qua tại lúc duyệt.
- Ghi ledger với reason `signup_bonus`, mỗi loại vé một dòng (`amount_delta` = số vé loại đó).
- Mỗi người chơi chỉ nhận một lần; đăng nhập lại hoặc duyệt lại không cấp thêm. Unique constraint chặn cấp lần hai.
- Chỉ áp dụng cho tài khoản tạo mới, không cấp hồi tố cho tài khoản đã tồn tại.
- Quà đăng ký là quà một lần, tách biệt với nhiệm vụ/điểm danh (mục 3.10).

Quy tắc nút cộng vé thử nghiệm (dành cho giai đoạn mới chơi/playtest):

- Bật/tắt bằng biến môi trường server `ENABLE_DEV_TOPUP` (`1`/`true`). Mặc định **tắt**, kể cả `pnpm dev` và `pnpm start`. Phải tắt khi chạy thật.
- Khi tắt: endpoint trả 404 `FEATURE_DISABLED`. UI không có nút này dù cờ bật hay tắt.
- Số vé mỗi lần bấm nằm trong cấu hình server (`DEV_TOPUP_TICKETS`, mặc định 50). Client không gửi được số vé hay loại vé.
- Mỗi vé được roll loại độc lập theo bảng xác suất mục 3.5, bằng RNG server.
- Không giới hạn số lần bấm.
- Mỗi lần bấm có một idempotency key; retry trả kết quả cũ, không cộng thêm.
- Cấp vé và ghi ledger trong một transaction. Ledger reason `dev_topup`, mỗi loại vé một dòng.
- Miễn phí; không liên quan Vàng, thanh toán hay cửa hàng.

Quy tắc admin cộng vé:

- Chỉ admin (mục 3.8); server kiểm tra quyền. Chỉ cộng cho tài khoản đã duyệt (`NOT_APPROVED`) và không phải admin (409 `TARGET_IS_ADMIN`; trang Quản trị ẩn nút Cộng vé ở dòng admin).
- Admin chọn loại vé (1 trong 5 loại) và số lượng nguyên 1–`ADMIN_GRANT_MAX_TICKETS` (cấu hình game, mặc định 10.000) mỗi lần. Đây là trần mỗi thao tác chống nhập nhầm, không phải trần tồn kho. Không có thao tác trừ vé.
- Cộng số dư và ghi ledger trong một transaction. Ledger reason `admin_grant`, `reference_id = admin:{adminId}:{key}`, unique index chặn ghi trùng.
- Idempotency key gắn với admin; retry trả kết quả cũ; cùng key với yêu cầu khác → 409.
- Người chơi thấy trong Lịch sử: "Quản trị viên tặng: nhận Vé X ×N".

Các quy tắc khác:

- Thưởng đăng nhập chỉ có dưới dạng nhiệm vụ "Đăng nhập mỗi ngày" và điểm danh theo tháng (mục 3.10); không có endpoint `daily-claim` riêng.
- Không có phần thưởng Vàng.
- Không có hệ thống mua hoặc đổi vé.
- Nếu sau này bổ sung nguồn vé khác, phải được chủ dự án yêu cầu và cập nhật đặc tả.

### 3.8. Duyệt tài khoản và trang Quản trị

Do chủ dự án yêu cầu.

Duyệt tài khoản:

- **Bật/tắt trên trang Quản trị** (chủ dự án yêu cầu; trước đây là biến môi trường `REQUIRE_APPROVAL`, đã bỏ): cài đặt `require_approval` trong bảng `app_settings` (migration v10), mặc định **tắt**. Áp dụng cho các lượt đăng ký sau khi đổi; tài khoản đang chờ duyệt vẫn chờ (admin duyệt tay) khi tắt. Khi tắt, đăng ký tạo tài khoản `approved` ngay, trả token và cấp quà đăng ký trong cùng transaction tạo tài khoản; tài khoản mới không phải admin (trừ tài khoản đầu tiên). Các quy tắc dưới đây áp dụng khi bật.
- Đăng ký tạo tài khoản trạng thái `pending`: chưa có token, chưa có vé, chưa đăng nhập được. Màn đăng ký hiển thị "Đăng ký thành công! Tài khoản đang chờ quản trị viên duyệt…".
- Đăng nhập tài khoản `pending` (đúng mật khẩu) → 403 `ACCOUNT_PENDING`, UI báo đang chờ duyệt. Sai mật khẩu vẫn là `INVALID_CREDENTIALS`.
- Session của tài khoản chưa duyệt không được chấp nhận.
- Admin **Duyệt**: `pending → approved`, tạo số dư 5 loại vé, trạng thái hồi vé và cấp quà đăng ký trong một transaction. Duyệt lại → 409 `ALREADY_APPROVED`.
- Admin **Từ chối**: xoá tài khoản đang chờ duyệt (chưa có dữ liệu game), tên đăng nhập được giải phóng. Không từ chối được tài khoản đã duyệt (`NOT_PENDING`).
- Tài khoản chờ duyệt không xuất hiện trong danh sách người nhận và không nhận được thẻ tặng.
- **Tài khoản đầu tiên** trên database rỗng tự thành admin và được duyệt ngay (có token, nhận quà đăng ký).
- Migration v6: mọi tài khoản đã có được coi là đã duyệt (`approved_at = created_at`); tài khoản có id nhỏ nhất thành admin.

Quyền admin:

- Cột `users.is_admin`. Mọi route `/api/admin/*` kiểm tra ở server (chưa đăng nhập 401, không phải admin 403 `FORBIDDEN`).
- Admin cấp/thu quyền admin cho người chơi đã duyệt; không tự thu quyền của chính mình (`ADMIN_SELF`), nên luôn còn ít nhất 1 admin.

- **Tài khoản admin chỉ thấy trang Quản trị** (chủ dự án yêu cầu): giao diện admin chỉ có tab Quản trị (mọi hash khác chuyển về `#admin`), không có thanh vé/đồng hồ hồi vé, popup giftcode, badge và toast nhiệm vụ. Người chơi thường thấy mọi tab trừ Quản trị.
- **Admin không chơi game, chỉ quản trị** (chủ dự án yêu cầu): server chặn mọi thao tác người chơi của admin bằng 403 `ADMIN_NOT_PLAYER` (quay thẻ, nhận vé hồi, cộng vé thử nghiệm, nâng cấp/nâng cấp nhanh, tặng thẻ và danh sách người nhận, giftcode, nhiệm vụ). Admin không được xử lý ngày mới (`touchDaily`: không ghi `login_days`, không thưởng reset 05:00, không tự nhận nhiệm vụ) và `/api/me` không đồng bộ vé hồi cho admin. Không cộng vé cho admin (`TARGET_IS_ADMIN`), không tặng thẻ cho admin (`RECIPIENT_IS_ADMIN`), admin không có trong danh sách người nhận và bảng xếp hạng. Vé/thẻ admin đã có từ trước được giữ nguyên (không xoá). Client admin không gọi `claim-recovery` lúc vào game.

Trang Quản trị (`apps/web/src/pages/Admin.tsx`, tab "Quản trị" chỉ hiện với admin, có badge số tài khoản chờ duyệt):

- **Người chơi**: ô bật/tắt "Duyệt tài khoản đăng ký" ở đầu tab; tìm theo tên, lọc trạng thái; tài khoản chờ duyệt lên đầu. Mỗi dòng: tên, admin, ngày đăng ký/duyệt, trạng thái, số dư từng loại vé và tổng, số thẻ và level cao nhất. Thao tác: Duyệt, Từ chối (có bước xác nhận), Cộng vé (form chọn loại + số lượng), Xem thẻ, Cấp/Thu quyền admin. Khóa nút khi đang xử lý.
- **Thẻ tướng**: mọi thẻ đang active của mọi người chơi, chỉ xem; lọc theo người chơi, tên tướng, phe, level; sắp xếp level cao nhất (mặc định) / mới nhất / tên tướng / theo người chơi; phân trang 60 thẻ; bấm thẻ mở popup ngắm thẻ.

### 3.9. Giftcode

Do chủ dự án yêu cầu. Giftcode **chỉ tặng vé quay**, không tặng thẻ tướng (chủ dự án đã bỏ phần thưởng thẻ).

- Mỗi giftcode gồm một hoặc nhiều dòng phần thưởng `{ kind: 'ticket', pool, count }`: cộng `count` vé quay loại `pool` (Thường, Thục, Ngụy, Ngô, Quần). Các dòng cùng loại vé được gộp. Ví dụ: 200 Vé Thục; hoặc 10 Vé Thục + 20 Vé Ngụy.
- Ghi ledger reason `giftcode`, `reference_id = giftcode:{codeId}`, mỗi loại vé một dòng; unique index chặn cộng lần 2.
- Tạo code có phần thưởng thẻ (`kind = 'card'`) bị từ chối (`INVALID_REWARDS`).
- Code thẻ cũ (tạo trước migration v9; dữ liệu trước v8 không có `kind` cũng là thẻ) bị tắt ở migration v9: không nhập được (`GIFTCODE_NOT_FOUND`), không bật lại được (`GIFTCODE_LEGACY`); lượt nhập và thẻ đã nhận trước đó giữ nguyên, lịch sử vẫn hiển thị.
- Mỗi giftcode tối đa `GIFT_CODE_MAX_TICKETS` vé (mặc định 10.000); đây là trần mỗi code, không phải trần tồn kho.
- Mã: chữ, số, `-`, `_`, dài 3–32; không phân biệt hoa thường, lưu IN HOA; duy nhất.
- **Mỗi người chơi nhập mỗi giftcode đúng 1 lần** (UNIQUE `code_id, user_id`); nhập lại → 409 `GIFTCODE_ALREADY_REDEEMED`.
- Hạn sử dụng tuỳ chọn (`expires_at`, null = không hạn, mặc định không hạn). Hết hạn → 410 `GIFTCODE_EXPIRED`. Code sai hoặc đã tắt → 404 `GIFTCODE_NOT_FOUND`.
- Cộng vé và ghi lượt nhập trong một transaction; lỗi giữa chừng không cộng vé nào và chưa tính là đã nhập.
- Admin tạo code (mã, số vé từng loại, hạn sử dụng tuỳ chọn, cờ "gợi ý"), bật/tắt code. Không sửa phần thưởng sau khi tạo; tắt code không thu hồi vé đã nhận.
- **4 giftcode tân thủ mặc định**, không hạn, có cờ gợi ý — là **vé quay** (chủ dự án yêu cầu; migration v7 tạo nhầm là thẻ, migration v8 sửa thành vé): `THUCQUOC` 200 Vé Thục, `NGUYQUOC` 200 Vé Ngụy, `NGOQUOC` 200 Vé Ngô, `QUANQUOC` 200 Vé Quần. Người đã nhập trước v8 (nhận 200 thẻ) giữ nguyên thẻ và lượt nhập, không nhập lại được.
- Trang **Giftcode** (tab `#giftcode`, `apps/web/src/pages/GiftCode.tsx`): ô nhập code, kết quả (số vé đã cộng theo loại — thanh vé cập nhật ngay), danh sách code gợi ý kèm trạng thái đã nhập, danh sách code đã nhập.
- **Popup lần đầu đăng nhập**: nếu còn code gợi ý chưa nhập, hiện popup liệt kê các code đó; nút "Đến trang nhập Giftcode" chuyển sang tab Giftcode. Chỉ hiện 1 lần mỗi tài khoản trên mỗi trình duyệt (localStorage `tq.gcPopup.<username>`).
- Lịch sử hiển thị "Nhập giftcode X: nhận Vé … ×N" (`GET /api/history?kind=giftcode`; lượt nhập code thẻ cũ vẫn hiện danh sách thẻ); dòng ledger vé hiển thị "Giftcode: nhận Vé X ×N".
- Trang Quản trị có tab **Giftcode**: form tạo code (số vé từng loại), danh sách code (phần thưởng, hạn, số lượt nhập, trạng thái, nút Bật/Tắt; code thẻ cũ ghi "Code thẻ cũ", không có nút Bật).

### 3.10. Nhiệm vụ hằng ngày và thành tựu

Do chủ dự án yêu cầu. Chỉ thưởng vé. Cấu hình ở `packages/game-config/src/quests.ts`; logic server `apps/api/src/managers/quest.manager.ts`; UI tab **Nhiệm vụ** (`#quests`, `apps/web/src/pages/Quests.tsx`, có badge số phần thưởng chờ nhận).

Thời gian:

- **Ngày game** reset lúc **05:00 giờ Việt Nam** (Asia/Ho_Chi_Minh = UTC+7 cố định, `DAILY_RESET_HOUR`). Nhiệm vụ hằng ngày và thưởng reset theo ngày game.
- **Điểm danh theo tháng** dùng **ngày dương lịch Việt Nam** (00:00).
- "Đăng nhập" = có request đã xác thực trong ngày (mở game). Server ghi `login_days` (ngày game + ngày dương lịch).

Nhận thưởng (chủ dự án chọn):

- Đạt điều kiện thì hiện nút **Nhận**; có **Nhận tất cả** và nhận theo nhóm thành tựu. Server tính lại điều kiện khi nhận; mỗi khoá phần thưởng chỉ nhận 1 lần (bảng `reward_claims`, PK `user_id + reward_key`). Nhận lại → 409 `NOTHING_TO_CLAIM`.
- **Nhiệm vụ ngày đã đạt mà chưa bấm nhận**: khi sang ngày game mới, server **tự nhận** cho người chơi (ở request đầu tiên của ngày mới; `reward_claims.auto = 1`) và UI báo toast.
- **Điểm danh** ngày nào chưa bấm nhận trong tháng thì sang tháng mới server tự nhận.
- **Thưởng reset 05:00** tự cộng ở request đầu tiên trong ngày game: Vé thường/Thục/Ngụy/Ngô/Quần mỗi loại 5 (`DAILY_RESET_BONUS`, 25 vé). **Chỉ ngày hiện tại**: vắng nhiều ngày không cộng bù.
- Xử lý ngày mới chạy trong preHandler xác thực (`touchDaily`), một transaction, chỉ một lần mỗi ngày (bảng `daily_state`); lỗi ở bước này không chặn thao tác chính.

Nhiệm vụ chung (vé thường; tối đa 52 vé/ngày):

| Nhiệm vụ | Điều kiện | Thưởng |
|---|---|---:|
| Đăng nhập mỗi ngày | Đăng nhập game | 4 |
| Chiêu mộ tướng | Quay 10 lần (mọi loại vé) | 6 |
| Chiêu mộ chăm chỉ | Quay 30 lần | 10 |
| Nâng cấp tướng | Nâng cấp **thành công** 3 lần (tính cả Nâng cấp nhanh) | 6 |
| Nâng cấp chuyên cần | Nâng cấp thành công 10 lần | 10 |
| Thu thập thẻ | Nhận 20 thẻ (từ chiêu mộ, tính cả thẻ trùng) | 6 |
| Hoàn thành nhiệm vụ | Hoàn thành 5 nhiệm vụ **chung** khác (đạt điều kiện, không cần đã nhận; không tính chính nó, không tính nhiệm vụ phe) | 10 |

Nhiệm vụ theo phe (mỗi phe Ngụy/Thục/Ngô/Quần, vé đúng phe; tối đa 14 vé/phe, 56 vé/ngày): quay 5 lần bằng vé phe → 4; quay 15 lần bằng vé phe → 6; nhận 10 thẻ thuộc phe (từ mọi loại vé) → 4.

Tiến trình ngày được tính từ lịch sử server trong khung ngày game (`gacha_history`, `upgrade_history` outcome `success`, `login_days`), không có bộ đếm riêng. Quay 30 lần đồng thời đạt nhiệm vụ quay 10; nâng cấp 10 lần đồng thời đạt nâng cấp 3.

Thành tựu (không reset, mỗi mốc nhận 1 lần, **tính cả lịch sử trước khi có tính năng**):

- **Điểm danh ngày trong tháng**: đăng nhập ngày d (dương lịch) → 9 + d vé thường (ngày 1 = 10 … ngày 31 = 40). Không cần liên tục; tháng mới quay về 10.
- **Chiêu mộ** (tổng lượt quay mọi loại vé): 10→10, 50→20, 100→40, 500→100, 1.000→200, 5.000→500, 10.000→1.000, 50.000→2.000 vé thường.
- **Sưu tầm tướng** (số tướng khác nhau đã thu thập): 10→20, 25→50, 50→100, 100→250 vé thường.
- **Sưu tầm theo phe** (mỗi phe độc lập): 5→5, 10→10, 15→20, 25→50 vé đúng phe.
- **Sở hữu thẻ cấp 1–10**: mỗi cấp 25 mốc (đang sở hữu 1…25 thẻ active cùng cấp, tính thẻ trùng); thưởng vé thường theo bảng khoảng mốc (1–4, 5–9, 10–14, 15–19, 20–24, 25) × cấp trong `ownLevelReward`. Mốc đã nhận lưu vĩnh viễn.
- **Tổng số thẻ đã nhận**: 10→5, 100→15, 500→40, 1.000→100, 5.000→250, 10.000→500 vé thường.
- "Thẻ đã nhận" / "đã thu thập" = thẻ từ **chiêu mộ** (+ thẻ từ giftcode thẻ cũ trước v9). **Không tính** thẻ tạo ra khi ghép và **thẻ được người khác tặng** (chống cày bằng tài khoản phụ).

Không có: thành tựu số lần nâng cấp, nhiệm vụ tuần, rương hoạt động, thành tựu reset hằng ngày, thưởng ngoài vé.

Khoá phần thưởng / `reference_id` ledger: `reset:{ngày}`, `d:{ngày}:{id}`, `f:{ngày}:{phe}:{id}`, `login:{YYYY-MM-DD}`, `a:draws:{n}`, `a:collect:{n}`, `a:fcollect:{phe}:{n}`, `a:own:{lv}:{n}`, `a:cards:{n}`. Lịch sử hiển thị nhãn theo khoá.

### 3.11. Hồ sơ người chơi

Do chủ dự án yêu cầu. Tab **Hồ sơ** (`#profile`, `apps/web/src/pages/Profile.tsx`), chỉ dành cho người chơi (không hiện với admin). Gồm 3 phần: ảnh đại diện, tên hiển thị, đổi mật khẩu.

- **Tên hiển thị** (`display_name`, migration v13): mặc định bằng tên đăng nhập (đặt lúc tạo tài khoản và backfill cho tài khoản cũ). Tối đa `DISPLAY_NAME_MAX` = 24 ký tự, cắt khoảng trắng hai đầu, không rỗng, không chứa ký tự điều khiển. `GET /api/me` trả kèm `displayName` + `avatar`; thanh trên hiển thị tên hiển thị (rơi về tên đăng nhập nếu rỗng).
- **Ảnh đại diện** (`avatar`, migration v13): lưu dạng chuỗi trong `users.avatar` (không upload file): `null` = mặc định (chữ cái đầu của tên hiển thị).
  - Chân dung tướng có sẵn: chọn từ roster, lưu `/generals/{artKey}.jpg`.
  - Ảnh tự tải: giới hạn **1MB** ở client; client **nén + thu nhỏ** ảnh (cắt vuông giữa, resize 256×256, xuất JPEG) thành data URL rồi gửi lên; server chỉ nhận data URL `png/jpeg/webp` hoặc đường dẫn `/generals/*.jpg`, giới hạn độ dài `AVATAR_MAX_LENGTH` = 200.000 ký tự. Ảnh sai định dạng → `INVALID_AVATAR`, quá dài → `AVATAR_TOO_LARGE`.
- **Đổi mật khẩu**: phải nhập đúng mật khẩu hiện tại (`INVALID_PASSWORD`), mật khẩu mới khác mật khẩu cũ (`SAME_PASSWORD`), dài 6–128. Phiên đăng nhập đang dùng vẫn giữ nguyên sau khi đổi.
- Endpoint ở mục 8.4g.

## 4. Gacha

### 4.1. Cách quay

Mỗi lượt quay sử dụng đúng một vé thuộc loại người chơi chọn. Một request có thể gồm nhiều lượt (quay ×10, mục 4.4).

Quy trình:

1. Server xác thực người chơi.
2. Server đồng bộ các mốc hồi vé hợp lệ chưa xử lý.
3. Server kiểm tra số dư của loại vé được chọn.
4. Server tiêu thụ đúng một vé.
5. Server xác định pool tướng theo loại vé.
6. Server chọn ngẫu nhiên một tướng trong pool hợp lệ.
7. Server roll level của bản thẻ theo bảng tỷ lệ level.
8. Server tạo bản thẻ cho người chơi.
9. Server ghi ledger vé và lịch sử gacha.
10. Server trả kết quả đã xác nhận để client hiển thị animation.

Các bước thay đổi dữ liệu phải nguyên tử. Nếu thao tác quay thất bại trước khi hoàn thành transaction, không được mất vé hoặc tạo thẻ không hợp lệ.

Nếu người chơi gửi lại cùng idempotency key sau khi request đã thành công, server phải trả lại kết quả đã lưu thay vì tiêu thêm vé hoặc tạo thẻ mới.

### 4.2. Tỷ lệ chọn tướng

- Vé thường: chọn ngẫu nhiên đồng đều trong 100 tướng.
- Vé Thục: chọn ngẫu nhiên đồng đều trong 25 tướng Thục.
- Vé Ngụy: chọn ngẫu nhiên đồng đều trong 25 tướng Ngụy.
- Vé Ngô: chọn ngẫu nhiên đồng đều trong 25 tướng Ngô.
- Vé Quần: chọn ngẫu nhiên đồng đều trong 25 tướng Quần.
- Người chơi có thể nhận nhiều bản sao của cùng một tướng.
- Không có pity system.
- Không loại tướng đã sở hữu ra khỏi pool.
- Không có bảo đảm tướng mới hoặc tướng hiếm theo số lần quay.

### 4.3. Tỷ lệ level thẻ

Đây là xác suất level của bản thẻ được nhận, độc lập với xác suất chọn tướng.

**Quay thẻ ra tối đa level 9** (`GACHA_MAX_LEVEL = 9`). Level 10 chỉ đạt được qua ghép thẻ (mục 5).

| Level nhận được | Xác suất |
|---:|---:|
| 1 | 72.00% |
| 2 | 15.00% |
| 3 | 7.00% |
| 4 | 3.50% |
| 5 | 2.00% |
| 6 | 0.40% |
| 7 | 0.07% |
| 8 | 0.02% (2/10.000) |
| 9 | 0.01% (1/10.000) |
| **Tổng** | **100.00%** |

Ghi chú lịch sử thay đổi: bảng gốc có level 1–10; sau đó chủ dự án giới hạn tối đa level 5; tiếp theo mở lại tối đa level 9 (dùng tỷ lệ gốc); hiện chủ dự án yêu cầu **Lv8–9 cực kỳ hiếm**. Lv9 = 1 bps là mức nhỏ nhất của thang basis points; muốn hiếm hơn nữa phải đổi sang thang chi tiết hơn.

Yêu cầu:

- Tỷ lệ nằm trong cấu hình server.
- Validate tổng xác suất bằng 100%.
- Ưu tiên integer weights hoặc basis points để tránh sai số floating point.
- Không có xác suất âm.
- Bảng tỷ lệ quay chỉ được chứa level 1–`GACHA_MAX_LEVEL`; validate khi khởi động.
- Thẻ đã quay ra trước khi đổi cấu hình vẫn giữ nguyên, không bị sửa.
- UI hiển thị tỷ lệ thực tế đang được server áp dụng.
- Viết unit test cho bảng cấu hình và thuật toán roll.
- Không giả lập kết quả ở client rồi yêu cầu server chấp nhận.

### 4.4. Quay nhiều lần (×10)

Người chơi có thể chọn quay 1 lần hoặc quay 10 lần trong một thao tác, bằng cùng một loại vé. (Trước đây là ×5; chủ dự án đã đổi thành ×10.)

- Các lựa chọn số lần quay nằm trong cấu hình server (`DRAW_COUNT_OPTIONS`, mặc định `[1, 10]`).
- Số lượt thực tế = min(số lần chọn, số dư loại vé đã chọn). Nếu còn ít hơn 10 vé loại đó, server quay hết số vé còn lại.
- Nếu số dư loại vé bằng 0, trả lỗi hết vé.
- Không dùng vé loại khác để bù.
- Mỗi lượt là một lần quay độc lập: tiêu 1 vé, chọn tướng đều trong pool, roll level theo mục 4.3. Không có bảo đảm hoặc bonus cho lần quay ×10.
- Toàn bộ các lượt nằm trong một transaction. Lỗi ở bất kỳ lượt nào thì không tiêu vé và không tạo thẻ nào.
- Mỗi lượt có một dòng ledger `gacha_draw` và một dòng `gacha_history` riêng.
- Một idempotency key cho cả thao tác. Retry trả lại toàn bộ kết quả đã lưu. Dùng cùng key với loại vé hoặc số lần khác thì bị từ chối.
- Kết quả trả về số lần yêu cầu, số lượt đã quay và danh sách thẻ theo thứ tự quay.
- **Mở tất cả** (chủ dự án yêu cầu): quay hết vé của loại đang chọn, tối đa `DRAW_ALL_MAX` (1000) lượt mỗi lần bấm; còn vé thì bấm lại. Client gửi `count = DRAW_ALL_MAX`; server vẫn quay min(count, số dư), cùng quy tắc nguyên tử/ledger/lịch sử/idempotency như ×10.

## 5. Nâng cấp thẻ bằng cách ghép 2 thẻ cùng level

### 5.1. Quy tắc cơ bản

Nâng cấp không còn khái niệm thẻ chính hoặc thẻ mồi. Người chơi chọn đúng 2 bản thẻ cùng level và cùng tướng để thực hiện một lần ghép.

Số thẻ mỗi lần ghép nằm trong cấu hình server (`UPGRADE_INPUT_COUNT`, hiện là **2**). Trước đây là 3 thẻ; chủ dự án đã đổi thành 2. Lịch sử ghép cũ với 3 thẻ đầu vào vẫn được giữ nguyên và hiển thị đúng số thẻ đã tiêu thụ.

Ví dụ:

- 2 thẻ level 1 của cùng một tướng → thành công nhận 1 thẻ level 2 của tướng đó.
- 2 thẻ level 2 của cùng một tướng → thành công nhận 1 thẻ level 3 của tướng đó.
- 2 thẻ level 3 của cùng một tướng → thành công nhận 1 thẻ level 4 của tướng đó.
- Tiếp tục tương tự cho đến level 10.

Quy tắc bắt buộc:

- Mỗi lần nâng cấp cần đúng 2 thẻ.
- Cả 2 thẻ phải có cùng level.
- Cả 2 thẻ phải có cùng `general_id`.
- Cả 2 thẻ phải thuộc quyền sở hữu của người chơi đang thực hiện thao tác.
- Không được chọn trùng cùng một card ID nhiều lần.
- Không được sử dụng thẻ đã bị tiêu thụ hoặc đang bị khóa bởi một thao tác khác.
- Level đầu vào phải nằm trong khoảng 1–9.
- Không thể ghép thẻ level 10 để lên level cao hơn.
- Khi thành công, tiêu thụ 2 thẻ đầu vào và tạo đúng 1 thẻ mới có level bằng level đầu vào + 1.
- Khi thất bại, tiêu thụ 2 thẻ đầu vào và tạo đúng 1 thẻ mới với level được roll từ bảng phân phối thất bại ứng với level đầu vào.
- Kết quả thất bại không được cao hơn level đầu vào và không được thấp hơn level 1.
- Không có bonus cùng phe.
- Không có bonus từ chênh lệch level.
- Không có lựa chọn số lượng thẻ mồi.
- Không có cơ chế nâng cấp thành công chắc chắn bằng cách thêm thẻ.
- Toàn bộ việc tiêu thụ 2 thẻ, roll kết quả, tạo thẻ mới và ghi lịch sử phải nằm trong transaction nguyên tử.
- Nếu transaction thất bại, không được tiêu thụ thẻ hoặc tạo thẻ nhận.
- Hỗ trợ idempotency key để chống gửi lặp.
- Mọi xác suất và kết quả được tính ở server.
- UI phải hiển thị xác suất thành công, phân phối thất bại và hậu quả trước khi xác nhận.

### 5.2. Tỷ lệ thành công cơ sở

Bảng tỷ lệ thành công do chủ dự án duyệt (thay bảng cũ 80% → 0.5%): giảm đều 10% mỗi bậc. Tỷ lệ dựa trên level chung của 2 thẻ trước khi ghép.

| Level của 2 thẻ trước khi ghép | Level nhận khi thành công | Thành công | Thất bại |
|---:|---:|---:|---:|
| 1 | 2 | 90% | 10% |
| 2 | 3 | 80% | 20% |
| 3 | 4 | 70% | 30% |
| 4 | 5 | 60% | 40% |
| 5 | 6 | 50% | 50% |
| 6 | 7 | 40% | 60% |
| 7 | 8 | 30% | 70% |
| 8 | 9 | 20% | 80% |
| 9 | 10 | 10% | 90% |

Yêu cầu:

- Đây là cấu hình khởi điểm để playtest. Không tự ý thay đổi nếu chưa có yêu cầu.
- Không áp dụng bonus từ thẻ khác.
- Không cộng bonus cùng phe.
- Không có bonus từ level chênh lệch vì cả 2 thẻ phải cùng level.
- Xác suất thành công và thất bại phải lấy từ cấu hình server.
- Xác suất thành công cộng xác suất thất bại phải bằng 100%.

### 5.3. Phân phối kết quả khi thất bại

Khi nâng cấp thất bại, server roll level của thẻ nhận được từ bảng phân phối riêng tương ứng với level chung của 2 thẻ đầu vào.

Mục tiêu cân bằng:

- Hạn chế cảm giác mất trắng công sức.
- Tăng xác suất giữ nguyên level khi thất bại, nhất là ở các level cao.
- Tập trung phần lớn xác suất tụt level ở những level gần level đầu vào.
- Vẫn giữ rủi ro đủ rõ để nâng cấp có cảm giác hồi hộp.
- Không có kết quả cao hơn level đầu vào khi thất bại.
- Không bao giờ tụt dưới level 1.
- Level 1 chỉ có kết quả giữ nguyên level 1 khi thất bại.
- Bảng này là phân phối có điều kiện sau khi đã xác định thất bại.
- Tổng xác suất trong mỗi hàng phải bằng 100%.

Bảng mặc định (chủ dự án duyệt): khi thất bại chỉ có thể giữ nguyên hoặc tụt đúng 1 bậc, không tụt sâu.

| Level đầu vào | Tụt 1 bậc | Giữ nguyên |
|---:|---:|---:|
| 1 | — | 100% |
| 2 | 10% (về Lv1) | 90% |
| 3 | 20% (về Lv2) | 80% |
| 4 | 20% (về Lv3) | 80% |
| 5 | 20% (về Lv4) | 80% |
| 6 | 20% (về Lv5) | 80% |
| 7 | 20% (về Lv6) | 80% |
| 8 | 20% (về Lv7) | 80% |
| 9 | 20% (về Lv8) | 80% |

Dấu `—` là kết quả không hợp lệ.

Tỷ lệ thực tế trên mỗi lần ghép (đã nhân với tỷ lệ thất bại): ví dụ ghép Lv5 có 50% lên Lv6, 40% giữ Lv5, 10% về Lv4; ghép Lv9 có 10% lên Lv10, 72% giữ Lv9, 18% về Lv8.

Yêu cầu triển khai:

- Tách bảng phân phối thất bại khỏi bảng tỷ lệ thành công.
- Chỉ roll bảng thất bại khi kết quả roll thành công đã xác định là thất bại.
- Không cộng xác suất trong bảng thất bại trực tiếp vào xác suất thành công.
- Validate từng hàng có tổng xác suất bằng 100%.
- Validate không có xác suất âm hoặc level không hợp lệ.
- Lưu snapshot bảng phân phối đã áp dụng trong lịch sử nâng cấp.
- UI hiển thị xác suất nhận được từng level khi thất bại.
- Nếu cấu hình thay đổi, lịch sử cũ vẫn phải giải thích được kết quả theo snapshot cũ.

### 5.4. UI nâng cấp

- Chọn đúng 2 thẻ.
- Chỉ cho phép chọn 2 thẻ cùng level và cùng tướng.
- Thẻ được gom theo tướng: mọi bản sao của cùng một tướng luôn nằm liền nhau (VD 2 thẻ Tào Tháo cạnh nhau). Trong mỗi tướng, thẻ chia nhóm theo level (cao → thấp); nhóm cùng level đủ 2 thẻ được đánh dấu "đủ ghép".
- Sắp xếp áp dụng cho thứ tự các nhóm tướng: level cao nhất (mặc định — mọi danh sách thẻ trong game mặc định sort level cao nhất), ghép được trước, nhiều thẻ nhất, tên A→Z. Không có kiểu sắp xếp nào làm tách rời thẻ cùng tướng.
- Hỗ trợ lọc theo phe, level và sắp xếp.
- Hiển thị tên, ảnh, phe và level từng thẻ.
- Hiển thị xác suất thành công.
- Hiển thị xác suất thất bại và phân phối level nhận được sau thất bại.
- Cảnh báo cả 2 thẻ đầu vào sẽ bị tiêu thụ bất kể thành công hay thất bại.
- Có bước xác nhận trước khi gửi request.
- Có nút **Huỷ** để bỏ chọn toàn bộ thẻ đang chọn ghép; bấm vào thẻ trong ô "Đã chọn" để bỏ riêng thẻ đó. Ở bước xác nhận có nút "Quay lại".
- Mỗi thẻ trong ô "Đã chọn" hiển thị khung riêng của thẻ (kể cả Lv.6+), không tràn chiếm cả khung panel.
- Khóa nút khi request đang xử lý.
- Animation chỉ chạy sau khi server xác nhận kết quả.
- Khi animation ghép xong, chạm/bấm bất kỳ đâu (hoặc Esc) để đóng popup (giống màn mở thẻ).
- Thành công: hiệu ứng tăng level và ánh sáng.
- Thất bại: hiệu ứng rung hoặc đứt sáng, hiển thị level mới theo kết quả server.
- Hỗ trợ `prefers-reduced-motion`.
- Lỗi animation không làm thay đổi kết quả đã ghi nhận trong database.

### 5.5. Nâng cấp nhanh

Trang Nâng cấp có nút **"Nâng cấp nhanh"** kèm các **checkbox chọn level đầu vào** do chủ dự án yêu cầu.

- Người chơi tick chọn các level muốn ghép nhanh (Lv.1–9); mặc định chọn sẵn Lv.1–`QUICK_UPGRADE_MAX_LEVEL` (cấu hình server, mặc định 5). Không tick level nào thì nút bị khoá.
- Request gửi kèm `levels[]` (danh sách level đã chọn); bỏ trống thì server dùng mặc định Lv.1–5. Level ngoài khoảng Lv.1–9 bị chặn (`INVALID_LEVELS` / lỗi schema).
- Server tự ghép liên tục mọi nhóm `UPGRADE_INPUT_COUNT` thẻ cùng tướng, cùng level **nằm trong danh sách đã chọn**, cho đến khi không còn nhóm nào. Thẻ mới tạo ra (thành công hoặc thất bại) nếu vẫn thuộc level đã chọn sẽ được đưa lại vào hàng chờ để ghép tiếp (dây chuyền).
- Thứ tự xử lý: level thấp trước, rồi theo tướng, trong cùng nhóm dùng thẻ cũ (id nhỏ) trước.
- Thẻ ở level KHÔNG được chọn không bao giờ bị dùng. Thẻ lên một level không nằm trong danh sách chọn không ghép tiếp.
- Mỗi lần ghép dùng đúng luật và tỷ lệ của mục 5.1–5.3. Không có bonus hay bảo đảm riêng.
- Mỗi lần ghép ghi một dòng `upgrade_history` riêng, kèm snapshot tỷ lệ.
- Toàn bộ thao tác nằm trong một transaction. Lỗi ở bất kỳ lần ghép nào thì không thẻ nào bị tiêu thụ và không ghi lịch sử.
- Một idempotency key cho cả thao tác; retry trả lại kết quả đã lưu.
- Trần an toàn `QUICK_UPGRADE_MAX_MERGES` (mặc định 1000) lần ghép mỗi lần bấm; nếu còn cặp thì trả `hasMore = true` để người chơi bấm lại.
- Không có cặp nào thì trả lỗi `NOTHING_TO_UPGRADE`.
- UI phải hiển thị bảng tỷ lệ Lv.1–5 (thành công / giữ nguyên / tụt), cảnh báo thẻ bị tiêu thụ và có bước xác nhận trước khi gửi request. Sau khi xong, hiển thị tổng kết: số lần ghép, số thành công/thất bại, level cao nhất đạt được và thống kê theo level.

### 5.6. Tặng thẻ

Người chơi có thể tặng thẻ cho bất kỳ người chơi nào khác, do chủ dự án yêu cầu.

**Hiện đang TẠM TẮT** (chủ dự án yêu cầu): cờ server `ENABLE_GIFT` (`1`/`true`, context `features.gift`), mặc định **tắt**. Khi tắt: `POST /api/gifts` và `GET /api/users` trả 404 `FEATURE_DISABLED`; `GET /api/me` trả `features.gift = false` và Bộ sưu tập ẩn nút 🎁 Tặng thẻ. Logic tặng, dữ liệu và lịch sử tặng/nhận cũ giữ nguyên (Lịch sử vẫn hiển thị). Các quy tắc dưới đây áp dụng khi bật.


- Người nhận xác định bằng tên đăng nhập (không phân biệt hoa thường). Không được tặng cho chính mình, không tặng cho tài khoản quản trị (`RECIPIENT_IS_ADMIN`, mục 3.8).
- Mỗi lần tặng từ 1 đến `GIFT_MAX_CARDS` thẻ (cấu hình server, mặc định **20**).
- Thẻ thuộc mọi level đều tặng được, kể cả Lv.10. Chỉ tặng được thẻ đang active của chính mình; thẻ đã bị ghép (tiêu thụ) không tặng được.
- Người nhận có thẻ ngay, không cần chấp nhận. Thẻ đã tặng không lấy lại được.
- Thẻ đổi chủ giữ nguyên ID, tướng và level. Người nhận dùng thẻ như thẻ của mình (ghép, tặng tiếp).
- Đổi chủ toàn bộ thẻ và ghi lịch sử trong một transaction. Nếu có bất kỳ thẻ nào không hợp lệ thì huỷ cả giao dịch, không thẻ nào bị chuyển.
- Idempotency key gắn với người gửi; retry trả lại kết quả cũ, không chuyển lần hai. Dùng cùng key cho người nhận hoặc danh sách thẻ khác thì bị từ chối.
- Không tặng vé; vé vẫn không thể chuyển hoặc quy đổi (mục 3.4).
- Lịch sử hiển thị cho cả hai phía: người gửi thấy "Tặng N thẻ cho X", người nhận thấy "Nhận N thẻ từ Y", kèm danh sách thẻ (snapshot tướng + level tại thời điểm tặng).
- UI: tặng thẻ nằm **trong trang Bộ sưu tập** (không còn tab riêng; link `#gift` cũ tự chuyển về Bộ sưu tập). Bấm nút **🎁 Tặng thẻ** để bật chế độ chọn thẻ; đếm số đã chọn (tối đa 20); bước xác nhận liệt kê thẻ sắp tặng và cảnh báo thẻ Lv.6+; khóa nút khi đang xử lý.
- Ô người nhận là dropdown có tìm kiếm, liệt kê **mọi người chơi** (trừ chính mình và tài khoản quản trị). Thứ tự: người có giao dịch tặng/nhận thẻ với mình **gần nhất** lên đầu (kèm nhãn "Gần đây · x phút trước"), người chưa từng giao dịch xếp sau theo tên A→Z. Chỉ gửi được khi tên khớp một người trong danh sách. Sau khi tặng, danh sách tải lại để người vừa nhận lên đầu.
- Rủi ro đã biết: khi `ENABLE_DEV_TOPUP` bật, người chơi có thể tạo tài khoản phụ để cày vé rồi tặng thẻ cho tài khoản chính. Phải tắt cờ này khi chạy thật.

## 6. Giao diện và trải nghiệm

### 6.1. Bộ sưu tập

- Thẻ gom theo tướng giống trang Nâng cấp: mỗi tướng một khung, mọi bản sao nằm liền nhau; trong khung chia nhóm theo level (cao → thấp) có nhãn số lượng (VD `Lv.1 ×3`).
- Sắp xếp các khung tướng: level cao nhất (mặc định), tên A→Z, nhiều thẻ nhất.
- Chế độ xem "Thẻ của tôi" (mặc định) và "Tướng chưa có" (các tướng chưa sở hữu hiển thị mờ).
- Tích hợp tặng thẻ (mục 5.6).
- Bấm một thẻ (khi không ở chế độ tặng) mở popup ngắm thẻ phóng to: tên, phe, Lv (không hiện tên bậc khung Đồng/Bạc/… cũng không hiện số thẻ), thời điểm nhận; kèm **kỹ năng và chỉ số chi tiết** của tướng ở đúng cấp (phong cách, kỹ năng, nội tại, HP/sát thương/LC/chí mạng…, nạp từ `GET /api/pvp/generals/:id/combat`); thẻ nghiêng nhẹ theo chuột (tắt khi reduced motion); bấm bất kỳ đâu hoặc Esc để đóng. Popup chỉ hiển thị, không đổi dữ liệu (`apps/web/src/viewer.tsx`). Nền phủ (`.viewer-overlay`) tối trung tính + `backdrop-filter: blur/saturate` để nội dung phía sau chìm xuống (thay cho tông đỏ trước đây).
- Hiển thị lưới thẻ.
- Tìm kiếm theo tên.
- Lọc theo phe và level.
- Phân biệt tướng chưa sở hữu và thẻ đang sở hữu.
- Hiển thị nhiều bản sao của cùng một tướng.
- Hiển thị level riêng cho từng bản thẻ.
- Có loading, empty state và error state.

### 6.2. Trang quay thẻ

- Cho phép chọn vé thường, vé Thục, vé Ngụy, vé Ngô hoặc vé Quần.
- Có nút quay 1 lần và nút quay ×10. Khi số dư loại vé đang chọn ít hơn 10, nút ×10 hiển thị "Quay hết N vé".
- Quay ×10 hiển thị animation lật lần lượt từng thẻ (2 hàng × 5 thẻ) theo đúng kết quả server, có thể bỏ qua.
- Kết quả chỉ hiện trong màn mở thẻ; trang quay không hiện trước danh sách thẻ vừa quay (tránh lộ kết quả). Sau khi đóng chỉ còn dòng tóm tắt loại vé đã dùng.
- Khi animation xong, chạm/bấm bất kỳ đâu (hoặc Esc) để đóng màn mở thẻ.
- Nút **"Mở tất cả N vé"** hiện khi số dư loại vé đang chọn > 10 (quá 1000 thì "Mở 1000 vé (tối đa mỗi lần)"). Màn kết quả chỉ lật **10 thẻ xịn nhất** (level cao trước, cùng level giữ thứ tự quay) và ghi "Đã mở N thẻ … · 10 thẻ xịn nhất · +M thẻ khác"; sau khi đóng, dòng tóm tắt liệt kê số thẻ theo level. Màn kết quả có thêm nút "Mở tất cả" khi còn > 10 vé.
- Màn kết quả có nút **"Quay tiếp 1 vé"** và **"Quay tiếp 10 vé"** (cùng loại vé vừa dùng; còn ít hơn 10 vé thì "Quay hết N vé"; còn 1 vé chỉ có nút 1 vé; hết vé thì nút bị khoá). Bấm là đóng màn và quay ngay, giống hệt bấm nút quay ở trang (cùng kiểm tra, idempotency key, chặn bấm lặp).
- Hiển thị số dư từng loại vé và tổng số vé.
- Không hiển thị giá Vàng, nút nạp tiền hoặc cửa hàng vé.
- Hiển thị pool tướng có thể nhận của loại vé đang chọn.
- Hiển thị tỷ lệ level.
- Animation mở thẻ/reveal thẻ có thể bỏ qua.
- Kết quả animation phải khớp với kết quả server.
- Chặn thao tác quay lặp khi request đang xử lý.
- Xử lý hết vé, lỗi mạng và lỗi API.
- Hiển thị rõ loại vé đã tiêu thụ và tướng nhận được.

### 6.3. Trang nâng cấp

- Chọn 2 thẻ cùng level và cùng tướng.
- Thẻ cùng tướng nằm liền nhau, chia nhóm theo level (xem mục 5.4).
- Có nút Nâng cấp nhanh kèm checkbox chọn level, mặc định Lv.1–5 (xem mục 5.5).
- Hiển thị tỷ lệ thành công, thất bại và phân phối level sau thất bại.
- Hiển thị rõ cả 2 thẻ sẽ bị tiêu thụ.
- Preview chỉ mang tính tham khảo; API thực hiện nâng cấp phải tính lại.
- Animation dựa trên kết quả server.

### 6.4. Lịch sử

Hiển thị lịch sử phân trang:

- Vé được cấp từ hồi thời gian.
- Vé quà đăng ký và loại vé đã nhận.
- Loại vé đã nhận trong từng mốc.
- Vé đã sử dụng.
- Tướng và level nhận được từ gacha.
- Nâng cấp thành công/thất bại.
- Ba thẻ đầu vào đã tiêu thụ.
- Level đầu vào và level thẻ nhận được.
- Snapshot tỷ lệ và phân phối thất bại đã áp dụng.
- Thẻ đã tặng và đã nhận (người gửi/nhận, danh sách thẻ).

### 6.5. Hướng hình ảnh

- Chủ đề sưu tầm tướng Tam Quốc, tạo cảm giác thẻ có giá trị.
- Giao diện chủ đề Tam Quốc nằm ở `apps/web/src/theme.css` (ghi đè thẩm mỹ của `style.css`): nền chiến trường 4 phe theo mẫu chủ dự án cung cấp (núi, thành lũy, cờ Ngụy/Ngô trong `public/theme/landscape.svg`; vầng sáng 4 màu phe và vignette bằng CSS gradient; 40 tia lửa màu phe bay lên do `main.tsx` tạo, tắt khi `prefers-reduced-motion`), panel sơn mài đỏ–đen viền vàng với góc hồi văn (`public/theme/corner-*.svg`), dải hồi văn dưới thanh trên (`public/theme/fret.svg`), tab đang chọn và nút chính màu son; logo game là icon Gia Cát Lượng. Font từ Google Fonts (đều có đủ dấu tiếng Việt trừ font chữ Hán): Playfair Display SC cho tiêu đề và tab (chữ hoa nhỏ kiểu khắc bia); Oswald cho nút, số vé, nhãn Lv. và số liệu; Charm (nét bút lông) cho tên game mạ vàng gradient và dòng kết quả mở thẻ; Noto Serif cho nội dung; Ma Shan Zheng (bút lông) cho chữ Hán biểu tượng phe, có font dự phòng khi offline.
- UI hiện đại, tương phản tốt, responsive cho desktop và mobile.
- Thanh trên (tên game, vé, nhạc, tài khoản) và thanh tab luôn dính trên cùng khi cuộn (`.app-head`, sticky); chiều cao đo bằng JS vào biến CSS `--head-h` để khung "Đã chọn" ở trang Nâng cấp dính ngay bên dưới.
- **Mobile web (≤ 640px)** — khối CSS cuối `theme.css` (chủ dự án yêu cầu tối ưu mobile): thanh trên chỉ còn logo + "Tam Quốc", nút nhạc (ẩn thanh âm lượng) và Đăng xuất; thanh vé là một hàng cuộn ngang; tab cuộn ngang và tự cuộn tới tab đang chọn; ô nhập cỡ chữ ≥ 16px (iOS không tự phóng to), lọc/form full-width, nút cao ≥ 40px; lưới thẻ ~3 cột; nút quay 1/×10 chia đôi bề ngang. Trang Nâng cấp: khi đang chọn thẻ, khung "Đã chọn" thành bottom sheet dính đáy màn hình (class `.side.has-sel`, tối đa 62dvh, cuộn trong). Bộ sưu tập: khung tặng thẻ dính dưới thanh trên khi bật chế độ tặng. Popup mở thẻ/ngắm thẻ dùng `dvh` và safe-area; các nút "Quay tiếp"/"Đóng" tự xuống dòng.
- Khung thẻ theo cấp (chủ dự án cung cấp bộ khung tham chiếu): Cấp 1 Đồng, 2 Bạc, 3 Lục, 4 Vàng, 5 Đỏ, 6 Huyền, 7 Tử, 8 Cam, 9 Bạch kim, 10 Kim cương. Cấp 1–5 là khung kim loại (cấp 5 có đá đỏ phát sáng); cấp 6–10 có đá quý, hào quang, cánh/rồng/phượng. Phần trang trí cấp 6–10 được phép tràn ra ngoài thân thẻ.
- Thân thẻ (avatar + tên) luôn cùng kích thước ở mọi cấp trong cùng một ô: thẻ Lv.6–10 cần chừa chỗ khung lớn hơn nên được phóng to (≈1,171×) kèm lề âm để thân thẻ trùng đúng vị trí/kích thước thân thẻ Lv.1–5; khung Lv.6+ tràn ra ngoài ô, ô chứa thẻ Lv.6+ được nới rộng. Thẻ luôn căn giữa ô; các ô nhóm level trong cùng một tướng cao bằng nhau và dùng chung đệm (nhóm có thẻ Lv.6+ thì mọi ô cùng nới), nên thân thẻ các cấp thẳng hàng. Kích thước ô đặt bằng biến CSS `--cw` (`style.css`).
- Ảnh khung nằm ở `apps/web/public/frames/lv1.png` … `lv10.png` (PNG nền trong suốt, tách từ bộ khung tham chiếu bản 3 bằng color-to-alpha nên giữ được hào quang mờ; thân thẻ rộng 240px trong ảnh khung). Vị trí đặt khung so với thân thẻ khai báo ở `FRAME_LAYOUT` trong `apps/web/src/art.ts`; dùng chung cho thẻ trong lưới và thẻ trên sân khấu (animation mở thẻ, ghép thẻ). Thay khung = thay file PNG cùng tên (nếu tỉ lệ khung đổi thì cập nhật `FRAME_LAYOUT`).
- Màu chữ level và chấm màu ở bảng tỷ lệ dùng màu của bậc khung tương ứng.
- Chân dung tướng nằm ở `apps/web/public/generals/{artKey}.jpg` (cắt từ 4 bảng ảnh độ phân giải cao chủ dự án cung cấp, mỗi phe một bảng 5×5, bỏ khung và bảng tên; mỗi ảnh 286×378). Dùng chung cho thẻ trong lưới và thẻ trên sân khấu. Ô chân dung là **chữ nhật đúng tỉ lệ ảnh gốc 286:378** (chủ dự án yêu cầu; `.tq-art` `aspect-ratio: 286/378`), tên + phe/Lv **nằm đè phần dưới chân dung** trên nền tối dần (như bảng tên ảnh gốc) với cỡ chữ nhỏ (tên 12px, phe/Lv 10,5px; mobile 11/9,5px), có đệm theo bậc khung để thanh khung/đá Lv.6+ không che chữ; nhờ vậy thân thẻ giữ đúng tỉ lệ khung, ảnh khung không bị kéo giãn. Thay artwork = thay file cùng tên rồi tăng `PORTRAIT_VERSION` trong `art.ts` (URL có `?v=`, vì nginx cache `/generals/` 7 ngày). Bộ hiện tại (v4) cắt lại từ 4 bảng mới của chủ dự án, giữ nguyên bố cục ảnh gốc (chủ dự án yêu cầu bỏ việc đẩy người xuống + vùng mờ phía trên của v3); bảng Ngụy ghi "Tào Thuần" ở ô thứ 5, ảnh này dùng cho `cao-zhen` (Tào Chân) vì roster chưa đổi.
- Tướng thiếu ảnh chân dung tự rơi về placeholder (biểu tượng phe + chữ viết tắt).
- Mặt sau thẻ trong animation quay thẻ là ảnh `apps/web/public/theme/card-back.jpg` (chủ dự án cung cấp: khung đồng, rồng, bát quái; 360×568, ~40 KB). Thay mặt sau = thay file cùng tên; thiếu ảnh thì dùng mặt sau vẽ dự phòng.
- Nhạc nền (chủ dự án cung cấp): 4 bài `apps/web/public/audio/b1.mp3`, `b2.mp3`, `b3.mp3`, `b4.mp3` (MP3 64 kbps, ~1,4 MB/bài), khai báo trong `TRACKS` ở `apps/web/src/music.ts`; phát kiểu xào bài: trộn ngẫu nhiên cả danh sách, nghe hết các bài rồi mới trộn lại; bài vừa nghe được nhớ trong localStorage (`tq.music.last`) nên lần mở game sau không bắt đầu bằng bài đó. Thanh trên có nút bật/tắt hình trống trận (SVG; khi tắt có vạch son chéo) và thanh âm lượng (`components/MusicControl.tsx`); lựa chọn lưu trong localStorage của trình duyệt (mặc định bật, 40%). Do trình duyệt chặn tự phát, nhạc chỉ bắt đầu sau lần chạm/bấm đầu tiên.
- Sân khấu mở thẻ/ghép thẻ là SolidJS + CSS thuần (không dùng engine đồ hoạ ngoài): thẻ định vị theo % trong khung 520×460, animation chạy bằng `requestAnimationFrame` kéo thuộc tính trong `createStore` (không dựng lại DOM) kết hợp keyframe CSS cho hào quang/hạt sáng.
- Đóng sân khấu thì gỡ overlay khỏi DOM và huỷ vòng `requestAnimationFrame` đang chạy để không rò rỉ.
- Hiệu ứng không được cản trở thao tác.
- Hỗ trợ reduced motion.

### 6.6. Bảng xếp hạng

Do chủ dự án yêu cầu. Tab **Xếp hạng** (`#leaderboard`, `apps/web/src/pages/Leaderboard.tsx`), chỉ đọc, không ảnh hưởng vé/thẻ.

- Chỉ số duy nhất: **Lực chiến** = tổng điểm các thẻ **đang active** của người chơi, **mỗi cặp (tướng, cấp) chỉ tính 1 lần** (chủ dự án yêu cầu: 5 thẻ Tào Tháo Lv.5 tính như 1 thẻ; Tào Tháo Lv.5 và Lưu Bị Lv.5 vẫn tính riêng; số thẻ hiển thị vẫn là tổng thẻ); điểm mỗi thẻ theo level ở `LEADERBOARD_POWER_BY_LEVEL` (game-config): Lv.n = 2^(n−1) (Lv.1 = 1, Lv.2 = 2, Lv.3 = 4, …, Lv.10 = 512). Validate khi khởi động: đủ Lv.1–10, nguyên dương, không giảm theo level.
- Server tính trực tiếp từ `user_cards` mỗi lần gọi (không lưu bảng riêng). Thẻ đã tiêu thụ không tính; thẻ tặng đi tính cho người nhận.
- Chỉ xếp hạng tài khoản đã duyệt, **không phải admin** (chủ dự án yêu cầu ẩn admin) và có ít nhất 1 thẻ.
- Đồng Lực chiến → đồng hạng (`RANK`); trong cùng hạng sắp theo level cao nhất giảm dần rồi tên A→Z.
- Trả tối đa `LEADERBOARD_SIZE` (100) người; UI làm nổi bật top `LEADERBOARD_TOP` (10), cột hạng dùng **huy hiệu trống chữ do chủ dự án cung cấp** (`apps/web/public/theme/rank/r1…r4.png`, tách nền đen thành trong suốt, 128px): hạng 1 (khiên vàng rồng), 2 (khiên bạc cánh), 3 (khiên đồng ngọc lục) mỗi hạng một huy hiệu; hạng 4 trở đi dùng chung `r4` (khiên sắt tròn); **app tự ghi số hạng** giữa mặt huy hiệu bằng CSS (`.lb-rank-no`, màu chữ theo huy hiệu, tự thu nhỏ khi 3–4 chữ số); khung danh sách cao vừa top 10, cuộn trong khung để xem tới top 100.
- Hiện **hạng của tôi** ở **cuối bảng** (kể cả ngoài top 100) kèm nút "Xem vị trí của tôi" khi nằm trong danh sách nhưng ngoài top 10. Admin thấy "Tài khoản quản trị không tham gia xếp hạng"; người chưa có thẻ thấy "chưa có thẻ".
- Mỗi dòng: hạng (huy hiệu), ảnh đại diện + tên hiển thị (mục 3.11; mặc định là tên đăng nhập), level cao nhất (màu bậc khung), Lực chiến. Không hiện số thẻ. Có nút Làm mới.

### 6.7. Đấu trường PvP

Do chủ dự án yêu cầu, theo GDD `PVP.md`. Tab **Đấu trường** (`#pvp`, `apps/web/src/pages/Pvp.tsx`). Đối thủ là người chơi khác; **không thưởng**, chỉ thắng/thua. Đấu với AI đang để sau.

- **Đội hình**: 6 slot tướng chia **2 hàng** — slot 1–3 hàng trước (được +10% HP), slot 4–6 hàng sau (được +10% damage). Người chơi tự xếp đội hình; **tự động lưu** (không còn nút "Lưu"/"Hoàn tác"): người chơi ngừng chỉnh ~700ms là client gọi `POST /api/pvp/team` và hiện trạng thái *"Đang tự động lưu…"* / *"Đội hình được lưu tự động."*; chưa có đội thì server tự xếp 6 tướng mạnh nhất (theo Lực chiến/level) làm gợi ý. Lưu theo cặp (tướng, cấp) đang sở hữu — thẻ bị tiêu thụ lúc ghép không làm hỏng đội hình (mục 7.8g). Mỗi ô tướng hiện kèm **chỉ số cơ bản** (phong cách, sát thương, HP tối đa) do server tính qua `GET /api/pvp/generals/:id/combat`, client chỉ hiển thị, **không** hiện chi tiết kỹ năng cho gọn; **cấp độ** hiện dạng chip màu theo bậc như các chỗ khác. **Bấm vào ảnh đại diện** của tướng (cả đội mình lẫn đội địch) để mở **modal chi tiết dùng chung** `apps/web/src/components/CombatDetailModal.tsx` — cùng khung với popup ngắm thẻ ở Bộ sưu tập nhưng **không có thẻ lớn**: thay bằng **ảnh đại diện nhỏ** đứng cạnh tên (prop `art`) + bảng chi tiết (`CombatDetail`) **đầy đủ cả kỹ năng**. Có thể **kéo-thả** ô tướng này sang ô khác để đổi vị trí (Pointer Events — chạy cả chuột lẫn cảm ứng; đi quá ~6px mới tính là kéo, dưới ngưỡng là bấm mở bảng chọn tướng).
- **Chọn tướng (Picker)**: bấm vào ô đội hình để mở bảng chọn. **Bộ lọc** phía trên cho lọc theo **phe** (Ngụy/Thục/Ngô/Quần hùng) và theo **phong cách** (Tấn công/Hỗ trợ/Phòng thủ), mỗi nhãn kèm số tướng đang sở hữu; bấm lại nhãn đang chọn để bỏ lọc; vẫn có ô tìm theo tên. Mỗi dòng hiện **chỉ số thật** của tướng ở cấp cao nhất đang sở hữu (từ `ownedCombat` của `GET /api/pvp`) ở nhãn gọn *"⚔ sát thương · ❤ HP tối đa"*, **cấp độ đứng ngay cạnh ảnh đại diện**; muốn xem chi tiết thì **bấm vào ảnh đại diện** để mở **modal chi tiết dùng chung** `apps/web/src/components/CombatDetailModal.tsx` (cùng khung với Bộ sưu tập, **không có thẻ lớn** — thay bằng **ảnh đại diện nhỏ** cạnh tên qua prop `art`) hiện **phong cách, kỹ năng (tên chiêu + mô tả), nội tại và bảng chỉ số** (HP, sát thương, LC, chí mạng, hồi máu, choáng, hút máu) của tướng ở cấp cao nhất đang sở hữu — giống hệt chỗ bấm ảnh đại diện trên bàn đội hình; Chi tiết **không** hiện sẵn trong danh sách cho gọn. Bấm **bất kỳ chỗ nào khác trên dòng** để đưa tướng vào vị trí; tướng đang có trong đội được đánh dấu *"Đang ở vị trí X"* (viền xanh) ở cuối dòng.
- **Chuẩn bị khiêu chiến**: khi chọn đối thủ (từ bảng xếp hạng hoặc `#pvp/<id>`), một **modal** tự mở hiển thị 2 đội **2 bên trái/phải** (mình bên trái, đối thủ bên phải) để so sánh trực tiếp; sửa đội mình ngay trong modal (bấm ô để đổi, kéo-thả để đổi vị trí — tự lưu như trên) rồi bấm **Khiêu chiến** tại chỗ (màn hẹp tự xếp dọc). Trang Đấu trường chỉ còn dòng tóm tắt đối thủ + nút mở lại modal.
- **Vào trận**: chọn đối thủ bằng cách bấm vào người chơi trên **bảng xếp hạng** (mục 6.6) hoặc mở từ Đấu trường (`#pvp/<id>`); không được tự khiêu chiến chính mình. Trận giữa hai người được ghi lại và **xem lại được** từ cả hai phía (dữ liệu đối xứng).
- **Mô phỏng ở server**: `simulatePvp(sides, rand)` trong `apps/api/src/managers/pvp.engine.ts` là hàm thuần, chạy hết trận ngay khi khiêu chiến (client không gửi kết quả). Engine tất định theo seed nên lưu seed là tái dựng được (không cần lưu từng bước — SKILLS.md). **Thứ tự hành động** (LC do phong cách + cấp quyết định, `pvpLc`): hai đội **luân phiên nhau**, bên có **tổng lực chiến cả đội cao hơn** đi trước — vòng đầu đủ 6 vs 6 là **vị trí 1 của bên đi trước**, rồi **vị trí 1 của bên kia**, rồi **vị trí 2 của bên đi trước**, **vị trí 2 của bên kia**… cứ thế tới vị trí 6 (bằng tổng LC thì bên khiêu chiến A đi trước); không xếp theo LC từng tướng. Tướng đã gục bị bỏ qua nhưng **bên đi trước vẫn giữ quyền mở màn mỗi vòng**: nếu vị trí 1 của bên đó chết thì vòng sau bắt đầu bằng **vị trí còn sống gần nhất của bên đó** (A2) rồi mới tới vị trí 1 của đối thủ (B1), tiếp tục A3, B2… Chí mạng ×1,5 áp cho cả **sát thương lẫn hồi máu**. Hồi máu chủ động chọn mục tiêu theo kỹ năng: **toàn đội**, **1 đồng minh thấp máu nhất**, **hàng trước** hoặc **hàng sau** (SKILLS.md). Kỹ năng **tự hồi máu** (`SELF_HP`, mô tả cũ "*Bản thân +25% HP tối đa*") nay là **hồi 25% HP tối đa mỗi lượt ra đòn**, không cộng trần HP. Một số tướng được chỉ định có **hút máu**: hồi bản thân `cấp × 2%` sát thương gây ra (cấp 1 = 2% … cấp 10 = 20%), bù lại hệ số sát thương kỹ năng **giảm 10%** (áp trước khi nhân hot).
- **Phát lại ở client**: server trả `units` (snapshot đầu trận) + `events` (danh sách sự kiện có thứ tự) + `rounds`/`winner`; client dựng bàn đấu từ `units` rồi áp `events` tuần tự, có chỉnh tốc độ và thanh tiến trình. 2 đội nằm **2 bên trái/phải** ngăn bằng dải phân cách; tên kỹ năng thật (lấy từ `SKILLS.md`, ví dụ *"Hiệu lệnh thiên hạ"*) **bay lên trên ô tướng đang ra đòn** (kèm bảng tên chiêu ở giữa); số sát thương/hồi máu/buff nhảy trên đầu tướng **cỡ lớn, có viền + quầng sáng** cho dễ đọc, **luôn rõ nét** (giữ nguyên độ đậm suốt hoạt ảnh, không bị ô tướng choáng/gục làm nhạt; z-index cao nên không bị ảnh tướng che; chí mạng thì số to hơn hẳn, màu vàng); tướng bị choáng hiện **vòng sao xoay tròn** quanh ô để thấy rõ đang bị khống chế. Ô tướng hiện **thanh máu kèm số HP thật và %** (`1.500 · 62%`, sắp hết máu thì nhấp nháy vàng) và dòng **⚔ sát thương hiện tại · CM %** — thay cho LC; sát thương này **tự cộng các lớp buff đang hiệu lực** (đổi màu sáng khi đang được buff) và lớp buff hết hạn bị bỏ đúng như engine nhờ `expiresRound` trong sự kiện `buff`. **Diễn biến chi tiết hiện ngay trong lúc đang đánh** (cùng nội dung với tab *Diễn biến chi tiết* ở bảng kết quả, tự cuộn xuống dòng mới nhất). Kết quả **Thắng/Hòa/Thua** hiển thị **cỡ lớn có quầng sáng** cho dễ thấy. Nút **Kết quả** nhảy tới cuối trận và mở bảng kết quả (trận kết thúc tự nhiên cũng tự mở). Ở màn kết quả có nút **Khiêu chiến lại** để đánh lại chính đối thủ đó ngay.
- **Bảng kết quả trận**: 2 tab — *Tổng kết chỉ số* (mỗi tướng: sát thương gây ra, sát thương đã chịu, tổng hồi máu cho bản thân + đồng đội, số lần hạ/choáng/giải/buff) và *Diễn biến chi tiết* (từng lượt/hành động kèm avatar người thi triển → mục tiêu, **nhãn "Ta"/"Địch"** để biết dòng của bên nào, lượng sát thương/hồi máu, nhãn CHÍ MẠNG; hành động **tự hồi máu** hiện kèm lượng hồi cụ thể, ví dụ *"Điển Vi dùng Ác Lai hộ vệ (tự hồi 25% HP tối đa)"*, và hành động **buff** hiện lượng tăng cụ thể `+X% sát thương · +Y% HP tối đa · +Z điểm chí mạng` kèm nhãn **CHÍ MẠNG** khi lớp buff đó chí mạng). Tên hiệu ứng/chiêu hiển thị là **tên kỹ năng thật** (trường `skillName` theo `SKILLS.md`), không dùng nhãn chung. Tướng có **hút máu** hiện thêm *"hút máu X%"* ở ô tướng. Dữ liệu phân tích trọn từ `events`, không phụ thuộc tốc độ phát lại. Không gửi lại server trong lúc phát.
- **Cân bằng**: `packages/game-config/src/pvp.ts` (`PVP_MAX_ROUNDS` = 50, `pvpBaseHp`/`pvpBaseDamage` — **HP nền luôn gấp 10 lần sát thương nền**, cấp 1: 2000 HP ↔ 200 sát thương, +500 HP/+50 sát thương mỗi cấp; `PVP_SKILL_DEF` — mỗi kỹ năng kèm `teamBuff` (nhóm `TEAM_*`/`BUFF_ALLIES`), `PVP_CRIT_*`, `pvpProfile` — hệ số đã nhân hot ×1.1); nguồn cân bằng là `SKILLS.md`. Sát thương theo số mục tiêu (đơn 250%, hàng 180%/mục tiêu, toàn bộ 100%/mục tiêu); hồi máu cân theo số mục tiêu (toàn đội 110%, hàng 220%, thấp máu nhất 330%). Tướng có **hút máu** (`PVP_LIFESTEAL_BPS_PER_LEVEL` = 2%/cấp, `PVP_LIFESTEAL_DAMAGE_PENALTY_BPS` = −10% sát thương kỹ năng); `pvpProfile` trả thêm `skillName` (tên chiêu theo `SKILLS.md`) và `lifestealPerLevelBps`. Choáng đơn mục tiêu `cấp × 7%` (tối đa 70%), hàng/diện rộng `cấp × 3%`; choáng **chỉ kéo dài 2 lượt** (`PVP_STUN_ROUNDS` — gây ở lượt r thì mục tiêu bỏ lượt tới hết lượt r+1, đầu lượt r+2 tự hết; đang choáng thì không choáng chồng); giải choáng `30% + 5%×(cấp−1)` (30%→75%); tướng **sở hữu kỹ năng giải choáng miễn nhiễm choáng**. Buff tăng sức mạnh theo kỹ năng (`teamBuff`, nhóm `TEAM_*`/`BUFF_ALLIES`) **cộng dồn tối đa 3 lớp** (`PVP_SKILL_BUFF_MAX_LAYERS`), mỗi lớp hiệu lực **4 lượt** (`PVP_SKILL_BUFF_ROUNDS`); mỗi lớp **+10% HP tối đa** (`PVP_SKILL_BUFF_HP_BPS`, tăng trần HP và **hồi ngay đúng lượng trần tăng**), **+10% sát thương** (`PVP_SKILL_BUFF_DAMAGE_BPS`) và **+5 điểm chí mạng** (`PVP_SKILL_BUFF_CRIT_POINTS_BPS`); **%HP và %sát thương ăn chí mạng (×1,5)** theo **một lần roll chung cho cả lớp**. Validate khi khởi động qua `validate.ts` (`validatePvpConfig(assert)` — mỗi phe đúng 10 tướng hot). Hết 50 vòng không phân thắng bại → hoà.
- **Không ảnh hưởng vé/thẻ**: PvP không tiêu vé, không tạo thẻ, không thưởng; chỉ ghi nhật ký trận (`pvp_battles`).
- **Admin không tham gia**: mọi route PvP dùng `playerGuard` → admin bị 403 `ADMIN_NOT_PLAYER` (mục 3.8).

## 7. Database SQLite

Tên bảng có thể điều chỉnh, nhưng phải giữ nguyên các quy tắc nghiệp vụ và ràng buộc.

### 7.1. `users`

- `id`
- `username`
- `password_hash` nếu dùng đăng nhập bằng mật khẩu
- `created_at`
- `status` (`pending` | `approved`, migration v6)
- `is_admin` (0/1)
- `approved_at`
- `display_name` (migration v13; mặc định = `username`, mục 3.11)
- `avatar` (migration v13; data URL ảnh đã thu nhỏ hoặc `/generals/{artKey}.jpg`; null = mặc định, mục 3.11)

### 7.1b. `sessions`

- `token_hash` (PK, SHA-256 của token; token gốc không lưu), `user_id`, `created_at`, `expires_at`.
- Phiên đăng nhập lưu trong SQLite nên khởi động lại server **không** phải đăng nhập lại.
- **Không hết hạn** (chủ dự án yêu cầu; migration v11 cho `expires_at` = NULL và bỏ hạn các phiên cũ). Thời hạn cấu hình ở `SESSION_TTL_MS` (`apps/api/src/managers/auth.manager.ts`, `null` = không hạn).
- Đăng xuất xoá đúng phiên đó khỏi bảng; token cũ dùng lại → 401. Từ chối tài khoản chờ duyệt cũng xoá mọi phiên của tài khoản đó.

### 7.2. `generals`

- `id`
- `name`
- `faction`
- `art_key`
- Metadata tùy chọn.

Seed đúng 100 tướng đã định nghĩa tại mục 3.1. Tướng bị bỏ khỏi roster chỉ bị xóa khỏi bảng `generals` khi không còn thẻ/lịch sử tham chiếu.

### 7.3. `user_cards`

- `id`
- `user_id`
- `general_id`
- `level`
- `created_at`
- `updated_at`

Ràng buộc:

- Level từ 1 đến 10.
- Foreign key tới người sở hữu và tướng.
- Không unique theo cặp người chơi/tướng vì người chơi có thể sở hữu nhiều bản sao.
- Có index phục vụ truy vấn theo người chơi, tướng và level.
- Cần cơ chế trạng thái hoặc xóa có kiểm soát để đánh dấu thẻ đã bị tiêu thụ; lịch sử phải vẫn giữ được thông tin thẻ đầu vào.
- Không cho phép cùng một thẻ bị tiêu thụ nhiều lần.
- Khi tặng thẻ (mục 5.6), `user_id` được cập nhật sang người nhận; không tạo thẻ mới.

### 7.4. `user_tickets`

Quản lý số dư vé theo loại.

- `user_id`
- `ticket_type`
- `balance`
- `updated_at`

Ràng buộc:

- `ticket_type` thuộc `normal`, `shu`, `wei`, `wu`, `qun` (`qun` được thêm bằng migration v4; tài khoản cũ nhận dòng số dư Vé Quần = 0).
- Mỗi người chơi có tối đa một bản ghi cho mỗi loại vé.
- Số dư không âm.
- Không có giới hạn tồn kho nghiệp vụ; chỉ vé hồi theo thời gian dừng ở trần (thường 1000, phe 500, mục 3.6). Số dư có thể vượt trần nhờ nguồn khác.
- Chống overflow và giá trị không hợp lệ.
- Tổng số vé có thể được tính từ năm số dư hoặc được cache nếu cần, nhưng dữ liệu cache phải đồng bộ chính xác.

### 7.5. `ticket_recovery_state`

Quản lý mốc hồi vé.

- `user_id` — primary key.
- `last_processed_recovery_at`
- `updated_at`

Quy tắc:

- Timestamp lưu theo UTC.
- Trạng thái đủ để xác định mốc 5 phút đã xử lý.
- Không dùng bộ nhớ tiến trình làm nguồn trạng thái duy nhất.
- Xử lý mốc hồi, cấp vé và cập nhật trạng thái phải an toàn với request đồng thời.
- Mốc hồi chỉ bỏ (không cấp vé) khi cả 5 loại vé đều đạt `RECOVERY_CAP_PER_TYPE` (thường 1000, phe 500); mốc vẫn được đánh dấu đã xử lý.

Có thể gộp bảng này vào bảng tài khoản nếu thiết kế phù hợp, miễn là giữ nguyên tính nguyên tử và khả năng chống cấp trùng.

### 7.6. `ticket_transactions`

Ledger vé.

- `id`
- `user_id`
- `ticket_type`
- `amount_delta`
- `reason`
- `reference_id`
- `idempotency_key` nếu phù hợp
- `created_at`

Các reason tối thiểu:

- `time_recovery`
- `signup_bonus`
- `dev_topup`
- `admin_grant` (migration v6)
- `giftcode` (migration v8)
- `gacha_draw`
- `daily_reset`, `mission`, `achievement` (migration v12, mục 3.10)

Quy tắc:

- Ghi nhận từng loại vé đã cấp hoặc tiêu thụ.
- Số lượng cấp từ hồi thời gian được ghi rõ theo từng mốc.
- Không có reason `daily_claim` (thưởng ngày dùng `daily_reset`/`mission`/`achievement`, mục 3.10).
- Không cập nhật balance mà không có ledger phù hợp.
- Cấp vé, cập nhật trạng thái mốc hồi và ghi ledger phải nguyên tử.

### 7.7. `gacha_history`

- `id`
- `user_id`
- `ticket_type`
- `general_id`
- `card_level`
- `ticket_transaction_id`
- `idempotency_key`
- `created_at`

Không cần các trường Vàng hoặc phương thức thanh toán.

### 7.8. `upgrade_history`

- `id`
- `user_id`
- `input_card_ids_snapshot`
- `input_general_id`
- `input_level`
- `result_card_id`
- `result_level`
- `success_chance`
- `failure_chance`
- `outcome`
- `failure_distribution_snapshot`
- `idempotency_key`
- `created_at`

Yêu cầu:

- Lưu chính xác hai thẻ đầu vào đã tiêu thụ.
- Lưu tướng và level của hai thẻ đầu vào.
- Lưu kết quả thành công/thất bại và level của thẻ nhận.
- Lưu snapshot phân phối thất bại đã áp dụng.
- Lịch sử vẫn phải giải thích được kết quả khi cấu hình game thay đổi.
- Không dùng các trường `main_card_id` hoặc `mats_snapshot` theo mô hình thẻ chính/thẻ mồi cũ.

### 7.8b. `card_gifts`

Lịch sử tặng thẻ (migration v5).

- `id`
- `from_user_id`, `to_user_id` (foreign key tới `users`; CHECK khác nhau)
- `cards_snapshot` (JSON: id, tướng, level của từng thẻ tại thời điểm tặng)
- `card_count` (≥ 1)
- `idempotency_key` (UNIQUE theo người gửi)
- `created_at`

### 7.8c. `gift_codes`, `gift_code_redemptions` (migration v7)

- `gift_codes`: `id`, `code` (UNIQUE NOCASE), `rewards` (JSON `[{kind,pool,count}]`), `total_cards`, `total_tickets` (v8), `expires_at` (null = không hạn), `is_active`, `featured`, `created_by` (null = mặc định), `created_at`.
- `gift_code_redemptions`: `id`, `code_id`, `user_id`, `cards_snapshot` (JSON id/tướng/level), `card_count` (≥ 0), `tickets_snapshot` (v8, JSON `[{pool,count}]`), `created_at`; UNIQUE (`code_id`, `user_id`).

### 7.8d. `app_settings` (migration v10)

- `key` (PK), `value`, `updated_at`, `updated_by`. Hiện có `require_approval` (`'0'`/`'1'`, mặc định `'0'`).

### 7.8e. Nhiệm vụ (migration v12)

- `reward_claims`: `user_id`, `reward_key`, `auto` (0 bấm tay / 1 server tự nhận), `created_at`; PK (`user_id`, `reward_key`) — mỗi phần thưởng nhận 1 lần.
- `login_days`: `user_id`, `kind` (`game` | `calendar`), `day`, `created_at`; PK (`user_id`, `kind`, `day`).
- `daily_state`: `user_id` (PK), `last_game_day`, `last_cal_date`, `updated_at` — ngày mới chỉ xử lý 1 lần.
- Index `gacha_history(user_id, created_at)`, `upgrade_history(user_id, created_at)`.
- Ledger thêm reason `daily_reset`, `mission`, `achievement`; unique index (`user_id`, `reference_id`, `ticket_type`) cho 3 reason này.

### 7.8f. Hồ sơ người chơi (migration v13)

- Thêm cột `users.display_name` và `users.avatar`; `UPDATE users SET display_name = username` để tài khoản cũ có tên hiển thị mặc định (mục 3.11). `avatar` mặc định `NULL`.

### 7.8g. Đấu trường PvP (migration v14)

- `pvp_teams`: `user_id`, `slot` (1–6, CHECK), `general_id`, `level` (1–10, CHECK), `updated_at`; PK (`user_id`, `slot`). Lưu cặp (tướng, cấp) chứ không lưu `card_id` để đội hình không hỏng khi thẻ bị tiêu thụ lúc ghép (mục 6.7).
- `pvp_battles`: `id`, `attacker_id`, `defender_id`, `winner` (`a`|`b`|`draw`), `rounds`, `attacker_power`, `defender_power`, `data` (JSON: seed + `units` + `events` để phát lại), `created_at`. Index `(attacker_id, id)`, `(defender_id, id)`.
- Không thêm bảng/ledger vé: PvP không tiêu vé, không tạo thẻ.

### 7.9. Idempotency

Có thể dùng bảng idempotency riêng hoặc các unique constraint phù hợp để bảo đảm:

- Cùng người dùng và cùng thao tác không thể tạo kết quả trùng.
- Retry gacha không tiêu thêm vé hoặc tạo thêm thẻ.
- Retry nâng cấp không tiêu thụ lại hai thẻ.
- Retry xử lý mốc hồi không cấp vé trùng.
- Idempotency key được gắn với người dùng và loại thao tác.

### 7.10. Transaction và migration

- Bật `PRAGMA foreign_keys = ON` cho mỗi connection thích hợp.
- Dùng transaction cho thao tác gacha, nâng cấp và cấp vé hồi.
- Không cho phép hai thao tác đồng thời tiêu thụ cùng một thẻ.
- Không cho phép hai request cấp vé cho cùng một mốc.
- Xử lý ngày mới (thưởng reset, tự nhận nhiệm vụ ngày cũ) nguyên tử và chỉ một lần mỗi ngày (mục 3.10).
- Không xóa hoặc reset database người dùng khi khởi động.
- Migration có version, chạy theo thứ tự và an toàn.
- Nếu thay đổi schema, không làm mất lịch sử hoặc dữ liệu thẻ hiện có.
- Nếu repository đã có dữ liệu theo mô hình nâng cấp cũ, migration phải bảo toàn lịch sử cũ; không được giả định lịch sử cũ có thể chuyển hoàn toàn sang mô hình mới.

## 8. API Fastify

Tất cả API phải có schema validation, authentication phù hợp và định dạng lỗi nhất quán.

### 8.1. Tài khoản và bộ sưu tập

- `GET /api/me`: thông tin người chơi, số dư từng loại vé và trạng thái hồi vé.
- `GET /api/generals`: danh mục 100 tướng + `styles` (phong cách chiến đấu `attack`/`defense`/`support` của từng tướng — client hiện nhãn Tấn công/Phòng thủ/Hỗ trợ trên mọi thẻ tướng) + `skills` (kỹ năng chiến đấu của từng tướng — client hiện kỹ năng khi chọn tướng vào đội hình; mục 6.7).
- `GET /api/cards`: bộ sưu tập, filter và pagination.

### 8.2. Vé

- `GET /api/tickets`: số dư từng loại, tổng số vé, mốc hồi đã xử lý và thời gian đến mốc tiếp theo.
- `POST /api/tickets/claim-recovery`: xử lý các mốc hồi chưa xử lý.
- `POST /api/tickets/dev-topup`: nút cộng vé thử nghiệm (mục 3.7). Body chỉ gồm `idempotencyKey`. Trả 404 khi `ENABLE_DEV_TOPUP` tắt. Có rate limit.
- `GET /api/me` trả thêm `features.devTopup` và `features.devTopupAmount` để UI biết có hiển thị nút hay không.

#### `POST /api/tickets/claim-recovery`

Server phải:

1. Xác thực người chơi.
2. Lấy thời gian hiện tại từ server.
3. Đọc mốc hồi đã xử lý.
4. Xác định toàn bộ mốc hợp lệ chưa xử lý.
5. Roll loại vé cho từng mốc theo cấu hình.
6. Cộng số dư tương ứng từng loại.
7. Ghi ledger.
8. Cập nhật mốc đã xử lý.
9. Trả về số vé được cấp theo từng loại, số dư mới và thời gian đến mốc kế tiếp.

Các bước ghi dữ liệu phải nguyên tử hoặc có cơ chế batch/idempotency đủ an toàn để tiếp tục sau lỗi mà không mất hoặc cấp trùng vé.

Áp dụng trần vé hồi (Vé thường 1000, mỗi loại vé phe 500) (mục 3.6): chỉ random trong loại còn dưới trần; cả 5 loại đầy thì mốc không cấp vé. Response có thêm `skippedFull` (số mốc bị bỏ) và `GET /api/tickets` có `recoveryCap` (trần theo từng loại).

Không triển khai `POST /api/daily-claim`. Thưởng ngày đi qua nhiệm vụ (mục 3.10, `POST /api/quests/claim`).

### 8.3. Gacha

- `GET /api/gacha/config`: các loại vé, pool phe và tỷ lệ level công khai.
- `POST /api/gacha/draw`: quay bằng vé đã chọn, 1 hoặc 10 lượt, hoặc "Mở tất cả" (`count = DRAW_ALL_MAX` = 1000, quay min(1000, số dư)). `GET /api/gacha/config` trả `drawAllMax`.

Request gồm loại vé, số lần quay `count` (mặc định 1, phải thuộc `DRAW_COUNT_OPTIONS`) và idempotency key. Không nhận tướng, level, xác suất hoặc kết quả do client chỉ định.

Server xác thực số dư loại vé, xác định số lượt thực tế = min(count, số dư), rồi với mỗi lượt: tiêu thụ một vé, chọn tướng, roll level, tạo thẻ và ghi lịch sử. Tất cả trong cùng transaction. Response gồm `requested`, `drawn`, `results[]` và số dư vé mới.

### 8.4. Nâng cấp

- `POST /api/upgrades/preview`: tính tỷ lệ hiện tại dựa trên đúng hai thẻ đầu vào mà không thay đổi dữ liệu.
- `POST /api/upgrades/attempt`: thực hiện ghép thẻ nguyên tử.
- `POST /api/upgrades/quick`: Nâng cấp nhanh (mục 5.5). Body gồm `idempotencyKey` và `levels[]` tuỳ chọn (danh sách level đầu vào, mặc định Lv.1–5); server tự chọn thẻ. Response gồm `levels`, `merges`, `successes`, `failures`, `hasMore`, `results[]`. Có rate limit.
- `GET /api/gacha/config` trả thêm `upgradeInputCount`, `quickUpgradeMaxLevel` và `upgradeRates` (tỷ lệ ghép công khai theo level) để UI hiển thị.

Request gồm đúng hai card ID và idempotency key.

Server phải:

- Kiểm tra đủ hai ID duy nhất (đúng `UPGRADE_INPUT_COUNT`).
- Kiểm tra cả hai thẻ thuộc người dùng đang xác thực.
- Kiểm tra cả hai thẻ cùng `general_id` và cùng level.
- Kiểm tra level đầu vào từ 1 đến 9.
- Kiểm tra các thẻ chưa bị tiêu thụ và chưa được thao tác khác khóa.
- Tính lại tỷ lệ từ cấu hình server.
- Roll thành công/thất bại ở server.
- Nếu thành công, tạo một thẻ mới cùng tướng ở level đầu vào + 1.
- Nếu thất bại, roll level thẻ nhận từ phân phối thất bại đã cấu hình và tạo một thẻ mới cùng tướng.
- Tiêu thụ hai thẻ đầu vào, tạo thẻ nhận và ghi lịch sử trong cùng transaction.
- Không tin kết quả preview của client.
- Retry phải trả kết quả cũ, không tiêu thụ lại thẻ.

### 8.4b. Tặng thẻ

- Tạm tắt: khi `ENABLE_GIFT` tắt (mặc định), `POST /api/gifts` và `GET /api/users` trả 404 `FEATURE_DISABLED`; `GET /api/me` có `features.gift`.
- `POST /api/gifts`: body `{ toUsername, cardIds[], idempotencyKey }`. Server kiểm tra người nhận tồn tại và khác người gửi, số thẻ 1–20, không trùng ID, mọi thẻ thuộc người gửi và còn active, rồi đổi chủ nguyên tử. Lỗi: `RECIPIENT_NOT_FOUND`, `GIFT_TO_SELF`, `RECIPIENT_IS_ADMIN`, `GIFT_CARD_COUNT`, `DUPLICATE_CARD`, `CARD_NOT_FOUND`, `CARD_CONSUMED`. Có rate limit.
- `GET /api/users?q=&limit=`: danh sách người nhận cho dropdown, mọi người chơi trừ chính mình và admin, sắp theo lần tặng/nhận thẻ gần nhất với mình rồi theo tên; `q` lọc theo tên không phân biệt hoa thường. Cần đăng nhập. Chỉ trả `username` và `lastGiftAt`, không lộ thông tin khác.
- `GET /api/gacha/config` trả thêm `giftMaxCards`.
- `GET /api/history?kind=gift` lọc lịch sử tặng/nhận thẻ.

### 8.4c. Quản trị (chỉ admin, mục 3.8)

- `POST /api/auth/register` trả `{ status: 'pending', userId }` (không token), hoặc `{ status: 'approved', token, isAdmin, signupBonus }` với tài khoản đầu tiên.
- `GET /api/me` trả thêm `isAdmin`.
- `GET /api/admin/users?q=&status=&page=&pageSize=`: danh sách người chơi + `pendingCount`, `grantMaxTickets`.
- `POST /api/admin/users/:id/approve`, `POST /api/admin/users/:id/reject`.
- `POST /api/admin/users/:id/admin`: body `{ isAdmin }`.
- `GET /api/admin/settings` → `{ requireApproval }`; `POST /api/admin/settings` body `{ requireApproval }` (bật/tắt duyệt tài khoản).
- `POST /api/admin/tickets/grant`: body `{ userId, ticketType, amount, idempotencyKey }`. Lỗi: `INVALID_AMOUNT`, `NOT_APPROVED`, `TARGET_IS_ADMIN`, `IDEMPOTENCY_KEY_REUSED`.
- Route chơi game gọi bằng tài khoản admin → 403 `ADMIN_NOT_PLAYER` (mục 3.8).
- `GET /api/admin/cards?userId=&faction=&level=&q=&sort=&page=&pageSize=`: thẻ active của mọi người chơi kèm `username`.
- Có rate limit cho các thao tác ghi.

### 8.4d. Giftcode (mục 3.9)

- `GET /api/giftcodes`: `featured[]` (code gợi ý còn hiệu lực + `redeemed`), `redeemed[]` (code mình đã nhập).
- `POST /api/giftcodes/redeem`: body `{ code }`. Lỗi: `GIFTCODE_NOT_FOUND`, `GIFTCODE_EXPIRED`, `GIFTCODE_ALREADY_REDEEMED`. Có rate limit.
- `GET /api/admin/giftcodes`, `POST /api/admin/giftcodes` (body `{ code, rewards[], expiresAt?, featured? }`; lỗi `INVALID_CODE`, `INVALID_REWARDS`, `INVALID_EXPIRY`, `GIFTCODE_EXISTS`), `POST /api/admin/giftcodes/:id/active` (body `{ isActive }`). Chỉ admin.
- `POST /api/giftcodes/redeem` trả `tickets[]` và `balances` (số dư vé mới).
- `POST /api/admin/giftcodes/:id/active` bật code thẻ cũ → 409 `GIFTCODE_LEGACY`.
- `GET /api/gacha/config` trả thêm `giftCodeMaxTickets`.

### 8.4e. Bảng xếp hạng (mục 6.6)

- `GET /api/leaderboard`: cần đăng nhập, có rate limit. Trả `{ metric: 'power', powerByLevel, top, items[] (≤ 100: rank, username, displayName, avatar, power, cardCount, maxLevel, isMe), me (null nếu là admin; rank null nếu chưa có thẻ), totalRanked, generatedAt }`. `displayName`/`avatar` theo hồ sơ (mục 3.11), mặc định `displayName` = `username`, `avatar` = null. Không lộ thông tin khác của người chơi.

### 8.4f. Nhiệm vụ & thành tựu (mục 3.10)

- `GET /api/quests`: `gameDay`, `nextResetAt`, `calendarDate`, `resetBonus { tickets, granted }`, `daily[]`, `faction{wei,shu,wu,qun}[]`, `login { month, days[] }`, `achievements[] (nhóm + mốc)`, `claimable`. Mỗi mục có `key`, `progress`, `target`, `reward {pool,count}`, `status` (`progress` | `claimable` | `claimed`).
- `POST /api/quests/claim`: body `{ keys?: string[] }` (bỏ trống = nhận tất cả). Trả `{ claimed[], balances }`. Không có gì để nhận → 409 `NOTHING_TO_CLAIM`. Có rate limit.
- `GET /api/me` và `POST /api/tickets/claim-recovery` trả thêm `dailyEvents { resetBonus, autoClaimed[] }` khi request đó vừa xử lý ngày mới.

### 8.4g. Hồ sơ người chơi (mục 3.11)

- `GET /api/me/profile`: trả `{ displayName, avatar }` (cần đăng nhập).
- `POST /api/me/profile`: body `{ displayName?, avatar? }` (bỏ trống = giữ nguyên; `avatar: null` = xoá ảnh). Chỉ cập nhật field có mặt; không có field nào → 400 `NOTHING_TO_UPDATE`. Lỗi: `INVALID_DISPLAY_NAME`, `INVALID_AVATAR`, `AVATAR_TOO_LARGE`. Trả hồ sơ mới. Có rate limit.
- `POST /api/me/password`: body `{ currentPassword, newPassword }` (mỗi trường 6–128). Lỗi: `INVALID_PASSWORD`, `SAME_PASSWORD`. Trả `{ ok: true }`. Có rate limit.
- `GET /api/me` trả thêm `displayName` và `avatar` (mục 3.11).

### 8.4h. Đấu trường PvP (mục 6.7)

Mọi route dưới `/api/pvp` (trừ route chi tiết chiến đấu) dùng `playerGuard` (admin → 403 `ADMIN_NOT_PLAYER`), cần đăng nhập và có rate limit.

- `GET /api/pvp`: tổng quan — đội hình đang lưu (hoặc gợi ý tự xếp) + `saved`, thành tích thắng/thua/hoà, `powerByLevel`, `ownedCombat` (chi tiết chiến đấu của từng tướng đang sở hữu ở cấp cao nhất — Picker dùng để hiện chỉ số + kỹ năng chi tiết).
- `POST /api/pvp/team`: body `{ units: [{ slot, generalId, level }] }`. Lỗi: `CARD_NOT_OWNED`, `DUPLICATE_GENERAL`, `DUPLICATE_SLOT`, `INVALID_GENERAL`. Lưu trong transaction sau khi xác thực quyền sở hữu.
- `GET /api/pvp/opponent/:id`: xem đội hình + hồ sơ đối thủ. Lỗi: `SELF_CHALLENGE`, `OPPONENT_NOT_FOUND`.
- `POST /api/pvp/challenge`: body `{ opponentId }`. Server mô phỏng trọn trận rồi trả `units` + `events` + `rounds`/`winner` để phát lại. Lỗi: `TEAM_EMPTY`, `OPPONENT_NO_TEAM`, `SELF_CHALLENGE`, `OPPONENT_NOT_FOUND`.
- `GET /api/pvp/battles?page=&pageSize=`: lịch sử trận (mình là bên khiêu chiến hoặc bị khiêu chiến).
- `GET /api/pvp/battles/:id`: chi tiết một trận để phát lại; người ngoài cuộc → 404. Trả thêm `mySide` để client hiển thị đúng phía.
- `GET /api/pvp/generals/:id/combat?level=`: chi tiết chiến đấu của một tướng ở một cấp (`PvpCombatDto`: phong cách, kỹ năng, nội tại, chỉ số nền/riêng tướng, buff hàng) — modal xem thẻ ở Bộ sưu tập. Chỉ số `self` là của **riêng tướng** (nội tại + cấp); buff tăng sức mạnh theo kỹ năng (`teamBuff`) **không cộng sẵn ở ảnh chụp đầu trận** mà phát dần mỗi lượt tới lượt khi vào trận (mục 6.7), buff theo hàng cũng chỉ áp khi vào trận. Chỉ là dữ liệu cấu hình nên dùng `authGuard` (không cần đăng nhập thao tác chơi). Lỗi: `GENERAL_NOT_FOUND`.

### 8.5. Lịch sử

- `GET /api/history`: lịch sử phân trang.
- Có thể bổ sung endpoint lịch sử vé nếu cần.

Không tạo API ví Vàng, mua vé, nạp tiền hoặc `daily-claim` riêng trong MVP (thưởng ngày đi qua nhiệm vụ, mục 3.10). Ngoại lệ: `POST /api/tickets/dev-topup` (cộng vé thử nghiệm miễn phí, bật/tắt bằng cấu hình) và `POST /api/admin/tickets/grant` (admin cộng vé, mục 3.7–3.8).

## 9. Bảo mật và tính đúng đắn

- RNG chạy ở backend.
- Client không gửi kết quả mong muốn.
- Không tin `user_id`, xác suất, level kết quả hoặc quyền sở hữu từ client.
- Kiểm tra quyền sở hữu tất cả card ID trong mọi request.
- Chặn ID không tồn tại, dùng thẻ của người khác, dùng thẻ đã tiêu thụ và ghép thẻ level 10.
- Nâng cấp yêu cầu đúng hai card ID duy nhất, cùng tướng và cùng level.
- Chống request lặp bằng idempotency key hoặc cơ chế tương đương.
- Idempotency key phải gắn với người dùng và loại thao tác.
- Retry sau khi request thành công phải trả kết quả đã lưu.
- Dùng transaction, unique constraint và concurrency control.
- Tính mốc hồi bằng thời gian server và UTC.
- Không dùng đồng hồ client để cấp vé.
- Trần duy nhất là trần vé hồi (Vé thường 1000, mỗi loại vé phe 500) (mục 3.6); nguồn khác cộng vượt trần được.
- Chống integer overflow và số dư âm.
- Validate tất cả bảng tỷ lệ trước khi sử dụng.
- Phân phối thất bại chỉ được roll sau khi xác định nâng cấp thất bại.
- Không ghi password, token hoặc dữ liệu nhạy cảm vào log.
- Rate limit endpoint gacha và nâng cấp.
- Không tự động reset database hoặc xóa dữ liệu người dùng.
- Mọi thay đổi số dư vé phải truy vết được bằng ledger.

## 10. Testing và tiêu chí hoàn thành MVP

### 10.1. Roster

- Có đúng 100 tướng.
- Mỗi phe có chính xác 25 tướng.
- ID duy nhất.
- Phe hợp lệ.
- Seed chạy lặp an toàn.
- Pool vé thường có 100 tướng.
- Pool vé Thục, Ngụy, Ngô và Quần có đúng 25 tướng tương ứng.

### 10.2. Cấp vé ngẫu nhiên

- Năm loại vé có xác suất mặc định 20% mỗi loại.
- Tổng xác suất bằng 100%.
- Không có xác suất âm.
- Mỗi lần cấp tạo đúng một loại vé.
- Mỗi mốc hồi cấp đúng một vé, loại vé được roll độc lập.
- Không dùng RNG client.
- Retry không tạo vé trùng.
- Ledger khớp với số dư từng loại.
- Thưởng ngày chỉ đến từ mục 3.10 (reset 05:00, nhiệm vụ, điểm danh), không cấp vé ngày ở chỗ khác.
- Tài khoản mới nhận đúng 100 vé quà đăng ký, loại vé roll độc lập; ledger khớp số dư.
- Đăng nhập lại hoặc đăng ký trùng tên không cấp thêm quà đăng ký.
- Admin cộng vé: đúng loại + số lượng, ledger `admin_grant` khớp số dư; retry cùng key không cộng thêm; quá trần/số âm bị từ chối; không cộng cho tài khoản chờ duyệt; người không phải admin bị 403.
- Quà đăng ký cấp lúc duyệt; duyệt lại không cấp thêm.
- Nút cộng vé: tắt mặc định (404); khi bật, mỗi lần bấm cộng đúng 50 vé, loại vé roll độc lập; retry cùng key không cộng thêm; lỗi giữa chừng không cấp vé; ledger khớp số dư.

### 10.3. Vé hồi theo thời gian

- Hồi đúng mỗi mốc 5 phút (phút 00, 05, 10, …, 55).
- Không hồi sớm hơn mốc.
- Xử lý đúng qua giờ mới, ngày mới và thời gian offline dài.
- Xử lý đủ mọi mốc chưa xử lý; cấp vé tới trần rồi dừng (offline 30 ngày → Vé thường đúng 1000, mỗi vé phe đúng 500).
- Mốc hồi chỉ ra loại còn dưới trần (Vé thường 600 vẫn được hồi); cả 5 loại đầy thì không cấp vé, không ghi ledger, không cộng bù.
- Vé vượt trần từ nguồn khác (VD Vé thường 1010) được giữ nguyên.
- Không cấp trùng khi refresh hoặc retry.
- Xử lý an toàn với request đồng thời.
- Không mất mốc khi server khởi động lại.
- Có thể tiếp tục xử lý batch sau lỗi mà không mất hoặc cấp trùng vé.

### 10.4. Gacha

- Vé thường chọn trong 100 tướng.
- Vé phe chỉ chọn tướng thuộc phe tương ứng.
- Xác suất level bằng cấu hình.
- Quay thẻ không bao giờ tạo level ngoài 1–9; RNG ra giá trị cao nhất cho đúng level 9.
- Tiêu thụ đúng một vé cho mỗi lần quay thành công.
- Không tiêu vé khi thao tác thất bại trước khi commit.
- Retry không tạo thêm thẻ hoặc tiêu thêm vé.
- Có thể sở hữu nhiều bản sao cùng tướng.
- Quay ×10 khi đủ vé tiêu đúng 10 vé, tạo đúng 10 thẻ, 10 dòng ledger và 10 dòng lịch sử.
- Quay ×10 khi còn ít hơn 10 vé thì quay hết số vé còn lại, không đụng loại vé khác.
- Quay ×10 nguyên tử: lỗi giữa chừng không tiêu vé, không tạo thẻ.
- Retry quay ×10 cùng key trả kết quả cũ; số lần quay ngoài cấu hình (kể cả 5, 999, 1001) bị từ chối.
- Mở tất cả: 1200 vé → lần 1 quay đúng 1000 (chỉ loại đã chọn), lần 2 quay 200; retry cùng key không tiêu thêm; ledger khớp.

### 10.5. Nâng cấp ghép 2 thẻ

- Chỉ chấp nhận đúng hai card ID duy nhất.
- Gửi 1 hoặc 3 card ID bị từ chối (`WRONG_CARD_COUNT`), không tiêu thụ thẻ nào.
- Cả hai thẻ thuộc cùng người chơi.
- Cả hai thẻ cùng `general_id`.
- Cả hai thẻ cùng level.
- Level đầu vào chỉ từ 1 đến 9.
- Tính đúng tỷ lệ thành công theo level.
- Xác suất thành công và thất bại tổng bằng 100%.
- Phân phối thất bại từng level có tổng bằng 100%.
- Không có kết quả thất bại vượt level đầu vào.
- Không có kết quả thấp hơn level 1.
- Level 1 chỉ giữ nguyên khi thất bại.
- Level 10 không thể ghép lên level cao hơn.
- Thành công tiêu thụ hai thẻ và tạo đúng một thẻ cùng tướng ở level +1.
- Thất bại tiêu thụ hai thẻ và tạo đúng một thẻ cùng tướng ở level được roll.
- Không có bonus thẻ mồi, bonus cùng phe hoặc bonus chênh lệch level.
- Retry không tiêu thụ lại hai thẻ.
- Concurrent requests không thể tiêu thụ cùng một thẻ nhiều lần.
- Snapshot lịch sử đủ để giải thích kết quả theo cấu hình tại thời điểm thực hiện.
- Nâng cấp nhanh: ghép dây chuyền mọi cặp trong các level được chọn (mặc định Lv.1–5), level thấp trước; không đụng thẻ ngoài danh sách chọn; mỗi lần ghép một dòng lịch sử; nguyên tử (lỗi giữa chừng không tiêu thẻ nào); retry cùng key trả kết quả cũ; chỉ dùng thẻ của chính người chơi; không có cặp => `NOTHING_TO_UPGRADE`.

### 10.5b. Tặng thẻ

- Tắt `ENABLE_GIFT`: `/api/gifts`, `/api/users` → 404 `FEATURE_DISABLED`, không thẻ nào bị chuyển.
- Tặng chuyển đúng thẻ sang người nhận, giữ nguyên tướng/level; người gửi mất thẻ, người nhận dùng được thẻ để ghép.
- Tối đa 20 thẻ; 0 hoặc 21 thẻ bị từ chối, không thẻ nào bị chuyển.
- Từ chối tặng chính mình, người nhận không tồn tại, thẻ của người khác, thẻ đã tiêu thụ, trùng ID; mọi lỗi đều huỷ cả giao dịch.
- Retry cùng key trả kết quả cũ, không chuyển lần hai.
- Lịch sử hiển thị đúng chiều gửi/nhận cho cả hai người.
- Danh sách người nhận: không có chính mình; người giao dịch gần nhất lên đầu, còn lại A→Z; tìm kiếm không phân biệt hoa thường; ký tự `%`/`_` không thành wildcard.

### 10.5c. Duyệt tài khoản và quản trị

- Cài đặt Duyệt tài khoản mặc định tắt; chỉ admin đổi được (401/403); đổi xong áp dụng ngay cho lượt đăng ký kế tiếp.
- Tắt: đăng ký được duyệt ngay, có token, nhận 100 vé, không phải admin.
- Bật: tài khoản đầu tiên là admin, được duyệt; tài khoản sau `pending`, không token, đăng nhập → `ACCOUNT_PENDING`.
- Duyệt cấp đúng 100 vé, mốc hồi tính từ lúc duyệt; từ chối xoá đăng ký, tên dùng lại được.
- Route admin: 401 khi chưa đăng nhập, 403 khi không phải admin; không tự thu quyền admin.
- Admin không chơi game: thao tác người chơi → 403 `ADMIN_NOT_PLAYER`, không có thưởng ngày; không cộng vé cho admin (`TARGET_IS_ADMIN`); không tặng thẻ cho admin (`RECIPIENT_IS_ADMIN`); danh sách người nhận không có admin.
- Admin xem được thẻ của mọi người chơi, lọc theo người chơi.
- Migration v6 giữ nguyên dữ liệu, tài khoản cũ đã duyệt, id nhỏ nhất là admin.

### 10.5d. Giftcode

- 4 code tân thủ là 200 vé mỗi loại phe, không hạn; nhập cộng đúng loại vé, ledger `giftcode` khớp số dư, không tạo thẻ.
- Code nhiều loại vé cộng đúng từng loại (gộp dòng cùng loại); không tạo thẻ; không phân biệt hoa thường.
- Tạo code có thẻ bị từ chối; code thẻ cũ không nhập được, không bật lại được.
- Lỗi giữa chừng không cộng vé nào.
- Migration v8 giữ lượt nhập cũ, đổi 4 code tân thủ thành vé; migration v9 tắt code thẻ cũ.
- Nhập lại cùng code bị chặn; người chơi khác vẫn nhập được.
- Code hết hạn, đã tắt, không tồn tại bị từ chối, không cộng vé.
- Admin tạo code chặn trùng mã, vượt trần, hạn trong quá khứ; người thường bị 403.

### 10.5e. Bảng xếp hạng

- Lực chiến = tổng 2^(lv−1) của các cặp (tướng, cấp) khác nhau đang active (thẻ trùng tướng + cấp không cộng thêm); thẻ đã tiêu thụ không tính.
- Đồng điểm đồng hạng; trong cùng hạng level cao nhất xếp trước.
- Trả kèm `displayName`/`avatar` theo hồ sơ (mục 3.11): mặc định `displayName` = `username`, `avatar` = null; đổi tên/ảnh thì bảng xếp hạng phản ánh ngay.
- Admin không xuất hiện, `me` = null; người chưa có thẻ có `rank` null.
- Tối đa 100 người; hạng của mình ngoài top vẫn trả về đúng.
- `/api/leaderboard` 401 khi chưa đăng nhập.

### 10.5f. Nhiệm vụ & thành tựu

- Ngày game đổi lúc 05:00 giờ Việt Nam; ngày dương lịch đổi lúc 00:00 giờ Việt Nam.
- Thưởng reset 25 vé chỉ 1 lần mỗi ngày game; vắng nhiều ngày không cộng bù.
- Quay 30 lần đạt cả nhiệm vụ quay 10; "Hoàn thành 5 nhiệm vụ" chỉ đếm 6 nhiệm vụ chung khác.
- Nhiệm vụ phe đếm đúng loại vé/phe, thưởng vé đúng phe.
- Nhận 2 lần → `NOTHING_TO_CLAIM`; ledger khớp số vé.
- Sang ngày mới tự nhận nhiệm vụ ngày cũ đã đạt chưa nhận; sang tháng mới tự nhận điểm danh chưa nhận.
- Thành tựu sở hữu thẻ: mỗi mốc 1 lần, bỏ thẻ ra rồi đưa lại không nhận lần nữa.
- Thành tựu tính cả lịch sử cũ.

### 10.5g. Đấu trường PvP

- Engine tất định: cùng seed + cùng đội hình → cùng kết quả; idx theo slot (A = 0–5, B = 6–11); hàng trước +10% HP, hàng sau +10% damage; thứ tự hành động: hai đội luân phiên nhau, bên tổng LC cao hơn đi trước và **giữ quyền mở màn mỗi vòng** (đủ 6v6: A1, B1, A2, B2…; nếu A1 đã gục thì vòng đó là A2, B1, A3, B2…).
- Buff tăng sức mạnh theo kỹ năng (nhóm `TEAM_*`/`BUFF_ALLIES`) phát **mỗi lượt tới lượt** một lớp cho **toàn bộ đồng minh còn sống (kể cả bản thân)**; mỗi lớp **+10% HP tối đa (tăng trần HP và hồi ngay đúng lượng trần tăng) + 10% sát thương + 5 điểm chí mạng**; **%HP và %sát thương ăn chí mạng (×1,5)** theo **một lần roll chung cho cả lớp**; **cộng dồn tối đa 3 lớp**, mỗi lớp **4 lượt**; tướng hot ×1.1 hệ số kỹ năng (không nhân `teamBuff`); tướng `TEAM_*` vừa đánh thường 100% (hot 110%) vừa phát buff, `BUFF_ALLIES` chỉ phát buff.
- Chí mạng ×1,5 xảy ra đúng theo RNG — áp cho cả sát thương lẫn hồi máu (hồi đồng minh và tự hồi); hồi máu chủ động nhắm đúng mục tiêu theo kỹ năng (toàn đội / 1 đồng minh thấp máu nhất / hàng trước / hàng sau); choáng chỉ kéo dài 2 lượt rồi tự hết, tướng có kỹ năng giải choáng **miễn nhiễm choáng**; buff tác động lên đồng minh đúng như định nghĩa.
- Màn kết quả trận có nút **Khiêu chiến lại** (đánh lại cùng đối thủ ngay).
- Giao diện xếp đội: kéo-thả đổi vị trí tướng (chuột + cảm ứng); Picker hiện chỉ số ở mỗi dòng + cấp cạnh ảnh đại diện, bấm cả dòng để chọn, bấm ảnh đại diện để mở chi tiết đầy đủ, đánh dấu tướng đã trong đội; modal chuẩn bị khiêu chiến tự mở khi chọn đối thủ và cho sửa đội ngay tại chỗ.
- Diễn biến chi tiết hiện **lượng tăng** của buff (`+X% sát thương · +Y% HP tối đa · +Z điểm chí mạng`, nhãn CHÍ MẠNG khi lớp đó chí mạng) và lượng tự hồi máu; số sát thương/hồi máu trên sân không bị ảnh tướng che và **cỡ lớn, rõ ràng** (chí mạng to hơn hẳn); Picker mở chi tiết tướng đầy đủ (cùng component với popup ngắm thẻ) khi bấm vào ảnh đại diện.
- Modal chi tiết dùng chung cho cả Bộ sưu tập lẫn Đấu trường: Đấu trường không có thẻ lớn mà hiện **ảnh đại diện nhỏ cạnh tên** (prop `art`), bảng chi tiết **đầy đủ cả kỹ năng** như nhau; nền phủ tối trung tính (bỏ tông đỏ).
- Đánh bại toàn bộ một bên → bên kia thắng; hết `PVP_MAX_ROUNDS` (50) mà cả hai còn sống → `draw`/`timeout`.
- Mọi kỹ năng trong roster đều có định nghĩa (`PVP_SKILL_DEF`); `validatePvpConfig()` chạy khi khởi động.
- HTTP: 401 khi chưa đăng nhập, 403 `ADMIN_NOT_PLAYER` với admin; tự xếp đội gợi ý khi chưa lưu.
- Lưu đội: từ chối `CARD_NOT_OWNED`, `DUPLICATE_GENERAL`, `DUPLICATE_SLOT`, `INVALID_GENERAL`.
- Xem đối thủ: chặn `SELF_CHALLENGE`, `OPPONENT_NOT_FOUND`.
- Khiêu chiến: mô phỏng trọn trận, ghi lịch sử, xem lại được; người ngoài cuộc 404; `mySide` và thành tích đối xứng; đội trống → `TEAM_EMPTY` hoặc `OPPONENT_NO_TEAM`.
- PvP không tiêu vé, không tạo thẻ, không thưởng.

### 10.6. Database và API

- Phiên đăng nhập còn sau khi khởi động lại server (mở lại file DB), không hết hạn; đăng xuất xoá phiên, token cũ → 401.

- Migration chạy thành công trên database mới.
- Migration không phá dữ liệu hiện có.
- Foreign key và constraint hoạt động.
- Concurrent requests không cấp trùng vé.
- Concurrent requests không tiêu thụ cùng thẻ hai lần.
- API xác thực và validate đầu vào.
- API không để client quyết định kết quả RNG.
- Lịch sử và ledger phản ánh chính xác thay đổi dữ liệu.
- Không có endpoint `daily-claim` riêng; thưởng ngày qua `/api/quests` (mục 3.10).

### 10.7. UI

- Hiển thị chính xác số dư từng loại vé và tổng số vé.
- Số vé hiển thị kèm trần vé hồi dạng `số dư / trần` (VD `510 / 500`, Vé thường `/ 1000`) ở thanh vé và ô chọn vé trang Quay thẻ.
- Hiển thị đồng hồ đến mốc hồi kế tiếp; loại vé đạt trần (thường 1000, phe 500) có nhãn MAX, cả 5 loại đầy thì hiện "Vé hồi đã đầy".
- Có loading, empty state và error state.
- Chọn đúng pool tướng theo loại vé.
- Animation khớp với kết quả server.
- UI nâng cấp yêu cầu đúng hai thẻ cùng level và cùng tướng.
- UI nâng cấp hiển thị thẻ cùng tướng liền nhau với mọi kiểu sắp xếp.
- UI hiển thị đầy đủ phân phối thất bại.
- UI cảnh báo hai thẻ đầu vào sẽ bị tiêu thụ.
- Chặn thao tác lặp khi request đang xử lý.
- Hoạt động trên desktop và mobile (≤ 640px: thanh trên gọn, vé/tab cuộn ngang, bottom sheet "Đã chọn" ở Nâng cấp, ô nhập ≥ 16px).
- Hỗ trợ reduced motion.
- Không có thưởng đăng nhập, nút nạp tiền, cửa hàng vé hoặc mua vé bằng Vàng.
- Không có nút "+50 vé" trên UI.
- Mọi danh sách thẻ (Bộ sưu tập, Nâng cấp, Quản trị) mặc định sắp xếp level cao nhất.
- Nút Nâng cấp nhanh có checkbox chọn level (mặc định Lv.1–5), hiển thị số cặp có thể ghép, bảng tỷ lệ theo level đã chọn, bước xác nhận, khóa khi đang xử lý và tổng kết sau khi xong.
- Bộ sưu tập gom thẻ theo tướng; tặng thẻ (khi bật) nằm trong Bộ sưu tập với dropdown người nhận có tìm kiếm, sắp theo giao dịch gần nhất.
- Đăng ký hiển thị thông báo chờ duyệt; tab Quản trị chỉ hiện với admin; admin chỉ thấy tab Quản trị (không có tab game, thanh vé).
- Có tab Giftcode; popup lần đầu đăng nhập mời nhập code gợi ý.
- Có tab Xếp hạng: top 10 nổi bật, cuộn tới top 100, luôn hiện hạng của mình; không có admin.
- Có tab Nhiệm vụ (Hằng ngày / Điểm danh / Thành tựu) với nút Nhận, Nhận tất cả, badge số phần thưởng chờ nhận, đồng hồ tới 05:00; toast khi có thưởng ngày mới hoặc tự nhận.

## 11. Nguyên tắc triển khai cho Claude Code

Trước khi sửa code:

1. Đọc `CLAUDE.md`.
2. Kiểm tra repository và trạng thái hiện tại.
3. Xác định phần nào đã có, phần nào còn thiếu.
4. Đề xuất thay đổi phù hợp với kiến trúc hiện tại.
5. Không tạo lại file hoặc hệ thống đã tồn tại nếu không cần thiết.

Khi triển khai:

- Ưu tiên hoàn thành schema và game logic trước, rồi đến API và UI.
- Tách cấu hình khỏi business logic.
- Không hardcode xác suất ở nhiều nơi.
- Không để frontend tự tính kết quả gacha hoặc nâng cấp.
- Viết test cho các quy tắc tài nguyên, thời gian và xác suất.
- Chạy các lệnh kiểm tra phù hợp với repository thực tế.
- Không tuyên bố hoàn tất nếu còn lỗi build hoặc test chưa được xử lý.
- Không thêm tính năng ngoài phạm vi.
- Khi thay đổi đặc tả, tìm và cập nhật mọi tham chiếu cũ để tránh mâu thuẫn giữa schema, API, UI, lịch sử và test.

Thứ tự ưu tiên:

1. Tính đúng đắn dữ liệu và giao dịch.
2. Tính đúng đắn của vé, gacha và ghép thẻ.
3. Bảo mật và chống request trùng.
4. Kiến trúc dễ bảo trì.
5. UX và animation.
6. Các tính năng bổ sung khi được yêu cầu.

## 12. Phạm vi MVP đã chốt

- 100 tướng, 25 tướng mỗi phe.
- 5 loại vé: thường, Thục, Ngụy, Ngô, Quần.
- Vé miễn phí hồi 1 vé mỗi 5 phút theo mốc đồng hồ server.
- Duyệt tài khoản bật/tắt trên trang Quản trị (mặc định tắt: đăng ký là vào game ngay); tài khoản mới nhận 100 vé quà đăng ký một lần lúc được duyệt (loại vé random theo mục 3.5).
- Trang Quản trị: duyệt/từ chối đăng ký, danh sách người chơi, admin cộng vé (chọn loại + số lượng), xem mọi thẻ của mọi người chơi, tạo/bật/tắt giftcode.
- Giftcode chỉ tặng vé quay (nhiều loại + số lượng, hạn tuỳ chọn, mỗi người nhập 1 lần); 4 code tân thủ THUCQUOC/NGUYQUOC/NGOQUOC/QUANQUOC, mỗi code 200 vé phe tương ứng.
- Không có nút "+50 vé" trên UI; endpoint thử nghiệm chỉ chạy khi server bật `ENABLE_DEV_TOPUP` (mặc định tắt).
- Người chơi offline vẫn tích lũy đầy đủ các mốc hợp lệ.
- Nhiệm vụ hằng ngày (chung + phe), thưởng reset 05:00 (25 vé, chỉ ngày hiện tại), điểm danh theo tháng, thành tựu; bấm Nhận, nhiệm vụ ngày cũ tự nhận khi sang ngày.
- Mỗi vé được cấp sẽ random loại với xác suất mặc định 20% cho mỗi loại.
- Vé hồi theo thời gian dừng ở trần: Vé thường 1000, mỗi vé phe 500; nhiệm vụ/giftcode/admin… vẫn cộng vượt trần (giữ nguyên số dư vượt).
- Có vé Quần, quay trong 25 tướng Quần.
- Không có nạp tiền, mua vé bằng Vàng, thanh toán thật hoặc cửa hàng vé.
- Vé thường quay trong toàn bộ 100 tướng.
- Vé Thục, Ngụy, Ngô và Quần quay trong pool 25 tướng của phe tương ứng.
- Level thẻ từ 1 đến 10.
- Gacha roll level theo bảng xác suất đã định nghĩa, tối đa level 9; level 10 chỉ có qua ghép thẻ.
- Trang Nâng cấp gom thẻ cùng tướng nằm liền nhau.
- Nút Nâng cấp nhanh tự ghép mọi cặp thẻ thuộc các level được tick chọn (mặc định Lv.1–5) trong một thao tác nguyên tử.
- Tặng thẻ (đang tạm tắt, bật bằng `ENABLE_GIFT`) cho người chơi khác (chọn từ dropdown mọi người chơi, ưu tiên người giao dịch gần nhất), tối đa 20 thẻ mỗi lần, nguyên tử; nằm trong trang Bộ sưu tập.
- Có lựa chọn quay 1 lần hoặc ×10; nếu còn ít hơn 10 vé loại đã chọn thì quay hết số vé đó.
- Nâng cấp cần đúng 2 thẻ cùng level và cùng tướng.
- Không có thẻ chính, thẻ mồi hoặc bonus từ thẻ khác.
- Nâng cấp thành công tiêu thụ 2 thẻ và tạo 1 thẻ cùng tướng ở level cao hơn đúng 1.
- Nâng cấp thất bại tiêu thụ 2 thẻ và tạo 1 thẻ cùng tướng theo phân phối kết quả thất bại riêng theo level đầu vào.
- Bảng phân phối thất bại ưu tiên giảm cảm giác mất tiến trình, nhất là ở level cao.
- Bảng xếp hạng Lực chiến (tổng 2^(lv−1), mỗi tướng + cấp tính 1 lần), top 100, ẩn admin.
- Đấu trường PvP: dàn 6 tướng (2 hàng), khiêu chiến người chơi khác chọn từ bảng xếp hạng; server mô phỏng trọn trận rồi client phát lại; không thưởng, không tiêu vé, không tạo thẻ.
- Mọi kết quả game do backend xác định.
- Database SQLite, API Fastify, frontend SolidJS.
- Mọi thao tác quan trọng có transaction, lịch sử và cơ chế chống request trùng.
