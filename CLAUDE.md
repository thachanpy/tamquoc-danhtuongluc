# CLAUDE.md — Tam Quốc: Danh Tướng Lục

Tên game hiển thị: **Tam Quốc: Danh Tướng Lục** (tiêu đề trang, thanh trên, trang đăng nhập). Tên package/thư mục kỹ thuật vẫn là `tamquoc-gacha`.

Icon game (chủ dự án cung cấp: chân dung Gia Cát Lượng trong khung vàng bo góc): `apps/web/public/favicon.ico`, `apps/web/public/icons/icon-32|192|512.png` (nền trong suốt ở góc bo), `apps/web/public/icons/apple-touch-icon.png` (180×180, full-bleed), khai báo trong `apps/web/index.html` và `apps/web/public/manifest.webmanifest`. Icon này cũng là logo cạnh tên game ở thanh trên và trang đăng nhập (thay con dấu 三國).

## 1. Mục tiêu dự án

Xây dựng game web gacha thu thập thẻ tướng Tam Quốc. Trọng tâm:

- Sưu tầm tướng.
- Quay thẻ bằng vé miễn phí.
- Nâng cấp thẻ bằng cách ghép 2 thẻ cùng level.
- Quản lý bộ sưu tập.
- Tặng thẻ cho người chơi khác (tối đa 20 thẻ mỗi lần).
- Hiệu ứng hình ảnh và trải nghiệm mở thẻ.

Không có chiến đấu, dàn trận, đội hình, PvP hoặc gameplay chiến thuật trong MVP.

Claude Code phải đọc file này trước khi sửa code. Trước khi triển khai, hãy kiểm tra repository, cấu trúc, package manager, scripts và quy ước hiện có. Ưu tiên tái sử dụng cấu trúc hiện tại, không viết lại toàn bộ dự án nếu không cần thiết.

Các nguyên tắc bắt buộc:

- Backend là nguồn dữ liệu có thẩm quyền đối với vé, quyền sở hữu thẻ, tỷ lệ và kết quả ngẫu nhiên.
- Không có tính năng nạp tiền, thanh toán thật, mua vé bằng Vàng hoặc trừ Vàng để quay trong MVP.
- Vé miễn phí được cấp tự động theo thời gian, cộng 100 vé quà đăng ký một lần cho tài khoản mới.
- Có nút cộng 50 vé thử nghiệm, chỉ hoạt động khi server bật `ENABLE_DEV_TOPUP` (mục 3.7).
- Không có thưởng đăng nhập hằng ngày trong MVP.
- Vé được chia thành 5 loại (thường, Thục, Ngụy, Ngô, Quần) và được xác định ngẫu nhiên khi cấp.
- Không giới hạn số lượng vé tích trữ.
- Mỗi lần nâng cấp cần đúng 2 thẻ cùng level và cùng tướng; không có thẻ chính hoặc thẻ mồi.
- Mọi thao tác thay đổi nhiều dữ liệu liên quan phải nguyên tử.
- Các quy tắc game và tỷ lệ phải cấu hình được, có kiểm thử.
- Không tự ý thay đổi quy tắc sản phẩm đã được chủ dự án duyệt.
- Không thêm tính năng ngoài phạm vi nếu chưa được yêu cầu.
- Không tuyên bố đã chạy test, lint hoặc build nếu chưa thực sự chạy.

## 2. Công nghệ và cấu trúc

Công nghệ mục tiêu:

- Monorepo TypeScript.
- Frontend: PixiJS cho render thẻ, hiệu ứng quay và nâng cấp.
- Backend: Fastify REST API.
- Database: SQLite.
- Shared package: types, schema validation, DTO và enum dùng chung.
- Game config package: roster 100 tướng, loại vé, tỷ lệ gacha, tỷ lệ nâng cấp và cấu hình game.
- pnpm workspace nếu repository chưa có package manager hoặc cấu trúc tương đương.

Cấu trúc gợi ý:

- `apps/web`: frontend, UI và PixiJS.
- `apps/api`: Fastify, authentication, game logic và persistence.
- `packages/shared`: types, schemas, DTO và constants.
- `packages/game-config`: roster 100 tướng và các cấu hình game.

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
- Không có chỉ số chiến đấu, đội hình hoặc trận đấu.
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
- Không giới hạn số vé tối đa có thể tích trữ.
- Số lượng vé của bất kỳ loại nào cũng không bị giới hạn bởi một mức trần nghiệp vụ tùy ý.
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
- Mỗi mốc hợp lệ tạo ra đúng 1 vé ngẫu nhiên.
- Loại vé được roll độc lập cho từng mốc, theo bảng xác suất tại mục 3.5.
- Không giới hạn tổng số vé tích trữ hoặc số lượng của từng loại.
- Khi người chơi offline trong thời gian dài, phải cấp đủ số vé từ tất cả các mốc chưa xử lý, không giới hạn số mốc được xử lý theo một trần vé.
- Không bỏ qua mốc hợp lệ chỉ vì số vé đang có nhiều.
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

Nếu cần xử lý lượng mốc rất lớn sau thời gian offline dài, có thể chia thành các batch nội bộ, nhưng phải bảo đảm tiến trình có thể tiếp tục an toàn mà không bỏ sót hoặc cấp trùng mốc. Không được đặt trần tồn kho hoặc giới hạn tích trữ để làm mất quyền nhận vé hợp lệ.

### 3.7. Nguồn vé trong MVP

MVP có ba nguồn cấp vé:

1. **Hồi vé theo mốc 5 phút** (mục 3.6).
2. **Quà đăng ký (tân thủ)**: khi tạo tài khoản lần đầu, người chơi nhận **100 vé** một lần duy nhất, có ngay sau khi đăng ký/đăng nhập.
3. **Nút cộng vé thử nghiệm**: mỗi lần bấm cộng **50 vé**, chỉ hoạt động khi server bật cấu hình (xem bên dưới).

Quy tắc quà đăng ký:

- Số vé nằm trong cấu hình server (`SIGNUP_BONUS_TICKETS`, mặc định 100).
- Mỗi vé được roll loại độc lập theo bảng xác suất tại mục 3.5, bằng RNG server.
- Cấp trong cùng transaction tạo tài khoản; nếu tạo tài khoản thất bại thì không cấp vé.
- Ghi ledger với reason `signup_bonus`, mỗi loại vé một dòng (`amount_delta` = số vé loại đó).
- Mỗi người chơi chỉ nhận một lần; đăng nhập lại không cấp thêm. Unique constraint chặn cấp lần hai.
- Chỉ áp dụng cho tài khoản tạo mới, không cấp hồi tố cho tài khoản đã tồn tại.
- Đây không phải thưởng đăng nhập hằng ngày.

Quy tắc nút cộng vé thử nghiệm (dành cho giai đoạn mới chơi/playtest):

- Bật/tắt bằng biến môi trường server `ENABLE_DEV_TOPUP` (`1`/`true`). Mặc định **tắt**. Script `pnpm dev` bật sẵn; `pnpm start` không bật. Phải tắt khi chạy thật.
- Khi tắt: endpoint trả 404 `FEATURE_DISABLED`, UI không hiển thị nút.
- Số vé mỗi lần bấm nằm trong cấu hình server (`DEV_TOPUP_TICKETS`, mặc định 50). Client không gửi được số vé hay loại vé.
- Mỗi vé được roll loại độc lập theo bảng xác suất mục 3.5, bằng RNG server.
- Không giới hạn số lần bấm.
- Mỗi lần bấm có một idempotency key; retry trả kết quả cũ, không cộng thêm.
- Cấp vé và ghi ledger trong một transaction. Ledger reason `dev_topup`, mỗi loại vé một dòng.
- Miễn phí; không liên quan Vàng, thanh toán hay cửa hàng.

Các quy tắc khác:

- Không có thưởng đăng nhập hằng ngày.
- Không có endpoint, UI, bảng database, ledger reason hoặc test cho daily login claim.
- Không có phần thưởng Vàng.
- Không có hệ thống mua hoặc đổi vé.
- Nếu sau này bổ sung nguồn vé khác, phải được chủ dự án yêu cầu và cập nhật đặc tả.

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
- Sắp xếp áp dụng cho thứ tự các nhóm tướng: ghép được trước (mặc định), level cao nhất, nhiều thẻ nhất, tên A→Z. Không có kiểu sắp xếp nào làm tách rời thẻ cùng tướng.
- Hỗ trợ lọc theo phe, level và sắp xếp.
- Hiển thị tên, ảnh, phe và level từng thẻ.
- Hiển thị xác suất thành công.
- Hiển thị xác suất thất bại và phân phối level nhận được sau thất bại.
- Cảnh báo cả 2 thẻ đầu vào sẽ bị tiêu thụ bất kể thành công hay thất bại.
- Có bước xác nhận trước khi gửi request.
- Khóa nút khi request đang xử lý.
- Animation chỉ chạy sau khi server xác nhận kết quả.
- Khi animation ghép xong, chạm/bấm bất kỳ đâu (hoặc Esc) để đóng popup (giống màn mở thẻ).
- Thành công: hiệu ứng tăng level và ánh sáng.
- Thất bại: hiệu ứng rung hoặc đứt sáng, hiển thị level mới theo kết quả server.
- Hỗ trợ `prefers-reduced-motion`.
- Lỗi animation không làm thay đổi kết quả đã ghi nhận trong database.

### 5.5. Nâng cấp nhanh

Trang Nâng cấp có nút **"Nâng cấp nhanh (≤ Lv.5)"** do chủ dự án yêu cầu.

- Áp dụng cho thẻ có level đầu vào ≤ `QUICK_UPGRADE_MAX_LEVEL` (cấu hình server, mặc định 5).
- Server tự ghép liên tục mọi nhóm `UPGRADE_INPUT_COUNT` thẻ cùng tướng, cùng level ≤ 5, cho đến khi không còn nhóm nào. Thẻ mới tạo ra (thành công hoặc thất bại) nếu vẫn ≤ Lv.5 sẽ được đưa lại vào hàng chờ để ghép tiếp (dây chuyền).
- Thứ tự xử lý: level thấp trước, rồi theo tướng, trong cùng nhóm dùng thẻ cũ (id nhỏ) trước.
- Thẻ có level > 5 không bao giờ bị dùng. Thẻ lên Lv.6 từ ghép Lv.5 không ghép tiếp.
- Mỗi lần ghép dùng đúng luật và tỷ lệ của mục 5.1–5.3. Không có bonus hay bảo đảm riêng.
- Mỗi lần ghép ghi một dòng `upgrade_history` riêng, kèm snapshot tỷ lệ.
- Toàn bộ thao tác nằm trong một transaction. Lỗi ở bất kỳ lần ghép nào thì không thẻ nào bị tiêu thụ và không ghi lịch sử.
- Một idempotency key cho cả thao tác; retry trả lại kết quả đã lưu.
- Trần an toàn `QUICK_UPGRADE_MAX_MERGES` (mặc định 1000) lần ghép mỗi lần bấm; nếu còn cặp thì trả `hasMore = true` để người chơi bấm lại.
- Không có cặp nào thì trả lỗi `NOTHING_TO_UPGRADE`.
- UI phải hiển thị bảng tỷ lệ Lv.1–5 (thành công / giữ nguyên / tụt), cảnh báo thẻ bị tiêu thụ và có bước xác nhận trước khi gửi request. Sau khi xong, hiển thị tổng kết: số lần ghép, số thành công/thất bại, level cao nhất đạt được và thống kê theo level.

### 5.6. Tặng thẻ

Người chơi có thể tặng thẻ cho bất kỳ người chơi nào khác, do chủ dự án yêu cầu.

- Người nhận xác định bằng tên đăng nhập (không phân biệt hoa thường). Không được tặng cho chính mình.
- Mỗi lần tặng từ 1 đến `GIFT_MAX_CARDS` thẻ (cấu hình server, mặc định **20**).
- Thẻ thuộc mọi level đều tặng được, kể cả Lv.10. Chỉ tặng được thẻ đang active của chính mình; thẻ đã bị ghép (tiêu thụ) không tặng được.
- Người nhận có thẻ ngay, không cần chấp nhận. Thẻ đã tặng không lấy lại được.
- Thẻ đổi chủ giữ nguyên ID, tướng và level. Người nhận dùng thẻ như thẻ của mình (ghép, tặng tiếp).
- Đổi chủ toàn bộ thẻ và ghi lịch sử trong một transaction. Nếu có bất kỳ thẻ nào không hợp lệ thì huỷ cả giao dịch, không thẻ nào bị chuyển.
- Idempotency key gắn với người gửi; retry trả lại kết quả cũ, không chuyển lần hai. Dùng cùng key cho người nhận hoặc danh sách thẻ khác thì bị từ chối.
- Không tặng vé; vé vẫn không thể chuyển hoặc quy đổi (mục 3.4).
- Lịch sử hiển thị cho cả hai phía: người gửi thấy "Tặng N thẻ cho X", người nhận thấy "Nhận N thẻ từ Y", kèm danh sách thẻ (snapshot tướng + level tại thời điểm tặng).
- UI: tặng thẻ nằm **trong trang Bộ sưu tập** (không còn tab riêng; link `#gift` cũ tự chuyển về Bộ sưu tập). Bấm nút **🎁 Tặng thẻ** để bật chế độ chọn thẻ; đếm số đã chọn (tối đa 20); bước xác nhận liệt kê thẻ sắp tặng và cảnh báo thẻ Lv.6+; khóa nút khi đang xử lý.
- Ô người nhận là dropdown có tìm kiếm, liệt kê **mọi người chơi** (trừ chính mình). Thứ tự: người có giao dịch tặng/nhận thẻ với mình **gần nhất** lên đầu (kèm nhãn "Gần đây · x phút trước"), người chưa từng giao dịch xếp sau theo tên A→Z. Chỉ gửi được khi tên khớp một người trong danh sách. Sau khi tặng, danh sách tải lại để người vừa nhận lên đầu.
- Rủi ro đã biết: khi `ENABLE_DEV_TOPUP` bật, người chơi có thể tạo tài khoản phụ để cày vé rồi tặng thẻ cho tài khoản chính. Phải tắt cờ này khi chạy thật.

## 6. Giao diện và trải nghiệm

### 6.1. Bộ sưu tập

- Thẻ gom theo tướng giống trang Nâng cấp: mỗi tướng một khung, mọi bản sao nằm liền nhau; trong khung chia nhóm theo level (cao → thấp) có nhãn số lượng (VD `Lv.1 ×3`), mỗi thẻ hiển thị số thẻ `#id` như trang Nâng cấp.
- Sắp xếp các khung tướng: level cao nhất (mặc định), tên A→Z, nhiều thẻ nhất.
- Chế độ xem "Thẻ của tôi" (mặc định) và "Tướng chưa có" (các tướng chưa sở hữu hiển thị mờ).
- Tích hợp tặng thẻ (mục 5.6).
- Bấm một thẻ (khi không ở chế độ tặng) mở popup ngắm thẻ phóng to: tên, phe, Lv, `#id` (không hiện tên bậc khung Đồng/Bạc/…), thời điểm nhận; thẻ nghiêng nhẹ theo chuột (tắt khi reduced motion); bấm bất kỳ đâu hoặc Esc để đóng. Popup chỉ hiển thị, không gọi API (`apps/web/src/viewer.ts`).
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
- Có nút Nâng cấp nhanh cho thẻ ≤ Lv.5 (xem mục 5.5).
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
- Giao diện chủ đề Tam Quốc nằm ở `apps/web/src/theme.css` (ghi đè thẩm mỹ của `style.css`): nền chiến trường 4 phe theo mẫu chủ dự án cung cấp (núi, thành lũy, cờ Ngụy/Ngô trong `public/theme/landscape.svg`; vầng sáng 4 màu phe và vignette bằng CSS gradient; 40 tia lửa màu phe bay lên do `main.ts` tạo, tắt khi `prefers-reduced-motion`), panel sơn mài đỏ–đen viền vàng với góc hồi văn (`public/theme/corner-*.svg`), dải hồi văn dưới thanh trên (`public/theme/fret.svg`), tab đang chọn và nút chính màu son; logo game là icon Gia Cát Lượng. Font từ Google Fonts (đều có đủ dấu tiếng Việt trừ font chữ Hán): Playfair Display SC cho tiêu đề và tab (chữ hoa nhỏ kiểu khắc bia); Oswald cho nút, số vé, nhãn Lv. và số liệu; Charm (nét bút lông) cho tên game mạ vàng gradient và dòng kết quả mở thẻ; Noto Serif cho nội dung; Ma Shan Zheng (bút lông) cho chữ Hán biểu tượng phe, có font dự phòng khi offline.
- UI hiện đại, tương phản tốt, responsive cho desktop và mobile.
- Phân biệt phe bằng màu và biểu tượng nhất quán.
- Khung thẻ theo cấp (chủ dự án cung cấp bộ khung tham chiếu): Cấp 1 Đồng, 2 Bạc, 3 Lục, 4 Vàng, 5 Đỏ, 6 Huyền, 7 Tử, 8 Cam, 9 Bạch kim, 10 Kim cương. Cấp 1–5 là khung kim loại (cấp 5 có đá đỏ phát sáng); cấp 6–10 có đá quý, hào quang, cánh/rồng/phượng. Phần trang trí cấp 6–10 được phép tràn ra ngoài thân thẻ.
- Ảnh khung nằm ở `apps/web/public/frames/lv1.png` … `lv10.png` (PNG nền trong suốt, tách từ bộ khung tham chiếu bản 3 bằng color-to-alpha nên giữ được hào quang mờ; thân thẻ rộng 240px trong ảnh khung). Vị trí đặt khung so với thân thẻ khai báo ở `FRAME_LAYOUT` trong `apps/web/src/art.ts`; dùng chung cho thẻ DOM và thẻ PixiJS (animation mở thẻ, ghép thẻ). Thay khung = thay file PNG cùng tên (nếu tỉ lệ khung đổi thì cập nhật `FRAME_LAYOUT`).
- Màu chữ level và chấm màu ở bảng tỷ lệ dùng màu của bậc khung tương ứng.
- Chân dung tướng nằm ở `apps/web/public/generals/{artKey}.jpg` (cắt từ 4 bảng ảnh độ phân giải cao chủ dự án cung cấp, mỗi phe một bảng 5×5, bỏ khung và bảng tên; mỗi ảnh 286×378). Dùng chung cho thẻ DOM và thẻ PixiJS; hiển thị kiểu cover, canh phía trên. Thay artwork = thay file cùng tên.
- Tướng thiếu ảnh chân dung tự rơi về placeholder (biểu tượng phe + chữ viết tắt).
- Mặt sau thẻ trong animation quay thẻ là ảnh `apps/web/public/theme/card-back.jpg` (chủ dự án cung cấp: khung đồng, rồng, bát quái; 360×568, ~40 KB). Thay mặt sau = thay file cùng tên; thiếu ảnh thì dùng mặt sau vẽ dự phòng.
- Nhạc nền (chủ dự án cung cấp): 4 bài `apps/web/public/audio/b1.mp3`, `b2.mp3`, `b3.mp3`, `b4.mp3` (MP3 64 kbps, ~1,4 MB/bài), khai báo trong `TRACKS` ở `apps/web/src/music.ts`; phát ngẫu nhiên, hết bài thì chọn ngẫu nhiên bài khác (không lặp lại ngay bài vừa nghe). Thanh trên có nút bật/tắt hình trống trận (SVG; khi tắt có vạch son chéo) và thanh âm lượng; lựa chọn lưu trong localStorage của trình duyệt (mặc định bật, 40%). Do trình duyệt chặn tự phát, nhạc chỉ bắt đầu sau lần chạm/bấm đầu tiên.
- PixiJS quản lý stage, texture, animation và hiệu ứng.
- Giải phóng texture/tài nguyên khi đổi màn hình để tránh rò rỉ bộ nhớ.
- Hiệu ứng không được cản trở thao tác.
- Hỗ trợ reduced motion.

## 7. Database SQLite

Tên bảng có thể điều chỉnh, nhưng phải giữ nguyên các quy tắc nghiệp vụ và ràng buộc.

### 7.1. `users`

- `id`
- `username`
- `password_hash` nếu dùng đăng nhập bằng mật khẩu
- `created_at`

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
- Không có giới hạn tồn kho nghiệp vụ.
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
- Không đặt trần số vé hoặc bỏ mốc vì tồn kho nhiều.

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
- `gacha_draw`

Quy tắc:

- Ghi nhận từng loại vé đã cấp hoặc tiêu thụ.
- Số lượng cấp từ hồi thời gian được ghi rõ theo từng mốc.
- Không có reason `daily_claim`.
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
- Không có quy trình nhận thưởng đăng nhập hằng ngày.
- Không xóa hoặc reset database người dùng khi khởi động.
- Migration có version, chạy theo thứ tự và an toàn.
- Nếu thay đổi schema, không làm mất lịch sử hoặc dữ liệu thẻ hiện có.
- Nếu repository đã có dữ liệu theo mô hình nâng cấp cũ, migration phải bảo toàn lịch sử cũ; không được giả định lịch sử cũ có thể chuyển hoàn toàn sang mô hình mới.

## 8. API Fastify

Tất cả API phải có schema validation, authentication phù hợp và định dạng lỗi nhất quán.

### 8.1. Tài khoản và bộ sưu tập

- `GET /api/me`: thông tin người chơi, số dư từng loại vé và trạng thái hồi vé.
- `GET /api/generals`: danh mục 100 tướng.
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

Không đặt giới hạn tồn kho hoặc bỏ qua mốc hợp lệ vì số vé đã tích trữ nhiều.

Không triển khai `POST /api/daily-claim` hoặc bất kỳ API thưởng đăng nhập hằng ngày nào.

### 8.3. Gacha

- `GET /api/gacha/config`: các loại vé, pool phe và tỷ lệ level công khai.
- `POST /api/gacha/draw`: quay bằng vé đã chọn, 1 hoặc 10 lượt.

Request gồm loại vé, số lần quay `count` (mặc định 1, phải thuộc `DRAW_COUNT_OPTIONS`) và idempotency key. Không nhận tướng, level, xác suất hoặc kết quả do client chỉ định.

Server xác thực số dư loại vé, xác định số lượt thực tế = min(count, số dư), rồi với mỗi lượt: tiêu thụ một vé, chọn tướng, roll level, tạo thẻ và ghi lịch sử. Tất cả trong cùng transaction. Response gồm `requested`, `drawn`, `results[]` và số dư vé mới.

### 8.4. Nâng cấp

- `POST /api/upgrades/preview`: tính tỷ lệ hiện tại dựa trên đúng hai thẻ đầu vào mà không thay đổi dữ liệu.
- `POST /api/upgrades/attempt`: thực hiện ghép thẻ nguyên tử.
- `POST /api/upgrades/quick`: Nâng cấp nhanh (mục 5.5). Body chỉ gồm `idempotencyKey`; server tự chọn thẻ. Response gồm `merges`, `successes`, `failures`, `hasMore`, `results[]`. Có rate limit.
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

- `POST /api/gifts`: body `{ toUsername, cardIds[], idempotencyKey }`. Server kiểm tra người nhận tồn tại và khác người gửi, số thẻ 1–20, không trùng ID, mọi thẻ thuộc người gửi và còn active, rồi đổi chủ nguyên tử. Lỗi: `RECIPIENT_NOT_FOUND`, `GIFT_TO_SELF`, `GIFT_CARD_COUNT`, `DUPLICATE_CARD`, `CARD_NOT_FOUND`, `CARD_CONSUMED`. Có rate limit.
- `GET /api/users?q=&limit=`: danh sách người nhận cho dropdown, mọi người chơi trừ chính mình, sắp theo lần tặng/nhận thẻ gần nhất với mình rồi theo tên; `q` lọc theo tên không phân biệt hoa thường. Cần đăng nhập. Chỉ trả `username` và `lastGiftAt`, không lộ thông tin khác.
- `GET /api/gacha/config` trả thêm `giftMaxCards`.
- `GET /api/history?kind=gift` lọc lịch sử tặng/nhận thẻ.

### 8.5. Lịch sử

- `GET /api/history`: lịch sử phân trang.
- Có thể bổ sung endpoint lịch sử vé nếu cần.

Không tạo API ví Vàng, mua vé, nạp tiền hoặc daily claim trong MVP. Ngoại lệ duy nhất là `POST /api/tickets/dev-topup` (cộng vé thử nghiệm miễn phí, bật/tắt bằng cấu hình).

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
- Không giới hạn số vé tích trữ.
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
- Không tồn tại logic thưởng đăng nhập hoặc cấp thêm 20 vé mỗi ngày.
- Tài khoản mới nhận đúng 100 vé quà đăng ký, loại vé roll độc lập; ledger khớp số dư.
- Đăng nhập lại hoặc đăng ký trùng tên không cấp thêm quà đăng ký.
- Nút cộng vé: tắt mặc định (404); khi bật, mỗi lần bấm cộng đúng 50 vé, loại vé roll độc lập; retry cùng key không cộng thêm; lỗi giữa chừng không cấp vé; ledger khớp số dư.

### 10.3. Vé hồi theo thời gian

- Hồi đúng mỗi mốc 5 phút (phút 00, 05, 10, …, 55).
- Không hồi sớm hơn mốc.
- Xử lý đúng qua giờ mới, ngày mới và thời gian offline dài.
- Cấp đủ vé cho mọi mốc chưa xử lý.
- Không có giới hạn số vé tích trữ.
- Không mất vé do tồn kho lớn.
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
- Retry quay ×10 cùng key trả kết quả cũ; số lần quay ngoài cấu hình (kể cả 5) bị từ chối.

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
- Nâng cấp nhanh: ghép dây chuyền mọi cặp ≤ Lv.5, level thấp trước; không đụng thẻ > Lv.5; mỗi lần ghép một dòng lịch sử; nguyên tử (lỗi giữa chừng không tiêu thẻ nào); retry cùng key trả kết quả cũ; chỉ dùng thẻ của chính người chơi; không có cặp => `NOTHING_TO_UPGRADE`.

### 10.5b. Tặng thẻ

- Tặng chuyển đúng thẻ sang người nhận, giữ nguyên tướng/level; người gửi mất thẻ, người nhận dùng được thẻ để ghép.
- Tối đa 20 thẻ; 0 hoặc 21 thẻ bị từ chối, không thẻ nào bị chuyển.
- Từ chối tặng chính mình, người nhận không tồn tại, thẻ của người khác, thẻ đã tiêu thụ, trùng ID; mọi lỗi đều huỷ cả giao dịch.
- Retry cùng key trả kết quả cũ, không chuyển lần hai.
- Lịch sử hiển thị đúng chiều gửi/nhận cho cả hai người.
- Danh sách người nhận: không có chính mình; người giao dịch gần nhất lên đầu, còn lại A→Z; tìm kiếm không phân biệt hoa thường; ký tự `%`/`_` không thành wildcard.

### 10.6. Database và API

- Migration chạy thành công trên database mới.
- Migration không phá dữ liệu hiện có.
- Foreign key và constraint hoạt động.
- Concurrent requests không cấp trùng vé.
- Concurrent requests không tiêu thụ cùng thẻ hai lần.
- API xác thực và validate đầu vào.
- API không để client quyết định kết quả RNG.
- Lịch sử và ledger phản ánh chính xác thay đổi dữ liệu.
- Không có endpoint hoặc bảng daily claim mới.

### 10.7. UI

- Hiển thị chính xác số dư từng loại vé và tổng số vé.
- Hiển thị đồng hồ đến mốc hồi kế tiếp.
- Có loading, empty state và error state.
- Chọn đúng pool tướng theo loại vé.
- Animation khớp với kết quả server.
- UI nâng cấp yêu cầu đúng hai thẻ cùng level và cùng tướng.
- UI nâng cấp hiển thị thẻ cùng tướng liền nhau với mọi kiểu sắp xếp.
- UI hiển thị đầy đủ phân phối thất bại.
- UI cảnh báo hai thẻ đầu vào sẽ bị tiêu thụ.
- Chặn thao tác lặp khi request đang xử lý.
- Hoạt động trên desktop và mobile.
- Hỗ trợ reduced motion.
- Không có thưởng đăng nhập, nút nạp tiền, cửa hàng vé hoặc mua vé bằng Vàng.
- Nút "+50 vé" chỉ hiện khi server bật `ENABLE_DEV_TOPUP`; khóa nút khi đang xử lý.
- Nút Nâng cấp nhanh hiển thị số cặp có thể ghép, bảng tỷ lệ Lv.1–5, bước xác nhận, khóa khi đang xử lý và tổng kết sau khi xong.
- Bộ sưu tập gom thẻ theo tướng; tặng thẻ nằm trong Bộ sưu tập với dropdown người nhận có tìm kiếm, sắp theo giao dịch gần nhất.

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
- Tài khoản mới nhận 100 vé quà đăng ký một lần (loại vé random theo mục 3.5).
- Nút cộng 50 vé thử nghiệm (loại vé random), chỉ khi server bật `ENABLE_DEV_TOPUP`.
- Người chơi offline vẫn tích lũy đầy đủ các mốc hợp lệ.
- Không có thưởng đăng nhập hằng ngày.
- Mỗi vé được cấp sẽ random loại với xác suất mặc định 20% cho mỗi loại.
- Không giới hạn số lượng vé tích trữ.
- Có vé Quần, quay trong 25 tướng Quần.
- Không có nạp tiền, mua vé bằng Vàng, thanh toán thật hoặc cửa hàng vé.
- Vé thường quay trong toàn bộ 100 tướng.
- Vé Thục, Ngụy, Ngô và Quần quay trong pool 25 tướng của phe tương ứng.
- Level thẻ từ 1 đến 10.
- Gacha roll level theo bảng xác suất đã định nghĩa, tối đa level 9; level 10 chỉ có qua ghép thẻ.
- Trang Nâng cấp gom thẻ cùng tướng nằm liền nhau.
- Nút Nâng cấp nhanh tự ghép mọi cặp thẻ ≤ Lv.5 trong một thao tác nguyên tử.
- Tặng thẻ cho người chơi khác (chọn từ dropdown mọi người chơi, ưu tiên người giao dịch gần nhất), tối đa 20 thẻ mỗi lần, nguyên tử; nằm trong trang Bộ sưu tập.
- Có lựa chọn quay 1 lần hoặc ×10; nếu còn ít hơn 10 vé loại đã chọn thì quay hết số vé đó.
- Nâng cấp cần đúng 2 thẻ cùng level và cùng tướng.
- Không có thẻ chính, thẻ mồi hoặc bonus từ thẻ khác.
- Nâng cấp thành công tiêu thụ 2 thẻ và tạo 1 thẻ cùng tướng ở level cao hơn đúng 1.
- Nâng cấp thất bại tiêu thụ 2 thẻ và tạo 1 thẻ cùng tướng theo phân phối kết quả thất bại riêng theo level đầu vào.
- Bảng phân phối thất bại ưu tiên giảm cảm giác mất tiến trình, nhất là ở level cao.
- Mọi kết quả game do backend xác định.
- Database SQLite, API Fastify, frontend PixiJS.
- Mọi thao tác quan trọng có transaction, lịch sử và cơ chế chống request trùng.
