import type { PvpStyle } from '@tq/shared';

/**
 * Icon định danh phong cách chiến đấu (đơn sắc, ăn theo `currentColor`):
 * - Tấn công = kiếm dựng đứng
 * - Phòng thủ = khiên
 * - Hỗ trợ = sách mở
 * Là nguồn duy nhất cho mọi chỗ hiển thị phong cách ở giao diện DOM (sân đấu Phaser vẽ
 * cùng hình dạng bằng vector — xem phần arena).
 */
const PATHS: Record<PvpStyle, string> = {
  // Lưỡi kiếm nhọn hướng lên + đốc ngang + chuôi + núm
  attack:
    '<polygon points="6.5,0.4 8.3,2.6 8.3,7.6 4.7,7.6 4.7,2.6"/>' +
    '<rect x="2.6" y="7.8" width="7.8" height="1.6"/>' +
    '<rect x="5.6" y="9.4" width="1.8" height="2.1"/>' +
    '<circle cx="6.5" cy="12.1" r="1.1"/>',
  // Khiên: vai vuông hai bên, thót nhọn xuống đáy
  defense: '<polygon points="6.5,0.5 12,2.5 12,6.3 6.5,12.6 1,6.3 1,2.5"/>',
  // Sách mở: hai trang đối xứng qua gáy
  support:
    '<polygon points="0.7,2.3 3.2,1.1 6.1,2.5 6.1,11.9 3.2,10.6 0.7,11.9"/>' +
    '<polygon points="12.3,2.3 9.8,1.1 6.9,2.5 6.9,11.9 9.8,10.6 12.3,11.9"/>',
};

/** Tạo thẻ SVG của phong cách chiến đấu (mặc định Hỗ trợ nếu lạ). */
export function styleIcon(style: PvpStyle, size = 13): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 13 13');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[style] ?? PATHS.support;
  return svg;
}
