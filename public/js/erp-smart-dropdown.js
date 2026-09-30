/*
 * ERP Universal Smart Dropdown
 * Applies one searchable, capped dropdown behavior to all header search dropdowns.
 * No per-app endpoint changes required. Existing dropdown item click handlers are preserved.
 */
(function () {
  'use strict';

  const CONFIG = {
    selectors: [
      '.header-controls .dropdown > button[data-bs-toggle="dropdown"]',
      '.dropdown > button[id*="search"][data-bs-toggle="dropdown"]',
      '.dropdown > button[id*="Search"][data-bs-toggle="dropdown"]',
      '.dropdown > button[id*="floorDataSearch"][data-bs-toggle="dropdown"]'
    ].join(','),
    maxInitialRows: 25,
    maxSearchRows: 80,
    minSearchHintCount: 26,
    debounceMs: 80,
    storagePrefix: 'weaving_erp_recent_dropdown_',
    recentLimit: 8
  };

  function injectCss() {
    if (document.getElementById('erp-smart-dropdown-css')) return;
    const style = document.createElement('style');
    style.id = 'erp-smart-dropdown-css';
    style.textContent = `
.dropdown-menu.erp-smart-menu {
  min-width: 340px;
  max-width: min(92vw, 620px);
  max-height: min(68vh, 440px);
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 0 !important;
  border: 1px solid rgba(0,196,255,.22) !important;
  box-shadow: 0 18px 48px rgba(0,0,0,.48) !important;
  z-index: 2200 !important;
  scrollbar-width: thin;
  scrollbar-color: rgba(0,196,255,.35) transparent;
}
.dropdown-menu.erp-smart-menu::-webkit-scrollbar { width: 6px; }
.dropdown-menu.erp-smart-menu::-webkit-scrollbar-thumb { background: rgba(0,196,255,.35); border-radius: 4px; }
.erp-smart-control { list-style: none; }
.erp-smart-search-row {
  position: sticky;
  top: 0;
  z-index: 2;
  padding: 9px 10px;
  background: #222;
  border-bottom: 1px solid rgba(255,255,255,.08);
}
.erp-smart-search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(0,196,255,.22);
  border-radius: 9px;
  padding: 7px 9px;
}
.erp-smart-search-box i { color: #00c4ff; font-size: 12px; flex: 0 0 auto; }
.erp-smart-search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0 !important;
  outline: 0 !important;
  background: transparent !important;
  color: #e8e8e8 !important;
  box-shadow: none !important;
  padding: 0 !important;
  margin: 0 !important;
  font-size: 13px !important;
  line-height: 1.4 !important;
  height: auto !important;
  font-family: inherit !important;
}
.erp-smart-search-input::placeholder { color: rgba(255,255,255,.38); }
.erp-smart-clear {
  border: 0;
  background: transparent;
  color: rgba(255,255,255,.42);
  padding: 0 3px;
  cursor: pointer;
  font-size: 15px;
  line-height: 1;
}
.erp-smart-clear:hover { color: #fff; }
.erp-smart-status-row {
  position: sticky;
  top: 50px;
  z-index: 1;
  padding: 5px 12px 6px;
  background: #2a2a2a;
  color: rgba(255,255,255,.48);
  border-bottom: 1px solid rgba(255,255,255,.06);
  font-size: 11px;
  line-height: 1.35;
  white-space: normal;
}
.dropdown-menu.erp-smart-menu .dropdown-item.erp-smart-hidden,
.dropdown-menu.erp-smart-menu li.erp-smart-hidden { display: none !important; }
.dropdown-menu.erp-smart-menu .dropdown-item.erp-smart-focused {
  background: rgba(0,196,255,.14) !important;
  color: #fff !important;
}
.dropdown-menu.erp-smart-menu .dropdown-item {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dropdown-menu.erp-smart-menu .erp-smart-empty {
  padding: 15px 13px;
  color: rgba(255,255,255,.42);
  font-size: 13px;
  font-style: italic;
  list-style: none;
}
.erp-smart-kbd {
  margin-left: 6px;
  color: rgba(255,255,255,.34);
  background: rgba(255,255,255,.07);
  border: 1px solid rgba(255,255,255,.1);
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 10px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (max-width: 576px) {
  .dropdown-menu.erp-smart-menu { min-width: 290px; max-width: 94vw; }
  .erp-smart-status-row { top: 48px; }
}
`;
    document.head.appendChild(style);
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function norm(s) {
    return String(s || '').toLowerCase().replace(/[\s\-_/\\.,:;()\[\]{}]+/g, '');
  }

  function scoreMatch(query, text) {
    if (!query) return 1;
    const q = norm(query);
    const t = norm(text);
    if (!q) return 1;
    if (!t) return 0;
    if (t === q) return 1000;
    if (t.startsWith(q)) return 850;
    const idx = t.indexOf(q);
    if (idx >= 0) return 700 - idx;

    let qi = 0;
    let score = 0;
    let streak = 0;
    for (let i = 0; i < t.length && qi < q.length; i += 1) {
      if (t[i] === q[qi]) {
        streak += 1;
        score += 7 + streak;
        qi += 1;
      } else {
        streak = 0;
      }
    }
    return qi === q.length ? score : 0;
  }

  function getMenuForButton(btn) {
    const holder = btn.closest('.dropdown') || btn.parentElement;
    if (!holder) return null;
    let menu = null;
    if (btn.id) {
      menu = holder.querySelector(`.dropdown-menu[aria-labelledby="${btn.id}"]`);
    }
    return menu || holder.querySelector('.dropdown-menu');
  }


  function isAsyncManagedMenu(menu) {
    return !!(menu && (menu.dataset.erpAsyncManaged === '1' || menu.classList.contains('erp-async-menu')));
  }

  function getItemRows(menu) {
    return Array.from(menu.children).filter(li => {
      if (!(li instanceof HTMLElement)) return false;
      if (li.dataset.erpSmartControl === '1') return false;
      return li.querySelector('.dropdown-item');
    });
  }

  function rowText(row) {
    const item = row.querySelector('.dropdown-item');
    return (item ? item.textContent : row.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function isSelectable(row) {
    const item = row.querySelector('.dropdown-item');
    if (!item) return false;
    return !item.classList.contains('disabled') && !item.hasAttribute('disabled') && item.getAttribute('aria-disabled') !== 'true';
  }

  function getStorageKey(btn) {
    return CONFIG.storagePrefix + (btn.id || btn.textContent || 'dropdown').replace(/\W+/g, '_');
  }

  function loadRecent(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }

  function saveRecent(key, value) {
    if (!value) return;
    try {
      const next = [value, ...loadRecent(key).filter(x => x !== value)].slice(0, CONFIG.recentLimit);
      localStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }

  function ensureControls(btn, menu) {
    let searchInput = menu.querySelector(':scope > [data-erp-smart-control="1"] .erp-smart-search-input');
    if (searchInput) return searchInput;

    const searchLi = document.createElement('li');
    searchLi.className = 'erp-smart-control erp-smart-search-row';
    searchLi.dataset.erpSmartControl = '1';
    searchLi.innerHTML = `
      <div class="erp-smart-search-box">
        <i class="fas fa-search" aria-hidden="true"></i>
        <input class="erp-smart-search-input" type="text" autocomplete="off" spellcheck="false" placeholder="Type to search records..." aria-label="Search dropdown records">
        <button class="erp-smart-clear" type="button" aria-label="Clear search">×</button>
      </div>`;

    const statusLi = document.createElement('li');
    statusLi.className = 'erp-smart-control erp-smart-status-row';
    statusLi.dataset.erpSmartControl = '1';
    statusLi.textContent = 'Type to filter records.';

    menu.insertBefore(statusLi, menu.firstChild);
    menu.insertBefore(searchLi, statusLi);

    searchInput = searchLi.querySelector('.erp-smart-search-input');
    const clearBtn = searchLi.querySelector('.erp-smart-clear');

    const apply = debounce(() => applyFilter(btn, menu), CONFIG.debounceMs);
    searchInput.addEventListener('input', apply);
    searchInput.addEventListener('click', e => e.stopPropagation());
    searchInput.addEventListener('keydown', e => handleInputKeys(e, btn, menu));
    clearBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      searchInput.value = '';
      applyFilter(btn, menu);
      searchInput.focus();
    });

    return searchInput;
  }

  function setStatus(menu, text) {
    const status = menu.querySelector(':scope > .erp-smart-status-row');
    if (status) status.textContent = text;
  }

  function clearFocus(menu) {
    menu.querySelectorAll('.dropdown-item.erp-smart-focused').forEach(el => el.classList.remove('erp-smart-focused'));
  }

  function visibleSelectableItems(menu) {
    return getItemRows(menu)
      .filter(row => !row.classList.contains('erp-smart-hidden') && isSelectable(row))
      .map(row => row.querySelector('.dropdown-item'))
      .filter(Boolean);
  }

  function setFocus(menu, idx) {
    const items = visibleSelectableItems(menu);
    if (!items.length) return;
    const safeIdx = ((idx % items.length) + items.length) % items.length;
    clearFocus(menu);
    const item = items[safeIdx];
    item.classList.add('erp-smart-focused');
    item.scrollIntoView({ block: 'nearest' });
    menu.dataset.erpSmartFocusIndex = String(safeIdx);
  }

  function handleInputKeys(e, btn, menu) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (e.key === 'ArrowDown') {
      const current = Number(menu.dataset.erpSmartFocusIndex || -1);
      setFocus(menu, current + 1);
    } else if (e.key === 'ArrowUp') {
      const current = Number(menu.dataset.erpSmartFocusIndex || 0);
      setFocus(menu, current - 1);
    } else if (e.key === 'Enter') {
      const focused = menu.querySelector('.dropdown-item.erp-smart-focused');
      if (focused) focused.click();
    } else if (e.key === 'Escape') {
      hideDropdown(btn);
    }
  }

  function applyFilter(btn, menu) {
    if (menu.dataset.erpSmartMutating === '1') return;
    menu.dataset.erpSmartMutating = '1';

    ensureControls(btn, menu);
    const input = menu.querySelector('.erp-smart-search-input');
    const q = input ? input.value.trim() : '';
    const rows = getItemRows(menu);
    const selectableRows = rows.filter(isSelectable);
    clearFocus(menu);
    menu.dataset.erpSmartFocusIndex = '-1';

    menu.querySelectorAll(':scope > .erp-smart-empty').forEach(el => el.remove());

    if (!selectableRows.length) {
      rows.forEach(row => row.classList.remove('erp-smart-hidden'));
      setStatus(menu, 'No selectable records found.');
      menu.dataset.erpSmartMutating = '0';
      return;
    }

    if (!q) {
      const recent = loadRecent(getStorageKey(btn));
      let shown = 0;
      rows.forEach((row, idx) => {
        row.dataset.erpSmartOrder = row.dataset.erpSmartOrder || String(idx);
        const text = rowText(row);
        const showAsRecent = recent.includes(text);
        const shouldShow = isSelectable(row) && (showAsRecent || shown < CONFIG.maxInitialRows);
        if (shouldShow && !showAsRecent) shown += 1;
        row.classList.toggle('erp-smart-hidden', !shouldShow);
      });
      const total = selectableRows.length;
      const recentCount = Math.min(recent.length, total);
      setStatus(menu, total >= CONFIG.minSearchHintCount
        ? `Showing latest ${Math.min(CONFIG.maxInitialRows, total)} of ${total}. Type to search all records.${recentCount ? ' Recent selections are also kept visible.' : ''}`
        : `Showing ${total} record${total === 1 ? '' : 's'}.`);
      menu.dataset.erpSmartMutating = '0';
      return;
    }

    let matches = selectableRows
      .map((row, idx) => ({ row, score: scoreMatch(q, rowText(row)), order: Number(row.dataset.erpSmartOrder || idx) }))
      .filter(x => x.score > 0)
      .sort((a, b) => (b.score - a.score) || (a.order - b.order));

    const allowed = new Set(matches.slice(0, CONFIG.maxSearchRows).map(x => x.row));
    rows.forEach(row => row.classList.toggle('erp-smart-hidden', !allowed.has(row)));

    if (!matches.length) {
      const empty = document.createElement('li');
      empty.className = 'erp-smart-control erp-smart-empty';
      empty.dataset.erpSmartControl = '1';
      empty.textContent = 'No matching records.';
      menu.appendChild(empty);
      setStatus(menu, `No results for "${q}".`);
    } else {
      setStatus(menu, `Found ${matches.length}. Showing ${Math.min(matches.length, CONFIG.maxSearchRows)} best match${Math.min(matches.length, CONFIG.maxSearchRows) === 1 ? '' : 'es'}.`);
    }

    menu.dataset.erpSmartMutating = '0';
  }

  function showDropdown(btn) {
    if (window.bootstrap && window.bootstrap.Dropdown) {
      window.bootstrap.Dropdown.getOrCreateInstance(btn).show();
    } else {
      btn.click();
    }
  }

  function hideDropdown(btn) {
    if (window.bootstrap && window.bootstrap.Dropdown) {
      const inst = window.bootstrap.Dropdown.getOrCreateInstance(btn);
      inst.hide();
    } else {
      const menu = getMenuForButton(btn);
      if (menu) menu.classList.remove('show');
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  function focusSearch(btn, menu) {
    if (isAsyncManagedMenu(menu)) return;
    ensureControls(btn, menu);
    applyFilter(btn, menu);
    const input = menu.querySelector('.erp-smart-search-input');
    if (input) setTimeout(() => input.focus(), 40);
  }

  function enhance(btn) {
    if (!btn || btn.dataset.erpSmartReady === '1') return;
    const menu = getMenuForButton(btn);
    if (!menu || isAsyncManagedMenu(menu)) return;

    btn.dataset.erpSmartReady = '1';
    menu.classList.add('erp-smart-menu');
    menu.dataset.erpSmartMutating = '0';

    ensureControls(btn, menu);
    applyFilter(btn, menu);

    btn.addEventListener('shown.bs.dropdown', () => focusSearch(btn, menu));
    btn.addEventListener('click', () => setTimeout(() => {
      if (!isAsyncManagedMenu(menu) && menu.classList.contains('show')) focusSearch(btn, menu);
    }, 80));

    menu.addEventListener('click', e => {
      const item = e.target.closest('.dropdown-item');
      if (item && !item.classList.contains('disabled')) saveRecent(getStorageKey(btn), item.textContent.replace(/\s+/g, ' ').trim());
    });

    const observer = new MutationObserver(() => {
      if (isAsyncManagedMenu(menu) || menu.dataset.erpSmartMutating === '1') return;
      if (!menu.querySelector('.erp-smart-search-input')) ensureControls(btn, menu);
      applyFilter(btn, menu);
    });
    observer.observe(menu, { childList: true, subtree: false });
  }

  function scan() {
    injectCss();
    document.querySelectorAll(CONFIG.selectors).forEach(enhance);
  }

  function openFirstSmartDropdown() {
    const btn = document.querySelector('[data-erp-smart-ready="1"]');
    if (!btn) return;
    const menu = getMenuForButton(btn);
    if (!menu) return;
    showDropdown(btn);
    focusSearch(btn, menu);
  }

  function boot() {
    scan();
    const rootObserver = new MutationObserver(debounce(scan, 120));
    rootObserver.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const active = document.activeElement;
        const tag = active && active.tagName ? active.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || (active && active.isContentEditable)) return;
        e.preventDefault();
        openFirstSmartDropdown();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.WeavingERPSmartDropdown = { scan, config: CONFIG };
})();
