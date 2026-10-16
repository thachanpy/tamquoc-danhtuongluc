# Kỹ năng & Phong cách tướng (SKILLS.md)

Nguồn dữ liệu cân bằng cho chiến đấu PvP. Mã hoá tường minh trong `packages/game-config/src/pvp.ts` (bảng `PVP_ROSTER_ROWS` + `PVP_SKILL_DEF`); engine (`apps/api/src/managers/pvp.engine.ts`) chỉ đọc dữ liệu này.

---

## 1. Quy ước & Cơ chế chung

### Quy đổi hiệu ứng theo CẤP (áp cho MỌI hiệu ứng kỹ năng)

> **Mọi hệ số HIỆU ỨNG ghi trong tài liệu này là GIÁ TRỊ CHỐT ở cấp 10.** Khi vào trận, engine tự quy về cấp thực tế của tướng theo công thức tuyến tính:

- **Cấp 1 = giá trị chốt − 10 điểm %**, **cấp 10 = giữ nguyên giá trị chốt**, các cấp giữa nội suy đều (làm tròn). Giá trị không xuống dưới 0.
- Ví dụ: Buff ST toàn đội `15%` → cấp 1 = **5%** → cấp 10 = **15%** (mỗi cấp +1%).
- Tăng tỷ lệ chí mạng `20%` → cấp 1 = **10%** → cấp 10 = **20%**; `35%` → **25%** → **35%**.
- Tăng máu tối đa `20%`, Hồi máu `20% HP tối đa`, Khiên `20% HP tối đa` → cấp 1 = **10%** → cấp 10 = **20%**.
- Buff sát thương bản thân `20%` → cấp 1 = **10%** → cấp 10 = **20%**.
- Giảm máu tối đa `15%` → cấp 1 = **5%** → cấp 10 = **15%** (mỗi cấp +1.11%).
- **Áp dụng cho**: buff có lợi (ST, HP tối đa, chí mạng, ST chí mạng, giảm ST nhận, ban hút máu, tạo khiên), hồi máu/tự hồi máu, debuff lên địch (giảm ST, giảm HP tối đa, giảm chí mạng, giảm ST chí mạng, thiêu đốt, xóa khiên), phản kích, "đao phủ" (+30% ST lên mục tiêu debuff), và mọi tỉ lệ khai báo dạng "mỗi cấp".
- **Tỉ lệ khai báo dạng "mỗi cấp"** (Choáng `cấp×X%`, Hút máu `cấp×X%`, Phản kích `cấp×3%`, Chí mạng `cấp×3%`, Xóa khiên `cấp×5%`) dùng CÙNG công thức trên: giá trị chốt = `X × 10` (đạt ở cấp 10), cấp 1 = giá trị chốt − 10 điểm %.
- **KHÔNG quy theo cấp**: hệ số SÁT THƯƠNG kỹ năng (`250%–320%`…) vì đã tự lớn theo cấp qua chỉ số nền (Damage/HP nền tăng 25%/cấp); ST chí mạng nền `150%`; số lượt hiệu lực (`rounds`) và trần cộng dồn (`maxLayers`); Aura/Chỉ số nội tại theo Phong cách.

### Phong cách & Thứ tự hành động

- **Phong cách**: Chỉ quyết định **lực chiến (LC)**, nhãn hiển thị và **chỉ số nội tại cộng thêm**:
  - **Tấn công** (LC cao nhất): Tăng **25% sát thương cơ bản** cho bản thân.
  - **Phòng thủ** (LC thấp nhất): Tăng **25% máu cơ bản** cho bản thân.
  - **Hỗ trợ**: Tăng **10% máu cơ bản** và **10% sát thương cơ bản** cho **toàn đội** (Aura toàn đội, **cộng dồn tối đa 3 lớp = +30% Máu & +30% ST** nếu sử dụng nhiều tướng Hỗ trợ). Aura áp ngay khi vào trận và **máu vẫn đầy 100%** theo trần mới (không bị tính là hồi máu).
- **Thứ tự hành động**: Hai đội **luân phiên nhau theo vị trí**. Vào trận, bên có **tổng LC cả đội cao hơn** ra đòn trước ở **vị trí 1**, rồi tới **vị trí 1 của bên kia**, **vị trí 2 của bên đi trước**, **vị trí 2 của bên kia**… cứ thế tới vị trí 6 (bằng tổng LC thì bên khiêu chiến A đi trước).
- **Phạm vi nhắm mục tiêu (Targeting)**: 6 ô gồm **2 hàng dọc** (hàng dọc trước `1-2-3` và hàng dọc sau `4-5-6`) × **3 hàng ngang** (cặp `1-4`, `2-5`, `3-6`).
  - `front_row` (Hàng dọc trước): Đánh cả 3 tướng ô `1-2-3` của địch. Nếu hàng dọc trước đã ngã hết thì tự động chuyển sang đánh hàng dọc sau `4-5-6`.
  - `back_row` (Hàng dọc sau): Đánh cả 3 tướng ô `4-5-6` của địch. Nếu hàng dọc sau đã ngã hết thì chuyển sang đánh hàng dọc trước.
  - `lane` (Hàng ngang): Đánh đúng hàng ngang (`1-4` / `2-5` / `3-6`) mà người thi triển đang đứng.

### Danh mục 19 Hiệu ứng được phép sử dụng

> **Quy tắc cộng dồn chung**: Mọi trần "Max cộng dồn" bên dưới đều tính **theo TỪNG nguồn (từng tướng thi triển)**, KHÔNG có trần toàn hệ thống trên một mục tiêu.
> **Quy tắc số lượt mặc định**: Hiệu ứng nào **không ghi rõ số lượt** thì mặc định **3 lượt** (buff/debuff/phản kích/khiên). Riêng Thiêu đốt duy trì `4 lượt`.

1. **Buff sát thương**: Tăng % sát thương gây ra (10% – 30%, 3 lượt). **Max cộng dồn: 3 lớp/nguồn**.
2. **Giảm sát thương**: Giảm % sát thương gánh chịu hoặc gây ra (10% – 25%, 3 lượt). **Max cộng dồn: 3 lớp**.
3. **Hồi máu**: Hồi HP ngay lập tức (hoặc hồi mỗi lượt - HoT) theo % HP tối đa hoặc % ST cơ bản của người thi triển.
4. **Tăng máu tối đa**: Tăng trần HP tối đa (10% – 20%), chỉ hồi 1/4 lượng trần HP tăng lên. **Max cộng dồn: 3 lớp**.
5. **Giảm máu tối đa**: Giảm trần HP tối đa của đối thủ (5% – 15%, 3 lượt, cố định 100% trúng). **Max cộng dồn: 3 lớp**.
6. **Choáng**: Mục tiêu bị choáng không thể thực hiện hành động.
   - **Thời gian hiệu lực**: Duy trì cho đến khi **tướng gây ra hiệu ứng choáng đó ra skill ở lượt tiếp theo**.
   - **Tỷ lệ & Cân bằng Sát thương**:
     - *Tướng Hỗ trợ Choáng đơn mục tiêu*: Sát thương **120% – 180%**, Tỷ lệ choáng **80% – 100%** (`cấp × 8%` đến `cấp × 10%`). *Điêu Thuyền* & *Quan Vũ* nhắm thẳng `highest_damage_enemy`.
     - *Tướng Tấn công Choáng đơn mục tiêu*: Sát thương **250% – 285%**, tỷ lệ choáng **30% – 40%** (`cấp × 3%` đến `cấp × 4%`).
     - *Tướng Choáng diện rộng (Ngang/Hàng trước/AoE)*: Tỷ lệ choáng `cấp × 2%` đến `cấp × 3%` (max 20% – 30%).
7. **Giải choáng & Thiêu đốt**: Giải hiệu ứng Choáng hoặc Thiêu đốt cho đồng minh (tỷ lệ 30% – 75%). *Tác dụng tức thì*.
8. **Thiêu đốt**: Gây thêm sát thương vào đầu mỗi lượt thi triển (mỗi lớp gây **50% sát thương cơ bản**). Có thể ăn Chí mạng. Duy trì **4 lượt**.
   - *Chu Du, Lục Tốn, Hoàng Cái*: Duy trì **4 lượt**, cộng dồn max 3 lớp từ chính tướng đó.
   - *Chu Du*: Đòn Thiêu đốt được tăng thêm **+30% Tỷ lệ chí mạng & +30% ST chí mạng**.
   - *Lục Tốn*: Hút máu áp dụng cho cả Thiêu đốt với hiệu suất **50%**.
9. **Tăng tỷ lệ chí mạng**: Tăng % chí mạng (10% – 35%, 3 lượt). **Max cộng dồn: 3 lớp**.
10. **Giảm tỷ lệ chí mạng**: Giảm % chí mạng đối thủ (15% – 20%, 3 lượt). **Max cộng dồn: 3 lớp**.
11. **Tăng/Giảm sát thương chí mạng**: Buff/Debuff tăng hoặc giảm ST chí mạng (15% – 30%, 3 lượt). **Max cộng dồn: 3 lớp**.
12. **Phản kích (Nội tại Bị động)**: Tự động đánh trả khi chịu sát thương trực tiếp.
   - *Phản kích đơn*: Đánh trả kẻ tấn công, sát thương **50% ST cơ bản** (tối đa 30%).
   - *Phản kích diện rộng (Tào Nhân, Trương Phi, Cao Thuận, Đổng Trác, Mãn Sủng, La Hiến, Toàn Tông)*: Đánh trả toàn bộ đội hình địch, sát thương **30% ST cơ bản** (tối đa 30%).
13. **Hút máu**: Hồi HP theo % sát thương thực tế gây ra.
   - *Mức tiêu chuẩn*: `cấp × 2%` (Max **20%**).
   - *Mức Sát thủ*: `cấp × 3%` (Max **30%**).
   - *Signature Hero*: **Mã Siêu** (Max **100%**), **Cam Ninh** (Max **95%**), **Hoa Hùng** (Max **90%**), **Nhạc Tiến** (Max **85%**).
   - *Ban hút máu cho đồng đội*: Buff **+15%** Hút máu cho toàn đội (2 lượt, cố định 1 lớp) từ **Lưu Bị**, **Tuân Úc**, **Lỗ Túc**, **Viên Thiệu**.
14. **Xóa hiệu ứng có lợi của đối thủ**: Loại bỏ lớp buff có lợi của đối thủ (75% – 100%).
15. **Xóa hiệu ứng bất lợi của bản thân/đồng minh**: Loại bỏ các hiệu ứng xấu (bao gồm Thiêu đốt).
16. **Tạo Khiên (Shield)**: Hấp thụ sát thương nhận vào trong **3 lượt** (tính theo % HP tối đa hoặc % ST cơ bản). Khiên chịu sát thương trước HP thực tế. **Max cộng dồn: 3 lớp/nguồn**.
17. **Xóa Khiên (Shield Break)**: Có tỷ lệ **5% ở Cấp 1 → 50% ở Cấp 10** (`cấp × 5%`) bẻ gãy và loại bỏ hoàn toàn lớp Khiên bảo hộ hiện có của mục tiêu bị trúng đòn.
18. **Hồi sinh (Nội tại Bị động)**: Hồi lại `cấp × 5%` HP tối đa khi tử trận lần đầu và giảm 50% ST vĩnh viễn (**Triệu Vân**, **Tào Nhân**, **Hoàng Cái**, **Văn Sú**).
19. **Gia tăng sát thương lên mục tiêu Debuff (Đao phủ)**: Gây thêm **+30% sát thương** nếu mục tiêu đang chịu bất kỳ hiệu ứng bất lợi nào (**Tào Phi**, **Tào Chân**, **Từ Hoảng**, **Đặng Ngãi**, **Mã Đại**, **Đinh Phụng**, **Tôn Phấn**, **Trương Bảo**).

---

## 2. Phe Ngụy (wei) — 35 Tướng (Tier A+)

> **Bản sắc**: Làm suy yếu, khống chế Choáng, xóa buff/khiên, tạo khiên kiên cố, triệt hạ chí mạng địch và Phản kích dẻo dai.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Tào Tháo** | Hỗ trợ | ⭐ | **Hiệu lệnh thiên hạ**: Tấn công toàn bộ địch 110%, 100% Xóa 1 buff có lợi, có 5%-50% tỷ lệ Xóa Khiên toàn bộ địch VÀ Buff sát thương 20% cho toàn đội (3 lượt). | Xóa buff địch, Xóa Khiên (5%-50%), Buff ST toàn đội |
| 2 | **Tào Phi** | Tấn công | ⭐ | **Đế vương trảm**: Tấn công đơn 290%, Giảm tỷ lệ chí mạng của mục tiêu 20%, Giảm 20% ST chí mạng và Hút máu theo cấp (cấp×2%, max 20%) (3 lượt). | Giảm chí mạng, Giảm ST chí mạng, Hút máu, +30% ST lên mục tiêu đang debuff |
| 3 | **Tào Nhân** | Phòng thủ | | **Thiết bích**: Tạo Khiên hấp thụ ST bằng 20% HP tối đa cho bản thân (3 lượt), Hồi máu 10% HP cho bản thân mỗi lượt ra đòn, Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%) và Hồi sinh (1 lần/trận). | Tạo Khiên bản thân, Hồi máu, Phản kích diện rộng, Hồi sinh |
| 4 | **Tào Hồng** | Phòng thủ | | **Hộ chủ**: Tấn công đơn 230%, Hồi máu 10% HP tối đa cho bản thân và Giảm sát thương nhận vào 15% (3 lượt). | Hồi máu, Giảm ST nhận |
| 5 | **Tào Chân** | Phòng thủ | | **Phá trận**: Tấn công hàng ngang 200%, Giảm sát thương của các mục tiêu 15% (3 lượt). | Giảm ST địch, +30% ST lên mục tiêu đang debuff |
| 6 | **Hạ Hầu Đôn** | Phòng thủ | ⭐ | **Độc nhãn cuồng đao**: Tấn công đơn 285%, gây Choáng mục tiêu (tỷ lệ cấp×4%, max 40%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Choáng, Phản kích đơn |
| 7 | **Hạ Hầu Uyên** | Tấn công | ⭐ | **Thần tốc tập kích**: Tấn công hàng dọc sau 220%, Giảm tỷ lệ chí mạng hàng sau địch 20% (3 lượt). | Giảm chí mạng địch |
| 8 | **Trương Liêu** | Tấn công | ⭐ | **Uy chấn Tiêu Dao**: Tấn công hàng ngang 225%, Giảm sát thương địch 10%, Hút máu theo cấp (cấp×3%, max 30%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Hút máu, Phản kích đơn |
| 9 | **Nhạc Tiến** | Tấn công | | **Tiên phong phá địch**: Tấn công đơn 300%, Hút máu đặc biệt theo cấp (cấp×8.5%, max 85%), có 5%-50% tỷ lệ Xóa Khiên mục tiêu và Tăng máu tối đa 10% bản thân. | Hút máu 85% (Signature Ngụy), Xóa Khiên (5%-50%), Tăng HP max |
| 10 | **Vu Cấm** | Phòng thủ | | **Nghiêm trận**: Hồi máu 20% HP tối đa cho bản thân, Giảm sát thương nhận vào 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hồi máu, Giảm ST nhận, Phản kích đơn |
| 11 | **Trương Cáp** | Tấn công | | **Kỳ binh đột kích**: Tấn công hàng dọc trước 200%, gây Choáng mục tiêu (tỷ lệ cấp×3%, max 30%). | Choáng |
| 12 | **Từ Hoảng** | Tấn công | ⭐ | **Khai sơn phủ**: Tấn công đơn 305%, Giảm sát thương của mục tiêu 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Phản kích đơn, +30% ST lên mục tiêu đang debuff |
| 13 | **Điển Vi** | Phòng thủ | ⭐ | **Ác Lai hộ vệ**: Tăng máu tối đa 20%, Hồi máu 15% HP tối đa mỗi lượt ra đòn và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Hồi máu, Phản kích đơn |
| 14 | **Hứa Chử** | Phòng thủ | ⭐ | **Hổ si cuồng kích**: Tấn công đơn 295%, Hút máu theo cấp (cấp×2.5%, max 25%) và Buff sát thương bản thân 20% (3 lượt). | Hút máu, Buff ST |
| 15 | **Quách Gia** | Hỗ trợ | ⭐ | **Diệu kế thiên cơ**: Tấn công toàn bộ địch 85%, Tăng 15% HP tối đa cho toàn đội và Giảm sát thương nhận vào của toàn bộ địch 10% (3 lượt). | Tăng HP max toàn đội, Giảm ST địch |
| 16 | **Tuân Úc** | Hỗ trợ | | **Vương tá chi sách**: Buff sát thương 15% toàn đội (3 lượt), Giảm sát thương nhận vào cho toàn đội 10% (3 lượt) và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Giảm ST nhận, Ban hút máu |
| 17 | **Tuân Du** | Hỗ trợ | | **Liên hoàn kế**: Tấn công hàng dọc trước 180%, gây Choáng (tỷ lệ cấp×3%, max 30%). | Choáng |
| 18 | **Giả Hủ** | Hỗ trợ | | **Độc kế**: Tấn công hàng dọc trước 150%, gây Choáng các mục tiêu (tỷ lệ cấp×3%, max 30%) và Giảm sát thương địch 20%. | Choáng, Giảm ST địch |
| 19 | **Tư Mã Ý** | Hỗ trợ | ⭐ | **Ẩn nhẫn phản kích**: Tấn công toàn bộ địch 125%, Giảm sát thương toàn bộ địch 15%, Giảm tỷ lệ chí mạng 15% VÀ Giảm 20% ST chí mạng toàn bộ địch (3 lượt). | Giảm ST địch, Giảm chí mạng, Giảm ST chí mạng |
| 20 | **Bàng Đức** | Phòng thủ | | **Quan tài quyết chiến**: Tấn công đơn 280%, Hút máu theo cấp (cấp×2%, max 20%), Tăng tỷ lệ chí mạng bản thân 25% và Tăng 25% ST chí mạng bản thân (3 lượt). | Hút máu, Tăng chí mạng, Tăng ST chí mạng |
| 21 | **Chân Cơ** | Hỗ trợ | | **Lạc Thần**: Hồi máu toàn đội (110% ST cơ bản) và Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Hồi máu, Giảm ST nhận |
| 22 | **Biện Ngọc Nhi** | Hỗ trợ | | **Hậu cung an định**: Tăng máu tối đa toàn đội 10% và Hồi máu toàn đội (100% ST cơ bản). | Tăng HP max, Hồi máu |
| 23 | **Tào Hoa** | Hỗ trợ | | **Nhu tình hộ mệnh**: Hồi máu đồng minh thấp HP nhất (420% ST cơ bản) và Buff sát thương cho người đó 15% (3 lượt). | Hồi máu đơn, Buff ST |
| 24 | **Tào Tiết** | Hỗ trợ | | **Trung trinh**: Tạo Khiên cho toàn đội bằng 10% HP tối đa VÀ Giảm 10% sát thương nhận vào cho toàn đội (3 lượt). | Tạo Khiên toàn đội, Giảm ST nhận |
| 25 | **Tân Hiến Anh** | Hỗ trợ | | **Tuệ nhãn phá cục**: Tấn công toàn bộ địch 75%, Giải choáng và Giải thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Giải choáng & thiêu đốt |
| 26 | **Tào Thực** | Hỗ trợ | | **Thất bộ thành thi**: Tăng tỷ lệ chí mạng toàn đội 15% và Tăng 20% ST chí mạng toàn đội (3 lượt). | Tăng chí mạng, Tăng ST chí mạng |
| 27 | **Tào Chương** | Phòng thủ | | **Trục hổ**: Tấn công đơn 265%, Tăng máu tối đa bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Phản kích đơn |
| 28 | **Mãn Sủng** | Phòng thủ | | **Cố thủ Hợp Phì**: Hồi máu bản thân 15% HP tối đa, Tạo Khiên cho bản thân bằng 15% HP tối đa (3 lượt) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Hồi máu, Tạo Khiên bản thân, Phản kích diện rộng |
| 29 | **Lưu Diệp** | Hỗ trợ | | **Tiên đoán thắng bại**: Tấn công toàn bộ địch 80%, Giảm tỷ lệ chí mạng toàn bộ địch 20% và Giảm 15% ST chí mạng toàn bộ địch (3 lượt). | Giảm chí mạng, Giảm ST chí mạng |
| 30 | **Vương Dị** | Tấn công | | **Chinh phạt Liêu Đông**: Tấn công đơn 280%, Giảm sát thương mục tiêu 10% và Tăng tỷ lệ chí mạng bản thân 20% (3 lượt). | Giảm ST địch, Tăng chí mạng |
| 31 | **Vương Tường** | Phòng thủ | | **Ngọa băng cầu lý**: Hồi máu bản thân 25% HP tối đa, Giảm sát thương nhận vào 20% và Tăng 10% HP tối đa bản thân (3 lượt). | Hồi máu, Giảm ST nhận, Tăng HP max |
| 32 | **Đặng Ngãi** | Tấn công | | **Vượt Âm Bình**: Tấn công hàng dọc sau 220%, Giảm sát thương địch 10%, Tăng tỷ lệ chí mạng bản thân 15% (3 lượt) và +30% ST lên mục tiêu đang debuff. | Giảm ST địch, Tăng chí mạng, +30% ST lên mục tiêu đang debuff |
| 33 | **Quách Hoài** | Phòng thủ | | **Trấn thủ Ung Lương**: Tấn công hàng dọc trước 190%, Tạo Khiên cho bản thân bằng 15% HP tối đa (3 lượt) và Giảm sát thương các mục tiêu 15% (3 lượt). | Tạo Khiên bản thân, Giảm ST địch |
| 34 | **Trần Quần** | Hỗ trợ | | **Cửu phẩm trung chính**: Buff sát thương toàn đội 15% VÀ Tăng 20% ST chí mạng cho toàn đội (3 lượt). | Buff ST, Tăng ST chí mạng toàn đội |
| 35 | **Chung Hội** | Hỗ trợ | | **Kiếm chỉ Hán Trung**: Tấn công đơn 140%, Xóa 1 buff có lợi, có 5%-50% tỷ lệ Xóa Khiên mục tiêu VÀ Giảm 20% sát thương mục tiêu (3 lượt). | Xóa buff địch, Xóa Khiên (5%-50%), Giảm ST địch |

---

## 3. Phe Thục (shu) — 35 Tướng (Tier A+)

> **Bản sắc**: Tấn công bùng nổ, dứt điểm nhanh, bạo phát chí mạng, bảo hộ tạo khiên và sinh tồn dẻo dai.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Lưu Bị** | Hỗ trợ | ⭐ | **Nhân đức**: Buff sát thương toàn đội 15%, Tăng máu tối đa toàn đội 10% và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Tăng HP max, Ban hút máu |
| 2 | **Quan Vũ** | Tấn công | ⭐ | **Thanh Long Yển Nguyệt**: Tấn công **tướng địch có sát thương cao nhất** 320%, Tăng tỷ lệ chí mạng bản thân 30% và Tăng 30% ST chí mạng bản thân khi thi triển. | Nhắm tướng địch mạnh nhất, Tăng chí mạng, Tăng ST chí mạng |
| 3 | **Trương Phi** | Phòng thủ | ⭐ | **Hổ Khiếu Trường Bản**: Tấn công hàng ngang 220%, Buff sát thương bản thân 20% và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Buff ST, Phản kích diện rộng |
| 4 | **Gia Cát Lượng** | Hỗ trợ | ⭐ | **Bát trận đồ**: Tấn công toàn bộ địch 104%, gây Choáng (tỷ lệ cấp×2%, max 20%) và Buff sát thương toàn đội 10% (3 lượt). | Choáng, Buff ST |
| 5 | **Triệu Vân** | Tấn công | ⭐ | **Thất Tiến Thất Xuất**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng 20%, Giảm sát thương nhận vào 20% (3 lượt), Hút máu theo cấp (cấp×3%, max 30%) và Hồi sinh (1 lần/trận). | Tăng chí mạng, Giảm ST nhận, Hút máu, Hồi sinh |
| 6 | **Mã Siêu** | Tấn công | ⭐ | **Cẩm Mã Siêu**: Tấn công đơn 280%, Hút máu theo cấp đặc biệt (cấp×10%, max 100%) và Tăng máu tối đa 10% bản thân. | Hút máu 100%, Tăng HP max |
| 7 | **Hoàng Trung** | Tấn công | ⭐ | **Lão Đương Ích Tráng**: Tấn công hàng dọc sau 210%, Tăng tỷ lệ chí mạng 35% cho phát bắn này. | Tăng chí mạng |
| 8 | **Ngụy Diên** | Tấn công | ⭐ | **Kỳ phong đột kích**: Tấn công hàng dọc trước 220%, Buff sát thương bản thân 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Phản kích đơn |
| 9 | **Khương Duy** | Tấn công | ⭐ | **Kế thừa Khổng Minh**: Tấn công đơn 260%, Buff sát thương bản thân 15% và gây Choáng (tỷ lệ cấp×4%, max 40%). | Choáng, Buff ST |
| 10 | **Bàng Thống** | Hỗ trợ | ⭐ | **Phượng Sồ liên hoàn**: Tấn công toàn bộ địch 85%, Buff sát thương toàn đội 15% (3 lượt). | Buff ST |
| 11 | **Pháp Chính** | Hỗ trợ | | **Tiên liệu chiến cơ**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15% và Tăng 20% ST chí mạng toàn đội (3 lượt). | Buff ST, Tăng chí mạng, Tăng ST chí mạng |
| 12 | **Từ Thứ** | Hỗ trợ | | **Kiếm hiệp phá trận**: Tấn công hàng ngang 160%, gây Choáng (tỷ lệ cấp×3%, max 30%), có 5%-50% tỷ lệ Xóa Khiên các mục tiêu và Tăng 10% Tỷ lệ chí mạng cho đồng minh cùng hàng. | Choáng, Xóa Khiên (5%-50%), Tăng chí mạng đồng minh |
| 13 | **Hoàng Nguyệt Anh** | Hỗ trợ | | **Cơ quan bát quái**: Tấn công toàn bộ địch 75%, Tăng tỷ lệ chí mạng toàn đội 10% (3 lượt). | Tăng chí mạng |
| 14 | **Quan Bình** | Tấn công | | **Thanh Long kế thừa**: Tấn công đơn 260%, Hút máu theo cấp (cấp×2%, max 20%), Buff sát thương bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu, Buff ST, Phản kích đơn |
| 15 | **Quan Hưng** | Tấn công | | **Hưng binh trảm tướng**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng 15% (3 lượt). | Tăng chí mạng |
| 16 | **Mã Đại** | Tấn công | | **Truy kích Tây Lương**: Tấn công hàng dọc trước 200%, có 5%-50% tỷ lệ Xóa Khiên hàng trước địch, Buff sát thương bản thân 15% và Giảm 15% Tỷ lệ chí mạng hàng trước địch (3 lượt). | Xóa Khiên (5%-50%), Buff ST, Giảm chí mạng địch, +30% ST lên mục tiêu đang debuff |
| 17 | **Vương Bình** | Phòng thủ | | **Kiên thủ Hán Trung**: Giảm sát thương nhận vào 25%, Hồi máu 15% HP tối đa mỗi lượt ra đòn VÀ Tạo Khiên cho bản thân & đồng minh cùng hàng bằng 15% HP tối đa (3 lượt). | Giảm ST nhận, Hồi máu, Tạo Khiên đồng minh |
| 18 | **Liêu Hóa** | Phòng thủ | | **Lão tướng tiên phong**: Tấn công đơn 270%, Tăng máu tối đa bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Phản kích đơn |
| 19 | **Giản Ung** | Hỗ trợ | | **Du thuyết**: Buff sát thương toàn đội 10% và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Buff ST, Xóa debuff đồng minh |
| 20 | **Mi Trúc** | Hỗ trợ | | **Hậu cần vững chắc**: Hồi máu cho hàng dọc sau (220% ST cơ bản) và Buff sát thương hàng sau 15% (3 lượt). | Hồi máu, Buff ST |
| 21 | **Quan Ngân Bình** | Tấn công | | **Nữ tướng phá quân**: Tấn công đơn 250%, gây Choáng (tỷ lệ cấp×4%, max 40%). | Choáng |
| 22 | **Mi Trinh** | Hỗ trợ | | **Tương trợ**: Hồi máu toàn đội (100% ST cơ bản) và Tăng máu tối đa toàn đội 10%. | Hồi máu, Tăng HP max |
| 23 | **Gia Cát Quả** | Hỗ trợ | | **Tiên thuật**: Giảm sát thương nhận vào toàn đội 10% (3 lượt) và Giải choáng/thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Giảm ST nhận, Giải choáng & thiêu đốt |
| 24 | **Bao Tam Nương** | Tấn công | | **Hoa vũ song đao**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng bản thân 20% và Tăng 20% ST chí mạng (3 lượt). | Tăng chí mạng, Tăng ST chí mạng |
| 25 | **Ngô Ý** | Phòng thủ | | **Trấn thủ Ích Châu**: Giảm sát thương nhận vào 20%, Hồi máu bản thân 15% HP tối đa và Tạo Khiên cho đồng minh thấp HP nhất bằng 15% HP tối đa (3 lượt). | Giảm ST nhận, Hồi máu, Tạo Khiên đồng minh |
| 26 | **Đặng Chi** | Hỗ trợ | | **Sứ giả Đông Ngô**: Buff sát thương toàn đội 10% VÀ Tạo Khiên cho toàn đội bằng 10% HP tối đa (3 lượt). | Buff ST, Tạo Khiên toàn đội |
| 27 | **Trương Tinh Thái** | Phòng thủ | | **Tinh Thái hộ giá**: Tăng máu tối đa toàn đội 10%, Hồi máu bản thân 20% HP tối đa và Giảm sát thương nhận vào 20% bản thân (3 lượt). | Tăng HP max, Hồi máu, Giảm ST nhận |
| 28 | **Mã Trung** | Tấn công | | **Kỳ Sơn phục kích**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng bản thân 20% và Tăng 20% ST chí mạng (3 lượt). | Tăng chí mạng, Tăng ST chí mạng |
| 29 | **Phí Y** | Hỗ trợ | | **Hòa mục quân thần**: Hồi máu nhẹ toàn đội (80% ST cơ bản) VÀ Tăng 10% HP tối đa cho toàn đội (3 lượt). | Hồi máu toàn đội, Tăng HP max |
| 30 | **Tưởng Uyển** | Phòng thủ | | **Trấn an Hán Trung**: Hồi máu bản thân 15% HP tối đa, Giảm sát thương nhận vào 25% (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hồi máu, Giảm ST nhận, Phản kích đơn |
| 31 | **Mã Lương** | Hỗ trợ | | **Bạch mi mưu lược**: Buff sát thương toàn đội 15% và Tăng tỷ lệ chí mạng toàn đội 15% (3 lượt). | Buff ST, Tăng chí mạng |
| 32 | **La Hiến** | Phòng thủ | | **Cô thủ Vĩnh An**: Tăng máu tối đa bản thân 20%, Tạo Khiên cho bản thân bằng 20% HP tối đa (3 lượt) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Tăng HP max, Tạo Khiên bản thân, Phản kích diện rộng |
| 33 | **Lưu Phong** | Tấn công | | **Mãnh hổ xuất trận**: Tấn công đơn 280%, Hút máu theo cấp (cấp×2%, max 20%) và Buff sát thương bản thân 15% (3 lượt). | Hút máu, Buff ST |
| 34 | **Trương Dực** | Phòng thủ | | **Thủ thành bất khuất**: Tấn công hàng ngang 190% và Giảm sát thương các mục tiêu 15% (3 lượt). | Giảm ST địch |
| 35 | **Gia Cát Chiêm** | Hỗ trợ | | **Kế thừa phụ nghiệp**: Xóa hiệu ứng bất lợi của đồng minh, có 5%-50% tỷ lệ Xóa Khiên toàn bộ đối thủ VÀ Buff sát thương toàn đội 10% (3 lượt). | Xóa debuff đồng minh, Xóa Khiên (5%-50%), Buff ST |

---

## 4. Phe Ngô (wu) — 35 Tướng (Tier A+)

> **Bản sắc**: Tấn công theo hàng, thiêu đốt dồn lớp (xuyên thủ), hút máu duy trì, khiên bảo hộ và phá khiên chiến thuật.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Tôn Kiên** | Phòng thủ | ⭐ | **Giang Đông mãnh hổ**: Tấn công hàng ngang 200%, Giảm sát thương địch 15%, Tạo Khiên cho đồng minh thấp HP nhất bằng 20% HP tối đa (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Tạo Khiên đồng minh, Phản kích đơn |
| 2 | **Tôn Sách** | Phòng thủ | ⭐ | **Tiểu Bá Vương**: Tấn công toàn bộ địch 123.5%, Buff sát thương bản thân 20%, Hút máu theo cấp (cấp×2.5%, max 25%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Hút máu, Phản kích đơn |
| 3 | **Tôn Quyền** | Hỗ trợ | ⭐ | **Đế nghiệp Giang Đông**: Buff sát thương toàn đội 15% và Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Buff ST, Giảm ST nhận |
| 4 | **Chu Du** | Tấn công | ⭐ | **Hỏa thiêu Xích Bích**: Tấn công toàn bộ địch 117%, gây Thiêu đốt toàn bộ địch (duy trì 4 lượt, dồn max 3 lớp). Đòn Thiêu đốt: tăng thêm 30% tỷ lệ chí mạng và 30% ST chí mạng. | Thiêu đốt (4 lượt, dồn 3), Thiêu đốt +30% chí mạng |
| 5 | **Lục Tốn** | Tấn công | ⭐ | **Hỏa kế liên doanh**: Tấn công hàng dọc trước 180%, gây Thiêu đốt hàng trước địch (duy trì 4 lượt, dồn max 3 lớp), Giảm HP tối đa địch 15%. Hút máu 50% hiệu suất áp dụng cho cả đòn Thiêu đốt. | Thiêu đốt (4 lượt, dồn 3), Giảm HP max (5%-15%), Hút máu thiêu đốt |
| 6 | **Lữ Mông** | Phòng thủ | ⭐ | **Bạch y độ giang**: Tấn công đơn 290% và Tăng 10% HP tối đa cho toàn đội (3 lượt). | Tăng HP max toàn đội |
| 7 | **Hoàng Cái** | Phòng thủ | ⭐ | **Khổ nhục kế**: Tự gây Thiêu đốt bản thân (duy trì 4 lượt, dồn 3 lớp) để Buff sát thương bản thân 30%, Hồi máu 10% HP tối đa, Hút máu theo cấp (cấp×2%, max 20%), Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%) và Hồi sinh (1 lần/trận). | Thiêu đốt bản thân, Buff ST, Hồi máu, Hút máu, Phản kích đơn, Hồi sinh |
| 8 | **Trình Phổ** | Phòng thủ | | **Lão tướng trấn quân**: Giảm sát thương nhận vào 20%, Hồi máu bản thân 15% HP tối đa và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Phản kích đơn |
| 9 | **Hàn Đương** | Tấn công | | **Cung kỵ hợp kích**: Tấn công hàng dọc sau 200%, Tăng tỷ lệ chí mạng 20% và Tăng 20% ST chí mạng (3 lượt). | Tăng chí mạng, Tăng ST chí mạng |
| 10 | **Thái Sử Từ** | Tấn công | ⭐ | **Thần xạ**: Tấn công đơn hàng dọc sau 300%, Tăng tỷ lệ chí mạng 25% cho phát bắn này. | Tăng chí mạng |
| 11 | **Cam Ninh** | Tấn công | ⭐ | **Cẩm Phàm tập kích**: Tấn công đơn 265%, Hút máu đặc biệt theo cấp (cấp×9.5%, max 95%) và Tăng máu tối đa 10% bản thân. | Hút máu 95% (Signature Ngô), Tăng HP max |
| 12 | **Lăng Thống** | Tấn công | | **Liên kích**: Tấn công hàng ngang 200%, Buff sát thương bản thân 20% (3 lượt). Nếu mục tiêu đang bị Thiêu đốt, Tăng thêm 20% ST chí mạng. | Buff ST, Tăng ST chí mạng chống thiêu đốt |
| 13 | **Chu Thái** | Phòng thủ | | **Hộ chủ bất khuất**: Tăng máu tối đa 20%, Hồi máu 20% HP tối đa cho bản thân và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Hồi máu, Phản kích đơn |
| 14 | **Từ Thịnh** | Phòng thủ | | **Giang phòng thiết thủ**: Giảm sát thương nhận vào 25% cho bản thân, Hồi máu 10% HP tối đa và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Phản kích đơn |
| 15 | **Đinh Phụng** | Tấn công | | **Tuyết trung đột kích**: Tấn công đơn 270%, gây Choáng mục tiêu (tỷ lệ cấp×4%, max 40%) và gây Thiêu đốt (4 lượt). | Choáng, Thiêu đốt, +30% ST lên mục tiêu đang debuff |
| 16 | **Chu Hoàn** | Phòng thủ | | **Hỏa công phá trận**: Tấn công hàng ngang 180%, gây Thiêu đốt các mục tiêu (4 lượt). | Thiêu đốt (4 lượt) |
| 17 | **Trương Chiêu** | Hỗ trợ | | **Ổn định triều chính**: Giảm sát thương nhận vào cho toàn đội 15% (3 lượt) và Hồi máu toàn đội (100% ST cơ bản). | Giảm ST nhận, Hồi máu |
| 18 | **Trương Hoành** | Hỗ trợ | | **Hoành sách**: Buff sát thương toàn đội 15% và Tăng tỷ lệ chí mạng toàn đội 15% (3 lượt). | Buff ST, Tăng chí mạng |
| 19 | **Lỗ Túc** | Hỗ trợ | ⭐ | **Liên minh Tôn Lưu**: Buff sát thương toàn đội 15%, Tăng máu tối đa toàn đội 10% và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Tăng HP max, Ban hút máu |
| 20 | **Tôn Thượng Hương** | Tấn công | | **Kiêu cơ cung vũ**: Tấn công hàng dọc sau 210%, Tăng tỷ lệ chí mạng 25% và gây Thiêu đốt nhẹ (30% ST, 4 lượt). | Tăng chí mạng, Thiêu đốt nhẹ |
| 21 | **Đại Kiều** | Hỗ trợ | | **Quốc sắc**: Hồi máu toàn đội (110% ST cơ bản) và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Hồi máu, Xóa debuff đồng minh |
| 22 | **Tiểu Kiều** | Hỗ trợ | | **Thiên hương**: Tăng tỷ lệ chí mạng toàn đội 15% và Buff sát thương toàn đội 10% (3 lượt). | Tăng chí mạng, Buff ST |
| 23 | **Bộ Luyện Sư** | Hỗ trợ | | **Hiền hậu hộ quân**: Hồi máu đồng minh thấp HP nhất (420% ST cơ bản) VÀ Tạo Khiên cho người đó bằng 20% HP tối đa (3 lượt). | Hồi máu đơn, Tạo Khiên đồng minh |
| 24 | **Tôn Lỗ Dục** | Hỗ trợ | | **Hòa giải**: Giải choáng/thiêu đốt cho toàn bộ đồng minh (tỷ lệ 30%-75%) và Hồi máu nhẹ toàn đội (60% ST cơ bản). | Giải choáng & thiêu đốt, Hồi máu |
| 25 | **Tôn Lỗ Ban** | Hỗ trợ | | **An định Giang Đông**: Tấn công toàn bộ địch 70% và Giảm máu tối đa của toàn bộ đối thủ 15% (3 lượt). | Giảm HP max địch (5%-15%) |
| 26 | **Chu Phường** | Hỗ trợ | | **Kết trận Giang Đông**: Tấn công toàn bộ địch 75%, Xóa 1 buff có lợi, có 5%-50% tỷ lệ Xóa Khiên toàn bộ đối thủ VÀ Giảm 10% sát thương địch (3 lượt). | Xóa buff địch toàn đội, Xóa Khiên (5%-50%), Giảm ST địch |
| 27 | **Cố Ung** | Hỗ trợ | | **Trị quốc an dân**: Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt) VÀ Giảm 10% sát thương nhận vào cho toàn đội (3 lượt). | Xóa debuff đồng minh, Giảm ST nhận toàn đội |
| 28 | **Toàn Tông** | Phòng thủ | | **Trùng thành cố thủ**: Hồi máu bản thân 15% HP tối đa, Tạo Khiên cho bản thân bằng 15% HP tối đa (3 lượt) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Hồi máu, Tạo Khiên bản thân, Phản kích diện rộng |
| 29 | **Lữ Đại** | Phòng thủ | | **Bình định sơn Việt**: Tấn công hàng dọc trước 190%, Giảm sát thương địch 10% và Giảm tỷ lệ chí mạng địch 10% (3 lượt). | Giảm ST địch, Giảm chí mạng |
| 30 | **Tôn Hoàn** | Tấn công | | **Hãm trận xung phong**: Tấn công hàng ngang 210% và Buff sát thương bản thân 15% (3 lượt). | Buff ST |
| 31 | **Gia Cát Cẩn** | Hỗ trợ | | **Nhã lượng khoan hồng**: Tạo Khiên cho toàn đội bằng 10% HP tối đa, có 5%-50% tỷ lệ Xóa Khiên toàn bộ đối thủ VÀ Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Tạo Khiên toàn đội, Xóa Khiên (5%-50%), Giảm ST nhận |
| 32 | **Tôn Phấn** | Tấn công | | **Tôn thất phản công**: Tấn công đơn 275%, có 5%-50% tỷ lệ Xóa Khiên mục tiêu, Giảm tỷ lệ chí mạng mục tiêu 15%, Tăng tỷ lệ chí mạng bản thân 20% (3 lượt) và +30% ST lên mục tiêu đang debuff. | Xóa Khiên (5%-50%), Giảm chí mạng, Tăng chí mạng, +30% ST lên mục tiêu đang debuff |
| 33 | **Đặng Đương** | Phòng thủ | | **Thủy chiến phòng ngự**: Tăng máu tối đa bản thân 20%, Tạo Khiên cho bản thân bằng 15% HP tối đa (3 lượt), Giảm 10% ST nhận vào cho đồng minh cùng hàng (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Tạo Khiên bản thân, Giảm ST đồng minh, Phản kích đơn |
| 34 | **Chu Cứ** | Tấn công | | **Liệt hỏa công thành**: Tấn công hàng ngang 180% và gây Thiêu đốt các mục tiêu (4 lượt). | Thiêu đốt (4 lượt) |
| 35 | **Lục Kháng** | Hỗ trợ | | **Đông Ngô trụ thạch**: Hồi máu toàn đội (80% ST cơ bản), Giải choáng/thiêu đốt cho toàn bộ đồng minh (tỷ lệ 30%-75%) và Giảm sát thương nhận vào cho toàn đội 15% (3 lượt). | Hồi máu, Giải choáng & thiêu đốt, Giảm ST nhận |

---

## 5. Phe Quần Hùng (qun) — 35 Tướng (Tier A+)

> **Bản sắc**: Đa năng đột biến, trảm % HP max đối thủ, hủy diệt bạo phát, tạo khiên/phá khiên và giải hiệu ứng cực tốt.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Đổng Trác** | Phòng thủ | ⭐ | **Bạo chúa**: Giảm máu tối đa của toàn bộ đối thủ 15%, Hồi máu bản thân 20% HP tối đa và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm HP max địch (5%-15%), Hồi máu, Phản kích diện rộng |
| 2 | **Lữ Bố** | Tấn công | ⭐ | **Vô song**: Tấn công toàn bộ địch 127%, có 5%-50% tỷ lệ Xóa Khiên toàn bộ địch, Tăng tỷ lệ chí mạng bản thân 20%, Tăng 20% ST chí mạng, Hút máu theo cấp (cấp×3%, max 30%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Xóa Khiên (5%-50%), Tăng chí mạng, Tăng ST chí mạng, Hút máu, Phản kích đơn |
| 3 | **Điêu Thuyền** | Hỗ trợ | ⭐ | **Bế nguyệt**: Tấn công **tướng địch có sát thương cao nhất** 120%, gây Choáng (tỷ lệ cấp×8%, max 80%) và Giảm sát thương mục tiêu 20%. | Nhắm tướng địch mạnh nhất, Choáng, Giảm ST địch |
| 4 | **Viên Thiệu** | Hỗ trợ | ⭐ | **Thế gia hào tộc**: Tăng máu tối đa toàn đội 15%, Buff sát thương toàn đội 10% và Ban hút máu 15% cho toàn đội (2 lượt). | Tăng HP max, Buff ST, Ban hút máu |
| 5 | **Viên Thuật** | Hỗ trợ | | **Trọng thị đế nghiệp**: Giảm máu tối đa hàng trước của đối thủ 15% (3 lượt). | Giảm HP max địch (5%-15%) |
| 6 | **Công Tôn Toản** | Tấn công | ⭐ | **Bạch mã nghĩa tùng**: Tấn công hàng dọc sau 220%, Tăng tỷ lệ chí mạng 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng chí mạng, Phản kích đơn |
| 7 | **Trương Giác** | Hỗ trợ | ⭐ | **Thái Bình đạo**: Tấn công toàn bộ địch 115%, gây Choáng (tỷ lệ cấp×2%, max 20%), Giảm tỷ lệ chí mạng toàn bộ địch 15% và Thiêu đốt nhẹ (4 lượt). | Choáng, Giảm chí mạng địch, Thiêu đốt |
| 8 | **Trương Bảo** | Tấn công | | **Địa công tướng quân**: Tấn công hàng ngang 190%, Giảm tỷ lệ chí mạng địch 15% và Giảm 20% ST chí mạng địch (3 lượt). | Giảm chí mạng, Giảm ST chí mạng, +30% ST lên mục tiêu đang debuff |
| 9 | **Trương Lương** | Tấn công | | **Nhân công tướng quân**: Tấn công hàng dọc trước 190%, Giảm sát thương địch 15% (3 lượt). | Giảm ST địch |
| 10 | **Hoa Hùng** | Tấn công | ⭐ | **Uy chấn Hổ Lao**: Tấn công đơn 290%, Hút máu đặc biệt theo cấp (cấp×9%, max 90%) và Tăng máu tối đa 10% bản thân. | Hút máu 90% (Signature Quần), Tăng HP max |
| 11 | **Cao Thuận** | Phòng thủ | | **Hãm Trận Doanh**: Giảm sát thương nhận vào 25%, Tăng máu tối đa 15% cho bản thân và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm ST nhận, Tăng HP max, Phản kích diện rộng |
| 12 | **Trần Cung** | Hỗ trợ | ⭐ | **Mưu định**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15%, Tăng 15% ST chí mạng toàn đội VÀ Giải choáng/thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Buff ST, Tăng chí mạng, Tăng ST chí mạng, Giải choáng & thiêu đốt |
| 13 | **Nhan Lương** | Phòng thủ | ⭐ | **Danh tướng Hà Bắc**: Tấn công đơn 290%, Hút máu theo cấp (cấp×2.5%, max 25%), Tăng 20% HP max bản thân, Buff sát thương bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu, Tăng HP max, Buff ST, Phản kích đơn |
| 14 | **Văn Sú** | Tấn công | ⭐ | **Mãnh tướng Hà Bắc**: Tấn công hàng ngang 220%, Buff sát thương bản thân 20%, Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%) và Hồi sinh (1 lần/trận). | Buff ST, Phản kích đơn, Hồi sinh |
| 15 | **Điền Phong** | Hỗ trợ | | **Trực gián**: Tấn công hàng ngang 140%, Xóa hiệu ứng có lợi của đối thủ. | Xóa buff địch |
| 16 | **Mạnh Hoạch** | Phòng thủ | | **Viễn mưu**: Tấn công toàn bộ địch 104%, Tăng máu tối đa cho bản thân và đồng minh cùng hàng 15%, Hồi máu 20% HP tối đa cho bản thân. | Tăng HP max đồng minh, Hồi máu |
| 17 | **Mã Đằng** | Tấn công | | **Tây Lương thiết kỵ**: Tấn công hàng dọc trước 200%, Buff sát thương bản thân 15% (3 lượt). | Buff ST |
| 18 | **Hàn Toại** | Hỗ trợ | | **Liên hoành**: Giảm sát thương nhận vào cho toàn đội 10% và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Giảm ST nhận, Xóa debuff đồng minh |
| 19 | **Đào Khiêm** | Hỗ trợ | | **Nhân nghĩa Từ Châu**: Hồi máu toàn đội (110% ST cơ bản) và Tăng máu tối đa toàn đội 10%. | Hồi máu, Tăng HP max |
| 20 | **Trương Lỗ** | Hỗ trợ | | **Ngũ Đấu Mễ Đạo**: Hồi máu hàng dọc trước (220% ST cơ bản), Tăng 15% Giảm sát thương cho hàng trước và Xóa hiệu ứng bất lợi. | Hồi máu, Giảm ST hàng trước, Xóa debuff |
| 21 | **Thái Văn Cơ** | Hỗ trợ | | **Bi ca**: Hồi máu toàn bộ đồng minh (110% ST cơ bản) và Buff sát thương cho toàn đội 10% (3 lượt). | Hồi máu toàn đội, Buff ST |
| 22 | **Trâu Ngọc** | Hỗ trợ | | **Mị ảnh**: Tấn công đơn 120%, gây Choáng mục tiêu (tỷ lệ cấp×10%, max 100%). | Choáng |
| 23 | **Chúc Dung** | Tấn công | | **Phi đao Nam Man**: Tấn công hàng ngang 180%, gây Thiêu đốt hàng ngang địch (4 lượt). | Thiêu đốt (4 lượt) |
| 24 | **Đổng Bạch** | Tấn công | | **Quý tộc tàn bạo**: Tấn công đơn 280%, Giảm máu tối đa mục tiêu 15% (3 lượt). | Giảm HP max địch (5%-15%) |
| 25 | **Trương Xuân Hoa** | Hỗ trợ | | **Lãnh tâm**: Tạo Khiên cho đồng minh thấp HP nhất bằng 20% HP tối đa, có 5%-50% tỷ lệ Xóa Khiên mục tiêu VÀ Giảm 20% sát thương nhận vào của người đó (3 lượt). | Tạo Khiên đồng minh, Xóa Khiên (5%-50%), Giảm ST nhận |
| 26 | **Lý Thôi** | Tấn công | | **Lương Châu mãnh tướng**: Tấn công đơn 275%, Hút máu theo cấp (cấp×2%, max 20%) và Tăng tỷ lệ chí mạng bản thân 20% (3 lượt). | Hút máu, Tăng chí mạng |
| 27 | **Quách Dĩ** | Phòng thủ | | **Tây Lương hung bạo**: Tấn công hàng dọc trước 200%, Giảm sát thương các mục tiêu 15% (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Phản kích đơn |
| 28 | **Cát Huyền** | Hỗ trợ | | **Đan đạo huyền công**: Hồi máu theo lượt cho toàn đội (50% ST cơ bản mỗi lượt, duy trì 3 lượt) VÀ Buff sát thương toàn đội 10% (3 lượt). | Hồi máu theo lượt (HoT), Buff ST |
| 29 | **Thẩm Phối** | Phòng thủ | | **Tử thủ Nghiệp Thành**: Hồi máu bản thân 15% HP tối đa, Tạo Khiên cho bản thân bằng 15% HP tối đa (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hồi máu, Tạo Khiên bản thân, Phản kích đơn |
| 30 | **Hứa Du** | Hỗ trợ | | **Hiến kế Ô Sào**: Giảm máu tối đa toàn bộ đối thủ 15% VÀ có 5%-50% tỷ lệ Xóa Khiên toàn bộ đối thủ. | Giảm HP max địch (5%-15%), Xóa Khiên (5%-50%) |
| 31 | **Tả Từ** | Hỗ trợ | | **Kỳ môn độn giáp**: Hồi máu toàn đội (100% ST cơ bản), Buff sát thương toàn đội 10% và Tăng tỷ lệ chí mạng toàn đội 10% (3 lượt). | Hồi máu, Buff ST, Tăng chí mạng |
| 32 | **Thủy Kính** | Hỗ trợ | | **Thủy Kính tiên sinh**: Tạo Khiên cho toàn đội bằng 15% HP tối đa VÀ Buff sát thương toàn đội 10% (3 lượt). | Tạo Khiên toàn đội, Buff ST |
| 33 | **Hoa Đà** | Hỗ trợ | | **Thần y tế thế**: Hồi máu đồng minh thấp HP nhất (420% ST cơ bản) và Giảm sát thương nhận vào của người đó 15% (3 lượt). | Hồi máu đơn, Giảm ST nhận |
| 34 | **Kỷ Linh** | Tấn công | | **Tam tiêm đao**: Tấn công đơn 280% và Tăng tỷ lệ chí mạng bản thân 25% (3 lượt). | Tăng chí mạng |
| 35 | **Nghiêm Bạch Hổ** | Phòng thủ | | **Sơn tặc chi vương**: Tấn công đơn 230%, gây Choáng (tỷ lệ cấp×3%, max 30%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Choáng, Phản kích đơn |