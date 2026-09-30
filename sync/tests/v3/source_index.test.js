'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSourceIndex, METERS_TO_YARDS, convertQuantity } = require('../../lib/source_index');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v31-index-'));
function write(name, rows) { fs.writeFileSync(path.join(dir, name), rows.join('\n'), 'utf8'); }

write('Dispo create form.csv', [
  'PO No.,Dispo No.,Buyer,Production Construction,Fabric Composition,PO Quantity (Yds),Dispo Quantity (Yds),Required Warp Length (Meter)',
  'PO-1, D-1 ,Buyer One,20x20 / 60x60,100% Cotton,1000,900,1100',
]);
write('Warping database.csv', [
  'Warping Date,Dispo No,Warping Program No,Warp Length(Mtr),Set,Total Beam',
  '01/01/2026, D-1 ,P-1,100,2,4',
  '01/03/2026,d-1,P-1,120,3,5',
  '01/02/2026,D-1,P-2,90,1,2',
]);
write('Greige yarn receive.csv', [
  'Yarn Count,Yarn brand,Yarn Lot,Receipt Qty (Kgs)',
  '20/1, Brand A ,LOT-1,10',
  '30/1,Brand B, lot-1 ,5.5',
  '20/1,Brand A,LOT  2,7',
  '20/1,Brand A,LOT 2,11',
]);
write('Loom production database.csv', [
  'Weaving Dates,Dispo No,In house Production/Day,Out Side Production/Day',
  '01/01/2026,D-1,10,2',
  '01/03/2026,D-1,5,3',
]);
write('Folding production database.csv', [
  'Folding Production Date,Dispo No,A-Grade,B-Grade,C-Grade,Reject/C grade',
  '01/03/2026,D-1,10,0,0,0',
  '01/03/2026,D-1,20,0,0,0',
  '01/03/2026,D-1,30,0,0,0',
]);
write('Greige delivery database.csv', [
  'Delivery Date,Challan No,Dispo No,"Delivery Quantity""A""Grade","Delivery Quantity""B""Grade","Delivery Quantity""C""Grade",Delivery Quantity Reject',
  '01/04/2026,,D-1,10,0,0,0',
  '01/04/2026,,D-1,20,0,0,0',
  '01/04/2026,C-3,D-1,30,0,0,0',
]);

const index = buildSourceIndex({ csvDir: dir, dateOrder: 'mdy', foldingUnit: 'meters', deliveryUnit: 'yards' });

// Immutable Dispo master fallback supports strict dry-run against an empty target DB.
assert.strictEqual(index.dispoMaster(' d-1 ').dispoNumber, 'D-1');
assert.strictEqual(index.dispoValue('buyer_name', 'D-1'), 'Buyer One');
assert.strictEqual(index.dispoValue('po_no', 'd-1'), 'PO-1');
assert.strictEqual(index.dispoValue('warp_beam_length', 'D-1'), '1100');

// Deterministic sizing lookup.
assert.strictEqual(index.warpingValue('actual_warp_length_mtr', 'd-1', 'p-1', '2026-01-02'), 100);
assert.strictEqual(index.warpingValue('actual_warp_length_mtr', 'D-1', 'P-1', '2026-01-04'), 120);
assert.strictEqual(index.warpingValue('total_no_of_beam', 'D-1', 'P-2', '2026-01-04'), 2);

// ERP-compatible authoritative identity: yarn lot only, irrespective of count/brand variants.
assert.strictEqual(index.yarnReceiptSum(' lot-1 '), 15.5);
// ERP TRIM(yarn_lot) preserves internal whitespace, so these remain different lots.
assert.strictEqual(index.yarnReceiptSum('LOT  2'), 7);
assert.strictEqual(index.yarnReceiptSum('LOT 2'), 11);

assert.strictEqual(index.latestDate('loom', 'D-1', '2026-01-03'), '2026-01-03');
assert.strictEqual(index.cumulative('loom', 'D-1', '2026-01-03'), 20);

// Same-source folding checkpoint applies its own row cutoff.
assert.ok(Math.abs(index.cumulative('folding', 'D-1', '2026-01-03', '', 3, true) - (30 * METERS_TO_YARDS)) < 0.0001);
// Cross-source delivery->folding lookup MUST NOT compare delivery row numbers with folding row numbers.
assert.ok(Math.abs(index.cumulative('folding', 'D-1', '2026-01-03', '', 2, false) - (60 * METERS_TO_YARDS)) < 0.0001);

// Stable delivery ordering: date -> challan -> source row; blank challans use row cutoff.
assert.strictEqual(index.cumulative('delivery', 'D-1', '2026-01-04', '', 2, true), 10);
assert.strictEqual(index.cumulative('delivery', 'D-1', '2026-01-04', '', 3, true), 30);
assert.strictEqual(index.cumulative('delivery', 'D-1', '2026-01-04', 'C-3', 4, true), 60);

// Conversion recognizes singular British spelling too, while runtime gate accepts only meters/yards.
assert.ok(Math.abs(convertQuantity(1, 'metre', 'test') - METERS_TO_YARDS) < 0.0000001);

console.log('source_index.test.js: PASS');
