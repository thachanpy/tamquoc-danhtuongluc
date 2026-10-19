import { For, Match, Show, Switch, createSignal, onCleanup, type JSX } from 'solid-js';
import { FACTION_LABELS, TICKET_LABELS, type Faction, type HistoryEntryDto, type GiftCardSnapshot } from '@tq/shared';
import { api } from '../api.ts';
import { gen } from '../state.ts';
import { pct } from '../art.ts';

const fmt = (iso: string) => new Date(iso).toLocaleString('vi-VN');

/** Nhãn dòng ledger nhiệm vụ/thành tựu từ khoá phần thưởng (mục 3.10). */
function questLabel(key: string): string {
  const p = key.split(':');
  const n = (x?: string) => Number(x ?? 0).toLocaleString('vi-VN');
  const dm = (d?: string) => (d ? `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}` : '');
  switch (p[0]) {
    case 'reset':
      return `Thưởng ngày mới ${dm(p[1])}`;
    case 'd':
      return `Nhiệm vụ hằng ngày ${dm(p[1])}`;
    case 'f':
      return `Nhiệm vụ phe ${FACTION_LABELS[p[2] as Faction] ?? ''} ${dm(p[1])}`;
    case 'login':
      return `Điểm danh ngày ${dm(p[1])}`;
    case 'a':
      if (p[1] === 'draws') return `Thành tựu: chiêu mộ ${n(p[2])} lần`;
      if (p[1] === 'collect') return `Thành tựu: sưu tầm ${n(p[2])} tướng`;
      if (p[1] === 'fcollect') return `Thành tựu: sưu tầm ${n(p[3])} tướng ${FACTION_LABELS[p[2] as Faction] ?? ''}`;
      if (p[1] === 'own') return `Thành tựu: sở hữu ${n(p[3])} thẻ Lv.${p[2]}`;
      if (p[1] === 'cards') return `Thành tựu: nhận ${n(p[2])} thẻ`;
      return 'Thành tựu';
    default:
      return 'Nhiệm vụ';
  }
}

const cardList = (cards: GiftCardSnapshot[]) => cards.map((c) => `${gen(c.generalId).name} Lv.${c.level}`).join(', ');

/** Khung chung một dòng lịch sử: nhãn, nội dung, thời điểm. */
function HRow(props: { tag: string; tagClass?: string; createdAt: string; children: JSX.Element }) {
  return (
    <div class="h-row">
      <span class={props.tagClass ? `tag ${props.tagClass}` : 'tag'}>{props.tag}</span>
      <div>{props.children}</div>
      <time>{fmt(props.createdAt)}</time>
    </div>
  );
}

function CardsDetails(props: { cards: GiftCardSnapshot[] }) {
  return (
    <details>
      <summary class="muted small">Xem thẻ</summary>
      <div class="small">{cardList(props.cards)}</div>
    </details>
  );
}

function Row(props: { e: HistoryEntryDto }): JSX.Element {
  const e = props.e;
  if (e.kind === 'ticket') {
    const label = TICKET_LABELS[e.ticketType];
    const plus = `+${e.amountDelta} vé`;
    const got = (
      <b>
        {label} ×{e.amountDelta}
      </b>
    );
    if (e.reason === 'time_recovery') {
      return (
        <HRow tag="+1 vé" tagClass="ok" createdAt={e.createdAt}>
          Hồi vé mốc <b>{fmt(e.referenceId ?? e.createdAt)}</b>: nhận <b>{label}</b>
        </HRow>
      );
    }
    if (e.reason === 'dev_topup') {
      return (
        <HRow tag={plus} tagClass="ok" createdAt={e.createdAt}>
          Cộng vé thử nghiệm: nhận {got}
        </HRow>
      );
    }
    if (e.reason === 'giftcode') {
      return (
        <HRow tag={plus} tagClass="ok" createdAt={e.createdAt}>
          Giftcode: nhận {got}
        </HRow>
      );
    }
    if (e.reason === 'admin_grant') {
      return (
        <HRow tag={plus} tagClass="ok" createdAt={e.createdAt}>
          Quản trị viên tặng: nhận {got}
        </HRow>
      );
    }
    if (e.reason === 'daily_reset' || e.reason === 'mission' || e.reason === 'achievement') {
      return (
        <HRow tag={plus} tagClass="ok" createdAt={e.createdAt}>
          {questLabel(e.referenceId ?? '')}: nhận {got}
        </HRow>
      );
    }
    if (e.reason === 'signup_bonus') {
      return (
        <HRow tag={plus} tagClass="ok" createdAt={e.createdAt}>
          Quà tân thủ: nhận {got}
        </HRow>
      );
    }
    return (
      <HRow tag="−1 vé" createdAt={e.createdAt}>
        Dùng <b>{label}</b> để quay
      </HRow>
    );
  }
  if (e.kind === 'giftcode') {
    const got = [...(e.tickets ?? []).map((t) => `${TICKET_LABELS[t.pool]} ×${t.count}`), e.cards.length ? `${e.cards.length} thẻ` : '']
      .filter(Boolean)
      .join(', ');
    return (
      <HRow tag="Giftcode" tagClass="ok" createdAt={e.createdAt}>
        Nhập giftcode <b>{e.code}</b>: nhận <b>{got}</b>
        <Show when={e.cards.length}>
          <CardsDetails cards={e.cards} />
        </Show>
      </HRow>
    );
  }
  if (e.kind === 'gift') {
    return e.direction === 'sent' ? (
      <HRow tag={`Tặng ${e.cards.length}`} tagClass="bad" createdAt={e.createdAt}>
        Tặng <b>{e.cards.length} thẻ</b> cho <b>{e.otherUsername}</b>
        <CardsDetails cards={e.cards} />
      </HRow>
    ) : (
      <HRow tag={`Nhận ${e.cards.length}`} tagClass="ok" createdAt={e.createdAt}>
        Nhận <b>{e.cards.length} thẻ</b> từ <b>{e.otherUsername}</b>
        <CardsDetails cards={e.cards} />
      </HRow>
    );
  }
  if (e.kind === 'gacha') {
    return (
      <HRow tag="Quay" tagClass="gacha" createdAt={e.createdAt}>
        {TICKET_LABELS[e.ticketType]} →{' '}
        <b>
          {gen(e.generalId).name} Lv.{e.cardLevel}
        </b>{' '}
        <span class="muted">(thẻ #{e.cardId})</span>
      </HRow>
    );
  }
  const dist = e.failureDistribution.map((d) => `Lv.${d.level}: ${pct(d.bps)}`).join(' · ');
  return (
    <HRow tag={e.outcome === 'success' ? 'Ghép ✓' : 'Ghép ✗'} tagClass={e.outcome === 'success' ? 'ok' : 'bad'} createdAt={e.createdAt}>
      <b>{gen(e.generalId).name}</b> {e.inputCardIds.length}× Lv.{e.inputLevel} (thẻ {e.inputCardIds.map((i) => '#' + i).join(', ')}) →{' '}
      <b>Lv.{e.resultLevel}</b> (thẻ #{e.resultCardId})
      <details>
        <summary class="muted small">Tỷ lệ đã áp dụng</summary>
        <div class="small">
          Thành công {pct(e.successBps)} · Thất bại {pct(e.failureBps)}
          <br />
          Phân phối thất bại: {dist}
        </div>
      </details>
    </HRow>
  );
}

type ListState = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; items: HistoryEntryDto[] };

export function HistoryPage(): JSX.Element {
  const pageSize = 20;
  const [page, setPage] = createSignal(1);
  const [kind, setKind] = createSignal('');
  const [list, setList] = createSignal<ListState>({ kind: 'loading' });
  const [pinfo, setPinfo] = createSignal('');
  const [prevDisabled, setPrevDisabled] = createSignal(false);
  const [nextDisabled, setNextDisabled] = createSignal(false);
  let alive = true;
  onCleanup(() => (alive = false));

  async function load() {
    setList({ kind: 'loading' });
    const pg = page();
    try {
      const p = await api.history({ kind: kind() || undefined, page: pg, pageSize });
      if (!alive) return;
      const pages = Math.max(1, Math.ceil(p.total / pageSize));
      setList({ kind: 'ok', items: p.items });
      setPinfo(`Trang ${pg}/${pages} · ${p.total} mục`);
      setPrevDisabled(pg <= 1);
      setNextDisabled(pg >= pages);
    } catch (e) {
      if (alive) setList({ kind: 'error', message: (e as Error).message });
    }
  }

  void load();

  return (
    <section class="panel">
      <div class="filters">
        <select
          data-kind
          aria-label="Loại"
          onInput={(ev) => {
            setKind(ev.currentTarget.value);
            setPage(1);
            void load();
          }}
        >
          <option value="">Tất cả</option>
          <option value="ticket">Vé (cấp/dùng)</option>
          <option value="gacha">Quay thẻ</option>
          <option value="upgrade">Nâng cấp</option>
          <option value="gift">Tặng thẻ</option>
          <option value="giftcode">Giftcode</option>
        </select>
      </div>
      <div class="h-list">
        <Switch>
          <Match when={list().kind === 'loading'}>
            <div class="state-msg">Đang tải…</div>
          </Match>
          <Match when={(() => { const l = list(); return l.kind === 'error' ? l : null; })()}>
            {(l) => <div class="state-msg error">{l().message}</div>}
          </Match>
          <Match when={(() => { const l = list(); return l.kind === 'ok' ? l : null; })()}>
            {(l) => (
              <Show when={l().items.length} fallback={<div class="state-msg">Chưa có lịch sử.</div>}>
                <For each={l().items}>{(e) => <Row e={e} />}</For>
              </Show>
            )}
          </Match>
        </Switch>
      </div>
      <div class="pager">
        <button
          class="btn ghost"
          data-prev
          disabled={prevDisabled()}
          onClick={() => {
            setPage(page() - 1);
            void load();
          }}
        >
          ‹ Trước
        </button>
        <span class="pinfo muted">{pinfo()}</span>
        <button
          class="btn ghost"
          data-next
          disabled={nextDisabled()}
          onClick={() => {
            setPage(page() + 1);
            void load();
          }}
        >
          Sau ›
        </button>
      </div>
    </section>
  );
}
