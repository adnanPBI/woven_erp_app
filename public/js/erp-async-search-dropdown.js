/*
 * ERP Universal Async Search Dropdown - V6
 *
 * Purpose:
 * - Stops large legacy dropdown list fetches from rendering thousands of records.
 * - Uses /main/api/dropdown-search with q + limit for server-side search.
 * - Keeps existing app-specific load functions/listeners intact by rendering the same data-* attributes.
 * - Does not change legacy endpoint response formats.
 */
(function () {
  'use strict';

  const API = '/main/api/dropdown-search';
  const DEFAULT_LIMIT = 35;
  const SEARCH_LIMIT = 60;
  const MIN_CHARS = 0;
  const DEBOUNCE_MS = 220;

  const path = window.location.pathname || '';

  function esc(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function compact(parts, sep = ' | ') {
    return parts.filter(v => v !== undefined && v !== null && String(v).trim() !== '').join(sep);
  }

  function dateOnly(value) {
    if (!value) return '';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
      return d.toISOString().slice(0, 10);
    } catch {
      return String(value).slice(0, 10);
    }
  }

  function jsonAttr(obj) {
    try { return JSON.stringify(obj || {}); } catch { return '{}'; }
  }

  function cssEscape(value) {
    const s = String(value || '');
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function setButtonText(buttonId, html) {
    const btn = document.getElementById(buttonId);
    if (btn) btn.innerHTML = html;
  }

  function hideButtonDropdown(buttonId) {
    const btn = document.getElementById(buttonId);
    if (!btn || !window.bootstrap?.Dropdown) return;
    window.bootstrap.Dropdown.getOrCreateInstance(btn).hide();
  }

  function safeCall(fnName, ...args) {
    const fn = window[fnName];
    if (typeof fn === 'function') return fn(...args);
    return undefined;
  }

  function getRaw(item) {
    return item && item.raw ? item.raw : (item || {});
  }

  function rowValue(item) {
    const raw = getRaw(item);
    return item?.value || raw.dispo_number || raw.dispo_no || raw.po_no || raw.pre_costing_no || raw.yarn_lot || raw.lc_no || raw.id || '';
  }

  const LABELS = {
    precosting: item => rowValue(item),
    po: item => rowValue(item),
    dispo: item => rowValue(item),
    yarnIssueDispo: item => {
      const r = getRaw(item);
      return compact([r.dispo_number || rowValue(item), `PO: ${r.po_no || r.purchase_order_no || 'N/A'}`, `Buyer: ${r.buyer_name || 'N/A'}`, `NF: ${r.development_id || 'N/A'}`]);
    },
    yarnDetail: item => {
      const r = getRaw(item);
      return r.yarn_detail || compact([r.yarn_count, r.yarn_ply, r.yarn_brand, r.lc_no]) || rowValue(item);
    },
    postedLC: item => rowValue(item),
    yarnLot: item => {
      const r = getRaw(item);
      if (r.yarn_lot_detail) return r.yarn_lot_detail;
      return compact([`Lot: ${r.yarn_lot || rowValue(item)}`, `Count: ${r.yarn_count || 'N/A'}/${r.yarn_ply || r.number_of_ply || 'N/A'}`, `Brand: ${r.yarn_brand || 'N/A'}`, r.last_received_date ? `Last Rcvd: ${dateOnly(r.last_received_date)}` : '']);
    },
    yarnIssue: item => {
      const r = getRaw(item);
      return compact([r.issue_challan_no || rowValue(item), `Lot: ${r.yarn_lot || 'N/A'}`, compact([r.yarn_count, r.yarn_ply, r.yarn_brand], ' '), `Dispo: ${r.received_against_dispo_nos || 'N/A'}`, r.issue_date ? `Date: ${dateOnly(r.issue_date)}` : '']);
    },
    processRecord: item => {
      const r = getRaw(item);
      const date = r.warping_date || r.sizing_date || r.weaving_date || r.loom_production_date || r.delivery_date || r.greige_delivery_date || r.folding_production_date || r.finish_delivery_date || r.finish_receive_date || r.dyed_yarn_received_date || r.receive_date || r.issue_date || r.created_at;
      return compact([
        r.po_number || r.po_no ? `PO: ${r.po_number || r.po_no}` : '',
        r.dispo_number || r.dispo_no || r.received_against_dispo_no ? `Dispo: ${r.dispo_number || r.dispo_no || r.received_against_dispo_no}` : '',
        r.buyer || r.buyer_name ? `Buyer: ${r.buyer || r.buyer_name}` : '',
        r.production_construction ? `Const: ${r.production_construction}` : '',
        date ? `Date: ${dateOnly(date)}` : '',
        r.id ? `ID: ${r.id}` : ''
      ]);
    },
    floorRecord: item => {
      const r = getRaw(item);
      return compact([`Dispo: ${r.dispo_no || r.dispo_number || 'N/A'}`, `PO: ${r.po_no || 'N/A'}`, `Buyer: ${r.buyer || r.buyer_name || 'N/A'}`, `Floor: ${r.floor_no || r.floor || 'N/A'}`, r.id ? `ID: ${r.id}` : '']);
    },
    planRecord: item => {
      const r = getRaw(item);
      return compact([`Dispo: ${r.dispo_number || r.dispo_no || 'N/A'}`, `PO: ${r.po_no || r.po_number || 'N/A'}`, `Buyer: ${r.buyer || r.buyer_name || 'N/A'}`, r.created_at ? `Date: ${dateOnly(r.created_at)}` : '', r.id ? `ID: ${r.id}` : '']);
    },
    orderFollowDispo: item => {
      const r = getRaw(item);
      return compact([`Dispo: ${r.dispo_number || rowValue(item) || 'N/A'}`, `PO: ${r.po_no || r.purchase_order_no || 'N/A'}`, `Buyer: ${r.buyer_name || 'N/A'}`, r.dispo_quantity ? `Qty: ${r.dispo_quantity}` : '']);
    }
  };

  function attrs(obj) {
    return Object.entries(obj || {})
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${esc(k)}="${esc(v)}"`)
      .join(' ');
  }

  const CONFIGS = [
    // Order information
    { path: /precosting_app/, buttonId: 'searchPreCostingDropdown', type: 'precosting', label: LABELS.precosting, attrs: i => ({ 'data-pre-costing-no': rowValue(i) }), onSelect: i => { setButtonText('searchPreCostingDropdown', `<i class="fas fa-search"></i> ${esc(rowValue(i))}`); safeCall('fetchPreCostingData', rowValue(i)); } },
    { path: /poentry_app/, buttonId: 'searchPreCostingDropdown', menuId: 'preCostingDropdown', type: 'precosting', label: LABELS.precosting, onSelect: i => { const v = rowValue(i); const el = document.getElementById('preCostingNo'); if (el) el.value = v; safeCall('fetchPreCostingDetails', v); } },
    { path: /poentry_app/, buttonId: 'searchPODropdown', menuId: 'poDropdown', type: 'po', label: LABELS.po, onSelect: i => safeCall('fetchPODetailsByPONo', rowValue(i)) },
    { path: /dispocreate_app/, buttonId: 'searchDispoDropdown', type: 'dispo', label: LABELS.dispo, attrs: i => ({ 'data-dispo-number': rowValue(i) }), onSelect: i => { const v = rowValue(i); setButtonText('searchDispoDropdown', `<i class="fas fa-search"></i> Dispo: ${esc(v)}`); safeCall('fetchDispoData', v); } },
    { path: /dispocreate_app/, buttonId: 'searchPODropdown', type: 'po', label: LABELS.po, attrs: i => ({ 'data-po-number': rowValue(i) }), onSelect: i => { const v = rowValue(i); setButtonText('searchPODropdown', `<i class="fas fa-search"></i> PO: ${esc(v)}`); safeCall('fetchDispoDataByPO', v); } },

    // MIS
    { path: /orderfollowup_app/, buttonId: 'searchDispoDropdown', type: 'dispo_for_order_followup', label: LABELS.orderFollowDispo, attrs: i => ({ 'data-dispo-number': rowValue(i) }), attach: ['attachDispoDropdownListeners'] },
    { path: /mainplan_app/, buttonId: 'searchDispoNumberDropdown', menuId: 'searchDispoNumberMenu', type: 'dispo', label: LABELS.dispo, attrs: i => ({ 'data-dispo-number': rowValue(i) }), attach: ['attachDispoNumberListeners'] },
    { path: /mainplan_app/, buttonId: 'searchDispoPlanDropdown', menuId: 'searchDispoPlanMenu', type: 'dispo_plan_records', label: LABELS.planRecord, attrs: i => ({ 'data-plan-id': getRaw(i).id }), attach: ['attachDispoPlanListeners'] },
    { path: /floorposition_app/, buttonId: 'searchDispoNumberDropdown', menuId: 'searchDispoNumberMenu', type: 'dispo', label: LABELS.dispo, attrs: i => ({ 'data-dispo-number': rowValue(i) }), attach: ['attachDispoNumberListeners'] },
    { path: /floorposition_app/, buttonId: 'floorDataSearchDropdown', menuId: 'floorDataSearchMenu', type: 'floor_position_records', label: LABELS.floorRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachFloorDataRecordListeners'] },

    // Yarn receive / issue
    { path: /greigeyarnreceive_app/, buttonId: 'searchYarnDetailDropdown', type: 'yarn_details', label: LABELS.yarnDetail, attrs: i => ({ 'data-yarn-data': jsonAttr(getRaw(i)) }), attach: ['attachYarnDropdownListeners'] },
    { path: /greigeyarnreceive_app/, buttonId: 'searchPostedLCDropdown', type: 'posted_lcs', label: LABELS.postedLC, attrs: i => ({ 'data-lc-number': rowValue(i) }), attach: ['attachLCDropdownListeners'] },
    { path: /greigeyarnreceive_app/, buttonId: 'searchYarnLotDropdown', type: 'yarn_lots', label: LABELS.yarnLot, attrs: i => ({ 'data-yarn-lot': getRaw(i).yarn_lot || rowValue(i), 'data-record-id': getRaw(i).id }), attach: ['attachYarnLotDropdownListeners'] },
    { path: /greigeyarnissue_app/, buttonId: 'searchYarnLotDropdown', type: 'yarn_lots', label: LABELS.yarnLot, attrs: i => ({ 'data-yarn-lot': getRaw(i).yarn_lot || rowValue(i), 'data-receive-id': getRaw(i).id, 'data-yarn-data': jsonAttr(getRaw(i)) }), attach: ['attachYarnLotDropdownListeners'] },
    { path: /greigeyarnissue_app/, buttonId: 'searchIssueDetailDropdown', type: 'yarn_issue_list', label: LABELS.yarnIssue, attrs: i => ({ 'data-issue-id': getRaw(i).id, 'data-issue-challan': getRaw(i).issue_challan_no || rowValue(i) }), attach: ['attachIssueDetailDropdownListeners'] },
    { path: /greigeyarnissue_app/, buttonId: 'searchDispoDropdown', type: 'yarn_issue_dispo', label: LABELS.yarnIssueDispo, attrs: i => { const r = getRaw(i); const v = r.dispo_number || rowValue(i); return { 'data-dispo-no': v, 'data-dispo-data': jsonAttr({ dispo_number: v, po_no: r.po_no || r.purchase_order_no || '', buyer_name: r.buyer_name || '', development_id: r.development_id || '', dispo_date: r.dispo_date || '' }) }; }, attach: ['attachSearchDispoDropdownListeners'] },
    { path: /dyedyarnreceive_app/, buttonId: 'searchDispoYarnReceiveDropdown', type: 'dyed_yarn_receive_records', label: LABELS.processRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachDyedYarnRecordListeners'] },
    { path: /dyedyarnissue_app/, buttonId: 'searchDispoYarnIssueDropdown', type: 'dyed_yarn_issue_records', label: LABELS.processRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachDyedYarnIssueRecordListeners'] },

    // Shared breakdown dispo search in production modules
    { buttonId: 'searchDispoBreakdownDropdown', type: 'dispo', label: LABELS.dispo, attrs: i => ({ 'data-dispo-number': rowValue(i) }), attach: ['attachDispoBreakdownListeners'] },

    // Preparatory / production records
    { path: /warpingentry_app/, buttonId: 'searchWarpingRecordDropdown', type: 'warping_records', label: LABELS.processRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachWarpingRecordListeners'] },
    { path: /sizingentry_app/, buttonId: 'searchSizingProgramDropdown', type: 'sizing_records', label: LABELS.processRecord, attrs: i => ({ 'data-sizing-record-id': getRaw(i).id }), attach: ['attachSizingRecordListeners'] },
    { path: /sizingentry_app/, buttonId: 'searchWarpingProgramDropdown', type: 'warping_records', label: LABELS.processRecord, attrs: i => ({ 'data-warping-record-id': getRaw(i).id }), attach: ['attachWarpingProgramListeners'] },
    { path: /loomproductionentry_app/, buttonId: 'searchLoomProductionDropdown', type: 'loom_production_records', label: LABELS.processRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachLoomProductionRecordListeners'] },
    { path: /greigedelivery_app/, buttonId: 'searchGreigeDeliveryDropdown', type: 'greige_delivery_records', label: LABELS.processRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachGreigeDeliveryRecordListeners'] },
    { path: /foldingproduction_app/, buttonId: 'searchFoldingProductionDropdown', type: 'folding_production_records', label: LABELS.processRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachFoldingProductionRecordListeners'] },
    { path: /finishfabricdelivery_app/, buttonId: 'searchFinishDeliveryDropdown', type: 'finish_delivery_records', label: LABELS.processRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachFinishDeliveryRecordListeners'] },
    { path: /finishfabricreceive_app/, buttonId: 'searchFinishReceiveDropdown', type: 'finish_receive_records', label: LABELS.processRecord, attrs: i => ({ 'data-record-id': getRaw(i).id }), attach: ['attachFinishReceiveRecordListeners'] }
  ];

  function getConfigForButton(btn) {
    return CONFIGS.find(c => c.buttonId === btn.id && (!c.path || c.path.test(path)));
  }

  function menuFor(btn, cfg) {
    if (cfg.menuId) return document.getElementById(cfg.menuId);
    const parent = btn.closest('.dropdown') || btn.parentElement;
    return parent?.querySelector(`.dropdown-menu[aria-labelledby="${cssEscape(btn.id)}"]`) || parent?.querySelector('.dropdown-menu') || btn.nextElementSibling;
  }

  function injectCss() {
    if (document.getElementById('erp-async-dropdown-css')) return;
    const s = document.createElement('style');
    s.id = 'erp-async-dropdown-css';
    s.textContent = `
.dropdown-menu.erp-async-menu { min-width: 380px; max-width: min(94vw, 760px); max-height: min(70vh, 480px); overflow-y: auto; padding: 0 !important; }
.erp-async-search-wrap { position: sticky; top: 0; z-index: 4; background: #222; border-bottom: 1px solid rgba(255,255,255,.08); padding: 9px 10px; }
.erp-async-search { width: 100%; border: 1px solid rgba(0,196,255,.28); border-radius: 8px; background: rgba(255,255,255,.06); color: #eee; padding: 8px 10px; font-size: 13px; outline: none; }
.erp-async-search::placeholder { color: rgba(255,255,255,.42); }
.erp-async-status { position: sticky; top: 48px; z-index: 3; background: #2b2b2b; color: rgba(255,255,255,.55); padding: 5px 12px; font-size: 11px; border-bottom: 1px solid rgba(255,255,255,.06); }
.erp-async-item { font-size: .86rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 740px; line-height: 1.4; padding: .45rem .9rem; }
.erp-async-empty { padding: 14px 12px; color: rgba(255,255,255,.52); font-size: 13px; }
.erp-async-loading { padding: 14px 12px; color: rgba(255,255,255,.62); font-size: 13px; }
`; document.head.appendChild(s);
  }

  function debounce(fn, wait) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
  }

  async function search(cfg, q, limit) {
    const params = new URLSearchParams({ type: cfg.type, limit: String(limit || DEFAULT_LIMIT) });
    if (q) params.set('q', q);
    const res = await fetch(`${API}?${params.toString()}`, { credentials: 'include', cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`);
    return data;
  }

  function renderShell(menu, placeholder) {
    menu.classList.add('erp-async-menu', 'erp-smart-menu');
    menu.innerHTML = `
      <li class="erp-async-search-wrap" data-erp-async-control="1">
        <input class="erp-async-search" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(placeholder || 'Type to search records...')}">
      </li>
      <li class="erp-async-status" data-erp-async-status="1">Type to search. Latest records are shown first.</li>
      <li class="erp-async-loading">Loading records...</li>`;
  }

  function status(menu, text) {
    const el = menu.querySelector('[data-erp-async-status="1"]');
    if (el) el.textContent = text;
  }

  function renderRows(menu, cfg, data, q) {
    const items = Array.isArray(data.items) ? data.items : [];
    const inputHtml = menu.querySelector('.erp-async-search-wrap')?.outerHTML || '';
    const statusHtml = menu.querySelector('.erp-async-status')?.outerHTML || '';
    if (!items.length) {
      menu.innerHTML = `${inputHtml}${statusHtml}<li class="erp-async-empty">No matching records.</li>`;
      const input = menu.querySelector('.erp-async-search');
      if (input) input.value = q || '';
      return rebindInput(menu, cfg);
    }

    const rows = items.map(item => {
      const label = (cfg.label ? cfg.label(item) : rowValue(item)) || rowValue(item) || 'Untitled record';
      const a = attrs(cfg.attrs ? cfg.attrs(item) : { 'data-value': rowValue(item) });
      return `<li><a class="dropdown-item erp-async-item" href="#" ${a}>${esc(label)}</a></li>`;
    }).join('');
    menu.innerHTML = `${inputHtml}${statusHtml}${rows}`;
    const input = menu.querySelector('.erp-async-search');
    if (input) input.value = q || '';

    const shown = items.length;
    status(menu, data.has_more ? `Showing ${shown}. Continue typing to narrow results.` : `Showing ${shown} result${shown === 1 ? '' : 's'}.`);

    if (Array.isArray(cfg.attach)) {
      cfg.attach.forEach(fnName => safeCall(fnName));
    }
    menu.querySelectorAll('.erp-async-item').forEach((a, idx) => {
      a.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const selectedItem = items[idx];
        if (cfg.onSelect) {
          cfg.onSelect(selectedItem);
        } else {
          menu.dispatchEvent(new CustomEvent('weaving-erp-async-select', {
            bubbles: true,
            detail: { config: cfg, item: selectedItem, value: rowValue(selectedItem), raw: getRaw(selectedItem) }
          }));
        }
        hideButtonDropdown(cfg.buttonId);
      });
    });
    rebindInput(menu, cfg);
  }

  function rebindInput(menu, cfg) {
    const input = menu.querySelector('.erp-async-search');
    if (!input) return;
    const run = debounce(async () => {
      const q = input.value.trim();
      if (q.length < MIN_CHARS) return;
      status(menu, q ? 'Searching...' : 'Loading latest records...');
      try {
        const data = await search(cfg, q, q ? SEARCH_LIMIT : DEFAULT_LIMIT);
        renderRows(menu, cfg, data, q);
        const nextInput = menu.querySelector('.erp-async-search');
        if (nextInput) {
          nextInput.focus();
          nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
      } catch (err) {
        status(menu, `Search failed: ${err.message}`);
      }
    }, DEBOUNCE_MS);
    input.addEventListener('input', run);
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') hideButtonDropdown(cfg.buttonId);
      e.stopPropagation();
    });
    setTimeout(() => input.focus(), 30);
  }

  async function openAsync(btn, cfg) {
    const menu = menuFor(btn, cfg);
    if (!menu) return;
    renderShell(menu, cfg.placeholder);
    if (window.bootstrap?.Dropdown) window.bootstrap.Dropdown.getOrCreateInstance(btn).show();
    try {
      const data = await search(cfg, '', DEFAULT_LIMIT);
      renderRows(menu, cfg, data, '');
    } catch (err) {
      menu.innerHTML = `<li class="erp-async-empty">Could not load records: ${esc(err.message)}</li>`;
    }
  }

  function enhance(btn) {
    const cfg = getConfigForButton(btn);
    if (!cfg || btn.dataset.erpAsyncReady === '1') return;
    const menu = menuFor(btn, cfg);
    if (!menu) return;
    btn.dataset.erpAsyncReady = '1';
    menu.dataset.erpAsyncManaged = '1';

    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      openAsync(btn, cfg);
    }, true);
  }

  function boot() {
    injectCss();
    document.querySelectorAll('button[data-bs-toggle="dropdown"][id]').forEach(enhance);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.WeavingERPAsyncDropdown = { boot, configs: CONFIGS };
})();
