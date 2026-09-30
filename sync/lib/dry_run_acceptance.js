'use strict';

const fs = require('fs');
const path = require('path');
const { sha256File, validateManifest } = require('./source_manifest');

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function sameSet(left, right) {
  const a = [...new Set((left || []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
  const b = [...new Set((right || []).map((value) => String(value || '').trim()).filter(Boolean))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}


function verifyChunkedSegment({ segment, profileId, segmentSummary, runDir, requireGate }) {
  requireGate(segment.chunked === true, 'CHUNKED_SEGMENT_FLAG_MISSING', `Chunked segment ${profileId} is missing its chunked flag.`);
  requireGate(Number(segment.chunkSize || 0) === 500, 'CHUNK_SIZE_INVALID', `Chunked segment ${profileId} must use 500-row chunks.`, { actual: segment.chunkSize });
  const chunkIndexPath = path.join(segment.outputDir || '', String(segment.chunkEvidenceFile || segmentSummary.chunkEvidenceFile || 'chunk_index.json'));
  requireGate(fs.existsSync(chunkIndexPath), 'CHUNK_INDEX_MISSING', `Chunk index missing for ${profileId}.`, { chunkIndexPath });
  if (!fs.existsSync(chunkIndexPath)) return;
  const actualChunkIndexSha256 = sha256File(chunkIndexPath);
  requireGate(!segment.chunkIndexSha256 || actualChunkIndexSha256 === segment.chunkIndexSha256, 'CHUNK_INDEX_HASH_MISMATCH', `Chunk index hash mismatch for ${profileId}.`, { expected: segment.chunkIndexSha256, actual: actualChunkIndexSha256 });
  const chunkIndex = readJson(chunkIndexPath);
  requireGate(chunkIndex.ok === true, 'CHUNK_INDEX_FAILED', `Chunk index is not PASS for ${profileId}.`);
  requireGate(chunkIndex.profile === profileId, 'CHUNK_INDEX_PROFILE_MISMATCH', `Chunk index profile mismatch for ${profileId}.`, { actual: chunkIndex.profile });
  requireGate(Number(chunkIndex.chunkSize || 0) === 500, 'CHUNK_INDEX_SIZE_INVALID', `Chunk index for ${profileId} does not use 500 rows.`, { actual: chunkIndex.chunkSize });
  requireGate(Number(chunkIndex.sourceRows || 0) === Number(segment.sourceRows || 0), 'CHUNK_INDEX_SOURCE_ROWS_MISMATCH', `Chunk source-row total mismatch for ${profileId}.`, { index: chunkIndex.sourceRows, segment: segment.sourceRows });
  requireGate(Number(chunkIndex.processedRows || 0) === Number(segment.processedRows || 0), 'CHUNK_INDEX_PROCESSED_ROWS_MISMATCH', `Chunk processed-row total mismatch for ${profileId}.`, { index: chunkIndex.processedRows, segment: segment.processedRows });
  const chunks = Array.isArray(chunkIndex.chunks) ? chunkIndex.chunks : [];
  requireGate(chunks.length === Number(chunkIndex.chunkCount || 0) && chunks.length === Number(segment.chunkCount || 0), 'CHUNK_COUNT_MISMATCH', `Chunk count mismatch for ${profileId}.`, { indexCount: chunkIndex.chunkCount, segmentCount: segment.chunkCount, actual: chunks.length });
  const expectedChunkCount = Math.ceil(Number(segment.sourceRows || 0) / 500);
  requireGate(chunks.length === expectedChunkCount, 'CHUNK_COUNT_NOT_FULL_COVERAGE', `Chunk count does not cover all source rows for ${profileId}.`, { expected: expectedChunkCount, actual: chunks.length });
  let expectedOffset = 0;
  let processedTotal = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const expectedLimit = Math.min(500, Number(segment.sourceRows || 0) - expectedOffset);
    requireGate(Number(chunk.index || 0) === i + 1, 'CHUNK_INDEX_SEQUENCE_INVALID', `Chunk sequence number invalid for ${profileId}.`, { chunk });
    requireGate(Number(chunk.offset || 0) === expectedOffset, 'CHUNK_OFFSET_GAP_OR_OVERLAP', `Chunk offsets are not contiguous for ${profileId}.`, { expectedOffset, actual: chunk.offset, chunk: i + 1 });
    requireGate(Number(chunk.limit || 0) === expectedLimit, 'CHUNK_LIMIT_INVALID', `Chunk limit is invalid for ${profileId}.`, { expected: expectedLimit, actual: chunk.limit, chunk: i + 1 });
    requireGate(chunk.ok === true && Number(chunk.exitCode) === 0 && chunk.dbBacked === true && !chunk.signal, 'CHUNK_NOT_ACCEPTED', `Chunk ${i + 1} for ${profileId} was not a successful DB-backed child run.`, { chunk });
    const chunkDir = path.resolve(chunk.outputDir || '');
    const segmentDir = path.resolve(segment.outputDir || '');
    requireGate(chunkDir.startsWith(`${segmentDir}${path.sep}`), 'CHUNK_OUTPUT_OUTSIDE_SEGMENT', `Chunk output directory escapes its profile segment for ${profileId}.`, { chunkDir, segmentDir });
    const files = {
      summary: path.join(chunkDir, 'summary.json'),
      status: path.join(chunkDir, 'status.json'),
      validation: path.join(chunkDir, 'validation.json'),
      reconciliation: path.join(chunkDir, 'reconciliation.json'),
      fk: path.join(chunkDir, 'fk_dependency_report.json'),
    };
    for (const [name, file] of Object.entries(files)) requireGate(fs.existsSync(file), 'CHUNK_EVIDENCE_FILE_MISSING', `Chunk evidence file missing for ${profileId}: ${name}.`, { file, chunk: i + 1 });
    if (!Object.values(files).every((file) => fs.existsSync(file))) { expectedOffset += expectedLimit; continue; }
    requireGate(sha256File(files.summary) === chunk.summarySha256, 'CHUNK_SUMMARY_HASH_MISMATCH', `Chunk summary hash mismatch for ${profileId}.`, { chunk: i + 1 });
    requireGate(sha256File(files.status) === chunk.statusSha256, 'CHUNK_STATUS_HASH_MISMATCH', `Chunk status hash mismatch for ${profileId}.`, { chunk: i + 1 });
    requireGate(sha256File(files.validation) === chunk.validationSha256, 'CHUNK_VALIDATION_HASH_MISMATCH', `Chunk validation hash mismatch for ${profileId}.`, { chunk: i + 1 });
    requireGate(sha256File(files.reconciliation) === chunk.reconciliationSha256, 'CHUNK_RECONCILIATION_HASH_MISMATCH', `Chunk reconciliation hash mismatch for ${profileId}.`, { chunk: i + 1 });
    requireGate(sha256File(files.fk) === chunk.fkDependencyReportSha256, 'CHUNK_FK_HASH_MISMATCH', `Chunk FK report hash mismatch for ${profileId}.`, { chunk: i + 1 });
    const chunkSummary = readJson(files.summary);
    const chunkStatus = readJson(files.status);
    const chunkValidation = readJson(files.validation);
    const chunkRecon = readJson(files.reconciliation)?.[profileId];
    const chunkFk = readJson(files.fk);
    requireGate(chunkSummary.mode === 'dry-run' && chunkSummary.status === 'completed' && chunkStatus.status === 'completed', 'CHUNK_NOT_COMPLETED', `Chunk ${i + 1} for ${profileId} is not a completed dry run.`);
    requireGate(Number(chunkSummary.offset || 0) === expectedOffset && Number(chunkSummary.limit || 0) === expectedLimit && chunkSummary.unlimited === false, 'CHUNK_RANGE_MISMATCH', `Chunk ${i + 1} for ${profileId} has an unexpected offset/limit.`, { offset: chunkSummary.offset, limit: chunkSummary.limit });
    requireGate(sameSet(chunkSummary.selectedProfiles, [profileId]), 'CHUNK_PROFILE_MISMATCH', `Chunk ${i + 1} selected an unexpected profile set for ${profileId}.`, { actual: chunkSummary.selectedProfiles });
    requireGate(Number(chunkSummary.validationErrors || 0) === 0 && Number(chunkSummary.requiredLookupMisses || 0) === 0 && Number(chunkSummary.criticalLookupMisses || 0) === 0 && Number(chunkSummary.rejectedRows || 0) === 0 && Number(chunkSummary.fkDependencyFailures || 0) === 0, 'CHUNK_BLOCKING_FINDINGS', `Chunk ${i + 1} has blocking findings for ${profileId}.`, { summary: chunkSummary });
    requireGate(Array.isArray(chunkValidation) && chunkValidation.some((row) => row.scope === 'db' && /Connected to MySQL/i.test(String(row.message || ''))), 'CHUNK_NOT_DB_BACKED', `Chunk ${i + 1} did not prove a guarded MySQL connection for ${profileId}.`);
    requireGate(Array.isArray(chunkFk) && chunkFk.every((row) => row.ok !== false), 'CHUNK_FK_FAILED', `Chunk ${i + 1} has an FK dependency failure for ${profileId}.`);
    requireGate(Boolean(chunkRecon), 'CHUNK_RECONCILIATION_MISSING', `Chunk ${i + 1} reconciliation missing for ${profileId}.`);
    if (chunkRecon) {
      requireGate(Number(chunkRecon.sourceRows || 0) === Number(segment.sourceRows || 0), 'CHUNK_SOURCE_TOTAL_MISMATCH', `Chunk ${i + 1} source total differs from the approved profile total for ${profileId}.`, { sourceRows: chunkRecon.sourceRows, expected: segment.sourceRows });
      requireGate(Number(chunkRecon.processedRows || 0) === expectedLimit && Number(chunkRecon.rejectedRows || 0) === 0 && Number(chunkRecon.rolledBackRows || 0) === 0, 'CHUNK_RECONCILIATION_FAILED', `Chunk ${i + 1} reconciliation failed for ${profileId}.`, { chunkRecon });
      processedTotal += Number(chunkRecon.processedRows || 0);
    }
    expectedOffset += expectedLimit;
  }
  requireGate(expectedOffset === Number(segment.sourceRows || 0), 'CHUNK_COVERAGE_INCOMPLETE', `Chunk offsets do not cover the full source for ${profileId}.`, { covered: expectedOffset, sourceRows: segment.sourceRows });
  requireGate(processedTotal === Number(segment.sourceRows || 0), 'CHUNK_PROCESSED_TOTAL_INCOMPLETE', `Chunk processed-row total does not equal the source total for ${profileId}.`, { processedTotal, sourceRows: segment.sourceRows });
}

function verifyFullDryRunEvidence({
  runId,
  outputRoot,
  contractPath,
  manifestPath,
  schemaPath,
  csvDir,
  writeEvidence = false,
  syncPlanHash = null,
} = {}) {
  const errors = [];
  const requireGate = (condition, code, message, details = {}) => {
    if (!condition) errors.push({ code, message, ...details });
  };
  const safeRunId = String(runId || '').trim();
  requireGate(/^[A-Za-z0-9_.-]+$/.test(safeRunId), 'DRY_RUN_ID_INVALID', 'Approved dry-run ID is missing or unsafe.', { runId: safeRunId });
  const runDir = path.join(path.resolve(outputRoot), safeRunId || '__missing__');
  const requiredFiles = ['summary.json', 'status.json', 'validation.json', 'reconciliation.json', 'fk_dependency_report.json'];
  for (const filename of requiredFiles) requireGate(fs.existsSync(path.join(runDir, filename)), 'DRY_RUN_EVIDENCE_MISSING', `Dry-run evidence is missing: ${filename}`, { filename, runDir });

  let contract = null, summary = null, status = null, validation = null, reconciliation = null, fkReport = null;
  try { contract = readJson(contractPath); } catch (error) { errors.push({ code: 'CONTRACT_READ_FAILED', message: error.message, contractPath }); }
  if (requiredFiles.every((filename) => fs.existsSync(path.join(runDir, filename)))) {
    try {
      summary = readJson(path.join(runDir, 'summary.json'));
      status = readJson(path.join(runDir, 'status.json'));
      validation = readJson(path.join(runDir, 'validation.json'));
      reconciliation = readJson(path.join(runDir, 'reconciliation.json'));
      fkReport = readJson(path.join(runDir, 'fk_dependency_report.json'));
    } catch (error) { errors.push({ code: 'DRY_RUN_EVIDENCE_PARSE_FAILED', message: error.message, runDir }); }
  }

  const allProfiles = contract ? (contract.import_order || (contract.profiles || []).map((profile) => profile.id)) : [];
  if (summary && status && contract) {
    requireGate((summary.syncPlanHash || null) === syncPlanHash, 'SYNC_PLAN_MISMATCH', 'Sync dry-run evidence is valid only for its exact sync plan; it cannot authorize a full migration.');
    requireGate(summary.runId === safeRunId, 'RUN_ID_MISMATCH', 'summary.json runId does not match the approved dry-run ID.', { actual: summary.runId });
    requireGate(summary.mode === 'dry-run', 'NOT_DRY_RUN', 'Accepted evidence must be a dry run.', { actual: summary.mode });
    requireGate(summary.status === 'completed' && status.status === 'completed', 'RUN_NOT_COMPLETED', 'Both summary and status must be completed.', { summaryStatus: summary.status, statusStatus: status.status });
    requireGate(summary.contractHash === contract.published_contract_sha256, 'CONTRACT_HASH_MISMATCH', 'Dry run did not use the current published contract.', { expected: contract.published_contract_sha256, actual: summary.contractHash });
    requireGate(summary.limit === null && Number(summary.offset || 0) === 0 && summary.unlimited === true, 'LIMIT_OR_OFFSET_USED', 'Accepted dry run must be unlimited with offset 0.', { limit: summary.limit, offset: summary.offset });
    requireGate(summary.requestedOnly === null || (Array.isArray(summary.requestedOnly) && summary.requestedOnly.length === 0), 'PROFILE_FILTER_USED', 'Accepted dry run must not use --only.', { requestedOnly: summary.requestedOnly });
    requireGate(sameSet(summary.selectedProfiles, allProfiles), 'NOT_ALL_PROFILES_SELECTED', 'Accepted dry run must select every contract profile.', { expected: allProfiles, actual: summary.selectedProfiles });
    requireGate(sameSet(summary.reconciliationProfiles, allProfiles), 'NOT_ALL_PROFILES_RECONCILED', 'Accepted dry run must reconcile every contract profile.', { expected: allProfiles, actual: summary.reconciliationProfiles });
    requireGate(summary.fullAllProfileDryRun === true && summary.allProfilesSelected === true && summary.allProfilesReconciled === true, 'FULL_DRY_RUN_FLAG_FALSE', 'Runtime did not certify this as a full all-profile dry run.');
    // Older single-process reports omitted the aggregate flag, although the
    // shared guarded connection was recorded in validation.json before profiles
    // ran. Accept that existing evidence only when no contrary flag or segmented
    // strategy is present. Segmented runs must still prove every child below.
    const legacySingleProcessDbProof = summary.dbBackedAllProfiles === undefined
      && summary.executionStrategy === undefined
      && Array.isArray(validation)
      && validation.some(row => row.level === 'info' && row.scope === 'db'
        && row.message === 'Connected to MySQL, passed database guard, and loaded live table columns.'
        && typeof row.database === 'string' && row.database.length > 0);
    requireGate(summary.dbBackedAllProfiles === true || legacySingleProcessDbProof, 'DRY_RUN_NOT_DB_BACKED', 'Accepted production dry run must prove a successful guarded MySQL connection for every profile.');
    if (['segmented-per-profile-process','segmented-per-profile-row-chunks'].includes(summary.executionStrategy)) {
      const indexPath = path.join(runDir, String(summary.segmentedEvidenceFile || 'segmented_dry_run_index.json'));
      requireGate(fs.existsSync(indexPath), 'SEGMENTED_DRY_RUN_INDEX_MISSING', 'Segmented full dry-run index is missing.', { indexPath });
      if (fs.existsSync(indexPath)) {
        try {
          const index = readJson(indexPath);
          requireGate(index.ok === true, 'SEGMENTED_DRY_RUN_INDEX_FAILED', 'Segmented full dry-run index is not PASS.');
          requireGate(index.executionStrategy === summary.executionStrategy, 'SEGMENTED_DRY_RUN_STRATEGY_MISMATCH', 'Segmented dry-run index strategy does not match summary.json.', { summary: summary.executionStrategy, index: index.executionStrategy });
          requireGate(sameSet((index.profiles || []).map((row) => row.profile), allProfiles), 'SEGMENTED_DRY_RUN_PROFILE_SET_MISMATCH', 'Segmented dry-run index does not contain exactly all contract profiles.');
          if (summary.executionStrategy === 'segmented-per-profile-row-chunks') requireGate(Number(index.chunkSize || 0) === 500, 'SEGMENTED_CHUNK_SIZE_INVALID', 'Resource-bounded full dry run must use 500-row chunks.', { actual: index.chunkSize });
          for (const profileId of allProfiles) {
            const segment = (index.profiles || []).find((row) => row.profile === profileId);
            requireGate(Boolean(segment), 'SEGMENT_MISSING', `Segment evidence missing for ${profileId}.`);
            if (!segment) continue;
            requireGate(segment.ok === true && Number(segment.exitCode) === 0 && segment.dbBacked === true, 'SEGMENT_NOT_ACCEPTED', `Segment ${profileId} was not a successful DB-backed dry run.`, { segment });
            const segmentSummaryPath = path.join(segment.outputDir || '', 'summary.json');
            requireGate(fs.existsSync(segmentSummaryPath), 'SEGMENT_SUMMARY_MISSING', `Segment summary missing for ${profileId}.`, { segmentSummaryPath });
            if (!fs.existsSync(segmentSummaryPath)) continue;
            const segmentSummaryHash = sha256File(segmentSummaryPath);
            requireGate(segmentSummaryHash === segment.summarySha256, 'SEGMENT_SUMMARY_HASH_MISMATCH', `Segment summary hash mismatch for ${profileId}.`, { expected: segment.summarySha256, actual: segmentSummaryHash });
            const segmentSummary = readJson(segmentSummaryPath);
            requireGate(segmentSummary.mode === 'dry-run' && segmentSummary.status === 'completed', 'SEGMENT_SUMMARY_NOT_COMPLETED', `Segment ${profileId} is not a completed dry run.`);
            requireGate(segmentSummary.limit === null && Number(segmentSummary.offset || 0) === 0 && segmentSummary.unlimited === true, 'SEGMENT_LIMIT_OR_OFFSET_USED', `Aggregated segment ${profileId} does not represent full source coverage.`);
            requireGate(sameSet(segmentSummary.selectedProfiles, [profileId]), 'SEGMENT_PROFILE_FILTER_MISMATCH', `Segment ${profileId} selected an unexpected profile set.`, { actual: segmentSummary.selectedProfiles });
            const segmentRecon = readJson(path.join(path.dirname(segmentSummaryPath), 'reconciliation.json'));
            const reconRow = segmentRecon?.[profileId];
            requireGate(Boolean(reconRow), 'SEGMENT_RECONCILIATION_MISSING', `Segment reconciliation missing for ${profileId}.`);
            if (reconRow) requireGate(Number(reconRow.processedRows || 0) === Number(reconRow.sourceRows || 0) && Number(reconRow.rejectedRows || 0) === 0 && Number(reconRow.rolledBackRows || 0) === 0, 'SEGMENT_RECONCILIATION_FAILED', `Segment reconciliation failed for ${profileId}.`, { reconRow });
            if (segment.chunked === true) verifyChunkedSegment({ segment, profileId, segmentSummary, runDir, requireGate });
            else if (summary.executionStrategy === 'segmented-per-profile-row-chunks') requireGate(!['loom','folding','greige-delivery'].includes(profileId), 'EXPECTED_CHUNKED_PROFILE_NOT_CHUNKED', `Heavy profile ${profileId} was not executed in bounded chunks.`);
          }
        } catch (error) {
          errors.push({ code: 'SEGMENTED_DRY_RUN_INDEX_PARSE_FAILED', message: error.message, indexPath });
        }
      }
    }
    for (const field of ['validationErrors', 'requiredLookupMisses', 'criticalLookupMisses', 'rejectedRows', 'fkDependencyFailures']) {
      requireGate(Number(summary[field] || 0) === 0, `NONZERO_${field.toUpperCase()}`, `${field} must be zero.`, { actual: summary[field] });
    }
    requireGate(Array.isArray(validation) && validation.every((row) => row.level !== 'error'), 'VALIDATION_REPORT_FAILED', 'validation.json contains an error or is not an array.');
    requireGate(Array.isArray(fkReport) && fkReport.every((row) => row.ok !== false), 'FK_REPORT_FAILED', 'Every FK dependency report row must pass.');
    requireGate(reconciliation && typeof reconciliation === 'object' && !Array.isArray(reconciliation), 'RECONCILIATION_INVALID', 'reconciliation.json must be an object keyed by profile.');
    if (reconciliation && typeof reconciliation === 'object' && !Array.isArray(reconciliation)) {
      for (const profileId of allProfiles) {
        const row = reconciliation[profileId];
        requireGate(Boolean(row), 'PROFILE_RECONCILIATION_MISSING', `Reconciliation missing for ${profileId}.`);
        if (!row) continue;
        requireGate(Number(row.processedRows || 0) === Number(row.sourceRows || 0), 'PROFILE_NOT_FULLY_PROCESSED', `Profile ${profileId} did not process all source rows.`, { sourceRows: row.sourceRows, processedRows: row.processedRows });
        requireGate(Number(row.rejectedRows || 0) === 0 && Number(row.rolledBackRows || 0) === 0, 'PROFILE_RECONCILIATION_FAILURE', `Profile ${profileId} has rejected or rolled-back rows.`, { rejectedRows: row.rejectedRows, rolledBackRows: row.rolledBackRows });
      }
    }
    requireGate(fs.existsSync(manifestPath), 'APPROVED_MANIFEST_MISSING', 'Approved source manifest is missing.', { manifestPath });
    if (fs.existsSync(manifestPath)) {
      const manifestHash = sha256File(manifestPath);
      requireGate(summary.sourceManifestFileSha256 === manifestHash, 'DRY_RUN_MANIFEST_HASH_MISMATCH', 'Dry-run source manifest differs from the current approved manifest.', { expected: manifestHash, actual: summary.sourceManifestFileSha256 });
      const findings = validateManifest({ manifestPath, csvDir, contract, schemaPath, requireApproved: true });
      for (const finding of findings.filter((row) => row.level === 'error')) errors.push({ code: `MANIFEST_${finding.code}`, message: finding.message, finding });
    }
  }

  const evidence = {
    verification_version: '3.2.3-hybrid', verified_at: new Date().toISOString(), ok: errors.length === 0,
    runId: safeRunId, runDir, contractHash: contract?.published_contract_sha256 || null,
    sourceManifestSha256: fs.existsSync(manifestPath) ? sha256File(manifestPath) : null,
    allProfiles, errors,
  };
  if (writeEvidence && fs.existsSync(runDir)) fs.writeFileSync(path.join(runDir, 'full_dry_run_acceptance.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidence;
}

module.exports = { verifyFullDryRunEvidence, sameSet };
