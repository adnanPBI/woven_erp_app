'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert');
const {verifyRecoveredRows,failedRows}=require('../scripts/local/verify_recovered_rows');
const {sha256File}=require('../scripts/local/common');
const profiles=require('../mappings/mapping-contract-v2.json').import_order;
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'local-recovery-')),retryDir=path.join(dir,'retry');fs.mkdirSync(retryDir);
 const write=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 try{
  const summary={mode:'live',status:'failed',rejectedRows:1,validationErrors:0,requiredLookupMisses:0,criticalLookupMisses:0,fkDependencyFailures:0,csvDir:dir,sourceManifestFileSha256:'manifest',approvedDryRunId:'dry'};
  write('summary.json',summary);write('reconciliation.json',Object.fromEntries(profiles.map(p=>[p,{processedRows:1,sourceRows:1}])));
  fs.writeFileSync(path.join(dir,'rejected_rows.csv'),'profile,rowNumber,reason,error\nloom,2,logical_unit_rolled_back,Deadlock found when trying to get lock\n');
  fs.writeFileSync(path.join(dir,'Loom production database.csv'),'Weaving Dates,Dispo No,__MIG_SOURCE_UID\n2024-01-02,D-1,source-uid\n');
  const retry={mode:'live',status:'completed',selectedProfiles:['loom'],limit:1,offset:0,sourceManifestFileSha256:'manifest',approvedDryRunId:'dry',validationErrors:0,requiredLookupMisses:0,criticalLookupMisses:0,rejectedRows:0,fkDependencyFailures:0};
  write('retry/summary.json',retry);write('retry/status.json',{status:'completed'});
  write('retry/row_progress.jsonl',{outcome:'committed',importer:'loom',sourceRowNumber:2});
  const report={originalRunDir:dir,originalSummarySha256:sha256File(path.join(dir,'summary.json')),retries:[{profile:'loom',sourceRowNumber:2,runDir:retryDir,summarySha256:sha256File(path.join(retryDir,'summary.json'))}]};write('recovery.json',report);
  const state={latestLiveRunDir:dir,latestLiveRecovery:path.join(dir,'recovery.json')};
  const db={query:async sql=>sql.includes('SELECT id')?[[{id:10}]]:[[{n:1}]]};
  assert.strictEqual(await verifyRecoveredRows(state,summary,db),1);
  write('retry/row_progress.jsonl',{outcome:'committed',importer:'loom',sourceRowNumber:3});
  await assert.rejects(()=>verifyRecoveredRows(state,summary,db),/row evidence mismatch/);
  write('retry/row_progress.jsonl',{outcome:'committed',importer:'loom',sourceRowNumber:2});
  await assert.rejects(()=>verifyRecoveredRows(state,summary,{query:async sql=>sql.includes('SELECT id')?[[]]:[[{n:0}]]}),/parent missing/);
  assert.throws(()=>failedRows(dir,{...summary,requiredLookupMisses:1}),/non-row failure/);
  write('retry/summary.json',{...retry,status:'failed'});
  await assert.rejects(()=>verifyRecoveredRows(state,summary,db),/evidence changed/);
  console.log('local_recovery.test.js: PASS');
 }finally{
  for(const f of fs.readdirSync(retryDir))fs.unlinkSync(path.join(retryDir,f));fs.rmdirSync(retryDir);
  for(const f of fs.readdirSync(dir))fs.unlinkSync(path.join(dir,f));fs.rmdirSync(dir);
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
