'use strict';
// Requalify only the already reviewed exception. A changed/missing/additional
// duplicate is a new conflict, never permission to choose another source row.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {loadManualSkips,verifyRetained}=require('./sync_manual_conflict_skips');
const {isoBusinessDate}=require('./sync_date_scope');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw Error('Scheduled exact skips: '+message);};
const key=(r,anchor=r)=>JSON.stringify([r.profile,r.group,anchor.mutableField==='Last Received Date'?r.sourceMatchHash||r.matchHash:r.digest,r.businessDate]);
function rebindPolicy(base,snapshots,receiptTotals,{cycle,manifestSha256,baseSha256,end}){
 if(!isoBusinessDate(end)||end<base.window.end)fail('invalid advancing cutoff');
 const buckets=new Map();for(const r of base.currentRows){
  if(r.mutableField&&(r.profile!=='yarn-receive'||r.mutableField!=='Last Received Date'||!/^[a-f0-9]{64}$/.test(r.sourceMatchHash||'')))fail('unsupported mutable-field qualification');
  const k=key(r);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r);
 }
 const currentRows=[],skippedTotals=new Map();
 for(const anchors of buckets.values()){
  const anchor=anchors[0],found=snapshots[anchor.profile].records.filter(r=>key({...r,profile:anchor.profile},anchor)===key(anchor));
  if(found.length!==anchors.length)fail('reviewed source fingerprint or duplicate multiplicity changed');
  const ordered=[...found].sort((a,b)=>a.rowNumber-b.rowNumber);
  for(let i=0;i<anchors.length;i++){
   const row=ordered[i];if(!row.uid||!Number.isInteger(row.rowNumber))fail('source identity missing');
   currentRows.push({...anchors[i],uid:row.uid,digest:row.digest,rowNumber:row.rowNumber});
   if(anchor.profile==='yarn-receive'){
    const lot=require('./source_index').normalizeYarnLotIdentity(row.yarnIdentity?.lot),amounts=JSON.parse(row.entryAmounts||'null');
    if(!lot||!Array.isArray(amounts)||!Number.isFinite(amounts[0])||amounts[0]<0)fail('skipped receipt amount is unqualified');
    skippedTotals.set(lot,(skippedTotals.get(lot)||0)+amounts[0]);
   }
  }
 }
 if(new Set(currentRows.map(r=>r.profile+'|'+r.uid)).size!==6)fail('ambiguous rebound source identity');
 const receiptLots=base.receiptLots.map(r=>{
  if(Math.abs((skippedTotals.get(r.lot)||0)-r.skippedTotal)>1e-7)fail('reviewed skipped contribution changed');
  const sourceTotal=receiptTotals.get(r.lot)||0,effectiveTotal=sourceTotal-r.skippedTotal+r.retainedTotal;
  if(!Number.isFinite(effectiveTotal)||effectiveTotal<0)fail('invalid effective receipt total');
  return {...r,sourceTotal,effectiveTotal};
 });
 if([...skippedTotals.keys()].some(lot=>!base.receiptLots.some(r=>r.lot===lot)))fail('unreviewed skipped receipt lot');
 return {...base,cycle,sourceManifestSha256:manifestSha256,window:{start:base.window.start,end},currentRows,receiptLots,
  automaticRestartAuthorized:true,scheduledBaseSha256:baseSha256,qualification:'scheduled-exact-rebind'};
}
async function qualifyScheduledSkips(env,prepared,cycle,end,{pending=false,connection}={}){
 if(!env.SYNC_SCHEDULED_SKIPS_BASE_FILE)return null;
 if(env.SYNC_AUTOMATIC_RESTART_AUTHORIZED!=='true'||env.SYNC_END_DATE)fail('explicit rolling-window restart authorization required');
 const bytes=fs.readFileSync(env.SYNC_SCHEDULED_SKIPS_BASE_FILE),baseSha=sha(bytes),base=JSON.parse(bytes);
 if(baseSha!==env.SYNC_SCHEDULED_SKIPS_BASE_SHA256)fail('reviewed base checksum changed');
 const loadedBase=loadManualSkips({...env,SYNC_MANUAL_SKIPS_FILE:env.SYNC_SCHEDULED_SKIPS_BASE_FILE,SYNC_MANUAL_SKIPS_SHA256:baseSha},base.sourceManifestSha256,base.cycle);
 if(base.automaticRestartAuthorized!==false)fail('immutable manual qualification required as anchor');
 if(!connection)fail('database preimage verification required');
 await verifyRetained(connection,loadedBase);
 const manifestSha=sha(fs.readFileSync(prepared.latestSourceManifest)),file=path.join(cycle,'scheduled-exact-skips.json');
 if(!pending){
  if(fs.existsSync(file))fail('cycle already qualified; do not replace frozen evidence');
  const contract=require('../mappings/mapping-contract-v2.json'),profiles=contract.profiles.filter(p=>['yarn-receive','yarn-issue'].includes(p.id)),snapshots=await require('./sheets_sync_plan').inventory(prepared.latestCertifiedDir,profiles),totals=new Map();
  const {forEachSourceObject,normalizeYarnLotIdentity,parseNumber}=require('./source_index');
  forEachSourceObject(path.join(prepared.latestCertifiedDir,'Greige yarn receive.csv'),r=>{const lot=normalizeYarnLotIdentity(r['Yarn Lot']);if(lot)totals.set(lot,(totals.get(lot)||0)+(parseNumber(r['Receipt Qty (Kgs)'])||0));});
  const policy=rebindPolicy(base,snapshots,totals,{cycle,manifestSha256:manifestSha,baseSha256:baseSha,end});
  fs.writeFileSync(file,JSON.stringify(policy,null,2),{flag:'wx',mode:0o600});
 }
 const policy=JSON.parse(fs.readFileSync(file));if(policy.scheduledBaseSha256!==baseSha||policy.window.end>end||policy.window.end<base.window.end)fail('frozen scheduled qualification changed');
 env.SYNC_MANUAL_SKIPS_FILE=file;env.SYNC_MANUAL_SKIPS_SHA256=sha(fs.readFileSync(file));
 return loadManualSkips(env,manifestSha,cycle);
}
module.exports={rebindPolicy,qualifyScheduledSkips};
