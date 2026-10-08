'use strict';
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const storage = require('../lib/sync_storage');
const {supervise} = require('../scripts/sync/run');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-storage-test-'));
const config = {...storage.settings(), cycles: 2, backups: 2, maxBytes: 1000000, reserveBytes: 100, minFreeBytes: 1};
const name = n => `2026-10-03T00-00-${String(n).padStart(2,'0')}-000Z`;
function put(file, content='data') {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content);}
function fixture(label) {const p=path.join(root,label);fs.mkdirSync(p);return p;}
(async()=>{
  const data = fixture('failure-retention');
  for(let i=0;i<12;i++)put(path.join(data,'cycles',name(i),'snapshot.csv'),Buffer.alloc(1024));
  for(let i=0;i<5;i++)put(path.join(data,'backups','before_sync_'+name(i)+'.sql.gz'));
  const pendingCycle=path.join(data,'cycles',name(0));
  const pendingBackup=path.join(data,'backups','before_sync_'+name(0)+'.sql.gz');
  storage.writeJson(path.join(data,'pending.json'),{cycle:pendingCycle,backupFile:pendingBackup});
  storage.writeJson(path.join(data,'status.json'),{status:'failed',cycle:path.join(data,'cycles',name(10))});
  put(path.join(data,'verification','retained.json'));
  put(path.join(data,'backups','before_sync_'+name(20)+'.sql.gz.partial'));
  const r=storage.cleanup(data,config,{current:path.join(data,'cycles',name(11))});
  assert.equal(fs.readdirSync(path.join(data,'cycles')).length,3);
  assert(fs.existsSync(pendingCycle));assert(fs.existsSync(pendingBackup));
  assert(fs.existsSync(path.join(data,'verification','retained.json')));
  assert.equal(fs.readdirSync(path.join(data,'backups')).length,3);
  assert(r.reclaimedBytes>0);
  for(let i=12;i<30;i++){
    const current=path.join(data,'cycles',name(i));put(path.join(current,'snapshot.csv'),Buffer.alloc(1024));
    storage.writeJson(path.join(data,'status.json'),{status:'failed',cycle:current});
    storage.cleanup(data,config,{current});
    assert(fs.readdirSync(path.join(data,'cycles')).length<=3,'repeated failures are bounded');
  }
  const small={...config,maxBytes:storage.size(data)+100};
  assert.throws(()=>storage.assertCapacity(data,small,101),/budget/);
  assert.throws(()=>storage.assertCapacity(data,{...config,minFreeBytes:Number.MAX_SAFE_INTEGER}),/free disk/);
  assert.throws(()=>storage.settings({SYNC_KEEP_CYCLES:'0'}),/Invalid/);
  assert.throws(()=>storage.settings({SYNC_MAX_DATA_MB:'100',SYNC_RUN_RESERVE_MB:'100'}),/reserve/);
  const log=path.join(data,'logs','sync.log');
  storage.appendLog(log,Buffer.alloc(20000,65),{...config,logBytes:1000,logFiles:2});
  assert.equal(fs.readdirSync(path.dirname(log)).length,3);
  assert.equal(storage.size(path.dirname(log)),3000);
  const outside=fixture('outside'), linked=fixture('links');put(path.join(outside,'keep.txt'));
  fs.mkdirSync(path.join(linked,'cycles'));
  fs.symlinkSync(outside,path.join(linked,'cycles',name(0)),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>storage.cleanup(linked,config),/linked/);
  assert(fs.existsSync(path.join(outside,'keep.txt')));
  fs.unlinkSync(path.join(linked,'cycles',name(0)));
  // Supervisor must interrupt a runaway writer and preserve recovery evidence.
  const monitor=fixture('monitor'),env=path.join(root,'test.env'),worker=path.join(root,'fixture.js');
  fs.writeFileSync(env,`SYNC_DATA_DIR=${monitor.replace(/\\/g,'/')}\nSYNC_MAX_DATA_MB=4\nSYNC_RUN_RESERVE_MB=1\nSYNC_MIN_FREE_MB=1\n`);
  const pending=path.join(monitor,'pending.json');put(pending,'{"cycle":"test-recovery"}');
  const childPidFile=path.join(monitor,'child-pid');
  fs.writeFileSync(worker,`const fs=require('fs');process.send({type:'storage-ready'});process.on('message',m=>{if(m.type==='storage-start'){const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});process.send({type:'sync-child-start',pid:child.pid});fs.writeFileSync(${JSON.stringify(childPidFile)},String(child.pid));setTimeout(()=>fs.writeFileSync(${JSON.stringify(path.join(monitor,'huge'))},Buffer.alloc(6*1024*1024)),50);}});`);
  assert.equal(await supervise(['--env='+env],{workerFile:worker,intervalMs:20}),1);
  assert(fs.existsSync(pending));assert.equal(storage.readJson(path.join(monitor,'status.json')).status,'failed');
  assert.match(storage.readJson(path.join(monitor,'storage-report.json')).stoppedReason,/budget/);
  const descendantPid=Number(fs.readFileSync(childPidFile,'utf8'));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.throws(()=>process.kill(descendantPid,0),undefined,'runaway descendants must not keep writing');
  const quiet=fixture('no-overlap');
  fs.writeFileSync(env,`SYNC_DATA_DIR=${quiet.replace(/\\/g,'/')}\nSYNC_MIN_FREE_MB=1\n`);
  put(path.join(quiet,'status.json'),'{"status":"applying","owner":"other-worker"}');
  fs.writeFileSync(worker,"console.log('Another sync is active; this interval was skipped.');");
  assert.equal(await supervise(['--env='+env],{workerFile:worker}),0);
  assert.equal(storage.readJson(path.join(quiet,'status.json')).owner,'other-worker');
  assert(!fs.existsSync(path.join(quiet,'storage-report.json')));
  // Both successful and failed worker finalization must acknowledge supervision
  // before releasing the lock, with a bounded sampled-usage report.
  for(const exitCode of [0,1]){
    const complete=fixture('finish-'+exitCode);
    fs.writeFileSync(env,`SYNC_DATA_DIR=${complete.replace(/\\/g,'/')}\nSYNC_MIN_FREE_MB=1\n`);
    fs.writeFileSync(worker,`process.send({type:'storage-ready'});process.on('message',m=>{if(m.type==='storage-start')process.send({type:'storage-finished'});if(m.type==='storage-finished-ack'){process.exitCode=${exitCode};process.disconnect();}});`);
    assert.equal(await supervise(['--env='+env],{workerFile:worker}),exitCode);
    assert(storage.readJson(path.join(complete,'storage-report.json')).peakBytes>=0);
  }
  console.log('PASS: bounded failures, protected recovery/backups, quota/free-space rejection, log rotation, junction refusal, runaway worker termination');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{
  // Only the literal test root created above; links were removed explicitly.
  if(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep))fs.rmSync(root,{recursive:true});
});
