import { FACTIONS, FACTION_LABELS, type CardDto, type RecipientDto } from '@tq/shared';
import { api, fetchAllCards, newKey, type ApiError } from '../api.ts';
import { gen, state } from '../state.ts';
import { cardHtml, esc } from '../art.ts';
import { groupCardsByGeneral, type UpgradeSort } from '../upgrade-groups.ts';
import { openCardViewer } from '../viewer.ts';

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** "5 phút trước", "3 giờ trước", "2 ngày trước". */
function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  if (m < 60 * 24) return `${Math.round(m / 60)} giờ trước`;
  return `${Math.round(m / 1440)} ngày trước`;
}

/**
 * Bộ sưu tập (mục 6.1) + Tặng thẻ (mục 5.6).
 * - Thẻ gom theo tướng: mọi bản sao cùng tướng nằm chung một khung, level cao → thấp.
 * - Chế độ xem "Tướng chưa có" hiện các tướng chưa sở hữu (mờ).
 * - Bật "Tặng thẻ" để chọn tối đa GIFT_MAX_CARDS thẻ và người nhận (dropdown có tìm kiếm,
 *   người giao dịch gần nhất lên đầu). Server kiểm tra lại toàn bộ và chuyển thẻ nguyên tử.
 */
export function renderCollection(root: HTMLElement): () => void {
  const MAX = state.config!.giftMaxCards;
  let cards: CardDto[] = [];
  let alive = true;
  const filter = { q: '', faction: '', level: '', view: 'mine', sort: 'level_desc' as UpgradeSort };

  // --- trạng thái tặng thẻ
  let giftMode = false;
  let selected: number[] = [];
  let busy = false;
  let confirming = false;
  let recipients: RecipientDto[] = [];
  let recipientsLoaded = false;
  let pending: { key: string; sig: string } | null = null;

  root.innerHTML = `
    <section class="panel">
      <div class="coll-head">
        <div class="summary muted"></div>
        <button class="btn primary small" data-gift-toggle>🎁 Tặng thẻ</button>
      </div>
      <div class="gift-panel" hidden>
        <p class="muted small">Chọn tối đa <b>${MAX} thẻ</b> bên dưới rồi chọn người nhận. Người nhận có thẻ ngay; thẻ đã tặng không lấy lại được.</p>
        <div class="gift-form">
          <div class="combo">
            <label for="gift-to">Người nhận</label>
            <input id="gift-to" data-to placeholder="Tìm người chơi…" maxlength="32" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="gift-to-list" />
            <ul class="combo-list" id="gift-to-list" role="listbox" hidden></ul>
          </div>
          <span class="gift-count muted"></span>
          <button class="btn ghost small" data-clear>Bỏ chọn</button>
          <button class="btn primary" data-send>Tặng</button>
        </div>
        <div class="gift-confirm"></div>
        <div class="gift-msg" aria-live="polite"></div>
      </div>
      <div class="filters">
        <input type="search" placeholder="Tìm theo tên tướng…" data-f="q" aria-label="Tìm tướng" />
        <select data-f="faction" aria-label="Phe"><option value="">Mọi phe</option>${FACTIONS.map((f) => `<option value="${f}">${FACTION_LABELS[f]}</option>`).join('')}</select>
        <select data-f="level" aria-label="Level"><option value="">Mọi level</option>${Array.from({ length: 10 }, (_, i) => `<option value="${i + 1}">Lv.${i + 1}</option>`).join('')}</select>
        <select data-f="sort" aria-label="Sắp xếp"><option value="level_desc" selected>Level cao nhất</option><option value="name">Tên A→Z</option><option value="count">Nhiều thẻ nhất</option></select>
        <select data-f="view" aria-label="Chế độ xem"><option value="mine">Thẻ của tôi</option><option value="missing">Tướng chưa có</option></select>
      </div>
    </section>
    <div class="pick-grid"><div class="state-msg">Đang tải bộ sưu tập…</div></div>`;

  const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
  const summary = $<HTMLDivElement>('.summary');
  const gridEl = $<HTMLDivElement>('.pick-grid');
  const giftPanel = $<HTMLDivElement>('.gift-panel');
  const toggleBtn = $<HTMLButtonElement>('[data-gift-toggle]');
  const toEl = $<HTMLInputElement>('[data-to]');
  const listEl = $<HTMLUListElement>('.combo-list');
  const countEl = $<HTMLSpanElement>('.gift-count');
  const sendBtn = $<HTMLButtonElement>('[data-send]');
  const confirmEl = $<HTMLDivElement>('.gift-confirm');
  const msgEl = $<HTMLDivElement>('.gift-msg');

  // ================= Lưới thẻ =================
  function render() {
    const ownedIds = new Set(cards.map((c) => c.generalId));
    summary.textContent = `Đã sở hữu ${ownedIds.size}/${state.generals.length} tướng · ${cards.length} thẻ`;
    const q = fold(filter.q.trim());
    const matchGeneral = (id: string) => {
      const g = gen(id);
      return (!filter.faction || g.faction === filter.faction) && (!q || fold(g.name).includes(q));
    };

    if (filter.view === 'missing') {
      const missing = state.generals.filter((g) => !ownedIds.has(g.id) && matchGeneral(g.id));
      gridEl.innerHTML = missing.length
        ? `<div class="grid">${missing.map((g) => `<div class="grid-item">${cardHtml(g, null)}</div>`).join('')}</div>`
        : `<div class="state-msg">${ownedIds.size === state.generals.length ? `Bạn đã sở hữu đủ ${state.generals.length} tướng!` : 'Không có tướng phù hợp bộ lọc.'}</div>`;
      return;
    }

    const list = cards.filter((c) => matchGeneral(c.generalId) && (!filter.level || c.level === Number(filter.level)));
    if (cards.length === 0) {
      gridEl.innerHTML = '<div class="state-msg">Bạn chưa có thẻ nào. Hãy quay thẻ ở tab Quay thẻ.</div>';
      return;
    }
    if (list.length === 0) {
      gridEl.innerHTML = '<div class="state-msg">Không có thẻ phù hợp bộ lọc.</div>';
      return;
    }
    // Gom theo tướng; inputCount rất lớn để không đánh dấu "đủ ghép" ở trang này
    const groups = groupCardsByGeneral(list, (id) => gen(id).name, filter.sort, Number.MAX_SAFE_INTEGER);
    gridEl.innerHTML = groups
      .map((g) => {
        const f = gen(g.generalId).faction;
        // Giống trang Nâng cấp: chia nhóm theo level ("Lv.1 ×3"), mỗi thẻ hiện số thẻ #id
        const cardEl = (c: CardDto) => {
          if (!giftMode)
            return `<button class="pick view" data-view="${c.id}" title="Xem thẻ">${cardHtml(gen(c.generalId), c.level, 'small')}<span class="cid">#${c.id}</span></button>`;
          const on = selected.includes(c.id);
          const dis = !on && (busy || selected.length >= MAX);
          return `<button class="pick ${on ? 'on' : ''}" data-id="${c.id}" ${dis ? 'disabled' : ''} aria-pressed="${on}">${cardHtml(gen(c.generalId), c.level, 'small')}<span class="cid">#${c.id}</span></button>`;
        };
        return `<div class="gen-group f-${f}">
          <div class="gen-head"><b>${esc(g.name)}</b><span class="muted small">${FACTION_LABELS[f]} · ${g.total} thẻ</span></div>
          <div class="gen-runs">${g.runs
            .map(
              (r) => `<div class="lv-run">
                <div class="run-label">Lv.${r.level} ×${r.cards.length}</div>
                <div class="run-cards">${r.cards.map(cardEl).join('')}</div>
              </div>`,
            )
            .join('')}</div>
        </div>`;
      })
      .join('');
    // Chế độ xem: bấm thẻ để mở popup ngắm thẻ
    gridEl.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => {
      b.onclick = () => {
        const c = cards.find((x) => x.id === Number(b.dataset.view));
        if (c) openCardViewer(gen(c.generalId), c);
      };
    });
    gridEl.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.id);
        selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id].slice(0, MAX);
        closeConfirm();
        render();
        renderBar();
      };
    });
  }

  // ================= Người nhận (combobox) =================
  const findRecipient = (name: string) => recipients.find((r) => r.username.toLowerCase() === name.trim().toLowerCase());

  async function loadRecipients() {
    try {
      recipients = (await api.users()).items;
      recipientsLoaded = true;
      if (document.activeElement === toEl) renderList();
      renderBar();
    } catch (e) {
      msgEl.innerHTML = `<span class="error">Không tải được danh sách người chơi: ${esc((e as Error).message)}</span>`;
    }
  }

  let activeIdx = -1;
  function renderList() {
    const q = fold(toEl.value.trim());
    const items = recipients.filter((r) => !q || fold(r.username).includes(q)).slice(0, 50);
    activeIdx = Math.min(activeIdx, items.length - 1);
    listEl.innerHTML = !recipientsLoaded
      ? '<li class="muted small">Đang tải…</li>'
      : items.length
        ? items
            .map(
              (r, i) =>
                `<li role="option" data-name="${esc(r.username)}" class="${i === activeIdx ? 'active' : ''}" aria-selected="${i === activeIdx}">
                  <span>${esc(r.username)}</span>${r.lastGiftAt ? `<span class="recent">Gần đây · ${ago(r.lastGiftAt)}</span>` : ''}
                </li>`,
            )
            .join('')
        : '<li class="muted small">Không tìm thấy người chơi.</li>';
    listEl.hidden = false;
    toEl.setAttribute('aria-expanded', 'true');
    listEl.querySelectorAll<HTMLLIElement>('[data-name]').forEach((li) => {
      li.onmousedown = (ev) => {
        ev.preventDefault(); // giữ focus, tránh blur trước khi chọn
        pick(li.dataset.name!);
      };
    });
  }
  function hideList() {
    listEl.hidden = true;
    toEl.setAttribute('aria-expanded', 'false');
    activeIdx = -1;
  }
  function pick(name: string) {
    toEl.value = name;
    hideList();
    closeConfirm();
    msgEl.innerHTML = '';
    renderBar();
  }
  toEl.onfocus = () => renderList();
  toEl.onblur = () => setTimeout(hideList, 100);
  toEl.oninput = () => {
    activeIdx = -1;
    closeConfirm();
    msgEl.innerHTML = '';
    renderList();
    renderBar();
  };
  toEl.onkeydown = (ev) => {
    const opts = [...listEl.querySelectorAll<HTMLLIElement>('[data-name]')];
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (listEl.hidden) renderList();
      activeIdx = Math.max(0, Math.min(opts.length - 1, activeIdx + (ev.key === 'ArrowDown' ? 1 : -1)));
      renderList();
    } else if (ev.key === 'Enter' && activeIdx >= 0 && opts[activeIdx]) {
      ev.preventDefault();
      pick(opts[activeIdx]!.dataset.name!);
    } else if (ev.key === 'Escape') {
      hideList();
    }
  };

  // ================= Thanh tặng thẻ =================
  function renderBar() {
    countEl.textContent = `Đã chọn ${selected.length}/${MAX}`;
    const valid = !!findRecipient(toEl.value);
    sendBtn.disabled = busy || confirming || selected.length === 0 || !valid;
    sendBtn.textContent = busy ? 'Đang tặng…' : selected.length ? `Tặng ${selected.length} thẻ` : 'Tặng';
    sendBtn.title = !valid && toEl.value.trim() ? 'Chọn người nhận trong danh sách' : '';
  }
  function closeConfirm() {
    confirming = false;
    confirmEl.innerHTML = '';
  }

  function showConfirm() {
    const r = findRecipient(toEl.value);
    if (!r) return;
    const byId = new Map(cards.map((c) => [c.id, c]));
    const picked = selected.map((id) => byId.get(id)).filter((c): c is CardDto => !!c);
    const hi = picked.filter((c) => c.level >= 6).length;
    confirming = true;
    renderBar();
    confirmEl.innerHTML = `
      <div class="quick-box">
        <p><b>Xác nhận tặng ${picked.length} thẻ cho "${esc(r.username)}"?</b></p>
        <div class="result-cards">${picked.map((c) => cardHtml(gen(c.generalId), c.level, 'small')).join('')}</div>
        <p class="warn">⚠ Thẻ sẽ chuyển ngay sang người nhận và không thể lấy lại.${hi ? ` Trong đó có ${hi} thẻ từ Lv.6 trở lên.` : ''}</p>
        <button class="btn ghost" data-no>Huỷ</button> <button class="btn danger" data-yes>Xác nhận tặng</button>
      </div>`;
    confirmEl.querySelector<HTMLButtonElement>('[data-no]')!.onclick = () => {
      closeConfirm();
      renderBar();
    };
    confirmEl.querySelector<HTMLButtonElement>('[data-yes]')!.onclick = () => void send(r.username);
  }

  async function send(to: string) {
    if (busy) return;
    busy = true;
    confirmEl.querySelectorAll('button').forEach((b) => (b.disabled = true));
    renderBar();
    const ids = [...selected].sort((a, b) => a - b);
    const sig = `${to.toLowerCase()}|${ids.join(',')}`;
    // Giữ key khi lỗi mạng để bấm lại là retry an toàn (server không chuyển thẻ 2 lần)
    if (!pending || pending.sig !== sig) pending = { key: newKey(), sig };
    try {
      const r = await api.gift(to, ids, pending.key);
      pending = null;
      selected = [];
      closeConfirm();
      msgEl.innerHTML = `<span class="ok">✓ Đã tặng ${r.cards.length} thẻ cho <b>${esc(r.toUsername)}</b>.</span>`;
      busy = false;
      await Promise.all([load(), loadRecipients()]); // người vừa nhận lên đầu danh sách
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== 'NETWORK') pending = null;
      busy = false;
      closeConfirm();
      msgEl.innerHTML = `<span class="error">${esc(err.message)}</span>`;
      if (err.code === 'CARD_NOT_FOUND' || err.code === 'CARD_CONSUMED') {
        selected = [];
        await load();
      } else {
        render();
        renderBar();
      }
    }
  }

  // ================= Sự kiện chung =================
  toggleBtn.onclick = () => {
    giftMode = !giftMode;
    giftPanel.hidden = !giftMode;
    toggleBtn.textContent = giftMode ? 'Đóng tặng thẻ' : '🎁 Tặng thẻ';
    toggleBtn.className = giftMode ? 'btn ghost small' : 'btn primary small';
    if (giftMode) {
      if (filter.view !== 'mine') {
        filter.view = 'mine';
        $<HTMLSelectElement>('[data-f="view"]').value = 'mine';
      }
      if (!recipientsLoaded) void loadRecipients();
    } else {
      selected = [];
      closeConfirm();
      msgEl.innerHTML = '';
    }
    render();
    renderBar();
  };
  sendBtn.onclick = () => {
    msgEl.innerHTML = '';
    showConfirm();
  };
  $<HTMLButtonElement>('[data-clear]').onclick = () => {
    selected = [];
    closeConfirm();
    render();
    renderBar();
  };
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-f]').forEach((el) => {
    el.oninput = () => {
      (filter as Record<string, string>)[el.dataset.f!] = el.value;
      render();
    };
  });

  async function load() {
    try {
      cards = await fetchAllCards();
      if (!alive) return;
      selected = selected.filter((id) => cards.some((c) => c.id === id));
      render();
      renderBar();
    } catch (e) {
      if (alive) gridEl.innerHTML = `<div class="state-msg error">Không tải được bộ sưu tập: ${esc((e as Error).message)}</div>`;
    }
  }
  renderBar();
  void load();
  return () => (alive = false);
}
