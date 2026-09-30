#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const { ROOT, DATA_ROOT, ensureDir, writeJson, updateState, loadEnv, stamp }=require('./common');const { connect }=require('./db');loadEnv();
(async()=>{
 const db=String(process.env.DB_NAME||'');if(!/_local$/i.test(db))throw new Error('Stale-provenance reconciliation is local-only.');
 const policy=JSON.parse(fs.readFileSync(path.join(ROOT,'config/provenance_policy.v3.2.3.json'),'utf8'));
 const allowed=new Set(Object.values(policy.profiles||{}).flat());
 const c=await connect();
 const [provTable]=await c.query("SHOW TABLES LIKE 'migration_import_provenance'");if(!provTable.length){await c.end();console.log(JSON.stringify({ok:true,stale:0,message:'No provenance table yet.'},null,2));return;}
 const details=[];let total=0;
 for(const table of allowed){const [rows]=await c.query(`SELECT p.id,p.profile,p.source_uid,p.target_table,p.target_primary_key FROM migration_import_provenance p LEFT JOIN \`${table}\` t ON t.id = CAST(p.target_primary_key AS UNSIGNED) WHERE p.target_table=? AND t.id IS NULL`,[table]);for(const r of rows)details.push(r);total+=rows.length;}
 let backupTable=null;
 if(total){backupTable=`migration_import_provenance_local_stale_${new Date().toISOString().replace(/\D/g,'').slice(0,14)}`;await c.query(`CREATE TABLE \`${backupTable}\` LIKE migration_import_provenance`);for(const table of allowed){await c.query(`INSERT INTO \`${backupTable}\` SELECT p.* FROM migration_import_provenance p LEFT JOIN \`${table}\` t ON t.id=CAST(p.target_primary_key AS UNSIGNED) WHERE p.target_table=? AND t.id IS NULL`,[table]);await c.query(`DELETE p FROM migration_import_provenance p LEFT JOIN \`${table}\` t ON t.id=CAST(p.target_primary_key AS UNSIGNED) WHERE p.target_table=? AND t.id IS NULL`,[table]);}}
 await c.end();const auditDir=ensureDir(path.join(DATA_ROOT,'reconciliation'));const audit=path.join(auditDir,`stale_provenance_${stamp()}.json`);writeJson(audit,{ok:true,database:db,staleBindingsRemoved:total,backupTable,details});updateState({latestStaleProvenanceAudit:audit,staleProvenanceRemoved:total,staleProvenanceBackupTable:backupTable});console.log(JSON.stringify({ok:true,staleBindingsRemoved:total,backupTable,audit},null,2));
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
