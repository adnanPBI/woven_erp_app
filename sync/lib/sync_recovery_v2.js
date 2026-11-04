'use strict';
// Auto-Sync Recovery v2: durable metadata and fail-closed interruption detection.
// This is NOT a replacement for source identity reviews, SQL preimages or backup gates.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const FILE='recovery-v2.json';
const VERSION=2;
const DEFAULT_INTERVAL_MS=600000;
const MAX_BACKOFFS_MS=[4000,12000];
const FAILURE_TYPES=new Set([
  'source-download','source-auth','source-identity','planning-conflict',
  'sql-execution','backup','verification','hosting-capacity',
  'integrity','database-connection','worker-interrupted','unknown'
]);
const iso=()=>new Date().toISOString();
const hex64=s=>typeof s==='string'&&/^[0-9a-f]{64}$/i.test(s);
const fileHash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function fileFor(dataDir){return path.join(path.resolve(dataDir),FILE);}
function defaultState(){return {version:VERSION,lastVerified:null,current:null,consecutiveFailures:0,lastFailure:null,lastRecovery:null};}
function read(dataDir){
 const file=fileFor(dataDir);
 if(!fs.existsSync(file))return defaultState();
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size>262144)throw Error('Recovery v2 checkpoint is not a regular bounded file');
 const obj=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!obj||obj.version!==VERSION||!Number.isSafeInteger(obj.consecutiveFailures)||
   obj.consecutiveFailures<0||obj.consecutiveFailures>1000000||
   (obj.lastVerified&&(!Number.isFinite(Date.parse(obj.lastVerified.at))||
   !hex64(obj.lastVerified.manifestHash))))throw Error('Recovery v2 checkpoint is invalid: operator review required');
 return obj;
}
function write(dataDir,state){
 const file=fileFor(dataDir),dir=path.dirname(file);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 if(fs.lstatSync(dir).isSymbolicLink())throw Error('Linked recovery checkpoint directory');
 const temp=file+'.'+process.pid+'.tmp';
 const bytes=Buffer.from(JSON.stringify(state,null,2)+'\n');
 if(bytes.length>262144)throw Error('Recovery v2 checkpoint exceeds maximum size');
 const fd=fs.openSync(temp,'wx',0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{fs.renameSync(temp,file);}catch(e){try{fs.unlinkSync(temp);}catch{}throw e;}
}
function record(dataDir,mutate){
 const state=read(dataDir);
 mutate(state);
 write(dataDir,state);
 return state;
}
function validCycle(dataDir,cycle){
 if(typeof cycle!=='string')return false;
 try{
  const base=fs.realpathSync(path.join(dataDir,'cycles'));
  const full=fs.realpathSync(cycle);
  return full.startsWith(base+path.sep)&&fs.statSync(full).isDirectory();
 }catch{return false;}
}
function trustedPrevious(dataDir,status){
 // Seed only from a physically present, completed and verified previous cycle.
 if(!status||!['completed','unchanged'].includes(status.status)||
   !validCycle(dataDir,status.cycle)||!Number.isFinite(Date.parse(status.at)))return null;
 if(fs.existsSync(path.join(dataDir,'pending.json')))return null;
 try{
  const cycle=status.cycle;
  const plan=JSON.parse(fs.readFileSync(path.join(cycle,'plan.json'),'utf8'));
  const local=JSON.parse(fs.readFileSync(path.join(cycle,'local_state.json'),'utf8'));
  if(plan.ok!==true||plan.conflicts?.length>0)return null;
  const noWrites=plan.added===0&&plan.updated===0&&(plan.refreshed||0)===0;
  if(status.status==='unchanged'&&!noWrites)return null;
  if(status.status==='completed'){
   const verify=JSON.parse(fs.readFileSync(path.join(cycle,'business-verification.json'),'utf8'));
   if(verify.ok!==true||!hex64(verify.manifestHash)||verify.manifestHash!==fileHash(local.latestSourceManifest))return null;
  }
  if(!fs.statSync(local.latestSourceManifest).isFile())return null;
  return {at:status.at,cycle,manifestHash:fileHash(local.latestSourceManifest),
    planHash:fileHash(path.join(cycle,'plan.json')),result:status.status,
    counts:{insert:plan.added,update:plan.updated,refresh:plan.refreshed||0},origin:'verified-v1-cycle'};
 }catch{return null;}
}
function begin(dataDir,{cycle,previousStatus,intervalMs=DEFAULT_INTERVAL_MS,pending=false,now=iso()}){
 if(!validCycle(dataDir,cycle))throw Error('Recovery v2 requires a cycle inside the data directory');
 const t=Date.parse(now);
 if(!Number.isFinite(t))throw Error('Invalid recovery start time');
 return record(dataDir,s=>{
  if(!s.lastVerified){
   const prev=trustedPrevious(dataDir,previousStatus);
   if(prev)s.lastVerified=prev;
  }
  const prior=s.current&&s.current.state==='running' ? s.current : null;
  if(prior&&!s.lastFailure){
   s.lastFailure={at:now,category:'worker-interrupted',message:'Previous worker did not reach a terminal verified state'};
   s.consecutiveFailures++;
  }
  const gap=s.lastVerified?Math.max(0,t-Date.parse(s.lastVerified.at)):null;
  const missedIntervals=gap===null?null:Math.max(0,Math.floor(gap/intervalMs)-1);
  const previousFailed=previousStatus?.status==='failed';
  const catchUp=!!pending||!!prior||previousFailed||s.consecutiveFailures>0||
    (gap!==null&&gap>intervalMs*2);
  s.current={cycle,startedAt:now,updatedAt:now,phase:'starting',
    state:'running',catchUp,missedIntervals,
    lastVerifiedAtAtStart:s.lastVerified?.at||null,
    priorFailureCategory:s.lastFailure?.category||null,
    pendingFrozenPlan:!!pending,fetchRetries:0};
 });
}
function stage(dataDir,phase,extra={}){
 return record(dataDir,s=>{
  if(!s.current||s.current.state!=='running')return;
  s.current.phase=phase;s.current.updatedAt=iso();
  if(Number.isSafeInteger(extra.fetchRetries))s.current.fetchRetries=extra.fetchRetries;
  if(hex64(extra.manifestHash))s.current.manifestHash=extra.manifestHash;
 });
}
function observed(dataDir,phase){
 return record(dataDir,s=>{
  if(!s.current||s.current.state!=='running')return;
  s.current={...s.current,phase,state:'read-only',updatedAt:iso()};
 });
}
function success(dataDir,{cycle,sourceManifest,planFile,result,counts={},verified=false,now=iso()}){
 if(!['completed','unchanged'].includes(result)||!verified)throw Error('Recovery checkpoint requires a verified terminal worker result');
 if(!validCycle(dataDir,cycle))throw Error('Recovery checkpoint cycle mismatch');
 const manifestHash=fileHash(sourceManifest),planHash=fileHash(planFile);
 const plan=JSON.parse(fs.readFileSync(planFile,'utf8'));
 if(plan.ok!==true||plan.conflicts?.length>0)throw Error('Refusing checkpoint of conflicted plan');
 if(Object.values(plan.operations||{}).some(rows=>rows.some(row=>row.action==='delete')))throw Error('Refusing checkpoint of delete plan');
 if(result==='unchanged'&&(plan.added!==0||plan.updated!==0||(plan.refreshed||0)!==0))
  throw Error('Refusing unchanged checkpoint with planned operations');
 if(result==='completed'){
  const receipt=JSON.parse(fs.readFileSync(path.join(cycle,'business-verification.json'),'utf8'));
  if(receipt.ok!==true||receipt.manifestHash!==manifestHash||receipt.planHash!==planHash||
     !Number.isSafeInteger(receipt.targetsVerified)||receipt.targetsVerified<0)
    throw Error('Refusing to advance checkpoint without matching SQL business-verification receipt');
 }
 return record(dataDir,s=>{
  if(!s.current||s.current.cycle!==cycle||s.current.state!=='running')
   throw Error('Recovery checkpoint missing active matching cycle');
  const active=s.current;
  const previous=s.lastVerified;
  const summary={at:now,cycle,manifestHash,planHash,result,counts:{
    insert:Number(plan.added||0),update:Number(plan.updated||0),refresh:Number(plan.refreshed||0)},
    origin:'recovery-v2-verified'};
  s.lastVerified=summary;
  s.lastRecovery={at:now,hadBacklog:active.catchUp,missedIntervals:active.missedIntervals,
    startedFrom:previous?.at||null,outcome:result,counts:summary.counts,
    priorFailureCategory:active.priorFailureCategory||null};
  s.current={...active,state:'verified',phase:'complete',updatedAt:now,manifestHash,planHash};
  s.consecutiveFailures=0;s.lastFailure=null;
 });
}
function categorize(error,phase='',tail=''){
 const msg=String(error?.message||error||'')+' '+String(tail||'').slice(-2400);
 const t=msg.toLowerCase();
 if(/insufficient.*(?:space|quota)|storage budget|disk reserve|enospc|hosting account|exceeded quota/.test(t))return 'hosting-capacity';
 if(/checksum|integrity|sha256|signature.*mismatch|protection.*manifest/.test(t))return 'integrity';
 if(/invalid_grant|invalid credentials|401|403|permission denied|unauthorized service.account/.test(t))return 'source-auth';
 if(/ambiguous.*edit|reviewed.*reassignment|identity.*conflict|matching.*conflict|changed keys/.test(t))return 'source-identity';
 if(/conflict.*plan|planner|unknown missing.row|conflict.*unresolved/.test(t))return 'planning-conflict';
 if(['fetching','fetch-retry','source-preparation'].includes(phase)||/fetch_google_sheets|google.*(?:fetch|download)|source.*download|deadline-or-abort/.test(t))return 'source-download';
 if(phase==='backing-up'||/pre.sync backup|mysqldump/.test(t))return 'backup';
 if(phase==='applying'||/sql.*execution|deadlock|lock wait timeout/.test(t))return 'sql-execution';
 if(phase==='verifying'||/verify.*business|independent readback|readback/.test(t))return 'verification';
 if(/econnrefused|database connection|mysql|advisory.lock/.test(t))return 'database-connection';
 return 'unknown';
}
function errorMessage(category){
 const labels={
  'source-download':'Unable to fetch a complete source snapshot',
  'source-auth':'Google Sheets authentication or permission failure',
  'source-identity':'Business source identity requires exact review',
  'planning-conflict':'Planning conflict requires review',
  'sql-execution':'SQL apply interrupted; frozen evidence retained',
  'backup':'Required pre-apply backup failed',
  'verification':'Post-apply verification incomplete',
  'hosting-capacity':'Hosting storage or quota reserve unavailable',
  'integrity':'Protected configuration/source integrity check failed',
  'database-connection':'MySQL connection or lock unavailable',
  'worker-interrupted':'Worker exited without verification',
  'unknown':'Unexpected sync failure; inspect private worker log'};
 return labels[category]||labels.unknown;
}
function failure(dataDir,{error,phase='',logTail='',category,now=iso(),pending}={}){
 const type=FAILURE_TYPES.has(category)?category:categorize(error,phase,logTail);
 return record(dataDir,s=>{
  const active=s.current;
  if(active?.state==='failed'&&active.updatedAt===now)return;
  if(active?.state==='verified')return;
  s.consecutiveFailures=Math.min(1000000,s.consecutiveFailures+1);
  s.lastFailure={at:now,category:type,message:errorMessage(type),
    phase:phase||active?.phase||'unknown',pendingFrozenPlan:!!pending};
  s.current=active?{...active,state:'failed',phase:phase||active.phase,updatedAt:now}:null;
 });
}
function preflightFailure(dataDir,category='hosting-capacity'){
 if(!FAILURE_TYPES.has(category))throw Error('Unknown preflight category');
 return record(dataDir,s=>{
  const now=iso();
  s.consecutiveFailures=Math.min(1000000,s.consecutiveFailures+1);
  s.lastFailure={at:now,category,message:errorMessage(category),phase:'preflight',pendingFrozenPlan:false};
  s.current={state:'failed',phase:'preflight',updatedAt:now,startedAt:now,catchUp:true,
    missedIntervals:null,pendingFrozenPlan:false,fetchRetries:0};
 });
}
function unexpected(dataDir,{category='worker-interrupted',pending=false}={}){
 const s=read(dataDir);
 if(!s.current||s.current.state!=='running')return s;
 return failure(dataDir,{category,phase:s.current.phase,pending});
}
function transientSourceError(error,logTail){
 const text=(String(error?.message||error)+' '+String(logTail||'').slice(-1600)).toLowerCase();
 // Never retry identity drift, denied permissions, missing sheets, invalid manifests,
 // parse errors, malformed source IDs or other nontransient conditions.
 if(/\b401\b|\b403\b|\b404\b|invalid_grant|permission denied|invalid credentials|source identity|spreadsheetid.*placeholder|invalid header|configured header/.test(text))return false;
 return /econnreset|econnrefused|eai_again|enotfound|etimedout|timeout|deadline-or-abort|socket hang up|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|temporarily unavailable|network is unreachable/.test(text);
}
async function fetchWithRetries(fn,{logFile,backoffs=MAX_BACKOFFS_MS,onRetry=()=>{},sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(typeof fn!=='function')throw Error('Missing guarded source fetch callback');
 for(let retry=0;;retry++){
  try{return await fn(retry);}
  catch(e){
   let tail='';
   try{tail=fs.readFileSync(logFile,'utf8').slice(-3500);}catch{}
   if(retry>=backoffs.length||!transientSourceError(e,tail))throw e;
   await onRetry(retry+1);
   await sleep(backoffs[retry]);
  }
 }
}
function publicView(dataDir){
 const s=read(dataDir);
 return {
   version:2,lastVerifiedAt:s.lastVerified?.at||null,
   lastVerifiedResult:s.lastVerified?.result||null,
   lastVerifiedManifestHash:s.lastVerified?.manifestHash||null,
   catchUpNeeded:s.current?.state==='running'?!!s.current.catchUp:s.consecutiveFailures>0,
   current:s.current?{state:s.current.state,phase:s.current.phase,startedAt:s.current.startedAt,
     updatedAt:s.current.updatedAt,catchUp:s.current.catchUp,missedIntervals:s.current.missedIntervals,
     fetchRetries:s.current.fetchRetries,pendingFrozenPlan:s.current.pendingFrozenPlan}:null,
   consecutiveFailures:s.consecutiveFailures,lastFailure:s.lastFailure,
   lastRecovery:s.lastRecovery};
}
module.exports={VERSION,FILE,read,begin,stage,observed,success,failure,preflightFailure,unexpected,
  categorize,transientSourceError,fetchWithRetries,publicView,trustedPrevious,fileHash};
