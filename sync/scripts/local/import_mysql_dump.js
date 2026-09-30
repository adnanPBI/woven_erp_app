#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');
const mysql = require('mysql2/promise');
const { ROOT, DATA_ROOT, ensureDir, loadEnv, updateState } = require('./common');

loadEnv();
const dumpPath = path.resolve(ROOT, process.argv[2] || (fs.existsSync(path.join(ROOT,'weavonpq_weaving.sql')) ? 'weavonpq_weaving.sql' : 'local_input/weavonpq_weaving.sql'));
const targetDb = String(process.env.DB_NAME || 'weavonpq_weaving_local');
const sourceDb = String(process.env.SOURCE_DB_NAME || 'weavonpq_weaving');
if (!/_local$/i.test(targetDb)) throw new Error(`Safety block: local import database must end in _local. Current DB_NAME=${targetDb}`);
if (!fs.existsSync(dumpPath)) throw new Error(`SQL dump not found: ${dumpPath}`);
require('./db').cfg(targetDb);

function discoverMysqlExe() {
  const configured = String(process.env.XAMPP_MYSQL_EXE || '').trim();
  const candidates = [configured, 'C:\\xampp\\mysql\\bin\\mysql.exe', 'mysql'];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.toLowerCase().endsWith('.exe') && fs.existsSync(candidate)) return candidate;
    if (candidate === 'mysql') {
      const probe = spawnSync('mysql', ['--version'], { shell: false, windowsHide: true });
      if (!probe.error && probe.status === 0) return 'mysql';
    }
  }
  throw new Error('MySQL client not found. Start XAMPP and set XAMPP_MYSQL_EXE in .env if XAMPP is installed elsewhere.');
}
function rewriteDatabaseRefs(line) {
  return line
    .replace(new RegExp('`' + sourceDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`', 'g'), '`' + targetDb + '`')
    .replace(new RegExp('^(\\s*USE\\s+)' + sourceDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s*;)', 'i'), `$1${targetDb}$2`)
    .replace(new RegExp('^(\\s*CREATE\\s+DATABASE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+)(`?)' + sourceDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(`?)', 'i'), `$1\`${targetDb}\``)
    .replace(new RegExp('^(\\s*DROP\\s+DATABASE(?:\\s+IF\\s+EXISTS)?\\s+)(`?)' + sourceDb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(`?)', 'i'), `$1\`${targetDb}\``);
}

(async()=>{
  const admin = await mysql.createConnection({ host:process.env.DB_HOST||'127.0.0.1', port:Number(process.env.DB_PORT||3306), user:process.env.DB_USER||'root', password:process.env.DB_PASSWORD||'', charset:'utf8mb4' });
  const [existing] = await admin.query('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?', [targetDb]);
  if (existing.length) { await admin.end(); throw new Error('Refusing to replace an existing local database. Retained rows must be preserved.'); }
  await admin.query(`CREATE DATABASE \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const mysqlExe = discoverMysqlExe();
  const args = ['--host='+(process.env.DB_HOST||'127.0.0.1'),'--port='+(process.env.DB_PORT||'3306'),'--user='+(process.env.DB_USER||'root'),'--default-character-set=utf8mb4','--database='+targetDb];
  const child = spawn(mysqlExe, args, { stdio:['pipe','inherit','inherit'], windowsHide:true, env: {...process.env, MYSQL_PWD: process.env.DB_PASSWORD || ''} });
  const completion = new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
  const rl = readline.createInterface({ input: fs.createReadStream(dumpPath, { encoding:'utf8' }), crlfDelay: Infinity });
  let lines=0;
  let skipViewPlaceholder = false;
  for await (const line of rl) {
    if (/^CREATE TABLE `(order_summary_stats|v_import_manual_dispo_resolution_review)`/.test(line)) skipViewPlaceholder = true;
    if (skipViewPlaceholder) { if (line.trim().endsWith(';')) skipViewPlaceholder = false; continue; }
    // Restore into a newly created database only; never replay destructive dump directives.
    if (/^\s*(DROP\s|TRUNCATE\s|CREATE\s+DATABASE\s|USE\s)/i.test(line)) continue;
    if (!child.stdin.write(rewriteDatabaseRefs(line)+'\n')) await require('events').once(child.stdin, 'drain');
    lines++; if(lines%50000===0)console.log(`[SQL] streamed ${lines.toLocaleString()} lines`);
  }
  child.stdin.end();
  const code = await completion;
  if(code!==0) throw new Error(`mysql import exited with code ${code}`);
  ensureDir(path.join(DATA_ROOT,'baseline'));
  updateState({databaseImportedAt:new Date().toISOString(),databaseDump:dumpPath,databaseName:targetDb});
  console.log(`LOCAL_DB_IMPORT=PASS\nDB=${targetDb}\nDUMP=${dumpPath}`);
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
