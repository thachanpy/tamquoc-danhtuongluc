/**
 * Bộ dựng DOM tối giản thay cho JSX của SolidJS.
 *
 * Chỉ cần đúng những gì các trang dùng: tạo thẻ, gắn class/thuộc tính/sự kiện, thêm con.
 * Nhờ vậy phần giao diện giữ nguyên cấu trúc class như bản cũ nên `style.css`/`theme.css`
 * port sang vẫn khớp.
 */

export type Child = Node | string | number | null | undefined | false;

export type Props = {
  class?: string;
  /** Class bật/tắt theo điều kiện — tương đương `classList` của bản cũ. */
  classOn?: Record<string, boolean | undefined>;
  text?: string | number;
  /** Nội dung HTML thô — CHỈ dùng với chuỗi do mình kiểm soát. */
  html?: string;
  /** Thuộc tính HTML (VD `title`, `type`, `href`, `data-*`). */
  attrs?: Record<string, string | number | boolean | null | undefined>;
  /** Sự kiện: khóa là tên không có tiền tố `on` (VD `click`, `input`). */
  on?: Record<string, (ev: Event) => void>;
  style?: Partial<CSSStyleDeclaration>;
};

/** Thêm một con vào thẻ (bỏ qua null/undefined/false). */
export function append(parent: Node, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
}

/** Tạo một phần tử DOM với class/thuộc tính/sự kiện/con. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.classOn) {
      for (const [name, on] of Object.entries(props.classOn)) if (on) el.classList.add(name);
    }
    if (props.text !== undefined) el.textContent = String(props.text);
    if (props.html !== undefined) el.innerHTML = props.html;
    if (props.attrs) {
      for (const [k, v] of Object.entries(props.attrs)) {
        if (v === null || v === undefined || v === false) continue;
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (props.on) {
      for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn);
    }
    if (props.style) Object.assign(el.style, props.style);
  }
  append(el, ...children);
  return el;
}

/** Xoá toàn bộ con của một phần tử. */
export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Thay toàn bộ nội dung của `host` bằng các phần tử mới. */
export function render(host: Element, ...children: Child[]): void {
  clear(host);
  append(host, ...children);
}
