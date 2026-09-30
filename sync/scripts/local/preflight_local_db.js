#!/usr/bin/env node
'use strict';
const { loadEnv }=require('./common');const { connect }=require('./db');loadEnv();
const checks=[
 ['PO_form_data','po_issue_date'],['dispo_form_data','dispo_creating_date'],['yarn_receive_form','received_start_date'],['yarn_issue_form','issue_date'],['warping_form','warping_date'],['sizing_form','sizing_date'],['loom_production_form','weaving_date'],['folding_production_form','folding_production_date'],['greige_delivery_form','delivery_date']
];
(async()=>{
 const db=String(process.env.DB_NAME||'');if(!/_local$/i.test(db))throw new Error('Local preflight requires DB_NAME ending in _local.');
 const c=await connect();const result=[];let blocking=0;
 for(const [table,dateCol] of checks){const [[x]]=await c.query(`SELECT COUNT(*) c FROM \`${table}\` WHERE \`${dateCol}\` >= '2024-01-01' AND \`${dateCol}\` < '2027-01-01'`);const count=Number(x.c||0);result.push({table,dateColumn:dateCol,rows2024_2026:count});if(count>0)blocking++;}
 await c.end();const out={ok:blocking===0,database:db,blockingTables:blocking,checks:result};console.log(JSON.stringify(out,null,2));if(blocking)process.exitCode=1;
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
