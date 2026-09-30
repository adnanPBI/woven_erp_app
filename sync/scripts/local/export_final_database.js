'use strict';
const fs=require('fs');
const path=require('path');
const readline=require('readline');
const {once}=require('events');
const {pipeline}=require('stream/promises');
const {createGzip}=require('zlib');
const {connect,cfg}=require('./db');
const {ROOT,DATA_ROOT,ensureDir,readState,readJson,writeJson,sha256File,run,updateState}=require('./common');
const quote=s=>'`'+s.replace(/`/g,'``')+'`';
(async()=>{
 const db=cfg(),state=readState(),verified=readJson(state.latestVerification);
 if(state.activeMigrationRunId||!verified?.ok)throw Error('Completed verified migration required');
 const out=ensureDir(path.join(DATA_ROOT,'exports','final_2026-09-22'));
 const file=path.join(out,'weavonpq_weaving.sql');
 if(fs.existsSync(file))throw Error('Final export already exists; refusing overwrite');
 const c=await connect();
 try{
  const [objects]=await c.query('SHOW FULL TABLES');
  const excluded=['local_retained_fingerprints','local_retained_tables','order_summary_stats_restore_placeholder','v_import_manual_dispo_resolution_review_restore_placeholder'];
  const tables=objects.filter(r=>Object.values(r)[1]==='BASE TABLE'&&!excluded.includes(Object.values(r)[0])).map(r=>Object.values(r)[0]);
  const views=objects.filter(r=>Object.values(r)[1]==='VIEW').map(r=>Object.values(r)[0]);
  const [triggers]=await c.query('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()');
  if(triggers.some(r=>!/^local_(preserve|window)_/.test(r.TRIGGER_NAME)))throw Error('Unexpected business trigger requires export review');
  for(const table of ['ROUTINES','EVENTS']){const [r]=await c.query(`SELECT COUNT(*) n FROM information_schema.${table} WHERE ${table==='ROUTINES'?'ROUTINE_SCHEMA':'EVENT_SCHEMA'}=DATABASE()`);if(Number(r[0].n))throw Error('Unexpected stored routines/events require review');}
  const names=new Map();
  for await(const line of readline.createInterface({input:fs.createReadStream(path.join(ROOT,'weavonpq_weaving.sql')),crlfDelay:Infinity})){const m=line.match(/^CREATE TABLE `([^`]+)`/);if(m)names.set(m[1].toLowerCase(),m[1]);}
  const renamed=tables.filter(t=>names.has(t)&&names.get(t)!==t).map(t=>[t,names.get(t)]);
  function ddl(s){for(const [from,to]of renamed)s=s.split(quote(from)).join(quote(to));return s;}
  const counts={};for(const t of tables){const [[r]]=await c.query(`SELECT COUNT(*) n FROM ${quote(t)}`);counts[names.get(t)||t]=Number(r.n);}
  const raw=path.join(out,'source_dump.partial.sql');
  const executable=path.join(path.dirname(process.env.XAMPP_MYSQL_EXE||'C:/xampp/mysql/bin/mysql.exe'),'mysqldump.exe');
  await run(executable,['--host='+db.host,'--port='+db.port,'--user='+db.user,'--single-transaction','--quick','--hex-blob','--default-character-set=utf8mb4','--skip-triggers','--skip-add-drop-table','--skip-add-locks','--skip-disable-keys','--result-file='+raw,db.database,...tables],{env:{MYSQL_PWD:db.password},quiet:true});
  const stream=fs.createWriteStream(file,{flags:'wx'});
  const put=async s=>{if(!stream.write(s))await once(stream,'drain');};
  await put('-- Final Weaving ERP snapshot: retained original data plus migration through 2026-09-22 inclusive.\n-- Import once into a NEW EMPTY database selected in phpMyAdmin. No CREATE DATABASE or USE statement.\n-- Local preservation/date-window triggers and four local helper tables intentionally excluded.\n');
  let completed=false,creates=0;
  for await(let line of readline.createInterface({input:fs.createReadStream(raw),crlfDelay:Infinity})){
   if(/^INSERT INTO /.test(line)){line=line.replace(/^INSERT INTO `([^`]+)`/,(_,t)=>'INSERT INTO '+quote(names.get(t)||t));}
   else {if(/^(?:USE |CREATE DATABASE|DROP TABLE|TRUNCATE TABLE)/i.test(line))throw Error('Unexpected destructive/target-selecting SQL');line=ddl(line);}
   if(/^CREATE TABLE /.test(line))creates++;
   if(/^-- Dump completed on /.test(line))completed=true;
   await put(line+'\n');
  }
  if(!completed||creates!==tables.length)throw Error('Incomplete dump');
  for(const v of views){const [[r]]=await c.query('SHOW CREATE VIEW '+quote(v));let sql=r['Create View'];if(!/SQL SECURITY INVOKER/.test(sql))throw Error('Unexpected view security');sql=ddl(sql.replace(/DEFINER=`(?:[^`]|``)*`@`(?:[^`]|``)*`\s*/,'')).split(quote(db.database)+'.').join('');await put('\nSET character_set_client = utf8mb4;\nSET collation_connection = utf8mb4_general_ci;\n'+sql+';\n');}
  stream.end();await once(stream,'finish');
  await pipeline(fs.createReadStream(file),createGzip({level:9}),fs.createWriteStream(file+'.gz',{flags:'wx'}));
  const report={createdAt:new Date().toISOString(),sourceDatabase:db.database,cutoff:'2026-09-22',file,bytes:fs.statSync(file).size,sha256:sha256File(file),gzip:{file:file+'.gz',bytes:fs.statSync(file+'.gz').size,sha256:sha256File(file+'.gz')},excludedTables:excluded,excludedLocalTriggers:triggers.length,tableRenames:renamed,tableCounts:counts,views,verification:state.latestVerification,restoreTest:'pending'};
  writeJson(file+'.manifest.json',report);updateState({latestFinalExport:file,latestFinalExportManifest:file+'.manifest.json'});
  fs.unlinkSync(raw);
  console.log(JSON.stringify({file,bytes:report.bytes,gzip:report.gzip,tables:tables.length,views:views.length,renamed},null,2));
 }finally{await c.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
