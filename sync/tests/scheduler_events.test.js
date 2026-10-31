'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os');
const {scheduled}=require('../scripts/sync/run'),{parseHistory}=require('../../lib/database-console');
test('supervisor records completion after worker exit; failed and skipped runs cannot become successes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'scheduler-events-'));
 try{for(const mode of ['success','failure','skip','startup-error']){
  const dir=path.join(root,mode);fs.mkdirSync(dir);fs.mkdirSync(path.join(dir,'data'));const env=path.join(dir,'.env.sync'),worker=path.join(dir,'worker.js');
  fs.writeFileSync(env,'SYNC_DATA_DIR='+dir.replace(/\\/g,'/')+'/data\nSYNC_MIN_FREE_MB=1\n');
  if(mode!=='startup-error')fs.writeFileSync(worker,mode==='skip'?'process.exitCode=0;':`process.send({type:'storage-ready'});process.on('message',m=>{if(m.type==='storage-start')process.send({type:'storage-finished'});if(m.type==='storage-finished-ack'){process.exitCode=${mode==='failure'?7:0};process.disconnect();}});`);
  const code=await scheduled(['--env='+env,'--scheduler-events'],{workerFile:worker});
  assert.equal(code,mode==='failure'?7:mode==='startup-error'?1:0);
  const text=fs.readFileSync(path.join(dir,'scheduler.log'),'utf8'),runs=parseHistory(text);
  assert.equal(runs.length,1);assert.ok(runs[0].endedAt);
  assert.equal(runs[0].status,mode==='success'?'success':mode==='skip'?'skipped':'failed');
  assert.equal((text.match(/^SYNC_START /gm)||[]).length,1);
  assert.equal((text.match(/^SYNC_(SUCCESS|FAILURE|SKIPPED) /gm)||[]).length,1);
 }}finally{fs.rmSync(root,{recursive:true,force:true});}
});
