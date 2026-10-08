'use strict';
// Local-only integration fixture. Never uses the cPanel database or the preview copy.
const fs=require('fs'),path=require('path'),Module=require('module'),assert=require('assert');
const {spawn}=require('child_process');
const {pipeline}=require('stream/promises');
const {cfg}=require('../scripts/local/db');
const {readState,readJson,writeJson,csvCell}=require('../scripts/local/common');
const mysql=require('mysql2/promise');
const {iterateCsvRows}=require('../lib/csv_stream');
const {inventory,planEdits}=require('../lib/sheets_sync_plan');
const {SheetsSyncRuntime}=require('../lib/sheets_sync_runtime');
const ROOT=path.resolve(__dirname,'..'),TARGET='weavonpq_erp_sync_test';
const DIR=path.join(ROOT,'local_data','erp_integration');
const q=s=>'`'+s.replace(/`/g,'``')+'`';
async function main(){
 fs.mkdirSync(DIR,{recursive:true});
 const state=readState(),manifest=readJson(state.latestFinalExportManifest),local=cfg();
 const admin=await mysql.createConnection(local);let pool;
 try{
  const [existing]=await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[TARGET]);
  if(existing.length)throw Error('Test database already exists; refusing overwrite');
  await admin.query('CREATE DATABASE '+q(TARGET)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
  const p=spawn('C:/xampp/mysql/bin/mysql.exe',['--host='+local.host,'--port='+local.port,'--user='+local.user,TARGET],{env:{...process.env,MYSQL_PWD:local.password},stdio:['pipe','ignore','pipe'],windowsHide:true});
  let errors='';p.stderr.on('data',d=>errors+=d);
  await Promise.all([pipeline(fs.createReadStream(manifest.file),p.stdin),new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error(errors)));})]);
  console.log('Isolated export restored.');
  pool=mysql.createPool({...local,database:TARGET,dateStrings:true});
  await pool.query("CREATE TABLE sheets_sync_events(profile varchar(40),source_uid char(64),group_key char(64),digest char(64),dispo varchar(255),match_hash char(64),yarn_identity longtext,updated_at timestamp DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(profile,source_uid)) ENGINE=InnoDB");
  const [[latest]]=await pool.query("SELECT dispo_number FROM dispo_form_data WHERE dispo_creating_date>='2024-01-01' ORDER BY dispo_creating_date DESC LIMIT 1");
  const contract=require('../mappings/mapping-contract-v2.json'),profile=contract.profiles.find(p=>p.id==='dispo');
  let headers,values;
  for await(const r of iterateCsvRows(path.join(state.latestCertifiedDir,profile.source_file))){if(!headers){headers=r.values;continue;}if(r.values[headers.indexOf('Dispo No.')]==latest.dispo_number){values=r.values;break;}}
  assert(values,'Operational source row found');
  const sourceDir=path.join(DIR,'certified');fs.mkdirSync(sourceDir,{recursive:true});
  const file=path.join(sourceDir,profile.source_file);
  const save=rows=>fs.writeFileSync(file,[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\n')+'\n');
  save([values]);let before=await inventory(sourceDir,[profile]);
  for(const r of before.dispo.records)await pool.query('INSERT INTO sheets_sync_events(profile,source_uid,group_key,digest,dispo) VALUES(?,?,?,?,?)',['dispo',r.uid,r.group,r.digest,r.dispo]);
  const changed=[...values];changed[headers.indexOf('Buyer')]='SYNC INTEGRATION UPDATED';
  const added=[...values];added[headers.indexOf('Dispo No.')]='SYNC/TEST/26/NEW';added[headers.indexOf('Buyer')]='SYNC INTEGRATION NEW';
  save([changed,added]);const current=await inventory(sourceDir,[profile]);
  const plan=planEdits(before,current);assert.equal(plan.ok,true);assert.equal(plan.added,1);assert.equal(plan.updated,1);
  // Expose only for this test process; the production module and its gates are unchanged.
  const runtimePath=path.join(ROOT,'lib/mapping_contract_runtime.js');
  const m=new Module(runtimePath,module);m.filename=runtimePath;m.paths=Module._nodeModulePaths(path.dirname(runtimePath));
  m._compile(fs.readFileSync(runtimePath,'utf8')+'\nmodule.exports.__integration={RuntimeContext,processProfile};',runtimePath);
  const {RuntimeContext,processProfile}=m.exports.__integration;
  const schema=require('../schema/weavonpq_weaving.schema.json');
  const meta=readJson(path.join(ROOT,'local_data/sync_package/baseline.meta.json'));
  const [[old2023]]=await pool.query("SELECT COUNT(*) n,SUM(CRC32(CONCAT_WS('|',dispo_number,buyer_name,dispo_creating_date))) fingerprint FROM dispo_form_data WHERE dispo_creating_date<'2024-01-01'");
  async function apply(plan,label){
   const ctx=new RuntimeContext({rootDir:ROOT,contract,schema,args:{live:true,yes:true,'backup-confirmed':true,'csv-dir':sourceDir,'output-dir':path.join(DIR,label),'run-id':label}});
   ctx.pool=pool;ctx.dateOrder='dmy';ctx.sourceManifestFileSha256='integration-fixture';
   ctx.sync=new SheetsSyncRuntime(plan,meta.protectedMasters,'integration-fixture');await ctx.sync.initialize(ctx);
   for(const t of profile.tables){const [cols]=await pool.query('SHOW COLUMNS FROM '+q(t.name));ctx.tableColumns[t.name]=new Set(cols.map(c=>c.Field));}
   await processProfile(ctx,profile);
   assert.equal(ctx.rejectedRowCount,0,JSON.stringify(ctx.rejectedRows));return ctx;
  }
  await apply(plan,'insert-and-update');
  const [rows]=await pool.query('SELECT dispo_number,buyer_name FROM dispo_form_data WHERE dispo_number IN (?,?)',[latest.dispo_number,'SYNC/TEST/26/NEW']);
  assert.equal(rows.length,2);assert(rows.some(r=>r.buyer_name==='SYNC INTEGRATION UPDATED'));assert(rows.some(r=>r.buyer_name==='SYNC INTEGRATION NEW'));
  const [[new2023]]=await pool.query("SELECT COUNT(*) n,SUM(CRC32(CONCAT_WS('|',dispo_number,buyer_name,dispo_creating_date))) fingerprint FROM dispo_form_data WHERE dispo_creating_date<'2024-01-01'");assert.deepEqual(new2023,old2023);
  const [[countBeforeRetry]]=await pool.query('SELECT COUNT(*) n FROM dispo_form_data');await apply(plan,'replay-identical-plan');
  const [[countAfterRetry]]=await pool.query('SELECT COUNT(*) n FROM dispo_form_data');assert.deepEqual(countAfterRetry,countBeforeRetry);
  const [events]=await pool.query('SELECT source_uid uid,group_key `group`,digest,dispo FROM sheets_sync_events WHERE profile=\'dispo\'');
  const again=planEdits({dispo:{headersHash:current.dispo.headersHash,records:events}},current);assert.equal(again.added+again.updated,0);
  const report={ok:true,database:TARGET,verifiedAt:new Date().toISOString(),insertedDispo:'SYNC/TEST/26/NEW',updatedDispo:latest.dispo_number,insert:true,update:true,replayNoDuplicates:true,unchangedSnapshotNoop:true,retainedDisposUnchanged:true,scope:'Real normalized Dispo rows, sync planner/runtime and MySQL; no Google Sheets were edited; scheduler/hosting not exercised'};
  writeJson(path.join(DIR,'report.json'),report);console.log(JSON.stringify(report));
 }finally{if(pool)await pool.end();await admin.end();}
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
