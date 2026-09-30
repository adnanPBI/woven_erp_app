'use strict';
const fs = require('fs');
const path = require('path');
try { require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env'), override: false }); } catch (_e) {}
const { forEachSourceObject, normalizeMatchText } = require('../../lib/source_index');

function args(argv){const o={};for(const a of argv){if(!a.startsWith('--'))continue;const [k,...r]=a.slice(2).split('=');o[k]=r.length?r.join('='):true;}return o;}
const o=args(process.argv.slice(2));
const root=path.resolve(__dirname,'../..');
const profileId=String(o.profile||'').trim();
const contractPath=path.resolve(o.contract||process.env.MAPPING_CONTRACT_FILE||path.join(root,'mappings/mapping-contract-v2.json'));
const manifestPath=path.resolve(o.manifest||process.env.SOURCE_MANIFEST_FILE||path.join(root,'source-manifest.json'));
const csvDir=path.resolve(o['csv-dir']||process.env.CSV_DIR||path.join(root,'csv_files'));
const outputRoot=path.resolve(o['output-root']||process.env.CLI_CONTRACT_OUTPUT_ROOT||path.join(root,'output/mapping_contract_v2'));
const dryRunId=String(o['dry-run-id']||process.env.APPROVED_DRY_RUN_ID||'').trim();
const chunkSize=Number(o['chunk-size']||500);
const errors=[];
if(profileId!=='dispo') errors.push({code:'DISPO_CHUNK_PROFILE_ONLY',profile:profileId});
if(chunkSize!==500) errors.push({code:'DISPO_CHUNK_SIZE_INVALID',expected:500,actual:chunkSize});

const contract=JSON.parse(fs.readFileSync(contractPath,'utf8'));
const manifest=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const profile=(contract.profiles||[]).find(p=>p.id==='dispo');
if(!profile) errors.push({code:'DISPO_PROFILE_MISSING'});
const me=(manifest.files||[]).find(x=>x.filename===profile?.source_file);
if(!me) errors.push({code:'DISPO_MANIFEST_ENTRY_MISSING',sourceFile:profile?.source_file||null});
const expectedRows=Number(me?.nonempty_rows);
if(!Number.isFinite(expectedRows)||expectedRows<0) errors.push({code:'DISPO_MANIFEST_ROW_COUNT_INVALID',value:me?.nonempty_rows});

const expectedKeys={
  dispo_plan_form:['dispo_no'],
  dispo_form_data:['dispo_number'],
  warp_yarn_details:['dispo_number','sl_no'],
  weft_yarn_details:['dispo_number','sl_no'],
  warp_broken_section:['dispo_number'],
  warp_broken_pattern:['dispo_number','sl_no'],
};
for(const [table,key] of Object.entries(expectedKeys)){
  const t=(profile?.tables||[]).find(x=>x.name===table);
  if(!t){errors.push({code:'DISPO_EXPECTED_TABLE_MISSING',table});continue;}
  const actual=(t.natural_key||[]).map(String);
  if(JSON.stringify(actual)!==JSON.stringify(key)) errors.push({code:'DISPO_NATURAL_KEY_CHANGED',table,expected:key,actual});
}

// Dispo chunking is allowed only while the mapping remains free of immutable
// cross-row/cumulative source-index formulas. DB lookups and direct row formulas are per-row.
const serialized=JSON.stringify(profile||{});
const forbidden=['sourceCumulative(','sourceWarpingValue(','sourceYarnReceiptSum(','latestDate(','cumulativeSum(','sourcePrevious(','sourceFolding','sourceDelivery'];
for(const token of forbidden) if(serialized.includes(token)) errors.push({code:'DISPO_CROSS_ROW_FORMULA_DETECTED',token});

const sourcePath=path.resolve(csvDir,profile?.source_file||'Dispo create form.csv');
let actualRows=0, missingDispo=0, duplicateDispo=0;
const seen=new Set();
if(!fs.existsSync(sourcePath)) errors.push({code:'DISPO_CERTIFIED_SOURCE_MISSING',sourcePath});
else {
  const meta=forEachSourceObject(sourcePath,(row)=>{
    const dispo=normalizeMatchText(row['Dispo No.'] ?? row['Dispo No'] ?? row['Dispo No ']);
    if(!dispo){missingDispo+=1;return true;}
    if(seen.has(dispo)) duplicateDispo+=1; else seen.add(dispo);
    return true;
  });
  actualRows=Number(meta?.nonempty_rows||0);
  if(Number.isFinite(expectedRows)&&actualRows!==expectedRows) errors.push({code:'DISPO_SOURCE_ROW_COUNT_MISMATCH',expected:expectedRows,actual:actualRows});
  if(missingDispo) errors.push({code:'DISPO_SOURCE_KEY_MISSING',count:missingDispo});
  if(duplicateDispo) errors.push({code:'DISPO_SOURCE_KEY_DUPLICATE',count:duplicateDispo,message:'Dispo chunk boundaries are unsafe if one normalized Dispo No. appears in more than one source row.'});
}

let drySegment=null;
if(!dryRunId) errors.push({code:'DISPO_ACCEPTED_DRY_RUN_ID_MISSING'});
else {
  const indexPath=path.join(outputRoot,dryRunId,'segmented_dry_run_index.json');
  if(!fs.existsSync(indexPath)) errors.push({code:'DISPO_ACCEPTED_DRY_RUN_INDEX_MISSING',indexPath});
  else {
    const idx=JSON.parse(fs.readFileSync(indexPath,'utf8'));
    drySegment=(idx.profiles||[]).find(x=>x.profile==='dispo')||null;
    if(idx.ok!==true) errors.push({code:'DISPO_ACCEPTED_DRY_RUN_NOT_OK'});
    if(!drySegment) errors.push({code:'DISPO_ACCEPTED_DRY_RUN_SEGMENT_MISSING'});
    else {
      if(Number(drySegment.exitCode||0)!==0) errors.push({code:'DISPO_ACCEPTED_DRY_RUN_EXIT_NONZERO',exitCode:drySegment.exitCode});
      if(drySegment.dbBacked!==true) errors.push({code:'DISPO_ACCEPTED_DRY_RUN_NOT_DB_BACKED'});
      if(Number(drySegment.sourceRows||0)!==expectedRows||Number(drySegment.processedRows||0)!==expectedRows) errors.push({code:'DISPO_ACCEPTED_DRY_RUN_COVERAGE_MISMATCH',expectedRows,sourceRows:drySegment.sourceRows,processedRows:drySegment.processedRows});
    }
  }
}

const result={
  ok:errors.length===0,
  verifierVersion:'3.2.3-live-dispo-chunk-safety-20260817',
  profile:'dispo',
  sourceFile:profile?.source_file||null,
  expectedRows:Number.isFinite(expectedRows)?expectedRows:null,
  actualRows,
  chunkSize,
  chunkCount:Number.isFinite(expectedRows)?Math.ceil(expectedRows/chunkSize):null,
  normalizedDispoKeys:seen.size,
  missingDispo,
  duplicateDispo,
  acceptedDryRunId:dryRunId||null,
  acceptedDryRunSegment:drySegment?{chunked:!!drySegment.chunked,exitCode:drySegment.exitCode,dbBacked:drySegment.dbBacked,sourceRows:drySegment.sourceRows,processedRows:drySegment.processedRows}:null,
  safetyBasis:'unique-normalized-dispo-per-source-row + no cross-row source-index formulas + accepted full DB-backed dry-run coverage',
  errors,
};
console.log(JSON.stringify(result,null,2));
if(!result.ok) process.exitCode=1;
