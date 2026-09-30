#!/usr/bin/env node
'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');
const { spawn }=require('child_process');
const { ROOT, readState, readJson, writeJson, loadEnv }=require('./common');
loadEnv();
const host=process.env.LOCAL_DASHBOARD_HOST||'127.0.0.1';
const port=Number(process.env.LOCAL_DASHBOARD_PORT||3210);
const webRoot=path.join(ROOT,'local_dashboard');
const googleConfigPath=path.join(ROOT,'config','local_google_sheets.json');
let active=null;
let recentLogs=[];
const sseClients=new Set();
let progressTail={file:null,offset:0,remainder:'',recent:[]};

function json(res,status,obj){const b=Buffer.from(JSON.stringify(obj,null,2));res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':b.length});res.end(b);}
function text(res,status,body,type='text/plain; charset=utf-8'){const b=Buffer.from(body);res.writeHead(status,{'content-type':type,'content-length':b.length});res.end(b);}
function safeStatic(req,res){const rel=req.url==='/'?'index.html':req.url.replace(/^\//,'').split('?')[0];const p=path.resolve(webRoot,rel);if(!p.startsWith(webRoot)||!fs.existsSync(p)||fs.statSync(p).isDirectory())return text(res,404,'Not found');const ext=path.extname(p).toLowerCase();const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};text(res,200,fs.readFileSync(p),types[ext]||'application/octet-stream');}
function readBody(req){return new Promise((resolve,reject)=>{let s='';req.on('data',d=>{s+=d;if(s.length>2e6){reject(new Error('Body too large'));req.destroy();}});req.on('end',()=>{try{resolve(s?JSON.parse(s):{});}catch(e){reject(e);}});req.on('error',reject);});}
function pushLog(line){for(const raw of String(line).split(/\r?\n/)){if(!raw)continue;recentLogs.push({ts:new Date().toISOString(),line:raw});if(recentLogs.length>400)recentLogs.shift();}}
function actionSpec(name){const node=process.execPath;const specs={
 'import-db':{cmd:node,args:['scripts/local/import_mysql_dump.js']},
 'test-db':{cmd:node,args:['scripts/local/test_db.js']},
 'fetch':{cmd:node,args:['scripts/local/fetch_google_sheets.js']},
 'prepare':{cmd:node,args:['scripts/local/prepare_sources.js']},
 'dry-run':{cmd:node,args:['scripts/local/run_migration.js','--mode=dry-run']},
 'live':{cmd:node,args:['scripts/local/run_migration.js','--mode=live']},
 'verify':{cmd:node,args:['scripts/local/verify_local_migration.js']},
 };
 return specs[name];
}
function startAction(name){if(active)throw new Error(`Another action is running: ${active.name}`);const spec=actionSpec(name);if(!spec)throw new Error('Unknown action');recentLogs=[];const child=spawn(spec.cmd,spec.args,{cwd:ROOT,env:{...process.env},windowsHide:true,stdio:['ignore','pipe','pipe']});active={name,pid:child.pid,startedAt:new Date().toISOString(),exitCode:null};child.stdout.on('data',d=>pushLog(d));child.stderr.on('data',d=>pushLog(d));child.on('error',e=>pushLog(e.stack||String(e)));child.on('close',code=>{pushLog(`[ACTION] ${name} exited with code ${code}`);active={...active,exitCode:code,finishedAt:new Date().toISOString()};setTimeout(()=>{if(active&&active.exitCode!==null)active=null;},2500);});return active;}
function currentRunStatus(state){const dir=state.activeMigrationRunDir||state.latestLiveRunDir||state.latestDryRunDir; if(!dir)return null;return readJson(path.join(dir,'status.json'))||null;}
function refreshProgress(state){const dir=state.activeMigrationRunDir||state.latestLiveRunDir||state.latestDryRunDir;const file=dir?path.join(dir,'row_progress.jsonl'):null;if(!file||!fs.existsSync(file)){return progressTail.recent;}if(progressTail.file!==file){progressTail={file,offset:0,remainder:'',recent:[]};}
 const size=fs.statSync(file).size;if(size<progressTail.offset){progressTail.offset=0;progressTail.remainder='';}
 if(size===progressTail.offset)return progressTail.recent;
 const maxRead=1024*1024;const start=Math.max(progressTail.offset, size-maxRead);if(start>progressTail.offset){progressTail.offset=start;progressTail.remainder='';}
 const len=size-progressTail.offset;const fd=fs.openSync(file,'r');const b=Buffer.alloc(len);fs.readSync(fd,b,0,len,progressTail.offset);fs.closeSync(fd);progressTail.offset=size;
 const all=progressTail.remainder+b.toString('utf8');const lines=all.split('\n');progressTail.remainder=lines.pop()||'';for(const line of lines){if(!line)continue;try{progressTail.recent.push(JSON.parse(line));}catch(_){}}if(progressTail.recent.length>120)progressTail.recent=progressTail.recent.slice(-120);return progressTail.recent;
}
function snapshot(){const state=readState();const status=currentRunStatus(state);const progress=refreshProgress(state);const cfg=readJson(googleConfigPath,{profiles:[]});const serviceAccountPath=path.resolve(ROOT,process.env.GOOGLE_SERVICE_ACCOUNT_JSON||'./local_secrets/google-service-account.json');return {ts:new Date().toISOString(),active,state,status,progress:progress.slice(-60),logs:recentLogs.slice(-120),googleConfigSummary:{configured:(cfg.profiles||[]).filter(p=>p.spreadsheetId&&!/^PASTE_/i.test(p.spreadsheetId)).length,total:(cfg.profiles||[]).length},serviceAccountPresent:fs.existsSync(serviceAccountPath),database:process.env.DB_NAME||null};}
function broadcast(){const payload=`data: ${JSON.stringify(snapshot())}\n\n`;for(const res of sseClients){try{res.write(payload);}catch(_){sseClients.delete(res);}}}
setInterval(broadcast,350).unref();

const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,`http://${host}:${port}`);
  if(req.method==='GET'&&url.pathname==='/api/state')return json(res,200,snapshot());
  if(req.method==='GET'&&url.pathname==='/api/google-config')return json(res,200,readJson(googleConfigPath,{profiles:[]}));
  if(req.method==='POST'&&url.pathname==='/api/google-config'){
    const body=await readBody(req);if(!body||!Array.isArray(body.profiles)||body.profiles.length!==9)return json(res,400,{ok:false,error:'Exactly nine profiles are required.'});
    const current=readJson(googleConfigPath,{});const byId=new Map(body.profiles.map(p=>[p.id,p]));for(const p of current.profiles||[]){const incoming=byId.get(p.id);if(!incoming)throw new Error(`Missing profile ${p.id}`);p.spreadsheetId=String(incoming.spreadsheetId||'').trim();p.sheetName=String(incoming.sheetName||p.sheetName).trim();p.headerRow=Math.max(1,Number(incoming.headerRow||p.headerRow||2));}
    writeJson(googleConfigPath,current);return json(res,200,{ok:true,config:current});
  }
  if(req.method==='POST'&&url.pathname.startsWith('/api/action/')){
    const name=url.pathname.split('/').pop();const body=await readBody(req).catch(()=>({}));
    if(name==='live'&&String(body.confirm||'')!=='LOCAL-LIVE-MIGRATION')return json(res,400,{ok:false,error:'Type LOCAL-LIVE-MIGRATION to confirm local live writes.'});
    if(name==='import-db'&&String(body.confirm||'')!=='IMPORT-LOCAL-SQL')return json(res,400,{ok:false,error:'Type IMPORT-LOCAL-SQL to confirm local SQL import.'});
    const a=startAction(name);return json(res,202,{ok:true,active:a});
  }
  if(req.method==='GET'&&url.pathname==='/events'){
    res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});res.write(`data: ${JSON.stringify(snapshot())}\n\n`);sseClients.add(res);req.on('close',()=>sseClients.delete(res));return;
  }
  if(req.method==='GET')return safeStatic(req,res);
  return text(res,405,'Method not allowed');
 }catch(e){return json(res,500,{ok:false,error:e.message,stack:process.env.NODE_ENV==='development'?e.stack:undefined});}
});
server.listen(port,host,()=>{console.log(`LOCAL_MIGRATION_DASHBOARD=http://${host}:${port}`);console.log(`DATABASE=${process.env.DB_NAME}`);});
