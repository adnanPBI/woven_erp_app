'use strict';
// Pure decision layer: only an explicitly bounded recovery invocation may use
// this. The normal scheduler must keep its separate forward-looking policy.
const dates={start:'2026-09-21',end:'2026-10-14'};
function isoBusinessDate(raw){
 const v=String(raw??'').trim(),m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
 if(!m)return null;
 const [year,month,day]=m.slice(1).map(Number);
 const d=new Date(Date.UTC(year,month-1,day));
 return d.getUTCFullYear()===year&&d.getUTCMonth()+1===month&&d.getUTCDate()===day?v:null;
}
function qualifyRecoveryWindow(plan,{start=dates.start,end=dates.end}={}){
 if(!isoBusinessDate(start)||!isoBusinessDate(end)||start>end)
   throw Error('Recovery dates must be valid, ascending ISO business dates');
 if(!plan||typeof plan!=='object'||!plan.operations||typeof plan.operations!=='object')
   throw Error('Invalid operation plan');
 const operations={},held={},count={insert:0,update:0,refresh:0};
 for(const [profile,items]of Object.entries(plan.operations)){
  if(!Array.isArray(items))throw Error('Invalid profile operation set '+profile);
  operations[profile]=[];
  held[profile]={older:0,later:0,undated:0,invalid:0};
  for(const op of items){
   if(!['insert','update','refresh'].includes(op.action))
     throw Error('Unexpected action in recovery plan: '+op.action);
   const raw=String(op.businessDate??'').trim();
   const date=isoBusinessDate(raw);
   if(!date){held[profile][raw?'invalid':'undated']++;continue}
   if(date<start){held[profile].older++;continue}
   if(date>end){held[profile].later++;continue}
   operations[profile].push({...op});
   count[op.action]++;
  }
 }
 const heldTotals=Object.values(held).reduce((n,x)=>{
  for(const key of Object.keys(n))n[key]+=x[key];
  return n;
 },{older:0,later:0,undated:0,invalid:0});
 return {mode:'DATE_BOUND_REVIEW_ONLY',dateWindow:{start,end},
   authorizedOperations:operations,eligibleCount:Object.values(count).reduce((n,x)=>n+x,0),
   actionCounts:count,heldByDate:held,heldTotals,
   readyForExecution:false,requiresExactSourceManifest:true,requiresFreshDBPreimage:true,
   protectionPolicyStillRequired:true,independentReviewRequired:true,
   unresolvedPlanConflicts:Array.isArray(plan.conflicts)?plan.conflicts.length:0};
}
module.exports={isoBusinessDate,qualifyRecoveryWindow,RECOVERY_WINDOW:dates};
