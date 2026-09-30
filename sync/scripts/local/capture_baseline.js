#!/usr/bin/env node
'use strict';
const path=require('path');
const { DATA_ROOT, ensureDir, writeJson, updateState, loadEnv }=require('./common');
const { connect }=require('./db');
loadEnv();
const checks=[
 ['PO_form_data','po_issue_date'],['dispo_form_data','dispo_creating_date'],['yarn_receive_form','received_start_date'],['yarn_issue_form','issue_date'],
 ['warping_form','warping_date'],['sizing_form','sizing_date'],['loom_production_form','weaving_date'],['folding_production_form','folding_production_date'],['greige_delivery_form','delivery_date']
];
(async()=>{
 const dbName=String(process.env.DB_NAME||''); if(!/_local$/i.test(dbName))throw new Error('Baseline capture is local-only; DB_NAME must end in _local.');
 const c=await connect(); const rows={};
 for(const [table,dateCol] of checks){
   const [[x]]=await c.query(`SELECT COUNT(*) total, SUM(CASE WHEN \`${dateCol}\` >= '2023-01-01' AND \`${dateCol}\` < '2024-01-01' THEN 1 ELSE 0 END) y2023, SUM(CASE WHEN \`${dateCol}\` >= '2024-01-01' AND \`${dateCol}\` < '2027-01-01' THEN 1 ELSE 0 END) y2024_2026 FROM \`${table}\``);
   rows[table]={dateColumn:dateCol,total:Number(x.total||0),y2023:Number(x.y2023||0),y2024_2026:Number(x.y2024_2026||0)};
 }
 await c.end();
 const baseline={capturedAt:new Date().toISOString(),database:dbName,rows};
 const p=path.join(ensureDir(path.join(DATA_ROOT,'baseline')),'baseline_before_local_live.json'); writeJson(p,baseline); updateState({baselinePath:p,baselineCapturedAt:baseline.capturedAt});
 console.log(JSON.stringify({ok:true,baselinePath:p,baseline},null,2));
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
