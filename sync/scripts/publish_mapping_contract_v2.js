'use strict';
const logger = require('../lib/bootstrap_logging');
const path = require('path');
const { compileContract } = require('../lib/contract_compiler');

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, ...rest] = arg.slice(2).split('=');
    out[k] = rest.length ? rest.join('=') : true;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
const root = path.resolve(__dirname, '..');
const visualConfigPath = path.resolve(args['visual-config'] || process.env.VISUAL_MAPPING_CONFIG || path.join(root, '..', 'import_mapper_vis', 'visual-mapping.config.json'));
const templatePath = path.resolve(args.template || process.env.MAPPING_CONTRACT_TEMPLATE || path.join(root, 'mappings', 'mapping-contract-v2.template.json'));
const schemaPath = path.resolve(args.schema || path.join(root, 'schema', 'weavonpq_weaving.schema.json'));
const outputPath = path.resolve(args.output || process.env.MAPPING_CONTRACT_FILE || path.join(root, 'mappings', 'mapping-contract-v2.json'));
try {
  const result = compileContract({ visualConfigPath, templatePath, schemaPath, outputPath, backupDir: path.join(root, 'mappings', 'backups') });
  console.log(JSON.stringify({ ok: true, outputPath, contractHash: result.contractHash, applied: result.report.applied.length, warnings: result.report.warnings.length, droppedVisualMappings: result.report.droppedVisualMappings.length, silentBusinessRuleReplacements: result.report.silentBusinessRuleReplacements.length }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, report: error.report || null }, null, 2));
  process.exitCode = 1;
}
