'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert');
const {spawn}=require('child_process');
const mysql=require('mysql2/promise');
const {cfg}=require('../scripts/local/db');
const {writeJson}=require('../scripts/local/common');
const ROOT=path.resolve(__dirname,'..'),DIR=path.join(ROOT,'local_data','erp_integration');
(async()=>{
 const report=JSON.parse(fs.readFileSync(path.join(DIR,'report.json')));assert(report.ok);
 assert.equal(report.database,'weavonpq_erp_sync_test');
 const db=cfg(),secret=crypto.randomBytes(32).toString('hex');
 const port=3317,base='http://127.0.0.1:'+port;
 const fd=fs.openSync(path.join(DIR,'erp-bun.log'),'a');
 const child=spawn('C:/Users/NHTML/.bun/bin/bun.exe',['server.js'],{cwd:path.join(ROOT,'weaving-erp app'),env:{...process.env,DB_HOST:db.host,DB_PORT:String(db.port),DB_USER:db.user,DB_PASSWORD:db.password,DB_NAME:report.database,SESSION_SECRET:secret,PORT:String(port)},stdio:['ignore',fd,fd],windowsHide:true});
 let spawnError;child.on('error',e=>spawnError=e);
 let c,sid;
 try{
  let ready=false;
  for(let i=0;i<40;i++){if(spawnError)throw spawnError;if(child.exitCode!==null)throw Error('ERP exited; inspect local_data/erp_integration/erp-bun.log');try{const r=await fetch(base+'/main',{signal:AbortSignal.timeout(1000)});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  assert(ready,'Bun ERP server starts');
  c=await mysql.createConnection({...db,database:report.database});
  sid='sync-integration-'+crypto.randomBytes(16).toString('hex');
  const session={cookie:{originalMaxAge:600000,expires:new Date(Date.now()+600000).toISOString(),httpOnly:true,path:'/'},user:{id:0,username:'local-sync-integration',role:'admin',privileges:{}}};
  await c.query('INSERT INTO sessions(session_id,expires,data) VALUES(?,?,?)',[sid,Math.floor(Date.now()/1000)+600,JSON.stringify(session)]);
  const signed=sid+'.'+crypto.createHmac('sha256',secret).update(sid).digest('base64').replace(/=+$/,'');
  const cookie='precosting_session='+encodeURIComponent('s:'+signed);
  async function search(q=''){const r=await fetch(base+'/main/api/dropdown-search?type=dispo&limit=35&q='+encodeURIComponent(q),{headers:{cookie}});assert.equal(r.status,200,'Authenticated dropdown status');assert.match(r.headers.get('cache-control'),/no-store/);const data=await r.json();assert.equal(data.success,true);return data.items;}
  const added=await search(report.insertedDispo);assert(added.some(r=>r.value===report.insertedDispo&&r.raw.buyer_name==='SYNC INTEGRATION NEW'));
  const edited=await search(report.updatedDispo);assert(edited.some(r=>r.value===report.updatedDispo&&r.raw.buyer_name==='SYNC INTEGRATION UPDATED'));
  const latest=await search();for(let i=1;i<latest.length;i++)assert(String(latest[i-1].raw.dispo_date)>=String(latest[i].raw.dispo_date),'Business dates descending');
  const anonymous=await fetch(base+'/main/api/dropdown-search?type=dispo');assert.equal(anonymous.status,401);
  const result={ok:true,runtime:'Bun',database:report.database,insertVisible:true,editVisible:true,businessDateOrdering:true,cacheDisabled:true,authenticationRequired:true,verifiedAt:new Date().toISOString()};
  writeJson(path.join(DIR,'api-report.json'),result);console.log(JSON.stringify(result));
 }finally{if(c){if(sid)await c.query('DELETE FROM sessions WHERE session_id=?',[sid]);await c.end();}child.kill();fs.closeSync(fd);}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
