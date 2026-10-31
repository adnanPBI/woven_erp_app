'use strict';
// Requalify only the already reviewed exception. The immutable private base is
// pinned separately from the per-cycle exception; neither file belongs in Git.
// A changed/missing/additional duplicate is a new conflict, never permission to
// choose a different row. See docs/CPANEL_OPERATIONS.md in the combined repo.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {loadManualSkips,verifyRetained}=require('./sync_manual_conflict_skips');
const {isoBusinessDate}=require('./sync_date_scope');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=message=>{throw Error('Scheduled exact skips: '+message);};
// matchHash already excludes only the receipt's cumulative Last Received Date.
// The private anchor must explicitly opt into that ONE field; issue identity,
// quantities, receipt date and every other business field stay fingerprinted.
const key=(r,anchor=r)=>JSON.stringify([r.profile,r.group,anchor.mutableField==='Last Received Date'?r.sourceMatchHash||r.matchHash:r.digest,r.businessDate]);
function rebindPolicy(base,snapshots,receiptTotals,{cycle,manifestSha256,baseSha256,end}){
 if(!isoBusinessDate(end)||end<base.window.end)fail('invalid advancing cutoff');
 const retirements=require('./sync_skip_retirements').retirementRules(base),retiredSourceRows=[];
 const buckets=new Map();for(const r of base.currentRows){
  if(r.mutableField&&(r.profile!=='yarn-receive'||r.mutableField!=='Last Received Date'||!/^[a-f0-9]{64}$/.test(r.sourceMatchHash||'')))fail('unsupported mutable-field qualification');
  const k=key(r);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(r);
 }
 const currentRows=[],skippedTotals=new Map();
 for(const anchors of buckets.values()){
  const anchor=anchors[0],found=snapshots[anchor.profile].records.filter(r=>key({...r,profile:anchor.profile},anchor)===key(anchor)),rule=retirements.find(r=>anchors.some(a=>a.uid===r.retiredUid));
  if(found.length!==(rule?rule.currentCount:anchors.length))fail('reviewed source fingerprint or duplicate multiplicity changed');
  const activeAnchors=anchors.filter(a=>a.uid!==rule?.retiredUid);
  if(rule)retiredSourceRows.push(anchors.find(a=>a.uid===rule.retiredUid));
  // Pair indistinguishable reviewed occurrences deterministically AFTER exact
  // multiplicity validation. Row position is not an independent event identity.
  const ordered=[...found].sort((a,b)=>a.rowNumber-b.rowNumber);
  for(let i=0;i<activeAnchors.length;i++){
   const row=ordered[i];if(!row.uid||!Number.isInteger(row.rowNumber))fail('source identity missing');
   // Even a mutable-date match gets the FULL current digest. Later planning,
   // receipt aggregation, apply and verification all consume this frozen proof.
   currentRows.push({...activeAnchors[i],uid:row.uid,digest:row.digest,rowNumber:row.rowNumber});
   if(anchor.profile==='yarn-receive'){
    const lot=require('./source_index').normalizeYarnLotIdentity(row.yarnIdentity?.lot),amounts=JSON.parse(row.entryAmounts||'null');
    if(!lot||!Array.isArray(amounts)||!Number.isFinite(amounts[0])||amounts[0]<0)fail('skipped receipt amount is unqualified');
    if(rule&&(lot!==rule.lot||Math.abs(amounts[0]-rule.amount)>1e-7))fail('retired duplicate contribution changed');
    skippedTotals.set(lot,(skippedTotals.get(lot)||0)+amounts[0]);
   }
  }
 }
 if(new Set([...currentRows,...retiredSourceRows].map(r=>r.profile+'|'+r.uid)).size!==6)fail('ambiguous rebound source identity');
 // Recompute from the complete new receipt source, not just changed operations.
 // Do not let skipped/untransferred quantities enter dependent issue balances.
 // The retained contribution comes from verified target state, possibly zero.
 const receiptLots=base.receiptLots.map(r=>{
  const skippedTotal=r.skippedTotal-retirements.filter(a=>a.lot===r.lot).reduce((n,a)=>n+a.amount,0);
  if(skippedTotal<0||Math.abs((skippedTotals.get(r.lot)||0)-skippedTotal)>1e-7)fail('reviewed skipped contribution changed');
  const sourceTotal=receiptTotals.get(r.lot)||0,effectiveTotal=sourceTotal-skippedTotal+r.retainedTotal;
  if(!Number.isFinite(effectiveTotal)||effectiveTotal<0)fail('invalid effective receipt total');
  return {...r,sourceTotal,skippedTotal,effectiveTotal};
 });
 if([...skippedTotals.keys()].some(lot=>!base.receiptLots.some(r=>r.lot===lot)))fail('unreviewed skipped receipt lot');
 return {...base,cycle,sourceManifestSha256:manifestSha256,window:{start:base.window.start,end},currentRows,retiredSourceRows,receiptLots,
  automaticRestartAuthorized:true,scheduledBaseSha256:baseSha256,qualification:'scheduled-exact-rebind'};
}
async function qualifyScheduledSkips(env,prepared,cycle,end,{pending=false,connection}={}){
 if(!env.SYNC_SCHEDULED_SKIPS_BASE_FILE)return null;
 if(env.SYNC_AUTOMATIC_RESTART_AUTHORIZED!=='true'||env.SYNC_END_DATE)fail('explicit rolling-window restart authorization required');
 const bytes=fs.readFileSync(env.SYNC_SCHEDULED_SKIPS_BASE_FILE),baseSha=sha(bytes),base=JSON.parse(bytes);
 if(baseSha!==env.SYNC_SCHEDULED_SKIPS_BASE_SHA256)fail('reviewed base checksum changed');
 // Reuse manual qualification validation for the ORIGINAL anchor. Restart
 // authority is granted by the separate v3 hosted policy and environment switch.
 const loadedBase=loadManualSkips({...env,SYNC_MANUAL_SKIPS_FILE:env.SYNC_SCHEDULED_SKIPS_BASE_FILE,SYNC_MANUAL_SKIPS_SHA256:baseSha},base.sourceManifestSha256,base.cycle);
 if(base.automaticRestartAuthorized!==false)fail('immutable manual qualification required as anchor');
 if(!connection)fail('database preimage verification required');
 await verifyRetained(connection,loadedBase);
 const manifestSha=sha(fs.readFileSync(prepared.latestSourceManifest)),file=path.join(cycle,'scheduled-exact-skips.json');
 // "pending" also means an explicitly resumed certified cycle at this API.
 // Reuse its immutable file/cutoff across midnight; never silently replace a
 // reviewed plan with another export during recovery. New cycles use flag wx.
 if(!pending){
  if(fs.existsSync(file))fail('cycle already qualified; do not replace frozen evidence');
  const contract=require('../mappings/mapping-contract-v2.json'),profiles=contract.profiles.filter(p=>['yarn-receive','yarn-issue'].includes(p.id)),snapshots=await require('./sheets_sync_plan').inventory(prepared.latestCertifiedDir,profiles),totals=new Map();
  const {forEachSourceObject,normalizeYarnLotIdentity,parseNumber}=require('./source_index');
  forEachSourceObject(path.join(prepared.latestCertifiedDir,'Greige yarn receive.csv'),r=>{const lot=normalizeYarnLotIdentity(r['Yarn Lot']);if(lot)totals.set(lot,(totals.get(lot)||0)+(parseNumber(r['Receipt Qty (Kgs)'])||0));});
  const policy=rebindPolicy(base,snapshots,totals,{cycle,manifestSha256:manifestSha,baseSha256:baseSha,end});
  fs.writeFileSync(file,JSON.stringify(policy,null,2),{flag:'wx',mode:0o600});
 }
 const policy=JSON.parse(fs.readFileSync(file));if(policy.scheduledBaseSha256!==baseSha||policy.window.end>end||policy.window.end<base.window.end)fail('frozen scheduled qualification changed');
 // These are process-local bindings. Do not persist the generated UID/manifest
 // pair as the scheduler's base: the next fresh snapshot needs a new proof.
 env.SYNC_MANUAL_SKIPS_FILE=file;env.SYNC_MANUAL_SKIPS_SHA256=sha(fs.readFileSync(file));
 return loadManualSkips(env,manifestSha,cycle);
}
module.exports={rebindPolicy,qualifyScheduledSkips};
