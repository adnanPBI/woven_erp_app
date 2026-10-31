'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const fs=require('fs/promises');
const os=require('os');
const path=require('path');
const {createRouter,parseHistory,fingerprint}=require('../lib/database-console');

test('history distinguishes verified completion, worker-only results, gaps, active and failed runs',()=>{
  const text=[
    'SYNC_START 2026-10-12T00:05:00Z','{"readOnly":false,"added":0,"updated":0}',
    'SYNC_SUCCESS 2026-10-12T00:09:00Z','SYNC_START 2026-10-12T00:15:00Z',
    '{"readOnly":false,"added":0,"updated":0}',
    'SYNC_START 2026-10-12T00:35:00Z','FATAL ERROR heap out of memory',
    'SYNC_START 2026-10-12T00:45:00Z','{"broken'
  ].join('\n');
  const runs=parseHistory(text,Date.parse('2026-10-12T00:46:00Z'));
  assert.deepEqual(runs.map(r=>r.status),['unchanged','unconfirmed','failed','running']);
  assert.equal(runs[2].gapMinutes,20);assert.equal(runs[1].endedAt,null);
  assert.equal(parseHistory(text,Date.parse('2026-10-12T01:00:00Z')).at(-1).status,'unconfirmed');
  assert.deepEqual(parseHistory('SYNC_SUCCESS 2026-10-12T00:10:00Z'),[]);
});

test('failed intervals retain their finish time, exit code and safe actionable reason',()=>{
 const [run]=parseHistory('SYNC_START 2026-10-31T03:30:21Z\nError: Ambiguous edits/deletions or changed keys require review: /private/cycle/plan.json\nSYNC_FAILURE 2026-10-31T03:33:13Z exit_code=7');
 assert.equal(run.status,'failed');assert.equal(run.endedAt,'2026-10-31T03:33:13Z');assert.equal(run.exitCode,7);
 assert.match(run.failureReason,/Source identity conflict/);assert.doesNotMatch(JSON.stringify(run),/private|plan.json/);
});

test('HTTP access boundaries, default locks, hold checks, stale reads and audit atomicity',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'erp-console-test-'));
  const cycle=path.join(root,'sync_data/cycles/test');await fs.mkdir(cycle,{recursive:true});
  const status={status:'unchanged',at:new Date().toISOString(),cycle};
  await fs.writeFile(path.join(root,'sync_data/status.json'),JSON.stringify(status));
  await fs.writeFile(path.join(cycle,'plan.json'),JSON.stringify({ok:true,exclusions:{dispos:['held/26/1']}}));
  await fs.writeFile(path.join(root,'protection-policy.json'),JSON.stringify({heldCases:Array.from({length:42},()=>({dispo:'held/26/1'})),originalExclusions:Array(14).fill({}),seedDispos:['held/26/1']}));
  await fs.writeFile(path.join(root,'scheduler.log'),'SYNC_START 2026-10-12T00:05:00Z\n{"readOnly":false,"added":0,"updated":0}\nSYNC_SUCCESS 2026-10-12T00:09:00Z\n');
  const columns=[['id','int','PRI'],['dispo_number','varchar','MUL'],['warping_date','date',''],['remarks','text','']].map(([n,d,k])=>({TABLE_NAME:'warping_form',COLUMN_NAME:n,DATA_TYPE:d,COLUMN_TYPE:d,COLUMN_KEY:k}));
  const user={id:1,username:'admin-person',role:'admin'};let access=false,grant=false,held=false,auditFail=false,syncBusy=false;
  let row={id:5,dispo_number:'open/26/1',warping_date:'2026-01-01',remarks:'original'};let before;const writes=[];
  const c={beginTransaction:async()=>{before={...row};},commit:async()=>{},rollback:async()=>{if(before)row={...before};},release:()=>{},query:async(sql,args=[])=>{
    if(sql==='SELECT DATABASE() name')return [[{name:'weavonpq_weaving_main'}]];
    if(sql.includes('information_schema.COLUMNS'))return [columns];
    if(sql.startsWith('SELECT id,username,role FROM users'))return [[user]];
    if(sql.startsWith('SELECT username,role FROM users'))return [[user]];
    if(sql.startsWith('SELECT can_view'))return [[{can_view:access?1:0}]];
    if(sql.startsWith('SELECT row_hash,user_id'))return [[]];
    if(sql.startsWith('SELECT user_id FROM erp_console_row_grants'))return [grant?[{user_id:user.id}]:[]];
    if(sql.startsWith('SELECT GET_LOCK'))return [[{acquired:syncBusy?0:1}]];
    if(sql.startsWith('SELECT RELEASE_LOCK'))return [[{released:1}]];
    if(sql.startsWith('SELECT CAST(from_at'))return [[]];
    if(sql.startsWith('SELECT UNIX_TIMESTAMP(enabled_at)'))return [[{enabled_epoch:0}]];
    if(sql.startsWith('SELECT run_id,MIN'))return [[]];
    if(sql.includes('FROM `warping_form`'))return [[{...row,dispo_number:held?'held/26/1':row.dispo_number}]];
    if(sql.startsWith('UPDATE `warping_form`')){writes.push(sql);row.remarks=args[0];return [{affectedRows:1}];}
    if(sql.startsWith('INSERT INTO erp_console_audit')){if(auditFail)throw Error('audit unavailable');return [{affectedRows:1}];}
    throw Error('Unexpected test query: '+sql);
  }};
  const pool={query:c.query,getConnection:async()=>c};const app=express();app.use(express.json());
  const csrf='a'.repeat(64);app.use((req,res,next)=>{if(req.get('X-Test-Session'))req.session={user:{id:1,role:'admin'},consoleCsrf:csrf};next();});
  app.use('/tools',createRouter({express,pool,syncRoot:root,owners:['owner-person']}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
  async function request(url,body,extra={}){return fetch(base+'/tools'+url,{method:body===undefined?'GET':'POST',headers:{'X-Test-Session':'yes',...(body===undefined?{}:{'Content-Type':'application/json','X-Console-CSRF':csrf}),...extra},body:body===undefined?undefined:JSON.stringify(body)});}
  const edit=()=>({key:{id:5},fingerprint:fingerprint(row),changes:{remarks:'changed'}});
  try{
    await t.test('anonymous requests denied',async()=>assert.equal((await fetch(base+'/tools/info')).status,401));
    await t.test('current role overrides stale admin session',async()=>{user.role='user';assert.equal((await request('/info')).status,403);access=true;assert.equal((await request('/access')).status,403);});
    await t.test('explicit owner has manager access',async()=>{user.username='owner-person';const r=await request('/info');assert.equal(r.status,200);assert.equal((await r.json()).role,'Owner');user.username='admin-person';user.role='admin';});
    await t.test('no access to credentials or SQL identifier injection',async()=>{for(const name of ['users','sessions','sheets_sync_events','warping_form;DROP TABLE users'])assert.equal((await request('/rows/'+encodeURIComponent(name))).status,404);});
    await t.test('CSRF and cross-site mutations rejected',async()=>{for(const value of ['', 'é'.repeat(64),'b'.repeat(64)])assert.equal((await request('/edit/warping_form',edit(),{'X-Console-CSRF':value})).status,403);assert.equal((await request('/edit/warping_form',edit(),{'Sec-Fetch-Site':'cross-site'})).status,403);});
    await t.test('admin cannot edit default-locked row',async()=>{assert.equal((await request('/edit/warping_form',edit())).status,403);assert.equal(writes.length,0);grant=true;});
    await t.test('held and historical rows remain locked despite grant',async()=>{held=true;assert.equal((await request('/edit/warping_form',edit())).status,423);held=false;row.warping_date='2023-10-12';assert.equal((await request('/edit/warping_form',edit())).status,423);row.warping_date='2026-01-01';});
    await t.test('quantities and key changes not accepted as notes',async()=>{const body=edit();body.changes={actual_warp_length_mtr:'100'};assert.equal((await request('/edit/warping_form',body)).status,400);body.changes={id:6};assert.equal((await request('/edit/warping_form',body)).status,400);});
    await t.test('concurrent sync and stale row rejected',async()=>{syncBusy=true;assert.equal((await request('/edit/warping_form',edit())).status,423);syncBusy=false;const body=edit();body.fingerprint='old';assert.equal((await request('/edit/warping_form',body)).status,409);});
    await t.test('note update rolls back when audit fails',async()=>{auditFail=true;assert.equal((await request('/edit/warping_form',edit())).status,503);assert.equal(row.remarks,'original');auditFail=false;});
    await t.test('eligible granted note is saved',async()=>{assert.equal((await request('/edit/warping_form',edit())).status,200);assert.equal(row.remarks,'changed');});
    await t.test('stale protection evidence fails closed',async()=>{await fs.writeFile(path.join(root,'sync_data/status.json'),JSON.stringify({...status,at:'2020-01-01T00:00:00Z'}));assert.equal((await request('/edit/warping_form',edit())).status,423);});
    await t.test('history clear stays disabled pending user decision',async()=>assert.equal((await request('/history/clear',{period:'1h',confirm:'CLEAR_HISTORY_ONLY'})).status,409));
    await t.test('history returns only parsed safe fields',async()=>{const r=await request('/history');assert.equal(r.status,200);const data=await r.json();assert.equal(data.runs[0].status,'unchanged');assert.equal(JSON.stringify(data).includes('scheduler.log'),false);});
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});}
});
