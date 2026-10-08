'use strict';
const assert=require('assert');
const {fingerprint,compare}=require('../lib/sheets_sync_plan');
assert.equal(fingerprint(['Date','Qty','__MIG_SOURCE_UID'],['2026-09-24','10','old']),fingerprint(['Date','Qty','__MIG_SOURCE_UID'],['2026-09-24','10','new']));
assert.notEqual(fingerprint(['Qty'],['10']),fingerprint(['Qty'],['11']));
const inv=keys=>({loom:{headersHash:'schema',records:keys.map(key=>({key}))}});
assert.equal(compare(inv(['a','b']),inv(['b','a'])).additions,0);
assert.equal(compare(inv(['a']),inv(['a','b'])).additions,1);
assert.equal(compare(inv(['a','b']),inv(['a'])).ok,false);
assert.equal(compare(inv(['a']),inv(['b'])).ok,false);
assert.equal(compare(inv(['a']),{}).ok,false);
assert.equal(compare(inv(['a']),{loom:{headersHash:'changed',records:[]}}).ok,false);
console.log('Sync planner tests passed: stable fingerprints, reordering, additions, edits/deletions and schema changes.');
const fs=require('fs'),os=require('os'),path=require('path');
const {inventory}=require('../lib/sheets_sync_plan');
const {planEdits}=require('../lib/sheets_sync_plan');
{
 const {applyReviewedReassignments}=require('../lib/sheets_sync_plan');
 const review={profile:'yarn-receive',sourceUid:'original',oldGroup:'old',oldDigest:'before',newGroup:'new',newDigest:'after'};
 const previous={headersHash:'h',records:[{uid:'original',group:'old',digest:'before'}]};
 const current={headersHash:'h',records:[{uid:'fresh',group:'new',digest:'after'}]};
 const mapped=applyReviewedReassignments('yarn-receive',structuredClone(previous),current,[review]);
 const plan=planEdits({'yarn-receive':mapped},{'yarn-receive':current});assert(plan.ok);assert.equal(plan.added,0);assert.equal(plan.updated,1);assert.equal(plan.operations['yarn-receive'][0].uid,'original');
 const withAdditional={headersHash:'h',records:[...current.records,{uid:'another',group:'new',digest:'different',key:'another'}]};
 const reviewed=applyReviewedReassignments('yarn-receive',structuredClone(previous),withAdditional,[review]);
 const precise=planEdits({'yarn-receive':reviewed},{'yarn-receive':withAdditional});assert(precise.ok);assert.equal(precise.updated,1);assert.equal(precise.added,1);
 assert.equal(precise.operations['yarn-receive'].find(r=>r.action==='update').digest,'after');
 assert.throws(()=>applyReviewedReassignments('yarn-receive',structuredClone(previous),current,[{...review,newDigest:'stale'}]),/stale/);
 const removal={profile:'yarn-receive',sourceUid:'original',oldGroup:'old',oldDigest:'before',action:'retain-missing'};
 assert.equal(applyReviewedReassignments('yarn-receive',structuredClone(previous),{records:[]},[removal]).records.length,0);
 assert.equal(applyReviewedReassignments('yarn-receive',structuredClone(previous),previous,[removal]).records.length,1,'Reappearing source returns to normal matching');
 assert.throws(()=>applyReviewedReassignments('yarn-receive',structuredClone(previous),{records:[]},[{...removal,oldDigest:'stale'}]),/stale/);
}
{
 const baseline={'yarn-receive':{headersHash:'h',records:[{uid:'a',digest:'old-a',group:'same',matchHash:'qty-632'},{uid:'b',digest:'old-b',group:'same',matchHash:'qty-126'}]}};
 const current={'yarn-receive':{headersHash:'h',records:[{digest:'new-b',group:'same',matchHash:'qty-126',rowNumber:2},{digest:'new-a',group:'same',matchHash:'qty-632',rowNumber:3}]}};
 const plan=planEdits(baseline,current);assert(plan.ok);assert.equal(plan.updated,2);
 assert.equal(plan.operations['yarn-receive'].find(r=>r.rowNumber===2).uid,'b');
 current['yarn-receive'].records.forEach(r=>r.matchHash='unknown');
 assert.equal(planEdits(baseline,current).ok,false,'Multiple changed quantities remain ambiguous');
}
{
 const baseline={loom:{headersHash:'h',records:[{uid:'u',digest:'d',group:'g',dispo:'example'}]}};
 const current={loom:{headersHash:'h',records:[{uid:'new-file-uid',digest:'d',group:'g',dispo:'example',rowNumber:2}]}};
 const plan=planEdits(baseline,current,[['example',2]]);
 assert.equal(plan.refreshed,1,'A Dispo edit refreshes unchanged downstream Loom rows even when profiles are planned separately');
 assert.equal(plan.operations.loom[0].action,'refresh');
 assert.equal(plan.operations.loom[0].uid,'u');
 const moved=planEdits({'yarn-receive':{headersHash:'h',records:[{uid:'r',digest:'before',group:'g',dispo:'old-dispo'}]},loom:{headersHash:'h',records:[{uid:'l',digest:'same',group:'l',dispo:'old-dispo'}]}},{'yarn-receive':{headersHash:'h',records:[{digest:'after',group:'g',dispo:'new-dispo',rowNumber:2}]},loom:{headersHash:'h',records:[{digest:'same',group:'l',dispo:'old-dispo',rowNumber:2}]}});
 assert.equal(moved.refreshed,1,'A corrected receipt also refreshes records linked to its previous Dispo');
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'weaving-sync-plan-'));
 const file=path.join(dir,'events.csv'),profiles=[{id:'events',source_file:'events.csv',header_row:0}];
 try{
  fs.writeFileSync(file,'Date,Qty,__MIG_SOURCE_UID\n2026-09-24,10,old1\n2026-09-24,10,old2\n');
  const first=await inventory(dir,profiles);
  assert.notEqual(first.events.records[0].key,first.events.records[1].key,'Identical legitimate events retain multiplicity');
  fs.writeFileSync(file,'Date,Qty,__MIG_SOURCE_UID\n2026-09-24,10,new1\n2026-09-24,10,new2\n2026-09-24,10,new3\n');
  const next=await inventory(dir,profiles),plan=compare(first,next);
  assert.equal(plan.ok,true);assert.equal(plan.additions,1);
  assert.equal(plan.profiles.events.added[0].rowNumber,4);
  const issueProfiles=[{id:'yarn-issue',source_file:'events.csv',header_row:0}];
  const issueHeader='Yarn Count,Yarn Lot,Issue Date,Dispo No,S/R/Challan No,Warp,Weft,Delivery Place,__MIG_SOURCE_UID\n';
  fs.writeFileSync(file,issueHeader+'30,167,2026-09-21,D,137267,3500,,Monno,warp\n30,167,2026-09-21,D,137267,,3000,Monno,weft\n');
  const issueBefore=await inventory(dir,issueProfiles);
  fs.writeFileSync(file,issueHeader+'30,167,2026-09-21,D,137267,,3000,Momtex,new1\n30,167,2026-09-21,D,137267,3500,,Momtex,new2\n');
  const issuePlan=planEdits(issueBefore,await inventory(dir,issueProfiles));
  assert(issuePlan.ok);assert.equal(issuePlan.updated,2);assert.equal(issuePlan.added,0);
  assert.equal(issuePlan.operations['yarn-issue'].find(r=>r.rowNumber===2).uid,'weft');
  assert.equal(issuePlan.operations['yarn-issue'].find(r=>r.rowNumber===3).uid,'warp');
  fs.writeFileSync(file,issueHeader+'30,167,2026-09-21,D,137267,,3100,Momtex,new1\n30,167,2026-09-21,D,137267,3600,,Momtex,new2\n');
  const quantityPlan=planEdits(issueBefore,await inventory(dir,issueProfiles));
  assert(quantityPlan.ok,'Warp/weft identity distinguishes simultaneous quantity changes');
  assert.equal(quantityPlan.updated,2);assert.equal(quantityPlan.added,0);
  assert.equal(quantityPlan.operations['yarn-issue'].find(r=>r.rowNumber===2).uid,'weft');
  console.log('Streamed CSV inventory test passed: changed source UIDs do not replay old events; duplicate occurrence preserved.');
 }finally{fs.unlinkSync(file);fs.rmdirSync(dir);}
})().catch(e=>{console.error(e);process.exitCode=1;});
{
 const {applyReviewedReassignments}=require('../lib/sheets_sync_plan');
 const previous={headersHash:'h',records:[{uid:'original',group:'same',digest:'443'}]};
 const current={headersHash:'h',records:[{key:'part1',group:'same',digest:'131.86',rowNumber:2},{key:'part2',group:'same',digest:'311.14',rowNumber:3}]};
 const review={profile:'yarn-issue',sourceUid:'original',oldGroup:'same',newGroup:'same',oldDigest:'443',newDigest:'131.86'};
 assert.equal(planEdits({'yarn-issue':previous},{'yarn-issue':current}).ok,false);
 const reviewed=applyReviewedReassignments('yarn-issue',structuredClone(previous),current,[review]);
 const split=planEdits({'yarn-issue':reviewed},{'yarn-issue':current});
 assert(split.ok);assert.equal(split.updated,1);assert.equal(split.added,1);
 assert.equal(split.operations['yarn-issue'].find(x=>x.action==='update').uid,'original');
 const committed={headersHash:'h',records:split.operations['yarn-issue']};
 const replay=planEdits({'yarn-issue':applyReviewedReassignments('yarn-issue',committed,current,[review])},{'yarn-issue':current});
 assert(replay.ok);assert.equal(replay.added+replay.updated,0);
 assert.throws(()=>applyReviewedReassignments('yarn-issue',structuredClone(previous),{...current,records:[current.records[1]]},[review]),/stale|ambiguous/);
 console.log('Reviewed same-key split and no-op replay passed.');
}
