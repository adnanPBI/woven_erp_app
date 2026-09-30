'use strict';

const fs = require('fs');
const path = require('path');
const { forEachCsvObjectSync } = require('../../lib/csv_stream');

function parseArgs(argv) {
  const out = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, ...rest] = item.slice(2).split('=');
    out[key] = rest.length ? rest.join('=') : true;
  }
  return out;
}
function clean(value) { return String(value ?? '').replace(/\u00a0/g, ' ').trim(); }
function normalize(value, blank = '') {
  const text = clean(value);
  return text ? text.toLowerCase().replace(/\s+/g, ' ') : blank;
}
function normalizeLot(value, blank = '') {
  const text = clean(value);
  return text ? text.toLowerCase() : blank;
}
function firstValue(row, candidates) {
  for (const candidate of candidates) {
    if (Object.prototype.hasOwnProperty.call(row, candidate) && clean(row[candidate])) return clean(row[candidate]);
  }
  return '';
}

const args = parseArgs(process.argv.slice(2));
const input = path.resolve(args.input || path.join(process.cwd(), 'csv_files', 'Greige yarn receive.csv'));
const output = path.resolve(args.output || path.join(process.cwd(), 'output', 'v3-yarn-lot-identity-report.json'));
const detailLimit = Math.max(100, Number(args['detail-limit'] || process.env.SOURCE_REPORT_DETAIL_LIMIT || 1000));
if (!fs.existsSync(input)) {
  console.error(JSON.stringify({ ok: false, error: `CSV not found: ${input}` }, null, 2));
  process.exit(1);
}

const lots = new Map();
let rowsWithoutLot = 0;
let nonEmptyRows = 0;
forEachCsvObjectSync(input, (row, meta) => {
  if (!meta.nonEmpty) return true;
  nonEmptyRows += 1;
  const lot = normalizeLot(firstValue(row, ['Yarn Lot', 'YARN LOT', 'Lot']));
  if (!lot) { rowsWithoutLot += 1; return true; }
  if (!lots.has(lot)) lots.set(lot, { lot, rows: [], rowCount: 0, variants: new Map(), totalReceivedKg: 0 });
  const item = lots.get(lot);
  const count = normalize(firstValue(row, ['Yarn Count', 'YARN COUNT', 'Count']), '<blank>');
  const brand = normalize(firstValue(row, ['Yarn brand', 'Yarn Brand', 'Brand']), '<blank>');
  const variant = `${count}|${brand}`;
  item.rowCount += 1;
  if (item.rows.length < detailLimit) item.rows.push(meta.sourceRowNumber);
  item.variants.set(variant, (item.variants.get(variant) || 0) + 1);
  const qty = Number(clean(firstValue(row, ['Receipt Qty (Kgs)', 'Receipt Qty(Kgs)', 'Receipt Quantity']))?.replace(/,/g, ''));
  if (Number.isFinite(qty)) item.totalReceivedKg += qty;
  return true;
});

const multiVariantLots = [];
let multiVariantLotCount = 0;
for (const item of lots.values()) {
  if (item.variants.size <= 1) continue;
  multiVariantLotCount += 1;
  if (multiVariantLots.length >= detailLimit) continue;
  multiVariantLots.push({
    lot: item.lot,
    sourceRows: item.rows,
    sourceRowsTruncated: item.rowCount > item.rows.length,
    rowCount: item.rowCount,
    countBrandVariants: [...item.variants.entries()].map(([key, rowCount]) => ({ key, rowCount })),
    totalReceivedKg: Number(item.totalReceivedKg.toFixed(4)),
    interpretation: 'The deployed ERP server aggregates received stock by yarn_lot only. These count/brand variants are intentionally combined. Change both server.js and the importer together if the business identity is later changed.',
  });
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const report = {
  generatedAt: new Date().toISOString(),
  identityPolicy: 'TRIM(yarn_lot), case-insensitive under utf8mb4_unicode_ci; internal whitespace preserved (aligned with deployed ERP server.js computeTotalReceivedKg)',
  input,
  nonEmptyRows,
  rowsWithoutLot,
  uniqueLots: lots.size,
  lotsWithMultipleCountBrandVariants: multiVariantLotCount,
  multiVariantLotsTruncated: multiVariantLotCount > multiVariantLots.length,
  detailLimit,
  multiVariantLots,
  blocking: rowsWithoutLot > 0,
};
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: rowsWithoutLot === 0, output, nonEmptyRows, uniqueLots: lots.size, rowsWithoutLot, lotsWithMultipleCountBrandVariants: multiVariantLotCount }, null, 2));
if (rowsWithoutLot > 0) process.exitCode = 2;
