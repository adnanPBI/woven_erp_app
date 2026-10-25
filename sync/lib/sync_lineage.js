'use strict';
// Evidence-bound new-event lineage: a source UID/Dispo match is never proof.
// All values and two signatures are bound to one frozen source and live ledger.
const crypto=require('crypto');
const HEX=/^[a-f0-9]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ID=/^[a-zA-Z0-9_.@|:-]{1,128}$/;
function candidateKey(profile,row){
  if(!profile||!row?.group||!row?.digest||!row?.dispo)throw Error('Incomplete insert candidate lineage');
  return [profile,row.group,row.digest,row.dispo,row.key||'not-verified',Number.isInteger(row.rowNumber)?row.rowNumber:'no-source-row'].join('|');
}
function payloadFor(proof){
  const p=proof?.evidence;
  if(!p||!['verified-independent-source-event-v1','verified-independent-source-event-v2'].includes(p.kind)||
     !p.profile||!HEX.test(p.group||'')||!HEX.test(p.digest||'')||
     !p.dispo||!DATE.test(p.businessDate||'')||
     !HEX.test(p.sourceManifestSha256||'')||!HEX.test(p.productionLedgerSha256||'')||
     !HEX.test(p.targetAbsentPreimageSha256||'')||
     !p.sourceRowKey||!Number.isInteger(p.sourceRowNumber)||
     !p.nativeRevisionReference||!p.immutableEventEvidenceReference||
     !p.priorEventSearchEvidenceReference)
     throw Error('Incomplete independently reviewable source-event evidence');
  const extension=p.kind==='verified-independent-source-event-v2'?validateV2(p):[];
  return Buffer.from(JSON.stringify([
    p.kind,p.profile,p.group,p.digest,p.dispo,p.businessDate,
    p.sourceRowKey,p.sourceRowNumber,
    p.sourceManifestSha256,p.productionLedgerSha256,p.targetAbsentPreimageSha256,
    p.nativeRevisionReference,p.immutableEventEvidenceReference,
    p.priorEventSearchEvidenceReference,...extension
  ]),'utf8');
}
function validateV2(p){
  const date=require('./sync_date_scope').isoBusinessDate;
  const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)&&Number.isFinite(Date.parse(v));
  if(!p.database||!ID.test(p.releaseId||'')||!HEX.test(p.contractSha256||'')||
     !HEX.test(p.protectionPolicySha256||'')||!date(p.windowStart)||!date(p.windowEnd)||
     p.windowStart>p.windowEnd||!date(p.businessDate)||p.businessDate<p.windowStart||p.businessDate>p.windowEnd||
     !timestamp(p.approvedAt)||!timestamp(p.expiresAt)||Date.parse(p.approvedAt)>=Date.parse(p.expiresAt)||
     Date.parse(p.expiresAt)-Date.parse(p.approvedAt)>86400000)
    throw Error('Invalid signed recovery envelope');
  return [p.database,p.releaseId,p.contractSha256,p.protectionPolicySha256,
    p.windowStart,p.windowEnd,p.approvedAt,p.expiresAt];
}
function verifyIndependentInsert(proof,profile,row,context){
  if(!proof||!context||!row)return false;
  try{
    const p=proof.evidence;
    if(context.requireV2&&p.kind!=='verified-independent-source-event-v2')return false;
    if(p.kind==='verified-independent-source-event-v2'){
      validateV2(p);const now=(context.clock||Date.now)();
      if(now<Date.parse(p.approvedAt)||now>=Date.parse(p.expiresAt)||
         p.database!==context.database||p.contractSha256!==context.contractSha256||
         p.protectionPolicySha256!==context.protectionPolicySha256||
         p.windowStart!==context.windowStart||p.windowEnd!==context.windowEnd)return false;
    }
    if(p.profile!==profile||p.group!==row.group||p.digest!==row.digest||
       p.dispo!==row.dispo||p.businessDate!==row.businessDate||
       !row.key||!Number.isInteger(row.rowNumber)||
       p.sourceRowKey!==row.key||p.sourceRowNumber!==row.rowNumber||
       p.sourceManifestSha256!==context.sourceManifestSha256||
       p.productionLedgerSha256!==context.productionLedgerSha256)return false;
    // An independently signed assertion must also be checked against the actual
    // destination absence under an operator-controlled read-only lookup.
    const targetKey=candidateKey(profile,row);
    if(!(context.targetAbsenceEvidenceByKey instanceof Map)||
       context.targetAbsenceEvidenceByKey.get(targetKey)!==p.targetAbsentPreimageSha256)return false;
    const signatures=proof.signatures;
    if(!signatures||!ID.test(signatures.businessOwner?.id||'')||
       !ID.test(signatures.secondReviewer?.id||'')||
       signatures.businessOwner.id===signatures.secondReviewer.id)return false;
    const owner=context.trustedReviewers?.businessOwner?.[signatures.businessOwner.id];
    const second=context.trustedReviewers?.secondReviewer?.[signatures.secondReviewer.id];
    if(!owner||!second)return false;
    const publicKey=v=>v.type==='public'?v:crypto.createPublicKey(v);
    const fingerprint=v=>publicKey(v).export({type:'spki',format:'der'}).toString('hex');
    if(fingerprint(owner)===fingerprint(second))return false;
    if(context.requireV2){
      const a=context.reviewerPrincipals?.businessOwner?.[signatures.businessOwner.id];
      const b=context.reviewerPrincipals?.secondReviewer?.[signatures.secondReviewer.id];
      if(!a||!b||a===b)return false;
    }
    const msg=payloadFor(proof);
    for(const [role,record]of Object.entries({
      businessOwner:signatures.businessOwner,
      secondReviewer:signatures.secondReviewer
    })){
      const pem=context.trustedReviewers?.[role]?.[record.id];
      if(!pem||typeof record.signature!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(record.signature))return false;
      const sig=Buffer.from(record.signature,'base64');
      if(sig.length!==64||!crypto.verify(null,msg,pem,sig))return false;
    }
    return true;
  }catch{return false;}
}
function classifyUnresolvedInsert(profile,row,orphaned,context){
  const sameDispo=orphaned.filter(a=>a.dispo&&a.dispo===row.dispo);
  const sameGroup=orphaned.filter(a=>a.group===row.group);
  const sameSignature=orphaned.filter(a=>a.matchHash&&row.matchHash&&a.matchHash===row.matchHash);
  const risk=sameGroup.length?'possibly_renamed_within_group':
    sameSignature.length?'possibly_moved_event_signature':
    sameDispo.length?'possibly_moved_event_same_dispo':
    orphaned.length?'cross_group_lineage_not_proven':'no_unresolved_prior_group';
  return {risk,priorUnmatched:orphaned.length,
    verifiedNewEvent:Boolean(context?.verified)};
}
module.exports={candidateKey,payloadFor,verifyIndependentInsert,classifyUnresolvedInsert};
