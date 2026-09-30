'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const cliRoot = path.resolve(__dirname, '../..');
const packageRoot = path.resolve(cliRoot, '..');
const visRoot = path.join(packageRoot, 'import_mapper_vis');
const checks = [];
function check(name, ok, details = null) { checks.push({ name, status: ok ? 'PASS' : 'FAIL', details }); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full)); else out.push(full);
  }
  return out;
}
function rel(file) { return path.relative(packageRoot, file).replace(/\\/g, '/'); }

const contractPath = path.join(cliRoot, 'mappings/mapping-contract-v2.json');
const templatePath = path.join(cliRoot, 'mappings/mapping-contract-v2.template.json');
const visualPath = path.join(visRoot, 'visual-mapping.config.json');
const schemaPath = path.join(cliRoot, 'schema/weavonpq_weaving.schema.json');
const contract = readJson(contractPath);
const visual = readJson(visualPath);
const schema = readJson(schemaPath);
const mappings = contract.profiles.flatMap((profile) => (profile.mappings || []).map((mapping) => ({ profile: profile.id, ...mapping })));

// Contract and VIS uniqueness.
const visDup = [];
for (const profile of visual.profiles || []) {
  const seen = new Map();
  for (const step of profile.steps || []) for (const mapping of step.mappings || []) {
    const key = `${step.targetTable}::${mapping.targetColumn}`;
    if (seen.has(key)) visDup.push({ profile: profile.id, key, first: seen.get(key), duplicate: mapping.id });
    else seen.set(key, mapping.id);
  }
}
const contractDup = [];
for (const profile of contract.profiles || []) {
  const seen = new Set();
  for (const mapping of profile.mappings || []) {
    const key = `${mapping.table}::${mapping.field}`;
    if (seen.has(key)) contractDup.push({ profile: profile.id, key }); else seen.add(key);
  }
}
check('duplicate_visual_targets', visDup.length === 0, visDup);
check('duplicate_contract_targets', contractDup.length === 0, contractDup);
const critical = mappings.filter((mapping) => mapping.business_critical || mapping.critical_lookup);
check('all_critical_explicitly_required', critical.length >= 36 && critical.every((mapping) => mapping.required === true && mapping.allow_null === false), { count: critical.length });

// Schema and formula checks.
const targets = [], lookups = [], formulas = [];
for (const mapping of mappings) {
  if (!schema[mapping.table]?.[mapping.field]) targets.push({ profile: mapping.profile, table: mapping.table, field: mapping.field });
  if (mapping.type === 'formula') try { new vm.Script(mapping.expression); } catch (error) { formulas.push({ profile: mapping.profile, field: mapping.field, error: error.message }); }
  for (const fallback of mapping.fallbacks || []) {
    const lookup = fallback.lookup;
    if (!lookup) continue;
    if (!schema[lookup.table]?.[lookup.key_field] || !schema[lookup.table]?.[lookup.result_field]) lookups.push({ profile: mapping.profile, mapping: `${mapping.table}.${mapping.field}`, lookup });
  }
}
check('all_targets_exist', targets.length === 0, targets);
check('all_lookup_fields_exist', lookups.length === 0, lookups);
check('all_formulas_parse', formulas.length === 0, formulas);

const runtime = fs.readFileSync(path.join(cliRoot, 'lib/mapping_contract_runtime.js'), 'utf8');
const index = fs.readFileSync(path.join(cliRoot, 'lib/source_index.js'), 'utf8');
const resolver = fs.readFileSync(path.join(cliRoot, 'lib/dispo_resolution.js'), 'utf8');
const manifest = fs.readFileSync(path.join(cliRoot, 'lib/source_manifest.js'), 'utf8');
const visServer = fs.readFileSync(path.join(visRoot, 'visual-map-server.js'), 'utf8');
const visClient = fs.readFileSync(path.join(visRoot, 'public/visual-mapper.js'), 'utf8');
const visHtml = fs.readFileSync(path.join(visRoot, 'public/visual-mapper.html'), 'utf8');

for (const [name, source, markers] of [
  ['canonical_dispo_formula_propagation', runtime, ['function sourceGetter(fileInfo, row, canonicalDispo = null)', 'sourceGetter(fileInfo, row, ctx.currentCanonicalDispo)']],
  ['empty_target_source_master', index, ['this.dispoMasters = new Map()', 'loadDispoMasters()', 'dispoValue(resultField, dispoValue)']],
  ['database_cache_refresh', resolver, ['async findCurrentMaster(normalizedDispo)', 'if (!directMaster) directMaster = await this.findCurrentMaster(normalized)']],
  ['erp_yarn_lot_identity', index, ['function normalizeYarnLotIdentity', 'Keep internal whitespace intact']],
  ['shared_ordering_runtime', index, ['function compareOrderedIdentifiers', '/^\\d{1,65}$/', "Buffer.compare(Buffer.from(left.text, 'utf8')"]],
  ['rejections_block_every_mode', runtime, ['ctx.rejectedRowCount > 0', "'DRY_RUN_BLOCKING_FINDINGS'"]],
  ['summary_terminal_evidence', runtime, ['status: ctx.status.status', 'fullAllProfileDryRun', 'fkDependencyFailures']],
  ['manifest_exact_review_binding', manifest, ['reviewed_pending_manifest_sha256', 'REVIEWED_PENDING_MANIFEST_HASH_MISMATCH', 'PRE_COSTING_NO_COMPLETENESS_FAILED']],
]) {
  const missing = markers.filter((marker) => !source.includes(marker));
  check(name, missing.length === 0, { missing });
}

// Exact runtime/SQL ordering parity markers.
const sqlFiles = ['05_post_import_formula_and_lookup_checks.sql', '08_final_gate_summary.sql', 'RUN_ALL_POST_MIGRATION_VERIFICATION.sql'];
const sqlIssues = [];
for (const filename of sqlFiles) {
  const sql = fs.readFileSync(path.join(cliRoot, 'sql/production_verification', filename), 'utf8');
  for (const marker of ['v3.2.2 shared runtime/SQL challan order', "REGEXP '^[0-9]{1,65}$'", 'DECIMAL(65,0)', 'BINARY LOWER(TRIM(g2.challan_no))']) {
    if (!sql.includes(marker)) sqlIssues.push({ filename, missing: marker });
  }
}
check('runtime_sql_challan_ordering_parity', sqlIssues.length === 0, sqlIssues);

// VIS permanent read-only boundary.
const visIssues = [];
for (const marker of ["const GOOGLE_SHEETS_WEBHOOK_ACTION = 'record-only';", "ALLOW_PRODUCTION_DB: 'false'", "BACKUP_CONFIRMED: 'false'", "PRODUCTION_APPROVAL_TOKEN: ''", 'VIS_WRITE_DISABLED']) if (!visServer.includes(marker)) visIssues.push(`server missing ${marker}`);
for (const forbidden of ['runGoogleSheetSafeLivePipelineForMatch', "BACKUP_CONFIRMED: 'true'", 'node --max-old-space-size=384 import.js --live']) if (visServer.includes(forbidden)) visIssues.push(`server retains ${forbidden}`);
for (const forbiddenRoute of ['/api/sql/preview', '/api/sql/execute', '/api/sql/history', '/api/import/dispo-chunks', '/api/import/downstream-refresh']) if (visServer.includes(forbiddenRoute)) visIssues.push(`server retains route ${forbiddenRoute}`);
for (const forbidden of ['value="live"', 'id="backupConfirmed"', 'id="runDispoChunksBtn"', 'id="runRefreshBtn"', 'id="sqlConsoleBtn"', 'id="sqlDialog"', 'id="sqlExecuteTab"', 'id="sqlExecutePane"', 'webhook_safe_live']) if (visHtml.includes(forbidden)) visIssues.push(`html retains ${forbidden}`);
for (const forbidden of ['/api/import/dispo-chunks', '/api/import/downstream-refresh', '/api/sql/']) if (visClient.includes(forbidden)) visIssues.push(`client retains ${forbidden}`);
check('vis_permanently_read_only', visIssues.length === 0, visIssues);

// Full all-profile dry-run gate and terminal-only live authority.
const dryVerifier = fs.readFileSync(path.join(cliRoot, 'scripts/v3/verify_full_dry_run.js'), 'utf8');
const dryAcceptance = fs.readFileSync(path.join(cliRoot, 'lib/dry_run_acceptance.js'), 'utf8');
const dryGateSource = `${dryVerifier}
${dryAcceptance}`;
const profileRunner = fs.readFileSync(path.join(cliRoot, 'scripts/v3/run_production_profile.sh'), 'utf8');
const sequenceRunner = fs.readFileSync(path.join(cliRoot, 'scripts/v3/run_production_sequence.sh'), 'utf8');
check('full_unlimited_all_profile_dry_run_required', ['NOT_ALL_PROFILES_SELECTED', 'NOT_ALL_PROFILES_RECONCILED', 'LIMIT_OR_OFFSET_USED', 'FK_REPORT_FAILED', 'full_dry_run_acceptance.json'].every((marker) => dryGateSource.includes(marker)));
check('terminal_live_requires_accepted_dry_run', profileRunner.includes('verify_full_dry_run.js') && sequenceRunner.includes('verify_full_dry_run.js') && profileRunner.includes('--production-approval=') && profileRunner.includes('--approved-dry-run='));
check('runtime_live_requires_accepted_dry_run', runtime.includes('APPROVED_DRY_RUN_EVIDENCE_FAILED') && runtime.includes("args['approved-dry-run']") && runtime.includes('verifyFullDryRunEvidence'));

// cPanel static schema patch.
const patchSql = fs.readFileSync(path.join(cliRoot, 'sql/production_verification/00A_apply_required_v3_audit_schema_patch.sql'), 'utf8');
check('cpanel_static_00A', !/\bPREPARE\b/i.test(patchSql) && !/\bEXECUTE\b/i.test(patchSql) && patchSql.includes('ADD COLUMN IF NOT EXISTS `approved_by`'));

// Clean package authority and docs.
const forbiddenPaths = [
  'import_mapper_cli/import-legacy-hardcoded.js', 'import_mapper_cli/mappings/mapping-contract-v1.json',
  'import_mapper_cli/mappings/cleaned_exports', 'import_mapper_cli/scripts/run_live_sample.sh',
  'import_mapper_cli/scripts/run_dispo_chunks.sh', 'import_mapper_cli/scripts/run_downstream_refresh_after_dispo.sh',
];
check('no_competing_legacy_authorities', forbiddenPaths.every((item) => !fs.existsSync(path.join(packageRoot, item))), forbiddenPaths.filter((item) => fs.existsSync(path.join(packageRoot, item))));
const checksumManifestPath = path.join(packageRoot, 'SHA256SUMS.txt');
const shippedPaths = fs.existsSync(checksumManifestPath)
  ? fs.readFileSync(checksumManifestPath, 'utf8').split(/\r?\n/).map((line) => line.match(/^[a-f0-9]{64}\s{2}(.+)$/i)?.[1]).filter(Boolean)
  : [];
const manifestErrors = [];
if (!shippedPaths.length) manifestErrors.push('SHA256SUMS.txt is missing or empty.');
const shippedCsvs = shippedPaths.filter((item) => /^import_mapper_cli\/csv_files\/.+\.csv$/i.test(item));
const shippedLogs = shippedPaths.filter((item) => /(^|\/)(logs?|application_logs)\/.+\.(?:log|jsonl)$/i.test(item));
const shippedBackups = shippedPaths.filter((item) => /import_mapper_cli\/mappings\/backups\//i.test(item) || /mapping-contract-v2\.\d{4}-/i.test(path.basename(item)));
check('package_checksum_manifest_present', manifestErrors.length === 0, manifestErrors);
check('no_bundled_source_csvs', shippedCsvs.length === 0, shippedCsvs);
check('no_build_logs_in_shipped_manifest', shippedLogs.length === 0, shippedLogs);
check('no_mapping_backups_in_shipped_manifest', shippedBackups.length === 0, shippedBackups);
const oldVerification = ['V3_2_FINAL_BUILD_VERIFICATION.json', 'V3_2_RELEASE_VERIFICATION.json'].filter((name) => fs.existsSync(path.join(packageRoot, name)));
check('no_superseded_release_evidence', oldVerification.length === 0, oldVerification);
check('single_authoritative_runbook', fs.existsSync(path.join(packageRoot, 'PRODUCTION_MIGRATION_V3_2_2_RUNBOOK.md')));

// Active synthetic identifier logic absent.
const activeFiles = [contractPath, templatePath, visualPath, path.join(cliRoot, 'lib/mapping_contract_runtime.js'), path.join(cliRoot, 'lib/source_index.js'), path.join(cliRoot, 'lib/dispo_resolution.js'), path.join(cliRoot, 'lib/contract_compiler.js'), ...walk(path.join(cliRoot, 'scripts/v3')).filter((file) => !file.endsWith('verify_release_v322.js') && !file.endsWith('scan_stale_targets.js'))];
const synthetic = [];
for (const file of activeFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const token of ['NO-DISPO-', 'AUTO-DISPO-', 'AUTO-PO-', 'AUTO-PRECOST-', 'NO-CHALLAN-']) if (text.includes(token)) synthetic.push({ file: rel(file), token });
}
check('no_active_synthetic_identifier_logic', synthetic.length === 0, synthetic);

// Public npm lockfile portability.
const registryIssues = [];
for (const file of [path.join(cliRoot, 'package-lock.json'), path.join(visRoot, 'package-lock.json')]) {
  const text = fs.readFileSync(file, 'utf8');
  if (!text.includes('https://registry.npmjs.org/')) registryIssues.push(`${rel(file)}: public registry absent`);
  if (/artifactory|npm\.pkg\.github|packages\.hub\.ace-research|openai/i.test(text)) registryIssues.push(`${rel(file)}: private registry marker`);
}
check('portable_public_npm_lockfiles', registryIssues.length === 0, registryIssues);

// cPanel low-memory and environment-precedence checks.
const importEntry = fs.readFileSync(path.join(cliRoot, 'import.js'), 'utf8');
const bootstrapLogging = fs.readFileSync(path.join(cliRoot, 'lib/bootstrap_logging.js'), 'utf8');
check('protected_environment_precedence', importEntry.includes('override: false') && bootstrapLogging.includes('override: false') && !importEntry.includes('override: true'));
const streamSource = fs.readFileSync(path.join(cliRoot, 'lib/csv_stream.js'), 'utf8');
check('streaming_csv_reader_present', streamSource.includes('forEachCsvRowSync') && streamSource.includes('iterateCsvRows'));
check('streaming_source_certification', manifest.includes('forEachCsvObjectSync') && !manifest.includes('fs.readFileSync(filePath'));
check('streaming_runtime_profiles', runtime.includes('for await (const streamed of parser)'));
check('bounded_runtime_evidence', runtime.includes('REPORT_DETAIL_LIMIT') && runtime.includes('PREVIEW_DETAIL_LIMIT'));
const baselineSql = fs.readFileSync(path.join(cliRoot, 'sql/production_verification/00B_capture_users_sessions_baseline.sql'), 'utf8');
const compareProtectedSql = fs.readFileSync(path.join(cliRoot, 'sql/production_verification/08A_compare_users_sessions_to_baseline.sql'), 'utf8');
check('protected_access_tables_fingerprinted', baselineSql.includes("'user_privileges'") && compareProtectedSql.includes("'user_privileges'"));
const runbook = fs.readFileSync(path.join(packageRoot, 'PRODUCTION_MIGRATION_V3_2_2_RUNBOOK.md'), 'utf8');
check('runbook_safe_verification_order', runbook.indexOf('npm run release:verify') < runbook.indexOf('npm run test:v3.2.2'));
check('runbook_low_memory_commands', runbook.includes('source:manifest:low-memory') && runbook.includes('contract:validate:low-memory'));

const packages = [readJson(path.join(cliRoot, 'package.json')), readJson(path.join(visRoot, 'package.json'))];
check('v322_versions', packages.every((pkg) => pkg.version === '5.5.0-production-migration-v3.2.2-cpanel-low-memory'), packages.map((pkg) => pkg.version));
check('v322_contract_version', contract.contract_version === '2.0.0-production-migration-v3.2.2-cpanel-low-memory', contract.contract_version);

const failures = checks.filter((item) => item.status === 'FAIL');
const report = {
  release: 'Production Migration v3.2.2 cPanel low-memory production replacement',
  generatedAt: new Date().toISOString(), status: failures.length ? 'FAIL' : 'PASS',
  contract: { contractVersion: contract.contract_version, publishedContractSha256: contract.published_contract_sha256, serializedFileSha256: sha256(contractPath), profiles: contract.profiles.length, mappings: mappings.length, criticalMappings: critical.length, criticalMappingsRequired: critical.filter((mapping) => mapping.required).length },
  checks, failures,
  limitations: ['No complete current production source package or live MariaDB migration was executed in this build environment.', 'Production success still requires approved source evidence, accepted full dry run, guarded import, SQL verification, and identical second-run idempotency evidence.'],
};
const outputArg = process.argv.find((arg) => arg.startsWith('--output='));
if (outputArg) {
  const output = path.resolve(outputArg.slice('--output='.length));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), 'utf8');
}
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
