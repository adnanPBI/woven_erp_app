'use strict';
// Read-only: compare audited historical identities with current certified Sheets.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const ROOT=path.resolve(__dirname,'../..');
const {inventory}=require('../../lib/sheets_sync_plan');
const {eventKey}=require('../../lib/yarn_sync_identity');
const summary=(bucket)=>{bucket.total=(bucket.total||0)+1;};
(async()=>{
const report=JSON.parse(fs.readFileSync(path.join(ROOT,'sync_data/yarn_identity_review.json'),'utf8'));
if(report.database!=='weavonpq_weaving_main'||report.summary.candidates!==342)
  throw Error('Expected reviewed source evidence not found');
const cycles=fs.readdirSync(path.join(ROOT,'sync_data/cycles')).sort().reverse();
let cycle=null,prepared=null,manifest=null;
for(const name of cycles){
  const loc=path.join(ROOT,'sync_data/cycles',name),state=path.join(loc,'local_state.json');
  if(!fs.existsSync(state)||!fs.existsSync(path.join(loc,'plan.json')))continue;
  const s=JSON.parse(fs.readFileSync(state,'utf8'));
  if(!s.latestCertifiedDir||!fs.existsSync(s.latestCertifiedDir)||!s.latestSourceManifest||!fs.existsSync(s.latestSourceManifest))continue;
  cycle=loc;prepared=s.latestCertifiedDir;manifest=s.latestSourceManifest;break;
}
if(!cycle)throw Error('No retained complete certified cycle');
const plan=JSON.parse(fs.readFileSync(path.join(cycle,'plan.json'),'utf8'));
const protectedDispos=new Set(plan.exclusions?.dispos||[]);
const protectedLots=new Set(plan.exclusions?.yarnLots||[]);
const conf=require('../../mappings/mapping-contract-v2.json');
const results={recoveryPacketCreated:report.generatedAt,sourceCycle:path.basename(cycle),
 sourceSha256:crypto.createHash('sha256').update(fs.readFileSync(manifest)).digest('hex'),
 requiredReviews:342,profiles:{},allCandidateProfilesIncluded:true};
for(const profile of ['yarn-issue','yarn-receive']){
 const p=conf.profiles.find(x=>x.id===profile);
 const current=(await inventory(prepared,[p]))[profile];
 const keyIndex=new Map();
 for(const row of current.records){
   const key=eventKey(row.yarnIdentity);
   if(!key)continue;
   if(!keyIndex.has(key))keyIndex.set(key,[]);
   keyIndex.get(key).push(row);
 }
 const out={reconstructionCandidates:0,uniqueIdenticalSourceEvent:0,uniqueChangedSourceEvent:0,
  duplicateSourceEventKey:0,notPresentInCurrentSource:0,
  missingSourceGroupMatch:0,alreadyHeldByProtection:0,
  possiblyEligibleWithoutProtection:0};
 for(const r of report.records.filter(x=>x.profile===profile&&x.decision==='REVIEW_REQUIRED')){
   out.reconstructionCandidates++;
   const key=eventKey(r.reconstructedIdentity);
   const sourceRows=keyIndex.get(key)||[];
   if(sourceRows.length===0){out.notPresentInCurrentSource++;continue}
   if(sourceRows.length!==1){out.duplicateSourceEventKey++;continue}
   const row=sourceRows[0];
   if(row.group!==r.expectedLedgerGroup){out.missingSourceGroupMatch++;continue}
   if(row.digest===r.expectedLedgerDigest)out.uniqueIdenticalSourceEvent++;
   else out.uniqueChangedSourceEvent++;
   if(protectedDispos.has(r.dispo)||protectedLots.has(r.reconstructedIdentity.lot))
     out.alreadyHeldByProtection++;
   else out.possiblyEligibleWithoutProtection++;
 }
 results.profiles[profile]=out;
}
results.totalCurrentMatch=Object.values(results.profiles).reduce((n,x)=>n+x.uniqueIdenticalSourceEvent+x.uniqueChangedSourceEvent,0);
results.potentialWithoutProtection=Object.values(results.profiles).reduce((n,x)=>n+x.possiblyEligibleWithoutProtection,0);
results.productionWrites=0;results.approvedCorrections=0;
console.log(JSON.stringify(results,null,2));
})().catch(e=>{console.error('YARN_CURRENT_SOURCE_CHECK_FAILED '+(e.code||e.message));process.exitCode=1});
