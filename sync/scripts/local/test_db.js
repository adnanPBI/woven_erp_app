#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, loadEnv, updateState } = require('./common');
const { connect } = require('./db');
loadEnv();
const required = ['pre_costing_data','PO_form_data','dispo_plan_form','dispo_form_data','yarn_receive_form','yarn_issue_form','warping_form','sizing_form','loom_production_form','folding_production_form','greige_delivery_form'];
(async()=>{
  const dbName=String(process.env.DB_NAME||'');
  if(!/_local$/i.test(dbName)) throw new Error(`Safety block: DB_NAME must end in _local for this local package. Current=${dbName}`);
  const c=await connect();
  const [[r]]=await c.query('SELECT DATABASE() database_name, VERSION() version');
  const [tables]=await c.query('SHOW TABLES');
  const names=new Set(tables.map(x=>String(Object.values(x)[0]).toLowerCase()));
  const missing=required.filter(t=>!names.has(t.toLowerCase()));
  const counts={};
  for(const t of required.filter(t=>names.has(t.toLowerCase()))){ const [[x]]=await c.query(`SELECT COUNT(*) c FROM \`${t}\``); counts[t]=Number(x.c); }
  await c.end();
  if(missing.length) throw new Error(`Database schema incomplete. Missing tables: ${missing.join(', ')}`);
  updateState({dbTestedAt:new Date().toISOString(),databaseName:r.database_name,databaseVersion:r.version,dbTableCounts:counts});
  console.log(JSON.stringify({ok:true,database:r.database_name,version:r.version,tableCount:names.size,requiredTableCounts:counts},null,2));
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
