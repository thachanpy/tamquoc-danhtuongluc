import { iconSvg, type IconId } from '../icons.ts';

/**
 * Icon hiệu ứng chiến đấu ở giao diện DOM (đơn sắc, ăn theo `currentColor` của chỗ đặt).
 * Dùng chung chuỗi SVG với sân đấu PixiJS — xem `drawIcon` trong `pixi/arena.ts`.
 */
export function StatIcon(props: { id: IconId; size?: number }) {
  const size = () => props.size ?? 12;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size()}
      height={size()}
      innerHTML={iconSvg(props.id, 'currentColor')}
      aria-hidden="true"
    />
  );
}
