import { FACTIONS, FACTION_LABELS, type CardDto, type UpgradePreviewDto } from '@tq/shared';
import { api, fetchAllCards, newKey, type ApiError } from '../api.ts';
import { gen, state } from '../state.ts';
import { cardHtml, esc, pct } from '../art.ts';
import { playUpgrade } from '../pixi/stage.ts';
import { groupCardsByGeneral, type UpgradeSort } from '../upgrade-groups.ts';

export function renderUpgrade(root: HTMLElement): () => void {
  /** Số thẻ mỗi lần ghép — lấy từ cấu hình server. */
  const N = state.config!.upgradeInputCount;
  let cards: CardDto[] = [];
  let selected: number[] = [];
  let preview: UpgradePreviewDto | null = null;
  let busy = false;
  let pendingKey: string | null = null;
  let alive = true;
  const filter = { faction: '', level: '', sort: 'level_desc' as UpgradeSort };

  root.innerHTML = `
    <section class="panel">
      <h2>Ghép ${N} thẻ</h2>
      <p class="muted">Chọn đúng ${N} thẻ <b>cùng tướng</b> và <b>cùng level</b> (Lv.1–9). Không có thẻ chính/thẻ mồi.</p>
      <div class="quick"></div>
      <div class="groups"></div>
    </section>
    <div class="two-col upgrade-layout">
      <section class="panel">
        <div class="filters">
          <select data-f="faction" aria-label="Phe"><option value="">Mọi phe</option>${FACTIONS.map((f) => `<option value="${f}">${FACTION_LABELS[f]}</option>`).join('')}</select>
          <select data-f="level" aria-label="Level"><option value="">Mọi level</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">Lv.${i + 1}</option>`).join('')}</select>
          <select data-f="sort" aria-label="Sắp xếp nhóm tướng"><option value="level_desc" selected>Level cao nhất</option><option value="ready">Ghép được trước</option><option value="count">Nhiều thẻ nhất</option><option value="name">Tên A→Z</option></select>
        </div>
        <div class="pick-grid"><div class="state-msg">Đang tải thẻ…</div></div>
      </section>
      <section class="panel side">
        <h3>Đã chọn <span class="sel-count">0</span>/${N}</h3>
        <div class="sel-slots"></div>
        <div class="preview"></div>
      </section>
    </div>`;

  const groupsEl = root.querySelector<HTMLDivElement>('.groups')!;
  const quickEl = root.querySelector<HTMLDivElement>('.quick')!;
  /** Nâng cấp nhanh áp dụng cho thẻ ≤ mức này (cấu hình server). */
  const Q = state.config!.quickUpgradeMaxLevel;
  let quickKey: string | null = null;
  let quickSummary = '';
  const gridEl = root.querySelector<HTMLDivElement>('.pick-grid')!;
  const slotsEl = root.querySelector<HTMLDivElement>('.sel-slots')!;
  slotsEl.style.gridTemplateColumns = `repeat(${N}, minmax(0, 1fr))`;
  const previewEl = root.querySelector<HTMLDivElement>('.preview')!;

  const byId = () => new Map(cards.map((c) => [c.id, c]));

  /** Số cặp có thể ghép NGAY ở level ≤ Q (chỉ để hiển thị; server tự tính lại và ghép dây chuyền). */
  function quickPairs(): number {
    const count = new Map<string, number>();
    for (const c of cards) if (c.level <= Q) count.set(`${c.generalId}|${c.level}`, (count.get(`${c.generalId}|${c.level}`) ?? 0) + 1);
    return [...count.values()].reduce((s, n) => s + Math.floor(n / N), 0);
  }

  function renderQuick(confirming = false) {
    const pairs = quickPairs();
    const rates = state.config!.upgradeRates.filter((r) => r.level <= Q);
    quickEl.innerHTML = `
      <div class="quick-box">
        <div class="quick-head">
          <button class="btn primary" data-quick ${busy || pairs === 0 || confirming ? 'disabled' : ''}>⚡ Nâng cấp nhanh (≤ Lv.${Q})</button>
          <span class="muted small">${pairs > 0 ? `${pairs} cặp có thể ghép ngay. Tự ghép liên tục mọi cặp ${N} thẻ cùng tướng, cùng level từ Lv.1 đến Lv.${Q}.` : `Chưa có cặp thẻ nào ≤ Lv.${Q} để ghép nhanh.`}</span>
        </div>
        ${
          confirming
            ? `<div class="quick-confirm">
          <table class="rates"><thead><tr><td>Ghép</td><td>Thành công</td><td>Giữ nguyên</td><td>Tụt</td></tr></thead><tbody>${rates
            .map((r) => {
              const fail = 10000 - r.successBps;
              const keep = r.failureDistribution.find((e) => e.level === r.level)?.bps ?? 0;
              return `<tr><td>Lv.${r.level} → ${r.level + 1}</td><td>${pct(r.successBps)}</td><td>${pct((fail * keep) / 10000)}</td><td>${pct(fail - (fail * keep) / 10000)}</td></tr>`;
            })
            .join('')}</tbody></table>
          <p class="warn">⚠ Mỗi lần ghép tiêu thụ ${N} thẻ, có thể thất bại hoặc tụt level. Thẻ mới tạo ra (≤ Lv.${Q}) sẽ được ghép tiếp. Thẻ trên Lv.${Q} không bị đụng tới.</p>
          <button class="btn ghost" data-quick-no>Huỷ</button> <button class="btn danger" data-quick-yes ${busy ? 'disabled' : ''}>${busy ? 'Đang ghép…' : 'Xác nhận nâng cấp nhanh'}</button>
        </div>`
            : ''
        }
        ${quickSummary ? `<div class="quick-summary" aria-live="polite">${quickSummary}</div>` : ''}
      </div>`;
    quickEl.querySelector<HTMLButtonElement>('[data-quick]')!.onclick = () => renderQuick(true);
    const no = quickEl.querySelector<HTMLButtonElement>('[data-quick-no]');
    if (no) no.onclick = () => renderQuick(false);
    const yes = quickEl.querySelector<HTMLButtonElement>('[data-quick-yes]');
    if (yes) yes.onclick = runQuick;
  }

  async function runQuick() {
    if (busy) return;
    busy = true;
    renderQuick(true);
    quickKey ??= newKey();
    try {
      const r = await api.upgradeQuick(quickKey);
      quickKey = null;
      const byLevel = new Map<number, { n: number; ok: number }>();
      for (const x of r.results) {
        const b = byLevel.get(x.inputLevel) ?? { n: 0, ok: 0 };
        b.n++;
        if (x.outcome === 'success') b.ok++;
        byLevel.set(x.inputLevel, b);
      }
      const best = Math.max(...r.results.map((x) => x.resultLevel));
      quickSummary = `<b>Đã ghép ${r.merges} lần:</b> <span class="ok">${r.successes} thành công</span>, <span class="bad">${r.failures} thất bại</span>. Level cao nhất đạt được: <b>Lv.${best}</b>.
        <div class="small muted">${[...byLevel.entries()].sort((a, b) => a[0] - b[0]).map(([lv, b]) => `Lv.${lv}: ${b.ok}/${b.n} thành công`).join(' · ')}</div>
        ${r.hasMore ? '<div class="small">Vẫn còn cặp có thể ghép — bấm Nâng cấp nhanh lần nữa.</div>' : ''}`;
      busy = false;
      selected = [];
      preview = null;
      await load();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') quickKey = null; // lỗi mạng: giữ key để bấm lại là retry an toàn
      quickSummary = `<span class="error">${esc(err.message)}</span>`;
      busy = false;
      if (err.code === 'NOTHING_TO_UPGRADE') await load();
      else renderQuick(false);
    }
  }

  function renderGroups() {
    const groups = new Map<string, CardDto[]>();
    for (const c of cards) {
      if (c.level >= 10) continue;
      const k = `${c.generalId}|${c.level}`;
      groups.set(k, [...(groups.get(k) ?? []), c]);
    }
    const ready = [...groups.values()].filter((g) => g.length >= N).sort((a, b) => b[0]!.level - a[0]!.level);
    groupsEl.innerHTML = ready.length
      ? `<div class="muted small">Nhóm đủ điều kiện:</div>` +
        ready
          .map((g, i) => `<button class="chip f-${gen(g[0]!.generalId).faction}" data-g="${i}">${esc(gen(g[0]!.generalId).name)} Lv.${g[0]!.level} ×${g.length}</button>`)
          .join('')
      : `<div class="muted small">Chưa có nhóm ${N} thẻ cùng tướng & cùng level nào.</div>`;
    groupsEl.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((b) => {
      b.onclick = () => {
        selected = ready[Number(b.dataset.g)]!.slice(0, N).map((c) => c.id);
        onSelectionChange();
      };
    });
  }

  function selectable(c: CardDto): boolean {
    if (c.level >= 10) return false;
    const first = byId().get(selected[0] ?? -1);
    if (!first) return true;
    return c.generalId === first.generalId && c.level === first.level;
  }

  function renderGrid() {
    const list = cards.filter((c) => {
      if (filter.faction && gen(c.generalId).faction !== filter.faction) return false;
      if (filter.level && c.level !== Number(filter.level)) return false;
      return true;
    });
    if (cards.length === 0) {
      gridEl.innerHTML = `<div class="state-msg">Bạn chưa có thẻ nào để ghép.</div>`;
      return;
    }
    if (list.length === 0) {
      gridEl.innerHTML = `<div class="state-msg">Không có thẻ phù hợp bộ lọc.</div>`;
      return;
    }
    // Gom theo tướng: mọi bản sao cùng tướng nằm liền nhau, chia nhóm con theo level.
    const groups = groupCardsByGeneral(list, (id) => gen(id).name, filter.sort, N);
    const pickBtn = (c: CardDto) => {
      const on = selected.includes(c.id);
      const dis = !on && (!selectable(c) || selected.length >= N);
      return `<button class="pick ${on ? 'on' : ''}" data-id="${c.id}" ${dis ? 'disabled' : ''} aria-pressed="${on}">${cardHtml(gen(c.generalId), c.level, 'small')}<span class="cid">#${c.id}</span></button>`;
    };
    gridEl.innerHTML = groups
      .map((g) => {
        const f = gen(g.generalId).faction;
        return `
        <div class="gen-group f-${f}">
          <div class="gen-head">
            <b>${esc(g.name)}</b><span class="muted small">${FACTION_LABELS[f]} · ${g.total} thẻ</span>
            ${g.bestReadyLevel ? `<span class="ready-tag">Ghép được</span>` : ''}
          </div>
          <div class="gen-runs">${g.runs
            .map(
              (r) => `
            <div class="lv-run ${r.ready ? 'ready' : ''}">
              <div class="run-label">Lv.${r.level} ×${r.cards.length}${r.ready ? ` · đủ ghép${r.cards.length >= 2 * N ? ` ${Math.floor(r.cards.length / N)} lần` : ''}` : ''}</div>
              <div class="run-cards">${r.cards.map(pickBtn).join('')}</div>
            </div>`,
            )
            .join('')}</div>
        </div>`;
      })
      .join('');
    gridEl.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.id);
        selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
        onSelectionChange();
      };
    });
  }

  function renderSide() {
    root.querySelector('.sel-count')!.textContent = String(selected.length);
    const m = byId();
    slotsEl.innerHTML = Array.from({ length: N }, (_, i) => i)
      .map((i) => {
        const c = m.get(selected[i] ?? -1);
        return c
          ? `<button class="slot" data-unpick="${c.id}" title="Bỏ chọn thẻ này" ${busy ? 'disabled' : ''}>${cardHtml(gen(c.generalId), c.level, 'small')}</button>`
          : `<div class="slot empty">Trống</div>`;
      })
      .join('');
    slotsEl.querySelectorAll<HTMLButtonElement>('[data-unpick]').forEach((b) => {
      b.onclick = () => {
        if (busy) return;
        selected = selected.filter((id) => id !== Number(b.dataset.unpick));
        void onSelectionChange();
      };
    });

    const cancelBtn = selected.length ? `<button class="btn ghost" data-clear ${busy ? 'disabled' : ''}>Huỷ</button>` : '';
    const wireClear = () => {
      const b = previewEl.querySelector<HTMLButtonElement>('[data-clear]');
      if (b)
        b.onclick = () => {
          if (busy) return;
          selected = [];
          void onSelectionChange();
        };
    };

    if (selected.length < N) {
      previewEl.innerHTML = `<p class="muted">Chọn thêm ${N - selected.length} thẻ.</p>${cancelBtn ? `<div class="confirm-area">${cancelBtn}</div>` : ''}`;
      wireClear();
      return;
    }
    if (!preview) {
      previewEl.innerHTML = `<p class="muted">Đang tính tỷ lệ…</p><div class="confirm-area">${cancelBtn}</div>`;
      wireClear();
      return;
    }
    const p = preview;
    previewEl.innerHTML = `
      <div class="odds">
        <div class="ok">Thành công <b>${pct(p.successBps, p.bpsScale)}</b> → Lv.${p.successLevel}</div>
        <div class="bad">Thất bại <b>${pct(p.failureBps, p.bpsScale)}</b></div>
      </div>
      <h4>Nếu thất bại, thẻ nhận được:</h4>
      <table class="rates"><tbody>${p.failureDistribution
        .map((e) => `<tr><td>${e.level === p.inputLevel ? `Giữ nguyên Lv.${e.level}` : `Về Lv.${e.level}`}</td><td>${pct(e.bps, p.bpsScale)}</td></tr>`)
        .join('')}</tbody></table>
      <p class="warn">⚠ Cả ${N} thẻ đầu vào sẽ bị tiêu thụ dù thành công hay thất bại. Bạn luôn nhận lại đúng 1 thẻ ${esc(gen(p.generalId).name)}.</p>
      <p class="muted small">Tỷ lệ chỉ để tham khảo; server tính lại khi thực hiện.</p>
      <div class="confirm-area">${cancelBtn} <button class="btn primary" data-go ${busy ? 'disabled' : ''}>Ghép thẻ</button></div>
      <div class="up-msg error" aria-live="polite"></div>`;
    previewEl.querySelector<HTMLButtonElement>('[data-go]')!.onclick = showConfirm;
    wireClear();
  }

  function showConfirm() {
    const area = previewEl.querySelector<HTMLDivElement>('.confirm-area')!;
    area.innerHTML = `<p><b>Xác nhận ghép?</b> ${N} thẻ sẽ bị tiêu thụ.</p>
      <button class="btn ghost" data-no>Quay lại</button> <button class="btn danger" data-yes>Xác nhận ghép</button>`;
    area.querySelector<HTMLButtonElement>('[data-no]')!.onclick = renderSide;
    area.querySelector<HTMLButtonElement>('[data-yes]')!.onclick = attempt;
  }

  async function attempt() {
    if (busy || selected.length !== N) return;
    busy = true;
    previewEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
    pendingKey ??= newKey();
    const ids = [...selected];
    const inputCard = byId().get(ids[0]!)!;
    try {
      const r = await api.upgradeAttempt(ids, pendingKey);
      pendingKey = null;
      selected = [];
      preview = null;
      const g = gen(r.resultCard.generalId);
      const caption =
        r.outcome === 'success'
          ? `Thành công! ${g.name} Lv.${r.inputLevel} ×${r.inputCardIds.length} → Lv.${r.resultCard.level}`
          : `Thất bại. ${r.inputCardIds.length} thẻ Lv.${r.inputLevel} → nhận ${g.name} Lv.${r.resultCard.level}`;
      busy = false;
      await load();
      await playUpgrade(g, inputCard.level, r.resultCard.level, r.outcome, caption, r.inputCardIds.length);
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') pendingKey = null;
      busy = false;
      renderSide();
      const m = previewEl.querySelector('.up-msg');
      if (m) m.textContent = err.message;
      if (err.code === 'CARD_CONSUMED' || err.code === 'CARD_NOT_FOUND') {
        selected = [];
        await load();
      }
    }
  }

  async function onSelectionChange() {
    preview = null;
    pendingKey = null;
    renderGrid();
    renderSide();
    if (selected.length === N) {
      const ids = [...selected];
      try {
        const p = await api.upgradePreview(ids);
        if (alive && ids.join() === selected.join()) {
          preview = p;
          renderSide();
        }
      } catch (e) {
        previewEl.innerHTML = `<p class="error">${esc((e as Error).message)}</p>`;
      }
    }
  }

  root.querySelectorAll<HTMLSelectElement>('[data-f]').forEach((el) => {
    el.oninput = () => {
      (filter as Record<string, string>)[el.dataset.f!] = el.value;
      renderGrid();
    };
  });

  async function load() {
    try {
      cards = await fetchAllCards();
      if (!alive) return;
      selected = selected.filter((id) => cards.some((c) => c.id === id));
      renderQuick(false);
      renderGroups();
      renderGrid();
      renderSide();
    } catch (e) {
      if (alive) gridEl.innerHTML = `<div class="state-msg error">Không tải được thẻ: ${esc((e as Error).message)}</div>`;
    }
  }
  void load();
  return () => (alive = false);
}
