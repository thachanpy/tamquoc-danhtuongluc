import type { Faction, GeneralDto } from '@tq/shared';

/**
 * Roster chính thức MVP — 100 tướng, 25 tướng mỗi phe (CLAUDE.md mục 3.1).
 * ID là slug ASCII ổn định, KHÔNG đổi ID khi sửa metadata.
 * artKey hiện trỏ tới placeholder; thay artwork bằng cách map artKey -> ảnh.
 */
/** Số tướng mỗi phe và tổng roster — dùng cho validate, test và UI. */
export const GENERALS_PER_FACTION = 25;
export const ROSTER_SIZE = GENERALS_PER_FACTION * 4;

type RosterRow = readonly [id: string, name: string];

const WEI: RosterRow[] = [
  ['cao-cao', 'Tào Tháo'],
  ['cao-pi', 'Tào Phi'],
  ['cao-ren', 'Tào Nhân'],
  ['cao-hong', 'Tào Hồng'],
  ['cao-zhen', 'Tào Chân'],
  ['xiahou-dun', 'Hạ Hầu Đôn'],
  ['xiahou-yuan', 'Hạ Hầu Uyên'],
  ['zhang-liao', 'Trương Liêu'],
  ['yue-jin', 'Nhạc Tiến'],
  ['yu-jin', 'Vu Cấm'],
  ['zhang-he', 'Trương Cáp'],
  ['xu-huang', 'Từ Hoảng'],
  ['dian-wei', 'Điển Vi'],
  ['xu-chu', 'Hứa Chử'],
  ['guo-jia', 'Quách Gia'],
  ['xun-yu', 'Tuân Úc'],
  ['xun-you', 'Tuân Du'],
  ['jia-xu', 'Giả Hủ'],
  ['sima-yi', 'Tư Mã Ý'],
  ['pang-de', 'Bàng Đức'],
  ['zhen-ji', 'Chân Cơ'],
  ['bian-yuer', 'Biện Ngọc Nhi'],
  ['cao-hua', 'Tào Hoa'],
  ['cao-jie', 'Tào Tiết'],
  ['xin-xianying', 'Tân Hiến Anh'],
];

const SHU: RosterRow[] = [
  ['liu-bei', 'Lưu Bị'],
  ['guan-yu', 'Quan Vũ'],
  ['zhang-fei', 'Trương Phi'],
  ['zhuge-liang', 'Gia Cát Lượng'],
  ['zhao-yun', 'Triệu Vân'],
  ['ma-chao', 'Mã Siêu'],
  ['huang-zhong', 'Hoàng Trung'],
  ['wei-yan', 'Ngụy Diên'],
  ['jiang-wei', 'Khương Duy'],
  ['pang-tong', 'Bàng Thống'],
  ['fa-zheng', 'Pháp Chính'],
  ['xu-shu', 'Từ Thứ'],
  ['huang-yueying', 'Hoàng Nguyệt Anh'],
  ['guan-ping', 'Quan Bình'],
  ['guan-xing', 'Quan Hưng'],
  ['ma-dai', 'Mã Đại'],
  ['wang-ping', 'Vương Bình'],
  ['liao-hua', 'Liêu Hóa'],
  ['jian-yong', 'Giản Ung'],
  ['mi-zhu', 'Mi Trúc'],
  ['guan-yinping', 'Quan Ngân Bình'],
  ['mi-zhen', 'Mi Trinh'],
  ['zhuge-guo', 'Gia Cát Quả'],
  ['bao-sanniang', 'Bao Tam Nương'],
  ['wu-yi', 'Ngô Ý'],
];

const WU: RosterRow[] = [
  ['sun-jian', 'Tôn Kiên'],
  ['sun-ce', 'Tôn Sách'],
  ['sun-quan', 'Tôn Quyền'],
  ['zhou-yu', 'Chu Du'],
  ['lu-xun', 'Lục Tốn'],
  ['lu-meng', 'Lữ Mông'],
  ['huang-gai', 'Hoàng Cái'],
  ['cheng-pu', 'Trình Phổ'],
  ['han-dang', 'Hàn Đương'],
  ['taishi-ci', 'Thái Sử Từ'],
  ['gan-ning', 'Cam Ninh'],
  ['ling-tong', 'Lăng Thống'],
  ['zhou-tai', 'Chu Thái'],
  ['xu-sheng', 'Từ Thịnh'],
  ['ding-feng', 'Đinh Phụng'],
  ['zhu-huan', 'Chu Hoàn'],
  ['zhang-zhao', 'Trương Chiêu'],
  ['zhang-hong', 'Trương Hoành'],
  ['lu-su', 'Lỗ Túc'],
  ['sun-shangxiang', 'Tôn Thượng Hương'],
  ['da-qiao', 'Đại Kiều'],
  ['xiao-qiao', 'Tiểu Kiều'],
  ['bu-lianshi', 'Bộ Luyện Sư'],
  ['sun-luyu', 'Tôn Lỗ Dục'],
  ['sun-luban', 'Tôn Lỗ Ban'],
];

const QUN: RosterRow[] = [
  ['dong-zhuo', 'Đổng Trác'],
  ['lu-bu', 'Lữ Bố'],
  ['diao-chan', 'Điêu Thuyền'],
  ['yuan-shao', 'Viên Thiệu'],
  ['yuan-shu', 'Viên Thuật'],
  ['gongsun-zan', 'Công Tôn Toản'],
  ['zhang-jiao', 'Trương Giác'],
  ['zhang-bao', 'Trương Bảo'],
  ['zhang-liang', 'Trương Lương'],
  ['hua-xiong', 'Hoa Hùng'],
  ['gao-shun', 'Cao Thuận'],
  ['chen-gong', 'Trần Cung'],
  ['yan-liang', 'Nhan Lương'],
  ['wen-chou', 'Văn Sú'],
  ['tian-feng', 'Điền Phong'],
  ['meng-huo', 'Mạnh Hoạch'],
  ['ma-teng', 'Mã Đằng'],
  ['han-sui', 'Hàn Toại'],
  ['tao-qian', 'Đào Khiêm'],
  ['zhang-lu', 'Trương Lỗ'],
  ['cai-wenji', 'Thái Văn Cơ'],
  ['zou-yu', 'Trâu Ngọc'],
  ['zhurong', 'Chúc Dung'],
  ['dong-bai', 'Đổng Bạch'],
  ['zhang-chunhua', 'Trương Xuân Hoa'],
];

function build(faction: Faction, rows: RosterRow[]): GeneralDto[] {
  return rows.map(([id, name]) => ({ id, name, faction, artKey: id }));
}

export const ROSTER: readonly GeneralDto[] = Object.freeze([
  ...build('wei', WEI),
  ...build('shu', SHU),
  ...build('wu', WU),
  ...build('qun', QUN),
]);

export const GENERALS_BY_ID: ReadonlyMap<string, GeneralDto> = new Map(ROSTER.map((g) => [g.id, g]));
