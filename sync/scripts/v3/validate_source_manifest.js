'use strict';

const fs = require('fs');
const path = require('path');
const { validateManifest } = require('../../lib/source_manifest');

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const eq = item.indexOf('=');
    if (eq >= 0) out[item.slice(2, eq)] = item.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[item.slice(2)] = argv[++i];
    else out[item.slice(2)] = true;
  }
  return out;
}
function decodeEnvValue(value) {
  let v = String(value ?? '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}
function loadEnvNoOverride(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    if (Object.prototype.hasOwnProperty.call(process.env, key)) continue;
    process.env[key] = decodeEnvValue(match[2]);
  }
}

const options = args(process.argv.slice(2));
const root = path.resolve(__dirname, '../..');
const envPath = path.resolve(options.env || path.join(root, '.env'));
loadEnvNoOverride(envPath);

const manifestPath = path.resolve(options.manifest || process.env.SOURCE_MANIFEST_FILE || path.join(root, 'source-manifest.json'));
let manifest = null;
if (fs.existsSync(manifestPath)) {
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch (error) {
    console.log(JSON.stringify({ ok: false, findings: [{ level: 'error', code: 'SOURCE_MANIFEST_INVALID_JSON', message: error.message }] }, null, 2));
    process.exit(1);
  }
}

// For v3.2.3 the manifest itself is the authority for the exact certified
// source directory, contract, and schema it was approved against. Environment
// values are only fallbacks when no manifest binding is available.
const contractPath = path.resolve(options.contract || manifest?.contract_file || path.join(root, 'mappings/mapping-contract-v2.json'));
const csvDir = path.resolve(options['csv-dir'] || manifest?.csv_dir || process.env.CSV_DIR || path.join(root, 'csv_files'));
const schemaPath = path.resolve(options.schema || manifest?.schema_file || path.join(root, 'schema/weavonpq_weaving.schema.json'));
if (manifest?.normalization_attestation_file && !process.env.NORMALIZATION_ATTESTATION_FILE) process.env.NORMALIZATION_ATTESTATION_FILE = path.resolve(manifest.normalization_attestation_file);

if (!fs.existsSync(contractPath)) {
  console.log(JSON.stringify({ ok: false, findings: [{ level: 'error', code: 'CONTRACT_FILE_MISSING', path: contractPath }] }, null, 2));
  process.exit(1);
}
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const findings = validateManifest({ manifestPath, csvDir, contract, schemaPath, requireApproved: Boolean(options.approved) });
console.log(JSON.stringify({
  ok: findings.every((finding) => finding.level !== 'error'),
  manifestPath,
  csvDir,
  contractPath,
  schemaPath,
  requireApproved: Boolean(options.approved),
  findings,
}, null, 2));
if (findings.some((finding) => finding.level === 'error')) process.exitCode = 1;
