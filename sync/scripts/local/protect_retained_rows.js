'use strict';
const crypto = require('crypto');
const path = require('path');
const {connect} = require('./db');
const {DATA_ROOT, writeJson} = require('./common');
const contract = require('../../mappings/mapping-contract-v2.json');
const tables = [...new Set(contract.profiles.flatMap(p => p.tables.map(t => t.name)))];
const primaryDates = {PO_form_data:'po_issue_date',dispo_form_data:'dispo_creating_date',yarn_receive_form:'received_start_date',yarn_issue_form:'issue_date',warping_form:'warping_date',sizing_form:'sizing_date',loom_production_form:'weaving_date',folding_production_form:'folding_production_date',greige_delivery_form:'delivery_date'};
const q = s => '`' + s.replace(/`/g, '``') + '`';
const fingerprint = (cols, prefix = '') => `SHA2(CAST(JSON_ARRAY(${cols.map(c => prefix + q(c)).join(',')}) AS CHAR),256)`;
async function loadRetainedMasterKeys(c) {
  const result = {};
  for (const [table,key] of [['pre_costing_data','pre_costing_no'],['PO_form_data','po_no'],['dispo_plan_form','dispo_no'],['dispo_form_data','dispo_number']]) {
    const [cols] = await c.query(`SHOW COLUMNS FROM ${q(table)}`);
    const [rows] = await c.query(`SELECT t.${q(key)} value FROM ${q(table)} t JOIN local_retained_fingerprints b ON b.table_name=? AND b.row_sha=${fingerprint(cols.map(x=>x.Field),'t.')}`, [table]);
    result[table] = {key, values:new Set(rows.map(r=>String(r.value||'').trim().toLowerCase()))};
  }
  return result;
}
function isRetainedMaster(keys, table, data) {
  const spec = keys?.[table];
  return Boolean(spec && spec.values.has(String(data[spec.key]||'').trim().toLowerCase()));
}
async function protect(verifyOnly = false) {
  const c = await connect();
  const results = [];
  try {
    if (!verifyOnly) {
      await c.query('CREATE TABLE IF NOT EXISTS local_retained_fingerprints (table_name varchar(64) NOT NULL, row_sha char(64) NOT NULL, occurrences bigint NOT NULL, PRIMARY KEY(table_name,row_sha)) ENGINE=InnoDB');
      await c.query('CREATE TABLE IF NOT EXISTS local_retained_tables (table_name varchar(64) PRIMARY KEY, captured_at timestamp DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB');
    }
    for (const table of tables) {
      const [columns] = await c.query(`SHOW COLUMNS FROM ${q(table)}`);
      const cols = columns.map(x => x.Field);
      const hash = fingerprint(cols);
      const [captured] = await c.query('SELECT table_name FROM local_retained_tables WHERE table_name=?', [table]);
      if (!captured.length) {
        if (verifyOnly) throw new Error(`Missing retained baseline: ${table}`);
        await c.beginTransaction();
        try {
          await c.query(`INSERT INTO local_retained_fingerprints SELECT ?, ${hash}, COUNT(*) FROM ${q(table)} GROUP BY ${hash}`, [table]);
          await c.query('INSERT INTO local_retained_tables(table_name) VALUES (?)', [table]);
          await c.commit();
        } catch (e) {await c.rollback(); throw e;}
      }
      for (const event of ['UPDATE','DELETE']) {
        const name = 'local_preserve_' + crypto.createHash('sha256').update(table + event).digest('hex').slice(0,20);
        const [found] = await c.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?', [name]);
        if (!found.length) {
          if (verifyOnly) throw new Error(`Missing preservation trigger: ${table}/${event}`);
          await c.query(`CREATE TRIGGER ${q(name)} BEFORE ${event} ON ${q(table)} FOR EACH ROW BEGIN IF EXISTS (SELECT 1 FROM local_retained_fingerprints WHERE table_name=${c.escape(table)} AND row_sha=${fingerprint(cols,'OLD.')}) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Retained baseline row is immutable'; END IF; END`);
        }
      }
      if (primaryDates[table]) {
        const window = require('../../config/local_google_sheets.json').window;
        if (window.start !== '2024-01-01' || !/^202[4-6]-\d{2}-\d{2}$/.test(window.end)) throw new Error('Invalid local migration date window.');
        for (const event of ['INSERT','UPDATE']) {
          const name = 'local_window_' + crypto.createHash('sha256').update(table + event).digest('hex').slice(0,20);
          const [found] = await c.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?',[name]);
          if (!found.length) {
            if (verifyOnly) throw new Error(`Missing date-window trigger: ${table}/${event}`);
            const field = 'NEW.' + q(primaryDates[table]);
            await c.query(`CREATE TRIGGER ${q(name)} BEFORE ${event} ON ${q(table)} FOR EACH ROW BEGIN IF ${field} IS NULL OR ${field}<${c.escape(window.start)} OR ${field}>${c.escape(window.end)} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Business date outside local migration window'; END IF; END`);
          }
        }
      }
      const [actual] = await c.query(`SELECT ${hash} row_sha, COUNT(*) n FROM ${q(table)} GROUP BY ${hash}`);
      const [baseline] = await c.query('SELECT row_sha, occurrences FROM local_retained_fingerprints WHERE table_name=?', [table]);
      const counts = new Map(actual.map(r=>[r.row_sha,Number(r.n)]));
      results.push({table, retainedRows:baseline.reduce((n,r)=>n+Number(r.occurrences),0), changedFingerprints:baseline.filter(r=>(counts.get(r.row_sha)||0)<Number(r.occurrences)).length});
    }
    const report = {ok:results.every(r=>r.changedFingerprints===0), database:'weavonpq_weaving_local', checkedAt:new Date().toISOString(), tables:results};
    writeJson(path.join(DATA_ROOT,'verification',verifyOnly?'retained_rows_verified.json':'retained_rows_baseline.json'), report);
    if (!report.ok) throw new Error('Retained rows changed; see verification report.');
    return report;
  } finally {await c.end();}
}
if (require.main === module) protect(process.argv.includes('--verify')).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports = {protect, loadRetainedMasterKeys, isRetainedMaster};
