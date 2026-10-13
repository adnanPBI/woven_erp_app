'use strict';
// Isolated local test database. Never uses the configured business database.
const fs=require('fs/promises'),path=require('path'),os=require('os'),assert=require('assert/strict');
const mysql=require('mysql2/promise'),express=require('express'),dotenv=require('dotenv');
const {createRouter}=require('../lib/database-console');
(async()=>{
 const env=dotenv.parse(await fs.readFile(process.env.ERP_TEST_MYSQL_ENV || (()=>{throw Error('Set ERP_TEST_MYSQL_ENV to a private LOCAL test-server credential file');})(),'utf8'));
 if(!['localhost','127.0.0.1'].includes(env.DB_HOST||'localhost'))throw Error('Local database required.');
 const config={host:env.DB_HOST||'localhost',port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD||''};
 const name='codex_console_test_'+Date.now();if(!/^codex_console_test_\d+$/.test(name))throw Error('Invalid test database.');
 const admin=await mysql.createConnection(config);let pool,server,root;let created=false;let checks=0;
 try{
  await admin.query('CREATE DATABASE `'+name+'`');created=true;pool=mysql.createPool({...config,database:name});
  const ddl=await fs.readFile(path.join(__dirname,'../sync/sql/erp_console_tools.sql'),'utf8');
  for(const statement of ddl.replace(/^--.*$/gm,'').split(';').map(x=>x.trim()).filter(Boolean))await pool.query(statement);
  const historyDdl=await fs.readFile(path.join(__dirname,'../sync/sql/sync_row_history.sql'),'utf8');
  for(const statement of historyDdl.split(';').map(x=>x.trim()).filter(Boolean))await pool.query(statement);
  await pool.query('UPDATE erp_sync_history_meta SET enabled_at=CURRENT_TIMESTAMP-INTERVAL 10 MINUTE');
  await pool.query('CREATE TABLE users (id INT PRIMARY KEY,username VARCHAR(50),role VARCHAR(20)) ENGINE=InnoDB');
  await pool.query("INSERT INTO users VALUES (1,'admin','admin'),(2,'viewer','user'),(3,'owner','user')");
  await pool.query('CREATE TABLE warping_form (id INT PRIMARY KEY,dispo_number VARCHAR(50),warping_date DATE,remarks TEXT) ENGINE=InnoDB');
  await pool.query("INSERT INTO warping_form VALUES (1,'sample/26/1','2026-10-12','before'),(2,'held/26/1','2026-10-12','held')");
  root=await fs.mkdtemp(path.join(os.tmpdir(),'erp-console-db-'));const cycle=path.join(root,'sync_data/cycles/test');await fs.mkdir(cycle,{recursive:true});
  await fs.writeFile(path.join(root,'sync_data/status.json'),JSON.stringify({status:'unchanged',at:new Date().toISOString(),cycle}));
  await fs.writeFile(path.join(cycle,'plan.json'),JSON.stringify({ok:true,exclusions:{dispos:['held/26/1']}}));
  await fs.writeFile(path.join(root,'protection-policy.json'),JSON.stringify({heldCases:Array.from({length:42},()=>({dispo:'held/26/1'})),originalExclusions:Array(14).fill({}),seedDispos:[]}));
  const started=new Date(Date.now()-180000).toISOString();await fs.writeFile(path.join(root,'scheduler.log'),'SYNC_START '+started+'\n{"readOnly":false,"added":0,"updated":0}\nSYNC_SUCCESS '+new Date().toISOString()+'\n');
  const app=express();app.use(express.json());const csrf='b'.repeat(64);app.use((q,s,n)=>{q.session={user:{id:Number(q.get('X-Test-User')||1)},consoleCsrf:csrf};n();});
  app.use('/tools',createRouter({express,pool,syncRoot:root,owners:['owner'],historyClearEnabled:true,expectedDatabase:name}));
  server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  async function call(route,body,user=1){const r=await fetch('http://127.0.0.1:'+server.address().port+'/tools'+route,{method:body===undefined?'GET':'POST',headers:{'X-Test-User':String(user),'Content-Type':'application/json','X-Console-CSRF':csrf},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,data:await r.json()};}
  const expect=(actual,wanted)=>{assert.equal(actual,wanted);checks++;};
  expect((await call('/info',undefined,2)).status,403);
  expect((await call('/access',{userId:2,canView:true})).status,200);
  let result=await call('/rows/warping_form',undefined,2);expect(result.status,200);expect(result.data.rows[0].canEdit,false);expect(result.data.rows[1].eligible,false);
  expect((await call('/row-access/warping_form',{key:{id:1},userId:2})).status,200);
  result=await call('/rows/warping_form',undefined,2);expect(result.data.rows[0].canEdit,true);const fp=result.data.rows[0].fingerprint;
  expect((await call('/edit/warping_form',{key:{id:1},fingerprint:fp,changes:{remarks:'after'}},2)).status,200);
  expect((await call('/edit/warping_form',{key:{id:1},fingerprint:fp,changes:{remarks:'stale'}},2)).status,409);
  const [[audit]]=await pool.query("SELECT COUNT(*) n FROM erp_console_audit WHERE action='edit-row'");expect(audit.n,1);
  expect((await call('/row-access/warping_form',{key:{id:2},userId:2})).status,423);
  expect((await call('/row-access/warping_form',{key:{id:1},lock:true})).status,200);
  result=await call('/rows/warping_form',undefined,2);expect(result.data.rows[0].canEdit,false);
  expect((await call('/access',{userId:2,canView:false})).status,200);expect((await call('/info',undefined,2)).status,403);
  expect((await call('/info',undefined,3)).data.role,'Owner');
  expect((await call('/history')).data.runs.length,1);
  expect((await call('/history/clear',{period:'1h',confirm:'CLEAR_HISTORY_ONLY'})).status,200);
  expect((await call('/history')).data.runs.length,0);expect((await call('/history',undefined,3)).data.runs.length,1);
  const [[business]]=await pool.query('SELECT remarks FROM warping_form WHERE id=1');expect(business.remarks,'after');
  // Actual InnoDB row-history recording, including rolled-back mutations.
  const recorder=require('../sync/lib/sync_row_history');
  await pool.query('CREATE TABLE console_history_fixture(id INT AUTO_INCREMENT PRIMARY KEY,dispo_number VARCHAR(50),qty DECIMAL(12,2),note TEXT) ENGINE=InnoDB');
  const hc=await pool.getConnection();const ctx={conn:hc,sync:{},dryRun:false,runId:'fixture-run',currentSourceDataset:'warping',currentSourceUid:'c'.repeat(64),currentSourceFile:'sample.csv',currentSourceRowNumber:12,syncOperation:{action:'update',dispo:'sample/26/1'}};
  try{
    await hc.beginTransaction();const data={dispo_number:'sample/26/1',qty:4,note:'<script>text only</script>'};const [ins]=await hc.query('INSERT INTO console_history_fixture SET ?',data);await recorder.inserted(ctx,'console_history_fixture',data,ins.insertId);
    let capture=await recorder.before(ctx,'console_history_fixture',{id:ins.insertId});await hc.query('UPDATE console_history_fixture SET qty=7 WHERE id=?',[ins.insertId]);await recorder.updated(ctx,'console_history_fixture',capture);
    capture=await recorder.before(ctx,'console_history_fixture',{id:ins.insertId});await hc.query('DELETE FROM console_history_fixture WHERE id=?',[ins.insertId]);await recorder.deleted(ctx,'console_history_fixture',capture);await hc.commit();
    const [events]=await pool.query('SELECT action,before_json,after_json,row_key,note FROM erp_sync_row_changes ORDER BY id');expect(events.length,3);expect(events[0].action,'added');expect(JSON.parse(events[1].before_json).qty,'4.00');expect(JSON.parse(events[1].after_json).qty,'7.00');expect(JSON.parse(events[2].row_key).id,ins.insertId);expect(events[2].note.startsWith('Detail replacement'),true);
    await hc.beginTransaction();const [retry]=await hc.query('INSERT INTO console_history_fixture SET ?',data);await recorder.inserted(ctx,'console_history_fixture',data,retry.insertId);await hc.rollback();
    const [[noAudit]]=await pool.query('SELECT COUNT(*) n FROM erp_sync_row_changes');expect(noAudit.n,3);
    const [[noBusiness]]=await pool.query('SELECT COUNT(*) n FROM console_history_fixture');expect(noBusiness.n,0);
    // Read changes via authorized HTTP; clearing hides details too.
    const visible=await call('/history',undefined,3);const run=visible.data.runs[0];expect(run.rowCounts.added,1);expect(run.rowCounts.updated,1);expect(run.rowCounts.deleted,1);
    const details=await call('/history/changes?run='+run.id,undefined,3);expect(details.status,200);expect(details.data.rows.length,3);expect(details.data.rows[1].after.qty,'7.00');
    expect((await call('/history/changes?run='+run.id,undefined,1)).status,404);
    // Exercise the actual patched importer helpers, including tables without a PK.
    const runtime=await fs.readFile(path.join(__dirname,'../sync/lib/mapping_contract_runtime.js'),'utf8');
    const helpers=runtime.slice(runtime.indexOf('async function insertRow('),runtime.indexOf('async function deleteChildrenOnce('));
    const api=new Function('syncRowHistory','dbHandle',helpers+';return {insertRow,updateRow,deleteChildren};')(recorder,c=>c.conn);
    await pool.query('CREATE TABLE console_history_nopk(dispo_number VARCHAR(50),qty INT) ENGINE=InnoDB');
    await hc.beginTransaction();
    await api.insertRow(ctx,'console_history_nopk',{dispo_number:'sample/26/2',qty:2});
    await api.insertRow(ctx,'console_history_nopk',{dispo_number:'sample/26/2',qty:3});
    await api.updateRow(ctx,'console_history_nopk',{qty:9},{dispo_number:'sample/26/2'});
    await api.deleteChildren(ctx,'console_history_nopk',{dispo_number:'sample/26/2'});
    const [sets]=await hc.query("SELECT * FROM erp_sync_row_changes WHERE table_name='console_history_nopk' ORDER BY id");
    expect(sets.length,4);expect(sets[0].identity_scope,'submitted-values');expect(sets[2].affected_rows,2);expect(JSON.parse(sets[2].after_json).every(x=>x.qty===9),true);expect(sets[3].action,'deleted');
    await hc.rollback();
    // Audit failure must roll back an importer write too.
    await hc.beginTransaction();
    await hc.query('RENAME TABLE erp_sync_row_changes TO erp_sync_row_changes_disabled');
    await hc.beginTransaction();
    await assert.rejects(()=>api.insertRow(ctx,'console_history_fixture',{dispo_number:'rollback',qty:99}));checks++;
    await hc.rollback();
    const [[failedWrite]]=await hc.query("SELECT COUNT(*) n FROM console_history_fixture WHERE dispo_number='rollback'");expect(failedWrite.n,0);
    await hc.query('RENAME TABLE erp_sync_row_changes_disabled TO erp_sync_row_changes');
  }finally{hc.release();}
  // Prove a failed audit rolls back the actual InnoDB business update.
  await call('/row-access/warping_form',{key:{id:1},userId:1});result=await call('/rows/warping_form');
  await pool.query('RENAME TABLE erp_console_audit TO erp_console_audit_test_disabled');
  expect((await call('/edit/warping_form',{key:{id:1},fingerprint:result.data.rows[0].fingerprint,changes:{remarks:'must rollback'}})).status,503);
  const [[unchanged]]=await pool.query('SELECT remarks FROM warping_form WHERE id=1');expect(unchanged.remarks,'after');
  console.log(JSON.stringify({ok:true,checks,localOnly:true,disposableDatabase:name},null,2));
 }finally{
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(pool)await pool.end();
  if(created)await admin.query('DROP DATABASE `'+name+'`');await admin.end();
  if(root){const resolved=path.resolve(root);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('erp-console-db-'))throw Error('Invalid cleanup directory');await fs.rm(resolved,{recursive:true,force:true});}
 }
})().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
