# Kỹ năng & Phong cách tướng (SKILLS.md)

Nguồn dữ liệu cân bằng cho chiến đấu PvP. Mã hoá tường minh trong `packages/game-config/src/pvp.ts` (bảng `PVP_ROSTER_ROWS` + `PVP_SKILL_DEF`); engine (`apps/api/src/managers/pvp.engine.ts`) chỉ đọc dữ liệu này.

---

## 1. Quy ước & Cơ chế chung

### Quy đổi hiệu ứng theo CẤP (áp cho MỌI hiệu ứng kỹ năng)

> **Mọi hệ số HIỆU ỨNG ghi trong tài liệu này là GIÁ TRỊ CHỐT ở cấp 10.** Khi vào trận, engine tự quy về cấp thực tế của tướng theo công thức tuyến tính:

- **Cấp 1 = giá trị chốt − 10 điểm %**, **cấp 10 = giữ nguyên giá trị chốt**, các cấp giữa nội suy đều (làm tròn). Giá trị không xuống dưới 0.
  - Ví dụ: Buff ST toàn đội `15%` → cấp 1 = **5%** → cấp 10 = **15%** (mỗi cấp +1%).
  - Tăng tỷ lệ chí mạng `20%` → cấp 1 = **10%** → cấp 10 = **20%**; `35%` → **25%** → **35%**.
  - Tăng máu tối đa `20%`, Hồi máu `20% HP tối đa` → cấp 1 = **10%** → cấp 10 = **20%**.
  - Buff sát thương bản thân `20%` → cấp 1 = **10%** → cấp 10 = **20%**.
- **Áp dụng cho**: buff có lợi (ST, HP tối đa, chí mạng, ST chí mạng, giảm ST nhận, ban hút máu), hồi máu/tự hồi máu, debuff lên địch (giảm ST, giảm HP tối đa, giảm chí mạng, giảm ST chí mạng, thiêu đốt), phản kích, "đao phủ" (+30% ST lên mục tiêu debuff), và mọi tỉ lệ khai báo dạng "mỗi cấp".
- **Tỉ lệ khai báo dạng "mỗi cấp"** (Choáng `cấp×X%`, Hút máu `cấp×X%`, Phản kích `cấp×3%`, Chí mạng `cấp×3%`) dùng CÙNG công thức trên: giá trị chốt = `X × 10` (đạt ở cấp 10), cấp 1 = giá trị chốt − 10 điểm %.
- **KHÔNG quy theo cấp**: hệ số SÁT THƯƠNG kỹ năng (`250%–320%`…) vì đã tự lớn theo cấp qua chỉ số nền (Damage/HP nền tăng 25%/cấp); ST chí mạng nền `150%`; số lượt hiệu lực (`rounds`) và trần cộng dồn (`maxLayers`); Aura/Chỉ số nội tại theo Phong cách.

### Phong cách & Thứ tự hành động

- **Phong cách**: Chỉ quyết định **lực chiến (LC)**, nhãn hiển thị và **chỉ số nội tại cộng thêm**:
  - **Tấn công** (LC cao nhất): Tăng **25% sát thương cơ bản** cho bản thân.
  - **Phòng thủ** (LC thấp nhất): Tăng **25% máu cơ bản** cho bản thân.
  - **Hỗ trợ**: Tăng **10% máu cơ bản** và **10% sát thương cơ bản** cho **toàn đội** (Aura toàn đội, **cộng dồn tối đa 3 lớp = +30% Máu & +30% ST** nếu sử dụng nhiều tướng Hỗ trợ). Aura áp ngay khi vào trận và **máu vẫn đầy 100%** theo trần mới (không bị tính là hồi máu).
- **Thứ tự hành động**: Hai đội **luân phiên nhau theo vị trí**. Vào trận, bên có **tổng LC cả đội cao hơn** ra đòn trước ở **vị trí 1**, rồi tới **vị trí 1 của bên kia**, **vị trí 2 của bên đi trước**, **vị trí 2 của bên kia**… cứ thế tới vị trí 6 (bằng tổng LC thì bên khiêu chiến A đi trước).

### Danh mục 15 Hiệu ứng được phép sử dụng

> **Quy tắc cộng dồn chung**: Mọi trần "Max cộng dồn" bên dưới đều tính **theo TỪNG nguồn (từng tướng thi triển)**, KHÔNG có trần toàn hệ thống trên một mục tiêu. Nhiều tướng khác nhau cùng áp một hiệu ứng lên cùng mục tiêu thì các lớp vẫn cộng dồn (mỗi nguồn tối đa bằng trần của nó).
>
> **Quy tắc số lượt mặc định**: Hiệu ứng nào **không ghi rõ số lượt** thì mặc định **3 lượt** (buff/debuff/phản kích). Riêng Thiêu đốt dùng số lượt riêng của nó (`4 lượt`).

1. **Buff sát thương**: Tăng % sát thương gây ra (thường 10% – 30%, hiệu lực 3 lượt). **Max cộng dồn: 3 lớp/nguồn**.
2. **Giảm sát thương**: Giảm % sát thương gánh chịu hoặc gây ra (10% – 25%, hiệu lực 3 lượt). **Max cộng dồn: 3 lớp**.
3. **Hồi máu**: Hồi HP ngay lập tức theo % HP tối đa hoặc hệ số sát thương cơ bản của người thi triển. *Tác dụng trực tiếp vào HP*.
4. **Tăng máu tối đa**: Tăng trần HP tối đa (10% – 20%), nhưng **chỉ hồi 1/4 lượng trần HP tăng lên** (ví dụ 1.000 máu, buff 10% → trần 1.100 nhưng chỉ hồi 25 máu). **Max cộng dồn: 3 lớp**.
5. **Giảm máu tối đa**: Giảm trần HP tối đa của đối thủ (10% – 15%, hiệu lực 3 lượt). **Max cộng dồn: 3 lớp**.
6. **Choáng**: Mục tiêu bị choáng không thể thực hiện hành động.
   - **Thời gian hiệu lực**: Duy trì cho đến khi **tướng gây ra hiệu ứng choáng đó ra skill ở lượt tiếp theo**.
   - **Cơ chế Ghi đè / Nối tiếp**: Cho phép choáng đè. Nếu một tướng khác tiếp tục gây choáng lên mục tiêu đang bị choáng, thời gian choáng sẽ được làm mới và **tính nối tiếp cho tới khi tướng gây choáng sau đó ra skill ở lượt kế tiếp**.
   - **Tỷ lệ & Cân bằng Sát thương**:
     - *Tướng Hỗ trợ Choáng đơn mục tiêu*: Sát thương giảm xuống **120% – 180%**, đổi lấy **Tỷ lệ choáng 80% – 100%** (`cấp × 8%` đến `cấp × 10%`).
     - *Tướng Tấn công Choáng đơn mục tiêu*: Sát thương cao (**250% – 285%**), tỷ lệ choáng **30% – 40%** (`cấp × 3%` đến `cấp × 4%`).
     - *Tướng Choáng diện rộng (Ngang/Dọc/AoE)*: Tỷ lệ choáng `cấp × 2%` đến `cấp × 3%` (max 20% – 30%).
7. **Giải choáng & Thiêu đốt**: Giải hiệu ứng Choáng hoặc Thiêu đốt cho đồng minh (tỷ lệ 30% – 75%). Tướng có kỹ năng giải choáng/thiêu đốt **miễn nhiễm Choáng**. *Tác dụng tức thì*.
8. **Thiêu đốt**: Gây thêm sát thương vào đầu mỗi lượt thi triển (mỗi lớp gây **50% sát thương cơ bản** của người thi triển). Sát thương Thiêu đốt **có thể ăn Chí mạng** theo chỉ số chí mạng của người thi triển.
   - *Tướng thường*: Duy trì **4 lượt**.
   - *Chu Du, Lục Tốn, Hoàng Cái*: Duy trì **4 lượt**, có thể **cộng dồn tối đa 3 lớp từ chính tướng đó**.
   - **Giới hạn cộng dồn**: Trần cộng dồn tính **theo TỪNG nguồn (từng tướng)**.
   - **Đặc biệt theo tướng**:
     - *Chu Du*: Khi gây sát thương Thiêu đốt, **tỷ lệ chí mạng và ST chí mạng của bản thân đều tăng thêm 30%** cho đòn thiêu đốt.
     - *Lục Tốn*: Hút máu áp dụng cho cả sát thương Thiêu đốt với hiệu suất **50% lượng hút máu gốc**.
9. **Tăng tỷ lệ chí mạng**: Tăng tỷ lệ chí mạng của bản thân hoặc đồng đội (10% – 35%). **Max cộng dồn: 3 lớp**.
10. **Giảm tỷ lệ chí mạng**: Giảm tỷ lệ chí mạng của đối thủ (15% – 20%). **Max cộng dồn: 3 lớp**.
11. **Tăng/Giảm sát thương chí mạng**: Mặc định ST Chí mạng là **150%**. Buff/Debuff tăng hoặc giảm sát thương chí mạng (15% – 30%). **Max cộng dồn: 3 lớp**.
12. **Phản kích (Nội tại Bị động)**: Tự động kích hoạt toàn trận khi gánh chịu sát thương trực tiếp (đánh thường hoặc kỹ năng direct). Phản kích **KHÔNG kích hoạt** từ sát thương gián tiếp (Thiêu đốt, Giảm/Mất HP max).
   - *Phản kích đơn mục tiêu*: Đánh trả tướng vừa gây sát thương, sát thương bằng **50% ST cơ bản** (ăn Chí mạng). Tỷ lệ theo cấp: `cấp × 3%` (max **30%**).
   - *Phản kích diện rộng (Chỉ dành cho Tướng Phòng Thủ chuyên biệt: Tào Nhân, Trương Phi, Cao Thuận, Đổng Trác)*: Đánh trả toàn bộ đội hình địch, sát thương bằng **30% ST cơ bản** (ăn Chí mạng). Tỷ lệ theo cấp: `cấp × 3%` (max **30%**).
13. **Hút máu**: Khi gây sát thương trực tiếp (hoặc Thiêu đốt với Lục Tốn), hồi lại HP tương ứng với % sát thương thực tế.
   - *Tướng tiêu chuẩn*: `cấp × 2%` (Max **20%**).
   - *Tướng Sát thủ/Bùng nổ cao*: `cấp × 3%` (Max **30%**).
   - *Signature Hero — mỗi phe đúng 1 tướng sở hữu hút máu vượt trội, mốc khác nhau cho đa dạng*: **Mã Siêu** (Thục) `cấp × 10%` (Max **100%**); **Cam Ninh** (Ngô) `cấp × 9.5%` (Max **95%**); **Hoa Hùng** (Quần) `cấp × 9%` (Max **90%**); **Nhạc Tiến** (Ngụy) `cấp × 8.5%` (Max **85%**). Cả 4 tướng đều kèm Tăng máu tối đa 10% bản thân.
   - *Ban hút máu cho đồng đội — mỗi phe đúng 1 tướng Hỗ trợ*: Buff cộng **+15%** hút máu cho toàn đội, hiệu lực **2 lượt** (cố định, giữ tối đa 1 lớp nên luôn ≤ 15%). Là **kênh buff phụ** cộng thêm vào bộ buff sẵn có của tướng (không đổi hệ số hiện tại): **Lưu Bị** (Thục), **Tuân Úc** (Ngụy), **Lỗ Túc** (Ngô), **Viên Thiệu** (Quần).
14. **Xóa hiệu ứng có lợi của đối thủ**: Loại bỏ các lớp buff có lợi trên người đối thủ (Tỷ lệ 75% – 100%). *Tác dụng tức thì*.
15. **Xóa hiệu ứng bất lợi của bản thân/đồng minh**: Loại bỏ các hiệu ứng xấu (bao gồm cả Thiêu đốt, trừ Choáng trừ khi có kỹ năng chuyên dụng). *Tác dụng tức thì*.
16. **Hồi sinh (Nội tại Bị động)**: Khi HP về 0 **lần đầu** trong trận, tướng **KHÔNG gục** mà hồi lại `cấp × 5%` HP tối đa (cấp 1 = **5%** → cấp 10 = **50%**), đổi lại **giảm 50% sát thương gây ra VĨNH VIỄN tới hết trận**. Chỉ hiệu lực **một lần mỗi trận** — lần chết thứ hai gục thật. Danh sách: **Triệu Vân** (Thục · Tấn công), **Tào Nhân** (Ngụy · Phòng thủ), **Hoàng Cái** (Ngô · Phòng thủ), **Văn Sú** (Quần · Tấn công).
17. **Gia tăng sát thương lên mục tiêu đang chịu hiệu ứng bất lợi (Nội tại theo tướng)**: Khi đòn đánh kỹ năng trúng mục tiêu **đang chịu hiệu ứng bất lợi** (Suy yếu, Thiêu đốt hoặc Choáng), tướng được **cộng thêm +30% sát thương** cho đòn đó. Danh sách (3 Ngụy + 1 mỗi phe khác): **Tào Phi**, **Tào Chân**, **Từ Hoảng** (Ngụy), **Mã Đại** (Thục), **Đinh Phụng** (Ngô), **Trương Bảo** (Quần).

### Cân bằng Hệ số Sát thương & Hồi máu

- **Tấn công đơn mục tiêu (Sát thương chính)**: **250% – 320%**
- **Tấn công đơn mục tiêu (Khống chế/Hỗ trợ)**: **120% – 180%**
- **Tấn công theo hàng (Ngang / Dọc / Hàng sau)**: **180% – 220%**
- **Tấn công toàn bộ địch (AoE sát thương chính)**: **105% – 127%**
- **Tấn công toàn bộ địch (AoE thiên về Buff/Hồi máu/Khống chế)**: **75% – 110%**
- **Hồi máu chủ động**: Toàn đội 100% – 110%, Hàng trước/sau 220%, Một đồng minh thấp HP nhất 420% (tính theo sát thương cơ bản).
- **Tướng hot (⭐)**: +10% hệ số sát thương/hồi máu kỹ năng.

---

## 2. Phe Ngụy (wei) — 25 Tướng (Tier A+)

> **Bản sắc**: Làm suy yếu, khống chế Choáng diện rộng, xóa buff triệt để, triệt hạ sát thương chí mạng đối thủ và Phản kích dẻo dai.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Tào Tháo** | Hỗ trợ | ⭐ | **Hiệu lệnh thiên hạ**: Tấn công toàn bộ địch 95%, 100% cơ hội Xóa 1 hiệu ứng có lợi của đối thủ VÀ Buff sát thương 20% cho toàn đội (3 lượt). | Xóa buff địch, Buff ST toàn đội |
| 2 | **Tào Phi** | Tấn công | ⭐ | **Đế vương trảm**: Tấn công đơn 290%, Giảm tỷ lệ chí mạng của mục tiêu 20%, Giảm 20% ST chí mạng và Hút máu theo cấp (cấp×2%, max 20%) (3 lượt). | Giảm chí mạng, Giảm ST chí mạng, Hút máu, +30% ST lên mục tiêu đang debuff |
| 3 | **Tào Nhân** | Phòng thủ | | **Thiết bích**: Tăng máu tối đa 15%, Hồi máu 10% HP cho bản thân mỗi lượt ra đòn, Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%) và Hồi sinh (1 lần/trận). | Tăng HP max, Hồi máu, Phản kích diện rộng, Hồi sinh |
| 4 | **Tào Hồng** | Phòng thủ | | **Hộ chủ**: Tấn công đơn 230%, Hồi máu 10% HP tối đa cho bản thân và Giảm sát thương nhận vào 15% (3 lượt). | Hồi máu, Giảm ST nhận |
| 5 | **Tào Chân** | Phòng thủ | | **Phá trận**: Tấn công hàng ngang 200%, Giảm sát thương của các mục tiêu 15% (3 lượt). | Giảm ST địch, +30% ST lên mục tiêu đang debuff |
| 6 | **Hạ Hầu Đôn** | Phòng thủ | ⭐ | **Độc nhãn cuồng đao**: Tấn công đơn 285%, gây Choáng mục tiêu (tỷ lệ cấp×4%, max 40%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Choáng, Phản kích đơn |
| 7 | **Hạ Hầu Uyên** | Tấn công | ⭐ | **Thần tốc tập kích**: Tấn công hàng sau 220%, Giảm tỷ lệ chí mạng hàng sau địch 20% (3 lượt). | Giảm chí mạng địch |
| 8 | **Trương Liêu** | Tấn công | ⭐ | **Uy chấn Tiêu Dao**: Tấn công hàng ngang 225%, Giảm sát thương địch 10%, Hút máu theo cấp (cấp×3%, max 30%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Hút máu, Phản kích đơn |
| 9 | **Nhạc Tiến** | Tấn công | | **Tiên phong phá địch**: Tấn công đơn 300%, Hút máu đặc biệt theo cấp (cấp×8.5%, max 85%) và Tăng máu tối đa 10% bản thân. | Hút máu 85% (Signature Ngụy), Tăng HP max |
| 10 | **Vu Cấm** | Phòng thủ | | **Nghiêm trận**: Hồi máu 20% HP tối đa cho bản thân, Giảm sát thương nhận vào 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hồi máu, Giảm ST nhận, Phản kích đơn |
| 11 | **Trương Cáp** | Tấn công | | **Kỳ binh đột kích**: Tấn công hàng sau 200%, gây Choáng mục tiêu (tỷ lệ cấp×3%, max 30%). | Choáng |
| 12 | **Từ Hoảng** | Tấn công | ⭐ | **Khai sơn phủ**: Tấn công đơn 305%, Giảm sát thương của mục tiêu 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Phản kích đơn, +30% ST lên mục tiêu đang debuff |
| 13 | **Điển Vi** | Phòng thủ | ⭐ | **Ác Lai hộ vệ**: Tăng máu tối đa 20%, Hồi máu 15% HP tối đa mỗi lượt ra đòn và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Hồi máu, Phản kích đơn |
| 14 | **Hứa Chử** | Phòng thủ | ⭐ | **Hổ si cuồng kích**: Tấn công đơn 295%, Hút máu theo cấp (cấp×2.5%, max 25%) và Buff sát thương bản thân 20% (3 lượt). | Hút máu, Buff ST |
| 15 | **Quách Gia** | Hỗ trợ | ⭐ | **Diệu kế thiên cơ**: Tấn công toàn bộ địch 85%, Tăng 15% HP tối đa cho toàn đội và Giảm sát thương nhận vào của toàn bộ địch 10% (3 lượt). | Tăng HP max toàn đội, Giảm ST địch |
| 16 | **Tuân Úc** | Hỗ trợ | | **Vương tá chi sách**: Buff sát thương 15% toàn đội (3 lượt), Giảm sát thương nhận vào cho toàn đội 10% (3 lượt) và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Giảm ST nhận, Ban hút máu |
| 17 | **Tuân Du** | Hỗ trợ | | **Liên hoàn kế**: Tấn công hàng dọc 180%, gây Choáng (tỷ lệ cấp×3%, max 30%). | Choáng |
| 18 | **Giả Hủ** | Hỗ trợ | | **Độc kế**: Tấn công hàng dọc 150%, gây Choáng các mục tiêu (tỷ lệ cấp×10%, max 100%) và Giảm sát thương địch 20%. | Choáng 100%, Giảm ST địch |
| 19 | **Tư Mã Ý** | Hỗ trợ | ⭐ | **Ẩn nhẫn phản kích**: Tấn công toàn bộ địch 125%, Giảm sát thương toàn bộ địch 15%, Giảm tỷ lệ chí mạng 15% VÀ Giảm 20% ST chí mạng toàn bộ địch (3 lượt). | Giảm ST địch, Giảm chí mạng, Giảm ST chí mạng |
| 20 | **Bàng Đức** | Phòng thủ | | **Quan tài quyết chiến**: Tấn công đơn 280%, Hút máu theo cấp (cấp×2%, max 20%), Tăng tỷ lệ chí mạng bản thân 25% và Tăng 25% ST chí mạng bản thân (3 lượt). | Hút máu, Tăng chí mạng, Tăng ST chí mạng |
| 21 | **Chân Cơ** | Hỗ trợ | | **Lạc Thần**: Hồi máu toàn đội (110% ST cơ bản) và Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Hồi máu, Giảm ST nhận |
| 22 | **Biện Ngọc Nhi** | Hỗ trợ | | **Hậu cung an định**: Tăng máu tối đa toàn đội 10% và Hồi máu toàn đội (100% ST cơ bản). | Tăng HP max, Hồi máu |
| 23 | **Tào Hoa** | Hỗ trợ | | **Nhu tình hộ mệnh**: Hồi máu đồng minh thấp HP nhất (420% ST cơ bản) và Buff sát thương cho người đó 15% (3 lượt). | Hồi máu đơn, Buff ST |
| 24 | **Tào Tiết** | Hỗ trợ | | **Trung trinh**: Tăng tỷ lệ chí mạng toàn đội 15% và Giảm sát thương nhận vào 10% (3 lượt). | Tăng chí mạng, Giảm ST nhận |
| 25 | **Tân Hiến Anh** | Hỗ trợ | | **Tuệ nhãn phá cục**: Tấn công toàn bộ địch 75%, Giải choáng và Giải thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Giải choáng & thiêu đốt |

---

## 3. Phe Thục (shu) — 25 Tướng (Tier A+)

> **Bản sắc**: Tấn công bùng nổ, dứt điểm nhanh, bạo phát chí mạng và sinh tồn dẻo dai.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Lưu Bị** | Hỗ trợ | ⭐ | **Nhân đức**: Buff sát thương toàn đội 15%, Tăng máu tối đa toàn đội 10% và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Tăng HP max, Ban hút máu |
| 2 | **Quan Vũ** | Tấn công | ⭐ | **Thanh Long Yển Nguyệt**: Tấn công **tướng địch có sát thương cao nhất** 320%, Tăng tỷ lệ chí mạng bản thân 30% và Tăng 30% ST chí mạng bản thân khi thi triển. | Nhắm tướng địch mạnh nhất, Tăng chí mạng, Tăng ST chí mạng |
| 3 | **Trương Phi** | Phòng thủ | ⭐ | **Hổ Khiếu Trường Bản**: Tấn công hàng ngang 220%, Buff sát thương bản thân 20% và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Buff ST, Phản kích diện rộng |
| 4 | **Gia Cát Lượng** | Hỗ trợ | ⭐ | **Bát trận đồ**: Tấn công toàn bộ địch 104%, gây Choáng (tỷ lệ cấp×2%, max 20%) và Buff sát thương toàn đội 10% (3 lượt). | Choáng, Buff ST |
| 5 | **Triệu Vân** | Tấn công | ⭐ | **Thất Tiến Thất Xuất**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng 20%, Giảm sát thương nhận vào 20% (3 lượt), Hút máu theo cấp (cấp×3%, max 30%) và Hồi sinh (1 lần/trận). | Tăng chí mạng, Giảm ST nhận, Hút máu, Hồi sinh |
| 6 | **Mã Siêu** | Tấn công | ⭐ | **Cẩm Mã Siêu**: Tấn công đơn 280%, Hút máu theo cấp đặc biệt (cấp×10%, max 100%) và Tăng máu tối đa 10% bản thân. | Hút máu 100%, Tăng HP max |
| 7 | **Hoàng Trung** | Tấn công | ⭐ | **Lão Đương Ích Tráng**: Tấn công hàng sau 210%, Tăng tỷ lệ chí mạng 35% cho phát bắn này. | Tăng chí mạng |
| 8 | **Ngụy Diên** | Tấn công | ⭐ | **Kỳ phong đột kích**: Tấn công hàng dọc 220%, Buff sát thương bản thân 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Phản kích đơn |
| 9 | **Khương Duy** | Tấn công | ⭐ | **Kế thừa Khổng Minh**: Tấn công đơn 260%, Buff sát thương bản thân 15% và gây Choáng (tỷ lệ cấp×4%, max 40%). | Choáng, Buff ST |
| 10 | **Bàng Thống** | Hỗ trợ | ⭐ | **Phượng Sồ liên hoàn**: Tấn công toàn bộ địch 85%, Buff sát thương toàn đội 15% (3 lượt). | Buff ST |
| 11 | **Pháp Chính** | Hỗ trợ | | **Tiên liệu chiến cơ**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15% và Tăng 20% ST chí mạng toàn đội (3 lượt). | Buff ST, Tăng chí mạng, Tăng ST chí mạng |
| 12 | **Từ Thứ** | Hỗ trợ | | **Kiếm hiệp phá trận**: Tấn công hàng ngang 160%, gây Choáng (tỷ lệ cấp×3%, max 30%) và Tăng 10% Tỷ lệ chí mạng cho đồng minh cùng hàng. | Choáng, Tăng chí mạng đồng minh |
| 13 | **Hoàng Nguyệt Anh** | Hỗ trợ | | **Cơ quan bát quái**: Tấn công toàn bộ địch 75%, Tăng tỷ lệ chí mạng toàn đội 10% (3 lượt). | Tăng chí mạng |
| 14 | **Quan Bình** | Tấn công | | **Thanh Long kế thừa**: Tấn công đơn 260%, Hút máu theo cấp (cấp×2%, max 20%), Buff sát thương bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu, Buff ST, Phản kích đơn |
| 15 | **Quan Hưng** | Tấn công | | **Hưng binh trảm tướng**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng 15% (3 lượt). | Tăng chí mạng |
| 16 | **Mã Đại** | Tấn công | | **Truy kích Tây Lương**: Tấn công hàng sau 200%, Buff sát thương bản thân 15% và Giảm 15% Tỷ lệ chí mạng hàng sau địch (3 lượt). | Buff ST, Giảm chí mạng địch, +30% ST lên mục tiêu đang debuff |
| 17 | **Vương Bình** | Phòng thủ | | **Kiên thủ Hán Trung**: Giảm sát thương nhận vào 25%, Hồi máu 15% HP tối đa mỗi lượt ra đòn và Giảm 10% sát thương nhận vào cho đồng minh cùng hàng (3 lượt). | Giảm ST nhận, Hồi máu, Giảm ST đồng minh |
| 18 | **Liêu Hóa** | Phòng thủ | | **Lão tướng tiên phong**: Tấn công đơn 270%, Tăng máu tối đa bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Phản kích đơn |
| 19 | **Giản Ung** | Hỗ trợ | | **Du thuyết**: Buff sát thương toàn đội 10% và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Buff ST, Xóa debuff đồng minh |
| 20 | **Mi Trúc** | Hỗ trợ | | **Hậu cần vững chắc**: Hồi máu cho hàng sau (220% ST cơ bản) và Buff sát thương hàng sau 15% (3 lượt). | Hồi máu, Buff ST |
| 21 | **Quan Ngân Bình** | Tấn công | | **Nữ tướng phá quân**: Tấn công đơn 250%, gây Choáng (tỷ lệ cấp×4%, max 40%). | Choáng |
| 22 | **Mi Trinh** | Hỗ trợ | | **Tương trợ**: Hồi máu toàn đội (100% ST cơ bản) và Tăng máu tối đa toàn đội 10%. | Hồi máu, Tăng HP max |
| 23 | **Gia Cát Quả** | Hỗ trợ | | **Tiên thuật**: Giảm sát thương nhận vào toàn đội 10% (3 lượt) và Giải choáng/thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Giảm ST nhận, Giải choáng & thiêu đốt |
| 24 | **Bao Tam Nương** | Tấn công | | **Hoa vũ song đao**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng bản thân 20% và Tăng 20% ST chí mạng (3 lượt). | Tăng chí mạng, Tăng ST chí mạng |
| 25 | **Ngô Ý** | Phòng thủ | | **Trấn thủ Ích Châu**: Giảm sát thương nhận vào 20%, Hồi máu bản thân 15% HP tối đa và Tăng 10% HP tối đa cho đồng minh thấp HP nhất. | Giảm ST nhận, Hồi máu, Tăng HP đồng minh |

---

## 4. Phe Ngô (wu) — 25 Tướng (Tier A+)

> **Bản sắc**: Tấn công theo hàng, thiêu đốt dồn lớp (xuyên thủ), hút máu duy trì và dàn tank phòng thủ dẻo dai.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Tôn Kiên** | Phòng thủ | ⭐ | **Giang Đông mãnh hổ**: Tấn công hàng ngang 200%, Giảm sát thương địch 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Phản kích đơn |
| 2 | **Tôn Sách** | Phòng thủ | ⭐ | **Tiểu Bá Vương**: Tấn công toàn bộ địch 123.5%, Buff sát thương bản thân 20%, Hút máu theo cấp (cấp×2.5%, max 25%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Hút máu, Phản kích đơn |
| 3 | **Tôn Quyền** | Hỗ trợ | ⭐ | **Đế nghiệp Giang Đông**: Buff sát thương toàn đội 15% và Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Buff ST, Giảm ST nhận |
| 4 | **Chu Du** | Tấn công | ⭐ | **Hỏa thiêu Xích Bích**: Tấn công toàn bộ địch 117%, gây Thiêu đốt toàn bộ địch (duy trì 4 lượt, dồn max 3 lớp). Đòn Thiêu đốt: tăng thêm 30% tỷ lệ chí mạng và 30% ST chí mạng. | Thiêu đốt (4 lượt, dồn 3), Thiêu đốt +30% chí mạng |
| 5 | **Lục Tốn** | Tấn công | ⭐ | **Hỏa kế liên doanh**: Tấn công hàng dọc 180%, gây Thiêu đốt hàng dọc địch (duy trì 4 lượt, dồn max 3 lớp), Giảm HP tối đa địch 10%. Hút máu 50% hiệu suất áp dụng cho cả đòn Thiêu đốt. | Thiêu đốt (4 lượt, dồn 3), Giảm HP max, Hút máu thiêu đốt |
| 6 | **Lữ Mông** | Phòng thủ | ⭐ | **Bạch y độ giang**: Tấn công đơn 290% và Tăng 10% HP tối đa cho toàn đội (3 lượt). | Tăng HP max toàn đội |
| 7 | **Hoàng Cái** | Phòng thủ | ⭐ | **Khổ nhục kế**: Tự gây Thiêu đốt bản thân (duy trì 4 lượt, dồn 3 lớp) để Buff sát thương bản thân 30%, Hồi máu 10% HP tối đa, Hút máu theo cấp (cấp×2%, max 20%), Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%) và Hồi sinh (1 lần/trận). | Thiêu đốt bản thân, Buff ST, Hồi máu, Hút máu, Phản kích đơn, Hồi sinh |
| 8 | **Trình Phổ** | Phòng thủ | | **Lão tướng trấn quân**: Giảm sát thương nhận vào 20%, Hồi máu bản thân 15% HP tối đa và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Phản kích đơn |
| 9 | **Hàn Đương** | Tấn công | | **Cung kỵ hợp kích**: Tấn công hàng sau 200%, Tăng tỷ lệ chí mạng 20% và Tăng 20% ST chí mạng (3 lượt). | Tăng chí mạng, Tăng ST chí mạng |
| 10 | **Thái Sử Từ** | Tấn công | ⭐ | **Thần xạ**: Tấn công đơn hàng sau 300%, Tăng tỷ lệ chí mạng 25% cho phát bắn này. | Tăng chí mạng |
| 11 | **Cam Ninh** | Tấn công | ⭐ | **Cẩm Phàm tập kích**: Tấn công đơn 265%, Hút máu đặc biệt theo cấp (cấp×9.5%, max 95%) và Tăng máu tối đa 10% bản thân. | Hút máu 95% (Signature Ngô), Tăng HP max |
| 12 | **Lăng Thống** | Tấn công | | **Liên kích**: Tấn công hàng ngang 200%, Buff sát thương bản thân 20% (3 lượt). Nếu mục tiêu đang bị Thiêu đốt, Tăng thêm 20% ST chí mạng. | Buff ST, Tăng ST chí mạng chống thiêu đốt |
| 13 | **Chu Thái** | Phòng thủ | | **Hộ chủ bất khuất**: Tăng máu tối đa 20%, Hồi máu 20% HP tối đa cho bản thân và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Hồi máu, Phản kích đơn |
| 14 | **Từ Thịnh** | Phòng thủ | | **Giang phòng thiết thủ**: Giảm sát thương nhận vào 25% cho bản thân, Hồi máu 10% HP tối đa và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Phản kích đơn |
| 15 | **Đinh Phụng** | Tấn công | | **Tuyết trung đột kích**: Tấn công đơn 270%, gây Choáng mục tiêu (tỷ lệ cấp×4%, max 40%) và gây Thiêu đốt (4 lượt). | Choáng, Thiêu đốt, +30% ST lên mục tiêu đang debuff |
| 16 | **Chu Hoàn** | Phòng thủ | | **Hỏa công phá trận**: Tấn công hàng ngang 180%, gây Thiêu đốt các mục tiêu (4 lượt). | Thiêu đốt (4 lượt) |
| 17 | **Trương Chiêu** | Hỗ trợ | | **Ổn định triều chính**: Giảm sát thương nhận vào cho toàn đội 15% (3 lượt) và Hồi máu toàn đội (100% ST cơ bản). | Giảm ST nhận, Hồi máu |
| 18 | **Trương Hoành** | Hỗ trợ | | **Hoành sách**: Buff sát thương toàn đội 15% và Tăng tỷ lệ chí mạng toàn đội 15% (3 lượt). | Buff ST, Tăng chí mạng |
| 19 | **Lỗ Túc** | Hỗ trợ | ⭐ | **Liên minh Tôn Lưu**: Buff sát thương toàn đội 15%, Tăng máu tối đa toàn đội 10% và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Tăng HP max, Ban hút máu |
| 20 | **Tôn Thượng Hương** | Tấn công | | **Kiêu cơ cung vũ**: Tấn công hàng sau 210%, Tăng tỷ lệ chí mạng 25% và gây Thiêu đốt nhẹ (30% ST, 4 lượt). | Tăng chí mạng, Thiêu đốt nhẹ |
| 21 | **Đại Kiều** | Hỗ trợ | | **Quốc sắc**: Hồi máu toàn đội (110% ST cơ bản) và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Hồi máu, Xóa debuff đồng minh |
| 22 | **Tiểu Kiều** | Hỗ trợ | | **Thiên hương**: Tăng tỷ lệ chí mạng toàn đội 15% và Buff sát thương toàn đội 10% (3 lượt). | Tăng chí mạng, Buff ST |
| 23 | **Bộ Luyện Sư** | Hỗ trợ | | **Hiền hậu hộ quân**: Hồi máu đồng minh thấp HP nhất (420% ST cơ bản) và Giảm sát thương nhận vào của người đó 20% (3 lượt). | Hồi máu đơn, Giảm ST nhận |
| 24 | **Tôn Lỗ Dục** | Hỗ trợ | | **Hòa giải**: Giải choáng/thiêu đốt cho toàn bộ đồng minh (tỷ lệ 30%-75%) và Hồi máu nhẹ toàn đội (60% ST cơ bản). | Giải choáng & thiêu đốt, Hồi máu |
| 25 | **Tôn Lỗ Ban** | Hỗ trợ | | **An định Giang Đông**: Tấn công toàn bộ địch 70% và Giảm máu tối đa của toàn bộ đối thủ 10% (3 lượt). | Giảm HP max địch |

---

## 5. Phe Quần Hùng (qun) — 25 Tướng (Tier A+)

> **Bản sắc**: Đa năng đột biến, trảm % HP max đối thủ, hủy diệt bạo phát, phản kích diện rộng và giải hiệu ứng xấu cực tốt.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Đổng Trác** | Phòng thủ | ⭐ | **Bạo chúa**: Giảm máu tối đa của toàn bộ đối thủ 15%, Hồi máu bản thân 20% HP tối đa và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm HP max địch, Hồi máu, Phản kích diện rộng |
| 2 | **Lữ Bố** | Tấn công | ⭐ | **Vô song**: Tấn công toàn bộ địch 127%, Tăng tỷ lệ chí mạng bản thân 20%, Tăng 20% ST chí mạng, Hút máu theo cấp (cấp×3%, max 30%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng chí mạng, Tăng ST chí mạng, Hút máu, Phản kích đơn |
| 3 | **Điêu Thuyền** | Hỗ trợ | ⭐ | **Bế nguyệt**: Tấn công đơn 120%, gây Choáng (tỷ lệ cấp×8%, max 80%) và Giảm sát thương mục tiêu 20%. | Choáng, Giảm ST địch |
| 4 | **Viên Thiệu** | Hỗ trợ | ⭐ | **Thế gia hào tộc**: Tăng máu tối đa toàn đội 15%, Buff sát thương toàn đội 10% và Ban hút máu 15% cho toàn đội (2 lượt). | Tăng HP max, Buff ST, Ban hút máu |
| 5 | **Viên Thuật** | Hỗ trợ | | **Trọng thị đế nghiệp**: Giảm máu tối đa hàng trước của đối thủ 15% (3 lượt). | Giảm HP max địch |
| 6 | **Công Tôn Toản** | Tấn công | ⭐ | **Bạch mã nghĩa tùng**: Tấn công hàng sau 220%, Tăng tỷ lệ chí mạng 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng chí mạng, Phản kích đơn |
| 7 | **Trương Giác** | Hỗ trợ | ⭐ | **Thái Bình đạo**: Tấn công toàn bộ địch 115%, gây Choáng (tỷ lệ cấp×2%, max 20%), Giảm tỷ lệ chí mạng toàn bộ địch 15% và Thiêu đốt nhẹ (4 lượt). | Choáng, Giảm chí mạng địch, Thiêu đốt |
| 8 | **Trương Bảo** | Tấn công | | **Địa công tướng quân**: Tấn công hàng ngang 190%, Giảm tỷ lệ chí mạng địch 15% và Giảm 20% ST chí mạng địch (3 lượt). | Giảm chí mạng, Giảm ST chí mạng, +30% ST lên mục tiêu đang debuff |
| 9 | **Trương Lương** | Tấn công | | **Nhân công tướng quân**: Tấn công hàng dọc 190%, Giảm sát thương địch 15% (3 lượt). | Giảm ST địch |
| 10 | **Hoa Hùng** | Tấn công | ⭐ | **Uy chấn Hổ Lao**: Tấn công đơn 290%, Hút máu đặc biệt theo cấp (cấp×9%, max 90%) và Tăng máu tối đa 10% bản thân. | Hút máu 90% (Signature Quần), Tăng HP max |
| 11 | **Cao Thuận** | Phòng thủ | | **Hãm Trận Doanh**: Giảm sát thương nhận vào 25%, Tăng máu tối đa 15% cho bản thân và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm ST nhận, Tăng HP max, Phản kích diện rộng |
| 12 | **Trần Cung** | Hỗ trợ | ⭐ | **Mưu định**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15%, Tăng 15% ST chí mạng toàn đội VÀ Giải choáng/thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Buff ST, Tăng chí mạng, Tăng ST chí mạng, Giải choáng & thiêu đốt |
| 13 | **Nhan Lương** | Phòng thủ | ⭐ | **Danh tướng Hà Bắc**: Tấn công đơn 290%, Hút máu theo cấp (cấp×2.5%, max 25%), Tăng 20% HP max bản thân, Buff sát thương bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu, Tăng HP max, Buff ST, Phản kích đơn |
| 14 | **Văn Sú** | Tấn công | ⭐ | **Mãnh tướng Hà Bắc**: Tấn công hàng ngang 220%, Buff sát thương bản thân 20%, Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%) và Hồi sinh (1 lần/trận). | Buff ST, Phản kích đơn, Hồi sinh |
| 15 | **Điền Phong** | Hỗ trợ | | **Trực gián**: Tấn công hàng ngang 140%, Xóa hiệu ứng có lợi của đối thủ. | Xóa buff địch |
| 16 | **Mạnh Hoạch** | Phòng thủ | | **Viễn mưu**: Tấn công toàn bộ địch 104%, Tăng máu tối đa cho bản thân và đồng minh cùng hàng 15%, Hồi máu 20% HP tối đa cho bản thân. | Tăng HP max đồng minh, Hồi máu |
| 17 | **Mã Đằng** | Tấn công | | **Tây Lương thiết kỵ**: Tấn công hàng sau 200%, Buff sát thương bản thân 15% (3 lượt). | Buff ST |
| 18 | **Hàn Toại** | Hỗ trợ | | **Liên hoành**: Giảm sát thương nhận vào cho toàn đội 10% và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Giảm ST nhận, Xóa debuff đồng minh |
| 19 | **Đào Khiêm** | Hỗ trợ | | **Nhân nghĩa Từ Châu**: Hồi máu toàn đội (110% ST cơ bản) và Tăng máu tối đa toàn đội 10%. | Hồi máu, Tăng HP max |
| 20 | **Trương Lỗ** | Hỗ trợ | | **Ngũ Đấu Mễ Đạo**: Hồi máu hàng trước (220% ST cơ bản), Tăng 15% Giảm sát thương cho hàng trước và Xóa hiệu ứng bất lợi. | Hồi máu, Giảm ST hàng trước, Xóa debuff |
| 21 | **Thái Văn Cơ** | Hỗ trợ | | **Bi ca**: Hồi máu toàn bộ đồng minh (110% ST cơ bản) và Buff sát thương cho toàn đội 10% (3 lượt). | Hồi máu toàn đội, Buff ST |
| 22 | **Trâu Ngọc** | Hỗ trợ | | **Mị ảnh**: Tấn công đơn 120%, gây Choáng mục tiêu (tỷ lệ cấp×10%, max 100%). | Choáng |
| 23 | **Chúc Dung** | Tấn công | | **Phi đao Nam Man**: Tấn công hàng ngang 180%, gây Thiêu đốt hàng ngang địch (4 lượt). | Thiêu đốt (4 lượt) |
| 24 | **Đổng Bạch** | Tấn công | | **Quý tộc tàn bạo**: Tấn công đơn 280%, Giảm máu tối đa mục tiêu 15% (3 lượt). | Giảm HP max địch |
| 25 | **Trương Xuân Hoa** | Hỗ trợ | | **Lãnh tâm**: Tấn công đơn 140%, Giảm sát thương mục tiêu 20% và Xóa hiệu ứng có lợi của đối thủ. | Giảm ST địch, Xóa buff địch |