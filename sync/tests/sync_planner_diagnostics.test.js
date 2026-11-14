'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),planner=require('../lib/sheets_sync_plan');
const rec=uid=>({uid,group:'g',digest:uid,dispo:'SYNTHETIC/OLD'});
test('single missing identity preserves known original evidence without proposing writes',()=>{
 const p=planner.planEdits({dispo:{headersHash:'h',records:[rec('a')]}},{dispo:{headersHash:'h',records:[]}});
 assert.equal(p.ok,false);assert.equal(p.conflicts.length,1);assert.equal(p.operations.dispo.length,0);
 assert.equal(p.conflicts[0].sourceUid,'a');assert.equal(p.conflicts[0].previousDispo,'SYNTHETIC/OLD');assert.equal(p.conflicts[0].previousDigest,'a');
});
test('multiple prior identities do not invent one original UID',()=>{
 const p=planner.planEdits({dispo:{headersHash:'h',records:[rec('a'),rec('b')]}},{dispo:{headersHash:'h',records:[]}});
 assert.equal(p.conflicts[0].previousUnmatched,2);assert(!('sourceUid' in p.conflicts[0]));assert.equal(p.operations.dispo.length,0);
});
test('ordinary edit keeps the original UID and produces one update without a conflict',()=>{
 const p=planner.planEdits({dispo:{headersHash:'h',records:[rec('a')]}},{dispo:{headersHash:'h',records:[{...rec('a'),digest:'b',key:'k',rowNumber:2}]}});
 assert(p.ok);assert.equal(p.conflicts.length,0);assert.equal(p.added,0);assert.equal(p.updated,1);assert.equal(p.operations.dispo.length,1);
 const op=p.operations.dispo[0];assert.equal(op.uid,'a');assert.equal(op.previousDigest,'a');assert.equal(op.digest,'b');assert.equal(op.action,'update');
});
