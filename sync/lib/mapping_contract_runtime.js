'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
let mysql = null;
try { mysql = require('mysql2/promise'); } catch (_error) { /* DB dependency is required only when DB credentials are supplied. */ }
const { parseCsvRows } = require('./csv_parser');
const { iterateCsvRows, dedupeHeaders: dedupeStreamHeaders, isNonEmptyRow } = require('./csv_stream');
const { createLogger } = require('./structured_logger');
const { buildSourceIndex, normalizeMatchText, forEachSourceObject } = require('./source_index');
const { DispoResolutionService, envBool } = require('./dispo_resolution');
const { validateManifest, sha256File } = require('./source_manifest');
const { verifyFullDryRunEvidence } = require('./dry_run_acceptance');
const provenance = require('./provenance');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.length ? rest.join('=') : true;
  }
  if (out.only) out.only = String(out.only).split(',').map(s => s.trim()).filter(Boolean);
  if (out.limit) out.limit = Number(out.limit);
  if (out.offset) out.offset = Number(out.offset);
  return out;
}

function envVal(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  return String(value).trim();
}
function envInt(name, fallback, minimum = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : fallback;
}

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function nowStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function sha256(value) { return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'); }
function cleanText(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\u00a0/g, ' ').trim();
  if (!s || /^N\/A$/i.test(s) || /^#N\/A$/i.test(s)) return null;
  return s;
}
function firstNonNull(...values) {
  for (const value of values) {
    const s = cleanText(value);
    if (s !== null) return s;
  }
  return null;
}
function parseNumber(value) {
  const s = cleanText(value);
  if (!s) return null;
  const cleaned = s.replace(/,/g, '').replace(/%/g, '').replace(/["”]/g, '').replace(/[$৳£€]/g, '').trim();
  const direct = Number(cleaned);
  if (Number.isFinite(direct)) return direct;
  const m = cleaned.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s+(?:[A-Za-z]+(?:\s+[A-Za-z]+)*)$/);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}
function parseInteger(value) {
  const n = parseNumber(value);
  return n === null ? null : Math.trunc(n);
}
const MONTHS = { jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11 };
function isoDateStrict(year, monthIndex, day) {
  if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || !Number.isInteger(day)) return null;
  if (year < 1900 || year > 2100 || monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;
  const dt = new Date(Date.UTC(year, monthIndex, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== monthIndex || dt.getUTCDate() !== day) return null;
  return dt.toISOString().slice(0, 10);
}
function parseDate(value, dateOrder = 'mdy') {
  const s = cleanText(value);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Support prefixed operational dates such as Outside-8-Sep-2026 and
  // Outside-2-3-Feb-2025 by resolving the final D-Mon-Y token deterministically.
  let m = s.match(/(?:^|[^0-9])(\d{1,2})-([A-Za-z]{3,9})-(\d{2,4})$/);
  if (m) {
    const day = Number(m[1]);
    const month = MONTHS[m[2].toLowerCase()];
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (month !== undefined) return isoDateStrict(year, month, day);
  }
  m = s.match(/^(\d{1,2})\/((?:\d{1,2}))\/(\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    if (a < 1 || a > 31 || b < 1 || b > 31) return null;
    let month, day;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else if (dateOrder === 'dmy') { day = a; month = b; }
    else { month = a; day = b; }
    return isoDateStrict(year, month - 1, day);
  }
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}
function normalizeHeader(s) {
  return String(s || '').replace(/\u00a0/g, ' ').toLowerCase().replace(/[‘’“”]/g, '').replace(/[()]/g, ' ').replace(/[.:]/g, '').replace(/[\/]/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function dedupeHeaders(rawHeaders) {
  const seen = new Map();
  return rawHeaders.map((h) => {
    const key = cleanText(h) || '';
    const count = (seen.get(key) || 0) + 1;
    seen.set(key, count);
    return count === 1 ? key : `${key}_${count}`;
  });
}
function readCsvFile(filePath, headerRow = 0) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const records = parseCsvRows(raw);
  const rawHeaders = (records[headerRow] || []).map(v => String(v || '').replace(/\u00a0/g, ' ').trim());
  const headers = dedupeHeaders(rawHeaders);
  const rows = records.slice(headerRow + 1).filter(row => row.some(cell => cleanText(cell) !== null));
  const normalizedMap = new Map();
  headers.forEach((h, idx) => {
    const exact = h;
    const norm = normalizeHeader(h);
    if (!normalizedMap.has(exact)) normalizedMap.set(exact, idx);
    if (!normalizedMap.has(norm)) normalizedMap.set(norm, idx);
  });
  return { rawHeaders, headers, rows, normalizedMap };
}
function valueFromRow(fileInfo, row, name) {
  if (!name) return null;
  const candidates = [name, normalizeHeader(name)];
  for (const key of candidates) {
    const idx = fileInfo.normalizedMap.get(key);
    if (idx !== undefined) return row[idx] ?? null;
  }
  return null;
}
function sourceObj(fileInfo, row) {
  const out = {};
  fileInfo.headers.forEach((h, idx) => { out[h] = row[idx] ?? null; });
  return out;
}
function transformForTarget(value, targetType, field, opts = {}) {
  if (value === undefined) return null;
  const typ = String(targetType || '').toLowerCase();
  if (value === null) return null;
  if (typ.includes('date') || /_date$/.test(field)) return parseDate(value, opts.dateOrder);
  if (typ.includes('int')) return parseInteger(value);
  if (typ.includes('decimal') || typ.includes('float') || typ.includes('double')) return parseNumber(value);
  if (/(_kg|_kgs|_mtr|_meter|_yds|_qty|_quantity|_rate|_price|_cost|_balance|_volume|_length|_width|_ppi|_epi|_factor|_percent|_speed|_rpm)$/.test(field)) {
    const n = parseNumber(value);
    return n === null ? cleanText(value) : n;
  }
  return cleanText(value);
}
function nonEmptyObject(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return [headers.join(','), ...rows.map(row => headers.map(h => csvEscape(row[h])).join(','))].join('\n');
}
function loadDuplicateAggregationPolicy(rootDir) {
  const file = path.resolve(rootDir, 'config', 'duplicate_aggregation_policy.v1.json');
  if (!fs.existsSync(file)) return { policy_version: 'none', profiles: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function loadPreCostingNullPolicy(rootDir) {
  const file = path.resolve(rootDir, 'config', 'pre_costing_null_policy.v1.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function sanitizeToken(value, maxLen = 40) {
  const base = String(value || '').trim().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-');
  return (base || 'NA').slice(0, maxLen);
}
function extractInt(value) {
  const s = cleanText(value);
  if (!s) return null;
  const m = s.replace(/,/g, '').match(/\b\d+\b/);
  return m ? Number(m[0]) : null;
}
function extractLabelledInt(value, label) {
  const s = cleanText(value);
  if (!s) return null;
  const re = new RegExp('(?:^|[^0-9])([0-9][0-9,]*)\\s*' + String(label || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?', 'i');
  const m = s.match(re);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}
function extractDispoRef(value) {
  const s = cleanText(value);
  if (!s) return null;
  // Project Dispo identifiers commonly look like NH/NDSD/GD/24/04750.
  // Prefer the full slash-delimited GD reference before generic labelled patterns.
  const m = s.match(/\b([A-Z0-9]{1,12}(?:\/[A-Z0-9_-]{1,20})*\/GD\/\d{2,4}\/\d{3,})\b/i)
    || s.match(/(?:DISPO|GD|D\/O|DO)\s*(?:No\.?|Number|#)?\s*[:\-]?\s*([A-Za-z0-9\/_-]{3,})/i)
    || s.match(/\b([A-Z]{1,5}\/?\d{3,}[A-Za-z0-9\/_-]*)\b/);
  return m ? m[1] : null;
}
function extractChallanRef(value) {
  const s = cleanText(value);
  if (!s) return null;
  const label = s.match(/(?:Challan|SR|S\/R)\s*(?:No\.?|#)?\s*[:\-]?\s*/i);
  if (!label || label.index === undefined) return null;
  let tail = s.slice(label.index + label[0].length);
  // Search-column exports concatenate fields with markers such as -Factory:SCTL.
  // Capture the full challan text (including spaces/hyphens) but stop at the next labelled field.
  tail = tail.split(/-(?:Factory|Yarn Count|Last Received Date|Yarn Lot|Receipt Qty|Created By|Search Column)\s*:/i)[0];
  const challan = cleanText(tail);
  if (!challan) return null;
  const normalized = challan.toLowerCase();
  return ['n/a', 'na', 'none', 'null', '-'].includes(normalized) ? null : challan;
}
function firstNonNA(...values) {
  for (const value of values) {
    const s = cleanText(value);
    if (s === null) continue;
    const normalized = s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (['n/a', 'na', 'none', 'null', 'not available', '-'].includes(normalized)) continue;
    return s;
  }
  return null;
}
function sum(...values) { return values.reduce((acc, v) => acc + (parseNumber(v) || 0), 0); }
function subtract(a, b) {
  const x = parseNumber(a); const y = parseNumber(b);
  if (x === null || y === null) return null;
  return Number((x - y).toFixed(2));
}
function divide(a, b) {
  const x = parseNumber(a); const y = parseNumber(b);
  if (x === null || y === null || y === 0) return null;
  return Number((x / y).toFixed(2));
}
function mod(a, b) {
  const x = parseInteger(a); const y = parseInteger(b);
  if (x === null || y === null || y === 0) return null;
  return x % y;
}
function constructionCount(explicitCount, construction, lane, index) {
  const explicit = parseInteger(explicitCount);
  if (explicit !== null && index === 1) return explicit;
  const s = cleanText(construction);
  if (!s) return null;
  const beforeSlash = s.split('/')[0] || '';
  const countPart = beforeSlash.split(/[xX*]/).map(v => parseInteger(v)).filter(v => v !== null);
  if (lane === 'warp') return countPart[index - 1] || null;
  if (lane === 'weft') return countPart[index] || countPart[index - 1] || null;
  return null;
}
function normalizeYarnCount(value) {
  const s = cleanText(value);
  if (!s) return null;
  const months = { january:1,jan:1,february:2,feb:2,march:3,mar:3,april:4,apr:4,may:5,june:6,jun:6,july:7,jul:7,august:8,aug:8,september:9,sept:9,sep:9,october:10,oct:10,november:11,nov:11,december:12,dec:12 };
  let m = s.match(/^(\d{1,3})[-\s]([A-Za-z]{3,9})(?:[-\s]\d{2,4})?$/);
  if (m && months[m[2].toLowerCase()]) return `${Number(m[1])}/${months[m[2].toLowerCase()]}`;
  m = s.match(/^(\d{1,3})\/(0?[1-9]|1[0-2])(?:\/\d{2,4})?$/);
  if (m) return `${Number(m[1])}/${Number(m[2])}`;
  return s;
}

// Certified v3.2.3 normalization deliberately preserves historical Dispo
// references that have no valid PO as plan-only master rows. Downstream
// production events remain source evidence and must not be rejected merely
// because enrichment fields are unknowable without fabricating a PO/master.
// These exceptions are narrow, deterministic, and only apply when the
// manifest-bound certified Dispo master explicitly marks the Dispo plan-only.
const PLAN_ONLY_NULLABLE_MASTER_FIELDS = new Set([
  'warping:warping_form.po_number',
  'warping:warping_form.buyer',
  'warping:warping_form.production_construction',
  'warping:warping_form.fabric_composition',
  'sizing:sizing_form.po_number',
  'sizing:sizing_form.buyer',
  'sizing:sizing_form.production_construction',
  'loom:loom_production_form.po_number',
  'loom:loom_production_form.buyer',
  'loom:loom_production_form.production_construction',
  'folding:folding_production_form.po_number',
  'folding:folding_production_form.buyer',
  'folding:folding_production_form.production_construction',
  'folding:folding_production_form.fabric_composition',
  'greige-delivery:greige_delivery_form.po_number',
  'greige-delivery:greige_delivery_form.buyer',
  'greige-delivery:greige_delivery_form.production_construction',
  'greige-delivery:greige_delivery_form.fabric_composition',
]);

// The source freeze starts after some historical production activity. A valid
// folding event can therefore have no earlier loom event in the frozen source,
// and a valid delivery event can have no earlier folding event. Preserve the
// event and leave only the derived upstream checkpoint/balance NULL; never
// invent a zero or synthetic predecessor. Same-source cumulative quantities
// remain strict and are intentionally NOT listed here.
const HISTORICAL_UPSTREAM_NULLABLE_FIELDS = new Set([
  'folding:folding_production_breakdown.loom_production_qty_yds',
  'folding:folding_production_breakdown.loom_production_date',
  'folding:folding_production_breakdown.folding_balance',
  'greige-delivery:greige_delivery_breakdown.greige_folding_date',
  'greige-delivery:greige_delivery_breakdown.greige_folding_qty_yds',
  'greige-delivery:greige_delivery_breakdown.delivery_balance',
]);

function mappingPolicyKey(profile, mapping) {
  return `${profile?.id || ''}:${mapping?.table || ''}.${mapping?.field || ''}`;
}

function isPolicyAuthorizedNullable(ctx, profile, mapping, rowsByTable = null) {
  const key = mappingPolicyKey(profile, mapping);
  if (PLAN_ONLY_NULLABLE_MASTER_FIELDS.has(key)) {
    return Boolean(ctx.currentPlanOnlyDispo);
  }
  if (!HISTORICAL_UPSTREAM_NULLABLE_FIELDS.has(key)) return false;
  if (key === 'folding:folding_production_breakdown.folding_balance') {
    const row = rowsByTable?.folding_production_breakdown || {};
    return cleanText(row.folding_production_qty_yds) !== null && cleanText(row.loom_production_qty_yds) === null;
  }
  if (key === 'greige-delivery:greige_delivery_breakdown.delivery_balance') {
    const row = rowsByTable?.greige_delivery_breakdown || {};
    return cleanText(row.greige_delivery_qty_yds) !== null && cleanText(row.greige_folding_qty_yds) === null;
  }
  return true;
}

function authorizedNullableReason(ctx, profile, mapping) {
  const key = mappingPolicyKey(profile, mapping);
  if (PLAN_ONLY_NULLABLE_MASTER_FIELDS.has(key)) {
    return 'certified_plan_only_dispo_missing_master_enrichment';
  }
  if (HISTORICAL_UPSTREAM_NULLABLE_FIELDS.has(key)) {
    return 'historical_upstream_event_not_present_as_of_source_event';
  }
  return null;
}

class RuntimeContext {
  constructor({ rootDir, contract, schema, args, logger = null }) {
    this.rootDir = rootDir;
    this.contract = contract;
    this.schema = schema;
    this.args = args;
    this.dateOrder = String(process.env.CSV_DATE_ORDER || 'mdy').toLowerCase();
    this.live = !!args.live || String(args.mode || '').toLowerCase() === 'live';
    this.dryRun = !this.live || !!args['dry-run'];
    if (this.live && args['dry-run']) throw new Error('Use either --dry-run or --live, not both.');
    if (this.live && !args.yes) throw new Error('Live import blocked. Re-run with --live --yes after full backup and successful dry-run.');
    const backupConfirmed = ['1', 'true', 'yes'].includes(String(args['backup-confirmed'] || process.env.BACKUP_CONFIRMED || process.env.IMPORT_BACKUP_CONFIRMED || '').toLowerCase());
    if (this.live && !args['skip-backup-check'] && !backupConfirmed) {
      throw new Error('Live import blocked. Confirm backup with BACKUP_CONFIRMED=true, IMPORT_BACKUP_CONFIRMED=true, or --backup-confirmed.');
    }
    this.runId = String(args['run-id'] || process.env.IMPORT_RUN_ID || `contract_${nowStamp()}_${process.pid}`).replace(/[^A-Za-z0-9_.-]+/g, '_');
    this.outputDir = path.resolve(args['output-dir'] || envVal('CONTRACT_OUTPUT_DIR', path.join(rootDir, 'output', 'mapping_contract_v2', this.runId)));
    this.csvDir = path.resolve(args['csv-dir'] || envVal('CSV_DIR', path.join(rootDir, 'csv_files')));
    this.offset = Math.max(0, Number(args.offset || 0) || 0);
    this.limit = args.limit ? Math.max(0, Number(args.limit) || 0) : null;
    this.pool = null;
    this.conn = null;
    this.tableColumns = {};
    this.cache = { lookups: new Map(), expressions: new Map() };
    this.sourceIndex = null;
    this.dispoResolver = null;
    this.currentSourceRowNumber = null;
    this.currentSourceDataset = null;
    this.currentSourceFile = null;
    this.currentSourceUid = null;
    this.currentPlanOnlyDispo = false;
    this.currentRawDispo = null;
    this.currentCanonicalDispo = null;
    this.lookupMissKeys = new Set();
    this.reportDetailLimit = envInt('REPORT_DETAIL_LIMIT', 10000, 100);
    this.previewDetailLimit = envInt('PREVIEW_DETAIL_LIMIT', 2000, 0);
    this.dispoAuditRows = [];
    this.validationRows = [];
    this.rejectedRows = [];
    this.rejectedRowCount = 0;
    this.rejectedRowsOmitted = 0;
    this.lookupMisses = [];
    this.lookupMissCount = 0;
    this.requiredLookupMissCount = 0;
    this.criticalLookupMissCount = 0;
    this.policyAuthorizedLookupMissCount = 0;
    this.lookupMissesOmitted = 0;
    this.previewRows = [];
    this.previewRowCount = 0;
    this.previewRowsOmitted = 0;
    this.reconciliation = {};
    this.stats = {};
    this.parentIds = new Map();
    this.foreignKeys = [];
    this.fkDependencyReport = [];
    this.contractHash = contract.published_contract_sha256 || sha256(JSON.stringify(contract));
    this.selectedProfiles = [];
    this.allContractProfiles = contract.import_order || contract.profiles.map((profile) => profile.id);
    this.sourceManifestPath = null;
    this.sourceManifestFileSha256 = null;
    this.reviewedPendingManifestSha256 = null;
    this.sourceManifestEntries = new Map();
    this.duplicateAggregation = loadDuplicateAggregationPolicy(rootDir);
    this.preCostingNullPolicy = loadPreCostingNullPolicy(rootDir);
    this.provenancePolicy = provenance.loadPolicy(rootDir);
    this.deletedChildKeys = new Set();
    this.dryRunNaturalKeyRows = new Map();
    this.status = { status: 'starting', runId: this.runId, mode: this.dryRun ? 'dry-run' : 'live', contractHash: this.contractHash, processed: 0, total: 0, inserted: 0, updated: 0, rejected: 0, rolledBack: 0 };
    this.progressEvery = envInt('IMPORT_PROGRESS_EVERY', 25, 1);
    this.progressJsonlEnabled = envBool('IMPORT_PROGRESS_JSONL', false);
    this.progressJsonlPath = path.join(this.outputDir, 'row_progress.jsonl');
    ensureDir(this.outputDir);
    this.globalLogger = logger;
    this.logger = createLogger({
      app: 'import-mapper-cli',
      component: 'mapping-contract-runtime',
      logDir: this.outputDir,
      filePrefix: 'events',
      baseContext: { runId: this.runId, mode: this.dryRun ? 'dry-run' : 'live', contractHash: this.contractHash },
    });
    this.log('info', 'runtime_initialized', 'Initializing Mapping Contract v2 runtime.', {
      outputDir: this.outputDir,
      csvDir: this.csvDir,
      offset: this.offset,
      limit: this.limit,
      requestedImporters: args.only || null,
      validationMode: envVal('IMPORT_VALIDATION_MODE', 'strict'),
      expectedDatabase: envVal('IMPORT_EXPECTED_DB', ''),
      foldingSourceUnit: envVal('FOLDING_SOURCE_UNIT', ''),
      deliverySourceUnit: envVal('DELIVERY_SOURCE_UNIT', ''),
    });
    this.writeStatus({ message: 'Initializing Mapping Contract v2 runtime.' });
  }
  log(level, event, message, meta = {}) {
    this.logger[level]?.(event, message, meta);
    if (this.globalLogger && this.globalLogger !== this.logger) this.globalLogger[level]?.(event, message, { runId: this.runId, ...meta });
  }
  stat(profile, key, inc = 1) {
    this.stats[profile] ||= { processed: 0, inserted: 0, updated: 0, previewed: 0, rejected: 0, lookup_misses: 0, rolled_back: 0, errors: 0 };
    this.stats[profile][key] = (this.stats[profile][key] || 0) + inc;
  }
  addValidation(row) {
    const entry = { ts: new Date().toISOString(), ...row };
    this.validationRows.push(entry);
    const level = row.level === 'error' ? 'error' : row.level === 'warn' ? 'warn' : 'debug';
    this.log(level, 'validation_finding', row.message || row.code || 'Validation finding', entry);
  }
  reject(row) {
    const entry = { ts: new Date().toISOString(), ...row };
    this.rejectedRowCount += 1;
    if (this.rejectedRows.length < this.reportDetailLimit) this.rejectedRows.push(entry);
    else this.rejectedRowsOmitted += 1;
    this.stat(row.profile || 'unknown', 'rejected', 1);
    this.log('warn', 'row_rejected', row.reason || 'Source row rejected', entry);
  }
  lookupMiss(row) {
    const policyAuthorized = Boolean(row.policy_authorized);
    const blocking = !policyAuthorized && Boolean(row.required || row.business_critical || row.critical);
    const key = JSON.stringify([
      row.profile || 'unknown',
      this.currentSourceRowNumber || row.source_row_number || null,
      row.table || null,
      row.field || null,
      row.lookup_type || 'lookup',
      row.operation || null,
      row.lookup_key || row.lookup_attempts || null,
    ]);
    if (this.lookupMissKeys.has(key)) return;
    this.lookupMissKeys.add(key);
    const entry = {
      ts: new Date().toISOString(),
      source_row_number: this.currentSourceRowNumber || null,
      ...row,
      required: blocking,
      business_critical: policyAuthorized ? false : Boolean(row.business_critical),
      critical: policyAuthorized ? false : Boolean(row.critical),
      policy_authorized: policyAuthorized,
    };
    this.lookupMissCount += 1;
    if (policyAuthorized) this.policyAuthorizedLookupMissCount += 1;
    if (entry.required) this.requiredLookupMissCount += 1;
    if (!policyAuthorized && (row.business_critical || row.critical)) this.criticalLookupMissCount += 1;
    if (this.lookupMisses.length < this.reportDetailLimit) this.lookupMisses.push(entry);
    else this.lookupMissesOmitted += 1;
    this.stat(row.profile || 'unknown', 'lookup_misses', 1);
    this.log(blocking ? 'warn' : 'debug', 'lookup_miss', blocking ? 'Blocking lookup was not resolved.' : 'Optional lookup was not resolved.', entry);
  }
  preview(row) {
    this.previewRowCount += 1;
    if (this.previewRows.length < this.previewDetailLimit) this.previewRows.push({ ts: new Date().toISOString(), ...row });
    else this.previewRowsOmitted += 1;
  }
  writeRowProgress(event = {}) {
    if (!this.progressJsonlEnabled) return;
    const line = { ts: new Date().toISOString(), runId: this.runId, mode: this.dryRun ? 'dry-run' : 'live', ...event };
    fs.appendFileSync(this.progressJsonlPath, `${JSON.stringify(line)}\n`, 'utf8');
  }
  writeStatus(patch = {}) {
    this.status = { ...this.status, ...patch, stats: this.stats, updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(this.outputDir, 'status.json'), JSON.stringify(this.status, null, 2));
    this.log(this.status.status === 'failed' ? 'error' : 'debug', 'status_updated', this.status.message || 'Run status updated.', { status: this.status });
  }
}

function resetRowScopedCaches(ctx) {
  ctx.cache?.lookups?.clear?.();
  // lookupMissKeys is deduplicated by source row (the key includes
  // currentSourceRowNumber/source_row_number). Entries from a completed row
  // can never suppress a miss on a later row, so retaining them for an entire
  // 100k+ row profile is pure memory growth. Keep the dedupe set row-scoped.
  ctx.lookupMissKeys?.clear?.();
}


function collectChunkDispoFilter({ csvDir, contract, selectedProfiles, offset = 0, limit = null }) {
  if (limit === null || !Array.isArray(selectedProfiles) || selectedProfiles.length !== 1) return null;
  const profile = (contract.profiles || []).find((p) => p.id === selectedProfiles[0]);
  if (!profile || !profile.source_file) return null;
  const file = path.resolve(csvDir, profile.source_file);
  if (!fs.existsSync(file)) return null;
  const filter = new Set();
  let dataIndex = 0;
  let selected = 0;
  forEachSourceObject(file, (row) => {
    if (dataIndex < offset) { dataIndex += 1; return true; }
    if (selected >= limit) return false;
    dataIndex += 1;
    selected += 1;
    const raw = row['Dispo No'] ?? row['Dispo No.'] ?? row['Dispo'] ?? row['dispo_number'] ?? null;
    const normalized = normalizeMatchText(raw);
    if (normalized) filter.add(normalized);
    return true;
  });
  return filter;
}


function verifyPrevalidatedDryRunAcceptance({ runId, outputRoot, expectedSha256, contractHash, manifestSha256 }) {
  const acceptancePath = path.join(path.resolve(outputRoot), runId, 'full_dry_run_acceptance.json');
  const errors = [];
  if (!/^[a-f0-9]{64}$/i.test(String(expectedSha256 || ''))) errors.push({ code: 'PREVALIDATED_ACCEPTANCE_HASH_INVALID', message: 'Prevalidated dry-run acceptance SHA-256 is missing or malformed.' });
  if (!fs.existsSync(acceptancePath)) errors.push({ code: 'PREVALIDATED_ACCEPTANCE_MISSING', message: `Prevalidated dry-run acceptance file is missing: ${acceptancePath}` });
  if (errors.length) return { ok: false, errors, acceptancePath };
  const actualSha256 = sha256File(acceptancePath);
  if (actualSha256 !== String(expectedSha256).toLowerCase()) errors.push({ code: 'PREVALIDATED_ACCEPTANCE_HASH_MISMATCH', message: 'Dry-run acceptance evidence differs from the wrapper-prevalidated file.', expected: expectedSha256, actual: actualSha256 });
  let evidence = null;
  try { evidence = JSON.parse(fs.readFileSync(acceptancePath, 'utf8')); }
  catch (error) { errors.push({ code: 'PREVALIDATED_ACCEPTANCE_PARSE_FAILED', message: error.message }); }
  if (evidence) {
    if (evidence.ok !== true || (evidence.errors || []).length !== 0) errors.push({ code: 'PREVALIDATED_ACCEPTANCE_NOT_PASS', message: 'Prevalidated dry-run acceptance evidence is not PASS.' });
    if (evidence.runId !== runId) errors.push({ code: 'PREVALIDATED_ACCEPTANCE_RUN_ID_MISMATCH', message: 'Prevalidated dry-run acceptance run ID mismatch.', expected: runId, actual: evidence.runId });
    if (evidence.contractHash !== contractHash) errors.push({ code: 'PREVALIDATED_ACCEPTANCE_CONTRACT_MISMATCH', message: 'Prevalidated dry-run acceptance contract hash mismatch.', expected: contractHash, actual: evidence.contractHash });
    if (evidence.sourceManifestSha256 !== manifestSha256) errors.push({ code: 'PREVALIDATED_ACCEPTANCE_MANIFEST_MISMATCH', message: 'Prevalidated dry-run acceptance manifest hash mismatch.', expected: manifestSha256, actual: evidence.sourceManifestSha256 });
  }
  return { ok: errors.length === 0, errors, acceptancePath, acceptanceSha256: actualSha256 };
}

function dbHandle(ctx) { return ctx.conn || ctx.pool; }

async function connectIfPossible(ctx) {
  const missing = ['DB_USER'].filter(k => !process.env[k]);
  if (!mysql && !missing.length) throw new Error('mysql2 dependency is not installed. Run npm ci before DB-backed validation or live import.');
  if (missing.length) {
    if (ctx.live) throw new Error(`Missing DB credentials for live run: ${missing.join(', ')}`);
    ctx.addValidation({ level: 'warn', scope: 'db', message: 'DB credentials missing; dry-run will validate schema from bundled SQL schema and skip DB-backed master resolution.', missing: missing.join(',') });
    ctx.log('warn', 'database_credentials_missing', 'Database credentials are unavailable for this dry-run.', { missing });
    return;
  }
  try {
    const configuredDb = envVal('DB_NAME', 'weavonpq_weaving');
    if (envBool('LOCAL_PRESERVE_RETAINED', false)) require('../scripts/local/db').cfg(configuredDb);
    ctx.pool = await mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: configuredDb,
      charset: 'utf8mb4',
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });

    const [[dbRow]] = await ctx.pool.query('SELECT DATABASE() AS database_name');
    const actualDb = String(dbRow?.database_name || '');
    const expectedDb = envVal('IMPORT_EXPECTED_DB', '');
    const requireGuard = envBool('REQUIRE_DB_GUARD', ctx.live);
    if (requireGuard && !expectedDb) {
      throw new Error('Database guard is enabled but IMPORT_EXPECTED_DB is empty. Set it to the exact intended target database name before migration.');
    }
    if (expectedDb && actualDb !== expectedDb) {
      throw new Error(`Database guard mismatch. Expected ${expectedDb}; connected to ${actualDb}.`);
    }

    const productionDb = envVal('PRODUCTION_DB_NAME', 'weavonpq_weaving');
    if (ctx.live && actualDb === productionDb) {
      const allowProduction = envBool('ALLOW_PRODUCTION_DB', false) || Boolean(ctx.args['allow-production-db']);
      const configuredToken = envVal('PRODUCTION_APPROVAL_TOKEN', '');
      const suppliedToken = String(ctx.args['production-approval'] || '');
      if (!allowProduction || !configuredToken || suppliedToken !== configuredToken) {
        throw new Error(`Live import against production database ${actualDb} is blocked. Production requires explicit ALLOW_PRODUCTION_DB=true or --allow-production-db, plus a matching --production-approval token.`);
      }
    }

    const [tables] = await ctx.pool.query('SHOW TABLES');
    for (const row of tables) {
      const table = Object.values(row)[0];
      const [cols] = await ctx.pool.query(`SHOW COLUMNS FROM \`${table}\``);
      ctx.tableColumns[table] = new Set(cols.map(c => c.Field));
    }
    if (envBool('LOCAL_PRESERVE_RETAINED', false)) ctx.localRetainedMasters = await require('../scripts/local/protect_retained_rows').loadRetainedMasterKeys(ctx.pool);
    ctx.addValidation({ level: 'info', scope: 'db', message: 'Connected to MySQL, passed database guard, and loaded live table columns.', database: actualDb });
    ctx.log('info', 'database_connected', 'Connected to MySQL and loaded live table metadata.', { database: actualDb, expectedDatabase: expectedDb || null, tableCount: tables.length });
  } catch (error) {
    if (ctx.pool && ctx.pool.end) await ctx.pool.end().catch(() => {});
    ctx.pool = null;
    if (ctx.live || envBool('REQUIRE_DB_GUARD', false)) throw error;
    ctx.addValidation({ level: 'warn', scope: 'db', message: 'MySQL is not reachable; dry-run will continue with bundled schema and DB-backed resolutions skipped.', error: error.message });
    ctx.log('error', 'database_connection_failed', 'MySQL connection failed.', { error });
  }
}

function validateContract(ctx) {
  const profileIds = new Set(ctx.contract.profiles.map(p => p.id));
  const order = ctx.contract.import_order || [];
  const profileOrder = new Map(order.map((id, i) => [id, i]));
  const tableProducers = new Map();
  for (const profile of ctx.contract.profiles || []) {
    const orderIndex = profileOrder.has(profile.id) ? profileOrder.get(profile.id) : Number.MAX_SAFE_INTEGER;
    for (let ti = 0; ti < (profile.tables || []).length; ti++) {
      const table = profile.tables[ti];
      if (!tableProducers.has(table.name)) tableProducers.set(table.name, []);
      tableProducers.get(table.name).push({ profile: profile.id, orderIndex, tableIndex: ti });
    }
  }
  for (const id of order) {
    if (!profileIds.has(id)) ctx.addValidation({ level: 'error', code: 'IMPORT_ORDER_PROFILE_MISSING', scope: 'contract', message: `Import order references missing profile ${id}` });
  }
  for (const profile of ctx.contract.profiles) {
    const currentOrder = profileOrder.get(profile.id) ?? Number.MAX_SAFE_INTEGER;
    const tableIndex = new Map((profile.tables || []).map((t, i) => [t.name, i]));
    const mappingPosition = new Map();
    const mappingCounts = new Map();
    (profile.mappings || []).forEach((mapping, index) => {
      const key = `${mapping.table}.${mapping.field}`;
      mappingCounts.set(key, (mappingCounts.get(key) || 0) + 1);
      if (!mappingPosition.has(key)) mappingPosition.set(key, index);
    });
    for (const [key, count] of mappingCounts) {
      if (count > 1) {
        const dot = key.indexOf('.');
        ctx.addValidation({
          level: 'error',
          code: 'DUPLICATE_CONTRACT_TARGET',
          profile: profile.id,
          table: key.slice(0, dot),
          field: key.slice(dot + 1),
          count,
          message: 'A target field may have only one executable contract mapping.',
        });
      }
    }
    for (const table of profile.tables || []) {
      if (!ctx.schema[table.name]) ctx.addValidation({ level: 'error', code: 'TARGET_TABLE_MISSING', profile: profile.id, table: table.name, message: 'Target table missing from schema.' });
      for (const key of table.natural_key || []) {
        if (!ctx.schema[table.name]?.[key]) ctx.addValidation({ level: 'error', code: 'NATURAL_KEY_COLUMN_MISSING', profile: profile.id, table: table.name, field: key, message: 'Natural key column missing from schema.' });
      }
      if (table.parent) {
        if (!tableIndex.has(table.parent.parent_table) || tableIndex.get(table.parent.parent_table) >= tableIndex.get(table.name)) {
          ctx.addValidation({ level: 'error', code: 'PARENT_TABLE_ORDER_INVALID', profile: profile.id, table: table.name, parent_table: table.parent.parent_table, message: 'Parent table must appear earlier in the same profile.' });
        }
      }
    }
    for (const mapping of profile.mappings || []) {
      if (!ctx.schema[mapping.table]) ctx.addValidation({ level: 'error', code: 'MAPPED_TABLE_MISSING', profile: profile.id, table: mapping.table, field: mapping.field, message: 'Mapped target table missing from schema.' });
      else if (!ctx.schema[mapping.table][mapping.field]) ctx.addValidation({ level: 'error', code: 'MAPPED_COLUMN_MISSING', profile: profile.id, table: mapping.table, field: mapping.field, message: 'Mapped target column missing from schema.' });
      if ((mapping.business_critical || mapping.critical_lookup) && !mapping.required) {
        ctx.addValidation({
          level: 'error',
          code: 'CRITICAL_MAPPING_NOT_REQUIRED',
          profile: profile.id,
          table: mapping.table,
          field: mapping.field,
          message: 'Every business-critical lookup or formula must be explicitly required.',
        });
      }
      if (mapping.type === 'lookup') {
        if (!mapping.fallbacks || !mapping.fallbacks.length) ctx.addValidation({ level: 'error', code: 'LOOKUP_RULE_MISSING', profile: profile.id, table: mapping.table, field: mapping.field, message: 'Lookup mapping has no explicit fallback/lookup rule.' });
        for (const fb of mapping.fallbacks || []) {
          if (!fb.lookup) continue;
          const lk = fb.lookup;
          if (lk.current_field) {
            const currentKey = `${mapping.table}.${lk.current_field}`;
            const currentPos = mappingPosition.get(currentKey);
            const mappingPos = mappingPosition.get(`${mapping.table}.${mapping.field}`);
            if (!ctx.schema[mapping.table]?.[lk.current_field] || currentPos === undefined || currentPos >= mappingPos) {
              ctx.addValidation({ level: 'error', code: 'LOOKUP_CURRENT_FIELD_UNAVAILABLE', profile: profile.id, table: mapping.table, field: mapping.field, current_field: lk.current_field, message: 'Lookup current_field must be a mapped target field resolved earlier in the same table.' });
            }
          }
          for (const whereRule of lk.where || []) {
            if (!whereRule.current_field) continue;
            const currentKey = `${mapping.table}.${whereRule.current_field}`;
            const currentPos = mappingPosition.get(currentKey);
            const mappingPos = mappingPosition.get(`${mapping.table}.${mapping.field}`);
            if (!ctx.schema[mapping.table]?.[whereRule.current_field] || currentPos === undefined || currentPos >= mappingPos) {
              ctx.addValidation({ level: 'error', code: 'LOOKUP_CURRENT_FIELD_UNAVAILABLE', profile: profile.id, table: mapping.table, field: mapping.field, current_field: whereRule.current_field, message: 'Lookup where.current_field must be resolved earlier in the same table.' });
            }
          }
          if (!ctx.schema[lk.table]) ctx.addValidation({ level: 'error', code: 'LOOKUP_TABLE_MISSING', profile: profile.id, table: mapping.table, field: mapping.field, lookup_table: lk.table, message: 'Lookup table missing from schema.' });
          else {
            if (!ctx.schema[lk.table][lk.key_field]) ctx.addValidation({ level: 'error', code: 'LOOKUP_KEY_FIELD_MISSING', profile: profile.id, table: mapping.table, field: mapping.field, lookup_table: lk.table, lookup_field: lk.key_field, message: 'Lookup key field missing from schema.' });
            if (!ctx.schema[lk.table][lk.result_field]) ctx.addValidation({ level: 'error', code: 'LOOKUP_RESULT_FIELD_MISSING', profile: profile.id, table: mapping.table, field: mapping.field, lookup_table: lk.table, lookup_field: lk.result_field, message: 'Lookup result field missing from schema.' });
          }
          const producers = tableProducers.get(lk.table) || [];
          if (producers.length && !producers.some(p => p.orderIndex <= currentOrder)) ctx.addValidation({ level: 'error', code: 'LOOKUP_DEPENDENCY_AFTER_CONSUMER', profile: profile.id, table: mapping.table, field: mapping.field, lookup_table: lk.table, message: 'Lookup table is produced after the consuming profile.' });
        }
      }
      if (mapping.type === 'formula') {
        if (!mapping.expression) ctx.addValidation({ level: 'error', code: 'FORMULA_EXPRESSION_MISSING', profile: profile.id, table: mapping.table, field: mapping.field, message: 'Formula mapping has no executable expression.' });
        else {
          try { new vm.Script(mapping.expression); } catch (error) { ctx.addValidation({ level: 'error', code: 'FORMULA_SYNTAX_INVALID', profile: profile.id, table: mapping.table, field: mapping.field, expression: mapping.expression, message: error.message }); }
          const mappingPos = mappingPosition.get(`${mapping.table}.${mapping.field}`);
          const fieldRefs = [...String(mapping.expression).matchAll(/field\(\s*(["'])(.*?)\1\s*\)/g)].map(match => match[2]);
          for (const refField of new Set(fieldRefs)) {
            const refPos = mappingPosition.get(`${mapping.table}.${refField}`);
            if (!ctx.schema[mapping.table]?.[refField] || refPos === undefined || refPos >= mappingPos) {
              ctx.addValidation({ level: 'error', code: 'FORMULA_FIELD_DEPENDENCY_UNAVAILABLE', profile: profile.id, table: mapping.table, field: mapping.field, dependency_field: refField, message: 'Formula field() dependency must be mapped earlier in the same target table.' });
            }
          }
        }
      }
    }
    for (const group of profile.repeated_groups || []) {
      if (!ctx.schema[group.target_table]) ctx.addValidation({ level: 'error', code: 'REPEATED_TARGET_TABLE_MISSING', profile: profile.id, table: group.target_table, message: 'Repeated group target table missing from schema.' });
      for (const field of [group.parent_key_field, group.sequence_field, ...Object.keys(group.fields || {}), ...(group.global_fields || []).map(g => g.field)].filter(Boolean)) {
        if (!ctx.schema[group.target_table]?.[field]) ctx.addValidation({ level: 'error', code: 'REPEATED_TARGET_FIELD_MISSING', profile: profile.id, table: group.target_table, field, message: 'Repeated group target field missing from schema.' });
      }
      if (!Array.isArray(group.create_when_any) && group.id !== 'dispo_warp_broken_section') ctx.addValidation({ level: 'error', code: 'REPEATED_CREATE_RULE_MISSING', profile: profile.id, table: group.target_table, message: 'Repeated group must define create_when_any.' });
    }
  }

  for (const fk of ctx.foreignKeys || []) {
    const childProducers = tableProducers.get(fk.child_table) || [];
    if (!childProducers.length) continue;
    const parentProducers = tableProducers.get(fk.parent_table) || [];
    let ok = false;
    let reason = '';
    if (!parentProducers.length) reason = 'Parent table is not produced by the mapping contract.';
    else {
      for (const child of childProducers) {
        if (parentProducers.some(parent => parent.orderIndex < child.orderIndex || (parent.orderIndex === child.orderIndex && parent.tableIndex < child.tableIndex))) { ok = true; break; }
      }
      if (!ok) reason = 'Parent table is not guaranteed to be produced before the child table.';
    }
    const row = { constraint: fk.constraint, child_table: fk.child_table, child_field: fk.child_field, parent_table: fk.parent_table, parent_field: fk.parent_field, ok, reason };
    ctx.fkDependencyReport.push(row);
    if (!ok && ctx.contract.validation_policy?.fail_on_fk_dependency) ctx.addValidation({ level: 'error', code: 'FK_DEPENDENCY_UNSATISFIED', scope: 'fk', ...row, message: reason });
  }
}
function hasFatalValidation(ctx) { return ctx.validationRows.some(r => r.level === 'error'); }

const DISPO_SOURCE_COLUMNS = new Set([
  'dispo no',
  'dispo no.',
  'dispo number',
  'received gd no',
  'received against dispo nos',
  'received against dispo no',
]);
function normalizedSourceName(name) {
  return String(name || '').replace(/\u00a0/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
}
function isDispoSourceColumn(name) {
  return DISPO_SOURCE_COLUMNS.has(normalizedSourceName(name));
}
function sourceGetter(fileInfo, row, canonicalDispo = null) {
  return function source(name) {
    if (cleanText(canonicalDispo) !== null && isDispoSourceColumn(name)) return canonicalDispo;
    return valueFromRow(fileInfo, row, name);
  };
}
function isDispoLookupField(field) {
  return ['dispo_number', 'dispo_no', 'received_against_dispo_nos'].includes(String(field || '').toLowerCase());
}
function normalizedWhereValue(field, value) {
  return isDispoLookupField(field) ? normalizeMatchText(value) : value;
}
function whereClause(field) {
  return isDispoLookupField(field) ? `LOWER(TRIM(\`${field}\`)) = ?` : `\`${field}\` = ?`;
}
async function findOne(ctx, table, where, orderBy) {
  const keys = Object.keys(where).filter(k => cleanText(where[k]) !== null);
  if (!keys.length || !ctx.pool) return null;
  const normalizedWhere = Object.fromEntries(keys.map(k => [k, normalizedWhereValue(k, where[k])]));
  const cacheKey = JSON.stringify({ table, where: normalizedWhere, orderBy });
  const stableCache = ctx.stableMasterLookupTables?.has(table) ? ctx.stableMasterLookupCache : null;
  if (stableCache?.has(cacheKey)) return stableCache.get(cacheKey);
  if (!ctx.conn && ctx.cache.lookups.has(cacheKey)) return ctx.cache.lookups.get(cacheKey);
  const sql = `SELECT * FROM \`${table}\` WHERE ${keys.map(whereClause).join(' AND ')} ${orderBy ? `ORDER BY ${orderBy}` : ''} LIMIT 1`;
  const [rows] = await dbHandle(ctx).query(sql, keys.map(k => normalizedWhere[k]));
  const row = rows[0] || null;
  // Only masters that this profile never writes are shared across its rows.
  // Live misses are not cached: approved placeholder creation may add a master.
  if (stableCache && (row || ctx.dryRun)) {
    if (stableCache.size >= 5000) stableCache.delete(stableCache.keys().next().value);
    stableCache.set(cacheKey,row);
  }
  if (!ctx.conn) ctx.cache.lookups.set(cacheKey, row);
  return row;
}
async function aggregate(ctx, table, field, where, dateField, uptoDate, fn = 'sum') {
  if (!ctx.pool) return null;
  const keys = Object.keys(where).filter(k => cleanText(where[k]) !== null);
  if (!keys.length) return null;
  const clauses = keys.map(whereClause);
  const params = keys.map(k => normalizedWhereValue(k, where[k]));
  if (dateField && uptoDate) { clauses.push(`\`${dateField}\` <= ?`); params.push(parseDate(uptoDate, ctx.dateOrder)); }
  const sql = `SELECT ${fn.toLowerCase() === 'max' ? 'MAX' : 'SUM'}(\`${field}\`) AS value FROM \`${table}\` WHERE ${clauses.join(' AND ')}`;
  const [rows] = await dbHandle(ctx).query(sql, params);
  return rows[0]?.value ?? null;
}
async function latestDate(ctx, table, dateField, keyField, keyValue, compareDateField, uptoDate) {
  if (!ctx.pool || !cleanText(keyValue)) return null;
  const targetDate = parseDate(uptoDate, ctx.dateOrder);
  const clauses = [whereClause(keyField)];
  const params = [normalizedWhereValue(keyField, keyValue)];
  if (compareDateField && targetDate) { clauses.push(`\`${compareDateField}\` <= ?`); params.push(targetDate); }
  const [rows] = await dbHandle(ctx).query(`SELECT MAX(\`${dateField}\`) AS value FROM \`${table}\` WHERE ${clauses.join(' AND ')}`, params);
  return rows[0]?.value ? String(rows[0].value).slice(0, 10) : null;
}

const EXPRESSION_HELPERS = [
  'source','field','sum','subtract','divide','mod','round','parseNumber','toIntOrNull','parseDate','cleanText',
  'firstNonNA','extractDispoRef','extractChallanRef','extractInt','extractLabelledInt','constructionCount','normalizeYarnCount','sanitizeToken',
  'sourceRowNumber','sourceWarpingValue','sourceYarnReceiptSum','sourceLatestDate','sourceCumulative','cumulative','latestDate'
];
const EXPRESSION_IDENTIFIER_ALLOWLIST = new Set([...EXPRESSION_HELPERS, 'null', 'true', 'false']);
function expressionIdentifiers(expression) {
  const stripped = String(expression || '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
  return stripped.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
}
function compileSafeExpression(expression) {
  const text = String(expression || '').trim();
  if (!text) throw new Error('Expression is blank.');
  const withoutStrings = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
  if (/[;`{}\[\]]/.test(withoutStrings) || /\b(?:this|globalThis|global|process|require|module|exports|Function|eval|constructor|prototype|__proto__|import)\b/.test(withoutStrings)) {
    throw new Error(`Unsafe expression syntax rejected: ${text}`);
  }
  const unexpected = expressionIdentifiers(text).filter((id) => !EXPRESSION_IDENTIFIER_ALLOWLIST.has(id));
  if (unexpected.length) throw new Error(`Unsupported expression identifier(s): ${[...new Set(unexpected)].join(', ')}`);
  // The contract and manifest hash-bind this expression. The explicit parameter
  // list plus identifier allowlist avoids global/process access while removing
  // the per-formula vm context overhead that caused cPanel dry-run timeouts.
  return new Function(...EXPRESSION_HELPERS, `"use strict"; return (${text});`);
}

async function evalExpression(ctx, profile, fileInfo, row, expression, currentTableRows, currentTable, mapping = null) {
  const source = sourceGetter(fileInfo, row, ctx.currentCanonicalDispo);
  const field = (name) => currentTableRows[currentTable]?.[name] ?? null;
  const policyAuthorizedNullable = isPolicyAuthorizedNullable(ctx, profile, mapping, currentTableRows);
  const dependencyRequired = !policyAuthorizedNullable && Boolean(mapping?.required || mapping?.business_critical || mapping?.critical_lookup);
  const sourceIndexValue = (kind, lookupKey, resultField, getter) => {
    const value = getter();
    if (cleanText(value) === null) {
      ctx.lookupMiss({
        profile: profile.id,
        table: mapping?.table || currentTable,
        field: mapping?.field || resultField,
        required: dependencyRequired,
        business_critical: policyAuthorizedNullable ? false : Boolean(mapping?.business_critical),
        critical: policyAuthorizedNullable ? false : Boolean(mapping?.critical_lookup),
        policy_authorized: policyAuthorizedNullable,
        policy_reason: policyAuthorizedNullable ? authorizedNullableReason(ctx, profile, mapping) : null,
        lookup_type: 'source_index_formula',
        lookup_table: `source_index:${kind}`,
        lookup_key: JSON.stringify(lookupKey),
        result_field: resultField,
        source_file: profile.source_file,
      });
    }
    return value;
  };
  const sourceDatasetForProfile = profile.id === 'greige-delivery' ? 'delivery' : profile.id;
  const sandbox = {
    source, field, sum, subtract, divide, mod, round: Math.round, parseNumber, toIntOrNull: parseInteger, parseDate: v => parseDate(v, ctx.dateOrder), cleanText,
    firstNonNA, extractDispoRef, extractChallanRef, extractInt, extractLabelledInt, constructionCount, normalizeYarnCount, sanitizeToken,
    sourceRowNumber: () => ctx.currentSourceRowNumber,
    sourceWarpingValue: (resultField, dispo, program, uptoDate) => sourceIndexValue('warping', { dispo, program, uptoDate }, resultField, () => ctx.sourceIndex?.warpingValue(resultField, dispo, program, uptoDate) ?? null),
    sourceYarnReceiptSum: (lot) => { const value = ctx.sourceIndex?.yarnReceiptSum(lot); return value === null || value === undefined ? 0 : value; },
    sourceLatestDate: (dataset, dispo, uptoDate) => sourceIndexValue(dataset, { dispo, uptoDate }, 'latest_date', () => ctx.sourceIndex?.latestDate(dataset, dispo, uptoDate) ?? null),
    sourceCumulative: (dataset, dispo, uptoDate, sequence = '') => sourceIndexValue(dataset, { dispo, uptoDate, sequence }, 'cumulative_quantity', () => ctx.sourceIndex?.cumulative(dataset, dispo, uptoDate, sequence, ctx.currentSourceRowNumber, dataset === sourceDatasetForProfile) ?? null),
    null: null,
    cumulative: (table, fld, keyField, keyValue, dateField, uptoDate) => ({ __async: 'aggregate', table, fld, keyField, keyValue, dateField, uptoDate }),
    latestDate: (table, fld, keyField, keyValue, dateField, uptoDate) => ({ __async: 'latestDate', table, fld, keyField, keyValue, dateField, uptoDate }),
  };
  let result;
  try {
    let compiled = ctx.cache.expressions.get(expression);
    if (!compiled) {
      compiled = compileSafeExpression(expression);
      ctx.cache.expressions.set(expression, compiled);
    }
    result = compiled(...EXPRESSION_HELPERS.map((name) => sandbox[name]));
  } catch (error) {
    ctx.reject({ profile: profile.id, table: currentTable, reason: 'formula_error', expression, error: error.message });
    return null;
  }
  if (result && result.__async === 'aggregate') return aggregate(ctx, result.table, result.fld, { [result.keyField]: result.keyValue }, result.dateField, result.uptoDate, 'sum');
  if (result && result.__async === 'latestDate') return latestDate(ctx, result.table, result.fld, result.keyField, result.keyValue, result.dateField, result.uptoDate);
  return result;
}
async function resolveLookup(ctx, profile, fileInfo, row, mapping, currentTableRows = {}, currentTable = '') {
  const source = sourceGetter(fileInfo, row, ctx.currentCanonicalDispo);
  const attempts = [];
  for (const fb of mapping.fallbacks || []) {
    if (fb.source) {
      const v = source(fb.source);
      attempts.push({ type: 'source', source_column: fb.source, resolved: cleanText(v) !== null });
      if (cleanText(v) !== null) return v;
    } else if (fb.expression) {
      const v = await evalExpression(ctx, profile, fileInfo, row, fb.expression, currentTableRows, currentTable, mapping);
      attempts.push({ type: 'expression', expression: fb.expression, resolved: cleanText(v) !== null });
      if (cleanText(v) !== null) return v;
    } else if (fb.lookup) {
      const lk = fb.lookup;
      let keyValue = lk.current_field ? currentTableRows[currentTable]?.[lk.current_field] : source(lk.source_column);
      if (isDispoLookupField(lk.key_field) && cleanText(ctx.currentCanonicalDispo) !== null) keyValue = ctx.currentCanonicalDispo;
      if (cleanText(keyValue) === null) {
        attempts.push({ type: 'lookup', lookup_table: lk.table, skipped: 'blank_key', result_field: lk.result_field });
        continue;
      }
      const where = { [lk.key_field]: keyValue };
      for (const w of lk.where || []) {
        let whereValue = w.current_field ? currentTableRows[currentTable]?.[w.current_field] : source(w.source_column);
        if (isDispoLookupField(w.key_field) && cleanText(ctx.currentCanonicalDispo) !== null) whereValue = ctx.currentCanonicalDispo;
        where[w.key_field] = whereValue;
      }

      // The target database may be intentionally empty during the mandatory dry
      // run. Resolve master enrichment from the immutable certified Dispo CSV
      // first, then fall back to SQL for manual relinks or pre-existing masters.
      if (!lk.aggregate && isDispoLookupField(lk.key_field)
          && ['dispo_plan_form', 'dispo_form_data', 'PO_form_data'].includes(lk.table)) {
        const sourceMasterValue = ctx.sourceIndex?.dispoValue(lk.result_field, keyValue) ?? null;
        attempts.push({ type: 'source_master', lookup_table: lk.table, where, result_field: lk.result_field, resolved: cleanText(sourceMasterValue) !== null });
        if (cleanText(sourceMasterValue) !== null) return sourceMasterValue;
      }

      if (lk.aggregate) {
        const val = await aggregate(ctx, lk.table, lk.result_field, where, lk.date_field || null, lk.upto_date_source ? source(lk.upto_date_source) : null, lk.aggregate);
        attempts.push({ type: 'aggregate', lookup_table: lk.table, where, result_field: lk.result_field, resolved: val !== null && val !== undefined });
        if (val !== null && val !== undefined) return val;
      } else {
        const ref = await findOne(ctx, lk.table, where, lk.order_by || null);
        const value = ref ? ref[lk.result_field] : null;
        attempts.push({ type: 'lookup', lookup_table: lk.table, where, result_field: lk.result_field, resolved: cleanText(value) !== null });
        if (cleanText(value) !== null) return value;
      }
    }
  }

  // Record exactly one miss for the unresolved target after the complete
  // source/expression/lookup fallback chain has been exhausted. A failed early
  // fallback must not block a row when a later fallback succeeds.
  const policyAuthorizedNullable = isPolicyAuthorizedNullable(ctx, profile, mapping, currentTableRows);
  ctx.lookupMiss({
    profile: profile.id,
    table: mapping.table,
    field: mapping.field,
    required: !policyAuthorizedNullable && Boolean(mapping.required || mapping.business_critical || mapping.critical_lookup),
    business_critical: policyAuthorizedNullable ? false : Boolean(mapping.business_critical),
    critical: policyAuthorizedNullable ? false : Boolean(mapping.critical_lookup),
    policy_authorized: policyAuthorizedNullable,
    policy_reason: policyAuthorizedNullable ? authorizedNullableReason(ctx, profile, mapping) : null,
    lookup_type: 'fallback_chain',
    lookup_attempts: JSON.stringify(attempts),
    source_file: profile.source_file,
  });
  return null;
}

function tableContract(profile, tableName) { return (profile.tables || []).find(t => t.name === tableName) || { name: tableName, natural_key: [] }; }
function rowRange(rows, ctx) {
  const start = Math.min(rows.length, ctx.offset);
  const end = ctx.limit === null ? rows.length : Math.min(rows.length, start + ctx.limit);
  return { start, end };
}
async function insertRow(ctx, table, data) {
  if (ctx.dryRun) return { insertId: null, action: 'previewed' };
  const columns = Object.keys(data).filter(k => data[k] !== undefined && k !== 'id');
  if (!columns.length) return { insertId: null, action: 'skipped_empty' };
  const sql = `INSERT INTO \`${table}\` (${columns.map(k => `\`${k}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
  const [result] = await dbHandle(ctx).query(sql, columns.map(k => data[k]));
  return { insertId: result.insertId || null, action: 'inserted' };
}
async function updateRow(ctx, table, data, where) {
  if (ctx.dryRun) return { action: 'previewed' };
  const cols = Object.keys(data).filter(k => data[k] !== undefined && !Object.prototype.hasOwnProperty.call(where, k) && k !== 'id');
  const whereKeys = Object.keys(where).filter(k => where[k] !== null && where[k] !== undefined);
  if (!cols.length || !whereKeys.length) return { action: 'skipped_empty' };
  const sql = `UPDATE \`${table}\` SET ${cols.map(k => `\`${k}\` = ?`).join(', ')} WHERE ${whereKeys.map(k => `\`${k}\` = ?`).join(' AND ')}`;
  await dbHandle(ctx).query(sql, [...cols.map(k => data[k]), ...whereKeys.map(k => where[k])]);
  return { action: 'updated' };
}
async function deleteChildren(ctx, table, where) {
  if (ctx.dryRun) return;
  const keys = Object.keys(where).filter(k => where[k] !== null && where[k] !== undefined);
  if (!keys.length) return;
  await dbHandle(ctx).query(`DELETE FROM \`${table}\` WHERE ${keys.map(k => `\`${k}\` = ?`).join(' AND ')}`, keys.map(k => where[k]));
}
async function deleteChildrenOnce(ctx, table, where) {
  const key = `${table}|${JSON.stringify(where)}`;
  if (ctx.deletedChildKeys.has(key)) return;
  ctx.deletedChildKeys.add(key);
  await deleteChildren(ctx, table, where);
}
function mergeDuplicateData(ctx, profile, table, existing, data) {
  // Sync supplies the complete current normalized daily total, never a delta.
  if (ctx.sync) return data;
  const rule = ctx.duplicateAggregation?.profiles?.[profile.id]?.tables?.[table];
  if (!rule || !existing) return data;
  const merged = { ...data };
  for (const field of rule.sum || []) {
    const incoming = parseNumber(data[field]);
    const prior = parseNumber(existing[field]);
    if (incoming !== null && prior !== null) merged[field] = Number((prior + incoming).toFixed(6));
    else if (incoming !== null && prior === null) merged[field] = incoming;
  }
  for (const field of rule.max || []) {
    const incoming = parseNumber(data[field]);
    const prior = parseNumber(existing[field]);
    if (incoming !== null && prior !== null) merged[field] = Math.max(prior, incoming);
    else if (incoming !== null && prior === null) merged[field] = incoming;
  }
  return merged;
}
async function upsertProvenanceParent(ctx, profile, table, data) {
  const sourceUid = cleanText(ctx.currentSourceUid);
  if (!sourceUid) {
    ctx.reject({ profile: profile.id, table, reason: 'missing_source_uid_for_provenance', source_row: ctx.currentSourceRowNumber });
    return { action: 'rejected', id: null };
  }

  let syncBinding;
  if (ctx.sync && ['yarn-issue', 'yarn-receive'].includes(profile.id) && ['update', 'refresh'].includes(ctx.syncOperation?.action) && ctx.pool) {
    syncBinding = await provenance.findBinding(ctx, profile.id, sourceUid, table);
    if (!syncBinding) {
      const error = new Error(`Missing tracked yarn binding for ${profile.id}/${table}/${sourceUid}; refusing to insert a replacement row.`);
      error.code = 'MISSING_YARN_SYNC_BINDING';
      throw error;
    }
  }
  if (ctx.dryRun || !ctx.pool) {
    const syntheticId = `DRY-${table}-${sourceUid.slice(0, 32)}`;
    ctx.preview({ profile: profile.id, table, action: 'preview_provenance_upsert', source_uid: sourceUid, data: JSON.stringify(data) });
    return { action: 'previewed', id: syntheticId };
  }

  const binding = syncBinding || await provenance.findBinding(ctx, profile.id, sourceUid, table);
  if (binding) {
    const existingTarget = await provenance.verifyTargetExists(ctx, table, binding.target_primary_key);
    if (!existingTarget) {
      const error = new Error(`Stale provenance binding for ${profile.id}/${table}/${sourceUid}: target ${binding.target_primary_key} no longer exists.`);
      error.code = 'STALE_PROVENANCE_BINDING';
      throw error;
    }
    await updateRow(ctx, table, data, { id: binding.target_primary_key });
    await provenance.recordBinding(ctx, { profileId: profile.id, sourceUid, table, targetPrimaryKey: binding.target_primary_key, action: 'updated' });
    return { action: 'updated', id: existingTarget.id || binding.target_primary_key };
  }

  const inserted = await insertRow(ctx, table, data);
  if (!inserted.insertId) throw new Error(`Provenance parent insert did not return an id for ${profile.id}/${table}.`);
  await provenance.recordBinding(ctx, { profileId: profile.id, sourceUid, table, targetPrimaryKey: inserted.insertId, action: 'inserted' });
  return { action: 'inserted', id: inserted.insertId };
}

async function upsertRow(ctx, profile, table, data) {
  if (ctx.localRetainedMasters && require('../scripts/local/protect_retained_rows').isRetainedMaster(ctx.localRetainedMasters, table, data)) return {action:'preserved', id:null};
  if (provenance.isProvenanceTable(ctx.provenancePolicy, profile.id, table)) return upsertProvenanceParent(ctx, profile, table, data);
  const tc = tableContract(profile, table);
  const keyFields = tc.natural_key || [];
  const naturalKey = {};
  for (const key of keyFields) if (data[key] !== undefined && data[key] !== null) naturalKey[key] = data[key];
  if (keyFields.length && Object.keys(naturalKey).length < keyFields.length) {
    ctx.reject({ profile: profile.id, table, reason: 'missing_natural_key', required_key: keyFields.join(','), data: JSON.stringify(data) });
    return { action: 'rejected', id: null };
  }
  if (!ctx.pool || ctx.dryRun || !keyFields.length) {
    const duplicateRule = ctx.duplicateAggregation?.profiles?.[profile.id]?.tables?.[table] || null;
    const dryRunKey = `${table}|${JSON.stringify(naturalKey)}`;
    const prior = (ctx.dryRun && duplicateRule) ? ctx.dryRunNaturalKeyRows?.get(dryRunKey) : null;
    const effectiveData = (ctx.dryRun && duplicateRule) ? mergeDuplicateData(ctx, profile, table, prior, data) : data;
    if (ctx.dryRun && duplicateRule) ctx.dryRunNaturalKeyRows?.set(dryRunKey, effectiveData);
    ctx.preview({ profile: profile.id, table, action: ctx.dryRun ? 'preview_upsert' : 'preview_insert', key: JSON.stringify(naturalKey), data: JSON.stringify(effectiveData) });
    const syntheticSeed = Object.values(naturalKey).join('|') || JSON.stringify(data).slice(0, 80);
    const syntheticId = `DRY-${table}-${sanitizeToken(syntheticSeed, 48)}`;
    return { action: 'previewed', id: syntheticId };
  }
  const existing = await findOne(ctx, table, naturalKey, null);
  if (existing) {
    await updateRow(ctx, table, mergeDuplicateData(ctx, profile, table, existing, data), naturalKey);
    return { action: 'updated', id: existing.id || null };
  }
  const result = await insertRow(ctx, table, data);
  return { action: 'inserted', id: result.insertId || null };
}

async function buildTableRows(ctx, profile, fileInfo, row) {
  const rowsByTable = {};
  const mappings = profile.mappings || [];
  // Repeated target tables are materialized exclusively by repeated_groups.
  // Visual field-level mappings for those tables remain useful as authoring metadata,
  // but must never create a synthetic one-row parent payload when a repeated group is disabled.
  const repeatedTargetTables = new Set((profile.repeated_groups || []).map(group => group.target_table));
  for (const table of profile.tables || []) rowsByTable[table.name] = {};
  const planOnlySkipTables = ctx.currentPlanOnlyDispo ? new Set(['dispo_form_data', 'warp_yarn_details', 'weft_yarn_details', 'warp_broken_section', 'warp_broken_pattern']) : new Set();
  for (const mapping of mappings) {
    if (repeatedTargetTables.has(mapping.table) || planOnlySkipTables.has(mapping.table)) continue;
    rowsByTable[mapping.table] ||= {};
    let value = null;
    if (mapping.type === 'direct') value = valueFromRow(fileInfo, row, mapping.source_column);
    else if (mapping.type === 'lookup') value = await resolveLookup(ctx, profile, fileInfo, row, mapping, rowsByTable, mapping.table);
    else if (mapping.type === 'formula') value = await evalExpression(ctx, profile, fileInfo, row, mapping.expression, rowsByTable, mapping.table, mapping);
    else if (mapping.type === 'parent_id') continue;
    const transformed = transformForTarget(value, mapping.target_type, mapping.field, { dateOrder: ctx.dateOrder });
    if (transformed !== null || mapping.required) rowsByTable[mapping.table][mapping.field] = transformed;
  }
  for (const mapping of mappings.filter(m => (m.required || m.business_critical || m.critical_lookup) && !repeatedTargetTables.has(m.table) && !planOnlySkipTables.has(m.table))) {
    const value = rowsByTable[mapping.table]?.[mapping.field];
    if (value === null || value === undefined || value === '') {
      if (isPolicyAuthorizedNullable(ctx, profile, mapping, rowsByTable)) continue;
      const label = mapping.required ? 'Required' : 'Business-critical';
      throw new Error(`${label} mapping unresolved: ${mapping.table}.${mapping.field}`);
    }
  }
  return rowsByTable;
}
function sourceValueList(fileInfo, row, spec, i) {
  const names = Array.isArray(spec) ? spec : [spec];
  for (const raw of names) {
    const name = String(raw).replace(/\{i\}/g, String(i));
    const v = valueFromRow(fileInfo, row, name);
    if (cleanText(v) !== null) return v;
  }
  return null;
}
function conditionPositive(rowData, cond) {
  const m = String(cond).match(/^([A-Za-z0-9_]+)\s*>\s*0$/);
  if (!m) return cleanText(rowData[cond]) !== null;
  const n = parseNumber(rowData[m[1]]);
  return n !== null && n > 0;
}
async function buildRepeatedRows(ctx, profile, fileInfo, row, rowsByTable) {
  const out = {};
  for (const group of profile.repeated_groups || []) {
    if (group.enabled_env && !['1', 'true', 'yes'].includes(String(process.env[group.enabled_env] || '').toLowerCase())) continue;
    const table = group.target_table;
    out[table] ||= [];
    if (group.id === 'dispo_warp_broken_section') {
      const d = {};
      for (const [field, spec] of Object.entries(group.fields || {})) {
        if (typeof spec === 'string' && spec.includes('field(')) d[field] = await evalExpression(ctx, profile, fileInfo, row, spec, { [table]: d }, table);
        else d[field] = sourceValueList(fileInfo, row, spec, 1);
        d[field] = transformForTarget(d[field], ctx.schema[table]?.[field], field, { dateOrder: ctx.dateOrder });
      }
      // A Dispo number alone must not create an empty broken-section row.
      const hasSectionData = cleanText(d.lower_beam_total_ends) !== null || cleanText(d.round_no_of_section) !== null;
      if (cleanText(d.dispo_number) !== null && hasSectionData) out[table].push(nonEmptyObject(d));
      continue;
    }
    const [from, to] = group.range || [1, 0];
    let seq = 1;
    for (let i = from; i <= to; i++) {
      const d = {};
      d[group.parent_key_field] = sourceValueList(fileInfo, row, group.parent_key_source, i);
      for (const g of group.global_fields || []) d[g.field] = sourceValueList(fileInfo, row, g.source_column, i) ?? g.default ?? null;
      for (const [field, spec] of Object.entries(group.fields || {})) {
        if (field === 'total_fraction_ends' || field === 'total_required_ends') {
          let total = 0; let found = false;
          for (let sec = 1; sec <= 8; sec++) { const n = parseInteger(sourceValueList(fileInfo, row, `Color ${i}-Column ${sec}`, i)); if (n !== null) { total += n; found = true; } }
          d[field] = found ? total : null;
        } else d[field] = sourceValueList(fileInfo, row, spec, i);
        d[field] = transformForTarget(d[field], ctx.schema[table]?.[field], field, { dateOrder: ctx.dateOrder });
      }
      if (group.sequence_field) d[group.sequence_field] = seq;
      const shouldCreate = (group.create_when_any || []).some(cond => conditionPositive(d, cond));
      if (!shouldCreate) continue;
      if (table === 'warp_yarn_details' || table === 'weft_yarn_details') {
        d.count = normalizeYarnCount(d.count);
        d.cal_count = normalizeYarnCount(d.cal_count === null ? d.count : d.cal_count);
      }
      out[table].push(nonEmptyObject(d));
      seq += 1;
    }
  }
  return out;
}
function expressionSourceColumns(expression) {
  const out = [];
  const re = /source\(\s*(["'])(.*?)\1\s*\)/g;
  let match;
  while ((match = re.exec(String(expression || ''))) !== null) out.push(match[2]);
  return [...new Set(out.filter(Boolean))];
}
function validateMappingSourceHeaders(ctx, profile, fileInfo) {
  const sourceHeaders = new Set(fileInfo.headers);
  const normalizedHeaders = new Set(fileInfo.headers.map(normalizeHeader));
  const exists = (col) => sourceHeaders.has(col) || normalizedHeaders.has(normalizeHeader(col));
  const reported = new Set();
  const report = (mapping, col, origin) => {
    if (!col || exists(col)) return;
    const key = `${mapping.table}|${mapping.field}|${col}|${origin}`;
    if (reported.has(key)) return;
    reported.add(key);
    ctx.addValidation({ level: 'error', code: 'SOURCE_COLUMN_MISSING', profile: profile.id, table: mapping.table, field: mapping.field, source_column: col, source_origin: origin, message: 'Source column missing.' });
  };
  for (const mapping of profile.mappings || []) {
    for (const col of mapping.source_columns || []) report(mapping, col, 'source_columns');
    if (mapping.source_column) report(mapping, mapping.source_column, 'source_column');
    if (mapping.type === 'formula') for (const col of expressionSourceColumns(mapping.expression)) report(mapping, col, 'formula_expression');
    if (mapping.type === 'lookup') {
      for (const fb of mapping.fallbacks || []) {
        if (fb.source) report(mapping, fb.source, 'lookup_source_fallback');
        if (fb.expression) for (const col of expressionSourceColumns(fb.expression)) report(mapping, col, 'lookup_expression_fallback');
        if (!fb.lookup) continue;
        if (fb.lookup.source_column) report(mapping, fb.lookup.source_column, 'lookup_key_source');
        if (fb.lookup.upto_date_source) report(mapping, fb.lookup.upto_date_source, 'lookup_upto_date_source');
        for (const where of fb.lookup.where || []) if (where.source_column) report(mapping, where.source_column, 'lookup_where_source');
      }
    }
  }
}

function validateRepeatedSourceHeaders(ctx, profile, fileInfo) {
  const exact = new Set(fileInfo.headers);
  const normalized = new Set(fileInfo.headers.map(normalizeHeader));
  const exists = (name) => exact.has(name) || normalized.has(normalizeHeader(name));
  const reportMissing = (group, field, sourceColumn) => ctx.addValidation({
    level: 'error', code: 'REPEATED_SOURCE_COLUMN_MISSING', profile: profile.id,
    table: group.target_table, group: group.id, field, source_column: sourceColumn,
    message: 'Repeated-group source column missing.'
  });
  for (const group of profile.repeated_groups || []) {
    if (group.enabled_env && !['1', 'true', 'yes'].includes(String(process.env[group.enabled_env] || '').toLowerCase())) continue;
    const [from, to] = group.range || [1, 1];
    const checks = [];
    if (group.parent_key_source) checks.push(['parent_key', group.parent_key_source, from]);
    for (const item of group.global_fields || []) if (item.source_column) checks.push([item.field, item.source_column, from]);
    for (const [field, spec] of Object.entries(group.fields || {})) {
      const specs = Array.isArray(spec) ? spec : [spec];
      for (const raw of specs) {
        if (typeof raw !== 'string') continue;
        if (/field\(|sumSections\(/.test(raw)) continue;
        checks.push([field, raw, from]);
      }
    }
    const seen = new Set();
    for (const [field, raw, sampleIndex] of checks) {
      const expanded = String(raw).replace(/\{i\}/g, String(sampleIndex));
      const key = `${field}|${expanded}`;
      if (seen.has(key)) continue;
      seen.add(key);
      // Alternative source lists are valid when any candidate exists. They are checked as a group below.
      const originalSpec = group.fields?.[field];
      if (Array.isArray(originalSpec)) {
        const candidates = originalSpec.map(v => String(v).replace(/\{i\}/g, String(sampleIndex))).filter(v => !/field\(|sumSections\(/.test(v));
        if (candidates.some(exists)) continue;
        const altKey = `${field}|alternatives`;
        if (!seen.has(altKey)) { seen.add(altKey); reportMissing(group, field, candidates.join(' | ')); }
        continue;
      }
      if (!exists(expanded)) reportMissing(group, field, expanded);
    }
  }
}

function sourceRowKeyContext(fileInfo, row) {
  const values = {};
  const headers = fileInfo?.headers || [];
  for (let index = 0; index < headers.length && Object.keys(values).length < 12; index += 1) {
    const header = String(headers[index] || '').trim();
    if (!header || !/(?:^|\b)(?:id|no|number|code|lot|buyer|po|dispo|pre[ _-]?cost)(?:\b|$)/i.test(header)) continue;
    const value = cleanText(row?.[index]);
    if (value !== null) values[header] = value;
  }
  return values;
}


function firstSourceValue(fileInfo, row, names) {
  for (const name of names) {
    const value = valueFromRow(fileInfo, row, name);
    if (cleanText(value) !== null) return value;
  }
  return null;
}

function dispoSampleFromSource(fileInfo, row) {
  return {
    buyer: firstSourceValue(fileInfo, row, ['Buyer', 'BUYER NAME', 'Buyer Name']),
    construction: firstSourceValue(fileInfo, row, ['Construction', 'Production Construction', 'PRODUCTION CONSTRUCTION', 'Sticker Construction']),
    composition: firstSourceValue(fileInfo, row, ['Fabric Composition', 'FABRIC COMPOSITION', 'Yarn Composition']),
  };
}

function rawDispoFromSource(profile, fileInfo, row) {
  if (profile.id === 'yarn-receive') {
    return firstNonNA(
      valueFromRow(fileInfo, row, 'Received GD NO'),
      extractDispoRef(valueFromRow(fileInfo, row, 'Special Notes')),
      extractDispoRef(valueFromRow(fileInfo, row, 'Search Column')),
    );
  }
  return firstSourceValue(fileInfo, row, ['Dispo No', 'Dispo No.', 'DISPO NUMBER', 'Received GD NO']);
}

function applyCanonicalDispo(rowsByTable, repeatedRows, canonicalDispo) {
  for (const tableData of Object.values(rowsByTable || {})) {
    if (!tableData) continue;
    if (Object.prototype.hasOwnProperty.call(tableData, 'dispo_number')) tableData.dispo_number = canonicalDispo;
    if (Object.prototype.hasOwnProperty.call(tableData, 'dispo_no')) tableData.dispo_no = canonicalDispo;
    if (Object.prototype.hasOwnProperty.call(tableData, 'received_against_dispo_nos')) tableData.received_against_dispo_nos = canonicalDispo;
  }
  for (const rows of Object.values(repeatedRows || {})) {
    for (const item of rows || []) {
      if (Object.prototype.hasOwnProperty.call(item, 'dispo_number')) item.dispo_number = canonicalDispo;
      if (Object.prototype.hasOwnProperty.call(item, 'dispo_no')) item.dispo_no = canonicalDispo;
      if (Object.prototype.hasOwnProperty.call(item, 'received_against_dispo_nos')) item.received_against_dispo_nos = canonicalDispo;
    }
  }
}

async function resolveLogicalUnitDispoBeforeMappings(ctx, profile, fileInfo, row) {
  ctx.currentRawDispo = null;
  ctx.currentCanonicalDispo = null;
  if (!ctx.dispoResolver?.shouldResolve(profile.id)) return;
  const rawDispo = rawDispoFromSource(profile, fileInfo, row);
  if (['yarn-receive', 'yarn-issue'].includes(profile.id)) {
    ctx.currentRawDispo = cleanText(rawDispo);
    const sourceMaster = cleanText(rawDispo) !== null ? (ctx.sourceIndex?.dispoMaster(rawDispo) || null) : null;
    ctx.currentCanonicalDispo = sourceMaster?.dispoNumber || cleanText(rawDispo);
    ctx.currentPlanOnlyDispo = sourceMaster?.operationalMode === 'plan-only';
    return;
  }
  const canonical = await ctx.dispoResolver.resolve({
    profileId: profile.id,
    sourceTable: profile.source_file,
    rawDispo,
    sample: dispoSampleFromSource(fileInfo, row),
  });
  ctx.currentRawDispo = rawDispo;
  ctx.currentCanonicalDispo = canonical;
  ctx.currentPlanOnlyDispo = Boolean(canonical && ctx.sourceIndex?.isPlanOnlyDispo(canonical));
}

async function recordPlaceholderPreCostingAudit(ctx, profile, fileInfo, row) {
  if (!ctx.pool || ctx.dryRun || profile.id !== 'pre-costing-bootstrap') return;
  const pre = cleanText(valueFromRow(fileInfo, row, 'PRE_COSTING_NO'));
  if (!pre || !/^MIGPC(?:V)?-[a-f0-9]{32}$/i.test(pre)) return;
  const poNo = cleanText(valueFromRow(fileInfo, row, 'PO NO')) || cleanText(valueFromRow(fileInfo, row, 'PO NUMBER'));
  const db = ctx.conn || ctx.pool;
  await db.query(`INSERT INTO import_placeholder_precosting_audit
    (placeholder_pre_costing_no, po_no, source_uid, source_file, source_row_number, source_manifest_sha256, first_run_id, last_run_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      po_no=COALESCE(VALUES(po_no),po_no), source_uid=COALESCE(VALUES(source_uid),source_uid),
      source_file=VALUES(source_file), source_row_number=VALUES(source_row_number),
      source_manifest_sha256=VALUES(source_manifest_sha256), last_run_id=VALUES(last_run_id), updated_at=CURRENT_TIMESTAMP`,
    [pre, poNo, ctx.currentSourceUid || null, profile.source_file, ctx.currentSourceRowNumber || null, ctx.sourceManifestFileSha256 || null, ctx.runId, ctx.runId]);
}

async function recordOptionalUnlinkedAudits(ctx, profile, fileInfo, row) {
  if (!ctx.pool || ctx.dryRun || !ctx.currentSourceUid) return;
  const findings = [];
  if (['yarn-receive', 'yarn-issue'].includes(profile.id)) {
    const rawDispo = cleanText(rawDispoFromSource(profile, fileInfo, row));
    if (rawDispo === null) findings.push(['dispo_number', 'Source Dispo is blank; event retained with nullable Dispo link under approved v3.2.3 policy.']);
    else if (!ctx.sourceIndex?.dispoMaster(rawDispo)) findings.push(['dispo_number', 'Source Dispo text has no certified Dispo master; event retained as an unlinked source reference under approved v3.2.3 policy.']);
  }
  if (profile.id === 'yarn-receive' && cleanText(firstSourceValue(fileInfo, row, ['Challan No', 'Challan No.', 'S/R/Challan No'])) === null) findings.push(['challan_no', 'Source receipt challan is blank; event retained with nullable challan.']);
  if (profile.id === 'yarn-issue' && cleanText(firstSourceValue(fileInfo, row, ['S/R/Challan No', 'Issue Challan No'])) === null) findings.push(['issue_challan_no', 'Source issue challan is blank; event retained with nullable challan.']);
  if (profile.id === 'greige-delivery' && cleanText(firstSourceValue(fileInfo, row, ['Challan No'])) === null) findings.push(['challan_no', 'Source delivery challan is blank; event retained with nullable challan.']);
  if (!findings.length) return;
  const db = ctx.conn || ctx.pool;
  for (const [fieldName, reason] of findings) {
    await db.query(`INSERT INTO import_unlinked_source_row_audit
      (profile, source_uid, source_file, source_row_number, field_name, reason, source_manifest_sha256, first_run_id, last_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE source_file=VALUES(source_file), source_row_number=VALUES(source_row_number), reason=VALUES(reason), source_manifest_sha256=VALUES(source_manifest_sha256), last_run_id=VALUES(last_run_id), updated_at=CURRENT_TIMESTAMP`,
      [profile.id, ctx.currentSourceUid, profile.source_file, ctx.currentSourceRowNumber || null, fieldName, reason, ctx.sourceManifestFileSha256 || null, ctx.runId, ctx.runId]);
  }
}

async function processProfile(ctx, profile) {
  if (ctx.localRetainedMasters) {
    const written = new Set((profile.tables || []).map(t=>t.name));
    ctx.stableMasterLookupTables = new Set(['pre_costing_data','PO_form_data','dispo_plan_form','dispo_form_data'].filter(t=>!written.has(t)));
    ctx.stableMasterLookupCache = new Map();
  }
  const csvPath = path.resolve(ctx.csvDir, profile.source_file);
  if (!fs.existsSync(csvPath)) {
    ctx.addValidation({ level: 'error', code: 'SOURCE_FILE_MISSING', profile: profile.id, source_file: profile.source_file, message: 'Source CSV file not found.' });
    return;
  }

  const profileStartedAt = Date.now();
  const headerRow = Number(profile.header_row || 0);
  const parser = iterateCsvRows(csvPath);
  let logicalRecordNumber = 0;
  let dataRowsSeen = 0;
  let rangeRowsProcessed = 0;
  let fileInfo = null;
  let profileRecon = null;
  let fatalForProfile = false;
  const manifestExpectedRows = Number(ctx.sourceManifestEntries?.get(profile.source_file)?.nonempty_rows);
  const expectedSourceRows = Number.isFinite(manifestExpectedRows) ? manifestExpectedRows : null;
  const expectedProcessRows = expectedSourceRows === null
    ? null
    : Math.max(0, Math.min(ctx.limit === null ? Number.MAX_SAFE_INTEGER : ctx.limit, expectedSourceRows - ctx.offset));

  const executeLogicalUnit = async (row) => {
    if (ctx.localRetainedMasters) {
      const retained = require('../scripts/local/protect_retained_rows').isRetainedMaster;
      const matches = (table,key,column) => retained(ctx.localRetainedMasters,table,{[key]:valueFromRow(fileInfo,row,column)});
      if ((profile.id === 'po' && matches('PO_form_data','po_no','PO NO')) ||
          (profile.id === 'pre-costing-bootstrap' && (matches('pre_costing_data','pre_costing_no','PRE_COSTING_NO') || matches('PO_form_data','po_no','PO NO'))) ||
          (profile.id === 'dispo' && matches('dispo_form_data','dispo_number','Dispo No.'))) {
        profileRecon.skippedRows += 1;
        return;
      }
    }
    if (profile.id === 'pre-costing-bootstrap'
      && cleanText(valueFromRow(fileInfo, row, 'PRE_COSTING_NO')) === null
      && ctx.preCostingNullPolicy?.action === 'leave_null_in_po_only') {
      profileRecon.skippedRows = (profileRecon.skippedRows || 0) + 1;
      ctx.log('info', 'pre_costing_null_authorized', 'Skipped source row without PRE_COSTING_NO under the hash-bound null policy.', {
        importer: profile.id,
        sourceRowNumber: ctx.currentSourceRowNumber,
        action: ctx.preCostingNullPolicy.action,
      });
      return;
    }
    ctx.currentSourceUid = cleanText(valueFromRow(fileInfo, row, '__MIG_SOURCE_UID'));
    if (ctx.sync) ctx.currentSourceUid = ctx.syncOperation.uid;
    ctx.currentSourceFile = profile.source_file;
    ctx.currentPlanOnlyDispo = profile.id === 'dispo' && cleanText(valueFromRow(fileInfo, row, '__MIG_OPERATIONAL_DISPO')) === 'plan-only';
    await recordPlaceholderPreCostingAudit(ctx, profile, fileInfo, row);
    await recordOptionalUnlinkedAudits(ctx, profile, fileInfo, row);
    await resolveLogicalUnitDispoBeforeMappings(ctx, profile, fileInfo, row);
    const rowsByTable = await buildTableRows(ctx, profile, fileInfo, row);
    const repeatedRows = await buildRepeatedRows(ctx, profile, fileInfo, row, rowsByTable);
    if (cleanText(ctx.currentCanonicalDispo) !== null) applyCanonicalDispo(rowsByTable, repeatedRows, ctx.currentCanonicalDispo);
    const idByTable = {};
    const planOnlyDispo = ctx.currentPlanOnlyDispo;
    const planOnlySkipTables = new Set(['dispo_form_data', 'warp_yarn_details', 'weft_yarn_details', 'warp_broken_section', 'warp_broken_pattern']);
    for (const tableSpec of profile.tables || []) {
      const table = tableSpec.name;
      if (planOnlyDispo && planOnlySkipTables.has(table)) {
        profileRecon.tables[table] ||= { attempted: 0, inserted: 0, updated: 0, previewed: 0, skipped: 0 };
        profileRecon.tables[table].skipped += 1;
        continue;
      }
      const parent = tableSpec.parent;
      profileRecon.tables[table] ||= { attempted: 0, inserted: 0, updated: 0, previewed: 0 };
      if (Object.prototype.hasOwnProperty.call(repeatedRows, table)) {
        const group = (profile.repeated_groups || []).find(g => g.target_table === table);
        const parentKeyValue = group?.parent_key_field ? sourceValueList(fileInfo, row, group.parent_key_source, 1) : null;
        if (ctx.pool && !ctx.dryRun && group?.parent_key_field && cleanText(parentKeyValue) !== null) await deleteChildrenOnce(ctx, table, { [group.parent_key_field]: transformForTarget(parentKeyValue, ctx.schema[table]?.[group.parent_key_field], group.parent_key_field, { dateOrder: ctx.dateOrder }) });
        for (const rr of repeatedRows[table]) {
          profileRecon.tables[table].attempted += 1;
          const res = await upsertRow(ctx, profile, table, rr);
          const statKey = res.action === 'inserted' ? 'inserted' : res.action === 'updated' ? 'updated' : 'previewed';
          profileRecon.tables[table][statKey] += 1;
          ctx.stat(profile.id, statKey, 1);
        }
        continue;
      }
      const data = rowsByTable[table];
      if (!data || !Object.keys(data).length) continue;
      if (parent) {
        const pid = idByTable[parent.parent_table] || null;
        if (!pid) throw new Error(`Parent id unavailable for ${table}: ${parent.parent_table}`);
        data[parent.parent_id_field] = pid;
        if (ctx.pool && !ctx.dryRun) await deleteChildrenOnce(ctx, table, { [parent.parent_id_field]: pid });
      }
      profileRecon.tables[table].attempted += 1;
      const res = await upsertRow(ctx, profile, table, nonEmptyObject(data));
      if (res.action === 'rejected') throw new Error(`Rejected ${table} due to missing natural key.`);
      if (res.id) idByTable[table] = res.id;
      const statKey = res.action === 'inserted' ? 'inserted' : res.action === 'updated' ? 'updated' : 'previewed';
      profileRecon.tables[table][statKey] += 1;
      ctx.stat(profile.id, statKey, 1);
    }
  };

  try {
    for await (const streamed of parser) {
      const record = streamed.values;
      logicalRecordNumber = streamed.logicalRowNumber;
      if (logicalRecordNumber <= headerRow) continue;
      if (logicalRecordNumber === headerRow + 1) {
        const rawHeaders = record.map(v => String(v || '').replace(/\u00a0/g, ' ').trim());
        const headers = dedupeStreamHeaders(rawHeaders);
        const normalizedMap = new Map();
        headers.forEach((header, index) => {
          const normalized = normalizeHeader(header);
          if (!normalizedMap.has(header)) normalizedMap.set(header, index);
          if (!normalizedMap.has(normalized)) normalizedMap.set(normalized, index);
        });
        fileInfo = { rawHeaders, headers, normalizedMap };
        profileRecon = { sourceFile: profile.source_file, sourceRows: expectedSourceRows, processedRows: 0, committedRows: 0, previewRows: 0, skippedRows: 0, rejectedRows: 0, rolledBackRows: 0, tables: {} };
        ctx.log('info', 'profile_started', `Starting importer profile ${profile.id}.`, {
          importer: profile.id,
          sourceFile: profile.source_file,
          sourcePath: csvPath,
          sourceRows: expectedSourceRows,
          headerCount: headers.length,
          streaming: true,
        });
        validateMappingSourceHeaders(ctx, profile, fileInfo);
        validateRepeatedSourceHeaders(ctx, profile, fileInfo);
        fatalForProfile = ctx.validationRows.some(v => v.level === 'error' && v.profile === profile.id);
        if (fatalForProfile && ctx.contract.validation_policy?.fail_on_missing_source) break;
        ctx.writeStatus({ status: 'running', importer: profile.id, processed: 0, total: expectedProcessRows, message: `Starting ${profile.id}` });
        continue;
      }
      if (!fileInfo) continue;
      if (!isNonEmptyRow(record)) continue;
      dataRowsSeen += 1;
      if (dataRowsSeen <= ctx.offset) continue;
      if (ctx.limit !== null && rangeRowsProcessed >= ctx.limit) break;
      rangeRowsProcessed += 1;
      ctx.stat(profile.id, 'processed', 1);
      profileRecon.processedRows += 1;
      if (ctx.sync && !ctx.sync.has(profile.id, logicalRecordNumber)) {
        profileRecon.skippedRows += 1;
        continue;
      }
      let conn = null;
      let rowOutcome = ctx.dryRun ? 'previewed' : 'committed';
      let rowError = null;
      const rowKeys = sourceRowKeyContext(fileInfo, record);
      ctx.currentSourceRowNumber = logicalRecordNumber;
      ctx.currentSourceDataset = profile.id === 'greige-delivery' ? 'delivery' : profile.id;
      try {
        if (ctx.pool && !ctx.dryRun) {
          conn = await ctx.pool.getConnection();
          ctx.conn = conn;
          await conn.beginTransaction();
        }
        if (!ctx.sync || await ctx.sync.begin(ctx, profile, fileInfo, record)) {
          await executeLogicalUnit(record);
          if (ctx.sync) await ctx.sync.finish(ctx, profile);
        }
        if (conn) await conn.commit();
        if (ctx.dryRun) profileRecon.previewRows += 1; else profileRecon.committedRows += 1;
      } catch (error) {
        rowOutcome = conn ? 'rolled_back' : 'rejected';
        rowError = error.message;
        if (conn) { try { await conn.rollback(); } catch (_rollbackError) {} }
        ctx.stat(profile.id, 'errors', 1);
        if (conn) { ctx.stat(profile.id, 'rolled_back', 1); profileRecon.rolledBackRows += 1; }
        profileRecon.rejectedRows += 1;
        ctx.reject({ profile: profile.id, rowNumber: logicalRecordNumber, reason: conn ? 'logical_unit_rolled_back' : 'row_exception', error: error.message });
        ctx.log('error', 'logical_unit_failed', `Importer ${profile.id} failed at source row ${logicalRecordNumber}.`, {
          importer: profile.id,
          rowNumber: logicalRecordNumber,
          transactionStarted: Boolean(conn),
          rolledBack: Boolean(conn),
          sourceKeys: rowKeys,
          error,
        });
      } finally {
        ctx.conn = null;
        ctx.currentSourceRowNumber = null;
        ctx.currentSourceDataset = null;
        ctx.currentSourceFile = null;
        ctx.currentSourceUid = null;
        ctx.currentPlanOnlyDispo = false;
        ctx.currentRawDispo = null;
        ctx.currentCanonicalDispo = null;
        if (conn) conn.release();
        resetRowScopedCaches(ctx);
      }
      const st = ctx.stats[profile.id] || {};
      ctx.writeRowProgress({ importer: profile.id, sourceRowNumber: logicalRecordNumber, profileRowNumber: rangeRowsProcessed, total: expectedProcessRows, outcome: rowOutcome, sourceKeys: rowKeys, error: rowError, inserted: st.inserted || 0, updated: st.updated || 0, rejected: st.rejected || 0, rolledBack: st.rolled_back || 0 });
      if ((rangeRowsProcessed - 1) % ctx.progressEvery === 0 || (expectedProcessRows !== null && rangeRowsProcessed === expectedProcessRows)) {
        ctx.writeStatus({ status: 'running', importer: profile.id, processed: rangeRowsProcessed, total: expectedProcessRows, sourceRowNumber: logicalRecordNumber, sourceKeys: rowKeys, lastOutcome: rowOutcome, inserted: st.inserted || 0, updated: st.updated || 0, rejected: st.rejected || 0, rolledBack: st.rolled_back || 0, message: `${profile.id}: ${rangeRowsProcessed}/${expectedProcessRows ?? '?'}` });
      }
    }
  } catch (error) {
    error.message = `Failed while streaming ${profile.source_file}: ${error.message}`;
    throw error;
  }

  if (!fileInfo) {
    ctx.addValidation({ level: 'error', code: 'SOURCE_HEADER_MISSING', profile: profile.id, source_file: profile.source_file, message: 'Source CSV does not contain the configured header row.' });
    return;
  }
  if (fatalForProfile && ctx.contract.validation_policy?.fail_on_missing_source) return;
  profileRecon.sourceRows = expectedSourceRows ?? dataRowsSeen;
  if (ctx.limit === null && expectedSourceRows !== null && dataRowsSeen !== expectedSourceRows) {
    ctx.addValidation({ level: 'error', code: 'SOURCE_ROW_COUNT_CHANGED_DURING_RUN', profile: profile.id, source_file: profile.source_file, expected: expectedSourceRows, actual: dataRowsSeen, message: 'Source row count changed after manifest approval or while the run was executing.' });
  }
  ctx.reconciliation[profile.id] = profileRecon;
  if (ctx.dryRunNaturalKeyRows?.size) ctx.dryRunNaturalKeyRows.clear();
  ctx.sourceIndex?.releaseAfterProfile?.(profile.id);
  ctx.log('info', 'profile_completed', `Completed importer profile ${profile.id}.`, {
    importer: profile.id,
    durationMs: Date.now() - profileStartedAt,
    reconciliation: profileRecon,
    stats: ctx.stats[profile.id] || {},
    streaming: true,
  });
}

async function runDynamicImport({ rootDir, args, logger = null, sync = null }) {
  const contractPath = path.resolve(args.contract || envVal('MAPPING_CONTRACT_FILE', path.join(rootDir, 'mappings', 'mapping-contract-v2.json')));
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const schemaPath = path.resolve(rootDir, contract.schema_file || 'schema/weavonpq_weaving.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ctx = new RuntimeContext({ rootDir, contract, schema, args, logger });
  ctx.sync = sync;
  let reportsWritten = false;
  try {
    const fkPath = path.resolve(rootDir, contract.foreign_keys_file || 'schema/weavonpq_weaving.foreign-keys.json');
    ctx.foreignKeys = fs.existsSync(fkPath) ? JSON.parse(fs.readFileSync(fkPath, 'utf8')) : [];
    ctx.log('info', 'contract_loaded', 'Mapping Contract v2 and schema loaded.', { contractPath, schemaPath, foreignKeysPath: fkPath, profileCount: contract.profiles.length, foreignKeyCount: ctx.foreignKeys.length });
    if (ctx.live && ctx.contract.validation_policy?.require_published_contract_hash_for_live && !ctx.contract.published_contract_sha256) {
      ctx.addValidation({ level: 'error', code: 'CONTRACT_NOT_PUBLISHED', scope: 'contract', message: 'Live import requires a VIS-published contract with published_contract_sha256.' });
    }
    validateContract(ctx);

    const wantedProfiles = args.only && args.only.length ? args.only : (contract.import_order || contract.profiles.map(p => p.id));
    ctx.selectedProfiles = [...wantedProfiles];
    const validUnits = new Set(['meter', 'meters', 'metre', 'metres', 'mtr', 'yard', 'yards', 'yds']);
    if (wantedProfiles.includes('folding') && !validUnits.has(envVal('FOLDING_SOURCE_UNIT', '').toLowerCase())) {
      ctx.addValidation({ level: 'error', code: 'FOLDING_SOURCE_UNIT_UNRESOLVED', scope: 'source', message: 'Set FOLDING_SOURCE_UNIT to meter/meters/metre/metres/mtr or yard/yards/yds after business-owner approval.' });
    }
    if (wantedProfiles.includes('greige-delivery') && !validUnits.has(envVal('DELIVERY_SOURCE_UNIT', '').toLowerCase())) {
      ctx.addValidation({ level: 'error', code: 'DELIVERY_SOURCE_UNIT_UNRESOLVED', scope: 'source', message: 'Set DELIVERY_SOURCE_UNIT to meter/meters/metre/metres/mtr or yard/yards/yds after business-owner approval.' });
    }

    const scopedDispoFilter = Boolean(args['scope-source-index'])
      ? collectChunkDispoFilter({ csvDir: ctx.csvDir, contract, selectedProfiles: wantedProfiles, offset: ctx.offset, limit: ctx.limit })
      : null;
    if (scopedDispoFilter) ctx.log('info', 'source_index_scope_enabled', 'Scoped immutable source indexes to Dispos present in this bounded chunk.', { dispoCount: scopedDispoFilter.size, offset: ctx.offset, limit: ctx.limit, profile: wantedProfiles[0] || null });
    ctx.sourceIndex = buildSourceIndex({
      csvDir: ctx.csvDir,
      dateOrder: ctx.dateOrder,
      foldingUnit: envVal('FOLDING_SOURCE_UNIT', ''),
      deliveryUnit: envVal('DELIVERY_SOURCE_UNIT', ''),
      logger: ctx.logger,
      lazy: true,
      dispoFilter: scopedDispoFilter,
    });
    ctx.dispoResolver = new DispoResolutionService(ctx);
    if (ctx.pool) await ctx.dispoResolver.load();

    const manifestPath = path.resolve(args.manifest || envVal('SOURCE_MANIFEST_FILE', path.join(rootDir, 'source-manifest.json')));
    ctx.sourceManifestPath = manifestPath;
    if (fs.existsSync(manifestPath)) {
      ctx.sourceManifestFileSha256 = sha256File(manifestPath);
      try {
        const manifestMeta = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        ctx.reviewedPendingManifestSha256 = manifestMeta.approval?.reviewed_pending_manifest_sha256 || null;
        ctx.sourceManifestEntries = new Map((manifestMeta.files || []).map((entry) => [entry.filename, entry]));
      } catch (_error) { /* validation reports malformed JSON below */ }
    }
    const requireManifest = ctx.live || envBool('REQUIRE_SOURCE_MANIFEST', false);
    const explicitSkipManifest = Boolean(args['skip-source-manifest-check']) || envBool('SKIP_SOURCE_MANIFEST_CHECK', false);
    const chunkWrapper = Boolean(args['chunk-wrapper']);
    const prevalidatedManifestSha256 = String(args['prevalidated-manifest-sha256'] || '').trim().toLowerCase();
    let chunkManifestPrevalidated = false;
    if (chunkWrapper && /^[a-f0-9]{64}$/.test(prevalidatedManifestSha256) && fs.existsSync(manifestPath)) {
      const actualManifestSha256 = sha256File(manifestPath);
      if (actualManifestSha256 === prevalidatedManifestSha256) {
        chunkManifestPrevalidated = true;
        ctx.addValidation({ level: 'info', code: 'SOURCE_MANIFEST_PREVALIDATED_CHUNK', scope: 'source', message: 'Bounded chunk accepted the wrapper-prevalidated approved manifest SHA-256.', manifest_sha256: actualManifestSha256 });
      } else {
        ctx.addValidation({ level: 'error', code: 'SOURCE_MANIFEST_PREVALIDATED_HASH_MISMATCH', scope: 'source', expected: prevalidatedManifestSha256, actual: actualManifestSha256, message: 'Bounded chunk manifest SHA-256 differs from the wrapper-prevalidated approved manifest.' });
      }
    }
    if (ctx.live && explicitSkipManifest && !chunkManifestPrevalidated) {
      ctx.addValidation({ level: 'error', code: 'LIVE_MANIFEST_SKIP_FORBIDDEN', scope: 'source', message: 'Live import cannot skip source-manifest validation outside the guarded bounded-chunk wrapper.' });
    }
    const skipManifest = chunkManifestPrevalidated || (!ctx.live && explicitSkipManifest);
    if (!skipManifest && (requireManifest || fs.existsSync(manifestPath))) {
      const manifestFindings = validateManifest({
        manifestPath,
        csvDir: ctx.csvDir,
        contract,
        schemaPath,
        requireApproved: ctx.live,
      });
      for (const finding of manifestFindings) ctx.addValidation(finding);
    } else if (!skipManifest && !fs.existsSync(manifestPath)) {
      ctx.addValidation({ level: 'warn', code: 'SOURCE_MANIFEST_NOT_RUN', scope: 'source', message: 'No source manifest found. Generate and approve it before any live migration.' });
    }

    // Certification is local filesystem validation and must fail before any
    // network/database work. This keeps an unapproved import blocked even if
    // the target endpoint is unavailable.
    if (hasFatalValidation(ctx) && (ctx.contract.validation_policy?.fail_on_missing_target || ctx.contract.validation_policy?.fail_on_fk_dependency)) {
      const error = new Error('Mapping Contract v2 validation failed. See validation.json and fk_dependency_report.json.');
      error.code = 'CONTRACT_VALIDATION_FAILED';
      throw error;
    }

    await connectIfPossible(ctx);
    if (ctx.sync) await ctx.sync.initialize(ctx);
    for (const finding of provenance.validateSupportSchema(ctx, ctx.provenancePolicy)) ctx.addValidation(finding);
    if (ctx.live && hasFatalValidation(ctx)) {
      const error = new Error('v3.2.3 support schema validation failed. Apply sql/v3_2_3/01_v323_support_schema.sql before live execution.');
      error.code = 'V323_SUPPORT_SCHEMA_FAILED';
      throw error;
    }

    // v3.2.3: every live invocation, including direct ad-hoc CLI use, must be
    // bound to a previously accepted full, unlimited, all-profile dry run.
    if (ctx.live) {
      const approvedDryRunId = String(args['approved-dry-run'] || envVal('APPROVED_DRY_RUN_ID', '')).trim();
      let productionGateFailed = false;
      if (!approvedDryRunId) {
        productionGateFailed = true;
        ctx.addValidation({ level: 'error', code: 'APPROVED_DRY_RUN_ID_MISSING', scope: 'production-gate', message: 'Live import requires --approved-dry-run=<runId> or APPROVED_DRY_RUN_ID.' });
      } else {
        const dryRunOutputRoot = path.resolve(envVal('CLI_CONTRACT_OUTPUT_ROOT', path.join(rootDir, 'output', 'mapping_contract_v2')));
        const prevalidatedAcceptanceSha256 = String(args['prevalidated-dry-run-acceptance-sha256'] || '').trim().toLowerCase();
        const dryRunEvidence = (chunkWrapper && /^[a-f0-9]{64}$/.test(prevalidatedAcceptanceSha256))
          ? verifyPrevalidatedDryRunAcceptance({
              runId: approvedDryRunId,
              outputRoot: dryRunOutputRoot,
              expectedSha256: prevalidatedAcceptanceSha256,
              contractHash: ctx.contractHash,
              manifestSha256: ctx.sourceManifestFileSha256,
            })
          : verifyFullDryRunEvidence({
              runId: approvedDryRunId,
              outputRoot: dryRunOutputRoot,
              contractPath,
              manifestPath,
              schemaPath,
              csvDir: ctx.csvDir,
              writeEvidence: false,
              syncPlanHash: ctx.sync?.hash || null,
            });
        productionGateFailed = !dryRunEvidence.ok;
        for (const finding of dryRunEvidence.errors || []) {
          ctx.addValidation({ level: 'error', code: `APPROVED_DRY_RUN_${finding.code}`, scope: 'production-gate', message: finding.message, details: finding });
        }
        if (chunkWrapper && dryRunEvidence.ok) ctx.addValidation({ level: 'info', code: 'APPROVED_DRY_RUN_PREVALIDATED_CHUNK', scope: 'production-gate', message: 'Bounded live chunk accepted wrapper-prevalidated full dry-run evidence.', acceptance_path: dryRunEvidence.acceptancePath || null });
        ctx.approvedDryRunId = approvedDryRunId;
      }
      if (productionGateFailed) {
        const error = new Error('Live import blocked: accepted full dry-run evidence is missing, stale, limited, incomplete, or failed.');
        error.code = 'APPROVED_DRY_RUN_EVIDENCE_FAILED';
        throw error;
      }
    }

    if (hasFatalValidation(ctx) && (ctx.contract.validation_policy?.fail_on_missing_target || ctx.contract.validation_policy?.fail_on_fk_dependency)) {
      const error = new Error('Mapping Contract v2 validation failed. See validation.json and fk_dependency_report.json.');
      error.code = 'CONTRACT_VALIDATION_FAILED';
      throw error;
    }
    const wanted = wantedProfiles;
    const byId = new Map(contract.profiles.map(p => [p.id, p]));
    for (const id of wanted) {
      const profile = byId.get(id);
      if (!profile) { ctx.addValidation({ level: 'error', code: 'REQUESTED_PROFILE_MISSING', profile: id, message: 'Requested profile not found.' }); continue; }
      await processProfile(ctx, profile);
    }
    const requiredLookupMisses = ctx.requiredLookupMissCount;
    const criticalLookupMisses = ctx.criticalLookupMissCount;
    const finalFailed = hasFatalValidation(ctx) || requiredLookupMisses > 0 || ctx.rejectedRowCount > 0;
    ctx.writeStatus({ status: finalFailed ? 'failed' : 'completed', importer: null, processed: Object.values(ctx.stats).reduce((a, stat) => a + (stat.processed || 0), 0), total: Object.values(ctx.reconciliation).reduce((a, row) => a + (row.processedRows || 0), 0), inserted: Object.values(ctx.stats).reduce((a, stat) => a + (stat.inserted || 0), 0), updated: Object.values(ctx.stats).reduce((a, stat) => a + (stat.updated || 0), 0), rejected: ctx.rejectedRowCount, rolledBack: Object.values(ctx.stats).reduce((a, stat) => a + (stat.rolled_back || 0), 0), message: finalFailed ? 'Import completed with blocking findings.' : 'Import completed successfully.' });
    writeReports(ctx, contractPath);
    reportsWritten = true;
    ctx.log(finalFailed ? 'error' : 'info', 'import_completed', finalFailed ? 'Import completed with blocking findings.' : 'Import completed successfully.', {
      finalFailed,
      stats: ctx.stats,
      rejectedRows: ctx.rejectedRowCount,
      requiredLookupMisses,
      criticalLookupMisses,
      validationErrors: ctx.validationRows.filter((row) => row.level === 'error').length,
      outputDir: ctx.outputDir,
    });
    if (finalFailed) {
      const error = new Error(ctx.live
        ? 'Live import completed with blocking findings. Review reports; rejected logical units were rolled back.'
        : 'Dry run completed with blocking findings. Review status.json, rejected_rows.csv, lookup_misses.csv, and validation.json before any live import.');
      error.code = ctx.live ? 'IMPORT_BLOCKING_FINDINGS' : 'DRY_RUN_BLOCKING_FINDINGS';
      throw error;
    }
    return ctx;
  } catch (error) {
    const expectedBlockingFailure = ['CONTRACT_VALIDATION_FAILED', 'IMPORT_BLOCKING_FINDINGS', 'DRY_RUN_BLOCKING_FINDINGS'].includes(error.code);
    ctx.log(expectedBlockingFailure ? 'error' : 'fatal', 'import_failed', error.message || 'Import runtime failed.', {
      error,
      status: ctx.status,
      stats: ctx.stats,
      rejectedRows: ctx.rejectedRowCount,
      lookupMisses: ctx.lookupMissCount,
    });
    if (ctx.status.status !== 'failed') {
      try { ctx.writeStatus({ status: 'failed', message: error.message || 'Import runtime failed.', fatalError: ctx.logger.serializeError(error) }); }
      catch (statusError) { ctx.log('error', 'status_write_failed', 'Failed to persist final failed status.', { error: statusError }); }
    }
    if (!reportsWritten) {
      try { writeReports(ctx, contractPath); reportsWritten = true; }
      catch (reportError) { ctx.log('error', 'report_write_failed', 'Failed to persist import reports after an error.', { error: reportError }); }
    }
    throw error;
  } finally {
    if (ctx.pool) {
      try { await ctx.pool.end(); ctx.log('debug', 'database_pool_closed', 'MySQL connection pool closed.'); }
      catch (error) { ctx.log('warn', 'database_pool_close_failed', 'MySQL connection pool did not close cleanly.', { error }); }
      ctx.pool = null;
    }
  }
}
function writeReports(ctx, contractPath) {
  ensureDir(ctx.outputDir);
  const selectedProfiles = [...(ctx.selectedProfiles || [])];
  const allContractProfiles = [...(ctx.allContractProfiles || [])];
  const reconciliationProfiles = Object.keys(ctx.reconciliation || {});
  const sameProfileSet = selectedProfiles.length === allContractProfiles.length
    && allContractProfiles.every((profileId) => selectedProfiles.includes(profileId));
  const reconciledAllProfiles = allContractProfiles.every((profileId) => reconciliationProfiles.includes(profileId));
  const summary = {
    runId: ctx.runId,
    status: ctx.status.status,
    generatedAt: new Date().toISOString(),
    mode: ctx.dryRun ? 'dry-run' : 'live',
    contractVersion: ctx.contract.contract_version,
    contractHash: ctx.contractHash,
    publishedContractHash: ctx.contract.published_contract_sha256 || null,
    contractPath,
    csvDir: ctx.csvDir,
    sourceManifestPath: ctx.sourceManifestPath,
    sourceManifestFileSha256: ctx.sourceManifestFileSha256,
    reviewedPendingManifestSha256: ctx.reviewedPendingManifestSha256,
    approvedDryRunId: ctx.approvedDryRunId || null,
    syncPlanHash: ctx.sync?.hash || null,
    requestedOnly: ctx.args.only || null,
    selectedProfiles,
    allContractProfiles,
    reconciliationProfiles,
    limit: ctx.limit,
    offset: ctx.offset,
    unlimited: ctx.limit === null && ctx.offset === 0,
    allProfilesSelected: sameProfileSet,
    allProfilesReconciled: reconciledAllProfiles,
    fullAllProfileDryRun: ctx.dryRun && sameProfileSet && reconciledAllProfiles && ctx.limit === null && ctx.offset === 0,
    dbBackedAllProfiles: Boolean(ctx.pool) && sameProfileSet && reconciledAllProfiles && ctx.validationRows.some(r => r.scope === 'db' && r.message === 'Connected to MySQL, passed database guard, and loaded live table columns.'),
    stats: ctx.stats,
    validationErrors: ctx.validationRows.filter(r => r.level === 'error').length,
    validationWarnings: ctx.validationRows.filter(r => r.level === 'warn').length,
    rejectedRows: ctx.rejectedRowCount,
    rejectedRowsDetailed: ctx.rejectedRows.length,
    rejectedRowsOmitted: ctx.rejectedRowsOmitted,
    lookupMisses: ctx.lookupMissCount,
    lookupMissesDetailed: ctx.lookupMisses.length,
    lookupMissesOmitted: ctx.lookupMissesOmitted,
    requiredLookupMisses: ctx.requiredLookupMissCount,
    criticalLookupMisses: ctx.criticalLookupMissCount,
    policyAuthorizedLookupMisses: ctx.policyAuthorizedLookupMissCount,
    previewRows: ctx.previewRowCount,
    previewRowsDetailed: ctx.previewRows.length,
    previewRowsOmitted: ctx.previewRowsOmitted,
    fkDependencyFailures: ctx.fkDependencyReport.filter(r => !r.ok).length,
    transactionScope: 'source-row/logical-unit + source-uid provenance',
    provenancePolicyVersion: ctx.provenancePolicy?.policy_version || null,
    outputDir: ctx.outputDir,
  };
  fs.writeFileSync(path.join(ctx.outputDir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ctx.outputDir, 'validation.json'), JSON.stringify(ctx.validationRows, null, 2));
  fs.writeFileSync(path.join(ctx.outputDir, 'rejected_rows.csv'), rowsToCsv(ctx.rejectedRows));
  fs.writeFileSync(path.join(ctx.outputDir, 'lookup_misses.csv'), rowsToCsv(ctx.lookupMisses));
  fs.writeFileSync(path.join(ctx.outputDir, 'row_preview.csv'), rowsToCsv(ctx.previewRows));
  fs.writeFileSync(path.join(ctx.outputDir, 'reconciliation.json'), JSON.stringify(ctx.reconciliation, null, 2));
  fs.writeFileSync(path.join(ctx.outputDir, 'fk_dependency_report.json'), JSON.stringify(ctx.fkDependencyReport, null, 2));
  fs.writeFileSync(path.join(ctx.outputDir, 'dispo_resolution_audit.csv'), rowsToCsv(ctx.dispoAuditRows || []));
  fs.writeFileSync(path.join(ctx.outputDir, 'README.md'), renderReportReadme(summary));
}
function renderReportReadme(summary) {
  return `# Mapping Contract v2 import report\n\n- Run ID: ${summary.runId}\n- Status: ${summary.status}\n- Mode: ${summary.mode}\n- Contract: ${summary.contractPath}\n- CSV dir: ${summary.csvDir}\n- Validation errors: ${summary.validationErrors}\n- Validation warnings: ${summary.validationWarnings}\n- Rejected rows: ${summary.rejectedRows}\n- Lookup misses: ${summary.lookupMisses}\n- Required lookup misses: ${summary.requiredLookupMisses}\n- Critical lookup misses: ${summary.criticalLookupMisses}\n- Policy-authorized historical/plan-only lookup gaps: ${summary.policyAuthorizedLookupMisses || 0}\n- FK dependency failures: ${summary.fkDependencyFailures}\n- Full unlimited all-profile dry run: ${summary.fullAllProfileDryRun}\n- Selected profiles: ${(summary.selectedProfiles || []).join(', ')}\n- Limit: ${summary.limit === null ? 'none' : summary.limit}; offset: ${summary.offset}\n\nFiles generated in this folder:\n\n- summary.json\n- validation.json\n- row_preview.csv\n- rejected_rows.csv\n- lookup_misses.csv\n- reconciliation.json\n- fk_dependency_report.json\n- dispo_resolution_audit.csv\n- status.json\n- events-YYYY-MM-DD.jsonl (structured run events)\n- events-YYYY-MM-DD.log (human-readable run events)\n- events-errors-YYYY-MM-DD.jsonl (errors only)\n`;
}

module.exports = {
  parseArgs, runDynamicImport, validateContract, readCsvFile, parseNumber, parseDate, transformForTarget,
  _test: { findOne, resolveLookup, evalExpression, buildTableRows, rawDispoFromSource, applyCanonicalDispo, sourceGetter, isDispoSourceColumn, mergeDuplicateData, upsertRow, upsertProvenanceParent, compileSafeExpression, isPolicyAuthorizedNullable, authorizedNullableReason, resetRowScopedCaches },
};
