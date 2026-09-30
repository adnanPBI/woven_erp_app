'use strict';

const fs = require('fs');
const path = require('path');
const { sha256File, validateManifest } = require('../../lib/source_manifest');

function args(argv) {
  const out = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, ...rest] = item.slice(2).split('=');
    out[key] = rest.length ? rest.join('=') : true;
  }
  return out;
}
const options = args(process.argv.slice(2));
const root = path.resolve(__dirname, '../..');
const pendingPath = path.resolve(options.pending || path.join(root, 'source-manifest.pending.json'));
const approvedPath = path.resolve(options.output || process.env.SOURCE_MANIFEST_FILE || path.join(root, 'source-manifest.json'));
const approvalRecordPath = path.resolve(options['approval-record'] || path.join(root, 'source-manifest.approval.json'));
const reviewedHash = String(options['pending-hash'] || process.env.REVIEWED_PENDING_MANIFEST_SHA256 || '').toLowerCase();
const reviewer = String(options.reviewer || process.env.SOURCE_MANIFEST_REVIEWER || '').trim();
if (!/^[a-f0-9]{64}$/.test(reviewedHash)) throw new Error('Approval requires --pending-hash=<64-character SHA-256> copied from the reviewed pending-manifest output.');
if (!reviewer) throw new Error('Approval requires --reviewer=<name-or-identifier>.');
if (!fs.existsSync(pendingPath)) throw new Error(`Pending manifest not found: ${pendingPath}`);
const actualPendingHash = sha256File(pendingPath);
if (actualPendingHash !== reviewedHash) throw new Error(`Pending manifest hash mismatch. Reviewed=${reviewedHash}; current=${actualPendingHash}. Regenerate and review again.`);
const pending = JSON.parse(fs.readFileSync(pendingPath, 'utf8'));
if (pending.manifest_status !== 'pending-review' || Number(pending.total_blocking_findings || 0) !== 0) throw new Error('Pending manifest is not approval-ready. Resolve every blocking finding first.');
if (pending.pre_costing_no_completeness?.status !== 'PASS' || Number(pending.pre_costing_no_completeness?.blocking_findings || 0) !== 0) throw new Error('PRE_COSTING_NO completeness report is not PASS. Approval is blocked.');
const contractPath = path.resolve(options.contract || pending.contract_file || path.join(root, 'mappings/mapping-contract-v2.json'));
const csvDir = path.resolve(options['csv-dir'] || pending.csv_dir || process.env.CSV_DIR || path.join(root, 'csv_files'));
const schemaPath = path.resolve(options.schema || pending.schema_file || path.join(root, 'schema/weavonpq_weaving.schema.json'));
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const preApprovalFindings = validateManifest({ manifestPath: pendingPath, csvDir, contract, schemaPath, requireApproved: false });
if (preApprovalFindings.some((finding) => finding.level === 'error')) {
  const error = new Error('The reviewed pending manifest no longer matches the current sources, contract, or schema.');
  error.findings = preApprovalFindings;
  throw error;
}
const approvedAt = new Date().toISOString();
const approved = JSON.parse(JSON.stringify(pending));
approved.manifest_status = 'approved';
approved.approved_at = approvedAt;
approved.files = approved.files.map((entry) => ({ ...entry, certification_status: entry.blocking_findings ? 'rejected' : 'approved' }));
approved.approval = {
  status: 'approved',
  reviewer,
  approved_at: approvedAt,
  pending_manifest_file: path.basename(pendingPath),
  reviewed_pending_manifest_sha256: reviewedHash,
  contract_sha256: approved.contract_sha256,
  schema_sha256: approved.schema_sha256,
  normalization_attestation_sha256: approved.normalization_attestation_sha256 || null,
  normalization_policy_sha256: approved.normalization_policy_sha256 || null,
  provenance_policy_sha256: approved.provenance_policy_sha256 || null,
};
fs.mkdirSync(path.dirname(approvedPath), { recursive: true });
fs.writeFileSync(approvedPath, `${JSON.stringify(approved, null, 2)}\n`, 'utf8');
const approvedSha256 = sha256File(approvedPath);
const record = {
  approval_version: '1.0',
  reviewer,
  approved_at: approvedAt,
  pending_manifest_path: pendingPath,
  pending_manifest_sha256: reviewedHash,
  approved_manifest_path: approvedPath,
  approved_manifest_sha256: approvedSha256,
  contract_sha256: approved.contract_sha256,
  schema_sha256: approved.schema_sha256,
  normalization_attestation_sha256: approved.normalization_attestation_sha256 || null,
  normalization_policy_sha256: approved.normalization_policy_sha256 || null,
  provenance_policy_sha256: approved.provenance_policy_sha256 || null,
  normalization_artifacts: approved.normalization_summary?.artifacts || approved.normalization_artifacts || null,
  source_files: approved.files.map((entry) => ({ filename: entry.filename, sha256: entry.sha256, nonempty_rows: entry.nonempty_rows })),
};
fs.writeFileSync(approvalRecordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, approvedPath, approvedManifestSha256: approvedSha256, approvalRecordPath, reviewedPendingManifestSha256: reviewedHash, reviewer }, null, 2));
