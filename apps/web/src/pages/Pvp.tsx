import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type {
  CardDto,
  Faction,
  PvpBattleDto,
  PvpBattleSummaryDto,
  PvpEventDto,
  PvpOpponentDto,
  PvpOutcome,
  PvpOverviewDto,
  PvpSide,
  PvpStyle,
  PvpUnitDto,
} from '@tq/shared';
import { FACTION_LABELS, PVP_PASSIVE_LABELS, PVP_SKILL_LABELS, PVP_STYLE_LABELS } from '@tq/shared';
import { api, fetchAllCards } from '../api.ts';
import { gen, genStyle, pvpTarget, setPvpTarget } from '../state.ts';
import { Avatar } from '../components/Avatar.tsx';
import { FACTION_STYLE, initials, levelTier, portraitUrl } from '../art.ts';
import { toast } from '../ui.ts';

/**
 * Đấu trường PvP (mục 6.7 — PVP.md).
 * Người chơi xếp đội 6 tướng (3 hàng trước + 3 hàng sau), chọn đối thủ từ bảng xếp hạng
 * rồi khiêu chiến. Server mô phỏng trọn trận và trả dữ liệu; trang này chỉ phát lại.
 */

const num = (n: number) => n.toLocaleString('vi-VN');
const FRONT = [1, 2, 3];
const BACK = [4, 5, 6];
const SLOT_LABEL: Record<number, string> = { 1: 'Trước·Trên', 2: 'Trước·Giữa', 3: 'Trước·Dưới', 4: 'Sau·Trên', 5: 'Sau·Giữa', 6: 'Sau·Dưới' };

const OUTCOME_LABEL: Record<PvpOutcome, string> = { win: 'Thắng', loss: 'Thua', draw: 'Hòa' };
const outcomeClass = (r: PvpOutcome) => (r === 'win' ? 'win' : r === 'loss' ? 'loss' : 'draw');
const mySideOfWinner = (b: PvpBattleDto): PvpOutcome => b.result;
const time = (isoStr: string) => new Date(isoStr).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Ô một tướng trên bàn đội hình (dùng cho cả đội mình và đội đối thủ). */
function UnitCell(props: { slot: number; unit?: PvpUnitDto; onClick?: (slot: number) => void }) {
  const g = () => (props.unit ? gen(props.unit.generalId) : null);
  return (
    <button
      type="button"
      class="pvp-cell"
      classList={{ empty: !props.unit, fill: !!props.unit }}
      disabled={!props.onClick}
      title={props.unit ? `${g()!.name} · Lv.${props.unit.level}` : SLOT_LABEL[props.slot]}
      onClick={() => props.onClick?.(props.slot)}
    >
      <span class="pvp-slot">{props.slot}</span>
      <Show when={props.unit} fallback={<span class="pvp-empty">＋</span>}>
        {(u) => (
          <>
            <span class="pvp-art">
              <span class="pvp-ini">{initials(g()!.name)}</span>
              <img src={portraitUrl(g()!.artKey)} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />
            </span>
            <span class="pvp-cell-name">{g()!.name}</span>
            <span class="pvp-cell-lv" style={{ color: levelTier(u().level).css }}>{`Lv.${u().level}`}</span>
          </>
        )}
      </Show>
    </button>
  );
}

/** Lưới 3×2: cột Hàng sau / Hàng trước. Đội đối thủ lật thứ tự cột cho đối xứng. */
function TeamBoard(props: { units: PvpUnitDto[]; foe?: boolean; onSlot?: (slot: number) => void }) {
  const bySlot = createMemo(() => new Map(props.units.map((u) => [u.slot, u])));
  const col = (slots: number[], title: string) => (
    <div class="pvp-col">
      <div class="pvp-col-title">{title}</div>
      <For each={slots}>{(s) => <UnitCell slot={s} unit={bySlot().get(s)} onClick={props.onSlot} />}</For>
    </div>
  );
  return (
    <div class="pvp-board" classList={{ foe: props.foe }}>
      {props.foe ? [col(FRONT, 'Hàng trước'), col(BACK, 'Hàng sau')] : [col(BACK, 'Hàng sau'), col(FRONT, 'Hàng trước')]}
    </div>
  );
}

/** Chọn tướng cho một vị trí từ thẻ đang sở hữu (gộp theo tướng, chọn từng cấp). */
interface GenOpt {
  id: string;
  name: string;
  faction: Faction;
  artKey: string;
  style: PvpStyle;
  /** Cấp cao nhất đang sở hữu — dùng để xếp đội (mỗi tướng chỉ cần một lựa chọn). */
  best: number;
  power: number;
}

function Picker(props: {
  slot: number;
  options: GenOpt[];
  onPick: (generalId: string, level: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = createSignal('');
  const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
  const filtered = createMemo(() => {
    const fq = fold(q().trim());
    return props.options.filter((o) => !fq || fold(o.name).includes(fq));
  });
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
  onMount(() => document.addEventListener('keydown', onKey));
  onCleanup(() => document.removeEventListener('keydown', onKey));
  return (
    <div class="pvp-modal" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="panel pvp-picker">
        <div class="pvp-picker-head">
          <h3>{`Chọn tướng cho vị trí ${props.slot} (${SLOT_LABEL[props.slot]})`}</h3>
          <button class="btn ghost small" onClick={() => props.onClose()}>
            Đóng
          </button>
        </div>
        <div class="pvp-picker-tools">
          <input type="search" placeholder="Tìm tướng…" aria-label="Tìm tướng" value={q()} onInput={(e) => setQ(e.currentTarget.value)} />
          <button class="btn ghost small" onClick={() => props.onClear()}>
            Bỏ trống vị trí
          </button>
        </div>
        <div class="pvp-picker-list">
          <Show when={props.options.length} fallback={<div class="state-msg">Bạn chưa có tướng nào. Hãy quay thẻ trước.</div>}>
            <Show when={filtered().length} fallback={<div class="state-msg">Không tìm thấy tướng phù hợp.</div>}>
              <For each={filtered()}>
                {(o) => (
                  <div class="pvp-pick-row">
                    <span class="pvp-pick-art" style={{ 'border-color': FACTION_STYLE[o.faction].css }}>
                      <span class="pvp-ini">{initials(o.name)}</span>
                      <img
                        src={portraitUrl(o.artKey)}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(e) => (e.currentTarget.style.display = 'none')}
                      />
                    </span>
                    <span class="pvp-pick-meta">
                      <span class="pvp-pick-name">{o.name}</span>
                      <span class="pvp-pick-tags">
                        <span class="pvp-pick-faction" style={{ color: FACTION_STYLE[o.faction].css }}>
                          {FACTION_LABELS[o.faction]}
                        </span>
                        <span class={`pvp-pick-style ${o.style}`}>{PVP_STYLE_LABELS[o.style]}</span>
                      </span>
                    </span>
                    <button
                      type="button"
                      class="lv-chip"
                      style={{ 'border-color': levelTier(o.best).css, color: levelTier(o.best).css }}
                      title={`Đưa ${o.name} vào vị trí ${props.slot}`}
                      onClick={() => props.onPick(o.id, o.best)}
                    >
                      {`Lv.${o.best}`}
                    </button>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ======================= Phát lại trận đấu =======================

interface CV {
  hp: number;
  maxHp: number;
  alive: boolean;
  stunned: boolean;
  buffed: boolean;
}

const EVENT_MS: Record<PvpEventDto['t'], number> = {
  round: 300,
  act: 220,
  damage: 400,
  heal: 400,
  stun: 320,
  cleanse: 320,
  buff: 280,
  skip: 480,
  down: 380,
  end: 500,
};

function BattleReplay(props: { battle: PvpBattleDto; onClose: () => void }) {
  const units = props.battle.units;
  const byIdx = new Map(units.map((u) => [u.idx, u]));
  const nameOf = (idx: number) => {
    const u = byIdx.get(idx);
    return u ? gen(u.generalId).name : `#${idx}`;
  };
  const initView = () => {
    const o: Record<number, CV> = {};
    for (const u of units) o[u.idx] = { hp: u.maxHp, maxHp: u.maxHp, alive: true, stunned: false, buffed: false };
    return o;
  };

  const [view, setView] = createSignal<Record<number, CV>>(initView());
  const [cursor, setCursor] = createSignal(0);
  const [playing, setPlaying] = createSignal(false);
  const [speed, setSpeed] = createSignal(2);
  const [round, setRound] = createSignal(0);
  const [acting, setActing] = createSignal<number | null>(null);
  const [targets, setTargets] = createSignal<number[]>([]);
  const [floats, setFloats] = createSignal<{ id: number; idx: number; text: string; crit: boolean; heal: boolean }[]>([]);
  const [log, setLog] = createSignal<{ id: number; text: string }[]>([]);
  const [done, setDone] = createSignal(false);
  let floatId = 0;
  let logId = 0;
  let timer: number | undefined;

  const upd = (idx: number, fn: (s: CV) => CV) =>
    setView((v) => {
      const s = v[idx];
      if (!s) return v;
      return { ...v, [idx]: fn(s) };
    });

  function addFloat(idx: number, text: string, crit: boolean, heal = false) {
    const id = ++floatId;
    setFloats((f) => [...f, { id, idx, text, crit, heal }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 900);
  }
  function pushLog(text: string) {
    const id = ++logId;
    setLog((l) => [...l, { id, text }].slice(-40));
  }

  function apply(ev: PvpEventDto) {
    switch (ev.t) {
      case 'round':
        setRound(ev.round);
        setTargets([]);
        pushLog(`— Lượt ${ev.round} —`);
        break;
      case 'act':
        setActing(ev.idx);
        setTargets(ev.targets);
        pushLog(`${nameOf(ev.idx)} · ${PVP_SKILL_LABELS[ev.skill]}`);
        break;
      case 'skip':
        setActing(ev.idx);
        pushLog(`${nameOf(ev.idx)} bị choáng — bỏ lượt`);
        break;
      case 'damage':
        setActing(ev.from);
        upd(ev.idx, (s) => ({ ...s, hp: ev.hp }));
        addFloat(ev.idx, `-${num(ev.amount)}`, ev.crit);
        if (ev.crit) pushLog(`Chí mạng vào ${nameOf(ev.idx)}: ${num(ev.amount)}`);
        break;
      case 'heal':
        setActing(ev.from);
        upd(ev.idx, (s) => ({ ...s, hp: ev.hp }));
        addFloat(ev.idx, `+${num(ev.amount)}`, false, true);
        break;
      case 'stun':
        upd(ev.idx, (s) => ({ ...s, stunned: true }));
        pushLog(`${nameOf(ev.idx)} bị choáng!`);
        break;
      case 'cleanse':
        upd(ev.idx, (s) => ({ ...s, stunned: false }));
        pushLog(`Giải choáng cho ${nameOf(ev.idx)}`);
        break;
      case 'buff':
        upd(ev.idx, (s) => ({ ...s, buffed: true }));
        break;
      case 'down':
        upd(ev.idx, (s) => ({ ...s, alive: false, hp: 0, stunned: false }));
        pushLog(`${nameOf(ev.idx)} bị hạ!`);
        break;
      case 'end':
        setPlaying(false);
        setDone(true);
        break;
    }
  }

  function step() {
    const evs = props.battle.events;
    const c = cursor();
    if (c >= evs.length) {
      setDone(true);
      setPlaying(false);
      return;
    }
    apply(evs[c]!);
    setCursor(c + 1);
    if (cursor() >= evs.length) setDone(true);
  }

  function schedule() {
    clearTimeout(timer);
    const ev = props.battle.events[cursor()];
    if (!ev || !playing()) return;
    const ms = EVENT_MS[ev.t] ?? 250;
    timer = window.setTimeout(() => {
      if (!playing()) return;
      step();
      if (playing() && !done()) schedule();
      else setPlaying(false);
    }, ms / speed());
  }

  function play() {
    if (done()) reset();
    setPlaying(true);
    schedule();
  }
  function pause() {
    setPlaying(false);
    clearTimeout(timer);
  }
  function reset() {
    clearTimeout(timer);
    setView(initView());
    setCursor(0);
    setRound(0);
    setActing(null);
    setTargets([]);
    setFloats([]);
    setLog([]);
    setDone(false);
  }
  function toEnd() {
    pause();
    const evs = props.battle.events;
    for (let c = cursor(); c < evs.length; c++) apply(evs[c]!);
    setCursor(evs.length);
    setDone(true);
  }
  function stepOnce() {
    pause();
    step();
  }

  onCleanup(() => clearTimeout(timer));
  onMount(() => setTimeout(play, 300));

  const idxFor = (side: PvpSide, slot: number) => (side === 'a' ? slot - 1 : 6 + slot - 1);
  const cols: { side: PvpSide; slots: number[]; title: string }[] = [
    { side: 'a', slots: BACK, title: 'Sau' },
    { side: 'a', slots: FRONT, title: 'Trước' },
    { side: 'b', slots: FRONT, title: 'Trước' },
    { side: 'b', slots: BACK, title: 'Sau' },
  ];

  function cell(idx: number) {
    const u = byIdx.get(idx);
    if (!u) return <div class="rp-cell empty" />;
    const v = view()[idx]!;
    const hpPct = () => Math.max(0, Math.round((v.hp / v.maxHp) * 100));
    const flock = () => floats().filter((f) => f.idx === idx);
    return (
      <div
        class="rp-cell"
        classList={{
          dead: !v.alive,
          acting: acting() === idx,
          stunned: v.stunned,
          targeted: targets().includes(idx),
          buffed: v.buffed,
          foe: u.side === 'b',
        }}
      >
        <span class="rp-lv" style={{ color: levelTier(u.level).css }}>{`Lv.${u.level}`}</span>
        <span class="rp-art">
          <span class="pvp-ini">{initials(gen(u.generalId).name)}</span>
          <img src={portraitUrl(gen(u.generalId).artKey)} alt="" loading="lazy" decoding="async" onError={(e) => (e.currentTarget.style.display = 'none')} />
        </span>
        <span class="rp-name">{gen(u.generalId).name}</span>
        <span class="rp-hp">
          <i style={{ width: `${hpPct()}%` }} />
        </span>
        <Show when={v.stunned}>
          <span class="rp-badge stun" title="Đang bị choáng">✦</span>
        </Show>
        <Show when={v.buffed}>
          <span class="rp-badge buff" title="Đã được tăng sức mạnh">▲</span>
        </Show>
        <Show when={v.alive}>
          <span
            class="rp-info"
            title={`Phong cách: ${PVP_STYLE_LABELS[u.style]} · Nội tại: ${PVP_PASSIVE_LABELS[u.passive]} · Kỹ năng: ${PVP_SKILL_LABELS[u.skill]} · Choáng ${(u.stunBps / 100).toFixed(0)}%`}
          >
            {`LC ${u.lc} · CM ${(u.critBps / 100).toFixed(0)}% · ${PVP_STYLE_LABELS[u.style]}`}
          </span>
        </Show>
        <For each={flock()}>{(f) => <span class="rp-float" classList={{ crit: f.crit, heal: f.heal }}>{f.text}</span>}</For>
      </div>
    );
  }

  const me = () => (props.battle.mySide === 'a' ? props.battle.attacker : props.battle.defender);
  const foe = () => (props.battle.mySide === 'a' ? props.battle.defender : props.battle.attacker);

  return (
    <div class="pvp-modal rp-modal" role="dialog" aria-modal="true">
      <div class="panel rp-box">
        <div class="rp-head">
          <div class="rp-side mine">
            <Avatar avatar={me().avatar} name={me().displayName} class="rp-avatar" />
            <span class="rp-side-name">{me().displayName}</span>
          </div>
          <div class="rp-mid">
            <span class="rp-round">{round() ? `Lượt ${round()}` : 'Bắt đầu'}</span>
            <Show when={done()}>
              <span class={`rp-result ${outcomeClass(mySideOfWinner(props.battle))}`}>
                {props.battle.winner === 'draw' ? 'HÒA' : OUTCOME_LABEL[props.battle.result]}
              </span>
            </Show>
          </div>
          <div class="rp-side foe">
            <span class="rp-side-name">{foe().displayName}</span>
            <Avatar avatar={foe().avatar} name={foe().displayName} class="rp-avatar" />
          </div>
        </div>

        <div class="rp-field">
          <For each={cols}>
            {(c) => (
              <div class="rp-col">
                <div class="rp-col-title">{c.title}</div>
                <For each={c.slots}>{(s) => cell(idxFor(c.side, s))}</For>
              </div>
            )}
          </For>
        </div>

        <div class="rp-log" aria-live="polite">
          <For each={log()}>{(l) => <div class="rp-log-line">{l.text}</div>}</For>
        </div>

        <div class="rp-progress">
          <i style={{ width: `${props.battle.events.length ? (cursor() / props.battle.events.length) * 100 : 0}%` }} />
        </div>

        <div class="rp-controls">
          <button class="btn primary small" onClick={() => (playing() ? pause() : play())}>
            {playing() ? 'Tạm dừng' : 'Phát'}
          </button>
          <button class="btn ghost small" onClick={stepOnce}>
            Bước
          </button>
          <button class="btn ghost small" onClick={reset}>
            Chơi lại
          </button>
          <button class="btn ghost small" onClick={toEnd}>
            Tua nhanh
          </button>
          <span class="rp-speeds">
            <For each={[1, 2, 4]}>
              {(s) => (
                <button class="btn ghost small" classList={{ on: speed() === s }} onClick={() => setSpeed(s)}>
                  {`${s}×`}
                </button>
              )}
            </For>
          </span>
          <button class="btn ghost small rp-close" onClick={() => props.onClose()}>
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}

// ======================= Trang Đấu trường =======================

export function PvpPage() {
  let alive = true;
  let lastOppId = 0;
  onCleanup(() => (alive = false));

  const [overview, setOverview] = createSignal<PvpOverviewDto | null>(null);
  const [team, setTeam] = createSignal<PvpUnitDto[]>([]);
  const [dirty, setDirty] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pickerSlot, setPickerSlot] = createSignal<number | null>(null);

  const [cards, setCards] = createSignal<CardDto[] | null>(null);
  const [opponent, setOpponent] = createSignal<PvpOpponentDto | null>(null);
  const [oppError, setOppError] = createSignal('');
  const [oppBusy, setOppBusy] = createSignal(false);
  const [battle, setBattle] = createSignal<PvpBattleDto | null>(null);
  const [history, setHistory] = createSignal<PvpBattleSummaryDto[]>([]);

  const powerOf = (level: number) => overview()?.powerByLevel[level] ?? 0;
  const teamPower = () => team().reduce((s, u) => s + powerOf(u.level), 0);

  const options = createMemo<GenOpt[]>(() => {
    const cs = cards();
    if (!cs) return [];
    // Mỗi tướng chỉ cần một lựa chọn: cấp cao nhất đang sở hữu
    const best = new Map<string, number>();
    for (const c of cs) {
      const cur = best.get(c.generalId);
      if (cur === undefined || c.level > cur) best.set(c.generalId, c.level);
    }
    return [...best.entries()]
      .map(([id, lv]) => ({
        id,
        name: gen(id).name,
        faction: gen(id).faction,
        artKey: gen(id).artKey,
        style: genStyle(id),
        best: lv,
        power: powerOf(lv),
      }))
      .sort((a, b) => b.power - a.power || b.best - a.best || a.name.localeCompare(b.name));
  });

  async function loadOverview() {
    try {
      const d = await api.pvp();
      if (!alive) return;
      setError('');
      setOverview(d);
      setTeam(d.team.units);
      setDirty(false);
    } catch (e) {
      if (alive) setError((e as Error).message);
    }
  }
  async function loadHistory() {
    try {
      const p = await api.pvpBattles({ pageSize: 12 });
      if (alive) setHistory(p.items);
    } catch {
      /* lịch sử trống thì bỏ qua */
    }
  }
  async function loadCards() {
    try {
      const list = await fetchAllCards();
      if (alive) setCards(list);
    } catch {
      if (alive) setCards([]);
    }
  }
  async function loadOpponent(id: number) {
    setOppBusy(true);
    setOppError('');
    try {
      const d = await api.pvpOpponent(id);
      if (alive) setOpponent(d);
    } catch (e) {
      if (!alive) return;
      setOpponent(null);
      setOppError((e as Error).message);
    } finally {
      if (alive) setOppBusy(false);
    }
  }

  onMount(() => {
    void loadOverview();
    void loadHistory();
  });

  // Đối thủ chọn từ bảng xếp hạng (#pvp/<id>)
  createEffect(() => {
    const id = pvpTarget();
    const ov = overview();
    if (!id || !ov) return;
    if (ov.me.id === id) {
      setOpponent(null);
      return;
    }
    if (id === lastOppId) return;
    lastOppId = id;
    void loadOpponent(id);
  });

  function openPicker(slot: number) {
    setPickerSlot(slot);
    if (!cards()) void loadCards();
  }

  function assign(slot: number, generalId: string, level: number) {
    setTeam((prev) => {
      // Bỏ tướng này khỏi slot cũ (mỗi tướng chỉ xếp một lần) rồi gán vào slot được chọn
      const rest = prev.filter((u) => u.slot !== slot && u.generalId !== generalId);
      return [...rest, { slot, generalId, level }].sort((a, b) => a.slot - b.slot);
    });
    setDirty(true);
    setPickerSlot(null);
  }
  function clearSlot(slot: number) {
    setTeam((prev) => prev.filter((u) => u.slot !== slot));
    setDirty(true);
    setPickerSlot(null);
  }
  function resetTeam() {
    const ov = overview();
    if (ov) setTeam(ov.team.units);
    setDirty(false);
  }

  async function saveTeam() {
    if (busy()) return;
    setBusy(true);
    try {
      const r = await api.pvpSaveTeam(team());
      if (!alive) return;
      setTeam(r.units);
      setDirty(false);
      toast(`Đã lưu đội hình · Lực chiến ${num(r.power)}`);
      await loadOverview();
    } catch (e) {
      if (alive) toast((e as Error).message, 5000);
    } finally {
      if (alive) setBusy(false);
    }
  }

  async function challenge() {
    const opp = opponent();
    if (!opp || busy()) return;
    setBusy(true);
    try {
      const b = await api.pvpChallenge(opp.opponent.id);
      if (!alive) return;
      setBattle(b);
      void loadOverview(); // cập nhật thành tích Thắng/Thua/Hòa
      void loadHistory();
    } catch (e) {
      if (alive) toast((e as Error).message, 5000);
    } finally {
      if (alive) setBusy(false);
    }
  }

  async function openHistoryBattle(id: number) {
    try {
      const b = await api.pvpBattle(id);
      if (alive) setBattle(b);
    } catch (e) {
      if (alive) toast((e as Error).message, 5000);
    }
  }

  const gotoLeaderboard = () => {
    setPvpTarget(null);
    location.hash = 'leaderboard';
  };

  return (
    <>
      <section class="panel pvp-panel">
        <div class="pvp-head">
          <h2>Đấu trường</h2>
          <Show when={overview()}>
            {(ov) => (
              <div class="pvp-record" aria-label="Thành tích">
                <span class="rec win">{`Thắng ${ov().wins}`}</span>
                <span class="rec loss">{`Thua ${ov().losses}`}</span>
                <span class="rec draw">{`Hòa ${ov().draws}`}</span>
              </div>
            )}
          </Show>
        </div>
        <p class="muted small pvp-rule">
          Xếp tối đa 6 tướng (3 hàng trước + 3 hàng sau), mỗi tướng đứng 1 vị trí. Hàng trước +10% HP, hàng sau +10% sát thương.
        </p>

        <Show when={error()}>
          <div class="state-msg error">{error()}</div>
        </Show>

        <Show when={overview()} fallback={<div class="state-msg">Đang tải sân đấu…</div>}>
          {(ov) => (
            <>
              <div class="pvp-myteam">
                <div class="pvp-team-head">
                  <h3>Đội hình của bạn</h3>
                  <span class="pvp-power" title="Tổng Lực chiến của đội">{`Lực chiến ${num(teamPower())}`}</span>
                </div>
                <TeamBoard units={team()} onSlot={openPicker} />
                <div class="pvp-team-actions">
                  <button class="btn primary" disabled={!dirty() || busy()} onClick={() => void saveTeam()}>
                    {busy() ? 'Đang lưu…' : 'Lưu đội hình'}
                  </button>
                  <button class="btn ghost" disabled={!dirty() || busy()} onClick={resetTeam}>
                    Hoàn tác
                  </button>
                  <span class="muted small">
                    {ov().saved ? 'Đội hình đã lưu.' : 'Đang dùng đội gợi ý (mạnh nhất) — bấm Lưu để giữ lại.'}
                  </span>
                </div>
              </div>

              <div class="pvp-opp">
                <div class="pvp-team-head">
                  <h3>Đối thủ</h3>
                  <button class="btn ghost small" onClick={gotoLeaderboard}>
                    Chọn từ bảng xếp hạng
                  </button>
                </div>
                <Show when={oppBusy()}>
                  <div class="state-msg">Đang tải đối thủ…</div>
                </Show>
                <Show when={!oppBusy() && oppError()}>
                  <div class="state-msg error">{oppError()}</div>
                </Show>
                <Show when={!oppBusy() && opponent()}>
                  {(o) => (
                    <div class="pvp-opp-card">
                      <div class="pvp-opp-info">
                        <Avatar avatar={o().opponent.avatar} name={o().opponent.displayName} class="pvp-opp-avatar" />
                        <div>
                          <b>{o().opponent.displayName}</b>
                          <div class="muted small">{`Lực chiến ${num(o().team.power)}${o().saved ? '' : ' · đội gợi ý'}`}</div>
                        </div>
                        <button class="btn primary" disabled={busy() || team().length === 0} onClick={() => void challenge()}>
                          {busy() ? 'Đang giao chiến…' : 'Khiêu chiến'}
                        </button>
                      </div>
                      <TeamBoard units={o().team.units} foe />
                    </div>
                  )}
                </Show>
                <Show when={!oppBusy() && !opponent() && !oppError()}>
                  <div class="state-msg">
                    Mở <b>Bảng xếp hạng</b> và bấm vào một người chơi để khiêu chiến.
                  </div>
                </Show>
              </div>

              <div class="pvp-hist">
                <h3>Lịch sử trận đấu</h3>
                <Show when={history().length} fallback={<div class="state-msg">Chưa có trận đấu nào.</div>}>
                  <div class="pvp-hist-list">
                    <For each={history()}>
                      {(h) => (
                        <button class="pvp-hist-row" onClick={() => void openHistoryBattle(h.id)}>
                          <span class={`hist-res ${outcomeClass(h.result)}`}>{OUTCOME_LABEL[h.result]}</span>
                          <span class="hist-role">{h.role === 'attack' ? 'Tấn công' : 'Phòng thủ'}</span>
                          <Avatar avatar={h.opponent.avatar} name={h.opponent.displayName} class="hist-avatar" />
                          <span class="hist-name">{h.opponent.displayName}</span>
                          <span class="hist-power muted small">{`${num(h.myPower)} vs ${num(h.opponentPower)}`}</span>
                          <span class="hist-time muted small">{time(h.createdAt)}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </>
          )}
        </Show>
      </section>

      <Show when={pickerSlot()}>
        {(slot) => (
          <Picker
            slot={slot()}
            options={options()}
            onPick={(gid, lv) => assign(slot(), gid, lv)}
            onClear={() => clearSlot(slot())}
            onClose={() => setPickerSlot(null)}
          />
        )}
      </Show>

      <Show when={battle()}>{(b) => <BattleReplay battle={b()} onClose={() => setBattle(null)} />}</Show>
    </>
  );
}
