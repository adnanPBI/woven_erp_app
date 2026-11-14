'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {planEdits,applyReviewedReassignments}=require('../lib/sheets_sync_plan');
test('folding source Dispo correction is update not duplicate insert, and requires exact review',()=>{
 const old={uid:'0000000000000000000000000000000000000000000000000000000000000001',
  group:'0000000000000000000000000000000000000000000000000000000000000002',
  digest:'0000000000000000000000000000000000000000000000000000000000000003',
  dispo:'nh/ndsd/gd/26/90001cm-1'};
 const newer={group:'0000000000000000000000000000000000000000000000000000000000000004',
  digest:'0000000000000000000000000000000000000000000000000000000000000005',
  dispo:'nh/ndsd/gd/26/90001cm-2',key:'verified-business-fingerprint',uid:'source-row-hash'};
 const review={profile:'folding',sourceUid:old.uid,oldGroup:old.group,oldDigest:old.digest,
  newGroup:newer.group,newDigest:newer.digest};
 const former={headersHash:'headers',records:[old]},current={headersHash:'headers',records:[newer]};
 const blocked=planEdits({folding:former},{folding:current});
 assert.equal(blocked.ok,false);assert.equal(blocked.added,1);assert.equal(blocked.conflicts.length,1);
 assert.throws(()=>applyReviewedReassignments('folding',{...former,records:[{...old}]},current,[{...review,newDigest:'unexpected'}]),/stale or ambiguous/);
 const corrected=applyReviewedReassignments('folding',{...former,records:[{...old}]},current,[review]);
 const safe=planEdits({folding:corrected},{folding:current});
 assert.equal(safe.ok,true);assert.equal(safe.added,0);assert.equal(safe.updated,1);
 assert.equal(safe.conflicts.length,0);assert.equal(safe.operations.folding.length,1);
 assert.equal(safe.operations.folding[0].action,'update');
 assert.equal(safe.operations.folding[0].uid,old.uid);
 assert.equal(safe.operations.folding[0].previousDispo,old.dispo);
 assert.equal(safe.operations.folding[0].dispo,newer.dispo);
});
