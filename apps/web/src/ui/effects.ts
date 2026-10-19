/**
 * Hiệu ứng nền trang trí (tia lửa 4 màu phe bay lên) — port từ `main.tsx` bản cũ.
 * Chỉ là hiệu ứng hình ảnh, không ảnh hưởng dữ liệu và không bắt sự kiện chuột.
 */
export function addSparks(count = 40): void {
  const colors = ['#60a5fa', '#4ade80', '#f87171', '#fbbf24', '#fef08a'];
  const box = document.createElement('div');
  box.className = 'sparks';
  box.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    s.className = 'spark';
    const size = Math.random() * 4 + 2;
    const c = colors[Math.floor(Math.random() * colors.length)]!;
    s.style.cssText = `width:${size}px;height:${size}px;left:${Math.random() * 100}vw;background:${c};box-shadow:0 0 10px ${c};animation-duration:${Math.random() * 4 + 4}s;animation-delay:${Math.random() * 5}s`;
    box.appendChild(s);
  }
  document.body.prepend(box);
}
