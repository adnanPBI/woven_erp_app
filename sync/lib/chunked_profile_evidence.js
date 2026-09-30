'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function sameSet(a, b) {
  const left = [...new Set((a || []).map(String))].sort();
  const right = [...new Set((b || []).map(String))].sort();
  return left.length === right.length && left.every((v, i) => v === right[i]);
}
function addCounters(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    const n = Number(value);
    if (Number.isFinite(n)) target[key] = Number(target[key] || 0) + n;
  }
  return target;
}
function mergeRecon(target, source) {
  if (!target.sourceFile) target.sourceFile = source.sourceFile || null;
  target.sourceRows = Number(source.sourceRows || target.sourceRows || 0);
  for (const field of ['processedRows','committedRows','previewRows','skippedRows','rejectedRows','rolledBackRows']) {
    target[field] = Number(target[field] || 0) + Number(source[field] || 0);
  }
  target.tables ||= {};
  for (const [table, counters] of Object.entries(source.tables || {})) {
    target.tables[table] ||= {};
    addCounters(target.tables[table], counters);
  }
  return target;
}
function dbBacked(validation) {
  return Array.isArray(validation) && validation.some((row) => row.scope === 'db' && /Connected to MySQL/i.test(String(row.message || '')));
}
function mergeFk(targetMap, rows) {
  for (const row of rows || []) {
    const key = [row.constraint,row.child_table,row.child_field,row.parent_table,row.parent_field].join('|');
    if (!targetMap.has(key)) targetMap.set(key, row);
  }
}
function rowsToCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((h) => esc(row[h])).join(','))].join('\n');
}

function aggregateChunkedProfile({
  profile,
  profileDir,
  runId,
  contract,
  contractPath,
  csvDir,
  manifestPath,
  manifestSha256,
  expectedSourceRows,
  chunkSize,
  chunks,
  provenancePolicyVersion,
}) {
  ensureDir(profileDir);
  const mergedValidation = [];
  const mergedFk = new Map();
  const mergedStats = {};
  const mergedRecon = { sourceFile: null, sourceRows: expectedSourceRows, processedRows: 0, committedRows: 0, previewRows: 0, skippedRows: 0, rejectedRows: 0, rolledBackRows: 0, tables: {} };
  let validationErrors = 0;
  let validationWarnings = 0;
  let rejectedRows = 0;
  let rejectedRowsDetailed = 0;
  let rejectedRowsOmitted = 0;
  let lookupMisses = 0;
  let lookupMissesDetailed = 0;
  let lookupMissesOmitted = 0;
  let requiredLookupMisses = 0;
  let criticalLookupMisses = 0;
  let policyAuthorizedLookupMisses = 0;
  let previewRows = 0;
  let previewRowsDetailed = 0;
  let previewRowsOmitted = 0;
  let reviewedPendingManifestSha256 = null;
  let expectedOffset = 0;
  const chunkEvidence = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const requiredFiles = ['summary.json','status.json','validation.json','reconciliation.json','fk_dependency_report.json'];
    for (const filename of requiredFiles) {
      const p = path.join(chunk.outputDir, filename);
      if (!fs.existsSync(p)) throw new Error(`Chunk ${profile}#${i + 1} missing ${filename}: ${p}`);
    }
    const summary = readJson(path.join(chunk.outputDir, 'summary.json'));
    const status = readJson(path.join(chunk.outputDir, 'status.json'));
    const validation = readJson(path.join(chunk.outputDir, 'validation.json'));
    const reconciliation = readJson(path.join(chunk.outputDir, 'reconciliation.json'));
    const fkReport = readJson(path.join(chunk.outputDir, 'fk_dependency_report.json'));
    const recon = reconciliation?.[profile];
    const localErrors = [];
    if (Number(chunk.offset) !== expectedOffset) localErrors.push(`offset-discontinuity:${chunk.offset}!=${expectedOffset}`);
    if (!(Number(chunk.limit) > 0 && Number(chunk.limit) <= Number(chunkSize))) localErrors.push('invalid-limit');
    if (summary.mode !== 'dry-run' || summary.status !== 'completed' || status.status !== 'completed') localErrors.push('not-completed-dry-run');
    if (Number(summary.offset || 0) !== Number(chunk.offset) || Number(summary.limit || 0) !== Number(chunk.limit) || summary.unlimited !== false) localErrors.push('chunk-range-mismatch');
    if (!sameSet(summary.selectedProfiles, [profile])) localErrors.push('profile-selection-mismatch');
    if (!recon) localErrors.push('reconciliation-missing');
    if (recon && Number(recon.sourceRows || 0) !== Number(expectedSourceRows)) localErrors.push('source-row-total-mismatch');
    if (recon && Number(recon.processedRows || 0) !== Number(chunk.limit)) localErrors.push('processed-row-count-mismatch');
    if (recon && (Number(recon.rejectedRows || 0) !== 0 || Number(recon.rolledBackRows || 0) !== 0)) localErrors.push('reconciliation-failure');
    if (Number(summary.validationErrors || 0) !== 0) localErrors.push('validation-errors');
    if (Number(summary.requiredLookupMisses || 0) !== 0) localErrors.push('required-lookup-misses');
    if (Number(summary.criticalLookupMisses || 0) !== 0) localErrors.push('critical-lookup-misses');
    if (Number(summary.rejectedRows || 0) !== 0) localErrors.push('rejected-rows');
    if (Number(summary.fkDependencyFailures || 0) !== 0) localErrors.push('fk-failures');
    if (!dbBacked(validation)) localErrors.push('not-db-backed');
    if (summary.contractHash !== contract.published_contract_sha256) localErrors.push('contract-hash-mismatch');
    if (summary.sourceManifestFileSha256 !== manifestSha256) localErrors.push('manifest-hash-mismatch');
    if (localErrors.length) throw new Error(`Chunk ${profile}#${i + 1} failed acceptance: ${localErrors.join(', ')}`);

    expectedOffset += Number(chunk.limit);
    mergedValidation.push(...validation.map((row) => ({ chunk_index: i + 1, chunk_offset: chunk.offset, ...row })));
    mergeFk(mergedFk, fkReport);
    mergedStats[profile] ||= {};
    addCounters(mergedStats[profile], summary.stats?.[profile] || {});
    mergeRecon(mergedRecon, recon);
    // sourceRows is a full-file total in every bounded child; never sum it.
    mergedRecon.sourceRows = Number(expectedSourceRows);
    validationErrors += Number(summary.validationErrors || 0);
    validationWarnings += Number(summary.validationWarnings || 0);
    rejectedRows += Number(summary.rejectedRows || 0);
    rejectedRowsDetailed += Number(summary.rejectedRowsDetailed || 0);
    rejectedRowsOmitted += Number(summary.rejectedRowsOmitted || 0);
    lookupMisses += Number(summary.lookupMisses || 0);
    lookupMissesDetailed += Number(summary.lookupMissesDetailed || 0);
    lookupMissesOmitted += Number(summary.lookupMissesOmitted || 0);
    requiredLookupMisses += Number(summary.requiredLookupMisses || 0);
    criticalLookupMisses += Number(summary.criticalLookupMisses || 0);
    policyAuthorizedLookupMisses += Number(summary.policyAuthorizedLookupMisses || 0);
    previewRows += Number(summary.previewRows || 0);
    previewRowsDetailed += Number(summary.previewRowsDetailed || 0);
    previewRowsOmitted += Number(summary.previewRowsOmitted || 0);
    reviewedPendingManifestSha256 ||= summary.reviewedPendingManifestSha256 || null;

    chunkEvidence.push({
      index: i + 1,
      offset: Number(chunk.offset),
      limit: Number(chunk.limit),
      processedRows: Number(recon.processedRows || 0),
      outputDir: chunk.outputDir,
      terminalLog: chunk.terminalLog,
      exitCode: Number(chunk.exitCode || 0),
      signal: chunk.signal || null,
      ok: true,
      dbBacked: true,
      summarySha256: sha256File(path.join(chunk.outputDir, 'summary.json')),
      statusSha256: sha256File(path.join(chunk.outputDir, 'status.json')),
      validationSha256: sha256File(path.join(chunk.outputDir, 'validation.json')),
      reconciliationSha256: sha256File(path.join(chunk.outputDir, 'reconciliation.json')),
      fkDependencyReportSha256: sha256File(path.join(chunk.outputDir, 'fk_dependency_report.json')),
    });
  }

  if (expectedOffset !== Number(expectedSourceRows)) throw new Error(`Chunk coverage failed for ${profile}: covered ${expectedOffset}, expected ${expectedSourceRows}`);
  if (Number(mergedRecon.processedRows || 0) !== Number(expectedSourceRows)) throw new Error(`Chunk reconciliation failed for ${profile}: processed ${mergedRecon.processedRows}, expected ${expectedSourceRows}`);

  const chunkIndex = {
    version: '3.2.3-profile-row-chunks-20260816',
    profile,
    runId,
    generatedAt: new Date().toISOString(),
    chunkSize: Number(chunkSize),
    sourceRows: Number(expectedSourceRows),
    processedRows: Number(mergedRecon.processedRows || 0),
    chunkCount: chunkEvidence.length,
    contractPublishedSha256: contract.published_contract_sha256 || null,
    manifestSha256,
    chunks: chunkEvidence,
    ok: true,
  };
  const chunkIndexPath = path.join(profileDir, 'chunk_index.json');
  writeJson(chunkIndexPath, chunkIndex);

  const summary = {
    runId: `${runId}__${profile}`,
    status: 'completed',
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    executionStrategy: 'row-chunked-profile-processes',
    chunkedProfile: true,
    chunkSize: Number(chunkSize),
    chunkCount: chunkEvidence.length,
    chunkEvidenceFile: 'chunk_index.json',
    contractVersion: contract.contract_version,
    contractHash: contract.published_contract_sha256 || null,
    publishedContractHash: contract.published_contract_sha256 || null,
    contractPath,
    csvDir,
    sourceManifestPath: manifestPath,
    sourceManifestFileSha256: manifestSha256,
    reviewedPendingManifestSha256,
    approvedDryRunId: null,
    requestedOnly: [profile],
    selectedProfiles: [profile],
    allContractProfiles: contract.import_order || (contract.profiles || []).map((p) => p.id),
    reconciliationProfiles: [profile],
    limit: null,
    offset: 0,
    unlimited: true,
    allProfilesSelected: false,
    allProfilesReconciled: false,
    fullAllProfileDryRun: false,
    stats: mergedStats,
    validationErrors,
    validationWarnings,
    rejectedRows,
    rejectedRowsDetailed: 0,
    rejectedRowsOmitted: rejectedRows,
    lookupMisses,
    lookupMissesDetailed: 0,
    lookupMissesOmitted: lookupMisses,
    requiredLookupMisses,
    criticalLookupMisses,
    policyAuthorizedLookupMisses,
    previewRows,
    previewRowsDetailed: 0,
    previewRowsOmitted: previewRows,
    fkDependencyFailures: [...mergedFk.values()].filter((row) => row.ok === false).length,
    transactionScope: 'source-row/logical-unit + source-uid provenance',
    provenancePolicyVersion,
    outputDir: profileDir,
  };
  const status = {
    status: 'completed',
    runId: summary.runId,
    mode: 'dry-run',
    contractHash: summary.contractHash,
    processed: Number(mergedRecon.processedRows || 0),
    total: Number(expectedSourceRows),
    inserted: 0,
    updated: 0,
    rejected: Number(mergedRecon.rejectedRows || 0),
    rolledBack: Number(mergedRecon.rolledBackRows || 0),
    message: `${profile}: full source coverage completed in ${chunkEvidence.length} bounded chunks of at most ${chunkSize} rows.`,
    stats: mergedStats,
    updatedAt: new Date().toISOString(),
  };

  writeJson(path.join(profileDir, 'summary.json'), summary);
  writeJson(path.join(profileDir, 'status.json'), status);
  writeJson(path.join(profileDir, 'validation.json'), mergedValidation);
  writeJson(path.join(profileDir, 'reconciliation.json'), { [profile]: mergedRecon });
  writeJson(path.join(profileDir, 'fk_dependency_report.json'), [...mergedFk.values()]);
  fs.writeFileSync(path.join(profileDir, 'rejected_rows.csv'), rowsToCsv([]), 'utf8');
  fs.writeFileSync(path.join(profileDir, 'lookup_misses.csv'), rowsToCsv([]), 'utf8');
  fs.writeFileSync(path.join(profileDir, 'row_preview.csv'), '', 'utf8');
  fs.writeFileSync(path.join(profileDir, 'README.md'), `# ${profile} bounded full-profile evidence\n\nSource rows: ${expectedSourceRows}\nChunk size: ${chunkSize}\nChunks: ${chunkEvidence.length}\nEvery source row was processed exactly once in ascending offset order. Each chunk used a scoped immutable source index containing the complete cross-source history for the Dispos present in that chunk. Lookup-miss and preview detail rows remain in the cryptographically indexed per-chunk evidence; aggregate CSV detail files are intentionally empty to keep memory and evidence size bounded.\n`, 'utf8');

  return {
    summary,
    status,
    validation: mergedValidation,
    reconciliation: { [profile]: mergedRecon },
    fkReport: [...mergedFk.values()],
    chunkIndex,
    chunkIndexPath,
    profileEvidence: {
      profile,
      childRunId: summary.runId,
      outputDir: profileDir,
      terminalLog: null,
      exitCode: 0,
      signal: null,
      ok: true,
      dbBacked: true,
      chunked: true,
      chunkSize: Number(chunkSize),
      chunkCount: chunkEvidence.length,
      chunkEvidenceFile: 'chunk_index.json',
      chunkIndexSha256: sha256File(chunkIndexPath),
      summarySha256: sha256File(path.join(profileDir, 'summary.json')),
      statusSha256: sha256File(path.join(profileDir, 'status.json')),
      validationSha256: sha256File(path.join(profileDir, 'validation.json')),
      reconciliationSha256: sha256File(path.join(profileDir, 'reconciliation.json')),
      fkDependencyReportSha256: sha256File(path.join(profileDir, 'fk_dependency_report.json')),
      sourceRows: Number(expectedSourceRows),
      processedRows: Number(mergedRecon.processedRows || 0),
    },
  };
}

module.exports = { aggregateChunkedProfile, sameSet, addCounters, mergeRecon, dbBacked, sha256File, readJson, writeJson };
