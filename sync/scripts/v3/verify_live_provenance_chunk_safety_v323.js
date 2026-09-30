'use strict';
const fs=require('fs');
const path=require('path');
try{require('dotenv').config({path:path.join(__dirname,'..','..','.env'),override:false});}catch(_e){}
const {forEachSourceObject}=require('../../lib/source_index');
function args(argv){const o={};for(const a of argv){if(!a.startsWith('--'))continue;const [k,...r]=a.slice(2).split('=');o[k]=r.length?r.join('='):true;}return o;}
const o=args(process.argv.slice(2));
const root=path.resolve(__dirname,'../..');
const profileId=String(o.profile||'').trim();
const allowed=new Set(['yarn-receive','yarn-issue','warping','sizing']);
const contractPath=path.resolve(o.contract||process.env.MAPPING_CONTRACT_FILE||path.join(root,'mappings/mapping-contract-v2.json'));
const manifestPath=path.resolve(o.manifest||process.env.SOURCE_MANIFEST_FILE||path.join(root,'source-manifest.json'));
const csvDir=path.resolve(o['csv-dir']||process.env.CSV_DIR||path.join(root,'csv_files'));
const outputRoot=path.resolve(o['output-root']||process.env.CLI_CONTRACT_OUTPUT_ROOT||path.join(root,'output/mapping_contract_v2'));
const dryRunId=String(o['dry-run-id']||process.env.APPROVED_DRY_RUN_ID||'').trim();
const chunkSize=Number(o['chunk-size']||500);
const errors=[];
if(!allowed.has(profileId)) errors.push({code:'PROVENANCE_CHUNK_PROFILE_UNSUPPORTED',profile:profileId,allowed:[...allowed]});
if(chunkSize!==500) errors.push({code:'PROVENANCE_CHUNK_SIZE_INVALID',expected:500,actual:chunkSize});
const contract=JSON.parse(fs.readFileSync(contractPath,'utf8'));
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const policy=JSON.parse(fs.readFileSync(path.join(root,'config/provenance_policy.v3.2.3.json'),'utf8'));
const profile=(contract.profiles||[]).find(p=>p.id===profileId);
if(!profile) errors.push({code:'PROFILE_MISSING',profile:profileId});
const parentTable=profile?.tables?.[0]?.name||null;
const provenanceTables=policy.profiles?.[profileId]||[];
if(!parentTable||!provenanceTables.includes(parentTable)) errors.push({code:'PROVENANCE_PARENT_REQUIRED',profile:profileId,parentTable,provenanceTables});
const me=(manifest.files||[]).find(x=>x.filename===profile?.source_file);
if(!me) errors.push({code:'MANIFEST_ENTRY_MISSING',sourceFile:profile?.source_file||null});
const expectedRows=Number(me?.nonempty_rows);
if(!Number.isFinite(expectedRows)||expectedRows<0) errors.push({code:'MANIFEST_ROW_COUNT_INVALID',value:me?.nonempty_rows});
const sourcePath=path.resolve(csvDir,profile?.source_file||'');
let actualRows=0;
if(!fs.existsSync(sourcePath)) errors.push({code:'CERTIFIED_SOURCE_MISSING',sourcePath});
else {
  const meta=forEachSourceObject(sourcePath,()=>true);
  actualRows=Number(meta?.nonempty_rows||0);
  if(Number.isFinite(expectedRows)&&actualRows!==expectedRows) errors.push({code:'SOURCE_ROW_COUNT_MISMATCH',expected:expectedRows,actual:actualRows});
}
// These profiles are chunked WITHOUT --scope-source-index. Therefore each child
// builds the same immutable full certified-source indexes as the accepted full run;
// offset/limit changes only which ordered source rows are committed in that child.
// Block mappings with known self-cumulative/stateful helpers that could depend on a
// single-process row-history cache. Cross-source helpers remain safe with full indexes.
const serialized=JSON.stringify(profile||{});
const forbidden=['sourceCumulative(','sourcePrevious(','cumulativeSum(','runningTotal(','previousSourceRow('];
for(const token of forbidden) if(serialized.includes(token)) errors.push({code:'STATEFUL_SELF_ROW_FORMULA_DETECTED',profile:profileId,token});
let drySegment=null;
if(!dryRunId) errors.push({code:'ACCEPTED_DRY_RUN_ID_MISSING'});
else {
  const indexPath=path.join(outputRoot,dryRunId,'segmented_dry_run_index.json');
  if(!fs.existsSync(indexPath)) errors.push({code:'ACCEPTED_DRY_RUN_INDEX_MISSING',indexPath});
  else {
    const idx=JSON.parse(fs.readFileSync(indexPath,'utf8'));
    drySegment=(idx.profiles||[]).find(x=>x.profile===profileId)||null;
    if(idx.ok!==true) errors.push({code:'ACCEPTED_DRY_RUN_NOT_OK'});
    if(!drySegment) errors.push({code:'ACCEPTED_DRY_RUN_SEGMENT_MISSING',profile:profileId});
    else {
      if(Number(drySegment.exitCode||0)!==0) errors.push({code:'ACCEPTED_DRY_RUN_EXIT_NONZERO',exitCode:drySegment.exitCode});
      if(drySegment.dbBacked!==true) errors.push({code:'ACCEPTED_DRY_RUN_NOT_DB_BACKED'});
      if(Number(drySegment.sourceRows||0)!==expectedRows||Number(drySegment.processedRows||0)!==expectedRows) errors.push({code:'ACCEPTED_DRY_RUN_COVERAGE_MISMATCH',expectedRows,sourceRows:drySegment.sourceRows,processedRows:drySegment.processedRows});
    }
  }
}
const result={
  ok:errors.length===0,
  verifierVersion:'3.2.3-live-provenance-chunk-safety-20260818',
  profile:profileId,
  sourceFile:profile?.source_file||null,
  parentTable,
  provenanceBacked:!!(parentTable&&provenanceTables.includes(parentTable)),
  expectedRows:Number.isFinite(expectedRows)?expectedRows:null,
  actualRows,
  chunkSize,
  chunkCount:Number.isFinite(expectedRows)?Math.ceil(expectedRows/chunkSize):null,
  sourceIndexMode:'full-immutable-index-per-chunk',
  acceptedDryRunId:dryRunId||null,
  acceptedDryRunSegment:drySegment?{chunked:!!drySegment.chunked,exitCode:drySegment.exitCode,dbBacked:drySegment.dbBacked,sourceRows:drySegment.sourceRows,processedRows:drySegment.processedRows}:null,
  safetyBasis:'source-uid provenance parent + sequential offset/limit coverage + full immutable source indexes per child + no known self-cumulative row-history formula + accepted full DB-backed dry-run coverage',
  errors
};
console.log(JSON.stringify(result,null,2));
if(!result.ok) process.exitCode=1;
