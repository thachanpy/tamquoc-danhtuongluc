import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  FACTIONS,
  FACTION_LABELS,
  TICKET_LABELS,
  TICKET_TYPES,
  type AchievementGroupDto,
  type LoginDayDto,
  type QuestItemDto,
  type QuestsDto,
  type TicketType,
} from '@tq/shared';
import { api, type ApiError } from '../api.ts';
import { setQuestBadge, setTickets } from '../state.ts';

type Sub = 'daily' | 'login' | 'ach';
const SUB_LABEL: Record<Sub, string> = { daily: 'Hằng ngày', login: 'Điểm danh', ach: 'Thành tựu' };

const num = (n: number) => n.toLocaleString('vi-VN');
const cd = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((x) => String(x).padStart(2, '0')).join(':');
};

function RewardChip(props: { pool: TicketType; count: number }) {
  return (
    <span class={`tb t-${props.pool} q-reward`}>
      +{num(props.count)} {TICKET_LABELS[props.pool]}
    </span>
  );
}

const Bar = (props: { progress: number; target: number }) => (
  <div class="q-bar" role="progressbar" aria-valuemin="0" aria-valuemax={props.target} aria-valuenow={props.progress}>
    <i style={{ width: `${Math.round((props.progress / props.target) * 100)}%` }} />
  </div>
);

/**
 * Trang Nhiệm vụ (mục 3.10): nhiệm vụ hằng ngày (chung + theo phe), điểm danh theo tháng, thành tựu.
 * Chỉ hiển thị trạng thái server tính; bấm Nhận gửi khoá phần thưởng, server kiểm tra lại và cộng vé.
 */
export function QuestsPage() {
  let alive = true;
  const [data, setData] = createSignal<QuestsDto | null>(null);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [sub, setSub] = createSignal<Sub>('daily');
  const [msg, setMsg] = createSignal<{ ok: true; count: number; parts: [TicketType, number][] } | { ok: false; text: string } | null>(null);
  const [now, setNow] = createSignal(performance.now());
  let nextResetLocal = 0;

  async function load() {
    try {
      const d = await api.quests();
      if (!alive) return;
      nextResetLocal = performance.now() + (Date.parse(d.nextResetAt) - Date.now());
      setError('');
      setData(d);
      setQuestBadge(d.claimable);
    } catch (e) {
      if (alive) setError((e as Error).message);
    }
  }

  async function claim(keys?: string[]) {
    if (busy()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.claimQuests(keys);
      if (!alive) return;
      setTickets(r.balances);
      const sum = new Map<TicketType, number>();
      for (const c of r.claimed) sum.set(c.pool, (sum.get(c.pool) ?? 0) + c.count);
      setMsg({ ok: true, count: r.claimed.length, parts: [...sum] });
    } catch (e) {
      if (alive) setMsg({ ok: false, text: (e as ApiError).message });
    } finally {
      setBusy(false);
      if (alive) await load();
    }
  }

  // Đồng hồ đến 05:00; tới giờ thì tải lại (server xử lý ngày mới khi nhận request)
  const timer = window.setInterval(() => {
    if (!data()) return;
    setNow(performance.now());
    if (nextResetLocal - performance.now() < -1500 && !busy()) {
      nextResetLocal = performance.now() + 60_000; // tránh gọi dồn
      void load();
    }
  }, 1000);
  onCleanup(() => {
    alive = false;
    clearInterval(timer);
  });
  onMount(() => void load());

  const counts = createMemo(() => {
    const d = data();
    if (!d) return { daily: 0, login: 0, ach: 0 };
    return {
      daily: [...d.daily, ...FACTIONS.flatMap((f) => d.faction[f]), ...d.pvp, ...d.gem].filter((i) => i.status === 'claimable').length,
      login: d.login.days.filter((x) => x.status === 'claimable').length,
      ach: d.achievements.flatMap((g) => g.items).filter((i) => i.status === 'claimable').length,
    };
  });

  const ClaimBtn = (p: { i: QuestItemDto }) => (
    <Show
      when={p.i.status !== 'claimed'}
      fallback={<span class="q-done">✓ Đã nhận</span>}
    >
      <Show
        when={p.i.status === 'claimable'}
        fallback={
          <span class="muted small">
            {num(p.i.progress)}/{num(p.i.target)}
          </span>
        }
      >
        <button class="btn primary small" disabled={busy()} onClick={() => void claim([p.i.key])}>
          Nhận
        </button>
      </Show>
    </Show>
  );

  const QuestRow = (p: { i: QuestItemDto }) => (
    <div class={`q-row ${p.i.status}`}>
      <div class="q-info">
        <b>{p.i.name}</b>
        <span class="muted small">{p.i.desc}</span>
        <Bar progress={p.i.progress} target={p.i.target} />
      </div>
      <RewardChip pool={p.i.reward.pool} count={p.i.reward.count} />
      <div class="q-act">
        <ClaimBtn i={p.i} />
      </div>
    </div>
  );

  const Daily = (p: { d: QuestsDto }) => (
    <>
      <div class="q-reset">
        <span>
          Làm mới sau <b data-cd>{cd(nextResetLocal - now())}</b> <span class="muted small">(05:00 giờ Việt Nam)</span>
        </span>
        <span class="small">
          Thưởng ngày mới: {TICKET_TYPES.map((t) => `${p.d.resetBonus.tickets[t]} ${TICKET_LABELS[t].replace('Vé ', '')}`).join(' · ')}{' '}
          <Show when={p.d.resetBonus.granted}>
            <span class="q-done">✓ Đã cộng</span>
          </Show>
        </span>
      </div>
      <h3>Nhiệm vụ chung</h3>
      <div class="q-list">
        <For each={p.d.daily}>{(i) => <QuestRow i={i} />}</For>
      </div>
      <h3>Nhiệm vụ đấu trường</h3>
      <p class="muted small">Chỉ tính các trận bạn chủ động khiêu chiến trong ngày (không tính lúc bị khiêu chiến).</p>
      <div class="q-list">
        <For each={p.d.pvp}>{(i) => <QuestRow i={i} />}</For>
      </div>
      <h3>Nhiệm vụ Ngọc</h3>
      <p class="muted small">Ngọc nhận khi chiêu mộ (rớt kèm) và khi ghép Ngọc. Ghép tính cả lần thất bại.</p>
      <div class="q-list">
        <For each={p.d.gem}>{(i) => <QuestRow i={i} />}</For>
      </div>
      <h3>Nhiệm vụ theo phe</h3>
      <div class="q-factions">
        <For each={FACTIONS}>
          {(f) => (
            <div class={`q-faction f-${f}`}>
              <div class="q-ftitle">Phe {FACTION_LABELS[f]}</div>
              <div class="q-list">
                <For each={p.d.faction[f]}>{(i) => <QuestRow i={i} />}</For>
              </div>
            </div>
          )}
        </For>
      </div>
      <p class="muted small">Nhiệm vụ đã đạt mà chưa bấm nhận sẽ được tự động nhận khi sang ngày mới (05:00).</p>
    </>
  );

  const DayCell = (p: { x: LoginDayDto; today: string }) => {
    const label = () => ({ claimed: '✓', claimable: 'Nhận', missed: 'Vắng', future: '', progress: '' })[p.x.status];
    const inner = () => (
      <>
        <span class="q-dnum">Ngày {p.x.day}</span>
        <b>{p.x.reward}</b>
        <span class="q-dlabel">{label()}</span>
      </>
    );
    const cls = () => `q-day ${p.x.status} ${p.x.date === p.today ? 'today' : ''}`;
    return (
      <Show when={p.x.status === 'claimable'} fallback={<div class={cls()}>{inner()}</div>}>
        <button class={cls()} disabled={busy()} onClick={() => void claim([`login:${p.x.date}`])}>
          {inner()}
        </button>
      </Show>
    );
  };

  const Login = (p: { d: QuestsDto }) => {
    // Reactive: data() đổi (VD sang tháng mới khi tải lại) mà component không bị mount lại
    const ym = () => p.d.login.month.split('-');
    return (
      <>
        <h3>
          Điểm danh tháng {Number(ym()[1])}/{ym()[0]}
        </h3>
        <p class="muted small">
          Mỗi ngày vào game nhận Vé thường theo ngày trong tháng (ngày 1: 10 vé … ngày 31: 40 vé). Bỏ lỡ một ngày không ảnh hưởng ngày sau. Sang
          tháng mới, các ngày chưa bấm nhận được tự động nhận.
        </p>
        <div class="q-cal">
          <For each={p.d.login.days}>{(x) => <DayCell x={x} today={p.d.calendarDate} />}</For>
        </div>
      </>
    );
  };

  const Group = (p: { g: AchievementGroupDto }) => {
    const claimable = () => p.g.items.filter((i) => i.status === 'claimable');
    const next = () => p.g.items.find((i) => i.status === 'progress');
    const done = () => p.g.items.filter((i) => i.status === 'claimed').length;
    const pool = () => p.g.items[0]?.reward.pool ?? 'normal';
    return (
      <div class={`q-ach ${claimable().length ? 'has-claim' : ''}`}>
        <div class="q-ach-head">
          <b>{p.g.title}</b>
          <span class="muted small">
            {done()}/{p.g.items.length} mốc
          </span>
        </div>
        <span class="muted small">
          {p.g.desc}: <b class="q-val">{num(p.g.progress)}</b>
        </span>
        <Show
          when={next()}
          fallback={
            <Show when={!claimable().length}>
              <div class="q-next small q-done">✓ Đã hoàn thành mọi mốc</div>
            </Show>
          }
        >
          {(n) => (
            <>
              <div class="q-next small">
                Mốc kế: {n().name} <RewardChip pool={n().reward.pool} count={n().reward.count} />
              </div>
              <Bar progress={n().progress} target={n().target} />
            </>
          )}
        </Show>
        <Show when={claimable().length}>
          <button class="btn primary small" disabled={busy()} onClick={() => void claim(claimable().map((i) => i.key))}>
            Nhận {claimable().length} mốc · +{num(claimable().reduce((s, i) => s + i.reward.count, 0))} {TICKET_LABELS[pool()]}
          </button>
        </Show>
        <details class="q-ms">
          <summary class="muted small">Xem các mốc</summary>
          <div class="q-chips">
            <For each={p.g.items}>
              {(i) => (
                <span class={`q-chip ${i.status}`} title={i.name}>
                  {num(i.target)} → {num(i.reward.count)}
                </span>
              )}
            </For>
          </div>
        </details>
      </div>
    );
  };

  const Ach = (p: { d: QuestsDto }) => {
    const sec = (title: string, list: AchievementGroupDto[]) => (
      <>
        <h3>{title}</h3>
        <div class="q-achs">
          <For each={list}>{(g) => <Group g={g} />}</For>
        </div>
      </>
    );
    const gs = () => p.d.achievements;
    return (
      <>
        {sec('Chiêu mộ & thu thập', gs().filter((g) => g.id === 'draws' || g.id === 'cards' || g.id === 'collect'))}
        {sec('Ngọc Ngũ Hành', gs().filter((g) => g.id.startsWith('gem-')))}
        {sec('Đấu trường', gs().filter((g) => g.id.startsWith('pvp-')))}
        {sec('Sưu tầm theo phe', gs().filter((g) => g.id.startsWith('fcollect-')))}
        {sec('Sở hữu thẻ theo cấp', gs().filter((g) => g.id.startsWith('own-')))}
        {sec('Sở hữu Ngọc theo cấp', gs().filter((g) => g.id.startsWith('gem-ownlv-')))}
        <p class="muted small">
          Mỗi mốc chỉ nhận 1 lần, không reset. Thẻ được người khác tặng không tính vào chiêu mộ/sưu tầm/số thẻ đã nhận. Thành tựu đấu trường chỉ
          tính số trận bạn chủ động khiêu chiến.
        </p>
      </>
    );
  };

  return (
    <section class="panel q-panel">
      <div class="q-head">
        <h2>Nhiệm vụ</h2>
        <button class="btn primary" disabled={busy() || !data() || data()!.claimable === 0} onClick={() => void claim()}>
          {data()?.claimable ? `Nhận tất cả (${data()!.claimable})` : 'Nhận tất cả'}
        </button>
      </div>
      <div class="sub-tabs" role="tablist">
        <For each={['daily', 'login', 'ach'] as Sub[]}>
          {(k) => (
            <button class="btn small" classList={{ on: sub() === k }} onClick={() => setSub(k)}>
              {SUB_LABEL[k]}
              <Show when={counts()[k]}>
                {' '}
                <span class="q-dot">{counts()[k]}</span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <div class="q-msg" aria-live="polite">
        <Show when={msg()}>
          {(m) => {
            const v = m();
            return v.ok ? (
              <div class="notice">
                Đã nhận {v.count} phần thưởng:{' '}
                <For each={v.parts}>
                  {([p, n], i) => (
                    <>
                      {i() > 0 ? ', ' : ''}
                      <b>
                        +{num(n)} {TICKET_LABELS[p]}
                      </b>
                    </>
                  )}
                </For>
              </div>
            ) : (
              <div class="warn">{v.text}</div>
            );
          }}
        </Show>
      </div>
      <div class="q-body">
        <Show when={!error() || data()} fallback={<div class="state-msg error">{error()}</div>}>
          <Show when={data()} fallback={<div class="state-msg">Đang tải nhiệm vụ…</div>}>
            {(d) => (
              <Show when={sub() === 'daily'} fallback={<Show when={sub() === 'login'} fallback={<Ach d={d()} />}><Login d={d()} /></Show>}>
                <Daily d={d()} />
              </Show>
            )}
          </Show>
        </Show>
      </div>
    </section>
  );
}
