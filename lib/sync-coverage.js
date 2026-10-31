'use strict';
// The installed worker environment selects the evidence directory. Never fall
// back to an older successful directory when the configured cycle has failed.
const fs=require('fs/promises'),path=require('path'),dotenv=require('dotenv');
async function bounded(file,limit,json=true){
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)throw Error('Invalid sync evidence');
 const value=await fs.readFile(file,'utf8');
 if(Buffer.byteLength(value)>limit)throw Error('Oversized sync evidence');
 return json?JSON.parse(value):value;
}
async function dataDirectory(root){
 let env={};
 try{env=dotenv.parse(await bounded(path.join(root,'.env.sync'),128*1024,false));}
 catch(e){if(e.code!=='ENOENT')throw e;}
 return path.resolve(root,env.SYNC_DATA_DIR||'sync_data');
}
async function cyclePlan(data,cycle){
 if(typeof cycle!=='string')throw Error('Missing sync cycle');
 const base=path.resolve(data,'cycles'),resolved=path.resolve(cycle),relative=path.relative(base,resolved);
 if(!relative||relative.startsWith('..')||relative.includes('/')||relative.includes('\\')||path.isAbsolute(relative))throw Error('Invalid sync cycle');
 // Checking the real path rejects a linked cycle or a linked parent directory.
 if((await fs.lstat(resolved)).isSymbolicLink()||path.resolve(await fs.realpath(resolved))!==resolved)throw Error('Linked sync cycle');
 return {plan:await bounded(path.join(resolved,'plan.json'),32*1024*1024),cycle:relative};
}
async function readEvidence(root){
 const data=await dataDirectory(root),status=await bounded(path.join(data,'status.json'),65536);
 let evidence,evidenceCurrent=true,evidenceAt=null;
 try{evidence=await cyclePlan(data,status.cycle);}
 catch(e){
  // During preparation only, a dated prior plan can provide context. A failed,
  // corrupt or foreign current cycle must never inherit an old success.
  if(e.code!=='ENOENT'||!['fetching','planning'].includes(status.status))throw e;
  const prior=await bounded(path.join(data,'excluded-records-report.json'),8*1024*1024);
  if(prior.cycle===status.cycle||!Number.isFinite(Date.parse(prior.at))||!Number.isFinite(Date.parse(status.at))||Date.parse(prior.at)>Date.parse(status.at))throw Error('Invalid prior sync evidence');
  evidence=await cyclePlan(data,prior.cycle);evidenceCurrent=false;evidenceAt=prior.at;
 }
 return {data,status,...evidence,evidenceCurrent,evidenceAt};
}
const count=n=>Number.isSafeInteger(n)&&n>=0;
async function coverage(root){
 try{
  const e=await readEvidence(root),{status,plan}=e,exclusions=plan.exclusions;
  const allowed=[plan.added,plan.updated,plan.refreshed??0];
  if(!allowed.every(count)||!Array.isArray(plan.conflicts))throw Error('Invalid plan totals');
  let skipped=0,skippedConflicts=0,heldDispos=0,heldLots=0;
  if(exclusions){
   if(!exclusions.skippedOperations||!Array.isArray(exclusions.skippedConflicts)||!Object.values(exclusions.skippedOperations).every(count)||!Array.isArray(exclusions.dispos)||!Array.isArray(exclusions.yarnLots))throw Error('Invalid exclusion evidence');
   skipped=Object.values(exclusions.skippedOperations).reduce((a,b)=>a+b,0);skippedConflicts=exclusions.skippedConflicts.length;heldDispos=exclusions.dispos.length;heldLots=exclusions.yarnLots.length;
  }
  const exactSkips=plan.manualSkips?.skippedCurrentRows??0;if(!count(exactSkips))throw Error('Invalid exact skips');
  const conflicts=plan.conflicts.length,total=allowed.reduce((a,b)=>a+b,0);
  const state=status.status==='failed'||plan.ok!==true||conflicts?'blocked':skipped||skippedConflicts?'partial_plan':total?'changes_planned':'no_changes_detected';
  return {state,complete:false,at:status.at,workerStatus:status.status,evidenceCurrent:e.evidenceCurrent,evidenceAt:e.evidenceAt,evidenceCycle:e.cycle,skippedOperations:skipped,skippedConflicts,unresolvedConflicts:conflicts,exactSkips,heldDispos,heldLots,allowedOperations:total,proposedAdded:plan.added,proposedUpdated:plan.updated,proposedRefreshed:plan.refreshed??0,businessWindow:plan.businessWindow||null,conflictProfiles:[...new Set(plan.conflicts.map(c=>c.profile).filter(p=>typeof p==='string'&&/^[a-z-]+$/.test(p)))],failure:failureReason(status.error)};
 }catch(_){return {state:'unknown',complete:false};}
}
function failureReason(value){
 const s=String(value||'');
 if(/Ambiguous edits\/deletions|ambiguous_yarn|changed keys require review/.test(s))return 'Source identity conflict: existing database records were preserved; review is required.';
 if(/quota|reserve|storage budget|free space/i.test(s))return 'Storage or hosting reserve check failed before further writes.';
 if(/checksum|fingerprint|manifest|protection|Scheduled exact skips/i.test(s))return 'Source or protection evidence changed; qualification is required.';
 if(/download|fetch|HTTP|ECONN|ETIMEDOUT|ENOTFOUND/i.test(s))return 'Source download or connection failed; the scheduler will retry.';
 if(/heap out of memory|FATAL ERROR/i.test(s))return 'The worker exceeded its memory limit.';
 return s?'Synchronization stopped. Check the private worker report before retrying.':null;
}
function notice(c){
 if(c.state==='unknown')return 'Current sync evidence is unavailable; data completeness has not been verified. ';
 const prior=c.evidenceCurrent===false?'Prior plan evidence; the current poll is '+c.workerStatus+'. ':'';
 const exact=c.exactSkips?' '+c.exactSkips+' explicitly reviewed source records remain skipped.':'';
 if(c.state==='blocked'||c.state==='partial_plan')return prior+'DATA COVERAGE '+(c.state==='blocked'?'BLOCKED':'PARTIAL')+': '+c.unresolvedConflicts+' current matching conflicts; '+c.skippedOperations+' candidate operations excluded by broad holds; '+c.skippedConflicts+' conflicts inside those holds. '+c.heldDispos+' Dispos and '+c.heldLots+' yarn lots held.'+exact+' '+c.proposedAdded+' inserts and '+c.proposedUpdated+' updates proposed, not committed by this plan. '+(c.failure||'Review the current plan.')+' ';
 return prior+'Current worker: '+c.workerStatus+'. No unresolved matching conflict is present in this plan.'+exact+' Completion applies to its captured source snapshot; later Sheets edits require another successful cycle. ';
}
module.exports={coverage,notice,dataDirectory,readEvidence,failureReason};
