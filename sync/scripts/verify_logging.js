#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false });
const { createLogger } = require('../lib/structured_logger');

const rootDir = path.resolve(__dirname, '..');
const logDir = path.resolve(process.env.CLI_APP_LOG_DIR || path.join(process.env.LOG_DIR || path.join(rootDir, 'output'), 'application_logs'));
const testSecret = `logging-test-secret-${Date.now()}`;
const logger = createLogger({ app: 'import-mapper-cli', component: 'logging-self-test', logDir, filePrefix: 'cli-self-test', extraSecrets: [testSecret] });
logger.info('logging_self_test', 'Structured logging self-test.', { sample: 'visible', password: testSecret, nested: { authorization: `Bearer ${testSecret}` } });
logger.error('logging_self_test_error', 'Synthetic test error; no application failure occurred.', { error: new Error(`Synthetic error containing ${testSecret}`) });
const files = logger.listFiles();
const combined = files.map((file) => fs.readFileSync(file.path, 'utf8')).join('\n');
if (combined.includes(testSecret)) throw new Error('Logging redaction self-test failed: secret appeared in log output.');
if (!combined.includes('[REDACTED]')) throw new Error('Logging redaction self-test failed: redaction marker was not found.');
process.stdout.write(`${JSON.stringify({ ok: true, logDir, files: files.map((file) => file.path), redactionVerified: true }, null, 2)}\n`);
