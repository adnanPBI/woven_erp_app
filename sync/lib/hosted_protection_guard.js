'use strict';
function assertProtected(plan,policy,context={}){
 if(policy.version===2&&policy.mode==='manual-exact-skips'){
  const skips=context.manualSkips,p=skips?.policy,env=context.env;
  if(!env||!p||policy.database!==env.DB_NAME||policy.database!==p.database||policy.manualOnly!==true||
   policy.automaticRestartAuthorized!==false||policy.heldCases.length||policy.originalExclusions.length||policy.seedDispos.length||
   policy.exactSkipsSha256!==skips.summary.sha256||policy.businessCorrectionsApproved!==0||
   plan.manualSkips?.sha256!==skips.summary.sha256||plan.exclusions||
   plan.businessWindow?.start!==p.window.start||plan.businessWindow?.end!==p.window.end)throw Error('Qualified manual hosted policy required');
  for(const [profile,ops]of Object.entries(plan.operations||{}))for(const op of ops){
   if(op.businessDate<p.window.start||op.businessDate>p.window.end||!op.businessDate)throw Error('Manual operation outside qualified window');
   if(p.currentRows.some(r=>r.profile===profile&&(op.rowNumber===r.rowNumber||op.uid===r.uid))||
      p.oldRecords.some(r=>r.profile===profile&&op.uid===r.uid))throw Error('Plan touches an exact skipped event');
  }
  return true;
 }
 if(policy.heldCases.length!==42||policy.originalExclusions.length!==14||policy.businessCorrectionsApproved!==0)throw Error('Protection policy changed');
 const dispos=new Set(policy.seedDispos);
 for(const c of policy.heldCases)if(!c.dispo||!dispos.has(c.dispo))throw Error('Held case lacks a protected Dispo: '+c.caseId);
 for(const [profile,ops]of Object.entries(plan.operations||{}))for(const op of ops){
  if(dispos.has(op.dispo)||dispos.has(op.previousDispo))throw Error('Plan touches held Dispo');
  if(policy.heldCases.some(c=>c.profile===profile&&((c.sourceUid&&[op.uid,op.sourceUid].includes(c.sourceUid))||(c.group&&op.group===c.group))))throw Error('Plan touches a held case');
 }
 if(!plan.exclusions||plan.exclusions.policy!=='skip-dispos')throw Error('Exclusion-bound plan required');
 for(const d of dispos)if(!plan.exclusions.dispos.includes(d))throw Error('Plan omitted held Dispo');
 return true;
}
module.exports={assertProtected};
