#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const n = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!n) break;
      h.update(buffer.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function countJsonl(file) {
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) return 0;
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let count = 0;
  let sawAny = false;
  let lastByte = null;
  try {
    while (true) {
      const n = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!n) break;
      sawAny = true;
      lastByte = buffer[n - 1];
      for (let i = 0; i < n; i += 1) if (buffer[i] === 10) count += 1;
    }
  } finally { fs.closeSync(fd); }
  if (sawAny && lastByte !== 10) count += 1;
  return count;
}
function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    out[key] = rest.length ? rest.join('=') : true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname, '../..');
const normalizationRoot = path.resolve(args['normalization-root'] || '/home/weavonpq/source_remediation_v323');
const auditDir = path.join(normalizationRoot, 'audit');
const certifiedDir = path.join(normalizationRoot, 'certified');
const manifestsDir = path.join(normalizationRoot, 'manifests');
const attestationPath = path.join(auditDir, 'normalization-attestation.json');
const summaryPath = path.join(auditDir, 'normalization_summary.json');
const policyPath = path.join(root, 'config', 'normalization_policy.v3.2.3.json');
const expectedFiles = [
  'Dispo create form.csv', 'Folding production database.csv', 'Greige delivery database.csv',
  'Greige yarn issue.csv', 'Greige yarn receive.csv', 'Loom production database.csv',
  'Warping database.csv', 'po database.csv', 'sizing database.csv',
].sort();

const errors = [];
if (!fs.existsSync(attestationPath)) errors.push(`Attestation missing: ${attestationPath}`);
if (!fs.existsSync(summaryPath)) errors.push(`Normalization summary missing: ${summaryPath}`);
if (!fs.existsSync(policyPath)) errors.push(`Normalization policy missing: ${policyPath}`);

let attestation = null;
let summary = null;
if (!errors.length) {
  attestation = readJson(attestationPath);
  summary = readJson(summaryPath);
  if (attestation.status !== 'PASS') errors.push(`Attestation status is ${attestation.status}, not PASS.`);
  if (Number(attestation.blocking_findings || 0) !== 0) errors.push(`Attestation has ${attestation.blocking_findings} blocking findings.`);
  if (path.resolve(attestation.certified_source_dir || '') !== certifiedDir) errors.push('Attestation certified_source_dir does not match the requested normalization root.');
  if (attestation.normalization_policy_sha256 !== sha256File(policyPath)) errors.push('Normalization policy hash mismatch.');
}

const certified = {};
for (const filename of expectedFiles) {
  const file = path.join(certifiedDir, filename);
  if (!fs.existsSync(file)) { errors.push(`Certified source missing: ${filename}`); continue; }
  const hash = sha256File(file);
  certified[filename] = { sha256: hash, bytes: fs.statSync(file).size };
  if (attestation?.certified_files?.[filename]?.sha256 !== hash) errors.push(`Certified source hash mismatch: ${filename}`);
}
const attestedNames = Object.keys(attestation?.certified_files || {}).sort();
if (JSON.stringify(attestedNames) !== JSON.stringify(expectedFiles)) errors.push(`Attestation must bind exactly 9 certified source files; found ${attestedNames.length}.`);

const audits = {
  normalization_lineage_rows: countJsonl(path.join(auditDir, 'normalization_lineage.jsonl')),
  placeholder_precosting_rows: countJsonl(path.join(auditDir, 'placeholder_precosting.jsonl')),
  pre_costing_master_conflict_groups: countJsonl(path.join(auditDir, 'pre_costing_master_conflicts.jsonl')),
  canonical_revision_groups: countJsonl(path.join(auditDir, 'canonical_revisions.jsonl')),
  unlinked_source_findings: countJsonl(path.join(auditDir, 'unlinked_source_rows.jsonl')),
  invalid_date_values: summary?.counts?.invalid_date_values_preserved ?? null,
};

const result = {
  ok: errors.length === 0,
  review_version: '3.2.3-hybrid-normalization-review-1',
  reviewed_at: new Date().toISOString(),
  normalization_root: normalizationRoot,
  attestation_path: attestationPath,
  attestation_sha256: fs.existsSync(attestationPath) ? sha256File(attestationPath) : null,
  normalization_policy_sha256: fs.existsSync(policyPath) ? sha256File(policyPath) : null,
  certified_file_count: Object.keys(certified).length,
  certified,
  summary_counts: summary?.counts || null,
  source_file_summary: summary?.files || null,
  audit_counts: audits,
  raw_sha256s_path: path.join(manifestsDir, 'raw_SHA256SUMS.txt'),
  certified_sha256s_path: path.join(manifestsDir, 'certified_SHA256SUMS.txt'),
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
