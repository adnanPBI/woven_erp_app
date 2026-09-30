#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const { readState, readJson, writeJson, DATA_ROOT, ensureDir, updateState, loadEnv }=require('./common');
const { connect }=require('./db');
loadEnv();
const checks=[
 ['PO_form_data','po_issue_date'],['dispo_form_data','dispo_creating_date'],['yarn_receive_form','received_start_date'],['yarn_issue_form','issue_date'],
 ['warping_form','warping_date'],['sizing_form','sizing_date'],['loom_production_form','weaving_date'],['folding_production_form','folding_production_date'],['greige_delivery_form','delivery_date']
];
(async()=>{
 await require('./protect_retained_rows').protect(true);
 const state=readState(); const baseline=readJson(state.baselinePath||'');
 if(!baseline)throw new Error('Baseline not found. Live runner should capture it before writing.');
 if(!state.latestLiveRunDir)throw new Error('No completed local live run recorded.');
 const summary=readJson(path.join(state.latestLiveRunDir,'summary.json'));
 if(!summary)throw new Error('Live summary.json missing.');
 const c=await connect(); const rows={}; const findings=[];
 const recoveredRows=await require('./verify_recovered_rows').verifyRecoveredRows(state,summary,c);
 for(const [table,dateCol] of checks){
   const [[x]]=await c.query(`SELECT COUNT(*) total, SUM(CASE WHEN \`${dateCol}\` >= '2023-01-01' AND \`${dateCol}\` < '2024-01-01' THEN 1 ELSE 0 END) y2023, SUM(CASE WHEN \`${dateCol}\` >= '2024-01-01' AND \`${dateCol}\` < '2027-01-01' THEN 1 ELSE 0 END) y2024_2026 FROM \`${table}\``);
   rows[table]={dateColumn:dateCol,total:Number(x.total||0),y2023:Number(x.y2023||0),y2024_2026:Number(x.y2024_2026||0)};
   const before=baseline.rows?.[table];
   if(before && rows[table].y2023!==Number(before.y2023||0))findings.push({level:'error',code:'YEAR_2023_COUNT_CHANGED',table,before:before.y2023,after:rows[table].y2023});
   if(rows[table].y2024_2026<=0)findings.push({level:'error',code:'NO_2024_2026_ROWS',table});
 }
 const [[prov]]=await c.query("SELECT COUNT(*) c, COUNT(DISTINCT CONCAT(profile,'|',source_uid,'|',target_table)) distinct_bindings FROM migration_import_provenance");
 await c.end();
 if(summary.status!=='completed' && !(recoveredRows>0 && recoveredRows===Number(summary.rejectedRows||0)))findings.push({level:'error',code:'LIVE_RUN_NOT_COMPLETED',status:summary.status});
 if(Number(summary.validationErrors||0)>0)findings.push({level:'error',code:'VALIDATION_ERRORS',count:summary.validationErrors});
 if(Number(summary.rejectedRows||0)>recoveredRows)findings.push({level:'error',code:'REJECTED_ROWS',count:Number(summary.rejectedRows)-recoveredRows});
 if(Number(summary.requiredLookupMisses||0)>0)findings.push({level:'error',code:'REQUIRED_LOOKUP_MISSES',count:summary.requiredLookupMisses});
 const report={ok:!findings.some(f=>f.level==='error'),verifiedAt:new Date().toISOString(),database:process.env.DB_NAME,liveRunId:summary.runId,baselinePath:state.baselinePath,recoveryReport:state.latestLiveRecovery||null,summary:{status:recoveredRows?'completed_after_recovery':summary.status,originalStatus:summary.status,historicalRejectedRows:summary.rejectedRows,recoveredRows,validationErrors:summary.validationErrors,rejectedRows:Number(summary.rejectedRows||0)-recoveredRows,requiredLookupMisses:summary.requiredLookupMisses,criticalLookupMisses:summary.criticalLookupMisses},rows,provenance:{rows:Number(prov.c||0),distinctBindings:Number(prov.distinct_bindings||0)},findings};
 const outDir=ensureDir(path.join(DATA_ROOT,'verification')); const p=path.join(outDir,`verify_${summary.runId}.json`); writeJson(p,report); updateState({latestVerification:p,latestVerificationOk:report.ok,verifiedAt:report.verifiedAt});
 console.log(JSON.stringify({...report,reportPath:p},null,2)); if(!report.ok)process.exitCode=1;
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
