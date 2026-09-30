'use strict';

const fs = require('fs');
const path = require('path');
const {
  aggregateChunkedProfile,
  sha256File,
  readJson,
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

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname, '..', '..');
const profile = String(options.profile || '').trim();
const profileDir = path.resolve(options['profile-dir'] || '');
const runId = String(options['run-id'] || '').trim();
const contractPath = path.resolve(options.contract || process.env.MAPPING_CONTRACT_FILE || path.join(root, 'mappings', 'mapping-contract-v2.json'));
const manifestPath = path.resolve(options.manifest || process.env.SOURCE_MANIFEST_FILE || path.join(root, 'source-manifest.json'));
const csvDir = path.resolve(options['csv-dir'] || process.env.CSV_DIR || path.join(root, 'csv_files'));
const sourceRows = Number(options['source-rows']);
const chunkSize = Number(options['chunk-size'] || process.env.V323_CHUNK_ROWS || 500);

if (!['loom', 'folding', 'greige-delivery'].includes(profile)) throw new Error(`Unsupported chunked dry-run profile: ${profile}`);
if (!profileDir || !runId || !Number.isFinite(sourceRows) || sourceRows < 0) throw new Error('Usage: --profile --profile-dir --run-id --source-rows --chunk-size=500');
if (chunkSize !== 500) throw new Error(`Production chunk size must be 500; got ${chunkSize}`);

const contract = readJson(contractPath);
const manifestSha256 = sha256File(manifestPath);
const provenancePolicyVersion = readJson(path.join(root, 'config', 'provenance_policy.v3.2.3.json')).policy_version || null;
const chunksDir = path.join(profileDir, 'chunks');
const chunkCount = Math.ceil(sourceRows / chunkSize);
const chunks = [];

let offset = 0;
for (let i = 0; i < chunkCount; i += 1) {
  const limit = Math.min(chunkSize, sourceRows - offset);
  const chunkDir = path.join(chunksDir, `${String(i + 1).padStart(4, '0')}_offset_${String(offset).padStart(9, '0')}`);
  const terminalLog = path.join(chunkDir, 'terminal.log');
  if (!fs.existsSync(chunkDir)) throw new Error(`Missing dry-run chunk directory: ${chunkDir}`);
  if (!fs.existsSync(terminalLog)) throw new Error(`Missing dry-run chunk terminal log: ${terminalLog}`);
  chunks.push({ offset, limit, outputDir: chunkDir, terminalLog, exitCode: 0, signal: null });
  offset += limit;
}

const aggregated = aggregateChunkedProfile({
  profile,
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

process.stdout.write(`${JSON.stringify({
  ok: true,
  profile,
  sourceRows,
  processedRows: aggregated.profileEvidence.processedRows,
  chunkSize,
  chunkCount: aggregated.profileEvidence.chunkCount,
  chunkIndexSha256: aggregated.profileEvidence.chunkIndexSha256,
  profileDir,
}, null, 2)}\n`);
