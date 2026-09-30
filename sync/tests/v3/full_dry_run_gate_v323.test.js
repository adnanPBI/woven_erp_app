'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { inspectCsv, sha256File } = require('../../lib/source_manifest');

const root = path.resolve(__dirname, '../..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v323-dry-gate-'));
const csvDir = path.join(dir, 'certified');
const auditDir = path.join(dir, 'audit');
const outputRoot = path.join(dir, 'output');
const runId = 'full-gate-v323-test';
const runDir = path.join(outputRoot, runId);
fs.mkdirSync(csvDir, { recursive: true });
fs.mkdirSync(auditDir, { recursive: true });
fs.mkdirSync(runDir, { recursive: true });

const files = [
  { id: 'pre-costing-bootstrap', name: 'po database.csv', content: 'PRE_COSTING_NO,PO NO,__MIG_SOURCE_UID\nPC-1,PO-1,' + 'a'.repeat(64) + '\n' },
  { id: 'dispo', name: 'Dispo create form.csv', content: 'Dispo No.,__MIG_SOURCE_UID\nD-1,' + 'b'.repeat(64) + '\n' },
];
for (const item of files) fs.writeFileSync(path.join(csvDir, item.name), item.content, 'utf8');

const contract = {
  contract_version: 'fixture-v323',
  published_contract_sha256: 'c'.repeat(64),
  import_order: files.map((item) => item.id),
  profiles: files.map((item) => ({ id: item.id, source_file: item.name, mappings: [] })),
};
const contractPath = path.join(dir, 'contract.json');
fs.writeFileSync(contractPath, JSON.stringify(contract));
const schemaPath = path.join(dir, 'schema.json');
fs.writeFileSync(schemaPath, JSON.stringify({}));

const policyPath = path.join(root, 'config', 'normalization_policy.v3.2.3.json');
const provenancePolicyPath = path.join(root, 'config', 'provenance_policy.v3.2.3.json');
const attestationPath = path.join(auditDir, 'normalization-attestation.json');
const attestation = {
  status: 'PASS',
  blocking_findings: 0,
  certified_source_dir: csvDir,
  normalization_policy_sha256: sha256File(policyPath),
  certified_files: Object.fromEntries(files.map((item) => [item.name, { sha256: sha256File(path.join(csvDir, item.name)) }])),
  artifacts: {},
  summary: { test_fixture: true },
};
fs.writeFileSync(attestationPath, JSON.stringify(attestation, null, 2));

const pending = {
  manifest_version: '3.2.3-hybrid-normalization-bound-2',
  manifest_status: 'pending-review',
  total_blocking_findings: 0,
  csv_dir: csvDir,
  contract_file: contractPath,
  contract_file_sha256: sha256File(contractPath),
  contract_sha256: contract.published_contract_sha256,
  schema_file: schemaPath,
  schema_sha256: sha256File(schemaPath),
  normalization_status: 'PASS',
  normalization_attestation_status: 'PASS',
  normalization_attestation_sha256: sha256File(attestationPath),
  normalization_policy_sha256: sha256File(policyPath),
  provenance_policy_sha256: sha256File(provenancePolicyPath),
  pre_costing_no_completeness: { status: 'PASS', blocking_findings: 0 },
  files: files.map((item) => ({
    filename: item.name,
    ...inspectCsv(path.join(csvDir, item.name)),
    required_headers: [],
    blocking_findings: 0,
    certification_status: 'pending-review',
  })),
};
const pendingPath = path.join(dir, 'source-manifest.pending.json');
fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
const approved = JSON.parse(JSON.stringify(pending));
approved.manifest_status = 'approved';
approved.files.forEach((entry) => { entry.certification_status = 'approved'; });
approved.approval = {
  status: 'approved',
  pending_manifest_file: path.basename(pendingPath),
  reviewed_pending_manifest_sha256: sha256File(pendingPath),
  reviewer: 'fixture',
};
const manifestPath = path.join(dir, 'source-manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(approved, null, 2));

const reconciliation = Object.fromEntries(files.map((item) => [item.id, {
  profile: item.id, sourceRows: 1, processedRows: 1, rejectedRows: 0, rolledBackRows: 0,
}]));
const summary = {
  runId, status: 'completed', mode: 'dry-run', contractHash: contract.published_contract_sha256,
  requestedOnly: null, selectedProfiles: files.map((item) => item.id), reconciliationProfiles: files.map((item) => item.id),
  limit: null, offset: 0, unlimited: true, allProfilesSelected: true, allProfilesReconciled: true, fullAllProfileDryRun: true, dbBackedAllProfiles: true,
  validationErrors: 0, requiredLookupMisses: 0, criticalLookupMisses: 0, rejectedRows: 0, fkDependencyFailures: 0,
  sourceManifestFileSha256: sha256File(manifestPath),
};
function writeEvidence() {
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary));
  fs.writeFileSync(path.join(runDir, 'status.json'), JSON.stringify({ status: summary.status }));
  fs.writeFileSync(path.join(runDir, 'validation.json'), JSON.stringify([]));
  fs.writeFileSync(path.join(runDir, 'reconciliation.json'), JSON.stringify(reconciliation));
  fs.writeFileSync(path.join(runDir, 'fk_dependency_report.json'), JSON.stringify([{ ok: true }]));
}
writeEvidence();

const verifier = path.join(root, 'scripts/v3/verify_full_dry_run.js');
function invoke() {
  return spawnSync(process.execPath, [
    verifier,
    `--run-id=${runId}`,
    `--output-root=${outputRoot}`,
    `--contract=${contractPath}`,
    `--manifest=${manifestPath}`,
    `--schema=${schemaPath}`,
    `--csv-dir=${csvDir}`,
  ], {
    encoding: 'utf8',
    env: { ...process.env, NORMALIZATION_ATTESTATION_FILE: attestationPath, CSV_DATE_ORDER: 'dmy' },
  });
}

let result = invoke();
assert.strictEqual(result.status, 0, result.stderr || result.stdout);
let gate = JSON.parse(fs.readFileSync(path.join(runDir, 'full_dry_run_acceptance.json'), 'utf8'));
assert.strictEqual(gate.ok, true);

// Legacy single-process evidence must prove the guarded DB connection itself.
delete summary.dbBackedAllProfiles;
writeEvidence();
assert.notStrictEqual(invoke().status,0);
const dbProof = [{level:'info',scope:'db',database:'weavonpq_weaving_local',message:'Connected to MySQL, passed database guard, and loaded live table columns.'}];
fs.writeFileSync(path.join(runDir,'validation.json'),JSON.stringify(dbProof));
assert.strictEqual(invoke().status,0);
summary.dbBackedAllProfiles=false;
writeEvidence();
fs.writeFileSync(path.join(runDir,'validation.json'),JSON.stringify(dbProof));
assert.notStrictEqual(invoke().status,0);
delete summary.dbBackedAllProfiles;
summary.executionStrategy='segmented-per-profile-process';
writeEvidence();
fs.writeFileSync(path.join(runDir,'validation.json'),JSON.stringify(dbProof));
assert.notStrictEqual(invoke().status,0);
delete summary.executionStrategy;
summary.dbBackedAllProfiles=true;

// A non-completed run must never be accepted.
summary.status = 'failed';
writeEvidence();
result = invoke();
assert.notStrictEqual(result.status, 0);
gate = JSON.parse(fs.readFileSync(path.join(runDir, 'full_dry_run_acceptance.json'), 'utf8'));
assert(gate.errors.some((row) => row.code === 'RUN_NOT_COMPLETED'));

// Required lookup misses are a hard acceptance failure.
summary.status = 'completed';
summary.requiredLookupMisses = 1;
writeEvidence();
result = invoke();
assert.notStrictEqual(result.status, 0);
gate = JSON.parse(fs.readFileSync(path.join(runDir, 'full_dry_run_acceptance.json'), 'utf8'));
assert(gate.errors.some((row) => row.code === 'NONZERO_REQUIREDLOOKUPMISSES'));

// The exact approved manifest is hash-bound to the dry-run evidence.
summary.requiredLookupMisses = 0;
summary.sourceManifestFileSha256 = '0'.repeat(64);
writeEvidence();
result = invoke();
assert.notStrictEqual(result.status, 0);
gate = JSON.parse(fs.readFileSync(path.join(runDir, 'full_dry_run_acceptance.json'), 'utf8'));
assert(gate.errors.some((row) => row.code === 'DRY_RUN_MANIFEST_HASH_MISMATCH'));

fs.rmSync(dir, { recursive: true, force: true });
console.log('full_dry_run_gate_v323.test.js: PASS');
