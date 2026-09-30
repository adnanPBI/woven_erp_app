'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v31-dry-exit-'));
const emptyCsvDir = path.join(temp, 'csv');
const outputRoot = path.join(temp, 'output');
fs.mkdirSync(emptyCsvDir, { recursive: true });
fs.mkdirSync(outputRoot, { recursive: true });

const result = spawnSync(process.execPath, [
  path.join(root, 'import.js'),
  '--dry-run',
  '--contract=mappings/mapping-contract-v2.json',
  '--only=po',
], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    CSV_DIR: emptyCsvDir,
    CLI_CONTRACT_OUTPUT_ROOT: outputRoot,
    CONTRACT_OUTPUT_DIR: path.join(outputRoot, 'dry-run-test'),
    SKIP_SOURCE_MANIFEST_CHECK: 'true',
    REQUIRE_SOURCE_MANIFEST: 'false',
    REQUIRE_DB_FOR_DISPO_RESOLUTION: 'false',
    FOLDING_SOURCE_UNIT: 'meters',
    DELIVERY_SOURCE_UNIT: 'yards',
    DB_USER: '',
    DB_PASSWORD: '',
    QUIET_LOGS: 'true',
  },
});

assert.notStrictEqual(result.status, 0, `blocking dry run unexpectedly exited 0:\n${result.stdout}`);
assert.match(`${result.stdout}\n${result.stderr}`, /Dry run completed with blocking findings|Mapping Contract v2 validation failed|DRY_RUN_BLOCKING_FINDINGS/i);
const latest = path.join(outputRoot, 'dry-run-test');
assert.ok(fs.existsSync(latest), 'dry run did not create its output directory');
const summary = JSON.parse(fs.readFileSync(path.join(latest, 'summary.json'), 'utf8'));
assert.strictEqual(summary.status, 'failed');
assert.ok(summary.rejectedRows > 0 || summary.requiredLookupMisses > 0 || summary.validationErrors > 0);
assert.ok(Object.prototype.hasOwnProperty.call(summary, 'criticalLookupMisses'));
const combined = `${result.stdout}\n${result.stderr}\n${summary.status}\n${summary.validationErrors}`;
assert.ok(/Dry run completed with blocking findings|Mapping Contract v2 validation failed|DRY_RUN_BLOCKING_FINDINGS|failed/i.test(combined), 'dry-run failure did not produce terminal or structured failure evidence');

fs.rmSync(temp, { recursive: true, force: true });
console.log('dry_run_exit.test.js: PASS');
