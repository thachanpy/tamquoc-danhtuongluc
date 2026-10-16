import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { LeaderboardDto, LeaderboardEntryDto } from '@tq/shared';
import { api } from '../api.ts';
import { setPvpTarget } from '../state.ts';
import { Avatar } from '../components/Avatar.tsx';

const num = (n: number) => n.toLocaleString('vi-VN');
const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

/** Mở Đấu trường với đối thủ đã chọn (#pvp/<id>, mục 6.7). */
function challenge(id: number) {
  setPvpTarget(id);
  location.hash = `pvp/${id}`;
}

/**
 * Huy hiệu hạng (ảnh trống chữ do chủ dự án cung cấp, public/theme/rank/r1..r4.png):
 * hạng 1, 2, 3 mỗi hạng một huy hiệu riêng; hạng 4 trở đi dùng chung r4. Số hạng do app ghi giữa mặt huy hiệu.
 */
function RankBadge(props: { rank: number | null }) {
  return (
    <Show when={props.rank} fallback={<span class="lb-rank none">–</span>}>
      {(r) => {
        const tier = () => (r() <= 3 ? r() : 4);
        const digits = () => String(r()).length;
        return (
          <span class={`lb-rank rk-${tier()}`} aria-label={`Hạng ${r()}`}>
            <img src={`/theme/rank/r${tier()}.png`} alt="" decoding="async" />
            <b class={`lb-rank-no ${digits() >= 4 ? 'd4' : digits() === 3 ? 'd3' : ''}`}>{r()}</b>
          </span>
        );
      }}
    </Show>
  );
}

function Row(props: { e: LeaderboardEntryDto }) {
  const podium = () => props.e.rank !== null && props.e.rank <= 3;
  const canFight = () => !props.e.isMe;
  return (
    <div
      class={`lb-row ${props.e.isMe ? 'me' : ''} ${podium() ? `podium p${props.e.rank}` : ''}`}
      classList={{ clickable: canFight() }}
      data-me={props.e.isMe ? '' : undefined}
      role={canFight() ? 'button' : undefined}
      tabIndex={canFight() ? 0 : undefined}
      title={canFight() ? `Khiêu chiến ${props.e.displayName}` : undefined}
      onClick={() => canFight() && challenge(props.e.id)}
      onKeyDown={(e) => {
        if (canFight() && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          challenge(props.e.id);
        }
      }}
    >
      <RankBadge rank={props.e.rank} />
      <span class="lb-name">
        <Avatar avatar={props.e.avatar} name={props.e.displayName} class="lb-avatar" />
        <span class="lb-name-text">{props.e.displayName}</span>
        <Show when={props.e.isMe}>
          {' '}
          <span class="lb-you">Bạn</span>
        </Show>
      </span>
      <b class="lb-power">{num(props.e.lc)}</b>
      <Show when={canFight()}>
        <span class="lb-fight" aria-hidden="true">
          ⚔
        </span>
      </Show>
    </div>
  );
}

/**
 * Bảng xếp hạng Lực chiến (mục 6.6). Chỉ hiển thị dữ liệu server tính sẵn.
 * Khung danh sách cao vừa top 10; cuộn trong khung để xem tới top 100. Hạng của mình hiện ở cuối bảng.
 */
export function LeaderboardPage() {
  let alive = true;
  onCleanup(() => (alive = false));
  let listEl!: HTMLDivElement;
  const [data, setData] = createSignal<LeaderboardDto | null>(null);
  const [error, setError] = createSignal('');
  const [loading, setLoading] = createSignal(false);

  async function load() {
    if (loading()) return;
    setLoading(true);
    try {
      const d = await api.leaderboard();
      if (!alive) return;
      setError('');
      setData(d);
      listEl.scrollTop = 0;
    } catch (e) {
      if (alive) setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const gotoMe = () => {
    const mine = listEl.querySelector<HTMLElement>('[data-me]');
    if (mine) listEl.scrollTo({ top: mine.offsetTop - listEl.clientHeight / 2 + mine.offsetHeight / 2, behavior: 'smooth' });
  };

  onMount(() => void load());

  const rule = () => {
    if (!data()) return '';
    return (
      `Lực chiến = TỔNG Lực chiến (LC) của đội hình đang dùng: cộng LC từng tướng theo cấp (đội đã lưu, hoặc đội tự động 6 tướng mạnh nhất nếu chưa lưu). ` +
      `Nâng cấp tướng trong đội để leo hạng. Đồng Lực chiến thì đồng hạng. Bấm vào một người chơi để khiêu chiến ở Đấu trường.`
    );
  };

  return (
    <section class="panel lb-panel">
      <div class="lb-head">
        <h2>Bảng xếp hạng · Lực chiến</h2>
        <button class="btn ghost small" disabled={loading()} onClick={() => void load()}>
          Làm mới
        </button>
      </div>
      <p class="muted small lb-rule">{rule()}</p>

      {/* Danh sách: top 10 nổi bật, sau đó vạch chia rồi tới top 100 */}
      <div class="lb-list" ref={listEl} tabIndex={0} aria-label="Bảng xếp hạng">
        <Show
          when={!error()}
          fallback={<div class="state-msg error">{error()}</div>}
        >
          <Show when={data()} fallback={<div class="state-msg">Đang tải bảng xếp hạng…</div>}>
            {(d) => (
              <Show when={d().items.length} fallback={<div class="state-msg">Chưa có người chơi nào được xếp hạng.</div>}>
                <For each={d().items.slice(0, d().top)}>{(e) => <Row e={e} />}</For>
                <Show when={d().items.length > d().top}>
                  <div class="lb-divider">
                    Top {d().top + 1}–{d().items.length} · cuộn để xem
                  </div>
                  <For each={d().items.slice(d().top)}>{(e) => <Row e={e} />}</For>
                </Show>
              </Show>
            )}
          </Show>
        </Show>
      </div>
      <div class="muted small lb-foot">
        {/* Biểu thức JSX (không phải chuỗi trả thẳng từ callback) để cập nhật khi bấm Làm mới */}
        <Show when={data()}>{(d) => <>{`${num(d().totalRanked)} người chơi được xếp hạng · cập nhật lúc ${time(d().generatedAt)}`}</>}</Show>
      </div>

      {/* Hạng của mình — đặt cuối bảng */}
      <div class="lb-me" aria-live="polite">
        <Show when={data()}>
          {(d) => (
            <Show when={d().me} fallback={<div class="lb-me-box muted">Tài khoản quản trị không tham gia xếp hạng.</div>}>
              {(me) => (
                <Show
                  when={me().rank !== null}
                  fallback={
                    <div class="lb-me-box">
                      <b>Bạn chưa có tướng nào</b> — quay thẻ và xếp đội để có tên trên bảng xếp hạng.
                    </div>
                  }
                >
                  <div class="lb-me-box">
                    <span class="muted small">Hạng của bạn</span>
                    <div class="lb-row me">
                      <RankBadge rank={me().rank} />
                      <span class="lb-name">
                        <Avatar avatar={me().avatar} name={me().displayName} class="lb-avatar" />
                        <span class="lb-name-text">{me().displayName}</span>
                      </span>
                      <b class="lb-power">{num(me().lc)}</b>
                    </div>
                    <Show when={d().items.some((e) => e.isMe) && (me().rank ?? 0) > d().top}>
                      <button class="btn ghost small" onClick={gotoMe}>
                        Xem vị trí của tôi
                      </button>
                    </Show>
                    <Show when={!d().items.some((e) => e.isMe)}>
                      <span class="muted small">Ngoài top {d().items.length}.</span>
                    </Show>
                  </div>
                </Show>
              )}
            </Show>
          )}
        </Show>
      </div>
    </section>
  );
}
