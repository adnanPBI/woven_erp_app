#!/usr/bin/env node
'use strict';
const logger = require('../lib/bootstrap_logging');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: false });
function envVal(name, fallback='') {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === '') return fallback;
  return String(v).trim();
}
async function main() {
  const appRoot = path.resolve(__dirname, '..');
  const csvDir = path.resolve(envVal('CSV_DIR', path.join(appRoot, 'csv_files')));
  const logDir = path.resolve(envVal('LOG_DIR', path.join(appRoot, 'output')));
  const dbName = envVal('DB_NAME','weavonpq_weaving');
  const checks = {
    appRoot,
    importJs: path.join(appRoot, 'import.js'),
    importJsExists: fs.existsSync(path.join(appRoot, 'import.js')),
    csvDir,
    csvDirExists: fs.existsSync(csvDir),
    csvFiles: fs.existsSync(csvDir) ? fs.readdirSync(csvDir).filter(f => f.toLowerCase().endsWith('.csv')).length : 0,
    logDir,
    logDirExists: fs.existsSync(logDir),
    appBaseUrl: envVal('APP_BASE_URL'),
    dbName,
    dbConfigured: Boolean(envVal('DB_USER')),
    dbOk: false,
    tableCount: null,
    error: null,
    missingKeyPolicy: envVal('MISSING_KEY_POLICY','salvage'),
    includeSkippedRows: envVal('INCLUDE_SKIPPED_ROWS','true'),
    generateMissingKeys: envVal('GENERATE_MISSING_KEYS','true'),
    createPlaceholderPrecosting: envVal('CREATE_PLACEHOLDER_PRECOSTING','true'),
    createPlaceholderPo: envVal('CREATE_PLACEHOLDER_PO','true'),
    includeWarpBrokenTables: envVal('INCLUDE_WARP_BROKEN_TABLES','false')
  };
  if (checks.dbConfigured) {
    let pool;
    try {
      pool = await mysql.createPool({
        host: envVal('DB_HOST','localhost'),
        port: Number(envVal('DB_PORT','3306')),
        user: envVal('DB_USER'),
        password: envVal('DB_PASSWORD'),
        database: dbName,
        waitForConnections: true,
        connectionLimit: 2
      });
      await pool.query('SELECT 1');
      checks.dbOk = true;
      const [rows] = await pool.query('SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [dbName]);
      checks.tableCount = rows[0].c;
    } catch (e) {
      checks.error = e.message;
    } finally {
      if (pool) await pool.end();
    }
  }
  console.log(JSON.stringify(checks, null, 2));
  if (!checks.importJsExists || !checks.csvDirExists || !checks.dbOk) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exit(1); });
