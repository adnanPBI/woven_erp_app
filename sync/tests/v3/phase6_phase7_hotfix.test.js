'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');

const phase6 = fs.readFileSync(path.join(root, 'scripts/validate_contract_v2.js'), 'utf8');
assert.ok(!phase6.includes('runDynamicImport'), 'Phase 6 must not execute a data dry run.');
assert.ok(phase6.includes('validateContract'), 'Phase 6 must run static contract semantics validation.');
assert.ok(phase6.includes('validateManifest'), 'Phase 6 must validate the approved source manifest.');
assert.ok(phase6.includes('validateNormalizationAttestation'), 'Phase 6 must bind normalization evidence.');

const runner = fs.readFileSync(path.join(root, 'scripts/v3/run_production_dry_run.sh'), 'utf8');
assert.ok(runner.includes('run_full_dry_run_segmented_v323.js'), 'Production dry run must use segmented per-profile execution.');

const segmented = fs.readFileSync(path.join(root, 'scripts/v3/run_full_dry_run_segmented_v323.js'), 'utf8');
for (const profile of ['pre-costing-bootstrap','po','dispo','yarn-receive','yarn-issue','warping','sizing','loom','folding','greige-delivery']) {
  assert.ok(segmented.includes(profile), `Segmented runner missing ${profile}.`);
}
assert.ok(segmented.includes('dbBackedAllProfiles'));
assert.ok(segmented.includes('not-db-backed'));
assert.ok(segmented.includes('--output-dir='));
assert.ok(segmented.includes('--only='));

const gate = fs.readFileSync(path.join(root, 'lib/dry_run_acceptance.js'), 'utf8');
assert.ok(gate.includes('DRY_RUN_NOT_DB_BACKED'));
assert.ok(gate.includes('SEGMENTED_DRY_RUN_INDEX_MISSING'));
assert.ok(gate.includes('SEGMENT_SUMMARY_HASH_MISMATCH'));

console.log('phase6_phase7_hotfix.test.js: PASS');
