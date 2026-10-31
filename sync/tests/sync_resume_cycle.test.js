'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{resolveHostedResume}=require('../lib/sync_resume_cycle'),storage=require('../lib/sync_storage');
test('an older explicitly resumed cycle survives one-cycle retention beside a newer failed status',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'resume-retention-'));
 try{
  const cycles=[0,1,2].map(n=>path.join(root,'cycles',`2026-10-31T10-${n}0-00-000Z`));
  for(const cycle of cycles){fs.mkdirSync(cycle,{recursive:true});fs.writeFileSync(path.join(cycle,'local_state.json'),'{}');}
  storage.writeJson(path.join(root,'status.json'),{status:'failed',cycle:cycles[2]});
  const current=resolveHostedResume(root,cycles[0]);storage.cleanup(root,{...storage.settings(),cycles:1,maxBytes:1000000,reserveBytes:1,minFreeBytes:1},{current});
  assert.ok(fs.existsSync(path.join(current,'local_state.json')));assert.ok(fs.existsSync(cycles[2]));assert.ok(!fs.existsSync(cycles[1]));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('invalid resume selection fails before retention and rejects linked/outside or uncertified directories',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'resume-validation-'));
 try{
  const valid=path.join(root,'cycles','2026-10-31T10-00-00-000Z'),outside=path.join(root,'outside');for(const p of [valid,outside]){fs.mkdirSync(p,{recursive:true});fs.writeFileSync(path.join(p,'local_state.json'),'{}');}
  assert.equal(resolveHostedResume(root,undefined),null);for(const value of [true,'',outside,root,valid+'-missing'])assert.throws(()=>resolveHostedResume(root,value));
  const linked=path.join(root,'cycles','linked');fs.symlinkSync(outside,linked,process.platform==='win32'?'junction':'dir');assert.throws(()=>resolveHostedResume(root,linked));
  assert.ok(fs.existsSync(path.join(valid,'local_state.json')));assert.ok(!fs.existsSync(path.join(root,'cleanup-report.json')));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
