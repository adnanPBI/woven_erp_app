'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { inspectCsv, sha256File } = require('../../lib/source_manifest');

const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v322-dry-gate-'));
const csvDir = path.join(dir, 'csv');
const outputRoot = path.join(dir, 'output');
const runId = 'full-gate-test';
const runDir = path.join(outputRoot, runId);
fs.mkdirSync(csvDir); fs.mkdirSync(runDir, { recursive: true });
const files = [
  { id: 'pre-costing-bootstrap', name: 'po database.csv', content: 'PRE_COSTING_NO,PO NO\nPC-1,PO-1\n' },
  { id: 'dispo', name: 'Dispo create form.csv', content: 'Dispo No\nD-1\n' },
];
for (const item of files) fs.writeFileSync(path.join(csvDir, item.name), item.content, 'utf8');
const contract = {
  contract_version: 'fixture',
  published_contract_sha256: 'b'.repeat(64),
  import_order: files.map((item) => item.id),
  profiles: files.map((item) => ({ id: item.id, source_file: item.name, mappings: [] })),
};
const contractPath = path.join(dir, 'contract.json');
fs.writeFileSync(contractPath, JSON.stringify(contract));
const schemaPath = path.join(dir, 'schema.json');
fs.writeFileSync(schemaPath, JSON.stringify({ tables: {} }));
const pending = {
  manifest_version: '3.2.2', manifest_status: 'pending-review', total_blocking_findings: 0,
  contract_sha256: contract.published_contract_sha256, schema_sha256: sha256File(schemaPath),
  pre_costing_no_completeness: { status: 'PASS', blocking_findings: 0 },
  files: files.map((item) => ({ filename: item.name, ...inspectCsv(path.join(csvDir, item.name)), required_headers: [], blocking_findings: 0, certification_status: 'pending-review' })),
};
const pendingPath = path.join(dir, 'source-manifest.pending.json');
fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
const approved = JSON.parse(JSON.stringify(pending));
approved.manifest_status = 'approved';
approved.files.forEach((entry) => { entry.certification_status = 'approved'; });
approved.approval = { status: 'approved', pending_manifest_file: path.basename(pendingPath), reviewed_pending_manifest_sha256: sha256File(pendingPath), reviewer: 'fixture' };
const manifestPath = path.join(dir, 'source-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(approved, null, 2));

const reconciliation = Object.fromEntries(files.map((item) => [item.id, { profile: item.id, sourceRows: 1, processedRows: 1, rejectedRows: 0, rolledBackRows: 0 }]));
const summary = {
  runId, status: 'completed', mode: 'dry-run', contractHash: contract.published_contract_sha256,
  requestedOnly: null, selectedProfiles: files.map((item) => item.id), reconciliationProfiles: files.map((item) => item.id),
  limit: null, offset: 0, unlimited: true, allProfilesSelected: true, allProfilesReconciled: true, fullAllProfileDryRun: true,
  validationErrors: 0, requiredLookupMisses: 0, criticalLookupMisses: 0, rejectedRows: 0, fkDependencyFailures: 0,
  sourceManifestFileSha256: sha256File(manifestPath),
};
fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary));
fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({ status: 'completed' }));
fs.writeFileSync(path.join(runDir, 'validation.json'), JSON.stringify([]));
fs.writeFileSync(path.join(runDir, 'reconciliation.json'), JSON.stringify(reconciliation));
fs.writeFileSync(path.join(runDir, 'fk_dependency_report.json'), JSON.stringify([{ ok: true }]));

const verifier = path.join(root, 'scripts/v3/verify_full_dry_run.js');
function invoke() {
  return spawnSync(process.execPath, [verifier, `--run-id=${runId}`, `--output-root=${outputRoot}`, `--contract=${contractPath}`, `--manifest=${manifestPath}`, `--schema=${schemaPath}`, `--csv-dir=${csvDir}`], { encoding: 'utf8' });
}
let result = invoke();
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
const accepted = JSON.parse(fs.readFileSync(path.join(runDir, 'full_dry_run_acceptance.json'), 'utf8'));
assert.strictEqual(accepted.ok, true);

summary.limit = 1; summary.unlimited = false; summary.fullAllProfileDryRun = false;
fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary));
result = invoke();
assert.notStrictEqual(result.status, 0);
const rejected = JSON.parse(fs.readFileSync(path.join(runDir, 'full_dry_run_acceptance.json'), 'utf8'));
assert(rejected.errors.some((row) => row.code === 'LIMIT_OR_OFFSET_USED'));

fs.rmSync(dir, { recursive: true, force: true });
console.log('full_dry_run_gate_v322.test.js: PASS');
