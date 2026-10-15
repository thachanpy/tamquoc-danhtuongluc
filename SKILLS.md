# Kỹ năng & phong cách tướng (SKILLS.md)

Nguồn dữ liệu cân bằng cho chiến đấu PvP. Mã hoá tường minh trong `packages/game-config/src/pvp.ts`
(bảng `PVP_ROSTER_ROWS` + `PVP_SKILL_DEF`); engine (`apps/api/src/managers/pvp.engine.ts`) chỉ đọc dữ liệu này.

## Quy ước

- **Phong cách** chỉ còn quyết định **lực chiến (LC)** và nhãn hiển thị:
  `Tấn công` (LC cao nhất) → `Hỗ trợ` → `Phòng thủ` (LC thấp nhất). Phong cách **không** cộng chỉ số.
- **Thứ tự hành động**: hai đội **luân phiên nhau theo vị trí**. Vào trận, bên có **tổng LC cả đội cao hơn**
  ra đòn trước ở **vị trí 1**, rồi tới **vị trí 1 của bên kia**, rồi **vị trí 2 của bên đi trước**, **vị trí 2
  của bên kia**… cứ thế tới vị trí 6 (bằng tổng LC thì bên khiêu chiến A đi trước). Không xếp theo LC từng tướng.
- **Hiệu ứng nền (aura) theo kỹ năng**: áp trước trận, gồm tự buff bản thân và buff **toàn đội (kể cả tướng sở hữu)**.
  Aura toàn đội không cộng dồn lặp lại (lấy giá trị lớn nhất giữa các đồng minh).
- **Đòn đánh thường**: kỹ năng chỉ có hiệu ứng nền (không có chiêu chủ động) sẽ đánh thường
  đơn mục tiêu (100%, tướng hot 110%) khi tới lượt.
- **Hồi máu chủ động**: tuỳ tướng, mục tiêu hồi có thể là **toàn đội**, **một đồng minh thấp máu nhất**,
  **hàng trước** hoặc **hàng sau**. Lượng hồi tính theo sát thương cơ bản của người thi triển, không vượt
  HP tối đa và cũng có thể **chí mạng (×1,5)**. Hệ số cân bằng theo số mục tiêu: toàn đội 110%, hàng 220%,
  một người thấp máu nhất 330% (mỗi lần hồi).
- **Sát thương theo số mục tiêu**: đánh **đơn** 250% (dứt điểm nhanh 1 mục tiêu), **hàng ngang/dọc/hàng sau**
  180% mỗi mục tiêu, **toàn bộ địch** 100% mỗi mục tiêu.
- **Tự hồi máu (SELF_HP)**: kỹ năng "hồi 25% HP tối đa" nghĩa là **hồi 25% HP tối đa mỗi lượt ra đòn**
  (không cộng trần HP); đòn đánh thường đi kèm vẫn 100% (tướng hot 110%).
- **Hút máu (lifesteal)**: một số tướng được chỉ định **hồi bản thân cấp × 2% sát thương gây ra** mỗi lượt
  (cấp 1 = 2% … cấp 10 = 20%). Đổi lại, hệ số sát thương kỹ năng của các tướng này **giảm 10%** (áp trước khi nhân hot).
- **Hàng trước +10% HP tối đa, hàng sau +10% sát thương** (áp khi vào trận).
- **Tướng hot** (⭐, 10 tướng mỗi phe theo độ nổi tiếng): **+10% hệ số sát thương/hồi máu của kỹ năng**
  (kể cả đòn đánh thường). Hiệu ứng nền toàn đội giữ nguyên.
- **Buff chỉ số chủ động** (kỹ năng buff đồng minh): +10% sát thương cơ bản của chính đồng minh và
  +5 điểm chí mạng mỗi lớp; các lớp **cộng dồn**, mỗi lớp có hiệu lực **tối đa 3 lượt**.
- Chỉ số nền theo cấp: HP `1000 + 250×(cấp−1)`; sát thương `200 + 50×(cấp−1)`; chí mạng `cấp × 3%`.
- Tỉ lệ choáng: đơn mục tiêu `cấp × 7%` (tối đa 70%); hàng/diện rộng `cấp × 3%` (trừ khi ghi đè).
  Choáng **chỉ kéo dài 2 lượt**: gây choáng ở lượt nào thì mục tiêu bỏ lượt ở lượt đó (nếu chưa ra đòn)
  và lượt kế tiếp, **đầu lượt thứ ba là hết** (ví dụ: choáng ở hiệp 2 → đầu hiệp 4 đã hết). Mục tiêu đang
  choáng thì không bị choáng chồng, nên không bao giờ bị choáng quá 2 lượt liên tiếp.
- Tỉ lệ giải choáng (kỹ năng giải choáng): `30% + 5%×(cấp−1)` — cấp 1 = 30% … cấp 10 = 75%.

---

# 1. Phe Ngụy — wei

Định hướng: đội hình cân bằng, có tướng gây sát thương chủ lực, tướng chống chịu và mưu sĩ khống chế.

| # | Tướng | Phong cách | Hot | Kỹ năng |
|---|-------|-----------|-----|---------|
| 1 | Tào Tháo | Hỗ trợ | ⭐ | Hiệu lệnh thiên hạ: Toàn đội +10% sát thương & +10% HP tối đa (kể cả bản thân); đánh thường 110%. |
| 2 | Tào Phi | Tấn công | ⭐ | Đế vương trảm: Đánh đơn mục tiêu, sát thương **275%**. |
| 3 | Tào Nhân | Phòng thủ | | Thiết bích: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 100%. |
| 4 | Tào Hồng | Phòng thủ | | Hộ chủ: Đánh đơn mục tiêu 210%; bản thân hồi máu 10% HP tối đa. |
| 5 | Tào Chân | Tấn công | | Phá trận: Đánh hàng ngang 180% mỗi mục tiêu. |
| 6 | Hạ Hầu Đôn | Tấn công | ⭐ | Độc nhãn cuồng đao: Đánh đơn mục tiêu **231%**; tỉ lệ choáng theo cấp (tối đa 70%). |
| 7 | Hạ Hầu Uyên | Tấn công | ⭐ | Thần tốc tập kích: Đánh hàng sau **198%** mỗi mục tiêu. |
| 8 | Trương Liêu | Tấn công | ⭐ | Uy chấn Tiêu Dao: Đánh hàng ngang **158.4%** mỗi mục tiêu; hút máu cấp×2% sát thương gây ra. |
| 9 | Nhạc Tiến | Tấn công | | Tiên phong phá địch: Đánh đơn mục tiêu 225%; hút máu cấp×2% sát thương gây ra. |
| 10 | Vu Cấm | Phòng thủ | | Nghiêm trận: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh đơn mục tiêu 200%. |
| 11 | Trương Cáp | Tấn công | | Kỳ binh đột kích: Đánh hàng sau 180% mỗi mục tiêu. |
| 12 | Từ Hoảng | Tấn công | ⭐ | Khai sơn phủ: Đánh đơn mục tiêu **275%**. |
| 13 | Điển Vi | Phòng thủ | ⭐ | Ác Lai hộ vệ: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 110%. |
| 14 | Hứa Chử | Phòng thủ | ⭐ | Hổ si cuồng kích: Đánh đơn mục tiêu **247.5%**; hút máu cấp×2% sát thương gây ra. |
| 15 | Quách Gia | Hỗ trợ | ⭐ | Diệu kế thiên cơ: Đồng minh còn sống +10% sát thương cơ bản của chính mình và +5 điểm chí mạng; cộng dồn tối đa 3 lượt. |
| 16 | Tuân Úc | Hỗ trợ | | Vương tá chi sách: Toàn đội +10% sát thương; đánh thường 100%. |
| 17 | Tuân Du | Hỗ trợ | | Liên hoàn kế: Đánh hàng dọc 180%; tỉ lệ choáng 3%–30%. |
| 18 | Giả Hủ | Hỗ trợ | | Độc kế: Đánh đơn mục tiêu 210%; tỉ lệ choáng 7%–70%. |
| 19 | Tư Mã Ý | Hỗ trợ | ⭐ | Ẩn nhẫn phản kích: Đánh toàn bộ địch **110%** mỗi mục tiêu. |
| 20 | Bàng Đức | Tấn công | | Quan tài quyết chiến: Đánh đơn mục tiêu 250%. |
| 21 | Chân Cơ | Hỗ trợ | | Lạc Thần: Hồi máu toàn đội **110%** sát thương cơ bản của bản thân. |
| 22 | Biện Ngọc Nhi | Hỗ trợ | | Hậu cung an định: Toàn đội +10% HP tối đa; đánh thường 100%. |
| 23 | Tào Hoa | Hỗ trợ | | Nhu tình hộ mệnh: Hồi máu cho đồng minh thấp máu nhất **330%** sát thương cơ bản của bản thân. |
| 24 | Tào Tiết | Hỗ trợ | | Trung trinh: Toàn đội +5 điểm chí mạng; đánh thường 100%. |
| 25 | Tân Hiến Anh | Hỗ trợ | | Tuệ nhãn phá cục: Đánh toàn bộ địch 100%; có 30%–75% cơ hội giải choáng cho đồng minh. |

---

# 2. Phe Thục — shu

Định hướng: sức tấn công mạnh, nhiều kỹ năng đánh diện rộng và khả năng hỗ trợ đồng đội.

| # | Tướng | Phong cách | Hot | Kỹ năng |
|---|-------|-----------|-----|---------|
| 1 | Lưu Bị | Hỗ trợ | ⭐ | Nhân đức: Toàn đội +10% sát thương & +10% HP tối đa (kể cả bản thân); đánh thường 110%. |
| 2 | Quan Vũ | Tấn công | ⭐ | Thanh Long Yển Nguyệt: Đánh đơn mục tiêu **275%**. |
| 3 | Trương Phi | Tấn công | ⭐ | Hổ Khiếu Trường Bản: Đánh hàng ngang **198%** mỗi mục tiêu. |
| 4 | Gia Cát Lượng | Hỗ trợ | ⭐ | Bát trận đồ: Đánh toàn bộ địch **110%**; tỉ lệ choáng theo cấp (tối đa 30%). |
| 5 | Triệu Vân | Tấn công | ⭐ | Thất Tiến Thất Xuất: Đánh đơn mục tiêu **247.5%**; hút máu cấp×2% sát thương gây ra. |
| 6 | Mã Siêu | Tấn công | ⭐ | Cẩm Mã Siêu: Đánh hàng sau **178.2%** mỗi mục tiêu; hút máu cấp×2% sát thương gây ra. |
| 7 | Hoàng Trung | Tấn công | ⭐ | Lão Đương Ích Tráng: Đánh đơn mục tiêu **198%** mỗi mục tiêu. |
| 8 | Ngụy Diên | Tấn công | ⭐ | Kỳ phong đột kích: Đánh hàng dọc **198%** mỗi mục tiêu. |
| 9 | Khương Duy | Tấn công | ⭐ | Kế thừa Khổng Minh: Đánh đơn mục tiêu **231%**; tỉ lệ choáng 7%–70%. |
| 10 | Bàng Thống | Hỗ trợ | ⭐ | Phượng Sồ liên hoàn: Đánh toàn bộ địch **110%** mỗi mục tiêu. |
| 11 | Pháp Chính | Hỗ trợ | | Tiên liệu chiến cơ: Đồng minh còn sống +10% sát thương cơ bản của chính mình và +5 điểm chí mạng; cộng dồn tối đa 3 lượt. |
| 12 | Từ Thứ | Hỗ trợ | | Kiếm hiệp phá trận: Đánh hàng ngang 180%; tỉ lệ choáng 3%–30%. |
| 13 | Hoàng Nguyệt Anh | Hỗ trợ | | Cơ quan bát quái: Đánh toàn bộ địch 100% mỗi mục tiêu. |
| 14 | Quan Bình | Tấn công | | Thanh Long kế thừa: Đánh đơn mục tiêu 225%; hút máu cấp×2% sát thương gây ra. |
| 15 | Quan Hưng | Tấn công | | Hưng binh trảm tướng: Đánh hàng ngang 180% mỗi mục tiêu. |
| 16 | Mã Đại | Tấn công | | Truy kích Tây Lương: Đánh hàng sau 180% mỗi mục tiêu. |
| 17 | Vương Bình | Phòng thủ | | Kiên thủ Hán Trung: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 100%. |
| 18 | Liêu Hóa | Phòng thủ | | Lão tướng tiên phong: Đánh đơn mục tiêu 250%. |
| 19 | Giản Ung | Hỗ trợ | | Du thuyết: Toàn đội +10% HP tối đa; đánh thường 100%. |
| 20 | Mi Trúc | Hỗ trợ | | Hậu cần vững chắc: Hồi máu cho hàng sau **220%** sát thương cơ bản của bản thân. |
| 21 | Quan Ngân Bình | Tấn công | | Nữ tướng phá quân: Đánh đơn mục tiêu 210%; tỉ lệ choáng 7%–70%. |
| 22 | Mi Trinh | Hỗ trợ | | Tương trợ: Toàn đội +10% HP tối đa; đánh thường 100%. |
| 23 | Gia Cát Quả | Hỗ trợ | | Tiên thuật: Hồi máu cho hàng trước **220%** sát thương cơ bản của bản thân. |
| 24 | Bao Tam Nương | Tấn công | | Hoa vũ song đao: Đánh hàng ngang 180% mỗi mục tiêu. |
| 25 | Ngô Ý | Phòng thủ | | Trấn thủ Ích Châu: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 100%. |

---

# 3. Phe Ngô — wu

Định hướng: cơ động, tấn công theo hàng, phối hợp đội hình và kiểm soát nhịp chiến đấu.

| # | Tướng | Phong cách | Hot | Kỹ năng |
|---|-------|-----------|-----|---------|
| 1 | Tôn Kiên | Tấn công | ⭐ | Giang Đông mãnh hổ: Đánh hàng ngang **170.5%** mỗi mục tiêu. |
| 2 | Tôn Sách | Tấn công | ⭐ | Tiểu Bá Vương: Đánh đơn mục tiêu **217.8%**; hút máu cấp×2% sát thương gây ra. |
| 3 | Tôn Quyền | Hỗ trợ | ⭐ | Đế nghiệp Giang Đông: Toàn đội +10% sát thương & +10% HP tối đa (kể cả bản thân); đánh thường 110%. |
| 4 | Chu Du | Hỗ trợ | ⭐ | Hỏa thiêu Xích Bích: Đánh toàn bộ địch **118.8%** mỗi mục tiêu; hút máu cấp×2% sát thương gây ra. |
| 5 | Lục Tốn | Hỗ trợ | ⭐ | Hỏa kế liên doanh: Đánh hàng ngang **198%** mỗi mục tiêu. |
| 6 | Lữ Mông | Tấn công | ⭐ | Bạch y độ giang: Đánh đơn mục tiêu **270%**. |
| 7 | Hoàng Cái | Phòng thủ | ⭐ | Khổ nhục kế: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 110%; hút máu cấp×2% sát thương gây ra. |
| 8 | Trình Phổ | Phòng thủ | | Lão tướng trấn quân: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 100%. |
| 9 | Hàn Đương | Tấn công | | Cung kỵ hợp kích: Đánh hàng sau 180% mỗi mục tiêu. |
| 10 | Thái Sử Từ | Tấn công | ⭐ | Thần xạ: Đánh dơn hàng sau **275%**. |
| 11 | Cam Ninh | Tấn công | ⭐ | Cẩm Phàm tập kích: Đánh hàng sau **198%** mỗi mục tiêu. |
| 12 | Lăng Thống | Tấn công | | Liên kích: Đánh hàng ngang 180% mỗi mục tiêu. |
| 13 | Chu Thái | Phòng thủ | | Hộ chủ bất khuất: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 100%. |
| 14 | Từ Thịnh | Phòng thủ | | Giang phòng thiết thủ: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 100%. |
| 15 | Đinh Phụng | Tấn công | | Tuyết trung đột kích: Đánh đơn mục tiêu 250%. |
| 16 | Chu Hoàn | Tấn công | | Hỏa công phá trận: Đánh hàng ngang 180% mỗi mục tiêu. |
| 17 | Trương Chiêu | Hỗ trợ | | Ổn định triều chính: Toàn đội +10% sát thương; đánh thường 100%. |
| 18 | Trương Hoành | Hỗ trợ | | Hoành sách: Đồng minh còn sống +10% sát thương cơ bản của chính mình và +5 điểm chí mạng; cộng dồn tối đa 3 lượt. |
| 19 | Lỗ Túc | Hỗ trợ | ⭐ | Liên minh Tôn Lưu: Toàn đội +10% sát thương & +10% HP tối đa (kể cả bản thân); đánh thường 110%. |
| 20 | Tôn Thượng Hương | Tấn công | | Kiêu cơ cung vũ: Đánh hàng sau 180% mỗi mục tiêu. |
| 21 | Đại Kiều | Hỗ trợ | | Quốc sắc: Hồi máu toàn đội **110%** sát thương cơ bản của bản thân. |
| 22 | Tiểu Kiều | Hỗ trợ | | Thiên hương: Toàn đội +5 điểm chí mạng; đánh thường 100%. |
| 23 | Bộ Luyện Sư | Hỗ trợ | | Hiền hậu hộ quân: Hồi máu cho đồng minh thấp máu nhất **330%** sát thương cơ bản của bản thân. |
| 24 | Tôn Lỗ Dục | Hỗ trợ | | Hòa giải: Có 30%–75% cơ hội giải choáng cho toàn bộ đồng minh; không gây sát thương. |
| 25 | Tôn Lỗ Ban | Hỗ trợ | | An định Giang Đông: Toàn đội +10% HP tối đa; đánh thường 100%. |

---

# 4. Phe Quần Hùng — qun

Định hướng: lối chơi khó đoán, có tướng sát thương cao, khống chế và kỹ năng hỗ trợ đặc biệt.

| # | Tướng | Phong cách | Hot | Kỹ năng |
|---|-------|-----------|-----|---------|
| 1 | Đổng Trác | Phòng thủ | ⭐ | Bạo chúa: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 110%. |
| 2 | Lữ Bố | Tấn công | ⭐ | Vô song: Đánh toàn bộ địch **113.85%** mỗi mục tiêu; tỉ lệ choáng 2%–20%; hút máu cấp×2% sát thương gây ra. |
| 3 | Điêu Thuyền | Hỗ trợ | ⭐ | Bế nguyệt: Đánh đơn mục tiêu **231%**; tỉ lệ choáng 7%–70%. |
| 4 | Viên Thiệu | Hỗ trợ | ⭐ | Thế gia hào tộc: Toàn đội +10% sát thương & +10% HP tối đa (kể cả bản thân); đánh thường 110%. |
| 5 | Viên Thuật | Hỗ trợ | | Trọng thị đế nghiệp: Toàn đội +10% sát thương; đánh thường 100%. |
| 6 | Công Tôn Toản | Tấn công | ⭐ | Bạch mã nghĩa tùng: Đánh hàng sau **198%** mỗi mục tiêu. |
| 7 | Trương Giác | Hỗ trợ | ⭐ | Thái Bình đạo: Đánh toàn bộ địch **110%**; tỉ lệ choáng 3%–30%. |
| 8 | Trương Bảo | Hỗ trợ | | Địa công tướng quân: Đánh hàng ngang 180% mỗi mục tiêu. |
| 9 | Trương Lương | Hỗ trợ | | Nhân công tướng quân: Đánh hàng dọc 180% mỗi mục tiêu. |
| 10 | Hoa Hùng | Tấn công | ⭐ | Uy chấn Hổ Lao: Đánh đơn mục tiêu **247.5%**; hút máu cấp×2% sát thương gây ra. |
| 11 | Cao Thuận | Phòng thủ | | Hãm Trận Doanh: Hồi 25% HP tối đa mỗi lượt ra đòn; đánh thường 100%. |
| 12 | Trần Cung | Hỗ trợ | ⭐ | Mưu định: Đồng minh còn sống +10% sát thương cơ bản của chính mình và +5 điểm chí mạng; cộng dồn tối đa 3 lượt. |
| 13 | Nhan Lương | Tấn công | ⭐ | Danh tướng Hà Bắc: Đánh đơn mục tiêu **275%**. |
| 14 | Văn Sú | Tấn công | ⭐ | Mãnh tướng Hà Bắc: Đánh hàng ngang **198%** mỗi mục tiêu. |
| 15 | Điền Phong | Hỗ trợ | | Trực gián: Đánh hàng ngang 180%; tỉ lệ choáng 3%–30%. |
| 16 | Mạnh Hoạch | Hỗ trợ | | Viễn mưu: Đánh toàn bộ địch 100% mỗi mục tiêu. |
| 17 | Mã Đằng | Tấn công | | Tây Lương thiết kỵ: Đánh hàng sau 180% mỗi mục tiêu. |
| 18 | Hàn Toại | Hỗ trợ | | Liên hoành: Toàn đội +10% sát thương; đánh thường 100%. |
| 19 | Đào Khiêm | Hỗ trợ | | Nhân nghĩa Từ Châu: Hồi máu toàn đội **110%** sát thương cơ bản của bản thân. |
| 20 | Trương Lỗ | Hỗ trợ | | Ngũ Đấu Mễ Đạo: Hồi máu cho hàng trước **220%** sát thương cơ bản của bản thân. |
| 21 | Thái Văn Cơ | Hỗ trợ | | Bi ca: Hồi máu cho hàng sau **220%** sát thương cơ bản của bản thân. |
| 22 | Trâu Ngọc | Hỗ trợ | | Mị ảnh: Đánh đơn mục tiêu 210%; tỉ lệ choáng 7%–70%. |
| 23 | Chúc Dung | Tấn công | | Phi đao Nam Man: Đánh hàng ngang 180% mỗi mục tiêu. |
| 24 | Đổng Bạch | Tấn công | | Quý tộc tàn bạo: Đánh đơn mục tiêu 250%. |
| 25 | Trương Xuân Hoa | Hỗ trợ | | Lãnh tâm: Đánh đơn mục tiêu 210%; tỉ lệ choáng 7%–70%. |
