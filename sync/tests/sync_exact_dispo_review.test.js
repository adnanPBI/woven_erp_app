'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {qualifyExactDispoReview}=require('../lib/sync_exact_dispo_review'),{fingerprint,hash,planEdits,applyReviewedReassignments}=require('../lib/sheets_sync_plan');
function fixture(){
 const profile='yarn-issue',headers=['Yarn Count','Yarn Lot','Issue Date','Dispo No','S/R/Challan No','Out Side','Warp','Weft','Search Column','__MIG_SOURCE_UID'];
 const before=['40','lot001','2026-10-28','NH/26/CM-33','C1','502','','','NH/26/CM-33 -lot001','old-export'];
 const values=before.map(v=>v.replaceAll('NH/26/CM-33','NH/26/CM-44'));values[9]='new-export';
 const group=v=>hash([profile,...[0,1,2,3,4].map(i=>v[i].toLowerCase())]);
 return {profile,headers,rows:[{values,rowNumber:2}],ledger:{uid:'stored-event',digest:fingerprint(headers,before,profile),group:group(before),dispo:'nh/26/cm-33'},provenance:{profile,source_uid:'stored-event',target_table:'yarn_issue_form',target_primary_key:'123'},targetDispo:'NH/26/CM-33',destinationEvents:[],group,before};
}
test('exact Dispo-only correction produces a bounded review and preserves the existing event UID',()=>{
 const f=fixture(),{review,proof}=qualifyExactDispoReview(f);assert.deepEqual(proof.changedFields,['Dispo No','Search Column']);assert.equal(proof.targetPrimaryKey,'123');
 const record=(v,uid)=>({uid,digest:fingerprint(f.headers,v,f.profile),group:f.group(v),rowNumber:2,businessDate:'2026-10-28',dispo:v[3].toLowerCase(),yarnIdentity:{version:1,dispo:v[3].toLowerCase(),count:'40',lot:'lot001',direction:'',date:'2026-10-28',challan:'c1'}});
 const previous={headersHash:'headers',records:[record(f.before,'stored-event')]},current={headersHash:'headers',records:[record(f.rows[0].values,'new-export')]};
 const reviewed=applyReviewedReassignments(f.profile,previous,current,[review]),plan=planEdits({[f.profile]:reviewed},{[f.profile]:current});assert.equal(plan.ok,true);assert.equal(plan.updated,1);assert.equal(plan.added,0);assert.equal(plan.operations[f.profile][0].uid,'stored-event');
});
test('qualification rejects amount edits, multiple candidates, remaining originals and occupied destinations',()=>{
 for(const kind of ['amount','duplicate','original','occupied','provenance','physical']){
  const f=fixture();if(kind==='amount')f.rows[0].values[5]='503';if(kind==='duplicate')f.rows.push(structuredClone(f.rows[0]));if(kind==='original')f.rows.push({values:f.before,rowNumber:3});if(kind==='occupied')f.destinationEvents=[{group:f.group(f.rows[0].values)}];if(kind==='provenance')f.provenance.source_uid='another-event';if(kind==='physical')f.targetDispo='NH/26/UNKNOWN';assert.throws(()=>qualifyExactDispoReview(f),/Exact Dispo review/);
 }
});
