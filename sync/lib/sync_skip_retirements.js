'use strict';
// Explicit private review of one removed occurrence from an originally exact
// duplicate pair. Never infer retirement from a missing row or a row number.
const fail=()=>{throw Error('Exact skip retirement: unqualified duplicate scope');};
const signature=r=>r.sourceMatchHash||r.matchHash||r.digest;
function retirementRules(base){
 const rules=base.duplicateRetirements||[];if(!Array.isArray(rules))fail();
 const used=new Set();
 for(const r of rules){
  const anchors=base.currentRows.filter(a=>a.profile===r.profile&&a.group===r.group&&a.businessDate===r.businessDate&&signature(a)===r.signature);
  if(r.profile!=='yarn-receive'||r.originalCount!==2||r.currentCount!==1||anchors.length!==2||
   !anchors.some(a=>a.uid===r.retiredUid)||used.has(r.retiredUid)||!Number.isFinite(r.amount)||r.amount<=0||!r.lot)fail();
  used.add(r.retiredUid);
 }
 return rules;
}
module.exports={retirementRules,signature};
