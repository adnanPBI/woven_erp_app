'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false }); } catch (_e) {}

function args(argv){const o={};for(const a of argv){if(!a.startsWith('--'))continue;const [k,...r]=a.slice(2).split('=');o[k]=r.length?r.join('='):true;}return o;}
function sha256File(f){return crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');}
function sha256Text(v){return crypto.createHash('sha256').update(String(v)).digest('hex');}
function readJson(f){return JSON.parse(fs.readFileSync(f,'utf8'));}
function atomicWrite(f,obj){fs.mkdirSync(path.dirname(f),{recursive:true});const t=`${f}.tmp.${process.pid}`;fs.writeFileSync(t,`${JSON.stringify(obj,null,2)}\n`,{mode:0o600});fs.renameSync(t,f);}
function cleanId(s){if(!/^[A-Za-z0-9._-]{1,96}$/.test(s))throw new Error('V323_LIVE_SEQUENCE_ID must match [A-Za-z0-9._-]{1,96}.');return s;}
const o=args(process.argv.slice(2));
const action=String(o.action||'status');
const root=path.resolve(__dirname,'../..');
const evidence=path.resolve(process.env.EVIDENCE||'/home/weavonpq/v323_preflight_evidence');
const sequenceId=cleanId(String(o['sequence-id']||process.env.V323_LIVE_SEQUENCE_ID||''));
const stateFile=path.join(evidence,`live_resumable_${sequenceId}.json`);
const contractPath=path.resolve(process.env.MAPPING_CONTRACT_FILE||path.join(root,'mappings/mapping-contract-v2.json'));
const manifestPath=path.resolve(process.env.SOURCE_MANIFEST_FILE||path.join(root,'source-manifest.json'));
const outputRoot=path.resolve(process.env.CLI_CONTRACT_OUTPUT_ROOT||path.join(root,'output/mapping_contract_v2'));
const dryRunId=String(o['dry-run-id']||process.env.APPROVED_DRY_RUN_ID||'').trim();
const token=String(o.token||process.env.PRODUCTION_APPROVAL_TOKEN||'');
const dbName=String(process.env.DB_NAME||'').trim();
const expectedDb=String(process.env.IMPORT_EXPECTED_DB||'').trim();
const productionDb=String(process.env.PRODUCTION_DB_NAME||'').trim();
const chunkSize=Number(process.env.V323_CHUNK_ROWS||500);
const heapMb=Number(process.env.V323_NODE_HEAP_MB||256);
const liveRoot=path.join(outputRoot,'live_resumable',sequenceId);

function currentBindings(){
  if(!dryRunId) throw new Error('Accepted dry-run ID is required.');
  if(!token) throw new Error('Approval token is required.');
  if(!dbName||!expectedDb||!productionDb) throw new Error('DB_NAME, IMPORT_EXPECTED_DB and PRODUCTION_DB_NAME are required.');
  if(!fs.existsSync(contractPath)||!fs.existsSync(manifestPath)) throw new Error('Contract or approved manifest missing.');
  return {
    contractPath, contractFileSha256:sha256File(contractPath), manifestPath, manifestSha256:sha256File(manifestPath),
    dryRunId, tokenSha256:sha256Text(token), dbName, expectedDb, productionDb, outputRoot, liveRoot, chunkSize, heapMb
  };
}
function compareBindings(a,b){for(const k of Object.keys(a)){if(String(a[k])!==String(b[k]))throw new Error(`Live resume binding mismatch for ${k}: state=${a[k]} current=${b[k]}`);}}

if(action==='init'){
  const b=currentBindings();
  let s;
  if(fs.existsSync(stateFile)){
    s=readJson(stateFile); compareBindings(s.bindings,b);
    if(s.status==='completed') console.log(JSON.stringify({ok:true,action:'init',alreadyCompleted:true,stateFile,sequenceId,liveRoot:s.bindings.liveRoot},null,2));
    else console.log(JSON.stringify({ok:true,action:'init',resumed:true,stateFile,sequenceId,liveRoot:s.bindings.liveRoot,lastCheckpoint:s.lastCheckpoint||null},null,2));
    process.exit(0);
  }
  fs.mkdirSync(liveRoot,{recursive:true,mode:0o700});
  s={version:'3.2.3-live-resumable-batches-20260817',status:'active',sequenceId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),bindings:b,invocations:0,lastCheckpoint:null};
  atomicWrite(stateFile,s);
  console.log(JSON.stringify({ok:true,action:'init',created:true,stateFile,sequenceId,liveRoot},null,2));
  process.exit(0);
}
if(!fs.existsSync(stateFile)) throw new Error(`Live resume state missing: ${stateFile}`);
const state=readJson(stateFile); const b=currentBindings(); compareBindings(state.bindings,b);
if(action==='status') { console.log(JSON.stringify({ok:true,stateFile,...state},null,2)); process.exit(0); }
if(action==='checkpoint'){
  state.invocations=Number(state.invocations||0)+Number(o['inc-invocation']||0);
  state.updatedAt=new Date().toISOString();
  state.lastCheckpoint={at:state.updatedAt,profile:String(o.profile||''),kind:String(o.kind||''),nextChunk:o['next-chunk']?Number(o['next-chunk']):null,message:String(o.message||'')};
  atomicWrite(stateFile,state); console.log(JSON.stringify({ok:true,action:'checkpoint',stateFile,lastCheckpoint:state.lastCheckpoint,invocations:state.invocations},null,2)); process.exit(0);
}
if(action==='complete'){
  state.status='completed'; state.updatedAt=new Date().toISOString(); state.completedAt=state.updatedAt; state.acceptancePath=path.resolve(String(o['acceptance-path']||'')); atomicWrite(stateFile,state);
  console.log(JSON.stringify({ok:true,action:'complete',stateFile,completedAt:state.completedAt,acceptancePath:state.acceptancePath},null,2)); process.exit(0);
}
throw new Error(`Unknown action: ${action}`);
