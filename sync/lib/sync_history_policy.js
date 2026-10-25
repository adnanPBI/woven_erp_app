'use strict';
const {parseIdentity}=require('./yarn_sync_identity');
const {isoBusinessDate}=require('./sync_date_scope');
function scopeHistory(previous,current,start,end){
 if(!isoBusinessDate(start)||!isoBusinessDate(end)||start>end)throw Error('Invalid sync date window');
 const within=d=>d>=start&&d<=end;
 const fullGroups=new Set(current.records.map(r=>r.group));
 const selected=current.records.filter(r=>within(r.businessDate));
 const selectedGroups=new Set(selected.map(r=>r.group));
 const old=previous.records.filter(r=>{
  if(selectedGroups.has(r.group))return true;
  if(fullGroups.has(r.group))return false;
  const date=parseIdentity(r.yarnIdentity)?.date;
  return !date||within(date);
 });
 return {previous:{...previous,records:old},current:{...current,records:selected}};
}
function retainMissingHistory(profile,plan,previous,current){
 const groups=new Set(current.records.map(r=>r.group));
 const retained=[],remaining=[];
 for(const c of plan.conflicts){
  if(!['ambiguous_edit_key_change_or_deletion','ambiguous_yarn_edit_or_removal','yarn_identity_backfill_required'].includes(c.reason)){
   remaining.push(c);continue;
  }
  const old=previous.records.filter(r=>c.sourceUid?r.uid===c.sourceUid:r.group===c.group);
  if(!old.length||old.some(r=>groups.has(r.group))){remaining.push(c);continue;}
  for(const r of old)retained.push({profile,sourceUid:r.uid,digest:r.digest,group:r.group,dispo:r.dispo,policy:'retain_missing_source_history'});
 }
 return {...plan,conflicts:remaining,ok:remaining.length===0,retainedHistory:retained};
}
module.exports={scopeHistory,retainMissingHistory};
