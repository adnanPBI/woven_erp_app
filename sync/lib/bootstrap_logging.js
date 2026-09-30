'use strict';

const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false }); } catch (_error) { /* dotenv is optional when cPanel supplies environment variables. */ }
const { createLogger, installConsoleBridge, installProcessHandlers } = require('./structured_logger');

if (!global.__IMPORT_MAPPER_CLI_LOGGER__) {
  const rootDir = path.resolve(__dirname, '..');
  const logDir = path.resolve(process.env.CLI_APP_LOG_DIR || path.join(process.env.LOG_DIR || path.join(rootDir, 'output'), 'application_logs'));
  const runId = String(process.env.IMPORT_RUN_ID || '').trim() || undefined;
  const logger = createLogger({
    app: 'import-mapper-cli',
    component: path.basename(process.argv[1] || 'node'),
    logDir,
    filePrefix: 'cli',
    baseContext: { runId },
  });
  installProcessHandlers(logger);
  installConsoleBridge(logger, { echo: true });
  logger.info('process_started', 'CLI process started', {
    argv: process.argv.slice(1),
    cwd: process.cwd(),
    nodeVersion: process.version,
    execPath: process.execPath,
  });
  process.on('exit', (code) => logger.info('process_exit', 'CLI process exiting', { exitCode: code }));
  global.__IMPORT_MAPPER_CLI_LOGGER__ = logger;
}

module.exports = global.__IMPORT_MAPPER_CLI_LOGGER__;
