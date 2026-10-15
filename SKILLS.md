# Kỹ năng & Phong cách tướng (SKILLS.md)

Nguồn dữ liệu cân bằng cho chiến đấu PvP. Mã hoá tường minh trong `packages/game-config/src/pvp.ts` (bảng `PVP_ROSTER_ROWS` + `PVP_SKILL_DEF`); engine (`apps/api/src/managers/pvp.engine.ts`) chỉ đọc dữ liệu này.

---

## 1. Quy ước & Cơ chế chung

### Phong cách & Thứ tự hành động

- **Phong cách**: Chỉ quyết định **lực chiến (LC)** và nhãn hiển thị:
  `Tấn công` (LC cao nhất) → `Hỗ trợ` → `Phòng thủ` (LC thấp nhất). Phong cách **không** cộng chỉ số.
- **Thứ tự hành động**: Hai đội **luân phiên nhau theo vị trí**. Vào trận, bên có **tổng LC cả đội cao hơn** ra đòn trước ở **vị trí 1**, rồi tới **vị trí 1 của bên kia**, **vị trí 2 của bên đi trước**, **vị trí 2 của bên kia**… cứ thế tới vị trí 6 (bằng tổng LC thì bên khiêu chiến A đi trước).

### Danh mục 15 Hiệu ứng được phép sử dụng

> **Quy tắc cộng dồn chung**: Mọi trần "Max cộng dồn" bên dưới đều tính **theo TỪNG nguồn (từng tướng thi triển)**, KHÔNG có trần toàn hệ thống trên một mục tiêu. Nhiều tướng khác nhau cùng áp một hiệu ứng lên cùng mục tiêu thì các lớp vẫn cộng dồn (mỗi nguồn tối đa bằng trần của nó).
>
> **Quy tắc số lượt mặc định**: Hiệu ứng nào **không ghi rõ số lượt** thì mặc định **3 lượt** (buff/debuff/phản kích). Riêng Thiêu đốt dùng số lượt riêng của nó (`4 lượt`, tướng đặc biệt `4 lượt`).

1. **Buff sát thương**: Tăng % sát thương gây ra (thường 10% – 30%, hiệu lực 3 lượt). **Max cộng dồn: 3 lớp/nguồn**.
2. **Giảm sát thương**: Giảm % sát thương gánh chịu hoặc gây ra (10% – 25%, hiệu lực 3 lượt). **Max cộng dồn: 3 lớp**.
3. **Hồi máu**: Hồi HP ngay lập tức theo % HP tối đa hoặc hệ số sát thương cơ bản của người thi triển. *Tác dụng trực tiếp vào HP*.
4. **Tăng máu tối đa**: Tăng trần HP tối đa và hồi ngay lượng trần HP tăng lên tương ứng (10% – 20%). **Max cộng dồn: 3 lớp**.
5. **Giảm máu tối đa**: Giảm trần HP tối đa của đối thủ (10% – 15%, hiệu lực 3 lượt). **Max cộng dồn: 3 lớp**.
6. **Choáng**: Mục tiêu bị choáng không thể thực hiện hành động.
   - **Thời gian hiệu lực**: Duy trì cho đến khi **tướng gây ra hiệu ứng choáng đó ra skill ở lượt tiếp theo**.
   - **Cơ chế Ghi đè / Nối tiếp**: Cho phép choáng đè. Nếu một tướng khác tiếp tục gây choáng lên mục tiêu đang bị choáng, thời gian choáng sẽ được làm mới và **tính nối tiếp cho tới khi tướng gây choáng sau đó ra skill ở lượt kế tiếp**.
   - **Tỷ lệ & Cân bằng Sát thương**:
     - *Tướng Hỗ trợ Choáng đơn mục tiêu*: Sát thương giảm sâu xuống **110% – 130%**, đổi lấy **Tỷ lệ choáng 100%** (`cấp × 10%`).
     - *Tướng Tấn công Choáng đơn mục tiêu*: Giữ sát thương cao (**250% – 285%**), tỷ lệ choáng giảm xuống **30% – 50%** (`cấp × 3%` đến `cấp × 5%`).
     - *Tướng Choáng diện rộng (Ngang/Dọc/AoE)*: Tỷ lệ choáng `cấp × 3%` (max 30%).
     - *Tướng kết hợp Choáng + Hiệu ứng khác*: Giới hạn tỷ lệ choáng **tối đa 20%** (`cấp × 2%`).
7. **Giải choáng**: Giải hiệu ứng Choáng cho đồng minh (tỷ lệ 30% – 75%). Tướng có kỹ năng giải choáng **miễn nhiễm Choáng**. *Tác dụng tức thì*.
8. **Thiêu đốt**: Gây thêm sát thương vào đầu mỗi lượt thi triển (mỗi lớp gây **50% sát thương cơ bản** của người thi triển). Sát thương Thiêu đốt **có thể ăn Chí mạng** theo chỉ số chí mạng của người thi triển.
   - *Tướng thường*: Duy trì **4 lượt**.
   - *Chu Du, Lục Tốn, Hoàng Cái*: Duy trì **4 lượt**, có thể **cộng dồn tối đa 3 lớp từ chính tướng đó**.
   - **Giới hạn cộng dồn**: Trần cộng dồn tính **theo TỪNG nguồn (từng tướng)**, KHÔNG có trần toàn hệ thống. Ví dụ 6 tướng cùng thiêu đốt 1 mục tiêu, mỗi tướng đạt trần 3 lớp thì mục tiêu đó có thể dồn tới **18 lớp Thiêu đốt cùng lúc**.
   - **Đặc biệt theo tướng**:
     - *Chu Du*: khi gây sát thương Thiêu đốt, **tỷ lệ chí mạng và ST chí mạng của bản thân đều tăng thêm 50%** (chỉ áp cho đòn Thiêu đốt, không áp cho đòn đánh trực tiếp).
     - *Lục Tốn*: **Hút máu áp dụng cho cả sát thương Thiêu đốt** (không chỉ đòn đánh trực tiếp) — hồi cho bản thân theo % sát thương thiêu đốt gây ra.
9. **Tăng tỷ lệ chí mạng**: Tăng tỷ lệ chí mạng của bản thân hoặc đồng đội (10% – 35%). **Max cộng dồn: 3 lớp**.
10. **Giảm tỷ lệ chí mạng**: Giảm tỷ lệ chí mạng của đối thủ (15% – 20%). **Max cộng dồn: 3 lớp**.
11. **Tăng/Giảm sát thương chí mạng**: Mặc định ST Chí mạng là **150%**. Buff/Debuff tăng hoặc giảm sát thương chí mạng (15% – 30%). **Max cộng dồn: 3 lớp**.
12. **Phản kích (Nội tại Bị động)**: Tự động kích hoạt toàn trận khi gánh chịu sát thương trực tiếp (đánh thường hoặc kỹ năng direct). **LƯU Ý**: Phản kích **KHÔNG kích hoạt** từ sát thương gián tiếp như **Thiêu đốt** hoặc **Giảm/Mất máu tối đa**.
    - *Phản kích đơn mục tiêu*: Đánh trả duy nhất tướng vừa gây sát thương, sát thương bằng **50% ST cơ bản** (có thể ăn Chí mạng). Tỷ lệ theo cấp: `cấp × 3%` (max **30%**).
    - *Phản kích diện rộng (Toàn bộ địch)*: Lập tức đánh trả **toàn bộ đội hình địch**, sát thương bằng **30% ST cơ bản** (có thể ăn Chí mạng). Tỷ lệ theo cấp: `cấp × 3%` (max **30%**).
13. **Hút máu**: Khi gây sát thương trực tiếp (đánh thường hoặc kỹ năng chủ động), tướng sở hữu Hút máu sẽ được hồi lại một lượng HP tương ứng với **% sát thương thực tế gây ra**.
    - *Tướng tiêu chuẩn*: `cấp × 2%` (Max **20%**).
    - *Tướng Sát thủ/Bùng nổ cao*: `cấp × 3%` (Max **30%**).
    - Có thể tồn tại dạng **Nội tại bị động toàn trận** hoặc **Hiệu ứng kích hoạt từ Kỹ năng** (duy trì 3 lượt).
14. **Xóa hiệu ứng có lợi của đối thủ**: Loại bỏ các lớp buff có lợi trên người đối thủ. *Tác dụng tức thì*.
15. **Xóa hiệu ứng bất lợi của bản thân/đồng minh**: Loại bỏ các hiệu ứng xấu, **ngoại trừ Choáng và Thiêu đốt**. *Tác dụng tức thì*.

### Cân bằng Hệ số Sát thương & Hồi máu

- **Tấn công đơn mục tiêu (Sát thương chính)**: **250% – 320%**
- **Tấn công đơn mục tiêu (Khống chế 100% Choáng - Hỗ trợ)**: **110% – 130%**
- **Tấn công theo hàng (Ngang / Dọc / Hàng sau)**: **180% – 220%**
- **Tấn công toàn bộ địch (AoE sát thương chính)**: **100% – 130%** (đã **+30%** so với mốc 80% – 95% cũ, do AoE bị yếu đi sau các đợt giảm trước).
- **Tấn công toàn bộ địch (AoE thiên về Buff/Hồi máu/Khống chế)**: **55% – 90%** — riêng nhóm AoE **thuần buff đồng đội** (Quách Gia, Bàng Thống, Hoàng Nguyệt Anh) **giữ nguyên**, không cộng +30%.
- **Hồi máu chủ động**: Toàn đội 80% – 110%, Hàng trước/sau 220%, Một đồng minh thấp HP nhất 330% (tính theo sát thương cơ bản của bản thân).
- **Tướng hot (⭐)**: +10% hệ số sát thương/hồi máu kỹ năng (kể cả đánh thường).

---

## 2. Phe Ngụy (wei) — 25 Tướng

> **Bản sắc**: Làm suy yếu, kiểm soát đối thủ và tạo lợi thế chiến thuật (Choáng, Giảm sát thương, Giảm chí mạng, Xóa buff đối thủ, Phản kích, Hút máu).

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Tào Tháo** | Hỗ trợ | ⭐ | **Hiệu lệnh thiên hạ**: Tấn công toàn bộ địch 97.5%, có 50% cơ hội Xóa hiệu ứng có lợi của đối thủ. Bản thân Buff sát thương 15% (3 lượt). | Xóa buff địch, Buff ST |
| 2 | **Tào Phi** | Tấn công | ⭐ | **Đế vương trảm**: Tấn công đơn 290%, Giảm tỷ lệ chí mạng của mục tiêu 20% và Giảm 20% ST chí mạng của mục tiêu (3 lượt). | Giảm chí mạng, Giảm ST chí mạng |
| 3 | **Tào Nhân** | Phòng thủ | | **Thiết bích**: Tăng máu tối đa 15%, Hồi máu 15% HP cho bản thân mỗi lượt ra đòn và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Tăng HP max, Hồi máu, Phản kích diện rộng |
| 4 | **Tào Hồng** | Phòng thủ | | **Hộ chủ**: Tấn công đơn 230%, Hồi máu 10% HP tối đa cho bản thân và Giảm sát thương nhận vào 15% (3 lượt). | Hồi máu, Giảm ST nhận |
| 5 | **Tào Chân** | Phòng thủ | | **Phá trận**: Tấn công hàng ngang 200%, Giảm sát thương của các mục tiêu 15% (3 lượt). | Giảm ST địch |
| 6 | **Hạ Hầu Đôn** | Phòng thủ | ⭐ | **Độc nhãn cuồng đao**: Tấn công đơn 285%, gây Choáng mục tiêu (tỷ lệ cấp×4%, max 40%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Choáng, Phản kích đơn |
| 7 | **Hạ Hầu Uyên** | Tấn công | ⭐ | **Thần tốc tập kích**: Tấn công hàng sau 220%, Giảm tỷ lệ chí mạng hàng sau địch 15% (3 lượt). | Giảm chí mạng địch |
| 8 | **Trương Liêu** | Tấn công | ⭐ | **Uy chấn Tiêu Dao**: Tấn công hàng ngang 225%, Giảm sát thương địch 10%, Hút máu theo cấp (cấp×3%, max 30%) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm ST địch, Hút máu, Phản kích diện rộng |
| 9 | **Nhạc Tiến** | Tấn công | | **Tiên phong phá địch**: Tấn công đơn 290%, Xóa hiệu ứng có lợi của đối thủ, Hút máu theo cấp (cấp×2%, max 20%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Xóa buff địch, Hút máu, Phản kích đơn |
| 10 | **Vu Cấm** | Phòng thủ | | **Nghiêm trận**: Hồi máu 20% HP tối đa cho bản thân, Giảm sát thương nhận vào 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hồi máu, Giảm ST nhận, Phản kích đơn |
| 11 | **Trương Cáp** | Tấn công | | **Kỳ binh đột kích**: Tấn công hàng sau 200%, gây Choáng mục tiêu (tỷ lệ cấp×3%, max 30%). | Choáng |
| 12 | **Từ Hoảng** | Tấn công | ⭐ | **Khai sơn phủ**: Tấn công đơn 305%, Giảm sát thương của mục tiêu 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Phản kích đơn |
| 13 | **Điển Vi** | Phòng thủ | ⭐ | **Ác Lai hộ vệ**: Tăng máu tối đa 20%, Hồi máu 15% HP tối đa mỗi lượt ra đòn và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Hồi máu, Phản kích đơn |
| 14 | **Hứa Chử** | Phòng thủ | ⭐ | **Hổ si cuồng kích**: Tấn công đơn 295%, Hút máu theo cấp (cấp×2.5%, max 25%) và Buff sát thương bản thân 20% (3 lượt). | Hút máu, Buff ST |
| 15 | **Quách Gia** | Hỗ trợ | ⭐ | **Diệu kế thiên cơ**: Tấn công toàn bộ địch 70% và Tăng 10% HP tối đa cho toàn đội (3 lượt). | Tăng HP max toàn đội |
| 16 | **Tuân Úc** | Hỗ trợ | | **Vương tá chi sách**: Buff sát thương 15% toàn đội (3 lượt) và Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Buff ST, Giảm ST nhận |
| 17 | **Tuân Du** | Hỗ trợ | | **Liên hoàn kế**: Tấn công hàng dọc 120%, gây Choáng (tỷ lệ cấp×3%, max 30%). | Choáng |
| 18 | **Giả Hủ** | Hỗ trợ | | **Độc kế**: Tấn công đơn 120%, gây Choáng mục tiêu (tỷ lệ cấp×10%, max 100%). | Choáng (Khống chế Hỗ trợ) |
| 19 | **Tư Mã Ý** | Hỗ trợ | ⭐ | **Ẩn nhẫn phản kích**: Tấn công toàn bộ địch 117%, Giảm sát thương toàn bộ địch 15% (3 lượt). | Giảm ST địch |
| 20 | **Bàng Đức** | Phòng thủ | | **Quan tài quyết chiến**: Tấn công đơn 280%, Hút máu theo cấp (cấp×2%, max 20%), Tăng tỷ lệ chí mạng bản thân 25% và Tăng 25% ST chí mạng bản thân (3 lượt). | Hút máu, Tăng chí mạng, Tăng ST chí mạng |
| 21 | **Chân Cơ** | Hỗ trợ | | **Lạc Thần**: Hồi máu toàn đội (110% ST cơ bản) và Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Hồi máu, Giảm ST nhận |
| 22 | **Biện Ngọc Nhi** | Hỗ trợ | | **Hậu cung an định**: Tăng máu tối đa toàn đội 10% và Hồi máu toàn đội (80% ST cơ bản). | Tăng HP max, Hồi máu |
| 23 | **Tào Hoa** | Hỗ trợ | | **Nhu tình hộ mệnh**: Hồi máu đồng minh thấp HP nhất (330% ST cơ bản) và Buff sát thương cho người đó 15% (3 lượt). | Hồi máu, Buff ST |
| 24 | **Tào Tiết** | Hỗ trợ | | **Trung trinh**: Tăng tỷ lệ chí mạng toàn đội 15% và Giảm sát thương nhận vào 10% (3 lượt). | Tăng chí mạng, Giảm ST nhận |
| 25 | **Tân Hiến Anh** | Hỗ trợ | | **Tuệ nhãn phá cục**: Tấn công toàn bộ địch 71.5%, Giải choáng cho đồng minh bị choáng (tỷ lệ 30%-75%). | Giải choáng |

---

## 3. Phe Thục (shu) — 25 Tướng

> **Bản sắc**: Tấn công bùng nổ, dứt điểm nhanh, tăng sức mạnh, tỷ lệ/sát thương chí mạng, hút máu hồi phục và phản kích phản đòn.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Lưu Bị** | Hỗ trợ | ⭐ | **Nhân đức**: Buff sát thương toàn đội 15% và Tăng máu tối đa toàn đội 10% (3 lượt). | Buff ST, Tăng HP max |
| 2 | **Quan Vũ** | Tấn công | ⭐ | **Thanh Long Yển Nguyệt**: Tấn công đơn 320%, Tăng tỷ lệ chí mạng bản thân 30% và Tăng 30% ST chí mạng bản thân khi thi triển. | Tăng chí mạng, Tăng ST chí mạng |
| 3 | **Trương Phi** | Phòng thủ | ⭐ | **Hổ Khiếu Trường Bản**: Tấn công hàng ngang 220%, Buff sát thương bản thân 20% và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Buff ST, Phản kích diện rộng |
| 4 | **Gia Cát Lượng** | Hỗ trợ | ⭐ | **Bát trận đồ**: Tấn công toàn bộ địch 104%, gây Choáng (tỷ lệ cấp×2%, max 20%) và Buff sát thương toàn đội 10% (3 lượt). | Choáng, Buff ST |
| 5 | **Triệu Vân** | Tấn công | ⭐ | **Thất Tiến Thất Xuất**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng 20%, Giảm sát thương nhận vào 20% (3 lượt) và Hút máu theo cấp (cấp×3%, max 30%). | Tăng chí mạng, Giảm ST nhận, Hút máu |
| 6 | **Mã Siêu** | Tấn công | ⭐ | **Cẩm Mã Siêu**: Tấn công đơn 280%, Hút máu theo cấp (cấp×10%, max 100%) và Tăng máu tối đa 10% bản thân. | Hút máu, Tăng HP max |
| 7 | **Hoàng Trung** | Tấn công | ⭐ | **Lão Đương Ích Tráng**: Tấn công hàng sau 210%, Tăng tỷ lệ chí mạng 35% cho phát bắn này. | Tăng chí mạng |
| 8 | **Ngụy Diên** | Tấn công | ⭐ | **Kỳ phong đột kích**: Tấn công hàng dọc 220%, Buff sát thương bản thân 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Phản kích đơn |
| 9 | **Khương Duy** | Tấn công | ⭐ | **Kế thừa Khổng Minh**: Tấn công đơn 260%, Buff sát thương bản thân 15% và gây Choáng (tỷ lệ cấp×4%, max 40%). | Choáng (Sát thương chính), Buff ST |
| 10 | **Bàng Thống** | Hỗ trợ | ⭐ | **Phượng Sồ liên hoàn**: Tấn công toàn bộ địch 85%, Buff sát thương toàn đội 15% (3 lượt). | Buff ST |
| 11 | **Pháp Chính** | Hỗ trợ | | **Tiên liệu chiến cơ**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15% và Tăng 20% ST chí mạng toàn đội (3 lượt). | Buff ST, Tăng chí mạng, Tăng ST chí mạng |
| 12 | **Từ Thứ** | Hỗ trợ | | **Kiếm hiệp phá trận**: Tấn công hàng ngang 120%, gây Choáng (tỷ lệ cấp×3%, max 30%). | Choáng |
| 13 | **Hoàng Nguyệt Anh** | Hỗ trợ | | **Cơ quan bát quái**: Tấn công toàn bộ địch 75%, Tăng tỷ lệ chí mạng toàn đội 10% (3 lượt). | Tăng chí mạng |
| 14 | **Quan Bình** | Tấn công | | **Thanh Long kế thừa**: Tấn công đơn 260%, Hút máu theo cấp (cấp×2%, max 20%), Buff sát thương bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu, Buff ST, Phản kích đơn |
| 15 | **Quan Hưng** | Tấn công | | **Hưng binh trảm tướng**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng 15% (3 lượt). | Tăng chí mạng |
| 16 | **Mã Đại** | Tấn công | | **Truy kích Tây Lương**: Tấn công hàng sau 200%, Buff sát thương bản thân 15% (3 lượt). | Buff ST |
| 17 | **Vương Bình** | Phòng thủ | | **Kiên thủ Hán Trung**: Giảm sát thương nhận vào 25%, Hồi máu 15% HP tối đa mỗi lượt ra đòn và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Phản kích đơn |
| 18 | **Liêu Hóa** | Phòng thủ | | **Lão tướng tiên phong**: Tấn công đơn 270%, Tăng máu tối đa bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Phản kích đơn |
| 19 | **Giản Ung** | Hỗ trợ | | **Du thuyết**: Buff sát thương toàn đội 10% và Xóa hiệu ứng bất lợi của bản thân/đồng minh (trừ Choáng & Thiêu đốt). | Buff ST, Xóa debuff đồng minh |
| 20 | **Mi Trúc** | Hỗ trợ | | **Hậu cần vững chắc**: Hồi máu cho hàng sau (220% ST cơ bản) và Buff sát thương hàng sau 15% (3 lượt). | Hồi máu, Buff ST |
| 21 | **Quan Ngân Bình** | Tấn công | | **Nữ tướng phá quân**: Tấn công đơn 250%, gây Choáng (tỷ lệ cấp×4%, max 40%). | Choáng (Sát thương chính) |
| 22 | **Mi Trinh** | Hỗ trợ | | **Tương trợ**: Hồi máu toàn đội (100% ST cơ bản) và Tăng máu tối đa toàn đội 10%. | Hồi máu, Tăng HP max |
| 23 | **Gia Cát Quả** | Hỗ trợ | | **Tiên thuật**: Giảm sát thương nhận vào toàn đội 10% (3 lượt) và Giải choáng cho đồng minh bị choáng (tỷ lệ 30%-75%). | Giảm ST nhận, Giải choáng |
| 24 | **Bao Tam Nương** | Tấn công | | **Hoa vũ song đao**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng bản thân 20% và Tăng 20% ST chí mạng (3 lượt). | Tăng chí mạng, Tăng ST chí mạng |
| 25 | **Ngô Ý** | Phòng thủ | | **Trấn thủ Ích Châu**: Giảm sát thương nhận vào 20%, Hồi máu bản thân 15% HP tối đa và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Phản kích đơn |

---

## 4. Phe Ngô (wu) — 25 Tướng

> **Bản sắc**: Tấn công theo hàng, thiêu đốt nhiều lớp, hút máu duy trì, phòng thủ phản đòn và kiểm soát nhịp độ chiến đấu.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Tôn Kiên** | Phòng thủ | ⭐ | **Giang Đông mãnh hổ**: Tấn công hàng ngang 200%, Giảm sát thương địch 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Phản kích đơn |
| 2 | **Tôn Sách** | Phòng thủ | ⭐ | **Tiểu Bá Vương**: Tấn công toàn bộ địch 123.5%, Buff sát thương bản thân 20%, Hút máu theo cấp (cấp×2.5%, max 25%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Hút máu, Phản kích đơn |
| 3 | **Tôn Quyền** | Hỗ trợ | ⭐ | **Đế nghiệp Giang Đông**: Buff sát thương toàn đội 15% và Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Buff ST, Giảm ST nhận |
| 4 | **Chu Du** | Hỗ trợ | ⭐ | **Hỏa thiêu Xích Bích**: Tấn công toàn bộ địch 117%, gây Thiêu đốt toàn bộ địch (duy trì **4 lượt**, cộng dồn max 3 lớp). Riêng đòn Thiêu đốt: tăng thêm **50% tỷ lệ chí mạng và 50% ST chí mạng** của bản thân. | Thiêu đốt (4 lượt, dồn 3), Thiêu đốt +50% chí mạng & ST chí mạng |
| 5 | **Lục Tốn** | Hỗ trợ | ⭐ | **Hỏa kế liên doanh**: Tấn công hàng dọc 180%, gây Thiêu đốt hàng dọc địch (duy trì **4 lượt**, cộng dồn max 3 lớp), Giảm HP tối đa địch 10%. Hút máu theo cấp (cấp×2%, max 20%) áp dụng cho **cả đòn đánh trực tiếp lẫn sát thương Thiêu đốt**. | Thiêu đốt (4 lượt, dồn 3), Giảm HP tối đa, Hút máu (kể cả thiêu đốt) |
| 6 | **Lữ Mông** | Phòng thủ | ⭐ | **Bạch y độ giang**: Tấn công đơn 290% và Tăng 10% HP tối đa cho toàn đội (3 lượt). | Tăng HP max toàn đội |
| 7 | **Hoàng Cái** | Phòng thủ | ⭐ | **Khổ nhục kế**: Tự gây Thiêu đốt bản thân (duy trì **4 lượt**, cộng dồn max 3 lớp) để Buff sát thương bản thân 30%, Hồi máu 20% HP tối đa, Hút máu theo cấp (cấp×2%, max 20%) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Thiêu đốt (4 lượt, dồn 3), Buff ST, Hồi máu, Hút máu, Phản kích diện rộng |
| 8 | **Trình Phổ** | Phòng thủ | | **Lão tướng trấn quân**: Giảm sát thương nhận vào 20%, Hồi máu bản thân 15% HP tối đa và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Phản kích đơn |
| 9 | **Hàn Đương** | Tấn công | | **Cung kỵ hợp kích**: Tấn công hàng sau 200%, Tăng tỷ lệ chí mạng 20% và Tăng 20% ST chí mạng (3 lượt). | Tăng chí mạng, Tăng ST chí mạng |
| 10 | **Thái Sử Từ** | Tấn công | ⭐ | **Thần xạ**: Tấn công đơn hàng sau 300%, Tăng tỷ lệ chí mạng 25% cho phát bắn này. | Tăng chí mạng |
| 11 | **Cam Ninh** | Tấn công | ⭐ | **Cẩm Phàm tập kích**: Tấn công hàng sau 220%, Buff sát thương bản thân 20%, Hút máu theo cấp (cấp×2%, max 20%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Hút máu, Phản kích đơn |
| 12 | **Lăng Thống** | Tấn công | | **Liên kích**: Tấn công hàng ngang 200%, Buff sát thương bản thân 15% (3 lượt). | Buff ST |
| 13 | **Chu Thái** | Phòng thủ | | **Hộ chủ bất khuất**: Tăng máu tối đa 20%, Hồi máu 20% HP tối đa cho bản thân và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Hồi máu, Phản kích đơn |
| 14 | **Từ Thịnh** | Phòng thủ | | **Giang phòng thiết thủ**: Giảm sát thương nhận vào 25% cho bản thân, Hồi máu 10% HP tối đa và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Phản kích đơn |
| 15 | **Đinh Phụng** | Tấn công | | **Tuyết trung đột kích**: Tấn công đơn 270%, gây Choáng mục tiêu (tỷ lệ cấp×4%, max 40%) và gây Thiêu đốt (duy trì 4 lượt). | Choáng (Sát thương chính), Thiêu đốt |
| 16 | **Chu Hoàn** | Phòng thủ | | **Hỏa công phá trận**: Tấn công hàng ngang 180%, gây Thiêu đốt các mục tiêu (4 lượt). | Thiêu đốt (4 lượt) |
| 17 | **Trương Chiêu** | Hỗ trợ | | **Ổn định triều chính**: Giảm sát thương nhận vào cho toàn đội 15% (3 lượt) và Hồi máu toàn đội (80% ST cơ bản). | Giảm ST nhận, Hồi máu |
| 18 | **Trương Hoành** | Hỗ trợ | | **Hoành sách**: Buff sát thương toàn đội 10% và Tăng tỷ lệ chí mạng toàn đội 10% (3 lượt). | Buff ST, Tăng chí mạng |
| 19 | **Lỗ Túc** | Hỗ trợ | ⭐ | **Liên minh Tôn Lưu**: Buff sát thương toàn đội 15% và Tăng máu tối đa toàn đội 10% (3 lượt). | Buff ST, Tăng HP max |
| 20 | **Tôn Thượng Hương** | Tấn công | | **Kiêu cơ cung vũ**: Tấn công hàng sau 200%, Tăng tỷ lệ chí mạng 20% (3 lượt). | Tăng chí mạng |
| 21 | **Đại Kiều** | Hỗ trợ | | **Quốc sắc**: Hồi máu toàn đội (110% ST cơ bản) và Xóa hiệu ứng bất lợi của bản thân/đồng minh (trừ Choáng & Thiêu đốt). | Hồi máu, Xóa debuff đồng minh |
| 22 | **Tiểu Kiều** | Hỗ trợ | | **Thiên hương**: Tăng tỷ lệ chí mạng toàn đội 15% và Buff sát thương toàn đội 10% (3 lượt). | Tăng chí mạng, Buff ST |
| 23 | **Bộ Luyện Sư** | Hỗ trợ | | **Hiền hậu hộ quân**: Hồi máu đồng minh thấp HP nhất (330% ST cơ bản) và Giảm sát thương nhận vào của người đó 20% (3 lượt). | Hồi máu, Giảm ST nhận |
| 24 | **Tôn Lỗ Dục** | Hỗ trợ | | **Hòa giải**: Giải choáng cho toàn bộ đồng minh (tỷ lệ 30%-75%) và Hồi máu nhẹ toàn đội (60% ST cơ bản). | Giải choáng, Hồi máu |
| 25 | **Tôn Lỗ Ban** | Hỗ trợ | | **An định Giang Đông**: Giảm máu tối đa của toàn bộ đối thủ 10% (3 lượt). | Giảm HP max địch |

---

## 5. Phe Quần Hùng (qun) — 25 Tướng

> **Bản sắc**: Hỗ trợ, bảo vệ, tăng trần HP tối đa, phản kích tự vệ, hút máu bạo phát, thanh tẩy hiệu ứng bất lợi và tác chiến linh hoạt.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng |
|---|-------|-----------|-----|---------|------------------|
| 1 | **Đổng Trác** | Phòng thủ | ⭐ | **Bạo chúa**: Giảm máu tối đa của toàn bộ đối thủ 10%, Hồi máu bản thân 20% HP tối đa và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm HP max địch, Hồi máu, Phản kích diện rộng |
| 2 | **Lữ Bố** | Tấn công | ⭐ | **Vô song**: Tấn công toàn bộ địch 127%, Tăng tỷ lệ chí mạng bản thân 20%, Tăng 20% ST chí mạng, Hút máu theo cấp (cấp×3%, max 30%) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Tăng chí mạng, Tăng ST chí mạng, Hút máu, Phản kích diện rộng |
| 3 | **Điêu Thuyền** | Hỗ trợ | ⭐ | **Bế nguyệt**: Tấn công đơn 110%, gây Choáng (tỷ lệ cấp×8%, max 80%) and Giảm sát thương mục tiêu 20%. | Choáng, Giảm ST địch |
| 4 | **Viên Thiệu** | Hỗ trợ | ⭐ | **Thế gia hào tộc**: Tăng máu tối đa toàn đội 15% và Buff sát thương toàn đội 10% (3 lượt). | Tăng HP max, Buff ST |
| 5 | **Viên Thuật** | Hỗ trợ | | **Trọng thị đế nghiệp**: Giảm máu tối đa hàng trước của đối thủ 15% (3 lượt). | Giảm HP max địch |
| 6 | **Công Tôn Toản** | Tấn công | ⭐ | **Bạch mã nghĩa tùng**: Tấn công hàng sau 220%, Tăng tỷ lệ chí mạng 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng chí mạng, Phản kích đơn |
| 7 | **Trương Giác** | Hỗ trợ | ⭐ | **Thái Bình đạo**: Tấn công toàn bộ địch 110.5%, gây Choáng (tỷ lệ cấp×2%, max 20%) và Thiêu đốt nhẹ (4 lượt). | Choáng, Thiêu đốt (4 lượt) |
| 8 | **Trương Bảo** | Hỗ trợ | | **Địa công tướng quân**: Tấn công hàng ngang 130%, Giảm tỷ lệ chí mạng địch 15% và Giảm 20% ST chí mạng địch (3 lượt). | Giảm chí mạng, Giảm ST chí mạng |
| 9 | **Trương Lương** | Hỗ trợ | | **Nhân công tướng quân**: Tấn công hàng dọc 130%, Giảm sát thương địch 15% (3 lượt). | Giảm ST địch |
| 10 | **Hoa Hùng** | Tấn công | ⭐ | **Uy chấn Hổ Lao**: Tấn công đơn 295%, Buff sát thương bản thân 25%, Hút máu theo cấp (cấp×2%, max 20%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Hút máu, Phản kích đơn |
| 11 | **Cao Thuận** | Phòng thủ | | **Hãm Trận Doanh**: Giảm sát thương nhận vào 25%, Tăng máu tối đa 15% cho bản thân và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm ST nhận, Tăng HP max, Phản kích diện rộng |
| 12 | **Trần Cung** | Hỗ trợ | ⭐ | **Mưu định**: Buff sát thương toàn đội 5%, Tăng tỷ lệ chí mạng toàn đội 5% và Giải choáng cho đồng minh bị choáng (tỷ lệ 30%-75%). | Buff ST, Tăng chí mạng, Giải choáng |
| 13 | **Nhan Lương** | Phòng thủ | ⭐ | **Danh tướng Hà Bắc**: Tấn công đơn 305%, Hút máu theo cấp (cấp×2%, max 20%), Tăng tỷ lệ chí mạng 20%, Tăng 25% ST chí mạng cho phát bắn này và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu, Tăng chí mạng, Tăng ST chí mạng, Phản kích đơn |
| 14 | **Văn Sú** | Tấn công | ⭐ | **Mãnh tướng Hà Bắc**: Tấn công hàng ngang 220%, Buff sát thương bản thân 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Phản kích đơn |
| 15 | **Điền Phong** | Hỗ trợ | | **Trực gián**: Tấn công hàng ngang 120%, Xóa hiệu ứng có lợi của đối thủ. | Xóa buff địch |
| 16 | **Mạnh Hoạch** | Hỗ trợ | | **Viễn mưu**: Tấn công toàn bộ địch 104%, Tăng máu tối đa bản thân 20% và Hồi máu 15% HP tối đa. | Tăng HP max, Hồi máu |
| 17 | **Mã Đằng** | Tấn công | | **Tây Lương thiết kỵ**: Tấn công hàng sau 200%, Buff sát thương bản thân 15% (3 lượt). | Buff ST |
| 18 | **Hàn Toại** | Hỗ trợ | | **Liên hoành**: Giảm sát thương nhận vào cho toàn đội 10% và Xóa hiệu ứng bất lợi của bản thân/đồng minh (trừ Choáng & Thiêu đốt). | Giảm ST nhận, Xóa debuff đồng minh |
| 19 | **Đào Khiêm** | Hỗ trợ | | **Nhân nghĩa Từ Châu**: Hồi máu toàn đội (110% ST cơ bản) và Tăng máu tối đa toàn đội 10%. | Hồi máu, Tăng HP max |
| 20 | **Trương Lỗ** | Hỗ trợ | | **Ngũ Đấu Mễ Đạo**: Hồi máu hàng trước (220% ST cơ bản) và Xóa hiệu ứng bất lợi của bản thân/đồng minh (trừ Choáng & Thiêu đốt). | Hồi máu, Xóa debuff đồng minh |
| 21 | **Thái Văn Cơ** | Hỗ trợ | | **Bi ca**: Hồi máu toàn bộ đồng minh (110% ST cơ bản) và Buff sát thương cho toàn đội 10% (3 lượt). | Hồi máu toàn đội, Buff ST |
| 22 | **Trâu Ngọc** | Hỗ trợ | | **Mị ảnh**: Tấn công đơn 120%, gây Choáng mục tiêu (tỷ lệ cấp×10%, max 100%). | Choáng (Khống chế Hỗ trợ) |
| 23 | **Chúc Dung** | Tấn công | | **Phi đao Nam Man**: Tấn công hàng ngang 180%, gây Thiêu đốt hàng ngang địch (4 lượt). | Thiêu đốt (4 lượt) |
| 24 | **Đổng Bạch** | Tấn công | | **Quý tộc tàn bạo**: Tấn công đơn 280%, Giảm máu tối đa mục tiêu 15% (3 lượt). | Giảm HP max địch |
| 25 | **Trương Xuân Hoa** | Hỗ trợ | | **Lãnh tâm**: Tấn công đơn 140%, Giảm sát thương mục tiêu 20% và Xóa hiệu ứng có lợi của đối thủ. | Giảm ST địch, Xóa buff địch |