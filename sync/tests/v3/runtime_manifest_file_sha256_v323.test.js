'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs, runDynamicImport } = require('../../lib/mapping_contract_runtime');

function rawSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v323-manifest-hash-'));
  const csvDir = path.join(dir, 'csv');
  const outDir = path.join(dir, 'out');
  fs.mkdirSync(csvDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const schemaPath = path.join(dir, 'schema.json');
  const contractPath = path.join(dir, 'contract.json');
  const manifestPath = path.join(dir, 'source-manifest.json');
  const sourcePath = path.join(csvDir, 'test.csv');
  fs.writeFileSync(sourcePath, 'KEY\nA\n', 'utf8');
  fs.writeFileSync(schemaPath, JSON.stringify({
    t: {
      id: { type: 'int(11)' },
      k: { type: 'varchar(50)' },
    },
  }), 'utf8');
  fs.writeFileSync(contractPath, JSON.stringify({
    contract_version: 'runtime-manifest-hash-fixture',
    published_contract_sha256: 'a'.repeat(64),
    schema_file: schemaPath,
    import_order: ['p'],
    profiles: [{
      id: 'p',
      source_file: 'test.csv',
      header_row: 0,
      tables: [{ name: 't', natural_key: ['k'], mode: 'upsert' }],
      mappings: [{
        table: 't', field: 'k', type: 'direct', source_column: 'KEY',
        required: true, allow_null: false, target_type: 'varchar(50) NOT NULL',
      }],
      repeated_groups: [],
    }],
    validation_policy: { fail_on_missing_target: false, fail_on_fk_dependency: false },
  }), 'utf8');
  fs.writeFileSync(manifestPath, JSON.stringify({
    manifest_status: 'approved',
    approval: { reviewed_pending_manifest_sha256: 'fixture' },
    files: [],
  }, null, 2), 'utf8');

  const tracked = [
    'CSV_DIR','SOURCE_MANIFEST_FILE','CLI_CONTRACT_OUTPUT_ROOT','DB_USER','DB_PASSWORD','DB_HOST','DB_PORT',
    'DB_NAME','IMPORT_EXPECTED_DB','PRODUCTION_DB_NAME','REQUIRE_DB_GUARD','REQUIRE_DB_FOR_DISPO_RESOLUTION',
    'ALLOW_PRODUCTION_DB','BACKUP_CONFIRMED','PRODUCTION_APPROVAL_TOKEN','APPROVED_DRY_RUN_ID',
  ];
  const before = Object.fromEntries(tracked.map((key) => [key, process.env[key]]));
  try {
    process.env.CSV_DIR = csvDir;
    process.env.SOURCE_MANIFEST_FILE = manifestPath;
    process.env.CLI_CONTRACT_OUTPUT_ROOT = outDir;
    process.env.REQUIRE_DB_GUARD = 'false';
    process.env.REQUIRE_DB_FOR_DISPO_RESOLUTION = 'false';
    process.env.ALLOW_PRODUCTION_DB = 'false';
    process.env.BACKUP_CONFIRMED = 'false';
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.PRODUCTION_APPROVAL_TOKEN;
    delete process.env.APPROVED_DRY_RUN_ID;

    const runId = 'runtime_manifest_hash_fixture';
    const outputDir = path.join(outDir, runId);
    const args = parseArgs([
      '--dry-run',
      `--contract=${contractPath}`,
      `--run-id=${runId}`,
      `--output-dir=${outputDir}`,
      '--skip-source-manifest-check',
    ]);
    const ctx = await runDynamicImport({ rootDir: dir, args, logger: null });
    assert.strictEqual(ctx.status.status, 'completed');

    const summary = JSON.parse(fs.readFileSync(path.join(outputDir, 'summary.json'), 'utf8'));
    const expected = rawSha256(manifestPath);
    assert.strictEqual(
      summary.sourceManifestFileSha256,
      expected,
      `runtime summary must use the raw byte SHA-256 of source-manifest.json; expected ${expected}, got ${summary.sourceManifestFileSha256}`,
    );
    console.log(JSON.stringify({
      ok: true,
      test: 'runtime_manifest_file_sha256_v323',
      sourceManifestFileSha256: summary.sourceManifestFileSha256,
    }, null, 2));
  } finally {
    for (const key of tracked) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
