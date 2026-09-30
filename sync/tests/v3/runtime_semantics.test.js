'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../../lib/mapping_contract_runtime');
const provenance = require('../../lib/provenance');

(async () => {
  const csvPath = path.join(os.tmpdir(), `runtime-v323-${process.pid}.csv`);
  fs.writeFileSync(csvPath, 'Dispo No,Buyer,Warping Program No,Sizing Date,Yarn Lot\n old-d ,,,01/02/2026,L-EMPTY\n');
  const fileInfo = runtime.readCsvFile(csvPath, 0);
  const row = fileInfo.rows[0];
  const queries = [];
  const misses = [];
  const ctx = {
    pool: { query: async (sql, params) => { queries.push({ sql, params }); return [[{ buyer_name: 'Canonical Buyer' }]]; } },
    conn: null,
    cache: { lookups: new Map(), expressions: new Map() },
    currentCanonicalDispo: 'D-100',
    currentSourceRowNumber: 2,
    currentSourceUid: 'a'.repeat(64),
    currentSourceFile: csvPath,
    dateOrder: 'dmy',
    sourceIndex: { dispoValue: () => null, warpingValue: () => null, yarnReceiptSum: () => null },
    lookupMiss: (rowValue) => misses.push(rowValue),
    reject: () => {},
  };
  const lookupMapping = {
    table: 'sizing_form', field: 'buyer', required: false, business_critical: true,
    fallbacks: [{ lookup: { table: 'dispo_form_data', key_field: 'dispo_number', source_column: 'Dispo No', result_field: 'buyer_name' } }],
  };
  const buyer = await runtime._test.resolveLookup(ctx, { id: 'sizing', source_file: 'sizing.csv' }, fileInfo, row, lookupMapping, { sizing_form: {} }, 'sizing_form');
  assert.strictEqual(buyer, 'Canonical Buyer');
  assert.match(queries[0].sql, /LOWER\(TRIM\(`dispo_number`\)\) = \?/);
  assert.deepStrictEqual(queries[0].params, ['d-100']);

  // An early fallback miss must not be recorded when a later fallback succeeds.
  queries.length = 0;
  misses.length = 0;
  ctx.cache.lookups.clear();
  let queryNo = 0;
  ctx.pool.query = async (sql, params) => {
    queries.push({ sql, params });
    queryNo += 1;
    return queryNo === 1 ? [[]] : [[{ buyer_name: 'Second Fallback Buyer' }]];
  };
  const chainMapping = {
    table: 'sizing_form', field: 'buyer', required: false, business_critical: true,
    fallbacks: [
      { lookup: { table: 'dispo_plan_form', key_field: 'dispo_no', source_column: 'Dispo No', result_field: 'buyer' } },
      { lookup: { table: 'dispo_form_data', key_field: 'dispo_number', source_column: 'Dispo No', result_field: 'buyer_name' } },
    ],
  };
  const chainBuyer = await runtime._test.resolveLookup(ctx, { id: 'sizing', source_file: 'sizing.csv' }, fileInfo, row, chainMapping, { sizing_form: {} }, 'sizing_form');
  assert.strictEqual(chainBuyer, 'Second Fallback Buyer');
  assert.strictEqual(misses.length, 0);

  // Immutable certified Dispo source index is preferred during empty-database dry-run.
  queries.length = 0;
  ctx.cache.lookups.clear();
  ctx.pool.query = async (sql, params) => { queries.push({ sql, params }); return [[{ buyer_name: 'DB Buyer' }]]; };
  ctx.sourceIndex.dispoValue = (field, key) => field === 'buyer_name' && key === 'D-100' ? 'Source Master Buyer' : null;
  const sourceBuyer = await runtime._test.resolveLookup(ctx, { id: 'sizing', source_file: 'sizing.csv' }, fileInfo, row, lookupMapping, { sizing_form: {} }, 'sizing_form');
  assert.strictEqual(sourceBuyer, 'Source Master Buyer');
  assert.strictEqual(queries.length, 0);

  // Optional sizing enrichment may miss without becoming a blocking dependency.
  misses.length = 0;
  const formulaMapping = { table: 'sizing_form', field: 'warping_date', required: false, business_critical: false };
  const value = await runtime._test.evalExpression(
    ctx,
    { id: 'sizing', source_file: 'sizing database.csv' },
    fileInfo,
    row,
    'sourceWarpingValue("warping_date", source("Dispo No"), source("Warping Program No"), source("Sizing Date"))',
    { sizing_form: {} },
    'sizing_form',
    formulaMapping,
  );
  assert.strictEqual(value, null);
  assert.strictEqual(misses.length, 1);
  assert.strictEqual(misses[0].required, false);
  assert.strictEqual(misses[0].lookup_type, 'source_index_formula');

  // A yarn lot with no receive rows is a deterministic zero sum, not a fabricated record or blocker.
  misses.length = 0;
  const receiptSum = await runtime._test.evalExpression(
    ctx,
    { id: 'yarn-issue', source_file: 'Greige yarn issue.csv' },
    fileInfo,
    row,
    'sourceYarnReceiptSum(source("Yarn Lot"))',
    { yarn_issue_form: {} },
    'yarn_issue_form',
    { table: 'yarn_issue_form', field: 'total_received_kg', required: true, business_critical: true },
  );
  assert.strictEqual(receiptSum, 0);
  assert.strictEqual(misses.length, 0);

  // v3.2.3 no longer merges event duplicates in the runtime. Each certified source UID
  // resolves to a distinct provenance parent, so repeated business keys cannot overwrite children.
  const duplicatePolicy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config/duplicate_aggregation_policy.v1.json'), 'utf8'));
  assert.strictEqual(Boolean(duplicatePolicy.profiles?.folding?.tables?.folding_production_form), false);
  const provenancePolicy = provenance.loadPolicy(path.resolve(__dirname, '../..'));
  const previews = [];
  const dryRunCtx = {
    dryRun: true,
    pool: null,
    provenancePolicy,
    duplicateAggregation: duplicatePolicy,
    dryRunNaturalKeyRows: new Map(),
    preview: (entry) => previews.push(entry),
    reject: () => {},
    currentSourceRowNumber: 2,
    currentSourceFile: 'Greige yarn issue.csv',
    currentSourceUid: '1'.repeat(64),
  };
  const profile = { id: 'yarn-issue', tables: [{ name: 'yarn_issue_form', natural_key: ['yarn_lot'] }] };
  const first = await runtime._test.upsertRow(dryRunCtx, profile, 'yarn_issue_form', { yarn_lot: 'LOT-1', issue_challan_no: null });
  dryRunCtx.currentSourceRowNumber = 3;
  dryRunCtx.currentSourceUid = '2'.repeat(64);
  const second = await runtime._test.upsertRow(dryRunCtx, profile, 'yarn_issue_form', { yarn_lot: 'LOT-1', issue_challan_no: null });
  assert.notStrictEqual(first.id, second.id);
  assert.strictEqual(previews.length, 2);
  assert.strictEqual(previews[0].source_uid, '1'.repeat(64));
  assert.strictEqual(previews[1].source_uid, '2'.repeat(64));

  fs.rmSync(csvPath, { force: true });
  console.log('runtime_semantics.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
