'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const rec=require('../lib/sync_recovery_v2');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
test('outage catch-up, bounded network retries, verified checkpoint and repeat idempotence',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'weaving-recovery-v2-'));
 const mk=(name,operations={folding:[]},conflicts=[])=>{
  const folder=path.join(dir,'cycles',name);fs.mkdirSync(folder,{recursive:true});
  const manifest=path.join(folder,'source.json'),planFile=path.join(folder,'plan.json');
  const ops=Object.values(operations).flat(),count=a=>ops.filter(r=>r.action===a).length;
  const plan={ok:conflicts.length===0,conflicts,operations,added:count('insert'),updated:count('update'),refreshed:count('refresh')};
  fs.writeFileSync(manifest,JSON.stringify({cycle:name,content:'valid-snapshot'}));
  fs.writeFileSync(planFile,JSON.stringify(plan));
  const receipt={ok:true,manifestHash:sha(fs.readFileSync(manifest)),planHash:sha(fs.readFileSync(planFile)),targetsVerified:ops.length};
  fs.writeFileSync(path.join(folder,'business-verification.json'),JSON.stringify(receipt));
  return {cycle:folder,sourceManifest:manifest,planFile};
 };
 try{
  const t0='2026-11-03T00:00:00.000Z';
  const initial=mk('baseline');
  rec.begin(dir,{cycle:initial.cycle,previousStatus:null,now:t0});
  rec.success(dir,{...initial,result:'unchanged',verified:true,now:t0});
  assert.equal(rec.read(dir).lastVerified.result,'unchanged');
  const outage=mk('outage');
  rec.begin(dir,{cycle:outage.cycle,previousStatus:null,now:'2026-11-03T01:00:00.000Z'});
  let current=rec.read(dir);
  assert.equal(current.current.catchUp,true);
  assert.equal(current.current.missedIntervals,5);
  rec.failure(dir,{error:Error('ETIMEDOUT'),phase:'fetching',now:'2026-11-03T01:00:01.000Z'});
  assert.equal(rec.read(dir).lastVerified.cycle,initial.cycle,'failed fetch cannot advance checkpoint');
  const retry=mk('retry',{folding:[{action:'update',sourceUid:'unique-uid'}]});
  rec.begin(dir,{cycle:retry.cycle,previousStatus:{status:'failed'},now:'2026-11-03T01:10:00.000Z'});
  let attempts=0,retries=0;
  await rec.fetchWithRetries(async()=>{attempts++;if(attempts<3)throw Error('ECONNRESET');return 'fetched';},
   {backoffs:[1,2],sleep:async()=>{},onRetry:async()=>{retries++}});
  assert.equal(attempts,3);assert.equal(retries,2);
  rec.success(dir,{...retry,result:'completed',verified:true,now:'2026-11-03T01:12:00.000Z'});
  assert.equal(rec.read(dir).lastVerified.counts.update,1);
  assert.equal(rec.read(dir).consecutiveFailures,0);
  const repeat=mk('repeat');
  rec.begin(dir,{cycle:repeat.cycle,previousStatus:null,now:'2026-11-03T01:20:00.000Z'});
  rec.success(dir,{...repeat,result:'unchanged',verified:true,now:'2026-11-03T01:20:01.000Z'});
  assert.deepEqual(rec.read(dir).lastVerified.counts,{insert:0,update:0,refresh:0});
  const conflict=mk('conflict',{folding:[{action:'insert'}]},[{reason:'source-identity'}]);
  rec.begin(dir,{cycle:conflict.cycle,previousStatus:null,now:'2026-11-03T01:30:00.000Z'});
  assert.throws(()=>rec.success(dir,{...conflict,result:'completed',verified:true}),/conflicted plan/);
  assert.equal(rec.read(dir).lastVerified.cycle,repeat.cycle);
  const forbidden=mk('delete',{folding:[{action:'delete'}]});
  rec.begin(dir,{cycle:forbidden.cycle,previousStatus:null,now:'2026-11-03T01:40:00.000Z'});
  assert.throws(()=>rec.success(dir,{...forbidden,result:'completed',verified:true}),/delete plan/);
  assert.equal(rec.read(dir).lastVerified.cycle,repeat.cycle);
  assert.equal(rec.transientSourceError(Error('401 Unauthorized'),''),false);
  assert.equal(rec.transientSourceError(Error('network is unreachable'),''),true);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
