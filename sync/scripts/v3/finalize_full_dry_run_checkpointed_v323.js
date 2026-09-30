'use strict';

const fs = require('fs');
const path = require('path');
const {
  sameSet,
  addCounters,
  dbBacked,
  sha256File,
  readJson,
  writeJson,
} = require('../../lib/chunked_profile_evidence');

function parseArgs(argv) {
  const out = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, ...rest] = item.slice(2).split('=');
    out[key] = rest.length ? rest.join('=') : true;
  }
  return out;
}
function mergeFk(target, rows) {
  for (const row of rows || []) {
    const key = [row.constraint, row.child_table, row.child_field, row.parent_table, row.parent_field].join('|');
    if (!target.has(key)) target.set(key, row);
  }
}
function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return [headers.join(','), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(','))].join('\n');
}
function safeName(value) { return String(value).replace(/[^A-Za-z0-9_.-]+/g, '_'); }

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname, '..', '..');
const runId = safeName(options['run-id'] || '');
const outputRoot = path.resolve(options['output-root'] || process.env.CLI_CONTRACT_OUTPUT_ROOT || path.join(root, 'output', 'mapping_contract_v2'));
const runDir = path.join(outputRoot, runId);
const contractPath = path.resolve(options.contract || process.env.MAPPING_CONTRACT_FILE || path.join(root, 'mappings', 'mapping-contract-v2.json'));
const manifestPath = path.resolve(options.manifest || process.env.SOURCE_MANIFEST_FILE || path.join(root, 'source-manifest.json'));
const schemaPath = path.resolve(options.schema || path.join(root, 'schema', 'weavonpq_weaving.schema.json'));
const csvDir = path.resolve(options['csv-dir'] || process.env.CSV_DIR || path.join(root, 'csv_files'));
const nodeHeapMb = Math.max(192, Number(options['node-heap-mb'] || process.env.V323_NODE_HEAP_MB || 256) || 256);
const chunkSize = Number(options['chunk-size'] || process.env.V323_CHUNK_ROWS || 500);
if (!runId) throw new Error('--run-id is required');
if (chunkSize !== 500) throw new Error(`Production chunk size must be 500; got ${chunkSize}`);
if (!fs.existsSync(runDir)) throw new Error(`Run directory does not exist: ${runDir}`);

const contract = readJson(contractPath);
const allProfiles = contract.import_order || (contract.profiles || []).map((p) => p.id);
const required = ['pre-costing-bootstrap','po','dispo','yarn-receive','yarn-issue','warping','sizing','loom','folding','greige-delivery'];
if (!sameSet(allProfiles, required) || allProfiles.length !== required.length) throw new Error(`Unexpected production profile set: ${JSON.stringify(allProfiles)}`);
const chunkProfiles = new Set(['loom','folding','greige-delivery']);
const manifestSha256 = sha256File(manifestPath);
const provenancePolicyVersion = readJson(path.join(root, 'config', 'provenance_policy.v3.2.3.json')).policy_version || null;

const index = {
  version: '3.2.3-checkpointed-shell-row-chunks-20260816',
  runId,
  generatedAt: new Date().toISOString(),
  executionStrategy: 'segmented-per-profile-row-chunks',
  orchestrationStrategy: 'checkpointed-shell-direct-children',
  nodeHeapMb,
  chunkSize,
  chunkProfiles: [...chunkProfiles],
  contractPath,
  contractPublishedSha256: contract.published_contract_sha256 || null,
  manifestPath,
  manifestSha256,
  schemaPath,
  schemaSha256: sha256File(schemaPath),
  csvDir,
  profiles: [],
  ok: false,
};

const mergedValidation = [];
const mergedReconciliation = {};
const mergedStats = {};
const mergedFk = new Map();
let totalPreview = 0;
let totalValidationWarnings = 0;
let totalValidationErrors = 0;
let totalRequiredLookupMisses = 0;
let totalCriticalLookupMisses = 0;
let totalRejected = 0;
let totalLookupMisses = 0;
let totalPolicyAuthorizedLookupMisses = 0;
let reviewedPendingManifestSha256 = null;
let sourceManifestFileSha256 = null;

for (let i = 0; i < allProfiles.length; i += 1) {
  const profileId = allProfiles[i];
  const profileDir = path.join(runDir, 'profiles', `${String(i + 1).padStart(2, '0')}_${safeName(profileId)}`);
  const requiredFiles = ['summary.json','status.json','validation.json','reconciliation.json','fk_dependency_report.json'];
  for (const filename of requiredFiles) {
    const file = path.join(profileDir, filename);
    if (!fs.existsSync(file)) throw new Error(`Profile ${profileId} missing ${filename}: ${file}`);
  }
  const summary = readJson(path.join(profileDir, 'summary.json'));
  const status = readJson(path.join(profileDir, 'status.json'));
  const validation = readJson(path.join(profileDir, 'validation.json'));
  const reconciliation = readJson(path.join(profileDir, 'reconciliation.json'));
  const fkReport = readJson(path.join(profileDir, 'fk_dependency_report.json'));
  const recon = reconciliation?.[profileId];
  const localErrors = [];
  const isDbBacked = dbBacked(validation);
  if (summary.mode !== 'dry-run') localErrors.push('not-dry-run');
  if (summary.status !== 'completed' || status.status !== 'completed') localErrors.push('not-completed');
  if (summary.limit !== null || Number(summary.offset || 0) !== 0 || summary.unlimited !== true) localErrors.push('limited');
  if (!sameSet(summary.selectedProfiles, [profileId])) localErrors.push('profile-selection-mismatch');
  if (!recon) localErrors.push('reconciliation-missing');
  if (recon && Number(recon.processedRows || 0) !== Number(recon.sourceRows || 0)) localErrors.push('not-fully-processed');
  if (recon && (Number(recon.rejectedRows || 0) !== 0 || Number(recon.rolledBackRows || 0) !== 0)) localErrors.push('reconciliation-failure');
  if (Number(summary.validationErrors || 0) !== 0) localErrors.push('validation-errors');
  if (Number(summary.requiredLookupMisses || 0) !== 0) localErrors.push('required-lookup-misses');
  if (Number(summary.criticalLookupMisses || 0) !== 0) localErrors.push('critical-lookup-misses');
  if (Number(summary.rejectedRows || 0) !== 0) localErrors.push('rejected-rows');
  if (Number(summary.fkDependencyFailures || 0) !== 0) localErrors.push('fk-failures');
  if (!isDbBacked) localErrors.push('not-db-backed');
  if (summary.contractHash !== contract.published_contract_sha256) localErrors.push('contract-hash-mismatch');
  if (summary.sourceManifestFileSha256 !== manifestSha256) localErrors.push('manifest-hash-mismatch');
  if (localErrors.length) throw new Error(`Profile ${profileId} failed checkpointed acceptance: ${localErrors.join(', ')}`);

  const segment = {
    profile: profileId,
    childRunId: summary.runId,
    outputDir: profileDir,
    terminalLog: chunkProfiles.has(profileId) ? null : path.join(profileDir, 'terminal.log'),
    exitCode: 0,
    signal: null,
    ok: true,
    dbBacked: true,
    chunked: chunkProfiles.has(profileId),
    summarySha256: sha256File(path.join(profileDir, 'summary.json')),
    statusSha256: sha256File(path.join(profileDir, 'status.json')),
    validationSha256: sha256File(path.join(profileDir, 'validation.json')),
    reconciliationSha256: sha256File(path.join(profileDir, 'reconciliation.json')),
    fkDependencyReportSha256: sha256File(path.join(profileDir, 'fk_dependency_report.json')),
    sourceRows: Number(recon?.sourceRows || 0),
    processedRows: Number(recon?.processedRows || 0),
  };
  if (segment.chunked) {
    const chunkIndexPath = path.join(profileDir, 'chunk_index.json');
    if (!fs.existsSync(chunkIndexPath)) throw new Error(`Chunked profile ${profileId} missing chunk_index.json`);
    const chunkIndex = readJson(chunkIndexPath);
    if (chunkIndex.ok !== true || chunkIndex.profile !== profileId || Number(chunkIndex.chunkSize) !== 500) throw new Error(`Chunk index invalid for ${profileId}`);
    segment.chunkSize = 500;
    segment.chunkCount = Number(chunkIndex.chunkCount || 0);
    segment.chunkEvidenceFile = 'chunk_index.json';
    segment.chunkIndexSha256 = sha256File(chunkIndexPath);
  }
  index.profiles.push(segment);

  for (const row of validation) mergedValidation.push({ segment_profile: profileId, ...row });
  mergedReconciliation[profileId] = recon;
  mergedStats[profileId] ||= {};
  addCounters(mergedStats[profileId], summary.stats?.[profileId] || {});
  mergeFk(mergedFk, fkReport);
  totalPreview += Number(summary.previewRows || 0);
  totalValidationWarnings += Number(summary.validationWarnings || 0);
  totalValidationErrors += Number(summary.validationErrors || 0);
  totalRequiredLookupMisses += Number(summary.requiredLookupMisses || 0);
  totalCriticalLookupMisses += Number(summary.criticalLookupMisses || 0);
  totalRejected += Number(summary.rejectedRows || 0);
  totalLookupMisses += Number(summary.lookupMisses || 0);
  totalPolicyAuthorizedLookupMisses += Number(summary.policyAuthorizedLookupMisses || 0);
  reviewedPendingManifestSha256 ||= summary.reviewedPendingManifestSha256 || null;
  sourceManifestFileSha256 ||= summary.sourceManifestFileSha256 || null;
}

index.ok = index.profiles.length === allProfiles.length && index.profiles.every((p) => p.ok && p.dbBacked && Number(p.exitCode) === 0);
index.completedAt = new Date().toISOString();
writeJson(path.join(runDir, 'segmented_dry_run_index.json'), index);

const summary = {
  runId,
  status: 'completed',
  generatedAt: new Date().toISOString(),
  mode: 'dry-run',
  executionStrategy: 'segmented-per-profile-row-chunks',
  orchestrationStrategy: 'checkpointed-shell-direct-children',
  segmentedFullDryRun: true,
  segmentedEvidenceFile: 'segmented_dry_run_index.json',
  segmentCount: index.profiles.length,
  dbBackedAllProfiles: index.profiles.every((p) => p.dbBacked),
  chunkSize,
  chunkProfiles: [...chunkProfiles],
  contractVersion: contract.contract_version,
  contractHash: contract.published_contract_sha256 || null,
  publishedContractHash: contract.published_contract_sha256 || null,
  contractPath,
  csvDir,
  sourceManifestPath: manifestPath,
  sourceManifestFileSha256,
  reviewedPendingManifestSha256,
  approvedDryRunId: null,
  requestedOnly: null,
  selectedProfiles: allProfiles,
  allContractProfiles: allProfiles,
  reconciliationProfiles: Object.keys(mergedReconciliation),
  limit: null,
  offset: 0,
  unlimited: true,
  allProfilesSelected: true,
  allProfilesReconciled: sameSet(Object.keys(mergedReconciliation), allProfiles),
  fullAllProfileDryRun: true,
  stats: mergedStats,
  validationErrors: totalValidationErrors,
  validationWarnings: totalValidationWarnings,
  rejectedRows: totalRejected,
  rejectedRowsDetailed: 0,
  rejectedRowsOmitted: totalRejected,
  lookupMisses: totalLookupMisses,
  lookupMissesDetailed: 0,
  lookupMissesOmitted: totalLookupMisses,
  requiredLookupMisses: totalRequiredLookupMisses,
  criticalLookupMisses: totalCriticalLookupMisses,
  policyAuthorizedLookupMisses: totalPolicyAuthorizedLookupMisses,
  previewRows: totalPreview,
  previewRowsDetailed: 0,
  previewRowsOmitted: totalPreview,
  fkDependencyFailures: [...mergedFk.values()].filter((row) => row.ok === false).length,
  transactionScope: 'source-row/logical-unit + source-uid provenance',
  provenancePolicyVersion,
  outputDir: runDir,
};
const status = {
  status: 'completed',
  runId,
  mode: 'dry-run',
  contractHash: summary.contractHash,
  processed: Object.values(mergedReconciliation).reduce((a, r) => a + Number(r?.processedRows || 0), 0),
  total: Object.values(mergedReconciliation).reduce((a, r) => a + Number(r?.sourceRows || 0), 0),
  inserted: 0,
  updated: 0,
  rejected: totalRejected,
  rolledBack: 0,
  message: 'Checkpointed shell-orchestrated full, unlimited, all-profile DB-backed dry run completed successfully.',
  stats: mergedStats,
  updatedAt: new Date().toISOString(),
};

writeJson(path.join(runDir, 'summary.json'), summary);
writeJson(path.join(runDir, 'status.json'), status);
writeJson(path.join(runDir, 'validation.json'), mergedValidation);
writeJson(path.join(runDir, 'reconciliation.json'), mergedReconciliation);
writeJson(path.join(runDir, 'fk_dependency_report.json'), [...mergedFk.values()]);
fs.writeFileSync(path.join(runDir, 'rejected_rows.csv'), rowsToCsv([]), 'utf8');
fs.writeFileSync(path.join(runDir, 'lookup_misses.csv'), rowsToCsv([]), 'utf8');
fs.writeFileSync(path.join(runDir, 'row_preview.csv'), '', 'utf8');
fs.writeFileSync(path.join(runDir, 'README.md'), `# v3.2.3 checkpointed resource-bounded full dry run\n\nRun ID: ${runId}\nProfiles: ${allProfiles.join(', ')}\nDB-backed all profiles: ${summary.dbBackedAllProfiles}\nHeavy profiles were executed by bash as direct 500-row Node children. There is no long-lived Node parent spanning the heavy-profile chunk loop. Each heavy profile was then independently aggregated and cryptographically indexed before this ten-profile finalization.\n`, 'utf8');

process.stdout.write(`${JSON.stringify({
  ok: true,
  runId,
  runDir,
  executionStrategy: summary.executionStrategy,
  orchestrationStrategy: summary.orchestrationStrategy,
  chunkSize,
  dbBackedAllProfiles: summary.dbBackedAllProfiles,
  profiles: index.profiles.map((p) => ({ profile: p.profile, chunked: p.chunked, chunkCount: p.chunkCount || 1, exitCode: p.exitCode, dbBacked: p.dbBacked, sourceRows: p.sourceRows, processedRows: p.processedRows })),
}, null, 2)}\n`);
