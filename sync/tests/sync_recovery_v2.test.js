'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const v2=require('../lib/sync_recovery_v2');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture({
  plan={ok:true,added:0,updated:0,refreshed:0,operations:{},conflicts:[]},
  time='2026-11-03T05:00:00.000Z',
}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'weaving-v2-'));
 const cycle=path.join(root,'cycles','2026-11-03T05-00-00-000Z');
 fs.mkdirSync(cycle,{recursive:true});
 const manifest=path.join(cycle,'source-manifest.json');
 const planFile=path.join(cycle,'plan.json');
 fs.writeFileSync(manifest,JSON.stringify({ok:true,date:'2026-11-03',nonce:'source-file'}));
 fs.writeFileSync(planFile,JSON.stringify(plan));
 fs.writeFileSync(path.join(cycle,'local_state.json'),JSON.stringify({latestSourceManifest:manifest}));
 const clear=()=>fs.rmSync(root,{recursive:true,force:true});
 return {root,cycle,manifest,planFile,time,clear};
}
test('72-hour outage is detected and unchanged source reconciliation advances last-good checkpoint',()=>{
 const f=fixture();
 try{
  const prior={status:'unchanged',cycle:f.cycle,at:f.time};
  const state=v2.begin(f.root,{cycle:f.cycle,previousStatus:prior,now:'2026-11-06T05:00:00.000Z'});
  assert.equal(state.current.catchUp,true);
  assert.equal(state.current.missedIntervals,431);
  assert.equal(state.lastVerified.origin,'verified-v1-cycle');
  v2.stage(f.root,'planning',{manifestHash:hash(fs.readFileSync(f.manifest))});
  const done=v2.success(f.root,{cycle:f.cycle,sourceManifest:f.manifest,planFile:f.planFile,
    result:'unchanged',verified:true,now:'2026-11-06T05:01:00.000Z'});
  assert.equal(done.current.state,'verified');
  assert.equal(done.lastVerified.at,'2026-11-06T05:01:00.000Z');
  assert.equal(done.lastRecovery.hadBacklog,true);
  assert.equal(done.lastRecovery.missedIntervals,431);
  assert.equal(v2.publicView(f.root).catchUpNeeded,false);
 }finally{f.clear();}
});
test('first v2 cycle catches up after a failed legacy fetch and retries transport deadlines',async()=>{
 const f=fixture();
 try{
  const s=v2.begin(f.root,{cycle:f.cycle,previousStatus:{status:'failed',cycle:f.cycle,
    error:'fetch_google_sheets.js failed'},now:'2026-11-04T04:20:00.000Z'});
  assert.equal(s.current.catchUp,true);
  assert.equal(v2.categorize(Error('fetch_google_sheets.js failed'),'fetch-retry'),'source-download');
  assert.equal(v2.transientSourceError(Error('fetch failed'), 'google-read-retry reason: deadline-or-abort'),true);
  assert.equal(v2.transientSourceError(Error('HTTP 403'),'deadline-or-abort'),false);
 }finally{f.clear();}
});
test('SQL-completed checkpoint requires matching frozen plan and independent readback receipt',()=>{
 const f=fixture({plan:{ok:true,added:1,updated:0,refreshed:0,
   operations:{po:[{action:'insert'}]},conflicts:[]}});
 try{
  v2.begin(f.root,{cycle:f.cycle});
  const complete=()=>v2.success(f.root,{cycle:f.cycle,sourceManifest:f.manifest,
    planFile:f.planFile,result:'completed',verified:true});
  assert.throws(complete,/ENOENT/);
  const receiptFile=path.join(f.cycle,'business-verification.json');
  fs.writeFileSync(receiptFile,JSON.stringify({ok:true,manifestHash:'bad',planHash:v2.fileHash(f.planFile),targetsVerified:2}));
  assert.throws(complete,/matching SQL/);
  fs.writeFileSync(receiptFile,JSON.stringify({ok:true,manifestHash:v2.fileHash(f.manifest),
    planHash:v2.fileHash(f.planFile),targetsVerified:2}));
  const s=complete();
  assert.equal(s.lastVerified.result,'completed');
  assert.equal(s.lastVerified.counts.insert,1);
  assert.equal(s.current.state,'verified');
 }finally{f.clear();}
});
test('failed source fetch never advances verified checkpoint, and next cron detects catch-up',()=>{
 const f=fixture();
 try{
  v2.begin(f.root,{cycle:f.cycle,previousStatus:{status:'unchanged',cycle:f.cycle,at:f.time},now:'2026-11-03T05:15:00.000Z'});
  v2.stage(f.root,'fetching');
  v2.failure(f.root,{error:Error('ETIMEDOUT during Google values retrieval'),phase:'fetching',now:'2026-11-03T05:16:00.000Z'});
  let s=v2.read(f.root);
  assert.equal(s.lastVerified.at,f.time);
  assert.equal(s.consecutiveFailures,1);
  assert.equal(s.lastFailure.category,'source-download');
  s=v2.begin(f.root,{cycle:f.cycle,previousStatus:{status:'failed'},now:'2026-11-03T05:20:00.000Z'});
  assert.equal(s.current.catchUp,true);
  assert.equal(s.current.priorFailureCategory,'source-download');
  assert.equal(s.lastVerified.at,f.time);
 }finally{f.clear();}
});
test('partially applied pending SQL never creates a verified checkpoint or a duplicate replay claim',()=>{
 const f=fixture({plan:{ok:true,added:1,updated:0,refreshed:0,operations:{po:[{action:'insert'}]},conflicts:[]}});
 try{
  v2.begin(f.root,{cycle:f.cycle,previousStatus:{status:'failed'},pending:true});
  v2.stage(f.root,'applying');
  fs.writeFileSync(path.join(f.root,'pending.json'),JSON.stringify({cycle:f.cycle,manifestHash:'a'.repeat(64),planHash:'b'.repeat(64)}));
  v2.unexpected(f.root,{pending:true});
  const report=v2.publicView(f.root);
  assert.equal(report.lastVerifiedAt,null);
  assert.equal(report.lastFailure.category,'worker-interrupted');
  assert.equal(report.lastFailure.pendingFrozenPlan,true);
  assert.equal(report.current.state,'failed');
  assert.equal(report.catchUpNeeded,true);
 }finally{f.clear();}
});
test('no checkpoint for read-only runs, unverified applies, conflicts or deletion plans',()=>{
 const f=fixture({plan:{ok:false,added:0,updated:0,refreshed:0,operations:{},conflicts:[{reason:'ambiguous'}]}});
 try{
  v2.begin(f.root,{cycle:f.cycle});
  v2.observed(f.root,'plan-only');
  assert.equal(v2.read(f.root).lastVerified,null);
  assert.throws(()=>v2.success(f.root,{cycle:f.cycle,sourceManifest:f.manifest,planFile:f.planFile,result:'unchanged',verified:true}),/conflicted/);
  const contents={ok:true,added:0,updated:0,refreshed:0,operations:{dispo:[{action:'delete'}]},conflicts:[]};
  fs.writeFileSync(f.planFile,JSON.stringify(contents));
  assert.throws(()=>v2.success(f.root,{cycle:f.cycle,sourceManifest:f.manifest,planFile:f.planFile,result:'unchanged',verified:true}),/delete plan/);
  fs.writeFileSync(f.planFile,JSON.stringify({ok:true,added:0,updated:0,refreshed:0,operations:{},conflicts:[]}));
  assert.throws(()=>v2.success(f.root,{cycle:f.cycle,sourceManifest:f.manifest,planFile:f.planFile,result:'completed',verified:false}),/verified terminal/);
 }finally{f.clear();}
});
test('bounded transient retries succeed after two failures without any additional SQL interaction',async()=>{
 const f=fixture();
 try{
  const log=path.join(f.cycle,'worker.log');fs.writeFileSync(log,'network ETIMEDOUT\n');
  let calls=0;const retries=[],sleeps=[];
  const got=await v2.fetchWithRetries(async()=>{calls++;if(calls<=2)throw Error('fetch_google_sheets.js failed');return 'certified';},
   {logFile:log,onRetry:async count=>retries.push(count),sleep:async ms=>{sleeps.push(ms);}});
  assert.equal(got,'certified');assert.equal(calls,3);
  assert.deepEqual(retries,[1,2]);assert.deepEqual(sleeps,[4000,12000]);
 }finally{f.clear();}
});
test('fatal 403/404, duplicate identity errors and any third transient failure do not auto-retry',async()=>{
 const f=fixture();
 try{
  const log=path.join(f.cycle,'worker.log');fs.writeFileSync(log,'');
  for(const code of ['HTTP 403 permission denied','HTTP 404 missing sheet','source identity conflict']){
   let calls=0;
   await assert.rejects(v2.fetchWithRetries(async()=>{calls++;throw Error(code);},{logFile:log,sleep:async()=>{}}));
   assert.equal(calls,1,code);
  }
  fs.writeFileSync(log,'ETIMEDOUT');
  let calls=0;
  await assert.rejects(v2.fetchWithRetries(async()=>{calls++;throw Error('source fetch failed');},{logFile:log,sleep:async()=>{}}));
  assert.equal(calls,3);
 }finally{f.clear();}
});
test('protected checkpoint corruption and symlinks fail closed',()=>{
 const f=fixture();
 try{
  fs.writeFileSync(path.join(f.root,'recovery-v2.json'),'{bad');
  assert.throws(()=>v2.read(f.root));
  fs.unlinkSync(path.join(f.root,'recovery-v2.json'));
  const outside=path.join(f.root,'outside.json');fs.writeFileSync(outside,'{}');
  fs.symlinkSync(outside,path.join(f.root,'recovery-v2.json'));
  assert.throws(()=>v2.read(f.root),/regular bounded file/);
 }finally{f.clear();}
});
test('preflight storage failure creates an explicit diagnostic without changing previous verification',()=>{
 const f=fixture();
 try{
  v2.begin(f.root,{cycle:f.cycle,previousStatus:{status:'unchanged',cycle:f.cycle,at:f.time}});
  const old=v2.read(f.root).lastVerified;
  v2.preflightFailure(f.root,'hosting-capacity');
  const s=v2.read(f.root);
  assert.deepEqual(s.lastVerified,old);
  assert.equal(s.lastFailure.category,'hosting-capacity');
  assert.equal(s.consecutiveFailures,1);
 }finally{f.clear();}
});
test('failure classification separates source, identity, SQL, backup and verification',()=>{
 assert.equal(v2.categorize(Error('ETIMEDOUT'), 'fetching'),'source-download');
 assert.equal(v2.categorize(Error('Source identity conflict: existing'), 'planning'),'source-identity');
 assert.equal(v2.categorize(Error('pre-sync backup failed'),'backing-up'),'backup');
 assert.equal(v2.categorize(Error('update failed'),'applying'),'sql-execution');
 assert.equal(v2.categorize(Error('readback mismatch'),'verifying'),'verification');
 assert.equal(v2.categorize(Error('disk reserve exhausted'),'fetching'),'hosting-capacity');
});
