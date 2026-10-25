'use strict';
const assert=require('assert/strict');
const {SyncExclusions}=require('../lib/sync_exclusions');
const {verifyIndependentInsert}=require('../lib/sync_lineage');
const old={uid:'old',group:'old-group',digest:'old-digest',dispo:'historical-protected',
 yarnIdentity:{version:1,lot:'historical-lot'}};
for(const newDispo of ['preexisting-dispo','entirely-new-dispo']){
 const row={uid:'new-source-id',key:'unique-current-source-row',
  group:'new-group',digest:'new-digest',dispo:newDispo,rowNumber:12,
  businessDate:'2026-10-14',action:'insert'};
 const x=new SyncExclusions([{profile:'po',sourceUid:old.uid,digest:old.digest,
  dispo:old.dispo,lot:'historical-lot'}],'skip-dispos');
 const plan={ok:true,added:1,updated:0,refreshed:0,
  operations:{po:[row]},conflicts:[]};
 x.inspect('po',{records:[old]},{records:[row]},plan);
 x.seal();x.filter(plan);
 assert.equal(plan.added,0);
 assert.equal(plan.exclusions.verifiedIndependentInserts,0);
 assert.equal(plan.exclusions.lineageUnverifiedInserts,1);
 assert.equal(verifyIndependentInsert(null,'po',row,null),false);
}
console.log('PASS: renamed PO cannot become a new insert merely by changing its PO/Dispo identity.');
