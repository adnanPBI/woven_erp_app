'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtime = require('../../lib/mapping_contract_runtime');
const { compileContract } = require('../../lib/contract_compiler');
const { convertQuantity, METERS_TO_YARDS, SourceIndex, compareOrderedIdentifiers } = require('../../lib/source_index');

(async () => {
  const root = path.resolve(__dirname, '../..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v32-consolidated-'));
  const csv = path.join(temp, 'canonical.csv');
  fs.writeFileSync(csv, 'Dispo No,Warping Program No,Sizing Date,Buyer\n old-d ,P-1,01/02/2026,\n', 'utf8');
  const fileInfo = runtime.readCsvFile(csv, 0);
  const row = fileInfo.rows[0];

  // Canonical/manual Dispo must replace recognized source columns before every formula.
  const source = runtime._test.sourceGetter(fileInfo, row, 'D-100');
  assert.strictEqual(source('Dispo No'), 'D-100');
  assert.strictEqual(source('Buyer'), '');
  assert.strictEqual(runtime._test.isDispoSourceColumn('Received GD NO'), true);

  let formulaDispo = null;
  const misses = [];
  const ctx = {
    currentCanonicalDispo: 'D-100',
    currentSourceRowNumber: 2,
    dateOrder: 'mdy',
    sourceIndex: {
      warpingValue(field, dispo) {
        formulaDispo = dispo;
        return field === 'warping_date' && dispo === 'D-100' ? '2026-01-01' : null;
      },
    },
    lookupMiss(value) { misses.push(value); },
    reject() {},
  };
  const formulaResult = await runtime._test.evalExpression(
    ctx,
    { id: 'sizing', source_file: 'sizing database.csv' },
    fileInfo,
    row,
    'sourceWarpingValue("warping_date", source("Dispo No"), source("Warping Program No"), source("Sizing Date"))',
    { sizing_form: {} },
    'sizing_form',
    { table: 'sizing_form', field: 'warping_date', required: true, business_critical: true },
  );
  assert.strictEqual(formulaDispo, 'D-100');
  assert.strictEqual(formulaResult, '2026-01-01');
  assert.strictEqual(misses.length, 0);

  // All supported aliases validate and convert consistently.
  for (const unit of ['meter', 'meters', 'metre', 'metres', 'mtr']) {
    assert.ok(Math.abs(convertQuantity(1, unit, 'test') - METERS_TO_YARDS) < 1e-8, unit);
  }
  for (const unit of ['yard', 'yards', 'yds']) assert.strictEqual(convertQuantity(1, unit, 'test'), 1, unit);

  // Numeric-aware same-date delivery ordering: 2 < 9 < 10 < 11.
  const index = new SourceIndex({ csvDir: temp, foldingUnit: 'yards', deliveryUnit: 'yards' });
  index.delivery.set('d-100', [
    { date: '2026-01-01', sequence: '2', rowNumber: 2, rawQuantity: 2 },
    { date: '2026-01-01', sequence: '9', rowNumber: 3, rawQuantity: 9 },
    { date: '2026-01-01', sequence: '10', rowNumber: 4, rawQuantity: 10 },
    { date: '2026-01-01', sequence: '11', rowNumber: 5, rawQuantity: 11 },
  ]);
  index.delivery.get('d-100').sort((a, b) => {
    const date = a.date.localeCompare(b.date);
    if (date) return date;
    return compareOrderedIdentifiers(a.sequence, b.sequence) || a.rowNumber - b.rowNumber;
  });
  assert.deepStrictEqual(index.delivery.get('d-100').map((item) => item.sequence), ['2', '9', '10', '11']);
  assert.strictEqual(index.cumulative('delivery', 'D-100', '2026-01-01', '10', 4, true), 21);

  // The compiler must publish every critical relationship as explicitly required.
  const outputPath = path.join(temp, 'contract.json');
  const result = compileContract({
    visualConfigPath: path.resolve(root, '../import_mapper_vis/visual-mapping.config.json'),
    templatePath: path.join(root, 'mappings/mapping-contract-v2.template.json'),
    schemaPath: path.join(root, 'schema/weavonpq_weaving.schema.json'),
    outputPath,
    backupDir: path.join(temp, 'backups'),
  });
  assert.strictEqual(result.report.errors.length, 0);
  const critical = result.contract.profiles.flatMap((profile) => profile.mappings)
    .filter((mapping) => mapping.business_critical || mapping.critical_lookup);
  assert.ok(critical.length >= 36);
  assert.ok(critical.every((mapping) => mapping.required === true && mapping.allow_null === false));

  fs.rmSync(temp, { recursive: true, force: true });
  console.log('consolidated_v321.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
