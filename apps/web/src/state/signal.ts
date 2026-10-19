/**
 * Reactive tối giản thay cho `createSignal` của SolidJS.
 *
 * Chỉ giữ đúng phần cần dùng: một ô giá trị + danh sách người nghe. Lớp UI DOM (Bước 5) đăng ký
 * qua `effect` để tự vẽ lại khi state đổi; các Scene Phaser đọc trực tiếp bằng `.get()`.
 */

type Dep = Set<() => void>;

type Runner = { fn: () => void; deps: Set<Dep> };

/** Effect đang chạy — để `signal().get()` tự ghi nhận phụ thuộc. */
let running: Runner | null = null;

export type ReadonlySignal<T> = {
  get(): T;
  /** Đăng ký nghe thay đổi; trả về hàm hủy đăng ký. */
  subscribe(fn: () => void): () => void;
};

export type Signal<T> = ReadonlySignal<T> & { set(value: T): void };

export function signal<T>(initial: T): Signal<T> {
  let value = initial;
  const subs: Dep = new Set();
  return {
    get(): T {
      if (running) {
        subs.add(running.fn);
        running.deps.add(subs);
      }
      return value;
    },
    set(next: T): void {
      if (Object.is(next, value)) return;
      value = next;
      // Lặp trên bản sao: người nghe có thể tự hủy/đăng ký thêm trong lúc chạy.
      for (const fn of [...subs]) fn();
    },
    subscribe(fn: () => void): () => void {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/** Chỉ-đọc hoá một signal để nơi khác không ghi đè ngoài ý muốn. */
export const readonly = <T>(s: Signal<T>): ReadonlySignal<T> => ({ get: () => s.get(), subscribe: s.subscribe });

/**
 * Chạy `fn` ngay và chạy lại mỗi khi bất kỳ signal nào nó đọc thay đổi.
 * Trả về hàm hủy — gọi khi Scene/trang bị đóng để không rò rỉ người nghe.
 */
export function effect(fn: () => void): () => void {
  const deps = new Set<Dep>();
  const runner: Runner = {
    deps,
    fn: () => {
      // Bỏ phụ thuộc của lượt chạy trước rồi ghi nhận lại từ đầu (tránh giữ nhầm nhánh đã rẽ khác).
      for (const d of deps) d.delete(runner.fn);
      deps.clear();
      const prev = running;
      running = runner;
      try {
        fn();
      } finally {
        running = prev;
      }
    },
  };
  runner.fn();
  return () => {
    for (const d of deps) d.delete(runner.fn);
    deps.clear();
  };
}
