'use strict';

const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false }); } catch (_error) {}
const { forEachSourceObject, normalizeMatchText, parseDate, cleanText } = require('../../lib/source_index');

function args(argv) { const out = {}; for (const item of argv) { if (!item.startsWith('--')) continue; const [k, ...rest] = item.slice(2).split('='); out[k] = rest.length ? rest.join('=') : true; } return out; }
const options = args(process.argv.slice(2));
const root = path.resolve(__dirname, '../..');
const profileId = String(options.profile || '').trim();
const contractPath = path.resolve(options.contract || process.env.MAPPING_CONTRACT_FILE || path.join(root, 'mappings/mapping-contract-v2.json'));
const manifestPath = path.resolve(options.manifest || process.env.SOURCE_MANIFEST_FILE || path.join(root, 'source-manifest.json'));
const csvDir = path.resolve(options['csv-dir'] || process.env.CSV_DIR || path.join(root, 'csv_files'));
const dateOrder = String(process.env.CSV_DATE_ORDER || 'dmy').toLowerCase();
const chunkSize = Number(options['chunk-size'] || 500);
const dryRunId = String(options['dry-run-id'] || process.env.APPROVED_DRY_RUN_ID || '').trim();
const outputRoot = path.resolve(options['output-root'] || process.env.CLI_CONTRACT_OUTPUT_ROOT || path.join(root, 'output/mapping_contract_v2'));

const allowed = new Set(['loom','folding','greige-delivery']);
if (!allowed.has(profileId)) throw new Error(`Live chunk safety verifier only supports resource-heavy profiles: ${[...allowed].join(', ')}`);
if (chunkSize !== 500) throw new Error(`Live chunk safety requires chunk-size=500; got ${chunkSize}.`);
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const profile = (contract.profiles || []).find((p) => p.id === profileId);
if (!profile) throw new Error(`Profile not found in contract: ${profileId}`);
const manifestEntry = (manifest.files || []).find((row) => row.filename === profile.source_file);
if (!manifestEntry) throw new Error(`Approved manifest does not list ${profile.source_file}.`);
const expectedRows = Number(manifestEntry.nonempty_rows);
if (!Number.isFinite(expectedRows) || expectedRows < 0) throw new Error(`Invalid approved row count for ${profile.source_file}.`);

const sourcePath = path.resolve(csvDir, profile.source_file);
if (!fs.existsSync(sourcePath)) throw new Error(`Certified source file missing: ${sourcePath}`);
const errors = [];
let duplicateNaturalKeys = 0;
let missingNaturalKeys = 0;
let checkedKeys = 0;
const seen = new Set();
let meta;

if (profileId === 'loom' || profileId === 'folding') {
  const dateField = profileId === 'loom' ? 'Weaving Dates' : 'Folding Production Date';
  meta = forEachSourceObject(sourcePath, (row) => {
    const dispo = normalizeMatchText(row['Dispo No']);
    const date = parseDate(row[dateField], dateOrder);
    if (!dispo || !date) { missingNaturalKeys += 1; return true; }
    const key = `${dispo}|${date}`;
    checkedKeys += 1;
    if (seen.has(key)) duplicateNaturalKeys += 1;
    else seen.add(key);
    return true;
  });
  if (missingNaturalKeys) errors.push({ code: 'CHUNK_LIVE_NATURAL_KEY_MISSING', profile: profileId, count: missingNaturalKeys });
  if (duplicateNaturalKeys) errors.push({ code: 'CHUNK_LIVE_NATURAL_KEY_DUPLICATE', profile: profileId, count: duplicateNaturalKeys, message: 'Chunk boundaries are unsafe when a non-provenance parent natural key repeats across source rows.' });
} else {
  meta = forEachSourceObject(sourcePath, () => true);
  const policyPath = path.join(root, 'config/provenance_policy.v3.2.3.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const parentTable = profile.tables?.[0]?.name || null;
  const provenanceTables = policy.profiles?.[profileId] || [];
  if (!parentTable || !provenanceTables.includes(parentTable)) errors.push({ code: 'CHUNK_LIVE_PROVENANCE_PARENT_REQUIRED', profile: profileId, parentTable, provenanceTables });
}

const actualRows = Number(meta?.nonempty_rows || 0);
if (actualRows !== expectedRows) errors.push({ code: 'CHUNK_LIVE_SOURCE_ROW_COUNT_MISMATCH', profile: profileId, expected: expectedRows, actual: actualRows });
let dryRunChunkEvidence = null;
if (!dryRunId) errors.push({ code: 'CHUNK_LIVE_DRY_RUN_ID_MISSING', profile: profileId });
else {
  const indexPath = path.join(outputRoot, dryRunId, 'segmented_dry_run_index.json');
  if (!fs.existsSync(indexPath)) errors.push({ code: 'CHUNK_LIVE_DRY_RUN_INDEX_MISSING', profile: profileId, indexPath });
  else {
    const dryIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const segment = (dryIndex.profiles || []).find((row) => row.profile === profileId);
    dryRunChunkEvidence = segment || null;
    if (dryIndex.ok !== true || dryIndex.executionStrategy !== 'segmented-per-profile-row-chunks') errors.push({ code: 'CHUNK_LIVE_DRY_RUN_STRATEGY_INVALID', profile: profileId, executionStrategy: dryIndex.executionStrategy, ok: dryIndex.ok });
    if (!segment || segment.chunked !== true || Number(segment.chunkSize || 0) !== chunkSize) errors.push({ code: 'CHUNK_LIVE_DRY_RUN_PROFILE_NOT_CHUNKED', profile: profileId, segment });
    else if (Number(segment.sourceRows || 0) !== expectedRows || Number(segment.processedRows || 0) !== expectedRows) errors.push({ code: 'CHUNK_LIVE_DRY_RUN_ROW_TOTAL_MISMATCH', profile: profileId, expectedRows, segmentSourceRows: segment.sourceRows, segmentProcessedRows: segment.processedRows });
  }
}
const result = {
  ok: errors.length === 0,
  verifierVersion: '3.2.3-live-chunk-safety-20260816',
  profile: profileId,
  sourceFile: profile.source_file,
  expectedRows,
  actualRows,
  chunkSize,
  chunkCount: Math.ceil(expectedRows / chunkSize),
  checkedNaturalKeys: checkedKeys,
  duplicateNaturalKeys,
  missingNaturalKeys,
  provenanceBackedParent: profileId === 'greige-delivery',
  dryRunId: dryRunId || null,
  dryRunChunkEvidence: dryRunChunkEvidence ? { chunked: dryRunChunkEvidence.chunked, chunkSize: dryRunChunkEvidence.chunkSize, chunkCount: dryRunChunkEvidence.chunkCount, sourceRows: dryRunChunkEvidence.sourceRows, processedRows: dryRunChunkEvidence.processedRows } : null,
  errors,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
