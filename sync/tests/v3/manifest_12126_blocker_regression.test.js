'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { profileRequiredHeaders, sha256File } = require('../../lib/source_manifest');

const root = path.resolve(__dirname, '../..');
const observedCpanelFailure = Object.freeze({
  total_blocking_findings: 12126,
  pre_costing_blockers: 566,
  normalization_attestation_sha256: null,
  cause: 'legacy certifier ignored activated .env and fell back to import_mapper_cli/csv_files',
});

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function valueFor(header, index) {
  if (header === '__MIG_SOURCE_UID') return crypto.createHash('sha256').update(`fixture-${index}`).digest('hex');
  if (/PRE_COSTING_NO/i.test(header)) return `MIGPC-${String(index).padStart(32, '0')}`;
  if (/PO NO|PO NUMBER/i.test(header)) return `PO-${index}`;
  if (/Dispo No|DISPO NUMBER|Received GD NO/i.test(header)) return `D/GD/26/${String(index).padStart(5, '0')}`;
  if (/date/i.test(header)) return '2026-08-12';
  if (/challan/i.test(header)) return `CH-${index}`;
  if (/quantity|qty|width|length|beam|rpm|count|ply|ends|reed|pick|production|weight|crimp|rate/i.test(header)) return '1';
  return `X${index}`;
}
function writeCsv(filePath, headers, index) {
  const row = headers.map((h) => valueFor(h, index));
  fs.writeFileSync(filePath, `${headers.map(csvCell).join(',')}\n${row.map(csvCell).join(',')}\n`, 'utf8');
}

(function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'v323-manifest-12126-'));
  try {
    const normRoot = path.join(temp, 'source_remediation_v323');
    const certifiedDir = path.join(normRoot, 'certified');
    const auditDir = path.join(normRoot, 'audit');
    fs.mkdirSync(certifiedDir, { recursive: true });
    fs.mkdirSync(auditDir, { recursive: true });

    const contractPath = path.join(root, 'mappings', 'mapping-contract-v2.json');
    const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
    const sourceFiles = [...new Set(contract.profiles.map((p) => p.source_file))];
    assert.strictEqual(sourceFiles.length, 9, 'production contract must resolve to nine source files');

    const certified = {};
    sourceFiles.forEach((filename, index) => {
      const profiles = contract.profiles.filter((p) => p.source_file === filename);
      const headers = [...new Set(profiles.flatMap((p) => profileRequiredHeaders(p)))];
      if (!headers.includes('__MIG_SOURCE_UID')) headers.push('__MIG_SOURCE_UID');
      if (filename === 'po database.csv') {
        if (!headers.includes('PRE_COSTING_NO')) headers.push('PRE_COSTING_NO');
        if (!headers.includes('PO NO')) headers.push('PO NO');
      }
      const filePath = path.join(certifiedDir, filename);
      writeCsv(filePath, headers, index + 1);
      certified[filename] = {
        sha256: sha256File(filePath),
        bytes: fs.statSync(filePath).size,
        nonempty_rows: 1,
      };
    });

    const normalizationPolicy = path.join(root, 'config', 'normalization_policy.v3.2.3.json');
    const attestationPath = path.join(auditDir, 'normalization-attestation.json');
    const attestation = {
      attestation_version: '3.2.3-hybrid-regression-fixture',
      status: 'PASS',
      generated_at: new Date().toISOString(),
      raw_source_dir: path.join(temp, 'raw-not-needed'),
      certified_source_dir: certifiedDir,
      normalization_policy_file: normalizationPolicy,
      normalization_policy_sha256: sha256File(normalizationPolicy),
      raw_files: {},
      certified_files: certified,
      artifacts: {},
      summary: {
        regression_signature_total_blockers: observedCpanelFailure.total_blocking_findings,
        regression_signature_pre_costing_blockers: observedCpanelFailure.pre_costing_blockers,
      },
      blocking_findings: 0,
    };
    fs.writeFileSync(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, 'utf8');

    const envPath = path.join(temp, '.env');
    fs.writeFileSync(envPath, [
      `CSV_DIR=${certifiedDir}`,
      `NORMALIZATION_ATTESTATION_FILE=${attestationPath}`,
      'CSV_DATE_ORDER=dmy',
      'ALLOW_PRODUCTION_DB=false',
      'BACKUP_CONFIRMED=false',
      'PRODUCTION_APPROVAL_TOKEN=',
      'APPROVED_DRY_RUN_ID=',
      '',
    ].join('\n'), 'utf8');

    const outputPath = path.join(temp, 'source-manifest.pending.json');
    const reportPath = path.join(temp, 'pre_costing.json');
    const childEnv = { ...process.env };
    delete childEnv.CSV_DIR;
    delete childEnv.NORMALIZATION_ATTESTATION_FILE;
    delete childEnv.CSV_DATE_ORDER;
    delete childEnv.PRODUCTION_APPROVAL_TOKEN;
    delete childEnv.APPROVED_DRY_RUN_ID;

    const run = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'v3', 'certify_sources_v323.js'),
      `--env=${envPath}`,
      `--output=${outputPath}`,
      `--pre-costing-report=${reportPath}`,
    ], { cwd: root, env: childEnv, encoding: 'utf8' });

    assert.strictEqual(run.status, 0, `corrected certifier failed:\nSTDOUT=${run.stdout}\nSTDERR=${run.stderr}`);
    const result = JSON.parse(run.stdout);
    const manifest = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.strictEqual(result.ok, true);
    assert.strictEqual(manifest.csv_dir, certifiedDir, 'certifier must load activated CSV_DIR from .env instead of falling back to raw csv_files');
    assert.strictEqual(manifest.manifest_status, 'pending-review');
    assert.strictEqual(manifest.total_blocking_findings, 0);
    assert.strictEqual(manifest.pre_costing_no_completeness.status, 'PASS');
    assert.strictEqual(manifest.pre_costing_no_completeness.blocking_findings, 0);
    assert.strictEqual(manifest.files.length, 9);
    assert.strictEqual(manifest.normalization_status, 'PASS');
    assert.strictEqual(manifest.normalization_attestation_sha256, sha256File(attestationPath));
    assert.notStrictEqual(manifest.normalization_attestation_sha256, observedCpanelFailure.normalization_attestation_sha256);
    assert.notStrictEqual(manifest.total_blocking_findings, observedCpanelFailure.total_blocking_findings);

    // Complete the exact Phase-5 flow: approve the reviewed hash and validate the
    // approved manifest without relying on an exported CSV_DIR shell variable.
    const pendingHash = sha256File(outputPath);
    const approvedPath = path.join(temp, 'source-manifest.json');
    const approvalRecordPath = path.join(temp, 'source-manifest.approval.json');
    const approve = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'v3', 'approve_source_manifest.js'),
      `--pending=${outputPath}`,
      `--output=${approvedPath}`,
      `--approval-record=${approvalRecordPath}`,
      `--pending-hash=${pendingHash}`,
      '--reviewer=regression-fixture',
    ], { cwd: root, env: childEnv, encoding: 'utf8' });
    assert.strictEqual(approve.status, 0, `approval failed:\nSTDOUT=${approve.stdout}\nSTDERR=${approve.stderr}`);

    const validate = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'v3', 'validate_source_manifest.js'),
      '--approved',
      `--env=${envPath}`,
      `--manifest=${approvedPath}`,
    ], { cwd: root, env: childEnv, encoding: 'utf8' });
    assert.strictEqual(validate.status, 0, `approved validation failed:\nSTDOUT=${validate.stdout}\nSTDERR=${validate.stderr}`);
    const validated = JSON.parse(validate.stdout);
    assert.strictEqual(validated.ok, true);
    assert.strictEqual(validated.csvDir, certifiedDir);

    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    for (const scriptName of ['source:manifest', 'source:manifest:v323', 'source:manifest:low-memory']) {
      assert(pkg.scripts[scriptName]?.includes('certify_sources_v323.js'), `${scriptName} must route to normalization-aware certifier`);
    }

    console.log(JSON.stringify({
      ok: true,
      test: 'manifest_12126_blocker_regression',
      observedCpanelFailure,
      corrected: {
        manifest_status: manifest.manifest_status,
        total_blocking_findings: manifest.total_blocking_findings,
        pre_costing_status: manifest.pre_costing_no_completeness.status,
        file_count: manifest.files.length,
        normalization_status: manifest.normalization_status,
        normalization_attestation_bound: true,
        csv_dir_loaded_from_env: manifest.csv_dir === certifiedDir,
        approval_exit_zero: true,
        approved_validation_exit_zero: true,
      },
    }, null, 2));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
})();
