'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');

function parseArgs(argv){const out={};for(const item of argv){if(!item.startsWith('--'))continue;const [k,...r]=item.slice(2).split('=');out[k]=r.length?r.join('='):true;}return out;}
function readJson(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
function sha256File(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
function writeAtomic(file,obj){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp.${process.pid}`;fs.writeFileSync(tmp,`${JSON.stringify(obj,null,2)}\n`,{mode:0o600});fs.renameSync(tmp,file);try{fs.chmodSync(file,0o600);}catch{}}
function norm(p){return path.resolve(String(p));}
const a=parseArgs(process.argv.slice(2));
const action=String(a.action||'validate');
const root=path.resolve(__dirname,'..','..');
const stateFile=norm(a.state||process.env.PHASE7_RESUME_STATE_FILE||path.join(process.env.EVIDENCE||path.join(root,'output'),'phase7_resumable_active.json'));
const contractPath=norm(a.contract||process.env.MAPPING_CONTRACT_FILE||path.join(root,'mappings','mapping-contract-v2.json'));
const manifestPath=norm(a.manifest||process.env.SOURCE_MANIFEST_FILE||path.join(root,'source-manifest.json'));
const schemaPath=norm(a.schema||path.join(root,'schema','weavonpq_weaving.schema.json'));
const csvDir=norm(a['csv-dir']||process.env.CSV_DIR||path.join(root,'csv_files'));
const attPath=norm(a.attestation||process.env.NORMALIZATION_ATTESTATION_FILE||path.join(root,'normalization-attestation.json'));
const outputRoot=norm(a['output-root']||process.env.CLI_CONTRACT_OUTPUT_ROOT||path.join(root,'output','mapping_contract_v2'));
const chunkSize=Number(a['chunk-size']||process.env.V323_CHUNK_ROWS||500);
const nodeHeapMb=Number(a['node-heap-mb']||process.env.V323_NODE_HEAP_MB||256);
const batchChunks=Number(a['batch-chunks']||process.env.V323_PHASE7_CHUNKS_PER_INVOCATION||15);
if(chunkSize!==500) throw new Error(`Production chunk size must remain 500; got ${chunkSize}`);
if(nodeHeapMb!==256) throw new Error(`This resumable cPanel release requires V323_NODE_HEAP_MB=256; got ${nodeHeapMb}`);
if(!Number.isInteger(batchChunks)||batchChunks<1||batchChunks>20) throw new Error(`V323_PHASE7_CHUNKS_PER_INVOCATION must be an integer 1..20; got ${batchChunks}`);
for(const p of [contractPath,manifestPath,schemaPath]) if(!fs.existsSync(p)) throw new Error(`Required binding file missing: ${p}`);
if(!fs.existsSync(csvDir)||!fs.statSync(csvDir).isDirectory()) throw new Error(`CSV directory missing: ${csvDir}`);
if(!fs.existsSync(attPath)) throw new Error(`Normalization attestation missing: ${attPath}`);
const contract=readJson(contractPath);
const bindings={
 contractPath, contractFileSha256:sha256File(contractPath), contractPublishedSha256:contract.published_contract_sha256||null,
 manifestPath, manifestSha256:sha256File(manifestPath), schemaPath, schemaSha256:sha256File(schemaPath),
 csvDir, normalizationAttestationPath:attPath, normalizationAttestationSha256:sha256File(attPath),
 outputRoot, chunkSize, nodeHeapMb,
 dbName:String(process.env.DB_NAME||''), expectedDb:String(process.env.IMPORT_EXPECTED_DB||''), productionDb:String(process.env.PRODUCTION_DB_NAME||''),
 requireDbGuard:String(process.env.REQUIRE_DB_GUARD||''), requireDbForDispoResolution:String(process.env.REQUIRE_DB_FOR_DISPO_RESOLUTION||''),
};
function assertBindings(state){
 const diffs=[]; for(const [k,v] of Object.entries(bindings)){if(String(state.bindings?.[k]??'')!==String(v??'')) diffs.push({field:k,expected:state.bindings?.[k]??null,actual:v??null});}
 if(diffs.length){const e=new Error(`Phase-7 resumable binding mismatch: ${JSON.stringify(diffs)}`);e.code='PHASE7_BINDING_MISMATCH';throw e;}
}
if(action==='init'){
 if(fs.existsSync(stateFile)) throw new Error(`Active resumable Phase-7 state already exists: ${stateFile}`);
 const runId=String(a['run-id']||'').trim(); if(!/^prod_full_dry_\d{8}T\d{6}Z$/.test(runId)) throw new Error(`Invalid --run-id: ${runId}`);
 const runDir=path.join(outputRoot,runId); const adopt=String(a.adopt||'false')==='true';
 if(adopt){if(!fs.existsSync(runDir)) throw new Error(`Cannot adopt missing run directory: ${runDir}`);} else {if(fs.existsSync(runDir)) throw new Error(`Refusing to reuse existing run directory: ${runDir}`);fs.mkdirSync(path.join(runDir,'profiles'),{recursive:true,mode:0o700});}
 const state={version:'3.2.3-phase7-resumable-batches-20260816',status:'active',runId,runDir,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),adoptedInterruptedRun:adopt,bindings,batchChunks,invocations:0,lastCheckpoint:null};
 writeAtomic(stateFile,state); process.stdout.write(`${JSON.stringify({ok:true,action,runId,runDir,stateFile,adoptedInterruptedRun:adopt,bindings},null,2)}\n`);process.exit(0);
}
if(!fs.existsSync(stateFile)) throw new Error(`Active resumable Phase-7 state missing: ${stateFile}`);
const state=readJson(stateFile);assertBindings(state);
if(action==='validate'){
 process.stdout.write(`${JSON.stringify({ok:true,action,runId:state.runId,runDir:state.runDir,stateFile,status:state.status,adoptedInterruptedRun:state.adoptedInterruptedRun,invocations:Number(state.invocations||0),lastCheckpoint:state.lastCheckpoint||null},null,2)}\n`);process.exit(0);
}
if(action==='checkpoint'){
 if(state.status!=='active') throw new Error(`Cannot checkpoint state with status ${state.status}`);
 state.invocations=Number(state.invocations||0)+1;state.updatedAt=new Date().toISOString();state.lastCheckpoint={at:state.updatedAt,profile:String(a.profile||''),nextChunk:Number(a['next-chunk']||0)||null,completedChunksThisInvocation:Number(a.completed||0),reason:String(a.reason||'batch-limit')};writeAtomic(stateFile,state);
 process.stdout.write(`${JSON.stringify({ok:true,action,runId:state.runId,invocations:state.invocations,lastCheckpoint:state.lastCheckpoint},null,2)}\n`);process.exit(0);
}
if(action==='complete'){
 state.invocations=Number(state.invocations||0)+1;state.updatedAt=new Date().toISOString();state.status='completed';state.completedAt=state.updatedAt;state.lastCheckpoint={at:state.updatedAt,reason:'full-dry-run-accepted'};writeAtomic(stateFile,state);
 process.stdout.write(`${JSON.stringify({ok:true,action,runId:state.runId,status:state.status,completedAt:state.completedAt},null,2)}\n`);process.exit(0);
}
throw new Error(`Unknown --action: ${action}`);
