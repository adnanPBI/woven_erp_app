'use strict';
const assert=require('assert/strict');
const {isoBusinessDate,qualifyRecoveryWindow}=require('../lib/sync_date_scope');
for(const bad of ['',null,'2026-02-30','2026-13-12','21/09/2026','2026-10-14T00:00:00Z','2026-00-01']){
 assert.equal(isoBusinessDate(bad),null);
}
assert.equal(isoBusinessDate('2026-09-21'),'2026-09-21');
const operations=[['insert','2026-09-20','old'],['insert','2026-09-21','first'],
 ['update','2026-10-14','last'],['refresh','2026-10-15','after'],
 ['insert','','undated'],['insert','2026-02-30','invalid']]
 .map(([action,businessDate,uid])=>({action,businessDate,uid}));
const input={ok:false,operations:{po:operations},conflicts:[{reason:'ambiguous_old_PO'}]};
const original=JSON.stringify(input);
const q=qualifyRecoveryWindow(input);
assert.deepEqual(q.authorizedOperations.po.map(x=>x.uid),['first','last']);
assert.deepEqual(q.actionCounts,{insert:1,update:1,refresh:0});
assert.deepEqual(q.heldTotals,{older:1,later:1,undated:1,invalid:1});
assert.equal(q.unresolvedPlanConflicts,1);
assert.equal(q.readyForExecution,false);
assert.equal(JSON.stringify(input),original,'Qualification must never mutate the source plan');
assert.throws(()=>qualifyRecoveryWindow(input,{start:'2026-10-15',end:'2026-10-14'}),/dates/);
assert.throws(()=>qualifyRecoveryWindow({operations:{po:[{action:'delete',businessDate:'2026-10-14'}]}}),/Unexpected action/);
console.log('PASS: exact inclusive dates, invalid/undated/older rows held, no deletes, no plan mutation');
// Production keeps the original earliest permitted date while accepting a
// narrower explicitly qualified manual window. No unbounded window is allowed.
(async()=>{
 const {SheetsSyncRuntime}=require('../lib/sheets_sync_runtime.repair');
 const initialize=(window,date='2026-09-22')=>new SheetsSyncRuntime({ok:true,businessWindow:window,operations:{po:[{rowNumber:2,uid:'bounded',action:'insert',businessDate:date}]}},{},'manifest').initialize({sourceManifestFileSha256:'manifest',dryRun:true,conn:{query:async()=>[[{db:'weavonpq_weaving_main'}]]}});
 await initialize({start:'2026-09-21',end:'2026-10-29'});
 await initialize({start:'2026-09-22',end:'2026-10-29'});
 await assert.rejects(initialize({start:'2026-09-20',end:'2026-10-29'}),/Production requires/);
 await assert.rejects(initialize(null),/Production requires/);
 await assert.rejects(initialize({start:'2026-09-22',end:'2026-10-29'},'2026-09-21'),/outside/);
 await assert.rejects(initialize({start:'2026-09-22',end:'2026-10-29'},'2026-10-30'),/outside/);
 await assert.rejects(initialize({start:'2026-10-30',end:'2026-10-29'}),/Invalid/);
 console.log('PASS: production accepts narrower bounded windows and rejects older/unbounded/out-of-window operations');
})().catch(e=>{console.error(e);process.exitCode=1;});
