#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildManifest, sha256File, validateNormalizationAttestation } = require('../../lib/source_manifest');

function fail(message, extra = {}) {
  const error = new Error(message);
  Object.assign(error, extra);
  throw error;
}
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq >= 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[arg.slice(2)] = argv[++i];
    else out[arg.slice(2)] = true;
  }
  return out;
}
function decodeEnvValue(value) {
  let v = String(value ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}
function loadEnvNoOverride(filePath) {
  if (!fs.existsSync(filePath)) fail(`Environment file not found: ${filePath}`);
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = decodeEnvValue(match[2]);
  }
}
function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function publishedContractHash(contract) {
  const clone = JSON.parse(JSON.stringify(contract));
  delete clone.published_contract_sha256;
  delete clone.generated_at;
  delete clone.normalization_report;
  if (clone.published_from) {
    delete clone.published_from.visual_config;
    delete clone.published_from.template;
  }
  return sha256(JSON.stringify(clone));
}
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '../..');
  const envPath = path.resolve(options.env || path.join(root, '.env'));
  loadEnvNoOverride(envPath);

  const packagePath = path.join(root, 'package.json');
  const bindingsPath = path.join(root, 'config', 'release_bindings.v3.2.3.json');
  if (!fs.existsSync(bindingsPath)) fail(`Release bindings missing: ${bindingsPath}`);
  const pkg = readJson(packagePath);
  const bindings = readJson(bindingsPath);

  if (pkg.version !== bindings.cli_version) fail('CLI package version does not match release bindings.', { expected: bindings.cli_version, actual: pkg.version });
  if (pkg.release_patch_revision !== bindings.release_patch_revision) fail('CLI patch revision does not match release bindings.', { expected: bindings.release_patch_revision, actual: pkg.release_patch_revision });

  let normalizationRoot = options['normalization-root'] ? path.resolve(options['normalization-root']) : null;
  if (!normalizationRoot && process.env.NORMALIZATION_ATTESTATION_FILE) normalizationRoot = path.dirname(path.dirname(path.resolve(process.env.NORMALIZATION_ATTESTATION_FILE)));
  if (!normalizationRoot && process.env.CSV_DIR && path.basename(path.resolve(process.env.CSV_DIR)) === 'certified') normalizationRoot = path.dirname(path.resolve(process.env.CSV_DIR));
  if (!normalizationRoot) fail('Normalization root cannot be resolved. Activate certified sources first or pass --normalization-root=PATH.');

  const csvDir = path.resolve(options['csv-dir'] || process.env.CSV_DIR || path.join(normalizationRoot, 'certified'));
  const attestationPath = path.resolve(options['normalization-attestation'] || process.env.NORMALIZATION_ATTESTATION_FILE || path.join(normalizationRoot, 'audit', 'normalization-attestation.json'));
  const expectedCertifiedDir = path.resolve(normalizationRoot, 'certified');
  if (csvDir !== expectedCertifiedDir) fail('CSV_DIR must be the certified directory inside the selected normalization root.', { expected: expectedCertifiedDir, actual: csvDir });
  process.env.NORMALIZATION_ATTESTATION_FILE = attestationPath;

  const contractPath = path.resolve(options.contract || path.join(root, 'mappings', 'mapping-contract-v2.json'));
  const schemaPath = path.resolve(options.schema || path.join(root, 'schema', 'weavonpq_weaving.schema.json'));
  const outputPath = path.resolve(options.output || path.join(root, 'source-manifest.pending.json'));
  const reportJsonPath = path.resolve(options['pre-costing-report'] || path.join(root, 'output', 'pre_costing_no_completeness_report.json'));
  const reportCsvPath = reportJsonPath.replace(/\.json$/i, '.csv');

  for (const [label, filePath] of [['contract', contractPath], ['schema', schemaPath], ['attestation', attestationPath]]) {
    if (!fs.existsSync(filePath)) fail(`${label} file not found: ${filePath}`);
  }

  const contract = readJson(contractPath);
  const actualContractFileSha = sha256File(contractPath);
  const actualPublishedHash = publishedContractHash(contract);
  if (actualContractFileSha !== bindings.contract_file_sha256) fail('Serialized contract file SHA-256 differs from release binding.', { expected: bindings.contract_file_sha256, actual: actualContractFileSha });
  if (contract.published_contract_sha256 !== bindings.contract_published_sha256) fail('Published contract SHA-256 differs from release binding.', { expected: bindings.contract_published_sha256, actual: contract.published_contract_sha256 });
  if (actualPublishedHash !== contract.published_contract_sha256) fail('Published contract hash is internally inconsistent.', { expected: contract.published_contract_sha256, actual: actualPublishedHash });

  const normalizationPolicyPath = path.join(root, 'config', 'normalization_policy.v3.2.3.json');
  const provenancePolicyPath = path.join(root, 'config', 'provenance_policy.v3.2.3.json');
  if (sha256File(normalizationPolicyPath) !== bindings.normalization_policy_sha256) fail('Normalization policy SHA-256 differs from release binding.');
  if (sha256File(provenancePolicyPath) !== bindings.provenance_policy_sha256) fail('Provenance policy SHA-256 differs from release binding.');

  const normalization = validateNormalizationAttestation(csvDir);
  const normalizationErrors = normalization.findings.filter((finding) => finding.level === 'error');
  if (normalizationErrors.length) fail('Normalization attestation validation failed.', { findings: normalizationErrors });
  if (path.resolve(normalization.attestationPath) !== attestationPath) fail('Resolved normalization attestation path differs from the selected attestation.', { expected: attestationPath, actual: normalization.attestationPath });
  if (Object.keys(normalization.attestation?.certified_files || {}).length !== 9) fail('Normalization attestation must bind exactly nine certified source files.');

  const manifest = buildManifest({ contractPath, csvDir, schemaPath });
  const expectedAttestationSha = sha256File(attestationPath);
  const hardChecks = [
    ['manifest_status', manifest.manifest_status === 'pending-review', manifest.manifest_status],
    ['total_blocking_findings', Number(manifest.total_blocking_findings || 0) === 0, manifest.total_blocking_findings],
    ['pre_costing_status', manifest.pre_costing_no_completeness?.status === 'PASS', manifest.pre_costing_no_completeness?.status],
    ['pre_costing_blockers', Number(manifest.pre_costing_no_completeness?.blocking_findings || 0) === 0, manifest.pre_costing_no_completeness?.blocking_findings],
    ['file_count', Array.isArray(manifest.files) && manifest.files.length === 9, manifest.files?.length],
    ['normalization_status', manifest.normalization_status === 'PASS', manifest.normalization_status],
    ['normalization_attestation_sha256', manifest.normalization_attestation_sha256 === expectedAttestationSha, manifest.normalization_attestation_sha256],
    ['contract_file_sha256', manifest.contract_file_sha256 === bindings.contract_file_sha256, manifest.contract_file_sha256],
    ['contract_published_sha256', manifest.contract_sha256 === bindings.contract_published_sha256, manifest.contract_sha256],
    ['normalization_policy_sha256', manifest.normalization_policy_sha256 === bindings.normalization_policy_sha256, manifest.normalization_policy_sha256],
    ['provenance_policy_sha256', manifest.provenance_policy_sha256 === bindings.provenance_policy_sha256, manifest.provenance_policy_sha256],
  ];
  const failedHardChecks = hardChecks.filter(([, ok]) => !ok).map(([id, , actual]) => ({ id, actual }));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportJsonPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(reportJsonPath, `${JSON.stringify(manifest.pre_costing_no_completeness || {}, null, 2)}\n`, 'utf8');
  const report = manifest.pre_costing_no_completeness || {};
  const rows = [
    ['metric', 'value'], ['status', report.status || 'FAIL'], ['total_nonempty_rows', report.total_nonempty_rows ?? 0],
    ['rows_with_pre_costing_no', report.rows_with_pre_costing_no ?? 0], ['rows_missing_pre_costing_no', report.rows_missing_pre_costing_no ?? 0],
    ['unique_pre_costing_numbers', report.unique_pre_costing_numbers ?? 0], ['duplicate_pre_costing_group_count', report.duplicate_pre_costing_group_count ?? 0],
    ['rows_missing_po_no', report.rows_missing_po_no ?? 0], ['blocking_findings', report.blocking_findings ?? 1],
  ];
  fs.writeFileSync(reportCsvPath, `${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`, 'utf8');

  const pendingSha256 = sha256File(outputPath);
  const ok = failedHardChecks.length === 0;
  console.log(JSON.stringify({
    ok,
    certifierVersion: '3.2.3-hybrid-manifest-certifier-20260812b',
    releasePatchRevision: bindings.release_patch_revision,
    manifestStatus: manifest.manifest_status,
    outputPath,
    pendingManifestSha256: pendingSha256,
    preCostingReportJson: reportJsonPath,
    preCostingReportCsv: reportCsvPath,
    preCostingStatus: report.status || 'FAIL',
    preCostingBlockingFindings: report.blocking_findings ?? null,
    totalBlockingFindings: manifest.total_blocking_findings,
    files: manifest.files.length,
    normalizationStatus: manifest.normalization_status,
    normalizationRoot,
    normalizationAttestationSha256: manifest.normalization_attestation_sha256,
    normalizationPolicySha256: manifest.normalization_policy_sha256,
    provenancePolicySha256: manifest.provenance_policy_sha256,
    contractFileSha256: manifest.contract_file_sha256,
    contractPublishedSha256: manifest.contract_sha256,
    failedHardChecks,
    nextCommand: ok ? `npm run source:manifest:approve -- --pending-hash=${pendingSha256} --reviewer=YOUR_NAME` : null,
  }, null, 2));
  if (!ok) process.exitCode = 1;
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, findings: error.findings || null, expected: error.expected || null, actual: error.actual || null, stack: error.stack }, null, 2));
  process.exit(1);
}
