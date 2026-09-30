'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compareOrderedIdentifiers } = require('../../lib/source_index');

const root = path.resolve(__dirname, '../..');
const packageRoot = path.resolve(root, '..');
const visRoot = path.join(packageRoot, 'import_mapper_vis');

// Shared runtime/SQL ordering contract: blank, numeric whole values, then lowercase ASCII byte order.
const values = ['A-2', '11', '2', '', '10', '9', 'a-10', 'a-2'];
assert.deepStrictEqual(values.slice().sort(compareOrderedIdentifiers), ['', '2', '9', '10', '11', 'a-10', 'A-2', 'a-2']);
assert(compareOrderedIdentifiers('2', '10') < 0);
assert(compareOrderedIdentifiers('0002', '2') === 0);

for (const filename of [
  '05_post_import_formula_and_lookup_checks.sql',
  '08_final_gate_summary.sql',
  'RUN_ALL_POST_MIGRATION_VERIFICATION.sql',
]) {
  const sql = fs.readFileSync(path.join(root, 'sql/production_verification', filename), 'utf8');
  assert(sql.includes('v3.2.2 shared runtime/SQL challan order'), `${filename}: shared ordering marker missing`);
  assert(sql.includes("REGEXP '^[0-9]{1,65}$'"), `${filename}: numeric ordering branch missing`);
  assert(sql.includes('CAST(TRIM(g2.challan_no) AS DECIMAL(65,0))'), `${filename}: numeric comparison missing`);
}

// VIS is permanently dry-run/read-only.
const server = fs.readFileSync(path.join(visRoot, 'visual-map-server.js'), 'utf8');
assert(server.includes("const GOOGLE_SHEETS_WEBHOOK_ACTION = 'record-only';"));
assert(server.includes('VIS_WRITE_DISABLED: production writes are terminal-only in v3.2.2.'));
assert(!server.includes('runGoogleSheetSafeLivePipelineForMatch'));
assert(!server.includes("BACKUP_CONFIRMED: 'true'"));
assert(!server.includes('node --max-old-space-size=384 import.js --live'));
for (const forbiddenRoute of ['/api/sql/preview', '/api/sql/execute', '/api/sql/history', '/api/import/dispo-chunks', '/api/import/downstream-refresh']) assert(!server.includes(forbiddenRoute), `forbidden VIS route remains: ${forbiddenRoute}`);

const html = fs.readFileSync(path.join(visRoot, 'public/visual-mapper.html'), 'utf8');
for (const forbidden of ['value="live"', 'id="backupConfirmed"', 'id="runDispoChunksBtn"', 'id="runRefreshBtn"', 'id="sqlConsoleBtn"', 'id="sqlDialog"', 'id="sqlExecuteTab"', 'id="sqlExecutePane"', 'webhook_safe_live']) {
  assert(!html.includes(forbidden), `VIS control remains: ${forbidden}`);
}


const runtimeSource = fs.readFileSync(path.join(root, 'lib/mapping_contract_runtime.js'), 'utf8');
assert(runtimeSource.includes("error.code = 'APPROVED_DRY_RUN_EVIDENCE_FAILED'"));
assert(runtimeSource.includes("args['approved-dry-run']"));
assert(runtimeSource.includes('verifyFullDryRunEvidence'));

// Embedded preparation script must be static and cPanel-compatible.
const patchSql = fs.readFileSync(path.join(root, 'sql/production_verification/00A_apply_required_v3_audit_schema_patch.sql'), 'utf8');
assert(!/\bPREPARE\b/i.test(patchSql));
assert(!/\bEXECUTE\b/i.test(patchSql));
assert(patchSql.includes('ADD COLUMN IF NOT EXISTS `approved_by`'));

console.log('sanitized_v322.test.js: PASS');
