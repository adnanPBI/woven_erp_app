'use strict';
// Explicit local-only integration test: the real worker reaches a missing
// prepared-state failure before planning/importing. Requires idle preview DB.
const assert=require('assert'),fs=require('fs'),path=require('path');
const {spawnSync}=require('child_process');
const storage=require('../lib/sync_storage');
const root=path.resolve(__dirname,'..');
const env=require('dotenv').parse(fs.readFileSync(path.join(root,'local_data/sync_package/local.env.sync')));
assert.equal(env.DB_NAME,'weavonpq_weaving_sep22_preview');
const base=path.join(root,'local_data/erp_integration','storage-failure-'+Date.now());
fs.mkdirSync(base,{recursive:true});
const envFile=path.join(base,'private.env');
const data=path.join(base,'runtime');fs.mkdirSync(data);
env.SYNC_DATA_DIR=data.replace(/\\/g,'/');env.SYNC_ENABLED='false';
const lines=Object.entries(env).map(([k,v])=>k+'='+JSON.stringify(String(v))).join('\n');
fs.writeFileSync(envFile,lines);
const reports=[];
try{
 for(let i=0;i<4;i++){
  const cycle=path.join(data,'cycles',`2026-10-03T00-00-0${i}-000Z`);
  fs.mkdirSync(cycle,{recursive:true});fs.writeFileSync(path.join(cycle,'synthetic.txt'),'This is intentionally not a prepared source.');
  const run=spawnSync(process.execPath,[path.join(root,'scripts/sync/run.js'),'--local','--env='+envFile,'--prepared-cycle='+cycle,'--plan'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:60000});
  assert.equal(run.status,1,run.stderr+run.stdout);
  const status=storage.readJson(path.join(data,'status.json'));
  assert.equal(status.status,'failed');assert.equal(status.cycle,cycle);
  assert.match(status.error,/local_state\.json/);
  const retained=fs.readdirSync(path.join(data,'cycles')).length;
  assert(retained<=2);assert(fs.existsSync(cycle));
  assert(storage.readJson(path.join(data,'storage-report.json')).peakBytes>0);
  reports.push({attempt:i+1,exitCode:run.status,retained,expectedFailure:status.error});
 }
 storage.writeJson(path.join(base,'report.json'),{ok:true,readOnlyBusinessData:true,reports});
 console.log(JSON.stringify({ok:true,attempts:reports.length,report:path.join(base,'report.json')}));
}finally{fs.unlinkSync(envFile);}
