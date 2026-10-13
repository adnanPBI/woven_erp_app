'use strict';
function assertProtected(plan,policy){
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
