import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { LeaderboardDto, LeaderboardEntryDto } from '@tq/shared';
import { api } from '../api.ts';
import { levelTier } from '../art.ts';

const num = (n: number) => n.toLocaleString('vi-VN');
const time = (iso: string) => new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

function RankBadge(props: { rank: number | null }) {
  const medal = () => props.rank !== null && props.rank <= 3;
  return <span class={`lb-rank ${medal() ? `medal m${props.rank}` : ''}`}>{props.rank ?? '–'}</span>;
}

/** Level cao nhất (màu bậc khung) + số thẻ. */
function Meta(props: { maxLevel: number | null; cardCount: number }) {
  return (
    <span class="lb-meta">
      <Show when={props.maxLevel}>
        {(lv) => (
          <>
            <b style={{ color: levelTier(lv()).css }}>Lv.{lv()}</b>
            {' · '}
          </>
        )}
      </Show>
      {num(props.cardCount)} thẻ
    </span>
  );
}

function Row(props: { e: LeaderboardEntryDto }) {
  const podium = () => props.e.rank !== null && props.e.rank <= 3;
  return (
    <div class={`lb-row ${props.e.isMe ? 'me' : ''} ${podium() ? `podium p${props.e.rank}` : ''}`} data-me={props.e.isMe ? '' : undefined}>
      <RankBadge rank={props.e.rank} />
      <span class="lb-name">
        {props.e.username}
        <Show when={props.e.isMe}>
          {' '}
          <span class="lb-you">Bạn</span>
        </Show>
      </span>
      <Meta maxLevel={props.e.maxLevel} cardCount={props.e.cardCount} />
      <b class="lb-power">{num(props.e.power)}</b>
    </div>
  );
}

/**
 * Bảng xếp hạng Lực chiến (mục 6.6). Chỉ hiển thị dữ liệu server tính sẵn.
 * Khung danh sách cao vừa top 10; cuộn trong khung để xem tới top 100. Hạng của mình luôn hiện phía trên.
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
    const d = data();
    if (!d) return '';
    const lv = d.powerByLevel;
    return (
      `Lực chiến = tổng điểm các thẻ đang có, mỗi tướng + cấp chỉ tính 1 lần (5 thẻ Tào Tháo Lv.5 tính như 1): Lv.1 = ${lv[1]} · Lv.2 = ${lv[2]} · Lv.3 = ${lv[3]} · … · Lv.10 = ${num(lv[10] ?? 0)}. ` +
      `Ghép thẻ lên level cao để leo hạng. Đồng điểm thì đồng hạng. Không tính tài khoản quản trị.`
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

      {/* Hạng của mình */}
      <div class="lb-me" aria-live="polite">
        <Show when={data()}>
          {(d) => (
            <Show when={d().me} fallback={<div class="lb-me-box muted">Tài khoản quản trị không tham gia xếp hạng.</div>}>
              {(me) => (
                <Show
                  when={me().rank !== null}
                  fallback={
                    <div class="lb-me-box">
                      <b>Bạn chưa có thẻ nào</b> — quay thẻ để có tên trên bảng xếp hạng.
                    </div>
                  }
                >
                  <div class="lb-me-box">
                    <span class="muted small">Hạng của bạn</span>
                    <div class="lb-row me">
                      <RankBadge rank={me().rank} />
                      <span class="lb-name">{me().username}</span>
                      <Meta maxLevel={me().maxLevel} cardCount={me().cardCount} />
                      <b class="lb-power">{num(me().power)}</b>
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
    </section>
  );
}
