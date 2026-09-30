#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const { ROOT, DATA_ROOT, ensureDir, stamp, readState, updateState, run, loadEnv, parseCliArgs }=require('./common');
loadEnv();
const args=parseCliArgs(process.argv.slice(2));
const mode=String(args.mode||'dry-run').toLowerCase();
if(!['dry-run','live'].includes(mode))throw new Error('--mode must be dry-run or live');
(async()=>{
 require('./db').cfg();
 const dbName=String(process.env.DB_NAME||'');
 if(!/_local$/i.test(dbName))throw new Error(`Safety block: this runner writes only to a DB_NAME ending in _local. Current=${dbName}`);
 const state=readState();
 const certified=state.latestCertifiedDir, manifest=state.latestSourceManifest, attestation=state.latestNormalizationAttestation;
 for(const p of [certified,manifest,attestation])if(!p||!fs.existsSync(p))throw new Error('Prepared/certified sources are missing. Run prepare_sources.js first.');
 await run(process.execPath,['scripts/local/ensure_support_schema.js'],{cwd:ROOT});
 await run(process.execPath,['scripts/local/preflight_local_db.js'],{cwd:ROOT});
 await run(process.execPath,['scripts/local/protect_retained_rows.js'],{cwd:ROOT});
 const runsRoot=ensureDir(path.join(DATA_ROOT,'runs'));
 const runId=`local_${mode.replace('-','_')}_${stamp()}`;
 const runDir=path.join(runsRoot,runId);
 updateState({activeMigrationRunId:runId,activeMigrationRunDir:runDir,activeMigrationMode:mode,activeMigrationStartedAt:new Date().toISOString()});
 const env={
   CSV_DIR:certified,SOURCE_MANIFEST_FILE:manifest,NORMALIZATION_ATTESTATION_FILE:attestation,
   CLI_CONTRACT_OUTPUT_ROOT:runsRoot,CONTRACT_OUTPUT_DIR:runDir,
   IMPORT_EXPECTED_DB:dbName,REQUIRE_DB_GUARD:'true',ALLOW_PRODUCTION_DB:'false',
   IMPORT_PROGRESS_EVERY:'100',IMPORT_PROGRESS_JSONL:'true',CSV_DATE_ORDER:'dmy',LOCAL_PRESERVE_RETAINED:'true'
 };
 if(mode==='dry-run'){
   await run(process.execPath,['import.js','--dry-run',`--run-id=${runId}`,`--output-dir=${runDir}`],{cwd:ROOT,env});
   await run(process.execPath,['scripts/v3/verify_full_dry_run.js',`--run-id=${runId}`,`--output-root=${runsRoot}`,`--manifest=${manifest}`,`--csv-dir=${certified}`],{cwd:ROOT,env});
   const acceptance=path.join(runDir,'full_dry_run_acceptance.json');
   const accepted=JSON.parse(fs.readFileSync(acceptance,'utf8'));
   if(!accepted.ok)throw new Error('Full dry-run acceptance gate failed. Review the run output before live execution.');
   updateState({latestDryRunId:runId,latestDryRunDir:runDir,latestDryRunAcceptance:acceptance,dryRunAcceptedAt:new Date().toISOString(),activeMigrationRunId:null,activeMigrationRunDir:null,activeMigrationMode:null});
   console.log(`LOCAL_DRY_RUN=PASS\nAPPROVED_DRY_RUN_ID=${runId}\nRUN_DIR=${runDir}`);
   return;
 }
 const approvedDry=state.latestDryRunId;
 if(!approvedDry||!state.latestDryRunAcceptance||!fs.existsSync(state.latestDryRunAcceptance))throw new Error('Live blocked: run and pass the full dry run first.');
 await run(process.execPath,['scripts/local/backup_local_db.js'],{cwd:ROOT});
 await run(process.execPath,['scripts/local/reconcile_stale_provenance.js'],{cwd:ROOT});
 await run(process.execPath,['scripts/local/capture_baseline.js'],{cwd:ROOT});
 env.BACKUP_CONFIRMED='true';
 await run(process.execPath,['import.js','--live','--yes','--backup-confirmed',`--approved-dry-run=${approvedDry}`,`--run-id=${runId}`,`--output-dir=${runDir}`],{cwd:ROOT,env});
 updateState({latestLiveRunId:runId,latestLiveRunDir:runDir,liveCompletedAt:new Date().toISOString(),activeMigrationRunId:null,activeMigrationRunDir:null,activeMigrationMode:null});
 console.log(`LOCAL_LIVE_MIGRATION=PASS\nRUN_ID=${runId}\nRUN_DIR=${runDir}`);
})().catch(e=>{try{updateState({activeMigrationRunId:null,activeMigrationRunDir:null,activeMigrationMode:null,lastMigrationError:String(e.message||e),lastMigrationErrorAt:new Date().toISOString()});}catch(_){} console.error(e.stack||String(e));process.exit(1);});
