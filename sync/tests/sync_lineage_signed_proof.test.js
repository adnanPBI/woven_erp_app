'use strict';
const assert=require('assert/strict'),crypto=require('crypto');
const {SyncExclusions}=require('../lib/sync_exclusions');
const {candidateKey,payloadFor,verifyIndependentInsert}=require('../lib/sync_lineage');
const h=s=>crypto.createHash('sha256').update(s).digest('hex');
const source=h('source-frozen'),ledger=h('live-read-only-ledger'),target=h('verified-empty-query-result');
const historic={uid:'old-event',group:h('old-group'),digest:h('old-digest'),
 dispo:'original-held-dispo',yarnIdentity:{version:1,lot:'old-lot'}};
const event={uid:h('new-source-export-index'),key:h('new-source-key'),group:h('new-group'),
 digest:h('new-digest'),dispo:'verified-new-dispo',rowNumber:1022,
 businessDate:'2026-10-14',action:'insert'};
const original={profile:'po',sourceUid:historic.uid,digest:historic.digest,
 dispo:historic.dispo,lot:'old-lot'};
const owner=crypto.generateKeyPairSync('ed25519'),second=crypto.generateKeyPairSync('ed25519');
const proof={evidence:{kind:'verified-independent-source-event-v1',profile:'po',
 group:event.group,digest:event.digest,dispo:event.dispo,
 businessDate:event.businessDate,sourceRowKey:event.key,sourceRowNumber:event.rowNumber,
 sourceManifestSha256:source,productionLedgerSha256:ledger,targetAbsentPreimageSha256:target,
 nativeRevisionReference:'verified-source-revision-ref',
 immutableEventEvidenceReference:'business-event-primary-document-ref',
 priorEventSearchEvidenceReference:'read-only-ledger-and-target-search-ref'
 },signatures:{businessOwner:{id:'business.owner'},secondReviewer:{id:'independent.reviewer'}}};
const data=payloadFor(proof);
proof.signatures.businessOwner.signature=crypto.sign(null,data,owner.privateKey).toString('base64');
proof.signatures.secondReviewer.signature=crypto.sign(null,data,second.privateKey).toString('base64');
const ctx={sourceManifestSha256:source,productionLedgerSha256:ledger,
 targetAbsenceEvidenceByKey:new Map([[candidateKey('po',event),target]]),
 trustedReviewers:{businessOwner:{'business.owner':owner.publicKey},
 secondReviewer:{'independent.reviewer':second.publicKey}}};
function check(supplied,context=ctx,record=event){
 let e=new SyncExclusions([original],'skip-dispos',
  context?{...context,proofs:new Map(supplied?[[candidateKey('po',event),supplied]]:[])}:null);
 const op={...record};
 const plan={ok:true,added:1,updated:0,refreshed:0,
  operations:{po:[op]},conflicts:[]};
 e.inspect('po',{records:[historic]},{records:[op]},plan);
 e.seal();e.filter(plan);
 return plan;
}
assert.equal(check().added,0,'Never automatically insert under unresolved historical key');
assert(verifyIndependentInsert(proof,'po',event,ctx));
const approved=check(proof);assert.equal(approved.added,1);
assert.equal(approved.exclusions.verifiedIndependentInserts,1);
assert.equal(approved.exclusions.lineageUnverifiedInserts,0);
const clones=()=>structuredClone(proof);
let bad=clones();bad.evidence.sourceManifestSha256=h('changed');
assert.equal(check(bad).added,0,'Changed signed source hash must fail');
assert.equal(check(proof,{...ctx,sourceManifestSha256:h('new-manifest')}).added,0);
assert.equal(check(proof,{...ctx,productionLedgerSha256:h('changed-ledger')}).added,0);
assert.equal(check(proof,{...ctx,targetAbsenceEvidenceByKey:new Map()}).added,0);
assert.equal(check(proof,{...ctx,targetAbsenceEvidenceByKey:new Map([[candidateKey('po',event),h('changed-target')]])}).added,0);
bad=clones();bad.signatures.secondReviewer.id='business.owner';
assert.equal(check(bad).added,0,'Same person cannot independently approve');
bad=clones();bad.signatures.secondReviewer.signature=crypto.sign(null,data,owner.privateKey).toString('base64');
assert.equal(check(bad).added,0,'Signing with business-owner key twice must fail');
assert.equal(check(proof,ctx,{...event,rowNumber:1023}).added,0,'Changed source row invalidates signed proof');
assert.equal(check(proof,ctx,{...event,dispo:historic.dispo}).added,0,'Protected Dispo cannot be released even with unrelated signed proof');
const other={...event,key:h('other'),group:h('other-group'),
 digest:h('other-digest'),dispo:'independent-but-unsigned',rowNumber:1024};
assert.equal(check(proof,ctx,other).added,0,'Evidence for one event is not profile-wide approval');
console.log('PASS: two independent Ed25519 signatures, exact source/DB/target binding, all held cases fail closed');
