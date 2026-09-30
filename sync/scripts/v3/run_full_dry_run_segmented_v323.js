'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false }); } catch (_error) {}
const { aggregateChunkedProfile, sameSet, addCounters, dbBacked, sha256File, readJson, writeJson } = require('../../lib/chunked_profile_evidence');

let consolePipeBroken = false;
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (error) => {
    if (error?.code === 'EPIPE') { consolePipeBroken = true; return; }
    throw error;
  });
}
function out(text) { if (!consolePipeBroken) process.stdout.write(text); }
function err(text) { if (!consolePipeBroken) process.stderr.write(text); }

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    out[key] = rest.length ? rest.join('=') : true;
  }
  return out;
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function safeName(value) { return String(value).replace(/[^A-Za-z0-9_.-]+/g, '_'); }
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
function runChild(nodeBin, nodeHeapMb, importPath, args, cwd, logPath, { mirror = true } = {}) {
  return new Promise((resolve, reject) => {
    const log = fs.createWriteStream(logPath, { flags: 'w', mode: 0o600 });
    const child = spawn(nodeBin, [`--max-old-space-size=${nodeHeapMb}`, importPath, ...args], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { if (mirror) out(chunk); log.write(chunk); });
    child.stderr.on('data', (chunk) => { if (mirror) err(chunk); log.write(chunk); });
    child.on('error', (error) => { log.end(); reject(error); });
    child.on('close', (code, signal) => { log.end(); resolve({ code: code ?? 1, signal: signal || null }); });
  });
}
function mergeFk(target, rows) {
  for (const row of rows || []) {
    const key = [row.constraint,row.child_table,row.child_field,row.parent_table,row.parent_field].join('|');
    if (!target.has(key)) target.set(key, row);
  }
}
function manifestRowsForProfile(manifest, profile) {
  const entry = (manifest.files || []).find((row) => row.filename === profile.source_file);
  const rows = Number(entry?.nonempty_rows);
  if (!entry || !Number.isFinite(rows) || rows < 0) throw new Error(`Approved manifest is missing a valid nonempty_rows count for ${profile.id}/${profile.source_file}.`);
  return rows;
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve(__dirname, '..', '..');
  const runId = safeName(options['run-id'] || `prod_full_dry_${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`);
  const outputRoot = path.resolve(options['output-root'] || process.env.CLI_CONTRACT_OUTPUT_ROOT || path.join(root, 'output', 'mapping_contract_v2'));
  const runDir = path.join(outputRoot, runId);
  const contractPath = path.resolve(options.contract || process.env.MAPPING_CONTRACT_FILE || path.join(root, 'mappings', 'mapping-contract-v2.json'));
  const manifestPath = path.resolve(options.manifest || process.env.SOURCE_MANIFEST_FILE || path.join(root, 'source-manifest.json'));
  const schemaPath = path.resolve(options.schema || path.join(root, 'schema', 'weavonpq_weaving.schema.json'));
  const csvDir = path.resolve(options['csv-dir'] || process.env.CSV_DIR || path.join(root, 'csv_files'));
  const nodeHeapMb = Math.max(192, Number(options['node-heap-mb'] || process.env.V323_NODE_HEAP_MB || 256) || 256);
  const chunkSize = Number(options['chunk-size'] || 500);
  if (chunkSize !== 500) throw new Error(`This production resource-bound release requires chunk-size=500; received ${chunkSize}.`);
  const importPath = path.join(root, 'import.js');
  const nodeBin = process.execPath;

  if (fs.existsSync(runDir)) throw new Error(`Refusing to reuse existing full dry-run directory: ${runDir}`);
  ensureDir(runDir);
  ensureDir(path.join(runDir, 'profiles'));

  const contract = readJson(contractPath);
  const manifest = readJson(manifestPath);
  const allProfiles = contract.import_order || (contract.profiles || []).map((p) => p.id);
  const required = ['pre-costing-bootstrap','po','dispo','yarn-receive','yarn-issue','warping','sizing','loom','folding','greige-delivery'];
  if (!sameSet(allProfiles, required) || allProfiles.length !== required.length) throw new Error(`Unexpected production profile set: ${JSON.stringify(allProfiles)}`);
  const chunkProfiles = new Set(['loom','folding','greige-delivery']);
  const manifestSha256 = sha256File(manifestPath);
  const provenancePolicyVersion = readJson(path.join(root, 'config/provenance_policy.v3.2.3.json')).policy_version || null;

  const index = {
    version: '3.2.3-segmented-row-chunks-20260816',
    runId,
    generatedAt: new Date().toISOString(),
    executionStrategy: 'segmented-per-profile-row-chunks',
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
  writeJson(path.join(runDir, 'segmented_dry_run_index.json'), index);

  const mergedValidation = [];
  const mergedReconciliation = {};
  const mergedStats = {};
  const mergedRejected = [];
  const mergedLookupMisses = [];
  const mergedFk = new Map();
  let totalPreview = 0;
  let totalValidationWarnings = 0;
  let totalValidationErrors = 0;
  let totalRequiredLookupMisses = 0;
  let totalCriticalLookupMisses = 0;
  let totalRejected = 0;
  let totalLookupMisses = 0;
  let reviewedPendingManifestSha256 = null;
  let sourceManifestFileSha256 = null;

  for (let i = 0; i < allProfiles.length; i += 1) {
    const profileId = allProfiles[i];
    const profile = (contract.profiles || []).find((p) => p.id === profileId);
    if (!profile) throw new Error(`Contract profile missing: ${profileId}`);
    const profileDir = path.join(runDir, 'profiles', `${String(i + 1).padStart(2, '0')}_${safeName(profileId)}`);
    ensureDir(profileDir);
    out(`\n============================================================\nSegmented full dry run ${i + 1}/${allProfiles.length}: ${profileId}\n============================================================\n`);

    let profileEvidence;
    if (chunkProfiles.has(profileId)) {
      const sourceRows = manifestRowsForProfile(manifest, profile);
      const chunkCount = Math.ceil(sourceRows / chunkSize);
      const chunksDir = path.join(profileDir, 'chunks');
      ensureDir(chunksDir);
      const chunks = [];
      out(`Resource-bounded mode: ${profileId} will process ${sourceRows} source rows in ${chunkCount} chunks of at most ${chunkSize} rows.\n`);
      for (let chunkIndex = 0, offset = 0; offset < sourceRows; chunkIndex += 1, offset += chunkSize) {
        const limit = Math.min(chunkSize, sourceRows - offset);
        const chunkDir = path.join(chunksDir, `${String(chunkIndex + 1).padStart(4, '0')}_offset_${String(offset).padStart(9, '0')}`);
        ensureDir(chunkDir);
        const childRunId = `${runId}__${safeName(profileId)}__chunk_${String(chunkIndex + 1).padStart(4, '0')}`;
        const logPath = path.join(chunkDir, 'terminal.log');
        const childArgs = [
          '--dry-run',
          `--contract=${contractPath}`,
          `--run-id=${childRunId}`,
          `--output-dir=${chunkDir}`,
          `--only=${profileId}`,
          `--offset=${offset}`,
          `--limit=${limit}`,
          '--scope-source-index',
          '--chunk-wrapper',
          `--prevalidated-manifest-sha256=${manifestSha256}`,
        ];
        const child = await runChild(nodeBin, nodeHeapMb, importPath, childArgs, root, logPath, { mirror: false });
        if (child.code !== 0) {
          index.profiles.push({ profile: profileId, chunked: true, failedChunk: chunkIndex + 1, failedOffset: offset, exitCode: child.code, signal: child.signal, ok: false, dbBacked: false, outputDir: profileDir });
          index.failedProfile = profileId;
          index.failedChunk = chunkIndex + 1;
          index.failedExitCode = child.code;
          index.failedSignal = child.signal;
          writeJson(path.join(runDir, 'segmented_dry_run_index.json'), index);
          throw new Error(`Chunked dry-run failed: ${profileId} chunk ${chunkIndex + 1}/${chunkCount}; offset=${offset}; limit=${limit}; exit=${child.code}; signal=${child.signal || 'none'}. See ${logPath}`);
        }
        chunks.push({ offset, limit, outputDir: chunkDir, terminalLog: logPath, exitCode: child.code, signal: child.signal });
        if (chunkIndex === 0 || (chunkIndex + 1) % 10 === 0 || chunkIndex + 1 === chunkCount) {
          out(`  ${profileId} chunk ${chunkIndex + 1}/${chunkCount} PASS (offset=${offset}, rows=${limit})\n`);
        }
      }
      const aggregated = aggregateChunkedProfile({
        profile: profileId,
        profileDir,
        runId,
        contract,
        contractPath,
        csvDir,
        manifestPath,
        manifestSha256,
        expectedSourceRows: sourceRows,
        chunkSize,
        chunks,
        provenancePolicyVersion,
      });
      profileEvidence = aggregated.profileEvidence;
      out(`  ${profileId} FULL PROFILE PASS: ${profileEvidence.processedRows}/${profileEvidence.sourceRows} rows across ${profileEvidence.chunkCount} chunks.\n`);
    } else {
      const childRunId = `${runId}__${safeName(profileId)}`;
      const logPath = path.join(profileDir, 'terminal.log');
      const childArgs = [
        '--dry-run',
        `--contract=${contractPath}`,
        `--run-id=${childRunId}`,
        `--output-dir=${profileDir}`,
        `--only=${profileId}`,
      ];
      const child = await runChild(nodeBin, nodeHeapMb, importPath, childArgs, root, logPath, { mirror: true });
      profileEvidence = { profile: profileId, childRunId, outputDir: profileDir, terminalLog: logPath, exitCode: child.code, signal: child.signal, ok: false, dbBacked: false, chunked: false };
      if (child.code !== 0) {
        index.profiles.push(profileEvidence);
        index.failedProfile = profileId;
        index.failedExitCode = child.code;
        index.failedSignal = child.signal;
        writeJson(path.join(runDir, 'segmented_dry_run_index.json'), index);
        throw new Error(`Segmented dry-run profile failed: ${profileId}; exit=${child.code}; signal=${child.signal || 'none'}. See ${logPath}`);
      }
    }

    for (const filename of ['summary.json','status.json','validation.json','reconciliation.json','fk_dependency_report.json']) {
      if (!fs.existsSync(path.join(profileDir, filename))) throw new Error(`Profile ${profileId} did not produce ${filename}`);
    }
    const summary = readJson(path.join(profileDir, 'summary.json'));
    const status = readJson(path.join(profileDir, 'status.json'));
    const validation = readJson(path.join(profileDir, 'validation.json'));
    const reconciliation = readJson(path.join(profileDir, 'reconciliation.json'));
    const fkReport = readJson(path.join(profileDir, 'fk_dependency_report.json'));

    const isDbBacked = dbBacked(validation);
    const localErrors = [];
    if (summary.mode !== 'dry-run') localErrors.push('not-dry-run');
    if (summary.status !== 'completed' || status.status !== 'completed') localErrors.push('not-completed');
    if (summary.limit !== null || Number(summary.offset || 0) !== 0 || summary.unlimited !== true) localErrors.push('limited');
    if (!sameSet(summary.selectedProfiles, [profileId])) localErrors.push('profile-selection-mismatch');
    if (!reconciliation[profileId]) localErrors.push('reconciliation-missing');
    if (reconciliation[profileId] && Number(reconciliation[profileId].processedRows || 0) !== Number(reconciliation[profileId].sourceRows || 0)) localErrors.push('not-fully-processed');
    if (Number(summary.validationErrors || 0) !== 0) localErrors.push('validation-errors');
    if (Number(summary.requiredLookupMisses || 0) !== 0) localErrors.push('required-lookup-misses');
    if (Number(summary.criticalLookupMisses || 0) !== 0) localErrors.push('critical-lookup-misses');
    if (Number(summary.rejectedRows || 0) !== 0) localErrors.push('rejected-rows');
    if (Number(summary.fkDependencyFailures || 0) !== 0) localErrors.push('fk-failures');
    if (!isDbBacked) localErrors.push('not-db-backed');
    if (summary.contractHash !== contract.published_contract_sha256) localErrors.push('contract-hash-mismatch');
    if (summary.sourceManifestFileSha256 !== index.manifestSha256) localErrors.push('manifest-hash-mismatch');
    if (localErrors.length) throw new Error(`Profile ${profileId} failed segmented acceptance: ${localErrors.join(', ')}`);

    profileEvidence.ok = true;
    profileEvidence.dbBacked = isDbBacked;
    profileEvidence.summarySha256 = sha256File(path.join(profileDir, 'summary.json'));
    profileEvidence.statusSha256 = sha256File(path.join(profileDir, 'status.json'));
    profileEvidence.validationSha256 = sha256File(path.join(profileDir, 'validation.json'));
    profileEvidence.reconciliationSha256 = sha256File(path.join(profileDir, 'reconciliation.json'));
    profileEvidence.fkDependencyReportSha256 = sha256File(path.join(profileDir, 'fk_dependency_report.json'));
    profileEvidence.sourceRows = Number(reconciliation[profileId]?.sourceRows || 0);
    profileEvidence.processedRows = Number(reconciliation[profileId]?.processedRows || 0);
    index.profiles.push(profileEvidence);
    writeJson(path.join(runDir, 'segmented_dry_run_index.json'), index);

    for (const row of validation) mergedValidation.push({ segment_profile: profileId, ...row });
    mergedReconciliation[profileId] = reconciliation[profileId];
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
    reviewedPendingManifestSha256 ||= summary.reviewedPendingManifestSha256 || null;
    sourceManifestFileSha256 ||= summary.sourceManifestFileSha256 || null;
  }

  index.ok = index.profiles.length === allProfiles.length && index.profiles.every((p) => p.ok && p.dbBacked);
  index.completedAt = new Date().toISOString();
  writeJson(path.join(runDir, 'segmented_dry_run_index.json'), index);

  const summary = {
    runId,
    status: 'completed',
    generatedAt: new Date().toISOString(),
    mode: 'dry-run',
    executionStrategy: 'segmented-per-profile-row-chunks',
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
    rejectedRowsDetailed: mergedRejected.length,
    rejectedRowsOmitted: 0,
    lookupMisses: totalLookupMisses,
    lookupMissesDetailed: mergedLookupMisses.length,
    lookupMissesOmitted: totalLookupMisses,
    requiredLookupMisses: totalRequiredLookupMisses,
    criticalLookupMisses: totalCriticalLookupMisses,
    previewRows: totalPreview,
    previewRowsDetailed: 0,
    previewRowsOmitted: totalPreview,
    fkDependencyFailures: [...mergedFk.values()].filter((row) => row.ok === false).length,
    transactionScope: 'source-row/logical-unit + source-uid provenance',
    provenancePolicyVersion,
    outputDir: runDir,
  };
  const status = {
    status: 'completed', runId, mode: 'dry-run', contractHash: summary.contractHash,
    processed: Object.values(mergedReconciliation).reduce((a, r) => a + Number(r.processedRows || 0), 0),
    total: Object.values(mergedReconciliation).reduce((a, r) => a + Number(r.sourceRows || 0), 0),
    inserted: 0, updated: 0, rejected: totalRejected, rolledBack: 0,
    message: 'Segmented full, unlimited, all-profile DB-backed dry run completed successfully with 500-row resource-bounded execution for heavy profiles.',
    stats: mergedStats, updatedAt: new Date().toISOString(),
  };

  writeJson(path.join(runDir, 'summary.json'), summary);
  writeJson(path.join(runDir, 'status.json'), status);
  writeJson(path.join(runDir, 'validation.json'), mergedValidation);
  writeJson(path.join(runDir, 'reconciliation.json'), mergedReconciliation);
  writeJson(path.join(runDir, 'fk_dependency_report.json'), [...mergedFk.values()]);
  fs.writeFileSync(path.join(runDir, 'rejected_rows.csv'), rowsToCsv(mergedRejected), 'utf8');
  fs.writeFileSync(path.join(runDir, 'lookup_misses.csv'), rowsToCsv(mergedLookupMisses), 'utf8');
  fs.writeFileSync(path.join(runDir, 'row_preview.csv'), '', 'utf8');
  fs.writeFileSync(path.join(runDir, 'README.md'), `# v3.2.3 resource-bounded full dry run\n\nRun ID: ${runId}\nProfiles: ${allProfiles.join(', ')}\nDB-backed all profiles: ${summary.dbBackedAllProfiles}\nHeavy profiles (${[...chunkProfiles].join(', ')}) were executed in ordered 500-row child processes. Each bounded child scoped immutable source indexes to the Dispos in that chunk while retaining complete cross-source history for those Dispos. The aggregate evidence proves contiguous source coverage from offset 0 through the approved manifest row count.\n`, 'utf8');

  out(`${JSON.stringify({ ok: true, runId, runDir, executionStrategy: summary.executionStrategy, chunkSize, dbBackedAllProfiles: summary.dbBackedAllProfiles, profiles: index.profiles.map((p) => ({ profile: p.profile, chunked: p.chunked, chunkCount: p.chunkCount || 1, exitCode: p.exitCode, dbBacked: p.dbBacked, sourceRows: p.sourceRows, processedRows: p.processedRows })) }, null, 2)}\n`);
})().catch((error) => {
  err(`${error && error.stack ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
