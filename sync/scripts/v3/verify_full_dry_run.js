'use strict';

const path = require('path');
const { verifyFullDryRunEvidence } = require('../../lib/dry_run_acceptance');

function args(argv) { const out = {}; for (const item of argv) { if (!item.startsWith('--')) continue; const [key, ...rest] = item.slice(2).split('='); out[key] = rest.length ? rest.join('=') : true; } return out; }
const options = args(process.argv.slice(2));
const root = path.resolve(__dirname, '../..');
const runId = String(options['run-id'] || process.env.APPROVED_DRY_RUN_ID || '').trim();
const evidence = verifyFullDryRunEvidence({
  runId,
  outputRoot: path.resolve(options['output-root'] || process.env.CLI_CONTRACT_OUTPUT_ROOT || path.join(root, 'output/mapping_contract_v2')),
  contractPath: path.resolve(options.contract || process.env.MAPPING_CONTRACT_FILE || path.join(root, 'mappings/mapping-contract-v2.json')),
  manifestPath: path.resolve(options.manifest || process.env.SOURCE_MANIFEST_FILE || path.join(root, 'source-manifest.json')),
  schemaPath: path.resolve(options.schema || path.join(root, 'schema/weavonpq_weaving.schema.json')),
  csvDir: path.resolve(options['csv-dir'] || process.env.CSV_DIR || path.join(root, 'csv_files')),
  writeEvidence: true,
});
console.log(JSON.stringify({ ...evidence, evidencePath: path.join(evidence.runDir, 'full_dry_run_acceptance.json') }, null, 2));
if (!evidence.ok) process.exitCode = 1;
