'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const m=require('../lib/sync-conflict-diagnostics');
const uid='a'.repeat(64),group='b'.repeat(64);
const folding={profile:'folding',reason:'folding_historical_source_identity_missing_requires_exact_retention_review',sourceUid:uid,group,previousDispo:'SYNTHETIC/OLD',previousBusinessDate:'2026-11-05',originalParentId:17};
test('four distinct empty-UID Dispo groups remain four causes',()=>{
 const conflicts=m.compactConflicts([1,2,3,4].map(n=>({profile:'dispo',reason:'ambiguous_edit_key_change_or_deletion',group:String(n).repeat(64)})));
 const runs=m.decorateRuns([{startedAt:'2026-11-10T09:40:09.410Z',status:'failed'}],{events:[{started:Date.parse('2026-11-10T09:40:09.410Z'),conflicts}]});
 assert.equal(runs[0].conflictCount,4);
});
test('captured Folding fields survive normalization',()=>{
 const c=m.compactConflicts([{...folding,originalChildIds:[18,-1,'19']}])[0];
 const a=m.annotateConflict(c,null,null);assert.equal(a.oldDispo,'SYNTHETIC/OLD');assert.equal(a.originalParentId,17);assert.equal(a.originalChildId,18);assert.deepEqual(a.originalChildIds,[18]);assert.equal(a.previousBusinessDate,'2026-11-05');
});
test('missing fields remain unavailable',()=>{const a=m.annotateConflict(m.compactConflicts([{profile:'dispo',reason:'unknown'}])[0]);assert.equal(a.originalParentId,null);assert.equal(a.oldDispo,null)});
test('unrelated cycle cannot annotate run',()=>{const a=m.decorateRuns([{startedAt:'2026-11-10T10:00:00Z'}],{events:[{started:Date.parse('2026-11-10T09:40:00Z'),conflicts:[folding]}]});assert.equal(a[0].conflictCount,0)});
test('six actual conflicts produce six display causes',()=>{const conflicts=m.compactConflicts([...[1,2,3,4].map(n=>({profile:'dispo',reason:'same',group:String(n).repeat(64)})),folding,{profile:'greige-delivery',reason:'same',group:'c'.repeat(64)}]);const runs=m.decorateRuns([{startedAt:'2026-11-10T09:40:00Z'}],{events:[{started:Date.parse('2026-11-10T09:40:00Z'),conflicts}]});assert.equal(runs[0].conflictCount,6)});
test('same-cycle exact diagnostic enriches archive without changing archived file',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sync-diagnostic-'));
 try{
  const dir=path.join(root,'conflict-causes');await fs.mkdir(dir);const id='1'.repeat(16)+'_'+'2'.repeat(16),cycle='2026-11-10T09-40-09-410Z';
  const archive={version:1,planSha256:'d'.repeat(64),sourceCycle:cycle,conflicts:[{profile:folding.profile,reason:folding.reason,group,sourceUid:uid}]};
  const bytes=JSON.stringify(archive);await fs.writeFile(path.join(dir,id+'.json'),bytes);
  await fs.writeFile(path.join(root,'conflict-review.json'),JSON.stringify({cycle,conflicts:[folding],diagnostics:[{reason:folding.reason,group,sourceUid:uid,oldDispo:'SYNTHETIC/OLD',oldDate:'2026-11-05',parentId:17,childIds:[18]}]}));
  const ev=await m.loadDiagnosticEvidence(root,{archiveRoot:root,dataDir:root,reviewFile:path.join(root,'none')});
  const [run]=m.decorateRuns([{startedAt:'2026-11-10T09:40:09.410Z'}],ev);assert.equal(run.conflictCauses[0].originalChildId,18);assert.equal(run.conflictCauses[0].originalParentId,17);assert.equal(await fs.readFile(path.join(dir,id+'.json'),'utf8'),bytes);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
test('mismatched diagnostic UID cannot inject child identity',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sync-diagnostic-'));
 try{await fs.writeFile(path.join(root,'conflict-review.json'),JSON.stringify({cycle:'2026-11-10T09-40-09-410Z',conflicts:[folding],diagnostics:[{...folding,sourceUid:'e'.repeat(64),parentId:999,childIds:[999]}]}));const ev=await m.loadDiagnosticEvidence(root,{archiveRoot:root,dataDir:root,reviewFile:path.join(root,'none')});assert.deepEqual(ev.events[0].conflicts[0].originalChildIds,[])}finally{await fs.rm(root,{recursive:true,force:true})}
});
