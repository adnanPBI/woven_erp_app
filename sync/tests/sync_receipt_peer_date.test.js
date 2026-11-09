'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {applyReviewedReassignments}=require('../lib/sheets_sync_plan');
const hex=n=>String(n).repeat(64);
function fixture(){
 const old={uid:'old',group:'group',digest:'historical',dispo:'nh/test/gd/26/90003'};
 const peer={uid:'peer',group:'group',digest:'baseline',matchHash:hex(1)};
 const fresh={uid:'export-uid',group:'group',digest:'later-date',matchHash:hex(1),entryAmounts:JSON.stringify([90,null]),dispo:old.dispo};
 const review={profile:'yarn-receive',action:'retain-missing-peer',sourceUid:old.uid,oldGroup:old.group,oldDigest:old.digest,oldDispo:old.dispo,peerSourceUid:peer.uid,peerGroup:peer.group,peerOldDigest:peer.digest,peerMatchHash:peer.matchHash,peerQtyKg:90,allowPeerLastReceivedDateDrift:true,oldTargetPrimaryKey:10,peerTargetPrimaryKey:11};
 return {old,peer,fresh,review};
}
function run(f,rows=[f.fresh]){return applyReviewedReassignments('yarn-receive',{records:[f.old,f.peer]},{records:rows},[f.review]);}
test('first and repeated date-only peer changes preserve the historical event outside matching',()=>{
 const f=fixture();assert.deepEqual(run(f).records,[f.peer]);
 f.peer.digest=f.fresh.digest;f.fresh.digest='another-date';assert.deepEqual(run(f).records,[f.peer]);
});
test('quantity, other-field signature, duplicate and missing source fail closed',()=>{
 for(const change of [f=>f.fresh.entryAmounts='[91,null]',f=>f.fresh.matchHash=hex(2)]){
  const f=fixture();change(f);assert.throws(()=>run(f),/source peer changed/);
 }
 const f=fixture();assert.throws(()=>run(f,[f.fresh,{...f.fresh}]),/source peer changed/);assert.throws(()=>run(f,[]),/source peer changed/);
});
test('missing permission or changed original ledger fails closed',()=>{
 for(const change of [f=>f.review.allowPeerLastReceivedDateDrift=false,f=>f.old.digest='drift']){
  const f=fixture();change(f);assert.throws(()=>run(f),/old business identity changed/);
 }
});
test('original source reappearance resumes normal matching',()=>{
 const f=fixture();assert.equal(run(f,[f.fresh,{...f.old}]).records.length,2);
});
