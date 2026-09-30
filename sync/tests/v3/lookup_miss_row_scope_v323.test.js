'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const runtime = require('../../lib/mapping_contract_runtime');

const reset = runtime._test?.resetRowScopedCaches;
assert.strictEqual(typeof reset, 'function', 'resetRowScopedCaches must be exported for regression testing');

const cache = { lookups: new Map([['one', 1], ['two', 2]]) };
const lookupMissKeys = new Set(['row-1/miss-a', 'row-1/miss-b', 'row-1/miss-c']);
reset({ cache, lookupMissKeys });
assert.strictEqual(cache.lookups.size, 0, 'per-row SQL lookup cache must be cleared');
assert.strictEqual(lookupMissKeys.size, 0, 'per-row lookup-miss dedupe set must be cleared');

// Prove that repeated use remains bounded rather than accumulating keys across
// the whole source file. Six unique misses per logical row is deliberately more
// than needed for the helper test; maximum retained cardinality must stay six.
let maxRetained = 0;
const ctx = { cache: { lookups: new Map() }, lookupMissKeys: new Set() };
for (let row = 1; row <= 100000; row += 1) {
  for (let miss = 1; miss <= 6; miss += 1) ctx.lookupMissKeys.add(`${row}|${miss}`);
  maxRetained = Math.max(maxRetained, ctx.lookupMissKeys.size);
  reset(ctx);
}
assert.strictEqual(maxRetained, 6, 'row-scoped dedupe must not grow with total row count');
assert.strictEqual(ctx.lookupMissKeys.size, 0);

// The production dedupe key itself includes the source-row identity. Therefore
// no cross-row dedupe semantics are lost by clearing the Set after each row.
const runtimeSource = fs.readFileSync(path.resolve(__dirname, '../../lib/mapping_contract_runtime.js'), 'utf8');
assert.match(runtimeSource, /this\.currentSourceRowNumber\s*\|\|\s*row\.source_row_number/);
assert.match(runtimeSource, /finally\s*\{[\s\S]*?resetRowScopedCaches\(ctx\);[\s\S]*?\}/);

console.log(JSON.stringify({
  ok: true,
  test: 'lookup_miss_row_scope_v323',
  simulatedRows: 100000,
  simulatedMissesPerRow: 6,
  maxRetainedLookupMissKeys: maxRetained,
  guarantee: 'lookup-miss dedupe is bounded to one completed logical source row rather than the full profile'
}, null, 2));
