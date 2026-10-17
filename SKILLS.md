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
- **Tỉ lệ khai báo dạng "mỗi cấp"** (Choáng `cấp×X%`, Hút máu `cấp×X%`, Phản kích `cấp×5%` trần 50%, Chí mạng `cấp×3%`) tính **TUYẾN TÍNH theo cấp** — KHÁC công thức "chốt − 10 điểm %" ở trên: giá trị tại cấp N = `X × N` (`pvpPerLevelEffectBps`), cấp 1 = `X`, cấp 10 = `X × 10` (giá trị chốt). Ví dụ Choáng `cấp×10%` → cấp 1 = 10%, cấp 8 = **80%**, cấp 10 = 100%.
- **Ngoại lệ — Xóa Khiên**: dùng **nội suy `pvpLevelSpanBps(20%, 80%, cấp)`** (cấp 1 = 20%, cấp 10 = 80%), không theo công thức "chốt − 10 điểm %".
- **Ngoại lệ — Giáp** (`defArmor` buff tăng Giáp & `defArmorDown` debuff giảm Giáp — đơn vị là **điểm Giáp nguyên**, KHÔNG phải %): dùng **thang DỐC `pvpDefArmorAtLevel`** — cấp 1 = **10%** giá trị chốt, cấp N = `round(chốt × N / 10)`, cấp 10 = 100% giá trị chốt. Ví dụ "tăng 39 Giáp" → cấp 1 = **+4**, cấp 5 = +20, cấp 10 = **+39**. Nâng cấp tướng nhân gấp 10 lần hiệu lực Giáp nên tướng đỡ đòn (Vu Cấm, Điển Vi, Mãn Sủng…) leo cấp rất đáng kể.
- **KHÔNG quy theo cấp**: hệ số SÁT THƯƠNG kỹ năng (`250%–320%`…) vì đã tự lớn theo cấp qua chỉ số nền (Damage/HP nền tăng 25%/cấp); số lượt hiệu lực (`rounds`) và trần cộng dồn (`maxLayers`); Aura/Chỉ số nội tại theo Phong cách.
- **Chỉ số NỀN scale theo cấp** (KHÁC công thức "chốt − 10 điểm %" ở trên — dùng nội suy `pvpLevelSpanBps(min, max, level)`): **Chính xác** 80% (cấp 1) → 100% (cấp 10), **Né tránh** 2% → 20%, **Giáp** 14 → 43 điểm (`PVP_ARMOR_BY_LEVEL`, tương đương giảm sát thương 12% → 30%), **ST chí mạng nền** +30% (hệ số ×1,30) → +60% (hệ số ×1,60). Buff/debuff kỹ năng vẫn cộng/trừ quanh mốc theo cấp này.

### Phong cách & Thứ tự hành động

- **Phong cách**: Quyết định **hệ số nhân Lực chiến (LC)**, nhãn hiển thị và **Chỉ số Nền Ra Trận cộng thêm** (xem mục **Chỉ số Nền Ra Trận** bên dưới):
  - **Tấn công** (LC cao nhất — hệ số ×1,00): Tăng **8% sát thương cơ bản** cho bản thân.
  - **Phòng thủ** (LC thấp nhất — hệ số ×0,85): Tăng **8% máu cơ bản** cho bản thân.
  - **Hỗ trợ** (hệ số ×0,92): Tăng **2% máu cơ bản** và **2% sát thương cơ bản** cho **toàn đội** (Aura toàn đội, **cộng dồn tối đa 6 lớp = +12% Máu & +12% ST** nếu sử dụng nhiều tướng Hỗ trợ). Aura áp ngay khi vào trận và **máu vẫn đầy 100%** theo trần mới (không bị tính là hồi máu).

### Lực chiến (LC)

- **LC của một tướng** = điểm sức mạnh tổng hợp từ **chỉ số chiến đấu ở cấp đang xét** (đã gồm nội tại của tướng), quy mọi chỉ số về cùng thang "sát thương" rồi nhân **hệ số phong cách**:
  - **Sinh tồn** = `HP / 10` (HP nền luôn gấp 10 lần ST nền nên hai cọc cùng thang).
  - **Sát thương** = `ST × (1 + Tỉ lệ chí mạng × ST chí mạng)` — sát thương kỳ vọng.
  - **Phòng thủ** = `ST × DR(Giáp)` với `DR = Giáp / (Giáp + 100)` (trần 75%).
  - `LC = round((Sinh tồn + Sát thương + Phòng thủ) × hệ số phong cách)`.
- **KHÔNG tính Chỉ số Nền Ra Trận** (vị trí · cổng đồng phe · aura Hỗ trợ): LC của tướng **không đổi** dù xếp ở ô nào, nên con số hiện ở **bảng chọn tướng / ô đội hình / bảng Tổng kết / sân đấu** luôn khớp nhau và khớp với con số dùng trong trận.
- **CÓ tính Ngọc Ngũ Hành** đã gắn cho đội (aura toàn đội, xem mục *Ngọc Ngũ Hành*): LC đội đã lưu / đội tự động / bảng xếp hạng đều cộng chỉ số Ngọc, nên gắn Ngọc làm LC tăng.
- **LC tăng mạnh theo cấp** (cấp 10 ≈ 8,7 lần cấp 1): tướng cấp cao thường đi trước; cùng cấp thì thứ tự LC là **Tấn công > Hỗ trợ > Phòng thủ**, và khác nhau theo nội tại (`+10% ST` > `+10% HP` ≈ `+20 Giáp` > `+5% Chí mạng`, tính trong vùng cấp chơi thật 6–9; ở cấp 1–2 `DEF_5` nhích hơn `+10% HP`).
- **Tổng LC của đội** = tổng LC 6 tướng. **Hiển thị**: chip `LC` nằm chung hàng chip định danh **cấp độ → phe → phong cách → LC** ở ô đội hình, dòng chọn tướng và bảng Tổng kết; trên sân đấu là chip thứ 4 trong cột chip góc trên-trái; trong **modal chi tiết tướng**, LC nằm **cùng hàng với cấp độ** (`Phe · Lv.n · LC`).

### Chỉ số Nền Ra Trận (Pre-Battle Base Stats)

> Chỉ số cộng từ **Vị trí đội hình**, **Phong cách** và **Cổng Đồng Phe** là **chỉ số bổ trợ mặc định lúc ra trận**, cộng **TRỰC TIẾP** vào cọc Máu/Sát thương gốc của tướng. Đây **KHÔNG PHẢI buff trong trận**: **không chiếm trần cộng dồn `maxLayers`** và **không thể bị Xóa Buff**. Chỉ số gốc trong **Bộ Sưu Tập/Lobby** vẫn giữ nguyên; chỉ khi xếp vào **Màn hình Chuẩn bị Chiến đấu** mới nhảy lên cọc mới (VD: HP 1.000 → 1.080).

- **Theo Vị trí đội hình (Formation Row)**: **Hàng trước** (vị trí 1-2-3) `+5% Máu cơ bản`; **Hàng sau** (vị trí 4-5-6) `+5% Sát thương cơ bản`.
- **Theo Phong cách (bản thân)**: Tấn công `+8% ST cơ bản`; Phòng thủ `+8% Máu cơ bản` (xem bảng Phong cách ở trên).
- **Aura Hỗ trợ (toàn đội)**: `+2% Máu & +2% ST cơ bản` cho toàn đội, **cộng dồn tối đa 6 lớp** (số lớp = số tướng Hỗ trợ trong đội) — trần `+12% Máu & +12% ST`.
- **Cổng Đồng Phe (Faction Synergy)**: đếm số tướng **CÙNG PHE** trong đội; **mỗi tướng nhận mốc theo đúng số tướng cùng phe của chính nó** (tướng phe khác có mốc riêng, KHÔNG dùng mốc phe đông nhất):

| Số tướng cùng phe | % Máu | % Sát thương |
| :---: | :---: | :---: |
| 1 (không đủ mốc) | +0% | +0% |
| 2 | +2% | +2% |
| 3 | +4% | +4% |
| 4 trở lên | +6% | +6% |

> Cổng Đồng Phe chỉ có **3 mốc** (2 → 3 → 4 tướng); **mốc 4 tướng là mốc cao nhất**, từ **4 tướng trở lên kẹp ở mốc cao nhất** (+6% Máu, +6% Sát thương), không có mốc riêng cho 5–6 tướng.

- **Thứ tự hành động**: Hai đội **luân phiên nhau theo vị trí**. Vào trận, bên có **tổng LC cả đội cao hơn** ra đòn trước ở **vị trí 1**, rồi tới **vị trí 1 của bên kia**, **vị trí 2 của bên đi trước**, **vị trí 2 của bên kia**… cứ thế tới vị trí 6 (bằng tổng LC thì bên khiêu chiến A đi trước).
- **Phạm vi nhắm mục tiêu (Targeting)**: 6 ô gồm **Hàng Trước** `1-2-3` và **Hàng Sau** `4-5-6`; cặp ô **Hàng Ngang** là `1-4`, `2-5`, `3-6` (tức `X` và `X+3`).
  - **Nguyên tắc chung**: mọi đòn đánh địch **luôn ưu tiên tuyệt đối Hàng Trước** `1-2-3` trước Hàng Sau `4-5-6` (trừ kỹ năng ghi rõ đánh Hàng Sau); và **luôn trả về ít nhất 1 mục tiêu còn sống** chừng nào địch còn tướng.
  - `single` (**Đơn mục tiêu Hàng Trước**): lấy tướng còn sống **đầu tiên** trong danh sách ưu tiên theo ô của người đánh — ô `1`/`4` → `1 2 3 4 5 6`; ô `2`/`5` → `2 1 3 5 4 6`; ô `3`/`6` → `3 2 1 6 5 4` (cột của mình trước, rồi loang dần ra hai bên; cùng khoảng cách thì chọn cột nhỏ hơn).
  - `back_single` (**Đơn mục tiêu Hàng Sau**): như trên nhưng Hàng Sau xét trước — ô `1`/`4` → `4 5 6 1 2 3`; ô `2`/`5` → `5 4 6 2 1 3`; ô `3`/`6` → `6 5 4 3 2 1`.
  - `lane` (**Hàng Ngang** — cặp 2 tướng theo đường ngang): tìm tướng **Hàng Trước đầu tiên còn sống** `X` theo ưu tiên ô `1`/`4` → `1 2 3`, ô `2`/`5` → `2 1 3`, ô `3`/`6` → `3 2 1`; trả về **cặp `[X, X+3]`** (chỉ các ô còn sống). Nếu cả `1-2-3` đã gục thì đánh **tướng Hàng Sau đầu tiên còn sống** theo ưu tiên `4 5 6` (ô `1`/`4`), `5 4 6` (ô `2`/`5`), `6 5 4` (ô `3`/`6`).
  - `front_enemies` (**Hàng Dọc Trước**): lấy cả `1-2-3`; nếu `1-2-3` đã sạch thì lấy cả `4-5-6`.
  - `back_row` (**Hàng Dọc Sau**): lấy cả `4-5-6`; nếu `4-5-6` đã sạch thì lấy cả `1-2-3`.
  - `all_enemies` (**Đánh tất cả**): lấy toàn bộ tướng còn sống `1-6`.
  - Riêng `highest_damage_enemy`: nhắm tướng địch có **Sát thương hiệu dụng cao nhất** (không theo thứ tự hàng); bằng nhau thì chọn ô nhỏ hơn cho tất định.

### Nội tại tướng

> Mỗi tướng có **đúng 1 nội tại**, cộng trực tiếp khi vào trận (giống Chỉ số Nền Ra Trận: **không thể bị Xóa Buff**, không chiếm trần `maxLayers`). Roster được **RẢI ĐỀU**: mỗi nội tại chiếm ~1/4 số tướng (số tướng mỗi nội tại lệch nhau tối đa 1).

| Nội tại | Hiệu ứng |
| :--- | :--- |
| **+5% tỷ lệ chí mạng** (`CRIT_5`) | +5 điểm % Chí mạng |
| **+10% sát thương** (`DAMAGE_10`) | +10% Sát thương cơ bản |
| **+10% HP tối đa** (`HP_10`) | +10% Máu cơ bản |
| **+20 Giáp** (`DEF_5`) | +20 điểm Giáp (ngang `+10% HP` trong vùng cấp chơi thật 6–9) |

Tướng được gán theo **hướng kỹ năng** (thiên phòng thủ/hồi sinh → `DEF_5`; thiên hồi máu & giải khống → `HP_10`; thiên công — Choáng, Đao phủ, buff đồng minh → `DAMAGE_10`; còn lại `CRIT_5`) nhưng **luôn giữ số lượng cân bằng** giữa 4 nội tại. Danh sách cụ thể **35 tướng / nội tại**:

- **+5% tỷ lệ chí mạng (`CRIT_5`)** — *Ngụy*: Hạ Hầu Uyên, Trương Liêu, Nhạc Tiến, Tư Mã Ý, Lưu Diệp, Vương Dị, Chung Hội · *Thục*: Quan Vũ, Mã Siêu, Hoàng Trung, Ngụy Diên, Khương Duy, Quan Bình, Quan Hưng, Bao Tam Nương, Mã Trung, Lưu Phong · *Ngô*: Chu Du, Lục Tốn, Hàn Đương, Thái Sử Từ, Cam Ninh, Lăng Thống, Tôn Thượng Hương, Tôn Lỗ Ban, Chu Phường, Tôn Hoàn, Chu Cứ · *Quần hùng*: Lữ Bố, Viên Thuật, Công Tôn Toản, Trương Lương, Hoa Hùng, Văn Sú, Điền Phong.
- **+10% sát thương (`DAMAGE_10`)** — *Ngụy*: Tào Tháo, Tào Phi, Trương Cáp, Từ Hoảng, Quách Gia, Tuân Úc, Tuân Du, Giả Hủ, Tào Hoa, Tào Tiết, Tào Thực, Đặng Ngãi, Trần Quần · *Thục*: Lưu Bị, Gia Cát Lượng, Bàng Thống, Pháp Chính, Từ Thứ, Hoàng Nguyệt Anh, Mã Đại, Quan Ngân Bình, Đặng Chi, Mã Lương · *Ngô*: Tôn Quyền, Đinh Phụng, Trương Hoành, Lỗ Túc, Tiểu Kiều, Gia Cát Cẩn, Tôn Phấn · *Quần hùng*: Điêu Thuyền, Viên Thiệu, Trương Giác, Trương Bảo, Mã Đằng.
- **+10% HP tối đa (`HP_10`)** — *Ngụy*: Chân Cơ, Biện Ngọc Nhi, Tân Hiến Anh · *Thục*: Giản Ung, Mi Trúc, Mi Trinh, Gia Cát Quả, Phí Y, Gia Cát Chiêm · *Ngô*: Trương Chiêu, Đại Kiều, Bộ Luyện Sư, Tôn Lỗ Dục, Cố Ung, Lục Kháng · *Quần hùng*: Trần Cung, Mạnh Hoạch, Hàn Toại, Đào Khiêm, Trương Lỗ, Thái Văn Cơ, Trâu Ngọc, Chúc Dung, Đổng Bạch, Trương Xuân Hoa, Lý Thôi, Quách Dĩ, Cát Huyền, Thẩm Phối, Hứa Du, Tả Từ, Thủy Kính, Hoa Đà, Kỷ Linh, Nghiêm Bạch Hổ.
- **+20 Giáp (`DEF_5`)** — *Ngụy*: Tào Nhân, Tào Hồng, Tào Chân, Hạ Hầu Đôn, Vu Cấm, Điển Vi, Hứa Chử, Bàng Đức, Tào Chương, Mãn Sủng, Vương Tường, Quách Hoài · *Thục*: Trương Phi, Triệu Vân, Vương Bình, Liêu Hóa, Ngô Ý, Trương Tinh Thái, Tưởng Uyển, La Hiến, Trương Dực · *Ngô*: Tôn Kiên, Tôn Sách, Lữ Mông, Hoàng Cái, Trình Phổ, Chu Thái, Từ Thịnh, Chu Hoàn, Toàn Tông, Lữ Đại, Đặng Đương · *Quần hùng*: Đổng Trác, Cao Thuận, Nhan Lương.

### Ngọc Ngũ Hành (Gem)

> Ngọc là **vật phẩm rời** theo (loại, cấp 1→10), **rớt kèm khi quay Tướng**. Một đội hình gắn tối đa **3 loại KHÁC NHAU** (chọn tay trong 5 loại Ngũ Hành); trong một loại luôn dùng viên **cấp cao nhất đang sở hữu**. Chỉ số Ngọc là **Aura gốc cho TOÀN ĐỘI** khi vào trận — giống Chỉ số Nền Ra Trận: **không chiếm trần `maxLayers`, không thể bị Xóa Buff**. Ngọc **được tính vào LC** (ô đội hình, đội đã lưu, bảng xếp hạng).

| Loại | Chỉ số 1 (cấp 1 → cấp 10) | Chỉ số 2 (cấp 1 → cấp 10) |
| :--- | :--- | :--- |
| **Kim** | +5% → +25% Sát thương | −5% → −25% Sát thương gánh chịu |
| **Mộc** | +5% → +25% HP tối đa | +2% → +12% Hút máu |
| **Thủy** | +10% → +35% Chính xác | +5% → +30% Né tránh |
| **Hỏa** | +5% → +25% Chí mạng | +10% → +40% ST chí mạng |
| **Thổ** | +11 → +80 Giáp | +5% → +25% Xuyên giáp |

- **Tăng theo cấp**: mỗi cấp +2 điểm % cho hầu hết chỉ số, riêng cấp 10 nhảy +4 điểm % (bảng đầy đủ ở `GEM_TABLE`, `packages/game-config/src/gems.ts`). Riêng cột **Giáp của Ngọc Thổ** là **điểm Giáp nguyên** (11 → 80), không phải %.
- **Ghép 2→1**: 2 viên **cùng loại & cùng cấp** ghép thành 1 viên **cấp +1**, dùng **chung công thức / tỷ lệ / tài nguyên** với ghép thẻ Tướng (mục 5 — CLAUDE.md). Cấp 10 là trần, không ghép được nữa.
- **Rớt kèm khi quay**: mặc định mỗi Tướng quay ra có **10%** (`PVP_GEM_DROP_BPS`) rớt kèm 1 Ngọc **cùng cấp** với thẻ đó; khi trúng chọn đều **20%/loại** (`PVP_GEM_TYPE_WEIGHT_BPS`). Tỉ lệ rớt tổng và trọng số từng hệ **chỉnh được ở trang Quản trị** (tab **Tỉ lệ quay**, bảng `gacha_config`); ràng buộc tổng trọng số 5 hệ = 100%.

### Danh mục 20 Hiệu ứng được phép sử dụng

> **Quy tắc cộng dồn chung**: Mọi trần "Max cộng dồn" bên dưới đều tính **theo TỪNG nguồn (từng tướng thi triển)**, KHÔNG có trần toàn hệ thống trên một mục tiêu.
> **Quy tắc số lượt mặc định**: Hiệu ứng nào **không ghi rõ số lượt** thì mặc định **3 lượt** (buff/debuff/phản kích/khiên). Riêng Thiêu đốt duy trì `4 lượt`.

1. **Buff sát thương**: Tăng % sát thương gây ra (10% – 30%, 3 lượt). **Max cộng dồn: 3 lớp/nguồn**.
2. **Giảm sát thương**: Giảm % sát thương gánh chịu (10% – 25%) hoặc giảm % sát thương đối thủ gây ra (**10% – 20%**, 3 lượt). **Max cộng dồn: 3 lớp**. Hệ số debuff giảm ST được giữ ở mức cao trong khung để bù cho rủi ro đánh trượt / bị giải hiệu ứng.
3. **Hồi máu**: Hồi HP ngay lập tức (hoặc hồi mỗi lượt - HoT) theo % HP tối đa hoặc % ST cơ bản của người thi triển. Hồi máu toàn đội của **Tướng Hỗ trợ** dùng hệ số **120% – 140% ST cơ bản** (tùy tướng). *HoT* hồi vào **ĐẦU mỗi lượt** cho mọi đồng minh còn sống trong phạm vi, lượng hồi snapshot theo ST của người thi triển lúc phát, **không ăn Chí mạng**; mặc định **3 lớp/nguồn** — riêng **Cát Huyền** không cộng dồn lớp (chỉ làm mới).
4. **Tăng máu tối đa**: Tăng trần HP tối đa (10% – 20%), chỉ hồi 1/4 lượng trần HP tăng lên. **Max cộng dồn: 3 lớp**.
5. **Giảm máu tối đa**: Giảm trần HP tối đa của đối thủ (5% – 15%, 3 lượt). Chạy qua **bước rollHit tiêu chuẩn** như mọi chiêu khác (vẫn tính Né/Trượt 1% – 15%); trượt thì bỏ qua toàn bộ hiệu ứng. **Max cộng dồn: 3 lớp**, đồng thời chịu **trần toàn hệ thống: tổng giảm Max HP trên một mục tiêu tối đa 30%** (`PVP_MAXHP_DOWN_CAP_BPS`).
6. **Choáng**: Mục tiêu bị choáng không thể thực hiện hành động.
   - **Thời gian hiệu lực**: Duy trì cho đến khi **tướng gây ra hiệu ứng choáng đó ra skill ở lượt tiếp theo**.
   - **Tỷ lệ & Cân bằng Sát thương**:
     - *Tướng Hỗ trợ Choáng đơn mục tiêu*: Sát thương **120% – 180%**, Tỷ lệ choáng **80% – 100% ở Cấp 10** (`cấp × 8%` đến `cấp × 10%`; cấp 1 = 8% – 10%). *Điêu Thuyền* & *Quan Vũ* nhắm thẳng `highest_damage_enemy`.
     - *Tướng Tấn công Choáng đơn mục tiêu*: Sát thương **250% – 285%**, tỷ lệ choáng **30% – 50% ở Cấp 10** (`cấp × 3%` đến `cấp × 5%`; cấp 1 = 3% – 5%).
     - *Tướng Choáng diện rộng (Ngang/Hàng trước/AoE)*: Tỷ lệ choáng `cấp × 1.5%` đến `cấp × 2.5%` (max **15% – 25%** ở Cấp 10).
7. **Giải choáng & Thiêu đốt**: Giải hiệu ứng Choáng hoặc Thiêu đốt cho đồng minh (tỷ lệ 30% – 75%; riêng **Hoa Đà** đặc thù **55% → 100%** theo cấp). *Tác dụng tức thì*. Khi Thiêu đốt bị **Xóa/Giải**, toàn bộ sát thương còn lại của các lớp thiêu đốt bị gỡ **nổ ngay lập tức với 50% sát thương còn lại** (`PVP_BURN_CLEANSE_EXPLODE_BPS`).
8. **Thiêu đốt**: Gây thêm sát thương vào đầu mỗi lượt thi triển (mỗi lớp gây **50% sát thương cơ bản**). Có thể ăn Chí mạng. Duy trì **4 lượt**. Mục tiêu đang chịu Thiêu đốt bị **giảm 50% khả năng hồi máu** (áp cho MỌI nguồn hồi máu nhận vào).
   - **KHÔNG bỏ qua Né tránh & Giáp**: sát thương Thiêu đốt **chịu Giáp** của mục tiêu như đòn đánh thường (BƯỚC 2 — Xuyên giáp của nguồn vẫn áp dụng, tính riêng theo từng nguồn). Né tránh không roll riêng cho Thiêu đốt: Né thành công ở BƯỚC 1 thì chiêu **không dính hiệu ứng** nên không có lớp Thiêu đốt nào được tạo.
   - *Chu Du, Lục Tốn, Hoàng Cái*: Duy trì **4 lượt**, cộng dồn max 3 lớp từ chính tướng đó.
   - *Chu Du*: Đòn Thiêu đốt được tăng thêm **+30% Tỷ lệ chí mạng & +30% ST chí mạng**.
   - *Lục Tốn*: Hút máu áp dụng cho cả Thiêu đốt với hiệu suất **50%**.
9. **Tăng tỷ lệ chí mạng**: Tăng % chí mạng (10% – 35%, 3 lượt). **Max cộng dồn: 3 lớp**.
10. **Giảm tỷ lệ chí mạng**: Giảm % chí mạng đối thủ (15% – 20%, 3 lượt). **Max cộng dồn: 3 lớp**.
11. **Tăng/Giảm sát thương chí mạng**: Buff/Debuff tăng hoặc giảm ST chí mạng (15% – 30%, 3 lượt). **Max cộng dồn: 3 lớp**.
12. **Phản kích (Nội tại Bị động)**: Tự động đánh trả khi chịu sát thương trực tiếp.
   - *Phản kích đơn*: Đánh trả kẻ tấn công, sát thương **80% – 100% ST cơ bản**. Tỷ lệ kích hoạt `cấp × 5%` (tối đa **50%** ở Cấp 10).
   - *Phản kích diện rộng (Tào Nhân, Trương Phi, Cao Thuận, Đổng Trác, Mãn Sủng, La Hiến, Toàn Tông)*: Đánh trả toàn bộ đội hình địch, sát thương **30% ST cơ bản** (tối đa 30%).
13. **Hút máu**: Hồi HP theo % sát thương thực tế gây ra.
   - *Mức tiêu chuẩn*: `cấp × 2%` (Max **20%**).
   - *Mức thấp*: `cấp × 1.5%` (Max **15%**) — dùng cho tướng đã có bộ hiệu ứng dày (**Quan Vũ**).
   - *Mức Sát thủ*: `cấp × 3%` (Max **30%**).
   - *Signature Hero*: **Mã Siêu** (Max **100%**), **Cam Ninh** (Max **95%**), **Hoa Hùng** (Max **90%**), **Nhạc Tiến** (Max **85%**).
   - *Ban hút máu cho đồng đội*: Buff **+15%** Hút máu cho toàn đội (2 lượt, cố định 1 lớp) từ **Lưu Bị**, **Tuân Úc**, **Lỗ Túc**, **Viên Thiệu**.
   - *Hút máu ĐỘI*: hồi cho **bản thân VÀ mọi đồng minh còn sống** theo `cấp × 1.5%` (Max **15%**) trên **TỔNG** sát thương đòn đánh gây ra — mỗi đồng minh nhận trọn phần % đó mà không cần tự ra đòn. Chỉ đi kèm kỹ năng **đánh toàn bộ địch**: **Chung Hội** (Ngụy), **Khương Duy** (Thục), **Tôn Sách** (Ngô), **Kỷ Linh** (Quần) — mỗi phe 1 tướng.
14. **Xóa hiệu ứng có lợi của đối thủ**: Loại bỏ lớp buff có lợi của đối thủ theo tỉ lệ `dispelBps` = **`cấp × 7.5%`** (cấp 1 = 7.5% … cấp 10 = 75%) — mỗi mục tiêu địch roll riêng.
15. **Xóa hiệu ứng bất lợi của bản thân/đồng minh**: Loại bỏ các hiệu ứng xấu (bao gồm **Thiêu đốt** và **Giảm Máu Tối Đa**); gỡ lớp debuff theo tỉ lệ `purifyBps` = **`cấp × 7.5%`** (cấp 1 = 7.5% … cấp 10 = 75%) — mỗi lớp debuff roll riêng, gỡ xong thì đồng bộ lại trần HP. Nếu gỡ Thiêu đốt thì kích hoạt hiệu ứng nổ 50% sát thương còn lại (mục 7).
16. **Tạo Khiên (Shield)**: Hấp thụ sát thương nhận vào trong **3 lượt** (tính theo % HP tối đa hoặc % ST cơ bản). Khiên chịu sát thương trước HP thực tế. **Max cộng dồn: 2 lớp/nguồn** (`PVP_SHIELD_MAX_LAYERS`).
17. **Xóa Khiên (Shield Break)**: Có tỷ lệ **20% ở Cấp 1 → 80% ở Cấp 10** (nội suy `pvpLevelSpanBps`) kích hoạt. Khi kích hoạt, **bẻ gãy 70% lượng Khiên hiện có** của mục tiêu bị trúng đòn (`PVP_SHIELD_BREAK_REMOVE_BPS`), giữ lại 30% — KHÔNG xóa sạch 100%.
18. **Hồi sinh (Nội tại Bị động)**: Hồi lại `cấp × 5%` HP tối đa khi tử trận lần đầu và giảm 50% ST vĩnh viễn (**Triệu Vân**, **Tào Nhân**, **Hoàng Cái**, **Văn Sú**).
19. **Gia tăng sát thương lên mục tiêu Debuff (Đao phủ)**: Gây thêm **+30% sát thương** nếu mục tiêu đang chịu **từ 2 lớp hiệu ứng bất lợi trở lên** HOẶC **đang bị Choáng/Thiêu đốt** (`PVP_VS_DEBUFF_MIN_LAYERS = 2`) (**Tào Phi**, **Tào Chân**, **Từ Hoảng**, **Đặng Ngãi**, **Mã Đại**, **Đinh Phụng**, **Tôn Phấn**, **Trương Bảo**).
20. **Tăng/Giảm Giáp**: Buff tăng Giáp cho bản thân/đồng minh hoặc debuff giảm Giáp đối thủ (3 lượt). Đơn vị là **điểm Giáp nguyên**, KHÔNG phải %: tỷ lệ giảm sát thương `DR = Giáp / (Giáp + 100)` (trần 75%, xem *Hệ thống Combat*). **Max cộng dồn: 3 lớp**.
   - *Tăng Giáp (buff)*: các mốc **+39 / +79 / +107 Giáp** — tướng đỡ đòn (Vu Cấm, Điển Vi, Mãn Sủng, Chu Thái, Cao Thuận…).
   - *Giảm Giáp (debuff)*: các mốc **24 / 39 Giáp** — làm mục tiêu ăn sát thương nhiều hơn (Tào Tháo, Giả Hủ, Tư Mã Ý, Từ Thứ, Mã Đại, Đổng Trác…).
   - **Nâng cấp tướng nhân gấp 10 lần hiệu lực Giáp**: cấp 1 = 10% giá trị chốt, cấp 10 = 100% (thang dốc `pvpDefArmorAtLevel`; ví dụ "+107 Giáp" → cấp 1 +11, cấp 10 +107).

### Hệ thống Combat: Chính xác / Né tránh / Giáp / Xuyên giáp

Toàn bộ chỉ số dùng đơn vị **bps** (`10000 = 100%`). Mọi tính toán nằm ở **server** (`pvp.engine.ts`), client chỉ phát lại.

**Đơn vị hiển thị trên UI**: **Chính xác · Né tránh · Xuyên giáp** hiện theo **điểm** (1 điểm = 1%, **làm tròn tới hàng đơn vị** — không hiện phần thập phân, kể cả chỉ số cộng thêm trên ô tướng khi chiến đấu); **Giáp** hiện theo **điểm Giáp nguyên**; các chỉ số còn lại hiện theo **%**.

**Bảng quy định chỉ số & giới hạn (Stat Caps)**

| Chỉ số | Mặc định | Trần (Max Cap) | Ghi chú |
| --- | --- | --- | --- |
| Sát thương gốc (Raw Damage) | — | — | Sát thương đầu ra ban đầu của bên tấn công. |
| Máu (HP) | — | — | Sinh mệnh chính. |
| Khiên (Shield) | — | — | Máu ảo/lá chắn tạm thời đè lên Máu thật (mục 16). |
| Chính xác (Hit Rate) | **80% → 100%** theo cấp (`pvpHitBps`) | **150%** (`PVP_HIT_MAX_BPS`) | Cấp 1 = 80%, cấp 10 = 100% (nội suy `pvpLevelSpanBps`). |
| Né tránh (Dodge Rate) | **2% → 20%** theo cấp (`pvpDodgeBps`) | **50%** (`PVP_DODGE_MAX_BPS`) | Cấp 1 = 2%, cấp 10 = 20%. |
| Trần Trúng Tối Đa (Max Hit Cap) | — | **99%** (`PVP_HIT_REAL_MAX_BPS`) | Luôn chừa lại **1% Né/Trượt tối thiểu** làm yếu tố may mắn. |
| Sàn Trúng Tối Thiểu (Min Hit Cap) | — | **55%** (`PVP_HIT_REAL_MIN_BPS`) | Kẹp sàn để Né thực tế **đạt tối đa 45%**, kể cả khi Chính xác bị Suy yếu nặng. |
| Trần Né Thực Tế (Max Dodge Real) | — | **45%** (`PVP_DODGE_REAL_MAX_BPS`) | Mốc đối chiếu với sàn Trúng 55%; Né cao không vô hiệu hoá đối thủ hoàn toàn. |
| Trọng số Chính xác (Attack Weight) | **K = 1.35** (`PVP_HIT_WEIGHT`) | — | Chính xác nặng gấp 1.35 lần Né tránh trong công thức chia trọng số. |
| Giáp (Armor / Def) | **14 → 43** điểm theo cấp (`pvpDefArmor`) | **75%** DR (`PVP_DEF_MAX_BPS`) | Giáp là **số nguyên**; nền cấp 1 = 14 (DR 12,3%), cấp 10 = 43 (DR 30,1%). Tỷ lệ giảm sát thương bão hoà `DR = Giáp / (Giáp + 100)` (K = 100), kẹp trần 75%. **Giảm TRỰC TIẾP** sát thương nhận vào — **KHÔNG phải tỉ lệ may mắn**, không roll ngẫu nhiên. Chỉ BƯỚC 1 (Chính xác/Né tránh) mới là may rủi. |
| Xuyên giáp (Def Pen) | **0%** (`PVP_DEF_PEN_BPS`) | **50%** (`PVP_DEF_PEN_MAX_BPS`) | Trừ theo **% Giáp hiện có** của đối phương (áp TRƯỚC khi trừ Giáp cố định). Giáp hiệu dụng không được âm. |

**Triết lý thiết kế**: Chính xác cao phối hợp với RNG có kiểm soát — Né tránh là yếu tố may rủi (thực tế ~1%–45%), **không** là chiến thuật vô hiệu hoá toàn bộ sát thương. Nhờ kẹp biên `[55%, 99%]`, đòn đánh **luôn có xác suất trúng ≥ 55%** trong mọi cặp chỉ số. Trọng số `K = 1.35` (giảm từ 1.85) giúp Né tránh cạnh tranh hơn với Chính xác; sàn 55% mở trần Né thực tế lên 45%, biến Ngọc Thủy / tướng né tránh thành khắc chế chiến thuật cứng.

**Thứ tự xử lý một đòn đánh (Combat Flow)**

- **BƯỚC 1 — Trúng / Trượt** (công thức chia trọng số + kẹp biên, `pvpRealHitBps`):
  - `Hit_Real = clamp((Chính xác × K) / (Chính xác × K + Né tránh) × 99%, 55%, 99%)` với `K = 1.35`.
  - `Né_Real = 100% − Hit_Real` (**luôn >= 1%** nhờ hệ số ×99%, và **tối đa 45%** nhờ sàn 55%).
  - Random: rơi vùng Né → **MISS** (0 sát thương, **giữ nguyên Khiên & Máu**, không phản kích, không hút máu); rơi vùng Hit_Real → **HIT**, sang BƯỚC 2.
  - **MISS là miễn nhiễm TOÀN BỘ chiêu**: chỉ roll Trúng/Trượt **một lần duy nhất** cho mỗi mục tiêu trong lượt rồi dùng **chung** cho sát thương, Choáng và mọi hiệu ứng bất lợi (Suy yếu, Thiêu đốt, Giảm Máu Tối Đa, Giảm Giáp). Né thành công thì mục tiêu **không dính bất kỳ hiệu ứng nào** của chiêu — không có chuyện *"né được sát thương mà vẫn bị Choáng"*; đồng thời **chặn cả Hút máu và Phản kích** của kẻ tấn công (all-or-nothing).
- **BƯỚC 2 — Giáp & Xuyên giáp** (đúng **thứ tự 4 bước**, đơn vị **điểm Giáp nguyên**):
  - **(1) Giáp tổng mục tiêu** (đã gồm buff/debuff Giáp từ kỹ năng):
    `Armor_total = MAX(0, Armor_base_total × (1 + %Giáp) + Giáp_cố_định)` với `Armor_base_total = Giáp_cơ_bản + Giáp_trang_bị + Giáp_duyên_phận`.
  - **(2) Giáp hiệu dụng sau Xuyên giáp**: `Armor_eff = MAX(0, Armor_total × (1 − Pen%) − Pen_flat)` — Giáp **không được âm**.
  - **(3) Tỷ lệ giảm sát thương**: `DR_final = MIN(75%, Armor_eff / (Armor_eff + 100))`.
  - **(4) Sát thương cuối**: `Damage_Final = Raw_Damage × (1 − DR_final)` (làm tròn).
  - Ví dụ: Giáp nền cấp 10 (43 điểm, DR 30,1%) bị Pen 20% → `Armor_eff = 43 × 0,8 = 34,4` → `DR = 34,4 / 134,4 ≈ 25,6%`; Giáp 300 (chạm trần 75%) bị Pen 50% → `Armor_eff = 150` → `DR = 150 / 250 = 60%`.
- **BƯỚC 3 — Trừ vào Khiên & Máu**:
  - Khiên `>=` Damage_Final: `Khiên mới = Khiên cũ − Damage_Final`, Máu giữ nguyên.
  - Khiên `<` Damage_Final: `Khiên = 0`, `Máu mới = MAX(0, Máu cũ − (Damage_Final − Khiên cũ))`.

Thứ tự trong engine: `rollHit` (bước 1) → `mitigate` (bước 2, sinh ra `mitigated` = phần giáp chặn để hiển thị) → `damageDirect` (bước 3, `absorbShield` rồi mới trừ HP). Đòn **phản kích** cũng đi qua đủ 3 bước.

**Ví dụ minh hoạ (Test Cases)**

| Tình huống | Chính xác (tấn công) | Né tránh (phòng thủ) | Tỷ lệ Trúng | Tỷ lệ Né (Miss) |
| --- | --- | --- | --- | --- |
| Cấp 1 mặc định (Min vs Min) | 80% | 2% | **97.20%** | 2.80% |
| Cấp 10 mặc định (Base vs Base) | 100% | 20% | **86.23%** | 13.77% |
| Hit Chuẩn vs Né Vừa | 100% | 30% | **81.00%** | 19.00% |
| Hit Vừa vs Max Né | 120% | 50% | **75.65%** | 24.35% |
| Max Chính xác vs Né thường | 150% | 2% | **98.03%** | 1.97% |
| Hit Thường vs Max Né | 100% | 50% | **72.24%** | 27.76% |
| Max Hit khắc chế Max Né | 150% | 50% | **79.40%** | 20.60% |
| Chính xác bị Suy yếu nặng vs Max Né | 40% | 50% | **55.00%** *(chạm sàn)* | 45.00% *(chạm trần)* |

- **Case P1** (mặc định cấp 10 vs mặc định cấp 10): Hit 100% vs Dodge 20% → `Hit_Real = 86.23%`; Giáp 43 (nền cấp 10) vs Pen 0% → `DR = 43/143 = 30,1%` → `Damage_Final ≈ 69,9% Raw`.
- **Case P2** (Hit 150% vs Dodge 50%): `Hit_Real = 79.40%` (Chính xác tối đa bẻ gãy Né tối đa xuống ≈20.6% Né thực tế).
- **Case 3** (Giáp 100 vs Pen 10%): `Armor_eff = 100 × 0,9 = 90` → `DR = 90/190 = 47,4%` → nhận `52,6% Raw`.
- **Case 4** (Giáp 300 vs Pen 50%): Giáp 300 vượt trần nên DR gốc = 75%; `Armor_eff = 300 × 0,5 = 150` → `DR = 150/250 = 60%` → nhận `40% Raw`.
- **Case 5** (toàn diện): Attacker Raw 10.000, Hit 120%, Def Pen 20% vs Defender HP 20.000, Shield 3.000, Dodge 15%, Giáp 300 → `Hit_Real = 98,09%`; `Armor_eff = 300 × 0,8 = 240` → `DR = 240/340 = 70,6%` → `Damage_Final ≈ 2.941`; trừ vào Khiên (3.000 → 59), Máu giữ nguyên → **HP còn 20.000**.

**Tướng mang hiệu ứng chỉ số mới (bổ sung qua kỹ năng)**

- **Giáp `defArmor`** (buff bản thân — đơn vị **điểm Giáp**): Cao Hồng, Điển Vi, Mãn Sủng, Vu Cấm, Tào Nhân (Ngụy); Vương Bình, Liêu Hóa (Thục); Chu Thái, Từ Thịnh, Trình Phổ (Ngô); Cao Thuận (Quần). **Buff toàn đội**: Tuân Úc (Ngụy), Trương Chiêu (Ngô), Đặng Chi, Mã Lương (Thục), Tôn Lỗ Dục (Ngô), Thủy Kính, Thái Văn Cơ (Quần).
- **Né tránh `dodgeBps`** (buff bản thân): Triệu Vân (25%), Mã Siêu (25%) (Thục); Cam Ninh (Ngô); Công Tôn Toản (bản thân + đồng minh cùng hàng), Mã Đằng (Quần); Hứa Chử, Quách Hoài (Ngụy); Trình Phổ (Ngô); Liêu Hóa (Thục); Thẩm Phối (25%) (Quần). **Buff toàn đội / theo hàng**: Gia Cát Quả (10%→20% toàn đội), Tả Từ (10%→15% toàn đội), Tào Tiết (15% toàn đội), Bàng Thống (15% toàn đội), Trương Lỗ (20% Hàng Trước), Viên Thuật (15% Hàng Trước).
- **Xuyên giáp `defPenBps`** (buff bản thân): Tào Phi, Hứa Chử (Ngụy); Quan Vũ, Khương Duy, Ngụy Diên (Thục); Lữ Bố, Nhan Lương, Văn Sú, Hoa Hùng (Quần). **Buff toàn đội**: Pháp Chính (Thục), Trần Cung (Quần).
- **Chính xác `hitBps`** (buff bản thân): Hạ Hầu Uyên, Trương Cáp, Tào Phi (20%) (Ngụy); Hoàng Trung (40%), Quan Bình (25%) (Thục); Thái Sử Từ (35%), Hàn Đương (25%), Tôn Thượng Hương (Ngô); Lý Thôi (30%) (Quần). **Buff toàn đội / theo hàng**: Tôn Quyền (15%→25% toàn đội), Tào Thực (15%→25% toàn đội), Trương Hoành (20% toàn đội), Tiểu Kiều (15% toàn đội), Phí Y (20% toàn đội), Bàng Thống (15% toàn đội), Mã Trung (15% Hàng Sau).
- **Giảm Giáp `defArmorDown`** (debuff lên địch — đơn vị **điểm Giáp**): Tào Tháo, Giả Hủ, Tư Mã Ý (Ngụy), Mã Đại, Từ Thứ (Thục), Tôn Lỗ Ban, Lữ Đại, Tôn Phấn (Ngô), Hứa Du, Đổng Trác (Quần).
- **Giảm Né tránh `dodgeDownBps`** (debuff lên địch): Trương Liêu (25% Hàng Ngang), Trương Bảo (25% Hàng Trước), Thái Sử Từ (20% mục tiêu trúng đòn); Gia Cát Chiêm (20% toàn bộ địch), Chu Phường (25% toàn bộ địch).
- **Giảm Chính xác `hitDownBps`** (debuff lên địch): Lưu Diệp (20% toàn bộ địch), Viên Thuật (25% Hàng Trước địch).
- **Nội tại phản ứng khi Né thành công (`dodgeReact`)**: **Triệu Vân** — Né thành công thì **Phản kích** ngay kẻ tấn công (ST 50% ST cơ bản); **Mã Siêu** — mỗi lần Né thành công cộng dồn **+10% ST chí mạng** cho đòn kế tiếp, tích lũy **vĩnh viễn** tới hết trận (tối đa 3 lớp).
- **"Chắc chắn trúng" (`guaranteedHitBelowHpBps`)**: **Hoàng Trung** — kỹ năng **bỏ qua hẳn bước roll Trúng/Trượt** khi HP mục tiêu **< 50%** (luôn trúng).

---

## 2. Phe Ngụy (wei) — 35 Tướng (Tier A+)

> **Bản sắc**: Làm suy yếu, khống chế Choáng, xóa buff/khiên, tạo khiên kiên cố, triệt hạ chí mạng địch và Phản kích dẻo dai.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng | Nội tại |
|---|-------|-----------|-----|---------|------------------|---------|
| 1 | **Tào Tháo** | Hỗ trợ | ⭐ | **Hiệu lệnh thiên hạ**: Tấn công toàn bộ địch 75%, Xóa buff có lợi của địch (tỉ lệ cấp×7.5%, max 75%), có 20%-80% tỷ lệ Xóa Khiên toàn bộ địch, Giảm Giáp toàn bộ địch 39 (3 lượt) VÀ Buff sát thương 20% cho toàn đội (3 lượt). | Xóa buff địch, Xóa Khiên (20%-80%), Giảm Giáp địch, Buff ST toàn đội | +10% sát thương |
| 2 | **Tào Phi** | Tấn công | ⭐ | **Đế vương trảm**: Tấn công đơn 290%, Giảm tỷ lệ chí mạng của mục tiêu 20%, Giảm 20% ST chí mạng, Tăng Xuyên giáp bản thân 15%, Tăng Chính xác bản thân 20% và Hút máu theo cấp (cấp×2%, max 20%) (3 lượt). | Giảm chí mạng, Giảm ST chí mạng, Tăng Xuyên giáp, Tăng Chính xác, Hút máu, +30% ST lên mục tiêu đang debuff | +10% sát thương |
| 3 | **Tào Nhân** | Phòng thủ | | **Thiết bích**: Tăng Giáp bản thân +39 (3 lượt), Tạo Khiên hấp thụ ST bằng 20% HP tối đa cho bản thân (3 lượt), Hồi máu 10% HP cho bản thân mỗi lượt ra đòn, Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%) và Hồi sinh (1 lần/trận). | Tăng Giáp, Tạo Khiên bản thân, Hồi máu, Phản kích diện rộng, Hồi sinh | +20 Giáp |
| 4 | **Tào Hồng** | Phòng thủ | | **Hộ chủ**: Tấn công đơn 230%, Hồi máu 10% HP tối đa cho bản thân, Tăng Giáp bản thân +79 và Giảm sát thương nhận vào 15% (3 lượt). | Hồi máu, Tăng Giáp, Giảm ST nhận | +20 Giáp |
| 5 | **Tào Chân** | Phòng thủ | | **Phá trận**: Tấn công hàng ngang 200%, Giảm sát thương của các mục tiêu 15% (3 lượt). | Giảm ST địch, +30% ST lên mục tiêu đang debuff | +20 Giáp |
| 6 | **Hạ Hầu Đôn** | Phòng thủ | ⭐ | **Độc nhãn cuồng đao**: Tấn công đơn 285%, gây Choáng mục tiêu (tỷ lệ cấp×4%, max 40%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Choáng, Phản kích đơn | +20 Giáp |
| 7 | **Hạ Hầu Uyên** | Tấn công | ⭐ | **Thần tốc tập kích**: Tấn công hàng dọc sau 220%, Giảm tỷ lệ chí mạng hàng sau địch 20% và Tăng Chính xác bản thân 20% (3 lượt). | Giảm chí mạng địch, Tăng Chính xác | +5% chí mạng |
| 8 | **Trương Liêu** | Tấn công | ⭐ | **Uy chấn Tiêu Dao**: Tấn công hàng ngang 225%, Giảm sát thương địch 10%, Giảm Né tránh toàn bộ Hàng Ngang địch 25%, Hút máu theo cấp (cấp×3%, max 30%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Giảm Né tránh địch, Hút máu, Phản kích đơn | +5% chí mạng |
| 9 | **Nhạc Tiến** | Tấn công | | **Tiên phong phá địch**: Tấn công đơn 270%, Hút máu đặc biệt theo cấp (cấp×8.5%, max 85%), có 20%-80% tỷ lệ Xóa Khiên mục tiêu và Tăng máu tối đa 10% bản thân. | Hút máu 85% (Signature Ngụy), Xóa Khiên (20%-80%), Tăng HP max | +5% chí mạng |
| 10 | **Vu Cấm** | Phòng thủ | | **Nghiêm trận**: Hồi máu 20% HP tối đa cho bản thân, Giảm sát thương nhận vào 20%, Tăng Giáp bản thân +79 và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hồi máu, Giảm ST nhận, Tăng Giáp, Phản kích đơn | +20 Giáp |
| 11 | **Trương Cáp** | Tấn công | | **Kỳ binh đột kích**: Tấn công hàng dọc trước 200%, gây Choáng mục tiêu (tỷ lệ cấp×3%, max 30%) và Tăng Chính xác bản thân 20% (3 lượt). | Choáng, Tăng Chính xác | +10% sát thương |
| 12 | **Từ Hoảng** | Tấn công | ⭐ | **Khai sơn phủ**: Tấn công đơn 305%, Giảm sát thương của mục tiêu 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Phản kích đơn, +30% ST lên mục tiêu đang debuff | +10% sát thương |
| 13 | **Điển Vi** | Phòng thủ | ⭐ | **Ác Lai hộ vệ**: Tăng máu tối đa 20%, Tăng Giáp bản thân +107, Hồi máu 15% HP tối đa mỗi lượt ra đòn và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Tăng Giáp, Hồi máu, Phản kích đơn | +20 Giáp |
| 14 | **Hứa Chử** | Phòng thủ | ⭐ | **Hổ si cuồng kích**: Tấn công đơn 295%, Hút máu theo cấp (cấp×2.5%, max 25%), Buff sát thương bản thân 20%, Tăng Xuyên giáp bản thân 20% và Tăng Né tránh bản thân 20% (3 lượt). | Hút máu, Buff ST, Tăng Xuyên giáp, Tăng Né tránh | +20 Giáp |
| 15 | **Quách Gia** | Hỗ trợ | ⭐ | **Diệu kế thiên cơ**: Tấn công toàn bộ địch 85%, Tăng 15% HP tối đa cho toàn đội và Giảm sát thương nhận vào của toàn bộ địch 10% (3 lượt). | Tăng HP max toàn đội, Giảm ST địch | +10% sát thương |
| 16 | **Tuân Úc** | Hỗ trợ | | **Vương tá chi sách**: Buff sát thương 15% toàn đội (3 lượt), Giảm sát thương nhận vào cho toàn đội 10% (3 lượt), Tăng Giáp toàn đội +39 (3 lượt) và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Giảm ST nhận, Tăng Giáp, Ban hút máu | +10% sát thương |
| 17 | **Tuân Du** | Hỗ trợ | | **Liên hoàn kế**: Tấn công hàng dọc trước 180%, gây Choáng (tỷ lệ cấp×3%, max 30%). | Choáng | +10% sát thương |
| 18 | **Giả Hủ** | Hỗ trợ | | **Độc kế**: Tấn công hàng dọc trước 150%, gây Choáng các mục tiêu (tỷ lệ cấp×3%, max 30%), Giảm sát thương địch 20% và Giảm Giáp địch 39 (3 lượt). | Choáng, Giảm ST địch, Giảm Giáp địch | +10% sát thương |
| 19 | **Tư Mã Ý** | Hỗ trợ | ⭐ | **Ẩn nhẫn phản kích**: Tấn công toàn bộ địch 125%, Giảm sát thương toàn bộ địch 15%, Giảm tỷ lệ chí mạng 15%, Giảm 20% ST chí mạng toàn bộ địch và Giảm Giáp toàn bộ địch 24 (3 lượt). | Giảm ST địch, Giảm chí mạng, Giảm ST chí mạng, Giảm Giáp địch | +5% chí mạng |
| 20 | **Bàng Đức** | Phòng thủ | | **Quan tài quyết chiến**: Tấn công đơn 280%, Hút máu theo cấp (cấp×2%, max 20%), Tăng tỷ lệ chí mạng bản thân 25% và Tăng 25% ST chí mạng bản thân (3 lượt). | Hút máu, Tăng chí mạng, Tăng ST chí mạng | +20 Giáp |
| 21 | **Chân Cơ** | Hỗ trợ | | **Lạc Thần**: Hồi máu toàn đội (110% ST cơ bản) và Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Hồi máu, Giảm ST nhận | +10% HP |
| 22 | **Biện Ngọc Nhi** | Hỗ trợ | | **Hậu cung an định**: Tăng máu tối đa toàn đội 10% và Hồi máu toàn đội (100% ST cơ bản). | Tăng HP max, Hồi máu | +10% HP |
| 23 | **Tào Hoa** | Hỗ trợ | | **Nhu tình hộ mệnh**: Tấn công đơn hàng sau 110%, gây Choáng mục tiêu (tỷ lệ cấp×10%, max 100%). | Choáng | +10% sát thương |
| 24 | **Tào Tiết** | Hỗ trợ | | **Trung trinh**: Tạo Khiên cho toàn đội bằng 10% HP tối đa, Giảm 10% sát thương nhận vào cho toàn đội VÀ Tăng 15% Né tránh cho toàn đội (3 lượt). | Tạo Khiên toàn đội, Giảm ST nhận, Tăng Né tránh toàn đội | +10% sát thương |
| 25 | **Tân Hiến Anh** | Hỗ trợ | | **Tuệ nhãn phá cục**: Tấn công toàn bộ địch 55%, Giải choáng và Giải thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Giải choáng & thiêu đốt | +10% HP |
| 26 | **Tào Thực** | Hỗ trợ | | **Thất bộ thành thi**: Tăng tỷ lệ chí mạng toàn đội 15%, Tăng 20% ST chí mạng toàn đội và Tăng Chính xác toàn đội 25% (3 lượt). | Tăng chí mạng, Tăng ST chí mạng, Tăng Chính xác | +10% sát thương |
| 27 | **Tào Chương** | Phòng thủ | | **Trục hổ**: Tấn công đơn 265%, Tăng máu tối đa bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Phản kích đơn | +20 Giáp |
| 28 | **Mãn Sủng** | Phòng thủ | | **Cố thủ Hợp Phì**: Hồi máu bản thân 15% HP tối đa, Tạo Khiên cho bản thân bằng 15% HP tối đa, Tăng Giáp bản thân +107 (3 lượt) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Hồi máu, Tạo Khiên bản thân, Tăng Giáp, Phản kích diện rộng | +20 Giáp |
| 29 | **Lưu Diệp** | Hỗ trợ | | **Tiên đoán thắng bại**: Tấn công toàn bộ địch 80%, Giảm tỷ lệ chí mạng toàn bộ địch 20%, Giảm 15% ST chí mạng toàn bộ địch VÀ Giảm 20% Chính xác toàn bộ địch (3 lượt). | Giảm chí mạng, Giảm ST chí mạng, Giảm Chính xác địch | +5% chí mạng |
| 30 | **Vương Dị** | Tấn công | | **Chinh phạt Liêu Đông**: Tấn công đơn 280%, Giảm sát thương mục tiêu 10% và Tăng tỷ lệ chí mạng bản thân 20% (3 lượt). | Giảm ST địch, Tăng chí mạng | +5% chí mạng |
| 31 | **Vương Tường** | Phòng thủ | | **Ngọa băng cầu lý**: Hồi máu bản thân 25% HP tối đa, Giảm sát thương nhận vào 20% và Tăng 10% HP tối đa bản thân (3 lượt). | Hồi máu, Giảm ST nhận, Tăng HP max | +20 Giáp |
| 32 | **Đặng Ngãi** | Tấn công | | **Vượt Âm Bình**: Tấn công hàng dọc sau 180%, Giảm sát thương địch 10%, Tăng tỷ lệ chí mạng bản thân 15% (3 lượt) và +30% ST lên mục tiêu đang debuff. | Giảm ST địch, Tăng chí mạng, +30% ST lên mục tiêu đang debuff | +10% sát thương |
| 33 | **Quách Hoài** | Phòng thủ | | **Trấn thủ Ung Lương**: Tấn công hàng dọc trước 190%, Tạo Khiên cho bản thân bằng 15% HP tối đa, Giảm sát thương các mục tiêu 15% và Tăng Né tránh bản thân 20% (3 lượt). | Tạo Khiên bản thân, Giảm ST địch, Tăng Né tránh | +20 Giáp |
| 34 | **Trần Quần** | Hỗ trợ | | **Cửu phẩm trung chính**: Buff sát thương toàn đội 15% VÀ Tăng 20% ST chí mạng cho toàn đội (3 lượt). | Buff ST, Tăng ST chí mạng toàn đội | +10% sát thương |
| 35 | **Chung Hội** | Tấn công | | **Kiếm chỉ Hán Trung**: Tấn công toàn bộ địch 102%, Hút máu đội (cấp×1.5%, max 15%), Xóa buff có lợi của địch (tỉ lệ cấp×7.5%, max 75%), VÀ Giảm 15% sát thương mục tiêu (3 lượt). | Hút máu đội, Xóa buff địch, Giảm ST địch | +5% chí mạng |

---

## 3. Phe Thục (shu) — 35 Tướng (Tier A+)

> **Bản sắc**: Tấn công bùng nổ, dứt điểm nhanh, bạo phát chí mạng, bảo hộ tạo khiên và sinh tồn dẻo dai.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng | Nội tại |
|---|-------|-----------|-----|---------|------------------|---------|
| 1 | **Lưu Bị** | Hỗ trợ | ⭐ | **Nhân đức**: Buff sát thương toàn đội 15%, Tăng máu tối đa toàn đội 10%, Tăng tỷ lệ chí mạng toàn đội 15% và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Tăng HP max, Tăng chí mạng, Ban hút máu | +10% sát thương |
| 2 | **Quan Vũ** | Tấn công | ⭐ | **Thanh Long Yển Nguyệt**: Tấn công **tướng địch có sát thương cao nhất** 320%, Tăng tỷ lệ chí mạng bản thân 30%, Tăng 30% ST chí mạng bản thân khi thi triển, Tăng Xuyên giáp bản thân 20% (3 lượt) và Hút máu theo cấp (cấp×1.5%, max 15%). | Nhắm tướng địch mạnh nhất, Tăng chí mạng, Tăng ST chí mạng, Tăng Xuyên giáp, Hút máu | +5% chí mạng |
| 3 | **Trương Phi** | Phòng thủ | ⭐ | **Hổ Khiếu Trường Bản**: Tấn công toàn bộ hàng trước 200%, gây Choáng hàng trước (tỷ lệ cấp×2.5%, max 25%), Giảm 20% sát thương đối thủ, Tăng 15% Máu tối đa bản thân, Giảm 15% sát thương nhận vào và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Choáng hàng trước, Giảm ST địch, Tăng Máu tối đa, Giảm ST nhận vào, Phản kích diện rộng | +20 Giáp |
| 4 | **Gia Cát Lượng** | Hỗ trợ | ⭐ | **Bát trận đồ**: Tấn công toàn bộ địch 110%, gây Choáng (tỷ lệ cấp×2.5%, max 25%) và Buff sát thương toàn đội 10% (3 lượt). | Choáng, Buff ST | +10% sát thương |
| 5 | **Triệu Vân** | Tấn công | ⭐ | **Thất Tiến Thất Xuất**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng 20%, Giảm sát thương nhận vào 20%, Tăng Né tránh bản thân 25% (3 lượt), Hút máu theo cấp (cấp×3%, max 30%) và Hồi sinh (1 lần/trận). *(Nội tại Né tránh: Né thành công đòn của địch → **Phản kích** ngay kẻ tấn công, ST 50% ST cơ bản).* | Tăng chí mạng, Giảm ST nhận, Tăng Né tránh, Hút máu, Hồi sinh, Phản kích khi Né | +20 Giáp |
| 6 | **Mã Siêu** | Tấn công | ⭐ | **Cẩm Mã Siêu**: Tấn công đơn 280%, Hút máu theo cấp đặc biệt (cấp×10%, max 100%), Tăng máu tối đa 10% bản thân và Tăng Né tránh bản thân 25% (3 lượt). *(Nội tại Né tránh: mỗi lần Né thành công → +10% ST chí mạng, tích lũy **vĩnh viễn** tối đa 3 lớp).* | Hút máu 100%, Tăng HP max, Tăng Né tránh, Né tích lũy ST chí mạng | +5% chí mạng |
| 7 | **Hoàng Trung** | Tấn công | ⭐ | **Lão Đương Ích Tráng**: Tấn công hàng dọc sau 185%, Tăng tỷ lệ chí mạng 35% cho phát bắn này và Tăng Chính xác bản thân 40% (3 lượt). *(Cơ chế: nếu HP mục tiêu < 50% → **Chắc chắn trúng**, bỏ qua hẳn roll Trúng/Trượt).* | Tăng chí mạng, Tăng Chính xác, Chắc chắn trúng khi địch yếu | +5% chí mạng |
| 8 | **Ngụy Diên** | Tấn công | ⭐ | **Kỳ phong đột kích**: Tấn công hàng dọc trước 220%, Buff sát thương bản thân 20%, Tăng Xuyên giáp bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Buff ST, Tăng Xuyên giáp, Phản kích đơn | +5% chí mạng |
| 9 | **Khương Duy** | Tấn công | ⭐ | **Kế thừa Khổng Minh**: Tấn công toàn bộ địch 102%, Hút máu đội (cấp×1.5%, max 15%), Buff sát thương bản thân 15% và Tăng Xuyên giáp bản thân 15%. | Hút máu đội, Buff ST, Tăng Xuyên giáp | +5% chí mạng |
| 10 | **Bàng Thống** | Hỗ trợ | ⭐ | **Phượng Sồ liên hoàn**: Tấn công toàn bộ địch 85%, Buff sát thương toàn đội 15% VÀ Tăng đồng thời +15% Chính xác & +15% Né tránh cho toàn đội (3 lượt). | Buff ST, Tăng Chính xác toàn đội, Tăng Né tránh toàn đội | +10% sát thương |
| 11 | **Pháp Chính** | Hỗ trợ | | **Tiên liệu chiến cơ**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15%, Tăng 20% ST chí mạng toàn đội và Tăng Xuyên giáp toàn đội 15% (3 lượt). | Buff ST, Tăng chí mạng, Tăng ST chí mạng, Tăng Xuyên giáp | +10% sát thương |
| 12 | **Từ Thứ** | Hỗ trợ | | **Kiếm hiệp phá trận**: Tấn công hàng ngang 160%, gây Choáng (tỷ lệ cấp×3.5%, max 35%), có 20%-80% tỷ lệ Xóa Khiên các mục tiêu, Giảm Giáp địch 24 (3 lượt) và Tăng 10% Tỷ lệ chí mạng cho đồng minh cùng hàng. | Choáng, Xóa Khiên (20%-80%), Giảm Giáp địch, Tăng chí mạng đồng minh | +10% sát thương |
| 13 | **Hoàng Nguyệt Anh** | Hỗ trợ | | **Cơ quan bát quái**: Tấn công toàn bộ địch 75%, Tăng tỷ lệ chí mạng toàn đội 10% (3 lượt). | Tăng chí mạng | +10% sát thương |
| 14 | **Quan Bình** | Tấn công | | **Thanh Long kế thừa**: Tấn công đơn 260%, Hút máu theo cấp (cấp×2%, max 20%), Buff sát thương bản thân 15%, Tăng Chính xác bản thân 25% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu, Buff ST, Tăng Chính xác, Phản kích đơn | +5% chí mạng |
| 15 | **Quan Hưng** | Tấn công | | **Hưng binh trảm tướng**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng 15% (3 lượt). | Tăng chí mạng | +5% chí mạng |
| 16 | **Mã Đại** | Tấn công | | **Truy kích Tây Lương**: Tấn công hàng dọc trước 200%, có 20%-80% tỷ lệ Xóa Khiên hàng trước địch, Buff sát thương bản thân 15%, Giảm Giáp địch 24 và Giảm 15% Tỷ lệ chí mạng hàng trước địch (3 lượt). | Xóa Khiên (20%-80%), Buff ST, Giảm Giáp địch, Giảm chí mạng địch, +30% ST lên mục tiêu đang debuff | +10% sát thương |
| 17 | **Vương Bình** | Phòng thủ | | **Kiên thủ Hán Trung**: Giảm sát thương nhận vào 25%, Tăng Giáp bản thân +107, Hồi máu 15% HP tối đa mỗi lượt ra đòn VÀ Tạo Khiên cho bản thân & đồng minh cùng hàng bằng 15% HP tối đa (3 lượt). | Giảm ST nhận, Tăng Giáp, Hồi máu, Tạo Khiên đồng minh | +20 Giáp |
| 18 | **Liêu Hóa** | Phòng thủ | | **Lão tướng tiên phong**: Tấn công đơn 270%, Tăng máu tối đa bản thân 15%, Tăng Giáp bản thân +79, Tăng Né tránh bản thân 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Tăng Giáp, Tăng Né tránh, Phản kích đơn | +20 Giáp |
| 19 | **Giản Ung** | Hỗ trợ | | **Du thuyết**: Buff sát thương toàn đội 10% và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Buff ST, Xóa debuff đồng minh | +10% HP |
| 20 | **Mi Trúc** | Hỗ trợ | | **Hậu cần vững chắc**: Hồi máu cho hàng dọc sau (220% ST cơ bản) và Buff sát thương hàng sau 15% (3 lượt). | Hồi máu, Buff ST | +10% HP |
| 21 | **Quan Ngân Bình** | Tấn công | | **Nữ tướng phá quân**: Tấn công đơn 250%, gây Choáng (tỷ lệ cấp×5%, max 50%). | Choáng | +10% sát thương |
| 22 | **Mi Trinh** | Hỗ trợ | | **Tương trợ**: Hồi máu toàn đội (100% ST cơ bản) và Tăng máu tối đa toàn đội 10%. | Hồi máu, Tăng HP max | +10% HP |
| 23 | **Gia Cát Quả** | Hỗ trợ | | **Tiên thuật**: Giảm sát thương nhận vào toàn đội 10% (3 lượt), Tăng Né tránh toàn đội 20% (3 lượt) và Giải choáng/thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Giảm ST nhận, Tăng Né tránh, Giải choáng & thiêu đốt | +10% HP |
| 24 | **Bao Tam Nương** | Tấn công | | **Hoa vũ song đao**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng bản thân 20% và Tăng 20% ST chí mạng (3 lượt). | Tăng chí mạng, Tăng ST chí mạng | +5% chí mạng |
| 25 | **Ngô Ý** | Phòng thủ | | **Trấn thủ Ích Châu**: Giảm sát thương nhận vào 20%, Hồi máu bản thân 15% HP tối đa và Tạo Khiên cho đồng minh thấp HP nhất bằng 15% HP tối đa (3 lượt). | Giảm ST nhận, Hồi máu, Tạo Khiên đồng minh | +20 Giáp |
| 26 | **Đặng Chi** | Hỗ trợ | | **Sứ giả Đông Ngô**: Buff sát thương toàn đội 10%, Tăng Giáp toàn đội +79 VÀ Tạo Khiên cho toàn đội bằng 10% HP tối đa (3 lượt). | Buff ST, Tăng Giáp, Tạo Khiên toàn đội | +10% sát thương |
| 27 | **Trương Tinh Thái** | Phòng thủ | | **Tinh Thái hộ giá**: Tăng máu tối đa toàn đội 10%, Hồi máu bản thân 20% HP tối đa và Giảm sát thương nhận vào 20% bản thân (3 lượt). | Tăng HP max, Hồi máu, Giảm ST nhận | +20 Giáp |
| 28 | **Mã Trung** | Tấn công | | **Kỳ Sơn phục kích**: Tấn công hàng ngang 200%, Tăng tỷ lệ chí mạng bản thân 20%, Tăng 20% ST chí mạng (3 lượt) VÀ Buff 15% Chính xác cho toàn bộ Hàng Sau (3 lượt). | Tăng chí mạng, Tăng ST chí mạng, Tăng Chính xác Hàng Sau | +5% chí mạng |
| 29 | **Phí Y** | Hỗ trợ | | **Hòa mục quân thần**: Hồi máu nhẹ toàn đội (80% ST cơ bản), Tăng 10% HP tối đa cho toàn đội VÀ Tăng 20% Chính xác cho toàn đội (3 lượt). | Hồi máu toàn đội, Tăng HP max, Tăng Chính xác toàn đội | +10% HP |
| 30 | **Tưởng Uyển** | Phòng thủ | | **Trấn an Hán Trung**: Hồi máu bản thân 15% HP tối đa, Giảm sát thương nhận vào 25% (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hồi máu, Giảm ST nhận, Phản kích đơn | +20 Giáp |
| 31 | **Mã Lương** | Hỗ trợ | | **Bạch mi mưu lược**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15% và Tăng Giáp toàn đội +79 (3 lượt). | Buff ST, Tăng chí mạng, Tăng Giáp | +10% sát thương |
| 32 | **La Hiến** | Phòng thủ | | **Cô thủ Vĩnh An**: Tăng máu tối đa bản thân 20%, Tạo Khiên cho bản thân bằng 20% HP tối đa (3 lượt) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Tăng HP max, Tạo Khiên bản thân, Phản kích diện rộng | +20 Giáp |
| 33 | **Lưu Phong** | Tấn công | | **Mãnh hổ xuất trận**: Tấn công đơn 280%, Hút máu theo cấp (cấp×2%, max 20%) và Buff sát thương bản thân 15% (3 lượt). | Hút máu, Buff ST | +5% chí mạng |
| 34 | **Trương Dực** | Phòng thủ | | **Thủ thành bất khuất**: Tấn công hàng ngang 190% và Giảm sát thương các mục tiêu 15% (3 lượt). | Giảm ST địch | +20 Giáp |
| 35 | **Gia Cát Chiêm** | Hỗ trợ | | **Kế thừa phụ nghiệp**: Xóa hiệu ứng bất lợi của đồng minh, có 20%-80% tỷ lệ Xóa Khiên toàn bộ đối thủ, Buff sát thương toàn đội 10% VÀ Giảm 20% Né tránh toàn bộ đối thủ (3 lượt). | Xóa debuff đồng minh, Xóa Khiên (20%-80%), Buff ST, Giảm Né tránh địch | +10% HP |

---

## 4. Phe Ngô (wu) — 35 Tướng (Tier A+)

> **Bản sắc**: Tấn công theo hàng, thiêu đốt dồn lớp (xuyên thủ), hút máu duy trì, khiên bảo hộ và phá khiên chiến thuật.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng | Nội tại |
|---|-------|-----------|-----|---------|------------------|---------|
| 1 | **Tôn Kiên** | Phòng thủ | ⭐ | **Giang Đông mãnh hổ**: Tấn công hàng ngang 200%, Giảm sát thương địch 15%, Tạo Khiên cho đồng minh thấp HP nhất bằng 20% HP tối đa (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Tạo Khiên đồng minh, Phản kích đơn | +20 Giáp |
| 2 | **Tôn Sách** | Phòng thủ | ⭐ | **Tiểu Bá Vương**: Tấn công toàn bộ địch 105%, Hút máu đội (cấp×1.5%, max 15%), Giảm 15% sát thương nhận vào (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu đội, Giảm ST nhận, Phản kích đơn | +20 Giáp |
| 3 | **Tôn Quyền** | Hỗ trợ | ⭐ | **Đế nghiệp Giang Đông**: Buff sát thương toàn đội 15%, Giảm sát thương nhận vào cho toàn đội 10%, Tạo Khiên cho toàn đội 10% HP tối đa và Tăng Chính xác toàn đội 25% (3 lượt). | Buff ST, Giảm ST nhận, Tạo Khiên toàn đội, Tăng Chính xác toàn đội | +10% sát thương |
| 4 | **Chu Du** | Tấn công | ⭐ | **Hỏa thiêu Xích Bích**: Tấn công toàn bộ địch 117%, gây Thiêu đốt toàn bộ địch (duy trì 4 lượt, dồn max 3 lớp). Đòn Thiêu đốt: tăng thêm 30% tỷ lệ chí mạng và 30% ST chí mạng. | Thiêu đốt (4 lượt, dồn 3), Thiêu đốt +30% chí mạng | +5% chí mạng |
| 5 | **Lục Tốn** | Tấn công | ⭐ | **Hỏa kế liên doanh**: Tấn công hàng dọc trước 180%, gây Thiêu đốt hàng trước địch (duy trì 4 lượt, dồn max 3 lớp), Giảm HP tối đa địch 15%. Hút máu 50% hiệu suất áp dụng cho cả đòn Thiêu đốt. | Thiêu đốt (4 lượt, dồn 3), Giảm HP max (5%-15%), Hút máu thiêu đốt | +5% chí mạng |
| 6 | **Lữ Mông** | Phòng thủ | ⭐ | **Bạch y độ giang**: Tấn công đơn 290%, Tăng 10% HP tối đa cho toàn đội (3 lượt) và Tạo Khiên cho bản thân 15% HP tối đa. | Tăng HP max toàn đội, Tạo Khiên bản thân | +20 Giáp |
| 7 | **Hoàng Cái** | Phòng thủ | ⭐ | **Khổ nhục kế**: Tự gây Thiêu đốt bản thân (duy trì 4 lượt, dồn 3 lớp) để Buff sát thương bản thân 30%, Hồi máu 10% HP tối đa, Hút máu theo cấp (cấp×2%, max 20%), Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%) và Hồi sinh (1 lần/trận). | Thiêu đốt bản thân, Buff ST, Hồi máu, Hút máu, Phản kích đơn, Hồi sinh | +20 Giáp |
| 8 | **Trình Phổ** | Phòng thủ | | **Lão tướng trấn quân**: Giảm sát thương nhận vào 20%, Hồi máu bản thân 15% HP tối đa, Tăng Giáp bản thân +79, Tăng Né tránh bản thân 20% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Hồi máu, Tăng Giáp, Tăng Né tránh, Phản kích đơn | +20 Giáp |
| 9 | **Hàn Đương** | Tấn công | | **Cung kỵ hợp kích**: Tấn công hàng dọc sau 160%, Tăng tỷ lệ chí mạng 20%, Tăng 20% ST chí mạng VÀ Tăng Chính xác bản thân 25% (3 lượt). | Tăng chí mạng, Tăng ST chí mạng, Tăng Chính xác | +5% chí mạng |
| 10 | **Thái Sử Từ** | Tấn công | ⭐ | **Thần xạ**: Tấn công đơn hàng sau 300%, Tăng tỷ lệ chí mạng 25% cho phát bắn này, Tăng Chính xác bản thân 35% VÀ Giảm 20% Né tránh của mục tiêu bị trúng đòn (3 lượt). | Tăng chí mạng, Tăng Chính xác, Giảm Né tránh địch | +5% chí mạng |
| 11 | **Cam Ninh** | Tấn công | ⭐ | **Cẩm Phàm tập kích**: Tấn công đơn 265%, Hút máu đặc biệt theo cấp (cấp×9.5%, max 95%), Tăng máu tối đa 10% bản thân và Tăng Né tránh bản thân 15% (3 lượt). | Hút máu 95% (Signature Ngô), Tăng HP max, Tăng Né tránh | +5% chí mạng |
| 12 | **Lăng Thống** | Tấn công | | **Liên kích**: Tấn công hàng ngang 200%, Buff sát thương bản thân 20% (3 lượt). Nếu mục tiêu đang bị Thiêu đốt, Tăng thêm 20% ST chí mạng. | Buff ST, Tăng ST chí mạng chống thiêu đốt | +5% chí mạng |
| 13 | **Chu Thái** | Phòng thủ | | **Hộ chủ bất khuất**: Tăng máu tối đa 20%, Tăng Giáp bản thân +107, Hồi máu 20% HP tối đa cho bản thân và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Tăng Giáp, Hồi máu, Phản kích đơn | +20 Giáp |
| 14 | **Từ Thịnh** | Phòng thủ | | **Giang phòng thiết thủ**: Giảm sát thương nhận vào 25% cho bản thân, Tăng Giáp bản thân +107, Hồi máu 10% HP tối đa và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST nhận, Tăng Giáp, Hồi máu, Phản kích đơn | +20 Giáp |
| 15 | **Đinh Phụng** | Tấn công | | **Tuyết trung đột kích**: Tấn công đơn 270%, gây Choáng mục tiêu (tỷ lệ cấp×3.5%, max 35%) và gây Thiêu đốt (4 lượt). | Choáng, Thiêu đốt, +30% ST lên mục tiêu đang debuff | +10% sát thương |
| 16 | **Chu Hoàn** | Phòng thủ | | **Hỏa công phá trận**: Tấn công hàng ngang 180%, gây Thiêu đốt các mục tiêu (4 lượt). | Thiêu đốt (4 lượt) | +20 Giáp |
| 17 | **Trương Chiêu** | Hỗ trợ | | **Ổn định triều chính**: Giảm sát thương nhận vào cho toàn đội 15% (3 lượt), Tăng Giáp toàn đội +39 (3 lượt) và Hồi máu toàn đội (100% ST cơ bản). | Giảm ST nhận, Tăng Giáp, Hồi máu | +10% HP |
| 18 | **Trương Hoành** | Hỗ trợ | | **Hoành sách**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15% và Tăng Chính xác toàn đội 20% (3 lượt). | Buff ST, Tăng chí mạng, Tăng Chính xác | +10% sát thương |
| 19 | **Lỗ Túc** | Hỗ trợ | ⭐ | **Liên minh Tôn Lưu**: Buff sát thương toàn đội 15%, Tăng máu tối đa toàn đội 10% và Ban hút máu 15% cho toàn đội (2 lượt). | Buff ST, Tăng HP max, Ban hút máu | +10% sát thương |
| 20 | **Tôn Thượng Hương** | Tấn công | | **Kiêu cơ cung vũ**: Tấn công hàng dọc sau 180%, Tăng tỷ lệ chí mạng 25%, Tăng Chính xác bản thân 20% (3 lượt) và gây Thiêu đốt nhẹ (30% ST, 4 lượt). | Tăng chí mạng, Tăng Chính xác, Thiêu đốt nhẹ | +5% chí mạng |
| 21 | **Đại Kiều** | Hỗ trợ | | **Quốc sắc**: Hồi máu toàn đội (110% ST cơ bản) và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Hồi máu, Xóa debuff đồng minh | +10% HP |
| 22 | **Tiểu Kiều** | Hỗ trợ | | **Thiên hương**: Tăng tỷ lệ chí mạng toàn đội 15%, Buff sát thương toàn đội 10% VÀ Tăng 15% Chính xác cho toàn đội (3 lượt). | Tăng chí mạng, Buff ST, Tăng Chính xác toàn đội | +10% sát thương |
| 23 | **Bộ Luyện Sư** | Hỗ trợ | | **Hiền hậu hộ quân**: Hồi máu đồng minh thấp HP nhất (420% ST cơ bản) VÀ Tạo Khiên cho người đó bằng 20% HP tối đa (3 lượt). | Hồi máu đơn, Tạo Khiên đồng minh | +10% HP |
| 24 | **Tôn Lỗ Dục** | Hỗ trợ | | **Hòa giải**: Giải choáng/thiêu đốt cho toàn bộ đồng minh (tỷ lệ 30%-75%), Hồi máu nhẹ toàn đội (60% ST cơ bản) và Tăng Giáp toàn đội +79 (3 lượt). | Giải choáng & thiêu đốt, Hồi máu, Tăng Giáp | +10% HP |
| 25 | **Tôn Lỗ Ban** | Hỗ trợ | | **An định Giang Đông**: Tấn công toàn bộ địch 70%, Giảm máu tối đa của toàn bộ đối thủ 15% và Giảm Giáp toàn bộ địch 39 (3 lượt). | Giảm HP max địch (5%-15%), Giảm Giáp địch | +5% chí mạng |
| 26 | **Chu Phường** | Hỗ trợ | | **Kết trận Giang Đông**: Tấn công toàn bộ địch 75%, Xóa buff có lợi của địch (tỉ lệ cấp×7.5%, max 75%), có 20%-80% tỷ lệ Xóa Khiên toàn bộ đối thủ, Giảm 10% sát thương địch VÀ Giảm 25% Né tránh toàn bộ đối thủ (3 lượt). | Xóa buff địch toàn đội, Xóa Khiên (20%-80%), Giảm ST địch, Giảm Né tránh địch | +5% chí mạng |
| 27 | **Cố Ung** | Hỗ trợ | | **Vận Trù Trợ Hỏa**: Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt) và Giảm 10% sát thương nhận vào cho toàn đội (3 lượt) và buff cho tất cả đồng minh có khả năng thiêu đốt trong 2 lượt (chỉ cộng dồn 2 lần): +10% sát thương Thiêu đốt mỗi lớp (giữ nguyên cộng dồn lớp thiêu đốt của tướng đó). | Xóa debuff đồng minh, Giảm ST nhận toàn đội, Tăng ST Thiêu đốt đồng minh | +10% HP |
| 28 | **Toàn Tông** | Phòng thủ | | **Trùng thành cố thủ**: Hồi máu bản thân 15% HP tối đa, Tạo Khiên cho bản thân bằng 15% HP tối đa (3 lượt) và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Hồi máu, Tạo Khiên bản thân, Phản kích diện rộng | +20 Giáp |
| 29 | **Lữ Đại** | Phòng thủ | | **Bình định sơn Việt**: Tấn công hàng dọc trước 190%, Giảm sát thương địch 10%, Giảm Giáp địch 39 và Giảm tỷ lệ chí mạng địch 10% (3 lượt). | Giảm ST địch, Giảm Giáp địch, Giảm chí mạng | +20 Giáp |
| 30 | **Tôn Hoàn** | Tấn công | | **Hãm trận xung phong**: Tấn công hàng ngang 210% và Buff sát thương bản thân 15% (3 lượt). | Buff ST | +5% chí mạng |
| 31 | **Gia Cát Cẩn** | Hỗ trợ | | **Nhã lượng khoan hồng**: Tạo Khiên cho toàn đội bằng 10% HP tối đa, có 20%-80% tỷ lệ Xóa Khiên toàn bộ đối thủ VÀ Giảm sát thương nhận vào cho toàn đội 10% (3 lượt). | Tạo Khiên toàn đội, Xóa Khiên (20%-80%), Giảm ST nhận | +10% sát thương |
| 32 | **Tôn Phấn** | Tấn công | | **Tôn thất phản công**: Tấn công đơn 275%, có 20%-80% tỷ lệ Xóa Khiên mục tiêu, Giảm tỷ lệ chí mạng mục tiêu 15%, Giảm Giáp địch 24, Tăng tỷ lệ chí mạng bản thân 20% (3 lượt) và +30% ST lên mục tiêu đang debuff. | Xóa Khiên (20%-80%), Giảm chí mạng, Giảm Giáp địch, Tăng chí mạng, +30% ST lên mục tiêu đang debuff | +10% sát thương |
| 33 | **Đặng Đương** | Phòng thủ | | **Thủy chiến phòng ngự**: Tăng máu tối đa bản thân 20%, Tạo Khiên cho bản thân bằng 15% HP tối đa (3 lượt), Giảm 10% ST nhận vào cho đồng minh cùng hàng (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng HP max, Tạo Khiên bản thân, Giảm ST đồng minh, Phản kích đơn | +20 Giáp |
| 34 | **Chu Cứ** | Tấn công | | **Liệt hỏa công thành**: Tấn công hàng ngang 180% và gây Thiêu đốt các mục tiêu (4 lượt). | Thiêu đốt (4 lượt) | +5% chí mạng |
| 35 | **Lục Kháng** | Hỗ trợ | | **Đông Ngô trụ thạch**: Hồi máu toàn đội (80% ST cơ bản), Giải choáng/thiêu đốt cho toàn bộ đồng minh (tỷ lệ 30%-75%) và Giảm sát thương nhận vào cho toàn đội 15% (3 lượt). | Hồi máu, Giải choáng & thiêu đốt, Giảm ST nhận | +10% HP |

---

## 5. Phe Quần Hùng (qun) — 35 Tướng (Tier A+)

> **Bản sắc**: Đa năng đột biến, trảm % HP max đối thủ, hủy diệt bạo phát, tạo khiên/phá khiên và giải hiệu ứng cực tốt.

| # | Tướng | Phong cách | Hot | Kỹ năng | Hiệu ứng áp dụng | Nội tại |
|---|-------|-----------|-----|---------|------------------|---------|
| 1 | **Đổng Trác** | Phòng thủ | ⭐ | **Bạo chúa**: Giảm máu tối đa của toàn bộ đối thủ 15%, Giảm Giáp địch 39, Hồi máu bản thân 20% HP tối đa và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm HP max địch (5%-15%), Giảm Giáp địch, Hồi máu, Phản kích diện rộng | +20 Giáp |
| 2 | **Lữ Bố** | Tấn công | ⭐ | **Vô song**: Tấn công toàn bộ địch 127%, có 3%-30% tỷ lệ Xóa Khiên toàn bộ địch, Tăng tỷ lệ chí mạng bản thân 20%, Tăng 20% ST chí mạng, Tăng Xuyên giáp bản thân 20%, Hút máu theo cấp (cấp×3%, max 30%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Xóa Khiên (3%-30%), Tăng chí mạng, Tăng ST chí mạng, Tăng Xuyên giáp, Hút máu, Phản kích đơn | +5% chí mạng |
| 3 | **Điêu Thuyền** | Hỗ trợ | ⭐ | **Bế nguyệt**: Tấn công **tướng địch có sát thương cao nhất** 120%, gây Choáng (tỷ lệ cấp×10%, max 100%) và Giảm sát thương mục tiêu 20%. | Nhắm tướng địch mạnh nhất, Choáng, Giảm ST địch | +10% sát thương |
| 4 | **Viên Thiệu** | Hỗ trợ | ⭐ | **Thế gia hào tộc**: Tăng máu tối đa toàn đội 15%, Buff sát thương toàn đội 10% và Ban hút máu 15% cho toàn đội (2 lượt). | Tăng HP max, Buff ST, Ban hút máu | +10% sát thương |
| 5 | **Viên Thuật** | Hỗ trợ | | **Trọng thị đế nghiệp**: Giảm máu tối đa hàng trước của đối thủ 15% (3 lượt), Giảm 25% Chính xác hàng trước đối thủ (3 lượt) VÀ Buff 15% Né tránh cho toàn bộ Hàng Trước phe ta (3 lượt). | Giảm HP max địch (5%-15%), Giảm Chính xác địch, Tăng Né tránh Hàng Trước | +5% chí mạng |
| 6 | **Công Tôn Toản** | Tấn công | ⭐ | **Bạch mã nghĩa tùng**: Tấn công đơn hàng sau 175%, Tăng tỷ lệ chí mạng 20%, Tăng Né tránh 20% cho bản thân và đồng minh cùng hàng (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Tăng chí mạng, Tăng Né tránh, Phản kích đơn | +5% chí mạng |
| 7 | **Trương Giác** | Hỗ trợ | ⭐ | **Thái Bình đạo**: Tấn công toàn bộ địch 105%, gây Choáng (tỷ lệ cấp×2%, max 20%), và Thiêu đốt nhẹ (4 lượt). | Choáng, Thiêu đốt | +10% sát thương |
| 8 | **Trương Bảo** | Tấn công | | **Địa công tướng quân**: Tấn công hàng ngang 190%, Giảm 25% Né tránh toàn bộ Hàng Trước đối thủ, Giảm tỷ lệ chí mạng địch 15% và Giảm 20% ST chí mạng địch (3 lượt). | Giảm Né tránh địch, Giảm chí mạng, Giảm ST chí mạng, +30% ST lên mục tiêu đang debuff | +10% sát thương |
| 9 | **Trương Lương** | Tấn công | | **Nhân công tướng quân**: Tấn công hàng dọc trước 190%, Giảm sát thương địch 15% (3 lượt). | Giảm ST địch | +5% chí mạng |
| 10 | **Hoa Hùng** | Tấn công | ⭐ | **Uy chấn Hổ Lao**: Tấn công đơn 290%, Tăng Xuyên giáp bản thân 15%, Hút máu đặc biệt theo cấp (cấp×9%, max 90%) và Tăng máu tối đa 10% bản thân. | Tăng Xuyên giáp, Hút máu 90% (Signature Quần), Tăng HP max | +5% chí mạng |
| 11 | **Cao Thuận** | Phòng thủ | | **Hãm Trận Doanh**: Giảm sát thương nhận vào 25%, Tăng máu tối đa 15% cho bản thân, Tăng Giáp bản thân +107 và Phản kích toàn bộ địch (Nội tại: cấp×3%, max 30%, ST 30%). | Giảm ST nhận, Tăng HP max, Tăng Giáp, Phản kích diện rộng | +20 Giáp |
| 12 | **Trần Cung** | Hỗ trợ | ⭐ | **Mưu định**: Buff sát thương toàn đội 15%, Tăng tỷ lệ chí mạng toàn đội 15%, Tăng 15% ST chí mạng toàn đội, Tăng Xuyên giáp toàn đội 15% VÀ Giải choáng/thiêu đốt cho đồng minh (tỷ lệ 30%-75%). | Buff ST, Tăng chí mạng, Tăng ST chí mạng, Tăng Xuyên giáp, Giải choáng & thiêu đốt | +10% HP |
| 13 | **Nhan Lương** | Phòng thủ | ⭐ | **Danh tướng Hà Bắc**: Tấn công đơn 290%, Hút máu theo cấp (cấp×2.5%, max 25%), Tăng 20% HP max bản thân, Buff sát thương bản thân 15%, Tăng Xuyên giáp bản thân 15% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hút máu, Tăng HP max, Buff ST, Tăng Xuyên giáp, Phản kích đơn | +20 Giáp |
| 14 | **Văn Sú** | Tấn công | ⭐ | **Mãnh tướng Hà Bắc**: Tấn công hàng ngang 220%, Buff sát thương bản thân 20%, Tăng Xuyên giáp bản thân 15%, Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%) và Hồi sinh (1 lần/trận). | Buff ST, Tăng Xuyên giáp, Phản kích đơn, Hồi sinh | +5% chí mạng |
| 15 | **Điền Phong** | Hỗ trợ | | **Trực gián**: Tấn công hàng ngang 140%, Xóa buff có lợi của địch (tỉ lệ cấp×7.5%, max 75%). | Xóa buff địch | +5% chí mạng |
| 16 | **Mạnh Hoạch** | Phòng thủ | | **Viễn mưu**: Tấn công toàn bộ địch 104%, Tăng máu tối đa cho bản thân và đồng minh cùng hàng 15%, Hồi máu 20% HP tối đa cho bản thân. | Tăng HP max đồng minh, Hồi máu | +10% HP |
| 17 | **Mã Đằng** | Tấn công | | **Tây Lương thiết kỵ**: Tấn công hàng dọc trước 200%, Buff sát thương bản thân 15% và Tăng Né tránh bản thân 15% (3 lượt). | Buff ST, Tăng Né tránh | +10% sát thương |
| 18 | **Hàn Toại** | Hỗ trợ | | **Liên hoành**: Giảm sát thương nhận vào cho toàn đội 10% và Xóa hiệu ứng bất lợi của bản thân/đồng minh (bao gồm Thiêu đốt). | Giảm ST nhận, Xóa debuff đồng minh | +10% HP |
| 19 | **Đào Khiêm** | Hỗ trợ | | **Nhân nghĩa Từ Châu**: Hồi máu toàn đội (110% ST cơ bản) và Tăng máu tối đa toàn đội 10%. | Hồi máu, Tăng HP max | +10% HP |
| 20 | **Trương Lỗ** | Hỗ trợ | | **Ngũ Đấu Mễ Đạo**: Hồi máu hàng dọc trước (220% ST cơ bản), Tăng 15% Giảm sát thương cho hàng trước, Xóa hiệu ứng bất lợi VÀ Tăng 20% Né tránh cho toàn bộ Hàng Trước (3 lượt). | Hồi máu, Giảm ST hàng trước, Xóa debuff, Tăng Né tránh Hàng Trước | +10% HP |
| 21 | **Thái Văn Cơ** | Hỗ trợ | | **Bi ca**: Hồi máu toàn bộ đồng minh (110% ST cơ bản), Buff sát thương cho toàn đội 10% và Tăng Giáp toàn đội +79 (3 lượt). | Hồi máu toàn đội, Buff ST, Tăng Giáp | +10% HP |
| 22 | **Trâu Ngọc** | Hỗ trợ | | **Mị ảnh**: Tấn công đơn 120%, gây Choáng mục tiêu (tỷ lệ cấp×10%, max 100%). | Choáng | +10% HP |
| 23 | **Chúc Dung** | Tấn công | | **Phi đao Nam Man**: Tấn công hàng ngang 180%, gây Thiêu đốt hàng ngang địch (4 lượt). | Thiêu đốt (4 lượt) | +10% HP |
| 24 | **Đổng Bạch** | Tấn công | | **Quý tộc tàn bạo**: Tấn công đơn 280%, Giảm máu tối đa mục tiêu 15% (3 lượt). | Giảm HP max địch (5%-15%) | +10% HP |
| 25 | **Trương Xuân Hoa** | Hỗ trợ | | **Lãnh tâm**: Tạo Khiên cho đồng minh thấp HP nhất bằng 20% HP tối đa, có 20%-80% tỷ lệ Xóa Khiên mục tiêu VÀ Giảm 20% sát thương nhận vào của người đó (3 lượt). | Tạo Khiên đồng minh, Xóa Khiên (20%-80%), Giảm ST nhận | +10% HP |
| 26 | **Lý Thôi** | Tấn công | | **Lương Châu mãnh tướng**: Tấn công đơn 275%, Hút máu theo cấp (cấp×2%, max 20%), Tăng tỷ lệ chí mạng bản thân 20% VÀ Tăng Chính xác bản thân 30% (3 lượt). | Hút máu, Tăng chí mạng, Tăng Chính xác | +10% HP |
| 27 | **Quách Dĩ** | Phòng thủ | | **Tây Lương hung bạo**: Tấn công hàng dọc trước 200%, Giảm sát thương các mục tiêu 15% (3 lượt) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Giảm ST địch, Phản kích đơn | +10% HP |
| 28 | **Cát Huyền** | Hỗ trợ | | **Đan đạo huyền công**: Hồi máu theo lượt cho toàn đội (50% ST cơ bản mỗi lượt, duy trì 3 lượt) VÀ Buff sát thương toàn đội 10% (3 lượt). | Hồi máu theo lượt (HoT), Buff ST | +10% HP |
| 29 | **Thẩm Phối** | Phòng thủ | | **Tử thủ Nghiệp Thành**: Hồi máu bản thân 15% HP tối đa, Tạo Khiên cho bản thân bằng 15% HP tối đa, Tăng Né tránh bản thân 25% và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Hồi máu, Tạo Khiên bản thân, Tăng Né tránh, Phản kích đơn | +10% HP |
| 30 | **Hứa Du** | Hỗ trợ | | **Hiến kế Ô Sào**: Giảm máu tối đa toàn bộ đối thủ 15%, Giảm Giáp toàn bộ địch 39 VÀ có 20%-80% tỷ lệ Xóa Khiên toàn bộ đối thủ. | Giảm HP max địch (5%-15%), Giảm Giáp địch, Xóa Khiên (20%-80%) | +10% HP |
| 31 | **Tả Từ** | Hỗ trợ | | **Kỳ môn độn giáp**: Hồi máu toàn đội (100% ST cơ bản), Buff sát thương toàn đội 10%, Tăng tỷ lệ chí mạng toàn đội 10% và Tăng Né tránh toàn đội 15% (3 lượt). | Hồi máu, Buff ST, Tăng chí mạng, Tăng Né tránh | +10% HP |
| 32 | **Thủy Kính** | Hỗ trợ | | **Thủy Kính tiên sinh**: Tạo Khiên cho toàn đội bằng 15% HP tối đa, Buff sát thương toàn đội 10%, Tăng Giáp toàn đội +79 (3 lượt) và có khả năng Giải choáng. | Tạo Khiên toàn đội, Buff ST, Tăng Giáp, Giải choáng | +10% HP |
| 33 | **Hoa Đà** | Hỗ trợ | | **Thần y tế thế**: Hồi máu đồng minh thấp HP nhất (420% ST cơ bản), Giảm sát thương nhận vào của người đó 15% (3 lượt) và Xóa toàn bộ hiệu ứng bất lợi của người đó (kể cả Choáng/Thiêu đốt — tỷ lệ giải 55%→100% theo cấp). | Hồi máu đơn, Giảm ST nhận, Xóa debuff (kể cả choáng & thiêu đốt) | +10% HP |
| 34 | **Kỷ Linh** | Tấn công | | **Tam tiêm đao**: Tấn công toàn bộ địch 100%, Hút máu đội (cấp×1.5%, max 15%) và Tăng tỷ lệ chí mạng bản thân 25% (3 lượt). | Hút máu đội, Tăng chí mạng | +10% HP |
| 35 | **Nghiêm Bạch Hổ** | Phòng thủ | | **Sơn tặc chi vương**: Tấn công đơn 230%, gây Choáng (tỷ lệ cấp×3%, max 30%) và Phản kích đơn mục tiêu (Nội tại: cấp×3%, max 30%, ST 50%). | Choáng, Phản kích đơn | +10% HP |