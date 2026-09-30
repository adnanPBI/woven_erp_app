'use strict';
const path=require('path');
const assert=require('assert');
const {ROOT,DATA_ROOT,readState,readJson,writeJson,sha256File,stamp,run,updateState,parseCliArgs}=require('./common');
const {connect,cfg}=require('./db');
const {failedRows,sourceRow,verifyRecoveredRows}=require('./verify_recovered_rows');
(async()=>{
  cfg(); const state=readState();assert(!state.activeMigrationRunId,'Wait for the main live sequence to finish');
  const id=String(parseCliArgs(process.argv.slice(2))['run-id']||'');assert(/^[A-Za-z0-9_.-]+$/.test(id),'Safe original run ID required');
  const dir=path.join(DATA_ROOT,'runs',id),summary=readJson(path.join(dir,'summary.json'));
  const failures=failedRows(dir,summary),report={originalRunDir:dir,originalSummarySha256:sha256File(path.join(dir,'summary.json')),retries:[]};
  for(const failure of failures){
    const source=sourceRow(summary,failure.rowNumber),c=await connect();
    try{const [existing]=await c.query('SELECT id FROM loom_production_form WHERE LOWER(TRIM(dispo_number))=? AND weaving_date=?',[source.values['Dispo No'].trim().toLowerCase(),source.values['Weaving Dates']]);assert(existing.length===0,'Refusing to replay a Loom row that already exists');}finally{await c.end();}
    const retryId=`local_retry_${stamp()}`,retryDir=path.join(DATA_ROOT,'runs',retryId);
    const env={CSV_DIR:state.latestCertifiedDir,SOURCE_MANIFEST_FILE:state.latestSourceManifest,NORMALIZATION_ATTESTATION_FILE:state.latestNormalizationAttestation,CLI_CONTRACT_OUTPUT_ROOT:path.join(DATA_ROOT,'runs'),CONTRACT_OUTPUT_DIR:retryDir,IMPORT_EXPECTED_DB:'weavonpq_weaving_local',REQUIRE_DB_GUARD:'true',ALLOW_PRODUCTION_DB:'false',LOCAL_PRESERVE_RETAINED:'true',IMPORT_PROGRESS_EVERY:'1',IMPORT_PROGRESS_JSONL:'true',CSV_DATE_ORDER:'dmy',BACKUP_CONFIRMED:'true'};
    await run(process.execPath,['import.js','--live','--yes','--backup-confirmed',`--approved-dry-run=${state.latestDryRunId}`,`--run-id=${retryId}`,`--output-dir=${retryDir}`,'--only=loom',`--offset=${source.offset}`,'--limit=1','--scope-source-index'],{cwd:ROOT,env});
    report.retries.push({profile:failure.profile,sourceRowNumber:Number(failure.rowNumber),sourceUid:source.values.__MIG_SOURCE_UID,runDir:retryDir,summarySha256:sha256File(path.join(retryDir,'summary.json'))});
  }
  const file=path.join(DATA_ROOT,'verification',`recovery_${id}.json`);writeJson(file,report);
  const proposed={...state,latestLiveRunDir:dir,latestLiveRunId:id,latestLiveRecovery:file};const c=await connect();
  try{await verifyRecoveredRows(proposed,summary,c);}finally{await c.end();}
  updateState({latestLiveRunDir:dir,latestLiveRunId:id,latestLiveRecovery:file,liveRecoveredAt:new Date().toISOString()});
  console.log(`RECOVERY_VERIFIED=${file}`);
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
