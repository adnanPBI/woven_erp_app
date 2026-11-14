'use strict';
// Authenticated Sync History diagnostics: read-only, bounded, source-bound evidence.
// Never infer a historical conflict from the newest status or a different cycle.
const fs=require('fs/promises');
const path=require('path');
const crypto=require('crypto');

const ID=/^[0-9a-f]{16}_[0-9a-f]{16}$/;
const HASH=/^[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/;
const safe=(s,max=200)=>typeof s==='string'?s.replace(/[^\w.\/:@\- ]/g,'').slice(0,max):'';
async function boundedJson(file,max=256*1024){
 const st=await fs.lstat(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size>max)throw Error('Diagnostic source size or type rejected');
 return JSON.parse(await fs.readFile(file,'utf8'));
}
function cycleStart(cycle){
 const name=path.basename(String(cycle||''));
 if(!DATE.test(name))return null;
 const stamp=name.replace(/T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/,'T$1:$2:$3.$4Z');
 const d=Date.parse(stamp);
 return Number.isFinite(d)?d:null;
}
function compactConflicts(items){
 if(!Array.isArray(items))return [];
 return items.slice(0,1000).map(c=>({
  profile:safe(c.profile,50),reason:safe(c.reason,90),
  sourceUid:HASH.test(String(c.sourceUid||''))?c.sourceUid:'',
  group:HASH.test(String(c.group||''))?c.group:'',
  sourceRow:Number.isSafeInteger(c.sourceRow)&&c.sourceRow>0?c.sourceRow:
    Number.isSafeInteger(c.currentSourceRow)&&c.currentSourceRow>0?c.currentSourceRow:null,
  originalDispo:safe(c.originalDispo||c.previousDispo||c.oldDispo,90),
  originalParentId:Number.isSafeInteger(c.originalParentId)&&c.originalParentId>0?c.originalParentId:null,
  originalChildIds:Array.isArray(c.originalChildIds)?c.originalChildIds.filter(x=>Number.isSafeInteger(x)&&x>0).slice(0,100):[],
  previousBusinessDate:safe(c.previousBusinessDate,40),
  currentDispo:safe(c.currentDispo,90),
  challan:safe(c.challan,50),
  previousDigest:HASH.test(String(c.previousDigest||''))?c.previousDigest:'',
  currentDigest:HASH.test(String(c.currentDigest||''))?c.currentDigest:'',
  dispo:safe(c.dispo,90)
 })).filter(c=>c.profile&&c.reason);
}
function describeReason(r){
 const code=r.reason;
 const labels={
  ambiguous_yarn_edit_or_removal:'Yarn source identity was edited, reassigned, or removed; the existing MySQL row was protected.',
  ambiguous_edit_or_removal:'Source row was edited or removed; its prior database identity must be reviewed.',
  missing_source_identity:'Previously synchronized source identity is absent from the latest source snapshot.',
  missing_parent:'Required parent record could not be matched safely.',
  ambiguous_match:'Multiple possible historical records match this source row.'
 };
 return labels[code]||('Source reconciliation stopped on conflict code: '+(code||'unspecified'));
}
function annotateConflict(c,review,verification){
 const item={profile:c.profile,reasonCode:c.reason,sourceUid:c.sourceUid||null,
  group:c.group||null,sourceRow:c.sourceRow,dispo:c.dispo||null,
  explanation:describeReason(c),resolution:'No exact matching approval found in the active review registry.',
  matchedApprovedReview:false,verifiedApplied:false,originalParentId:c.originalParentId||null,originalChildId:c.originalChildIds?.[0]||null,
  originalChildIds:c.originalChildIds||[],previousBusinessDate:c.previousBusinessDate||null,
  oldDispo:c.originalDispo||null,newDispo:c.currentDispo||null,
  challan:c.challan||null,issueKg:null};
 if(item.oldDispo&&item.newDispo&&item.sourceUid){
  item.explanation='Source identity change reported: '+item.oldDispo+' → '+item.newDispo+
    (item.challan?', challan '+item.challan:'')+
    (item.sourceRow?' (source row '+item.sourceRow+')':'')+
    '. Existing database identity is protected until reviewed.';
 }
 if(review){
  item.matchedApprovedReview=true;
  const d=review.exactDispoChange;
  if(d&&d.policy==='exact-owner-approved-internal-dispo-v1'&&review.profile===c.profile){
   item.oldDispo=safe(d.oldDispo,70);item.newDispo=safe(d.newDispo,70);
   item.challan=safe(d.challan,50);item.issueKg=d.issueQuantityKg;
   item.sourceRow=d.sourceRow||item.sourceRow;
   item.originalParentId=d.parentId;item.originalChildId=d.childId;
   item.explanation='Confirmed original yarn-issue Dispo reassignment: '+item.oldDispo+' → '+item.newDispo+
    ', challan '+item.challan+', '+item.issueKg+' kg (original source row '+item.sourceRow+').';
   item.resolution='Exact owner-approved stable-ID reassignment registered.';
   if(verification&&verification.originalParentId===d.parentId&&verification.originalChildId===d.childId&&
     String(verification.correctedDispo||'').toLowerCase()===String(d.newDispo||'').toLowerCase()){
    item.verifiedApplied=true;
    item.resolution='Corrected in the original MySQL rows; verified by independent unattended cron and SQL readbacks.';
   }
  }else if(review.action==='retain-missing'){
   item.explanation='Formerly synchronized '+c.profile+' source identity is absent; original historical database record was protected.';
   item.resolution='Exact historical-retention approval registered; original business record retained.';
  }else{
   item.resolution='Exact review rule is registered: '+safe(review.action||review.reason||'owner reviewed',120);
  }
 }
 return item;
}
async function loadDiagnosticEvidence(syncRoot,{archiveRoot,reviewFile,verificationFile,dataDir}={}){
 const env=process.env;
 archiveRoot=archiveRoot||env.SYNC_DIAGNOSTICS_ARCHIVE_ROOT||path.join(syncRoot,'sync_diagnostics');
 reviewFile=reviewFile||env.SYNC_DIAGNOSTICS_REVIEW_FILE||path.join(syncRoot,'reviewed-reassignments.json');
 verificationFile=verificationFile||env.SYNC_DIAGNOSTICS_VERIFICATION_FILE||path.join(archiveRoot,'verification.json');
 dataDir=dataDir||path.join(syncRoot,'sync_data');
 const events=new Map();
 const add=(cycle,records,origin,recordedAtUtc,evidenceId)=>{
  const started=cycleStart(cycle);
  if(started===null||!records.length)return;
  const key=path.basename(cycle);
  const prev=events.get(key);
  if(prev&&prev.origin==='durable-summary'){
   // Archive remains authoritative. Enrich only the SAME cycle + exact UID,
   // group and reason from the worker's own current-cycle evidence. Never
   // attribute a newer unrelated change to an older historical incident.
   if(origin==='worker-conflict-review'){
    const additional=compactConflicts(records);
    for(const old of prev.conflicts){
     const extra=additional.find(c=>c.profile===old.profile&&
       c.reason===old.reason&&c.sourceUid===old.sourceUid&&
       c.group===old.group);
     if(!extra)continue;
     for(const field of ['sourceRow','originalDispo','currentDispo','challan','previousDigest','currentDigest','originalParentId','originalChildIds','previousBusinessDate'])
      if((old[field]===undefined||old[field]===null||old[field]===''||(Array.isArray(old[field])&&!old[field].length))&&extra[field])
       old[field]=extra[field];
    }
   }
   return;
  }
  events.set(key,{started,sourceCycle:key,origin,recordedAtUtc:safe(recordedAtUtc,40),
   evidenceId:safe(evidenceId,80),conflicts:compactConflicts(records)});
 };
 try{
  const dir=path.join(archiveRoot,'conflict-causes');
  const filenames=(await fs.readdir(dir)).filter(n=>ID.test(n.slice(0,-5))&&n.endsWith('.json')).sort().slice(-500);
  for(const name of filenames){
   try{
    const p=path.join(dir,name);
    const record=await boundedJson(p,512*1024);
    if(record.version===1&&record.planSha256&&HASH.test(record.planSha256))
     add(record.sourceCycle,record.conflicts,'durable-summary',record.recordedAtUtc,name.slice(0,-5));
   }catch(_){}
  }
 }catch(e){if(e.code!=='ENOENT')throw e;}
 try{
  const captures=path.join(archiveRoot,'captures');
  const ids=(await fs.readdir(captures)).filter(n=>ID.test(n)).sort().slice(-30);
  for(const id of ids){
   try{
    const dir=path.join(captures,id);
    const [ev,plan]=await Promise.all([boundedJson(path.join(dir,'evidence.json'),64*1024),
      boundedJson(path.join(dir,'plan.json'),12*1024*1024)]);
    if(ev.planSha256===crypto.createHash('sha256').update(JSON.stringify(plan,null,2)+'\n').digest('hex')){
      // This formatting check is deliberately optional; the summary is already
      // bound by its original file hash and will be verified below if unequal.
    }
    const bytes=await fs.readFile(path.join(dir,'plan.json'));
    if(crypto.createHash('sha256').update(bytes).digest('hex')!==ev.planSha256)continue;
    add(ev.sourceCycle,plan.conflicts,'forensic-snapshot',ev.capturedAtUtc,id);
   }catch(_){}
  }
 }catch(e){if(e.code!=='ENOENT')throw e;}
 try{
  const ev=await boundedJson(path.join(dataDir,'conflict-review.json'),256*1024);
  const records=(ev.conflicts||[]).map(c=>{
   const matches=(ev.diagnostics||[]).filter(d=>d.group===c.group&&d.sourceUid===c.sourceUid&&
    d.reason===c.reason&&c.profile==='folding');
   if(matches.length!==1)return c;
   const d=matches[0];return {...c,previousDispo:c.previousDispo||d.oldDispo,
    previousBusinessDate:c.previousBusinessDate||d.oldDate,
    originalParentId:c.originalParentId||d.parentId,originalChildIds:d.childIds};
  });
  add(ev.cycle,records,'worker-conflict-review',ev.at,'current-review');
 }catch(e){if(e.code!=='ENOENT')throw e;}
 let reviews=[],verification=null;
 try{const a=await boundedJson(reviewFile,2*1024*1024);if(Array.isArray(a))reviews=a;}catch(_){}
 try{verification=await boundedJson(verificationFile,128*1024);}catch(_){}
 const byUid=new Map();
 for(const r of reviews)if(r&&HASH.test(String(r.sourceUid||''))&&typeof r.profile==='string')
  byUid.set(r.profile+':'+r.sourceUid,r);
 return {events:[...events.values()],byUid,verification};
}
function decorateRuns(runs,evidence){
 const ev=evidence.events||[];
 for(const run of runs){
  const t=Date.parse(run.startedAt);
  const matches=ev.filter(x=>Number.isFinite(t)&&Math.abs(x.started-t)<=90000);
  const unique=new Map();
  for(const event of matches)for(const conflict of event.conflicts){
   const key=JSON.stringify([conflict.profile,conflict.reason,conflict.sourceUid||conflict.group||JSON.stringify(conflict)]);
   if(!unique.has(key)){
    const review=evidence.byUid?.get(conflict.profile+':'+conflict.sourceUid)||null;
    unique.set(key,{...annotateConflict(conflict,review,evidence.verification),
      evidenceOrigin:event.origin,evidenceId:event.evidenceId,capturedAtUtc:event.recordedAtUtc});
   }
  }
  const items=[...unique.values()];
  run.conflictCauses=items;
  run.conflictCount=items.length;
  run.conflictDetailsAvailable=items.length>0;
  run.rootCauseSummary=items.length
    ?items.length===1?(items[0].oldDispo&&items[0].newDispo?items[0].profile+': source Dispo reassignment ('+items[0].oldDispo+' → '+items[0].newDispo+')':
      items[0].profile+': '+items[0].reasonCode):
      items.length+' source conflicts — '+[...new Set(items.map(x=>x.profile))].join(', ')
    :run.status==='failed'?'Exact evidence unavailable or pruned; see Reason / details.'
    :run.status==='running'||run.status==='unconfirmed'?'Cycle in progress / not confirmed'
    :run.status==='skipped'?'Single-writer lock prevented overlap'
    :'None recorded';
 }
 return runs;
}
module.exports={cycleStart,compactConflicts,describeReason,loadDiagnosticEvidence,decorateRuns,annotateConflict};
