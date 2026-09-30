'use strict';

const fs = require('fs');
const path = require('path');
const { forEachCsvObjectSync } = require('./csv_stream');

const METERS_TO_YARDS = 1.0936133;

const DISPO_SOURCE_FIELD_ALIASES = {
  dispo_number: ['Dispo No.', 'Dispo No', 'DISPO NUMBER'],
  dispo_no: ['Dispo No.', 'Dispo No', 'DISPO NUMBER'],
  po_no: ['PO No.', 'PO No', 'PO NUMBER'],
  buyer: ['Buyer', 'BUYER NAME', 'Buyer Name'],
  buyer_name: ['Buyer', 'BUYER NAME', 'Buyer Name'],
  production_construction: ['Production Construction', 'PRODUCTION CONSTRUCTION', 'Construction'],
  fabric_composition: ['Fabric Composition', 'FABRIC COMPOSITION'],
  fabric_type: ['Fabric Type'],
  yarn_type: ['Yarn Type'],
  process_type: ['Process Type'],
  account_holder: ['Account Holder'],
  bulk_fabric_delivery_date: ['Bulk Fabric Delivery Date'],
  bulk_delivery_date: ['Bulk Fabric Delivery Date'],
  customer_ref_stl: ['Customer Ref/Stl'],
  buyer_style_ref: ['Customer Ref/Stl'],
  weave: ['Weave'],
  weave_type: ['Weave'],
  finish_type: ['Finish Type'],
  po_issue_date: ['PO Issue Date'],
  po_received_date: ['PO Received Date'],
  end_use: ['End Use'],
  order_type: ['Order Type'],
  po_quantity_yds: ['PO Quantity (Yds)'],
  po_qty_yds: ['PO Quantity (Yds)'],
  dispo_quantity_yds: ['Dispo Quantity (Yds)'],
  finish_qty_yds: ['Dispo Quantity (Yds)'],
  lower_beam_crimp: ['Lower Beam/Regular Crimp'],
  required_print_production_meter: ['Required Print Production (Meter)'],
  required_print_production_mtr: ['Required Print Production (Meter)'],
  print_qty_mtr: ['Required Print Production (Meter)'],
  required_greige_production_meter: ['Required Greige Production (Meter)'],
  required_greige_production_mtr: ['Required Greige Production (Meter)'],
  grey_qty_mtr: ['Required Greige Production (Meter)'],
  required_loom_production_meter: ['Required Loom Production (Meter)'],
  required_loom_production_mtr: ['Required Loom Production (Meter)'],
  loom_production_mtr: ['Required Loom Production (Meter)'],
  required_warp_length_meter: ['Required Warp Length (Meter)'],
  required_warp_length_mtr: ['Required Warp Length (Meter)'],
  warp_beam_length: ['Required Warp Length (Meter)'],
  cuttable_width_inch: ['Cuttable Width (Inch)'],
  dispo_cuttable_width: ['Cuttable Width (Inch)'],
  grey_width_inch: ['Grey Width (Inch)'],
  total_ends: ['Total Ends'],
  beam_total_ends: ['Total Ends'],
  reed_count: ['Reed Count'],
  reed_width_inch: ['Reed Width (Inch)'],
  reed_space_inch: ['Reed Width (Inch)', 'Reed Space'],
  flange_to_flange: ['Flange To Flange'],
};

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\u00a0/g, ' ').trim();
  if (!text || /^(?:n\/?a|none|null|#n\/?a|-)$/i.test(text)) return null;
  return text;
}

function normalizeMatchText(value, { blank = '' } = {}) {
  const text = cleanText(value);
  if (text === null) return blank;
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Match the deployed ERP server.js stock identity exactly: SQL uses
// TRIM(yarn_lot) under utf8mb4_unicode_ci. Keep internal whitespace intact;
// collapsing it here would combine lots that the ERP treats as different.
function normalizeYarnLotIdentity(value, { blank = '' } = {}) {
  const text = cleanText(value);
  return text === null ? blank : text.toLowerCase();
}

function normalizeOrderedIdentifier(value, { blank = '' } = {}) {
  const text = cleanText(value);
  return text === null ? blank : text.toLowerCase();
}


function orderedIdentifierParts(value) {
  const text = normalizeOrderedIdentifier(value);
  if (!text) return { rank: 0, numeric: null, text: '' };
  // SQL verification uses the same contract: blank first, then whole-number
  // identifiers up to DECIMAL(65,0), then lowercase ASCII text. Numeric ties
  // are resolved by source-row/target-id order.
  if (/^\d{1,65}$/.test(text)) return { rank: 1, numeric: BigInt(text), text: '' };
  return { rank: 2, numeric: null, text };
}

function compareOrderedIdentifiers(a, b) {
  const left = orderedIdentifierParts(a);
  const right = orderedIdentifierParts(b);
  if (left.rank !== right.rank) return left.rank - right.rank;
  if (left.rank === 1) {
    if (left.numeric < right.numeric) return -1;
    if (left.numeric > right.numeric) return 1;
    return 0;
  }
  if (left.rank === 2) return Buffer.compare(Buffer.from(left.text, 'utf8'), Buffer.from(right.text, 'utf8'));
  return 0;
}

function parseNumber(value) {
  const text = cleanText(value);
  if (text === null) return null;
  const number = Number(text.replace(/,/g, '').replace(/%/g, '').replace(/["”৳$£€]/g, '').trim());
  return Number.isFinite(number) ? number : null;
}

const MONTHS = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
  apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
  aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function validIsoDate(year, monthIndex, day) {
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function parseDate(value, dateOrder = 'mdy') {
  const text = cleanText(value);
  if (text === null) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  // Production source sheets sometimes prefix the business date (for example
  // `Outside-8-Sep-2026`, `Reject-22-Mar-2024`, or `Outside-2-3-Feb-2025`).
  // Always resolve the final D-Mon-Y token instead of delegating these strings
  // to JavaScript Date parsing, which can silently reinterpret them.
  let match = text.match(/(?:^|[^0-9])(\d{1,2})-([A-Za-z]{3,9})-(\d{2,4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = MONTHS[match[2].toLowerCase()];
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month !== undefined) return validIsoDate(year, month, day);
  }

  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+.*)?$/);
  if (match) {
    let a = Number(match[1]);
    let b = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    let month;
    let day;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else if (dateOrder === 'dmy') { day = a; month = b; }
    else { month = a; day = b; }
    return validIsoDate(year, month - 1, day);
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function forEachSourceObject(filePath, callback) {
  if (!fs.existsSync(filePath)) return { rows: 0, parsed_rows: 0, nonempty_rows: 0, blank_rows: 0, headers: [] };
  return forEachCsvObjectSync(filePath, (record, meta) => {
    if (!meta.nonEmpty) return true;
    record.__sourceRowNumber = meta.sourceRowNumber;
    return callback(record, meta);
  });
}

// Compatibility helper for small tests and diagnostics only. Production source
// index construction uses forEachSourceObject() and never materializes a whole CSV.
function readCsvObjects(filePath) {
  const rows = [];
  forEachSourceObject(filePath, (record) => { rows.push(record); });
  return rows;
}

function stableCompare(a, b) {
  const dateCompare = String(a.date || '').localeCompare(String(b.date || ''));
  if (dateCompare !== 0) return dateCompare;
  const aSequence = String(a.sequence || '');
  const bSequence = String(b.sequence || '');
  const sequenceCompare = compareOrderedIdentifiers(aSequence, bSequence);
  if (sequenceCompare !== 0) return sequenceCompare;
  return Number(a.rowNumber || 0) - Number(b.rowNumber || 0);
}

function convertQuantity(value, unit, label) {
  const number = parseNumber(value);
  if (number === null) return 0;
  const normalizedUnit = normalizeMatchText(unit);
  if (normalizedUnit === 'yards' || normalizedUnit === 'yard' || normalizedUnit === 'yds') return number;
  if (normalizedUnit === 'meters' || normalizedUnit === 'meter' || normalizedUnit === 'metre' || normalizedUnit === 'mtr' || normalizedUnit === 'metres') {
    return number * METERS_TO_YARDS;
  }
  const error = new Error(`${label} source unit is unresolved. Set the corresponding unit to "meters" or "yards" before folding/delivery migration.`);
  error.code = 'SOURCE_UNIT_UNRESOLVED';
  throw error;
}

function addToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function firstRowValue(row, candidates = []) {
  for (const candidate of candidates) {
    if (!Object.prototype.hasOwnProperty.call(row, candidate)) continue;
    const value = cleanText(row[candidate]);
    if (value !== null) return value;
  }
  return null;
}

class SourceIndex {
  constructor({ csvDir, dateOrder = 'mdy', foldingUnit, deliveryUnit, logger = null, dispoFilter = null }) {
    this.csvDir = csvDir;
    this.dateOrder = dateOrder;
    this.foldingUnit = foldingUnit || process.env.FOLDING_SOURCE_UNIT || '';
    this.deliveryUnit = deliveryUnit || process.env.DELIVERY_SOURCE_UNIT || '';
    this.logger = logger;
    this.dispoFilter = dispoFilter instanceof Set ? dispoFilter : null;
    this.dispoMasters = new Map();
    this.warping = new Map();
    this.yarnReceipts = new Map();
    this.loom = new Map();
    this.folding = new Map();
    this.delivery = new Map();
    this.loadedFiles = {};
    this.loadedDatasets = new Set();
  }

  log(level, event, message, meta = {}) {
    this.logger?.[level]?.(event, message, meta);
  }

  load() {
    for (const dataset of ['dispoMasters','warping','yarnReceipts','loom','folding','delivery']) this.ensure(dataset);
    return this;
  }

  ensure(dataset) {
    if (this.loadedDatasets.has(dataset)) return;
    const method = {
      dispoMasters: 'loadDispoMasters', warping: 'loadWarping', yarnReceipts: 'loadYarnReceipts',
      loom: 'loadLoom', folding: 'loadFolding', delivery: 'loadDelivery',
    }[dataset];
    if (!method) throw new Error(`Unknown source-index dataset: ${dataset}`);
    this[method]();
    this.loadedDatasets.add(dataset);
    const size = dataset === 'dispoMasters' ? this.dispoMasters.size
      : dataset === 'yarnReceipts' ? this.yarnReceipts.size
      : this[dataset].size;
    this.log('info', 'source_index_dataset_loaded', `Immutable source index loaded: ${dataset}.`, { dataset, file: this.loadedFiles[dataset], keys: size });
  }

  release(dataset) {
    const map = this[dataset];
    if (map && typeof map.clear === 'function') map.clear();
    this.loadedDatasets.delete(dataset);
    this.log('debug', 'source_index_dataset_released', `Released source index dataset: ${dataset}.`, { dataset });
  }

  releaseAfterProfile(profileId) {
    if (profileId === 'yarn-issue') this.release('yarnReceipts');
    if (profileId === 'sizing') this.release('warping');
    if (profileId === 'folding') this.release('loom');
    if (profileId === 'greige-delivery') { this.release('folding'); this.release('delivery'); }
  }

  file(name) { return path.resolve(this.csvDir, name); }

  acceptsDispo(normalizedDispo) {
    return !this.dispoFilter || this.dispoFilter.has(normalizedDispo);
  }

  loadDispoMasters() {
    const file = this.file('Dispo create form.csv');
    const meta = forEachSourceObject(file, (row) => {
      const rawDispo = firstRowValue(row, DISPO_SOURCE_FIELD_ALIASES.dispo_number);
      const normalized = normalizeMatchText(rawDispo);
      if (!normalized) return true;
      if (!this.acceptsDispo(normalized)) return true;
      if (!this.dispoMasters.has(normalized)) {
        const values = {};
        for (const [resultField, aliases] of Object.entries(DISPO_SOURCE_FIELD_ALIASES)) {
          values[resultField] = firstRowValue(row, aliases);
        }
        this.dispoMasters.set(normalized, {
          dispoNumber: cleanText(rawDispo),
          rowNumber: row.__sourceRowNumber,
          operationalMode: cleanText(row.__MIG_OPERATIONAL_DISPO),
          migrationAction: cleanText(row.__MIG_ACTION),
          bridgeSource: cleanText(row.__MIG_BRIDGE_SOURCE),
          values,
        });
      }
      return true;
    });
    this.loadedFiles.dispoMasters = { file, rows: meta.nonempty_rows || 0 };
  }

  dispoMaster(dispoValue) {
    this.ensure('dispoMasters');
    const normalized = normalizeMatchText(dispoValue);
    return normalized ? (this.dispoMasters.get(normalized) || null) : null;
  }

  dispoValue(resultField, dispoValue) {
    const master = this.dispoMaster(dispoValue);
    if (!master) return null;
    return master.values?.[resultField] ?? null;
  }

  dispoOperationalMode(dispoValue) {
    return this.dispoMaster(dispoValue)?.operationalMode || null;
  }

  isPlanOnlyDispo(dispoValue) {
    return this.dispoOperationalMode(dispoValue) === 'plan-only';
  }

  loadWarping() {
    const file = this.file('Warping database.csv');
    const meta = forEachSourceObject(file, (row) => {
      const dispo = normalizeMatchText(row['Dispo No']);
      const program = normalizeMatchText(row['Warping Program No']);
      if (!dispo) return true;
      if (!this.acceptsDispo(dispo)) return true;
      const item = {
        dispo,
        program,
        date: parseDate(row['Warping Date'], this.dateOrder),
        rowNumber: row.__sourceRowNumber,
        actual_warp_length_mtr: parseNumber(row['Warp Length(Mtr)']),
        warping_date: parseDate(row['Warping Date'], this.dateOrder),
        warping_set: parseNumber(row.Set),
        total_no_of_beam: parseNumber(row['Total Beam']),
      };
      addToIndex(this.warping, `${dispo}|${program}`, item);
      addToIndex(this.warping, `${dispo}|`, item);
      return true;
    });
    this.loadedFiles.warping = { file, rows: meta.nonempty_rows || 0 };
    for (const items of this.warping.values()) items.sort(stableCompare);
  }

  loadYarnReceipts() {
    const file = this.file('Greige yarn receive.csv');
    const meta = forEachSourceObject(file, (row) => {
      const lot = normalizeYarnLotIdentity(row['Yarn Lot']);
      if (!lot) return true;
      const quantity = parseNumber(row['Receipt Qty (Kgs)']);
      if (!this.yarnReceipts.has(lot)) this.yarnReceipts.set(lot, { total: 0, rows: 0 });
      const aggregate = this.yarnReceipts.get(lot);
      aggregate.total += quantity || 0;
      aggregate.rows += 1;
      return true;
    });
    this.loadedFiles.yarnReceipts = { file, rows: meta.nonempty_rows || 0 };
  }

  loadLoom() {
    const file = this.file('Loom production database.csv');
    const meta = forEachSourceObject(file, (row) => {
      const dispo = normalizeMatchText(row['Dispo No']);
      if (!dispo) return true;
      if (!this.acceptsDispo(dispo)) return true;
      const productionDate = parseDate(row['Weaving Dates'], this.dateOrder);
      if (!productionDate) return true;
      addToIndex(this.loom, dispo, {
        date: productionDate,
        sequence: '',
        rowNumber: row.__sourceRowNumber,
        quantity: (parseNumber(row['In house Production/Day']) || 0) + (parseNumber(row['Out Side Production/Day']) || 0),
      });
      return true;
    });
    this.loadedFiles.loom = { file, rows: meta.nonempty_rows || 0 };
    for (const items of this.loom.values()) this.finalizeCumulative(items, 'loom');
  }

  loadFolding() {
    const file = this.file('Folding production database.csv');
    const meta = forEachSourceObject(file, (row) => {
      const dispo = normalizeMatchText(row['Dispo No']);
      if (!dispo) return true;
      if (!this.acceptsDispo(dispo)) return true;
      const productionDate = parseDate(row['Folding Production Date'], this.dateOrder);
      if (!productionDate) return true;
      const rawQuantity = (parseNumber(row['A-Grade']) || 0)
        + (parseNumber(row['B-Grade']) || 0)
        + (parseNumber(row['C-Grade']) || 0)
        + (parseNumber(row['Reject/C grade']) || 0);
      addToIndex(this.folding, dispo, {
        date: productionDate,
        sequence: '',
        rowNumber: row.__sourceRowNumber,
        rawQuantity,
      });
      return true;
    });
    this.loadedFiles.folding = { file, rows: meta.nonempty_rows || 0 };
    for (const items of this.folding.values()) this.finalizeCumulative(items, 'folding');
  }

  loadDelivery() {
    const file = this.file('Greige delivery database.csv');
    const meta = forEachSourceObject(file, (row) => {
      const dispo = normalizeMatchText(row['Dispo No']);
      if (!dispo) return true;
      if (!this.acceptsDispo(dispo)) return true;
      const deliveryDate = parseDate(row['Delivery Date'], this.dateOrder);
      if (!deliveryDate) return true;
      const rawQuantity = (parseNumber(row['Delivery Quantity"A"Grade']) || 0)
        + (parseNumber(row['Delivery Quantity"B"Grade']) || 0)
        + (parseNumber(row['Delivery Quantity"C"Grade']) || 0)
        + (parseNumber(row['Delivery Quantity Reject']) || 0);
      addToIndex(this.delivery, dispo, {
        date: deliveryDate,
        sequence: normalizeOrderedIdentifier(row['Challan No']),
        rowNumber: row.__sourceRowNumber,
        rawQuantity,
      });
      return true;
    });
    this.loadedFiles.delivery = { file, rows: meta.nonempty_rows || 0 };
    for (const items of this.delivery.values()) this.finalizeCumulative(items, 'delivery');
  }

  finalizeCumulative(items, dataset) {
    items.sort(stableCompare);
    let running = 0;
    for (const item of items) {
      const value = dataset === 'loom'
        ? item.quantity
        : dataset === 'folding'
          ? convertQuantity(item.rawQuantity, this.foldingUnit, 'Folding')
          : convertQuantity(item.rawQuantity, this.deliveryUnit, 'Greige delivery');
      running += Number(value || 0);
      item.cumulative = Number(running.toFixed(4));
      delete item.rawQuantity;
      delete item.quantity;
    }
  }

  warpingValue(resultField, dispoValue, programValue, uptoDateValue) {
    this.ensure('warping');
    const dispo = normalizeMatchText(dispoValue);
    const program = normalizeMatchText(programValue);
    if (!dispo) return null;
    const targetDate = parseDate(uptoDateValue, this.dateOrder);
    let candidates = this.warping.get(`${dispo}|${program}`) || [];
    if (!candidates.length && !program) candidates = this.warping.get(`${dispo}|`) || [];
    if (targetDate) candidates = candidates.filter((row) => !row.date || row.date <= targetDate);
    if (!candidates.length) return null;
    const selected = candidates[candidates.length - 1];
    return selected[resultField] ?? null;
  }

  yarnReceiptSum(lotValue) {
    this.ensure('yarnReceipts');
    const lot = normalizeYarnLotIdentity(lotValue);
    if (!lot) return null;
    return this.yarnReceipts.get(lot)?.total ?? null;
  }

  rowsFor(dataset, dispoValue) {
    this.ensure(dataset);
    const dispo = normalizeMatchText(dispoValue);
    if (!dispo) return [];
    if (dataset === 'loom') return this.loom.get(dispo) || [];
    if (dataset === 'folding') return this.folding.get(dispo) || [];
    if (dataset === 'delivery') return this.delivery.get(dispo) || [];
    throw new Error(`Unknown source-index dataset: ${dataset}`);
  }

  latestDate(dataset, dispoValue, uptoDateValue) {
    const targetDate = parseDate(uptoDateValue, this.dateOrder);
    if (!targetDate) return null;
    const rows = this.rowsFor(dataset, dispoValue);
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (rows[mid].date && rows[mid].date <= targetDate) low = mid + 1;
      else high = mid;
    }
    return low > 0 ? rows[low - 1].date : null;
  }

  cumulative(dataset, dispoValue, uptoDateValue, currentSequenceValue = '', currentRowNumber = null, applyCurrentRowCutoff = false) {
    const targetDate = parseDate(uptoDateValue, this.dateOrder);
    if (!targetDate) return null;
    const rows = this.rowsFor(dataset, dispoValue);
    if (!rows.length) return null;
    if (rows.some((row) => row.cumulative === undefined)) this.finalizeCumulative(rows, dataset);
    const currentSequence = normalizeOrderedIdentifier(currentSequenceValue);
    const parsedCurrentRow = Number(currentRowNumber);
    const currentRow = Number.isFinite(parsedCurrentRow) && parsedCurrentRow > 0 ? parsedCurrentRow : Number.MAX_SAFE_INTEGER;

    const eligible = (row) => {
      if (!row.date || row.date > targetDate) return false;
      if (!applyCurrentRowCutoff || row.date < targetDate) return true;
      if (dataset === 'delivery') {
        const compare = compareOrderedIdentifiers(row.sequence, currentSequence);
        if (currentSequence) return compare < 0 || (compare === 0 && Number(row.rowNumber || 0) <= currentRow);
        return !normalizeOrderedIdentifier(row.sequence) && Number(row.rowNumber || 0) <= currentRow;
      }
      if (dataset === 'folding') return Number(row.rowNumber || 0) <= currentRow;
      return true;
    };

    let low = 0;
    let high = rows.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (eligible(rows[mid])) low = mid + 1;
      else high = mid;
    }
    return low > 0 ? rows[low - 1].cumulative : null;
  }

}

function buildSourceIndex(options) {
  const index = new SourceIndex(options);
  return options?.lazy ? index : index.load();
}

module.exports = {
  METERS_TO_YARDS,
  SourceIndex,
  buildSourceIndex,
  cleanText,
  normalizeMatchText,
  normalizeYarnLotIdentity,
  normalizeOrderedIdentifier, orderedIdentifierParts, compareOrderedIdentifiers,
  parseNumber,
  parseDate,
  convertQuantity,
  readCsvObjects, forEachSourceObject,
  DISPO_SOURCE_FIELD_ALIASES,
};
