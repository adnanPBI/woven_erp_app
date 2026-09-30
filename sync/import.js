'use strict';
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '.env'), override: false }); } catch (_error) { /* dotenv is optional when cPanel supplies environment variables. */ }
const logger = require('./lib/bootstrap_logging');
const { parseArgs, runDynamicImport } = require('./lib/mapping_contract_runtime');

runDynamicImport({ rootDir: __dirname, args: parseArgs(process.argv.slice(2)), logger })
  .then((ctx) => {
    const summaryPath = path.join(ctx.outputDir, 'summary.json');
    const result = { ok: true, runId: ctx.runId, mode: ctx.dryRun ? 'dry-run' : 'live', outputDir: ctx.outputDir, summaryPath, stats: ctx.stats };
    logger.info('cli_import_succeeded', 'CLI import command completed.', result);
    console.log(JSON.stringify(result, null, 2));
  })
  .catch((error) => {
    const expected = ['CONTRACT_VALIDATION_FAILED', 'IMPORT_BLOCKING_FINDINGS', 'DRY_RUN_BLOCKING_FINDINGS'].includes(error.code);
    logger[expected ? 'error' : 'fatal']('cli_import_failed', 'CLI import command failed.', { error, argv: process.argv.slice(2) });
    console.error(error);
    process.exitCode = 1;
  });
