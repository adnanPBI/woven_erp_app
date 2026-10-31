'use strict';
// Exercise the real wrapper with an isolated fake worker/quota provider. Never
// call cPanel, read a private env, connect to MySQL or change an installed cron.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),{spawnSync}=require('child_process');
const source=fs.readFileSync(path.resolve(__dirname,'../run-hosted-sync.sh'),'utf8').replace(/\r\n/g,'\n');
const shellQuote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hosted-wrapper-'));
 fs.mkdirSync(path.join(root,'scripts/sync'),{recursive:true});
 fs.writeFileSync(path.join(root,'scripts/sync/run.js'),"const fs=require('fs'),path=require('path');if(!process.argv.includes('--scheduler-events'))throw Error('Supervisor event ownership required');fs.writeFileSync(process.env.TEST_WORKER_MARKER,'started');const code=Number(process.env.FIXTURE_WORKER_CODE||0),log=path.join(__dirname,'../../scheduler.log');fs.appendFileSync(log,'SYNC_START '+new Date().toISOString()+'\\n');fs.appendFileSync(log,'SYNC_'+(code?'FAILURE':'SUCCESS')+' '+new Date().toISOString()+(code?' exit_code='+code:'')+'\\n');process.exit(code);\n");
 const quota=path.join(root,'fixture-uapi');fs.writeFileSync(quota,'#!/bin/bash\nprintf \'%s\' "$FIXTURE_QUOTA"\n',{mode:0o755});
 const marker=path.join(root,'fixture-marker');fs.writeFileSync(marker,'pinned');
 fs.writeFileSync(path.join(root,'protection.sha256'),crypto.createHash('sha256').update('pinned').digest('hex')+'  fixture-marker\n');
 const wrapper=path.join(root,'wrapper.sh');fs.writeFileSync(wrapper,source.replace(/^ROOT=.*$/m,'ROOT='+shellQuote(root)).replace(/^export PATH=.*$/m,'export PATH='+shellQuote(path.dirname(process.execPath)+':/usr/bin:/bin')).replace('/usr/bin/uapi',shellQuote(quota)));
 return {root,marker,run:(args=[],extra={})=>spawnSync('/bin/bash',[wrapper,...args],{cwd:root,encoding:'utf8',timeout:15000,env:{...process.env,TEST_WORKER_MARKER:path.join(root,'worker-started'),FIXTURE_QUOTA:JSON.stringify({result:{status:1,data:{under_quota_overall:'1',megabytes_remain:4096}}}),...extra}}),started:()=>fs.existsSync(path.join(root,'worker-started')),log:()=>fs.existsSync(path.join(root,'scheduler.log'))?fs.readFileSync(path.join(root,'scheduler.log'),'utf8'):'',close:()=>fs.rmSync(root,{recursive:true,force:true})};
}
const options={skip:process.platform==='win32'};
test('hosted wrapper preflight verifies pins/quota without starting a worker',options,()=>{const f=fixture();try{const r=f.run(['--check']);assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/Scheduler preflight passed/);assert.equal(f.started(),false);assert.equal(f.log(),'');}finally{f.close();}});
test('hosted wrapper records actual success and preserves a failed worker exit code',options,()=>{for(const code of [0,7]){const f=fixture();try{const r=f.run([],{FIXTURE_WORKER_CODE:String(code)});assert.equal(r.status,code,r.stderr);assert.equal(f.started(),true);assert.match(f.log(),/SYNC_START /);if(code){assert.match(f.log(),/SYNC_FAILURE .*exit_code=7/);assert.doesNotMatch(f.log(),/SYNC_SUCCESS/);}else{assert.match(f.log(),/SYNC_SUCCESS /);assert.doesNotMatch(f.log(),/SYNC_FAILURE/);}}finally{f.close();}}});
test('hosted wrapper stops before the writer on insufficient account quota or pin drift',options,()=>{for(const kind of ['quota','pin']){const f=fixture();try{if(kind==='pin')fs.writeFileSync(f.marker,'unreviewed');const extra=kind==='quota'?{FIXTURE_QUOTA:JSON.stringify({result:{status:1,data:{under_quota_overall:'1',megabytes_remain:3072}}})}:{};const r=f.run([],extra);assert.notEqual(r.status,0);assert.equal(f.started(),false);assert.equal(f.log(),'','Early preflight errors need cron stderr visibility');}finally{f.close();}}});
