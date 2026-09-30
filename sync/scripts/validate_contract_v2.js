'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function loadEnvNoOverride(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false }); } catch (_error) { loadEnvNoOverride(path.join(__dirname, '..', '.env')); }

const { validateContract } = require('../lib/mapping_contract_runtime');
const { validateManifest, validateNormalizationAttestation, sha256File } = require('../lib/source_manifest');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, ...rest] = arg.slice(2).split('=');
    out[key] = rest.length ? rest.join('=') : true;
  }
  return out;
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function resolveFrom(root, value, fallback) { return path.resolve(value || fallback || root); }
function hash(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

const options = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname, '..');
const contractPath = resolveFrom(root, options.contract || process.env.MAPPING_CONTRACT_FILE, path.join(root, 'mappings/mapping-contract-v2.json'));
const schemaPath = resolveFrom(root, options.schema, path.join(root, 'schema/weavonpq_weaving.schema.json'));
const fkPath = resolveFrom(root, options['foreign-keys'], path.join(root, 'schema/weavonpq_weaving.foreign-keys.json'));
const manifestPath = resolveFrom(root, options.manifest || process.env.SOURCE_MANIFEST_FILE, path.join(root, 'source-manifest.json'));
const csvDir = resolveFrom(root, options['csv-dir'] || process.env.CSV_DIR, path.join(root, 'csv_files'));
const bindingsPath = path.join(root, 'config/release_bindings.v3.2.3.json');

const findings = [];
const add = (row) => findings.push({ ts: new Date().toISOString(), ...row });

try {
  for (const [label, file] of [['contract', contractPath], ['schema', schemaPath], ['foreign keys', fkPath], ['release bindings', bindingsPath], ['approved manifest', manifestPath]]) {
    if (!fs.existsSync(file)) add({ level: 'error', code: `${label.toUpperCase().replace(/\s+/g, '_')}_MISSING`, message: `${label} file not found: ${file}` });
  }

  if (!findings.some((x) => x.level === 'error')) {
    const contract = readJson(contractPath);
    const schema = readJson(schemaPath);
    const foreignKeys = readJson(fkPath);
    const bindings = readJson(bindingsPath);

    const ctx = {
      contract,
      schema,
      foreignKeys,
      validationRows: [],
      fkDependencyReport: [],
      addValidation(row) { this.validationRows.push({ ts: new Date().toISOString(), ...row }); },
    };
    validateContract(ctx);
    findings.push(...ctx.validationRows);

    const contractFileSha256 = hash(contractPath);
    if (contractFileSha256 !== bindings.contract_file_sha256) {
      add({ level: 'error', code: 'RELEASE_CONTRACT_FILE_HASH_MISMATCH', expected: bindings.contract_file_sha256, actual: contractFileSha256, message: 'Serialized contract file differs from the release binding.' });
    }
    if (contract.published_contract_sha256 !== bindings.contract_published_sha256) {
      add({ level: 'error', code: 'RELEASE_PUBLISHED_CONTRACT_HASH_MISMATCH', expected: bindings.contract_published_sha256, actual: contract.published_contract_sha256, message: 'Published contract hash differs from the release binding.' });
    }

    const normalization = validateNormalizationAttestation(csvDir);
    findings.push(...normalization.findings);

    const manifestFindings = validateManifest({ manifestPath, csvDir, contract, schemaPath, requireApproved: true });
    findings.push(...manifestFindings);

    const allProfiles = contract.import_order || (contract.profiles || []).map((p) => p.id);
    const requiredProfiles = ['pre-costing-bootstrap','po','dispo','yarn-receive','yarn-issue','warping','sizing','loom','folding','greige-delivery'];
    if (allProfiles.length !== requiredProfiles.length || !requiredProfiles.every((id) => allProfiles.includes(id))) {
      add({ level: 'error', code: 'CONTRACT_PROFILE_SET_MISMATCH', expected: requiredProfiles, actual: allProfiles, message: 'Contract must contain the complete ten-profile production import order.' });
    }

    const errors = findings.filter((x) => x.level === 'error');
    const warnings = findings.filter((x) => x.level === 'warn');
    const mappingCount = (contract.profiles || []).reduce((sum, p) => sum + (p.mappings || []).length, 0);
    const result = {
      ok: errors.length === 0 && ctx.fkDependencyReport.every((row) => row.ok !== false),
      validatorVersion: '3.2.3-phase6-static-20260813',
      executionMode: 'static-contract-manifest-normalization-validation',
      dynamicImportExecuted: false,
      contractPath,
      contractFileSha256,
      contractPublishedSha256: contract.published_contract_sha256 || null,
      schemaPath,
      schemaSha256: sha256File(schemaPath),
      approvedManifestPath: manifestPath,
      approvedManifestSha256: sha256File(manifestPath),
      csvDir,
      normalizationAttestationPath: normalization.attestationPath,
      normalizationAttestationSha256: fs.existsSync(normalization.attestationPath) ? sha256File(normalization.attestationPath) : null,
      profileCount: (contract.profiles || []).length,
      mappingCount,
      staticValidationErrors: errors.length,
      staticValidationWarnings: warnings.length,
      fkDependencyFailures: ctx.fkDependencyReport.filter((row) => row.ok === false).length,
      findings,
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else {
    const result = { ok: false, validatorVersion: '3.2.3-phase6-static-20260813', dynamicImportExecuted: false, findings };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, validatorVersion: '3.2.3-phase6-static-20260813', dynamicImportExecuted: false, error: error.message, stack: error.stack }, null, 2));
  process.exitCode = 1;
}
