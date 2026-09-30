#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const { ROOT, loadEnv }=require('./common');
const { connect }=require('./db');
loadEnv();
(async()=>{
  const dbName=String(process.env.DB_NAME||'');
  if(!/_local$/i.test(dbName)) throw new Error(`Safety block: DB_NAME must end in _local. Current=${dbName}`);
  const sql=fs.readFileSync(path.join(ROOT,'sql/v3_2_3/01_v323_support_schema.sql'),'utf8');
  const c=await connect();
  await c.query(sql);
  const [tables]=await c.query("SHOW TABLES LIKE 'migration_import_provenance'");
  await c.end();
  if(!tables.length) throw new Error('Support schema did not create migration_import_provenance.');
  console.log('V323_SUPPORT_SCHEMA=PASS');
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
