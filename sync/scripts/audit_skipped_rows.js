#!/usr/bin/env node
'use strict';
const logger = require('../lib/bootstrap_logging');

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: false });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { parse } = require('csv-parse/sync');

const CSV_DIR = path.resolve(process.env.CSV_DIR || './csv_files');
const OUT_DIR = path.resolve(process.env.LOG_DIR || './output', 'skipped_rows_audit');
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'weavonpq_weaving',
  waitForConnections: true,
  connectionLimit: 5,
};

const FILES = {
  po: ['po database.csv', 'PO database.csv', 'PO Database.csv'],
  dispo: ['Dispo create form.csv', 'dispo create form.csv'],
  yarnIssue: ['Greige yarn issue.csv', 'greige yarn issue.csv'],
  warping: ['Warping database.csv', 'warping database.csv'],
  sizing: ['sizing database.csv', 'Sizing database.csv'],
  loom: ['Loom production database.csv', 'loom production database.csv'],
  folding: ['Folding production database.csv', 'folding production database.csv'],
  greigeDelivery: ['Greige delivery database.csv', 'greige delivery database.csv'],
};

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function clean(v) { return v == null ? '' : String(v).trim(); }
function norm(v) { return clean(v).toLowerCase().replace(/\s+/g, ' '); }
function safeFile(name) { return String(name).replace(/[^a-zA-Z0-9._-]/g, '_'); }
function escapeCsv(value) {
  if (value == null) return '';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows) {
  if (!rows.length) return '';
  const headerSet = new Set(['__importer', '__source_file', '__row_number', '__skip_reason']);
  rows.forEach(r => Object.keys(r).forEach(k => headerSet.add(k)));
  const headers = [...headerSet];
  return [headers.join(','), ...rows.map(r => headers.map(h => escapeCsv(r[h])).join(','))].join('\n');
}
function findFile(aliases) {
  if (!fs.existsSync(CSV_DIR)) return null;
  const files = fs.readdirSync(CSV_DIR);
  const lower = new Map(files.map(f => [f.toLowerCase(), f]));
  for (const a of aliases) {
    const exact = path.join(CSV_DIR, a);
    if (fs.existsSync(exact)) return exact;
    const ci = lower.get(a.toLowerCase());
    if (ci) return path.join(CSV_DIR, ci);
  }
  return null;
}
function readCsv(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const records = parse(raw, {
    columns: true,
    bom: true,
    skip_empty_lines: false,
    relax_column_count: true,
    relax_quotes: true,
  });
  return records;
}
function get(row, names) {
  const keys = Object.keys(row);
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return clean(row[name]);
    const found = keys.find(k => norm(k) === norm(name));
    if (found) return clean(row[found]);
  }
  return '';
}
function auditRow(importer, sourceFile, rowIndex, reason, row, extra = {}) {
  return {
    __importer: importer,
    __source_file: path.basename(sourceFile),
    __row_number: rowIndex + 2,
    __skip_reason: reason,
    ...extra,
    ...row,
  };
}
async function exists(pool, sql, params) {
  const [rows] = await pool.query(sql, params);
  return rows.length > 0;
}

async function auditPo(pool, out) {
  const file = findFile(FILES.po);
  if (!file) return { importer: 'po', file: null, skipped: 0, note: 'file not found' };
  const rows = readCsv(file);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const poNo = get(row, ['PO NO', 'PO No', 'po_no']);
    const preCostingNo = get(row, ['PRE_COSTING_NO', 'pre_costing_no']);
    const reasons = [];
    if (!poNo) reasons.push('Missing PO NO');
    if (!preCostingNo) reasons.push('Missing PRE_COSTING_NO');
    if (poNo && preCostingNo && pool) {
      const ok = await exists(pool, 'SELECT 1 FROM pre_costing_data WHERE pre_costing_no = ? LIMIT 1', [preCostingNo]);
      if (!ok) reasons.push('PRE_COSTING_NO not found in pre_costing_data; live import skips this PO row');
    }
    if (reasons.length) out.push(auditRow('po', file, i, reasons.join(' | '), row, { PO_NO_AUDIT: poNo, PRE_COSTING_NO_AUDIT: preCostingNo }));
  }
  return { importer: 'po', file, skipped: out.filter(r => r.__importer === 'po').length };
}

async function auditDispo(pool, out) {
  const file = findFile(FILES.dispo);
  if (!file) return { importer: 'dispo', file: null, skipped: 0, note: 'file not found' };
  const rows = readCsv(file);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dispoNo = get(row, ['Dispo No.', 'DISPO NUMBER', 'Dispo No', 'dispo_number']);
    const poNo = get(row, ['PO No.', 'PO No', 'PO NO', 'po_no']);
    const reasons = [];
    if (!dispoNo) reasons.push('Missing Dispo No');
    if (dispoNo && pool) {
      let ok = false;
      if (poNo) ok = await exists(pool, 'SELECT 1 FROM PO_form_data WHERE po_no = ? LIMIT 1', [poNo]);
      if (!ok) ok = await exists(pool, 'SELECT 1 FROM PO_form_data WHERE dispo_number = ? LIMIT 1', [dispoNo]);
      if (!ok) reasons.push('PO reference not found in PO_form_data by PO No or Dispo No; live import skips this dispo when placeholder PO is disabled');
    }
    if (reasons.length) out.push(auditRow('dispo', file, i, reasons.join(' | '), row, { DISPO_NO_AUDIT: dispoNo, PO_NO_AUDIT: poNo }));
  }
  return { importer: 'dispo', file, skipped: out.filter(r => r.__importer === 'dispo').length };
}

function auditMissingDispoOnly(importer, aliases, out, dispoHeaders = ['Dispo No', 'Dispo No.', 'DISPO NUMBER', 'dispo_number']) {
  const file = findFile(aliases);
  if (!file) return { importer, file: null, skipped: 0, note: 'file not found' };
  const rows = readCsv(file);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dispoNo = get(row, dispoHeaders);
    if (!dispoNo) out.push(auditRow(importer, file, i, 'Missing Dispo No', row, { DISPO_NO_AUDIT: dispoNo }));
  }
  return { importer, file, skipped: out.filter(r => r.__importer === importer).length };
}

function auditYarnIssue(out) {
  const file = findFile(FILES.yarnIssue);
  if (!file) return { importer: 'yarn-issue', file: null, skipped: 0, note: 'file not found' };
  const rows = readCsv(file);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const dispoNo = get(row, ['Dispo No', 'Dispo No.', 'DISPO NUMBER', 'dispo_number']);
    const yarnLot = get(row, ['Yarn Lot', 'yarn_lot']);
    if (!dispoNo && !yarnLot) {
      out.push(auditRow('yarn-issue', file, i, 'Missing both Dispo No and Yarn Lot', row, { DISPO_NO_AUDIT: dispoNo, YARN_LOT_AUDIT: yarnLot }));
    }
  }
  return { importer: 'yarn-issue', file, skipped: out.filter(r => r.__importer === 'yarn-issue').length };
}

async function main() {
  ensureDir(OUT_DIR);
  let pool = null;
  if (DB_CONFIG.user && DB_CONFIG.password) {
    pool = await mysql.createPool(DB_CONFIG);
  } else {
    console.warn('DB_USER/DB_PASSWORD not found. DB-reference skip checks will be incomplete.');
  }

  const skipped = [];
  const summary = [];
  summary.push(await auditPo(pool, skipped));
  summary.push(await auditDispo(pool, skipped));
  summary.push(auditYarnIssue(skipped));
  summary.push(auditMissingDispoOnly('warping', FILES.warping, skipped));
  summary.push(auditMissingDispoOnly('sizing', FILES.sizing, skipped));
  summary.push(auditMissingDispoOnly('loom', FILES.loom, skipped));
  summary.push(auditMissingDispoOnly('folding', FILES.folding, skipped));
  summary.push(auditMissingDispoOnly('greige-delivery', FILES.greigeDelivery, skipped));

  const byImporter = new Map();
  for (const row of skipped) {
    if (!byImporter.has(row.__importer)) byImporter.set(row.__importer, []);
    byImporter.get(row.__importer).push(row);
  }

  for (const [importer, rows] of byImporter.entries()) {
    fs.writeFileSync(path.join(OUT_DIR, `skipped_${safeFile(importer)}.csv`), toCsv(rows), 'utf8');
  }
  fs.writeFileSync(path.join(OUT_DIR, 'skipped_all.csv'), toCsv(skipped), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'skipped_summary.json'), JSON.stringify({ generatedAt: new Date().toISOString(), csvDir: CSV_DIR, outputDir: OUT_DIR, summary, totalSkipped: skipped.length }, null, 2), 'utf8');

  if (pool) await pool.end();
  console.log(JSON.stringify({ outputDir: OUT_DIR, totalSkipped: skipped.length, summary }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
