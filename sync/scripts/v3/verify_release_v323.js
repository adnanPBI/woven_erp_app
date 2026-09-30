#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { validateNormalizationAttestation } = require('../../lib/source_manifest');

const root = path.resolve(__dirname, '../..');
const repo = path.resolve(root, '..');
const expectedVersion = '5.6.0-production-migration-v3.2.3-hybrid';
const expectedContractVersion = '2.0.0-production-migration-v3.2.3-hybrid';
const expectedPatchRevision = '20260812b';
const installedMode = process.argv.includes('--installed');

function sha(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function shaFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function check(id, ok, detail = '') { return { id, ok: Boolean(ok), detail }; }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function readJson(file) { return JSON.parse(read(file)); }
function envValue(text, key) {
  const match = text.match(new RegExp(`^${key}=([^\r\n]*)$`, 'm'));
  if (!match) return '';
  let value = match[1].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return value;
}

const checks = [];
const pkgPath = path.join(root, 'package.json');
const pkg = readJson(pkgPath);
checks.push(check('cli_version', pkg.version === expectedVersion, pkg.version));
checks.push(check('cli_patch_revision', pkg.release_patch_revision === expectedPatchRevision, pkg.release_patch_revision || '<missing>'));

const visPkgPath = path.join(repo, 'import_mapper_vis', 'package.json');
checks.push(check('vis_package_present', fs.existsSync(visPkgPath), visPkgPath));
if (fs.existsSync(visPkgPath)) {
  const visPkg = readJson(visPkgPath);
  checks.push(check('vis_version', visPkg.version === expectedVersion, visPkg.version));
  checks.push(check('vis_patch_revision', visPkg.release_patch_revision === expectedPatchRevision, visPkg.release_patch_revision || '<missing>'));
}

const bindingsPath = path.join(root, 'config', 'release_bindings.v3.2.3.json');
checks.push(check('release_bindings_present', fs.existsSync(bindingsPath), bindingsPath));
const bindings = fs.existsSync(bindingsPath) ? readJson(bindingsPath) : {};
checks.push(check('bindings_patch_revision', bindings.release_patch_revision === expectedPatchRevision, bindings.release_patch_revision || '<missing>'));
checks.push(check('bindings_cli_version', bindings.cli_version === expectedVersion, bindings.cli_version || '<missing>'));

const contractPath = path.join(root, 'mappings', 'mapping-contract-v2.json');
const contract = readJson(contractPath);
const clone = JSON.parse(JSON.stringify(contract));
delete clone.published_contract_sha256;
delete clone.generated_at;
delete clone.normalization_report;
if (clone.published_from) { delete clone.published_from.visual_config; delete clone.published_from.template; }
const computedContractHash = sha(JSON.stringify(clone));
const serializedContractHash = shaFile(contractPath);
checks.push(check('contract_version', contract.contract_version === expectedContractVersion, contract.contract_version));
checks.push(check('contract_runtime_release', contract.runtime_release === expectedVersion, contract.runtime_release));
checks.push(check('contract_hash_self_consistent', computedContractHash === contract.published_contract_sha256, `${computedContractHash} / ${contract.published_contract_sha256}`));
checks.push(check('contract_file_hash_release_bound', serializedContractHash === bindings.contract_file_sha256, `${serializedContractHash} / ${bindings.contract_file_sha256 || '<missing>'}`));
checks.push(check('contract_published_hash_release_bound', contract.published_contract_sha256 === bindings.contract_published_sha256, `${contract.published_contract_sha256} / ${bindings.contract_published_sha256 || '<missing>'}`));

const normalizationPolicyPath = path.join(root, 'config', 'normalization_policy.v3.2.3.json');
const provenancePolicyPath = path.join(root, 'config', 'provenance_policy.v3.2.3.json');
checks.push(check('normalization_policy_release_bound', fs.existsSync(normalizationPolicyPath) && shaFile(normalizationPolicyPath) === bindings.normalization_policy_sha256, fs.existsSync(normalizationPolicyPath) ? shaFile(normalizationPolicyPath) : '<missing>'));
checks.push(check('provenance_policy_release_bound', fs.existsSync(provenancePolicyPath) && shaFile(provenancePolicyPath) === bindings.provenance_policy_sha256, fs.existsSync(provenancePolicyPath) ? shaFile(provenancePolicyPath) : '<missing>'));

for (const [rel, expected] of Object.entries(bindings.critical_files || {})) {
  const target = path.join(root, rel);
  const actual = fs.existsSync(target) ? shaFile(target) : null;
  checks.push(check(`critical_hash:${rel}`, actual === expected, `${actual || '<missing>'} / ${expected}`));
}

const requiredManifestScript = 'node --max-old-space-size=192 scripts/v3/certify_sources_v323.js';
for (const name of ['source:manifest', 'source:manifest:v323', 'source:manifest:low-memory']) {
  checks.push(check(`manifest_script:${name}`, pkg.scripts?.[name] === requiredManifestScript, pkg.scripts?.[name] || '<missing>'));
}
checks.push(check('manifest_approval_script', pkg.scripts?.['source:manifest:approve'] === 'node scripts/v3/approve_source_manifest.js', pkg.scripts?.['source:manifest:approve'] || '<missing>'));
checks.push(check('manifest_validate_approved_script', pkg.scripts?.['source:manifest:validate-approved'] === 'node scripts/v3/validate_source_manifest.js --approved', pkg.scripts?.['source:manifest:validate-approved'] || '<missing>'));

for (const profileId of ['yarn-receive','yarn-issue','warping','sizing','greige-delivery']) {
  checks.push(check(`provenance_profile:${profileId}`, contract.profiles.find((p) => p.id === profileId)?.idempotency === 'provenance'));
}

const required = [
  'config/normalization_policy.v3.2.3.json', 'config/provenance_policy.v3.2.3.json', 'config/duplicate_aggregation_policy.v1.json',
  'config/release_bindings.v3.2.3.json', 'lib/provenance.js', 'lib/dry_run_acceptance.js', 'lib/source_manifest.js',
  'scripts/v3/certify_sources.js', 'scripts/v3/certify_sources_v323.js', 'scripts/v3/normalize_sources_v323.js',
  'scripts/v3/activate_certified_sources_v323.js', 'scripts/v3/review_normalization_v323.js', 'scripts/v3/approve_source_manifest.js',
  'scripts/v3/validate_source_manifest.js', 'scripts/v3/run_production_dry_run.sh', 'scripts/v3/run_production_profile.sh',
  'scripts/v3/run_production_sequence.sh', 'tests/v3/v323_hybrid.test.js', 'tests/v3/manifest_12126_blocker_regression.test.js',
  'tests/v3/full_dry_run_gate_v323.test.js', 'sql/v3_2_3/01_v323_support_schema.sql', 'sql/v3_2_3/02_v323_support_schema_verify.sql',
  'sql/v3_2_3/03_v323_capture_protected_baseline.sql', 'sql/v3_2_3/04_v323_post_migration_gate.sql',
  'sql/v3_2_3/05_v323_idempotency_snapshot.sql', 'sql/v3_2_3/06_v323_idempotency_compare.sql',
  'sql/v3_2_3/07_v323_compare_protected_baseline.sql', 'sql/v3_2_3/08_v323_cleanup_optional_verification.sql',
];
for (const rel of required) checks.push(check(`required:${rel}`, fs.existsSync(path.join(root, rel)), rel));
checks.push(check('obsolete_precost_null_policy_absent', !fs.existsSync(path.join(root, 'config/pre_costing_null_policy.v1.json'))));

const cliEnvPath = path.join(root, '.env');
const visEnvPath = path.join(repo, 'import_mapper_vis', '.env');
if (installedMode) {
  checks.push(check('installed_cli_env_present', fs.existsSync(cliEnvPath)));
  checks.push(check('installed_vis_env_present', fs.existsSync(visEnvPath)));
  if (fs.existsSync(cliEnvPath)) {
    const text = read(cliEnvPath);
    checks.push(check('installed_cli_prod_disabled', envValue(text,'ALLOW_PRODUCTION_DB') === 'false' && envValue(text,'BACKUP_CONFIRMED') === 'false'));
    checks.push(check('installed_cli_token_blank', envValue(text,'PRODUCTION_APPROVAL_TOKEN') === ''));
    checks.push(check('installed_cli_dry_id_blank', envValue(text,'APPROVED_DRY_RUN_ID') === ''));
    checks.push(check('installed_cli_dmy', envValue(text,'CSV_DATE_ORDER') === 'dmy'));
    const csvDir = envValue(text, 'CSV_DIR');
    const attestation = envValue(text, 'NORMALIZATION_ATTESTATION_FILE');
    if (csvDir && attestation && fs.existsSync(csvDir) && fs.existsSync(attestation)) {
      const previous = process.env.NORMALIZATION_ATTESTATION_FILE;
      process.env.NORMALIZATION_ATTESTATION_FILE = attestation;
      const normalization = validateNormalizationAttestation(csvDir);
      if (previous === undefined) delete process.env.NORMALIZATION_ATTESTATION_FILE; else process.env.NORMALIZATION_ATTESTATION_FILE = previous;
      const errors = normalization.findings.filter((x) => x.level === 'error');
      checks.push(check('installed_normalization_attestation_valid_if_activated', errors.length === 0, JSON.stringify(errors)));
      checks.push(check('installed_normalization_attestation_nine_files', Object.keys(normalization.attestation?.certified_files || {}).length === 9));
    }
  }
  if (fs.existsSync(visEnvPath)) {
    const text = read(visEnvPath);
    checks.push(check('installed_vis_prod_disabled', envValue(text,'ALLOW_PRODUCTION_DB') === 'false' && envValue(text,'BACKUP_CONFIRMED') === 'false'));
    checks.push(check('installed_vis_token_blank', envValue(text,'PRODUCTION_APPROVAL_TOKEN') === ''));
    checks.push(check('installed_vis_sql_disabled', envValue(text,'VISUAL_SQL_EXECUTOR_ENABLED') === 'false'));
    checks.push(check('installed_vis_webhook_record_only', envValue(text,'GOOGLE_SHEETS_WEBHOOK_ACTION') === 'record-only'));
    checks.push(check('installed_vis_dmy', envValue(text,'CSV_DATE_ORDER') === 'dmy'));
  }
} else {
  checks.push(check('no_cli_env', !fs.existsSync(cliEnvPath)));
  checks.push(check('no_vis_env', !fs.existsSync(visEnvPath)));
  checks.push(check('no_local_runtime_env', !fs.existsSync(path.join(root, '.runtime'))));
  const csvDir = path.join(root, 'csv_files');
  const csvs = fs.existsSync(csvDir) ? fs.readdirSync(csvDir).filter((x) => x.toLowerCase().endsWith('.csv')) : [];
  checks.push(check('no_packaged_production_csv', csvs.length === 0, csvs.join(',')));
}
for (const rel of ['source-manifest.json','source-manifest.pending.json','source-manifest.approval.json']) checks.push(check(`no_stale:${rel}`, !fs.existsSync(path.join(root, rel))));

const cliEnvExample = read(path.join(root, '.env.example'));
checks.push(check('cli_env_example_dmy', /^CSV_DATE_ORDER=dmy$/m.test(cliEnvExample)));
checks.push(check('cli_env_example_prod_disabled', /^ALLOW_PRODUCTION_DB=false$/m.test(cliEnvExample) && /^BACKUP_CONFIRMED=false$/m.test(cliEnvExample)));
checks.push(check('cli_env_example_token_blank', /^PRODUCTION_APPROVAL_TOKEN=$/m.test(cliEnvExample)));
const visEnvExample = read(path.join(repo, 'import_mapper_vis', '.env.example'));
checks.push(check('vis_env_example_readonly', /^VISUAL_SQL_EXECUTOR_ENABLED=false$/m.test(visEnvExample) && /^GOOGLE_SHEETS_WEBHOOK_ACTION=record-only$/m.test(visEnvExample) && /^ALLOW_PRODUCTION_DB=false$/m.test(visEnvExample)));
checks.push(check('vis_env_example_dmy', /^CSV_DATE_ORDER=dmy$/m.test(visEnvExample)));

const visServerPath = path.join(repo, 'import_mapper_vis', 'visual-map-server.js');
if (fs.existsSync(visServerPath)) {
  const text = read(visServerPath);
  checks.push(check('vis_sql_hard_disabled', /const\s+SQL_EXECUTOR_ENABLED\s*=\s*false/.test(text)));
  checks.push(check('vis_webhook_record_only', /const\s+GOOGLE_SHEETS_WEBHOOK_ACTION\s*=\s*['"]record-only['"]/.test(text)));
  checks.push(check('vis_write_guard', text.includes('VIS_WRITE_DISABLED')));
  checks.push(check('vis_child_prod_disabled', /ALLOW_PRODUCTION_DB\s*:\s*['"]false['"]/.test(text)));
  checks.push(check('vis_child_token_blank', /PRODUCTION_APPROVAL_TOKEN\s*:\s*['"]['"]/.test(text)));
} else checks.push(check('vis_server_present', false, visServerPath));

const dryGateText = read(path.join(root, 'lib/dry_run_acceptance.js'));
checks.push(check('dry_gate_completed_required', dryGateText.includes("'RUN_NOT_COMPLETED'")));
for (const field of ['requiredLookupMisses','criticalLookupMisses','rejectedRows','fkDependencyFailures']) checks.push(check(`dry_gate_zero:${field}`, dryGateText.includes(field)));
checks.push(check('dry_gate_approved_manifest_required', dryGateText.includes("'APPROVED_MANIFEST_MISSING'") && dryGateText.includes('requireApproved: true')));
checks.push(check('dry_gate_no_local_rehearsal_bypass', !/Removed APPROVED_MANIFEST_MISSING|local rehearsal/i.test(dryGateText)));

const runtimeText = read(path.join(root, 'lib/mapping_contract_runtime.js'));
checks.push(check('runtime_safe_expression_compiler', runtimeText.includes('function compileSafeExpression') && !runtimeText.includes('vm.runInNewContext')));
checks.push(check('runtime_live_dry_gate', runtimeText.includes('APPROVED_DRY_RUN_EVIDENCE_FAILED')));
checks.push(check('runtime_support_schema_gate', runtimeText.includes('V323_SUPPORT_SCHEMA_FAILED')));

const sourceManifestText = read(path.join(root, 'lib/source_manifest.js'));
checks.push(check('manifest_requires_normalization_status_pass', sourceManifestText.includes('MANIFEST_NORMALIZATION_STATUS_NOT_PASS')));
checks.push(check('manifest_requires_contract_file_hash', sourceManifestText.includes('MANIFEST_CONTRACT_FILE_HASH_MISSING')));
checks.push(check('manifest_requires_provenance_policy_hash', sourceManifestText.includes('MANIFEST_PROVENANCE_POLICY_HASH_MISSING')));
const certifierText = read(path.join(root, 'scripts/v3/certify_sources_v323.js'));
checks.push(check('certifier_loads_env_without_override', certifierText.includes('loadEnvNoOverride(envPath)')));
checks.push(check('certifier_requires_certified_dir', certifierText.includes('CSV_DIR must be the certified directory')));
checks.push(check('certifier_requires_nine_files', certifierText.includes('exactly nine certified source files')));
checks.push(check('certifier_binds_attestation', certifierText.includes('normalizationAttestationSha256')));

const syntaxFiles = [
  'lib/mapping_contract_runtime.js','lib/provenance.js','lib/source_manifest.js','lib/dry_run_acceptance.js',
  'scripts/v3/certify_sources.js','scripts/v3/certify_sources_v323.js','scripts/v3/normalize_sources_v323.js',
  'scripts/v3/activate_certified_sources_v323.js','scripts/v3/review_normalization_v323.js',
  'scripts/v3/approve_source_manifest.js','scripts/v3/validate_source_manifest.js','scripts/v3/verify_full_dry_run.js',
  'scripts/v3/verify_release_v323.js','tests/v3/v323_hybrid.test.js','tests/v3/manifest_12126_blocker_regression.test.js',
  'tests/v3/full_dry_run_gate_v323.test.js',
];
for (const rel of syntaxFiles) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  checks.push(check(`syntax:${rel}`, result.status === 0, (result.stderr || '').trim()));
}
for (const rel of ['scripts/v3/run_production_dry_run.sh','scripts/v3/run_production_profile.sh','scripts/v3/run_production_sequence.sh']) {
  const result = spawnSync('bash', ['-n', path.join(root, rel)], { encoding: 'utf8' });
  checks.push(check(`bash_syntax:${rel}`, result.status === 0, (result.stderr || '').trim()));
}

const result = {
  ok: checks.every((c) => c.ok),
  release: expectedVersion,
  releasePatchRevision: expectedPatchRevision,
  installedMode,
  contractFileSha256: serializedContractHash,
  contractPublishedSha256: contract.published_contract_sha256,
  checked_at: new Date().toISOString(),
  checks,
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
