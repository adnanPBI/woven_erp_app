'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildManifest, validateManifest, sha256File, analyzePreCostingNo } = require('../../lib/source_manifest');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v322-manifest-'));
const csvDir = path.join(dir, 'csv');
fs.mkdirSync(csvDir);
const csvName = 'po database.csv';
const csvPath = path.join(csvDir, csvName);
fs.writeFileSync(csvPath, 'PRE_COSTING_NO,PO NO\nPC-001,PO-001\nPC-002,PO-002\n', 'utf8');
const contractPath = path.join(dir, 'contract.json');
const schemaPath = path.join(dir, 'schema.json');
const contract = {
  contract_version: 'test',
  published_contract_sha256: 'a'.repeat(64),
  import_order: ['pre-costing-bootstrap', 'po'],
  profiles: [
    { id: 'pre-costing-bootstrap', source_file: csvName, mappings: [] },
    { id: 'po', source_file: csvName, mappings: [] },
  ],
};
fs.writeFileSync(contractPath, JSON.stringify(contract));
fs.writeFileSync(schemaPath, JSON.stringify({ tables: {} }));
const pending = buildManifest({ contractPath, csvDir, schemaPath });
assert.strictEqual(pending.manifest_status, 'pending-review');
assert.strictEqual(pending.total_blocking_findings, 0);
assert.strictEqual(pending.pre_costing_no_completeness.status, 'PASS');
assert.strictEqual(analyzePreCostingNo(csvPath).rows_missing_pre_costing_no, 0);

const pendingPath = path.join(dir, 'source-manifest.pending.json');
fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2));
const reviewedHash = sha256File(pendingPath);
const approved = JSON.parse(JSON.stringify(pending));
approved.manifest_status = 'approved';
approved.files = approved.files.map((entry) => ({ ...entry, certification_status: 'approved' }));
approved.approval = {
  status: 'approved',
  pending_manifest_file: path.basename(pendingPath),
  reviewed_pending_manifest_sha256: reviewedHash,
  reviewer: 'test-reviewer',
};
const approvedPath = path.join(dir, 'source-manifest.json');
fs.writeFileSync(approvedPath, JSON.stringify(approved, null, 2));
let findings = validateManifest({ manifestPath: approvedPath, csvDir, contract, schemaPath, requireApproved: true });
assert.strictEqual(findings.filter((row) => row.level === 'error').length, 0, JSON.stringify(findings));

// Changing the reviewed pending object invalidates approval.
fs.appendFileSync(pendingPath, '\n');
findings = validateManifest({ manifestPath: approvedPath, csvDir, contract, schemaPath, requireApproved: true });
assert(findings.some((row) => row.code === 'REVIEWED_PENDING_MANIFEST_HASH_MISMATCH'));

// Missing PRE_COSTING_NO is an explicit blocker.
fs.writeFileSync(csvPath, 'PRE_COSTING_NO,PO NO\n,PO-001\n', 'utf8');
const failed = analyzePreCostingNo(csvPath);
assert.strictEqual(failed.status, 'FAIL');
assert.strictEqual(failed.rows_missing_pre_costing_no, 1);
assert(failed.blocking_findings > 0);

fs.rmSync(dir, { recursive: true, force: true });
console.log('manifest_approval_v322.test.js: PASS');
