'use strict';
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert');
const mysql=require('mysql2/promise');
const {cfg}=require('../scripts/local/db');
const {readState,csvCell,writeJson}=require('../scripts/local/common');
const {iterateCsvRows}=require('../lib/csv_stream');
const {inventory,planEdits}=require('../lib/sheets_sync_plan');
const {SheetsSyncRuntime}=require('../lib/sheets_sync_runtime');
(async()=>{
 const ROOT=path.resolve(__dirname,'..'),DIR=path.join(ROOT,'local_data/erp_integration');
 const proof=JSON.parse(fs.readFileSync(path.join(DIR,'report.json')));assert.equal(proof.database,'weavonpq_erp_sync_test');assert(proof.ok);
 const pool=mysql.createPool({...cfg(),database:proof.database,dateStrings:true});
 try{
  const contract=require('../mappings/mapping-contract-v2.json'),schema=require('../schema/weavonpq_weaving.schema.json');
  const profile=contract.profiles.find(p=>p.id==='yarn-receive'),sourceDir=path.join(DIR,'receipt-fixture');fs.mkdirSync(sourceDir,{recursive:true});
  const file=path.join(sourceDir,profile.source_file);let headers,rows=[];
  for await(const r of iterateCsvRows(path.join(readState().latestCertifiedDir,profile.source_file))){if(!headers){headers=r.values;continue;}if(r.values[headers.indexOf('Challan No')]==='41742440'&&r.values[headers.indexOf('Received Date')]==='2026-08-27'&&r.values[headers.indexOf('Received GD NO')]==='SW/NDSD/GD/26/12532')rows.push(r.values);}
  assert.equal(rows.length,2,'Known duplicate natural-key receipts');
  const save=()=>fs.writeFileSync(file,[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\n')+'\n');save();
  let before=await inventory(sourceDir,[profile]);
  for(const r of before['yarn-receive'].records)await pool.query('INSERT INTO sheets_sync_events(profile,source_uid,group_key,digest,dispo,match_hash) VALUES(?,?,?,?,?,?)',[profile.id,r.uid,r.group,r.digest,r.dispo,r.matchHash]);
  rows.forEach(r=>r[headers.indexOf('Last Received Date')]='2026-09-22');save();
  let current=await inventory(sourceDir,[profile]);let plan=planEdits(before,current);assert(plan.ok);assert.equal(plan.updated,2);
  const runtimePath=path.join(ROOT,'lib/mapping_contract_runtime.js'),m=new Module(runtimePath,module);m.filename=runtimePath;m.paths=Module._nodeModulePaths(path.dirname(runtimePath));m._compile(fs.readFileSync(runtimePath,'utf8')+'\nmodule.exports.__integration={RuntimeContext,processProfile};',runtimePath);
  const {RuntimeContext,processProfile}=m.exports.__integration,meta=JSON.parse(fs.readFileSync(path.join(ROOT,'local_data/sync_package/baseline.meta.json')));
  async function apply(plan,label,fail=false){
   const ctx=new RuntimeContext({rootDir:ROOT,contract,schema,args:{live:true,yes:true,'backup-confirmed':true,'csv-dir':sourceDir,'output-dir':path.join(DIR,label),'run-id':label}});
   ctx.pool=pool;ctx.dateOrder='dmy';ctx.sourceManifestFileSha256='receipt-fixture';ctx.sync=new SheetsSyncRuntime(plan,meta.protectedMasters,'receipt-fixture');await ctx.sync.initialize(ctx);
   if(fail){const finish=ctx.sync.finish.bind(ctx.sync);ctx.sync.finish=async(...a)=>{await finish(...a);throw Error('SIMULATED_FAILURE_AFTER_LEDGER_WRITE');};}
   for(const t of profile.tables){const [cols]=await pool.query('SHOW COLUMNS FROM `'+t.name+'`');ctx.tableColumns[t.name]=new Set(cols.map(c=>c.Field));}
   await processProfile(ctx,profile);return ctx;
  }
  let ctx=await apply(plan,'receipt-update');assert.equal(ctx.rejectedRowCount,0,JSON.stringify(ctx.rejectedRows));
  const [received]=await pool.query("SELECT last_received_date,receipt_qty_kgs FROM yarn_receive_form WHERE challan_no='41742440' AND received_start_date='2026-08-27' AND received_against_dispo_nos='SW/NDSD/GD/26/12532'");
  assert.equal(received.length,2);assert(received.every(r=>r.last_received_date==='2026-09-22'));
  const [events]=await pool.query('SELECT source_uid uid,group_key `group`,digest,dispo,match_hash matchHash FROM sheets_sync_events WHERE profile=?',[profile.id]);
  before={[profile.id]:{headersHash:current[profile.id].headersHash,records:events}};
  rows[0][headers.indexOf('Receipt Qty (Kgs)')]='633';save();current=await inventory(sourceDir,[profile]);plan=planEdits(before,current);assert(plan.ok);assert.equal(plan.updated,1);
  ctx=await apply(plan,'receipt-rollback',true);assert.equal(ctx.rejectedRowCount,1);
  const [after]=await pool.query("SELECT last_received_date,receipt_qty_kgs FROM yarn_receive_form WHERE challan_no='41742440' AND received_start_date='2026-08-27' AND received_against_dispo_nos='SW/NDSD/GD/26/12532'");assert.deepEqual(after,received);
  const [afterEvents]=await pool.query('SELECT source_uid uid,group_key `group`,digest,dispo,match_hash matchHash FROM sheets_sync_events WHERE profile=?',[profile.id]);assert.deepEqual(afterEvents,events);
  // Aggregated daily totals must replace, never add to, the prior normalized total.
  const merged=m.exports._test.mergeDuplicateData({sync:{},duplicateAggregation:{profiles:{loom:{tables:{loom_production_form:{sum:['total_production']}}}}}},{id:'loom'},'loom_production_form',{total_production:100},{total_production:120});assert.equal(merged.total_production,120);
  const report={ok:true,receiptDateEdits:true,duplicateNaturalKeysResolved:true,businessAndLedgerRollbackAtomic:true,aggregateReplacement:true,database:proof.database,verifiedAt:new Date().toISOString()};writeJson(path.join(DIR,'receipt-report.json'),report);console.log(JSON.stringify(report));
 }finally{await pool.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
