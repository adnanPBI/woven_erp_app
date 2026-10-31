'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs/promises'),os=require('os'),path=require('path');
const {coverage,notice}=require('../lib/sync-coverage');
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sync-coverage-'));
 async function write(file,value){await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});await fs.writeFile(path.join(root,file),typeof value==='string'?value:JSON.stringify(value));}
 const plan={ok:true,added:0,updated:0,refreshed:0,conflicts:[]};
 const status=(dir,extra={})=>({status:'unchanged',at:new Date().toISOString(),cycle:path.join(root,dir,'cycles/current'),...extra});
 await write('sync_data/status.json',status('sync_data'));
 await write('sync_data/cycles/current/plan.json',{...plan,exclusions:{skippedOperations:{po:13061},skippedConflicts:Array(243).fill({}),dispos:Array(11438).fill('held'),yarnLots:Array(3631).fill('held')}});
 await write('.env.sync','SYNC_DATA_DIR="'+path.join(root,'active').replace(/\\/g,'/')+'"\nDB_PASSWORD=private-fixture-secret\n');
 await write('active/status.json',status('active',{status:'failed',error:'Ambiguous edits/deletions or changed keys require review: /private/plan.json'}));
 await write('active/cycles/current/plan.json',{...plan,ok:false,added:44,updated:8,conflicts:[{profile:'yarn-issue'}],manualSkips:{skippedCurrentRows:6}});
 return {root,write,status,plan,close:()=>fs.rm(root,{recursive:true,force:true})};
}
test('history coverage follows the active worker directory instead of obsolete legacy totals',async()=>{
 const f=await fixture();try{const c=await coverage(f.root);assert.equal(c.state,'blocked');assert.equal(c.unresolvedConflicts,1);assert.equal(c.skippedOperations,0);assert.equal(c.heldDispos,0);assert.equal(c.exactSkips,6);assert.equal(c.proposedAdded,44);assert.equal(c.proposedUpdated,8);assert.match(notice(c),/proposed, not committed/);assert.doesNotMatch(JSON.stringify(c)+notice(c),/13061|11438|private-fixture|\/private\/|plan.json/);}finally{await f.close();}
});
test('missing, malformed and foreign current evidence never falls back to old success',async()=>{
 const f=await fixture();try{
  await f.write('active/status.json','broken');assert.equal((await coverage(f.root)).state,'unknown');
  await f.write('active/status.json',f.status('sync_data'));assert.equal((await coverage(f.root)).state,'unknown');
  await f.write('active/status.json',f.status('active'));await fs.unlink(path.join(f.root,'active/cycles/current/plan.json'));assert.equal((await coverage(f.root)).state,'unknown');
 }finally{await f.close();}
});
test('qualified exact skips are distinct from broad holds and never claim complete source parity',async()=>{
 const f=await fixture();try{await f.write('active/status.json',f.status('active',{status:'completed'}));await f.write('active/cycles/current/plan.json',{...f.plan,added:44,manualSkips:{skippedCurrentRows:6}});const c=await coverage(f.root);assert.equal(c.state,'changes_planned');assert.equal(c.complete,false);assert.equal(c.workerStatus,'completed');assert.match(notice(c),/6 explicitly reviewed/);assert.doesNotMatch(notice(c),/COVERAGE BLOCKED/);}finally{await f.close();}
});
test('legacy installations without an environment keep their explicit partial-coverage warning',async()=>{
 const f=await fixture();try{await fs.unlink(path.join(f.root,'.env.sync'));const c=await coverage(f.root);assert.equal(c.state,'partial_plan');assert.equal(c.skippedOperations,13061);assert.equal(c.skippedConflicts,243);assert.equal(c.heldDispos,11438);assert.match(notice(c),/PARTIAL/);}finally{await f.close();}
});
test('preparing polls may show dated prior evidence without presenting it as current',async()=>{
 const f=await fixture();try{await f.write('active/status.json',f.status('active',{status:'fetching',cycle:path.join(f.root,'active/cycles/next')}));await f.write('active/excluded-records-report.json',{at:'2026-10-01T00:00:00Z',cycle:path.join(f.root,'active/cycles/current')});const c=await coverage(f.root);assert.equal(c.evidenceCurrent,false);assert.match(notice(c),/Prior plan evidence/);assert.equal(c.workerStatus,'fetching');}finally{await f.close();}
});
