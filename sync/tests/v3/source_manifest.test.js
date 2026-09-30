'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeLogicalKeys } = require('../../lib/source_manifest');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v31-manifest-'));
const delivery = path.join(dir, 'Greige delivery database.csv');
fs.writeFileSync(delivery, [
  'Delivery Date,Challan No,Dispo No',
  '01/01/2026,CH-1,D-1',
  '01/01/2026,CH-1,D-1',
  '01/01/2026,,D-1',
].join('\n'));
const [analysis] = analyzeLogicalKeys(delivery, ['greige-delivery'], 'mdy');
assert.strictEqual(analysis.duplicate_natural_keys.length, 1);
assert.deepStrictEqual(analysis.duplicate_natural_keys[0].source_rows, [2, 3]);
assert.strictEqual(analysis.missing_natural_key_rows.length, 1);
assert.strictEqual(analysis.missing_natural_key_rows[0].source_row, 4);
assert.strictEqual(analysis.blocking_findings, 2);

const receive = path.join(dir, 'Greige yarn receive.csv');
fs.writeFileSync(receive, [
  'Yarn Count,Yarn brand,Yarn Lot,Received Date,Received GD NO,Challan No,Special Notes,Search Column',
  '20/1,Brand,LOT-1,01/01/2026,,CH-1,Dispo No: D-100,',
].join('\n'));
const [receiveAnalysis] = analyzeLogicalKeys(receive, ['yarn-receive'], 'mdy');
assert.strictEqual(receiveAnalysis.missing_natural_key_rows.length, 0);
assert.strictEqual(receiveAnalysis.duplicate_natural_keys.length, 0);

fs.rmSync(dir, { recursive: true, force: true });
console.log('source_manifest.test.js: PASS');
