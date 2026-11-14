'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyReviewedReassignments,planEdits}=require('../lib/sheets_sync_plan');
const reviews=[5,6].map((day,i)=>({profile:'folding',action:'retain-missing',sourceUid:'old-'+i,oldGroup:'old-group-'+i,oldDigest:'old-digest-'+i,decisionEvidence:{originalBusinessDate:'2026-11-0'+day,newSourceDigest:'new-digest-'+i,newSourceUid:'new-'+i}}));
assert.equal(reviews.length,2);
const original=()=>reviews.map(r=>({uid:r.sourceUid,group:r.oldGroup,digest:r.oldDigest,dispo:'nh/stpl/gsf/26/90002',key:r.oldDigest,entryAmounts:null}));
const newRows=()=>reviews.map(r=>({group:r.decisionEvidence.originalBusinessDate==='2026-11-05'?'distinct-new-GSF2-5':'distinct-new-GSF2-6',digest:r.decisionEvidence.newSourceDigest,key:r.decisionEvidence.newSourceDigest,uid:r.decisionEvidence.newSourceUid,businessDate:r.decisionEvidence.originalBusinessDate,dispo:'nh/stpl/gsf2/26/90002'}));
function run(prev=original(),current=newRows(),r=reviews){
 const before={headersHash:'compatible',records:prev},after={headersHash:'compatible',records:current};
 applyReviewedReassignments('folding',before,after,r);
 return {kept:before.records,plan:planEdits({folding:before},{folding:after})};
}
test('original GSF source absence retains historical SQL event as out-of-band rather than delete',()=>{
 const {kept,plan}=run();
 assert.equal(kept.length,0);
 assert.equal(plan.ok,true);
 assert.equal(plan.conflicts.length,0);
 assert.equal(plan.added,2);
 assert.equal(plan.updated,0);
 assert.deepEqual(plan.operations.folding.map(x=>x.action),['insert','insert']);
 const gids=plan.operations.folding.map(x=>x.group);
 assert.equal(new Set(gids).size,2);
});
test('a returning original source is not suppressed; it can match historical row',()=>{
 const historic=original(),current=[...newRows(),{...historic[0]}];
 const {kept,plan}=run(historic,current);
 assert.equal(kept.length,1);
 assert.equal(kept[0].uid,historic[0].uid);
 assert.equal(plan.ok,true);
 assert.equal(plan.added,2);
});
test('changed ledger digest or missing authorization fails closed',()=>{
 const changed=original();changed[0].digest='other digest';
 assert.throws(()=>run(changed),/Reviewed removal evidence is stale/);
 const stale=reviews.map(r=>({...r,oldGroup:'wrong-group'}));
 assert.throws(()=>run(original(),newRows(),stale),/Reviewed removal evidence is stale/);
});
test('new GSF2 rows may not be rebound to old GSF UID',()=>{
 const {plan}=run();
 const oldSet=new Set(reviews.map(r=>r.sourceUid));
 assert(plan.operations.folding.every(x=>x.action==='insert'&&!oldSet.has(x.uid)));
});
