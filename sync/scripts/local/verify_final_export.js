'use strict';
const fs=require('fs');
const {spawn}=require('child_process');
const {pipeline}=require('stream/promises');
const {connect,cfg}=require('./db');
const {readState,readJson,writeJson,sha256File}=require('./common');
const quote=s=>'`'+s.replace(/`/g,'``')+'`';
(async()=>{
 const db=cfg(),state=readState(),manifest=state.latestFinalExportManifest,m=readJson(manifest);
 if(!m||sha256File(m.file)!==m.sha256)throw Error('Export checksum mismatch');
 const keepForInspection=process.argv.includes('--keep-for-inspection');
 const target=keepForInspection?'weavonpq_weaving_sep22_preview':'weavonpq_export_verify_20260922';
 const c=await connect();
 try{
  const [existing]=await c.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[target]);
  if(existing.length)throw Error('Verification database already exists; refusing overwrite');
  await c.query('CREATE DATABASE '+quote(target)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci');
  const child=spawn(process.env.XAMPP_MYSQL_EXE||'C:/xampp/mysql/bin/mysql.exe',['--host='+db.host,'--port='+db.port,'--user='+db.user,'--default-character-set=utf8mb4',target],{env:{...process.env,MYSQL_PWD:db.password},stdio:['pipe','ignore','pipe'],windowsHide:true});
  let error='';child.stderr.on('data',d=>{error+=d.toString();});
  const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Restore failed: '+error)));});
  await Promise.all([pipeline(fs.createReadStream(m.file),child.stdin),done]);
  const checks=[];
  for(const [table,expected]of Object.entries(m.tableCounts)){
   const [[r]]=await c.query('SELECT COUNT(*) n FROM '+quote(target)+'.'+quote(table));
   if(Number(r.n)!==expected)throw Error('Row count mismatch: '+table);
   const [s]=await c.query('CHECKSUM TABLE '+quote(db.database)+'.'+quote(table)+', '+quote(target)+'.'+quote(table)+' EXTENDED');
   if(s[0].Checksum===null||String(s[0].Checksum)!==String(s[1].Checksum))throw Error('Content checksum mismatch: '+table);
   checks.push({table,rows:Number(r.n),checksum:s[1].Checksum});
  }
  for(const view of m.views)await c.query('SELECT * FROM '+quote(target)+'.'+quote(view)+' LIMIT 0');
  const [[t]]=await c.query('SELECT COUNT(*) n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=?',[target]);
  if(Number(t.n)!==0)throw Error('Unexpected exported triggers');
  if(keepForInspection){
   const report={ok:true,verifiedAt:new Date().toISOString(),database:target,sourceFile:m.file,sha256:m.sha256,tableChecks:checks,views:m.views,triggerCount:0,retainedForInspection:true};
   writeJson(m.file+'.preview.json',report);
   console.log(JSON.stringify({ok:true,database:target,tables:checks.length,views:m.views.length,retainedForInspection:true}));
   return;
  }
  m.restoreTest={ok:true,verifiedAt:new Date().toISOString(),database:target,tableChecks:checks,views:m.views,triggerCount:0};
  writeJson(manifest,m);
  // Only the fixed, newly created verification database is removed, after successful checks.
  await c.query('DROP DATABASE '+quote(target));
  m.restoreTest.temporaryDatabaseRemoved=true;writeJson(manifest,m);
  console.log(JSON.stringify({ok:true,tables:checks.length,views:m.views.length,temporaryDatabaseRemoved:true,manifest}));
 }finally{await c.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
