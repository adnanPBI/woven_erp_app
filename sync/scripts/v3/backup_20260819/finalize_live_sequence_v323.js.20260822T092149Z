'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false }); } catch (_e) {}

function args(argv) {
  const o = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, ...r] = a.slice(2).split('=');
    o[k] = r.length ? r.join('=') : true;
  }
  return o;
}
function read(f) { return JSON.parse(fs.readFileSync(f, 'utf8')); }
function sha(f) { return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'); }

const o = args(process.argv.slice(2));
const root = path.resolve(__dirname, '../..');
const seq = String(o['sequence-id'] || process.env.V323_LIVE_SEQUENCE_ID || '');
const liveRoot = path.resolve(String(
  o['live-root'] || path.join(
    process.env.CLI_CONTRACT_OUTPUT_ROOT || path.join(root, 'output/mapping_contract_v2'),
    'live_resumable',
    seq
  )
));
const manifest = path.resolve(process.env.SOURCE_MANIFEST_FILE || path.join(root, 'source-manifest.json'));
const contract = path.resolve(process.env.MAPPING_CONTRACT_FILE || path.join(root, 'mappings/mapping-contract-v2.json'));
const dry = String(o['dry-run-id'] || process.env.APPROVED_DRY_RUN_ID || '');

if (!seq) throw new Error('sequence-id is required');
if (!dry) throw new Error('dry-run-id is required');
if (!fs.existsSync(manifest)) throw new Error(`manifest missing: ${manifest}`);
if (!fs.existsSync(contract)) throw new Error(`contract missing: ${contract}`);

const m = read(manifest);
const c = read(contract);
const manifestSha = sha(manifest);

const profiles = [
  'pre-costing-bootstrap',
  'po',
  'dispo',
  'yarn-receive',
  'yarn-issue',
  'warping',
  'sizing',
  'loom',
  'folding',
  'greige-delivery'
];

// MUST match run_production_sequence_resumable_v323.sh from the
// remaining-profiles chunk500 patch. Only the first two profiles are unchunked.
const chunked = new Set([
  'dispo',
  'yarn-receive',
  'yarn-issue',
  'warping',
  'sizing',
  'loom',
  'folding',
  'greige-delivery'
]);

const rows = [];
const errors = [];

for (let i = 0; i < profiles.length; i += 1) {
  const p = profiles[i];
  const cp = (c.profiles || []).find(x => x.id === p);
  const me = (m.files || []).find(x => x.filename === cp?.source_file);
  const expected = Number(me?.nonempty_rows);
  const dir = path.join(liveRoot, 'profiles', `${String(i + 1).padStart(2, '0')}_${p}`);

  if (!Number.isFinite(expected) || expected < 0) {
    errors.push(`${p}:invalid-approved-source-row-count`);
    continue;
  }

  if (chunked.has(p)) {
    const f = path.join(dir, 'live_chunk_index.json');
    if (!fs.existsSync(f)) {
      errors.push(`${p}:missing-live_chunk_index`);
      continue;
    }

    const j = read(f);
    const expectedChunkCount = Math.ceil(expected / 500);

    if (
      j.ok !== true ||
      j.profile !== p ||
      Number(j.sourceRows) !== expected ||
      Number(j.processedRows) !== expected ||
      Number(j.chunkSize) !== 500 ||
      Number(j.chunkCount) !== expectedChunkCount ||
      j.manifestSha256 !== manifestSha ||
      j.approvedDryRunId !== dry
    ) {
      errors.push(`${p}:aggregate-binding-or-coverage-failure`);
    }

    if (
      Number(j.totals?.processed || 0) !== expected ||
      Number(j.totals?.rejected || 0) !== 0 ||
      Number(j.totals?.rolled_back || 0) !== 0 ||
      Number(j.totals?.errors || 0) !== 0
    ) {
      errors.push(`${p}:aggregate-blocking-findings`);
    }

    if (!Array.isArray(j.chunks) || j.chunks.length !== expectedChunkCount || !j.chunks.every(x => x && x.ok === true)) {
      errors.push(`${p}:aggregate-chunk-index-incomplete`);
    }

    rows.push({
      profile: p,
      chunked: true,
      chunkSize: 500,
      chunkCount: expectedChunkCount,
      sourceRows: expected,
      processedRows: Number(j.processedRows || 0),
      evidencePath: f,
      evidenceSha256: sha(f)
    });
  } else {
    const f = path.join(dir, 'summary.json');
    if (!fs.existsSync(f)) {
      errors.push(`${p}:missing-summary`);
      continue;
    }

    const s = read(f);
    const reconciliationPath = path.join(dir, 'reconciliation.json');
    if (!fs.existsSync(reconciliationPath)) {
      errors.push(`${p}:missing-reconciliation`);
      continue;
    }
    const r = read(reconciliationPath)?.[p];

    if (
      s.mode !== 'live' ||
      s.status !== 'completed' ||
      s.sourceManifestFileSha256 !== manifestSha ||
      s.approvedDryRunId !== dry ||
      Number(s.validationErrors || 0) !== 0 ||
      Number(s.requiredLookupMisses || 0) !== 0 ||
      Number(s.criticalLookupMisses || 0) !== 0 ||
      Number(s.rejectedRows || 0) !== 0 ||
      Number(s.fkDependencyFailures || 0) !== 0 ||
      !r ||
      Number(r.processedRows || 0) !== expected ||
      Number(r.rejectedRows || 0) !== 0 ||
      Number(r.rolledBackRows || 0) !== 0
    ) {
      errors.push(`${p}:profile-evidence-failure`);
    }

    rows.push({
      profile: p,
      chunked: false,
      sourceRows: expected,
      processedRows: r ? Number(r.processedRows || 0) : null,
      evidencePath: f,
      evidenceSha256: sha(f)
    });
  }
}

const result = {
  ok: errors.length === 0,
  version: '3.2.3-live-resumable-sequence-all-chunk500-20260819',
  sequenceId: seq,
  dryRunId: dry,
  dbName: process.env.DB_NAME || null,
  manifestSha256: manifestSha,
  contractFileSha256: sha(contract),
  profiles: rows,
  errors,
  completedAt: new Date().toISOString()
};

fs.mkdirSync(liveRoot, { recursive: true });
const out = path.join(liveRoot, 'live_sequence_acceptance.json');
fs.writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...result, acceptancePath: out }, null, 2));
if (!result.ok) process.exit(1);
