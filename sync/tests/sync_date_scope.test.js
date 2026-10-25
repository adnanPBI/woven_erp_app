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
