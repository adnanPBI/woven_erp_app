'use strict';
const assert=require('assert/strict'),{test}=require('node:test'),fs=require('fs'),os=require('os'),path=require('path');
const {inventory,planEdits,applyReviewedReassignments}=require('../lib/sheets_sync_plan');
const policy=require('../lib/sync_prefix_edits');
const {SheetsSyncRuntime}=require('../lib/sheets_sync_runtime.repair');
const {reconcileChildren}=require('../lib/sync_write_safety');
const {BusinessEvidence}=require('../lib/sync_business_evidence');
const profile={id:'yarn-receive',source_file:'receipt.csv'},headers=['Yarn Count','Yarn brand','Yarn Lot','Received Date','Received GD NO','Challan No','Receipt Qty (Kgs)','Special Notes','Last Modified Date','Search Column'];
const source=(prefix='SW',amount='-439')=>['10','Brand','1','2026-10-31',prefix+'/NDSD/GD/26/00123','Challan',amount,'Return','',''];
async function fixture(t,oldRows=[source()],newRows=[source('YT')],signature=true){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prefix-edit-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const read=async rows=>{fs.writeFileSync(path.join(dir,profile.source_file),[headers,...rows].map(r=>r.join(',')).join('\n'));return (await inventory(dir,[profile],{prefixEdits:true}))[profile.id];};
 const previous=await read(oldRows);previous.records.forEach((r,i)=>{r.uid='event-'+i;if(signature)r.yarnIdentity={...r.yarnIdentity,prefixMatchHash:r.prefixMatchHash};});
 const current=await read(newRows),qualified=await policy.qualifyPrefixEdits(profile.id,previous,current,{csvDir:dir,profileSpec:profile});
 return {previous,current,qualified,plan:planEdits({[profile.id]:qualified},{[profile.id]:current})};
}
test('latest prefix retains original UIDs for reordered unequal amounts and supports a later prefix edit',async t=>{
 const f=await fixture(t,[source('SW','-439'),source('SW','-4349')],[source('YT','-4349'),source('YT','-439')]);
 assert.equal(f.plan.ok,true);assert.equal(f.plan.added,0);assert.equal(f.plan.updated,2);
 assert.deepEqual(f.plan.operations[profile.id].map(r=>[r.uid,r.entryAmounts]),[['event-0','[-439,null]'],['event-1','[-4349,null]']]);
 for(const op of f.plan.operations[profile.id])policy.validatePrefixOperation(profile.id,op,{SYNC_ACCEPT_DISPO_PREFIX_EDITS:'true'});
 const second=await fixture(t,[source('YT')],[source('NH')]);assert.equal(second.plan.updated,1);assert.equal(second.plan.operations[profile.id][0].dispo,'nh/ndsd/gd/26/00123');
});
test('legacy edit requires entire inverse digest, with audit changes refused until metadata is seeded',async t=>{
 assert.equal((await fixture(t,undefined,undefined,false)).plan.updated,1);
 const changed=source('YT');changed[8]='later';assert.equal((await fixture(t,[source()],[changed],false)).plan.ok,false);
 assert.equal((await fixture(t,[source()],[changed],true)).plan.updated,1);
});
test('changed body, leading zero, date, quantity or notes cannot qualify as prefix-only',async t=>{
 for(const [index,value]of [[4,'YT/NDSD/GD/26/123'],[3,'2026-10-30'],[6,'-440'],[7,'Different']]){
  const next=source('YT');next[index]=value;const f=await fixture(t,[source()],[next]);assert.equal(f.plan.ok,false);assert.equal(f.qualified.records[0].prefixChange,undefined);
 }
 assert.equal(policy.prefixOnly('SW/NDSD/GD/26/00123','ZZ/NDSD/GD/26/00123'),false);
});
test('coexisting old/new source, duplicate destinations and occupied target groups never merge',async t=>{
 for(const [oldRows,newRows]of [[[source()],[source(),source('YT')]],[[source()],[source('YT'),source('YT')]],[[source(),source('YT')],[source('YT')]]]){
  const f=await fixture(t,oldRows,newRows);assert.equal(f.qualified.records.some(r=>r.prefixChange),false);
 }
});
test('signature backfill touches only digest/group-bound metadata and runtime persists it on the original UID',async t=>{
 const f=await fixture(t,[source()],[source()]),writes=[],db={beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{},query:async(sql,args)=>{writes.push({sql,args});return[{affectedRows:1}];}};
 delete f.previous.records[0].yarnIdentity.prefixMatchHash;
 await policy.backfillSignatures(db,profile.id,f.previous,f.current);assert.equal(writes.length,1);assert.match(writes[0].sql,/AND group_key=\? AND digest=\?/);
 const runtime=new SheetsSyncRuntime({ok:true,operations:{}},{},'manifest');runtime.business={finish:()=>{}};
 await runtime.finish({conn:db,syncOperation:{...f.current.records[0],uid:'original-event'}},profile);
 assert.equal(JSON.parse(writes.at(-1).args[0]).prefixMatchHash,f.current.records[0].prefixMatchHash);assert.equal(writes.at(-1).args[2],'original-event');
 const oldReview={profile:profile.id,sourceUid:'original-event',oldGroup:'old-reviewed-key',newGroup:'consumed-reviewed-key',oldDigest:'old',newDigest:'reviewed'};
 await runtime.finish({conn:db,syncOperation:{...f.current.records[0],uid:'original-event',previousIdentity:{version:1,prefixGroups:['consumed-reviewed-key']}}},profile);
 const saved=JSON.parse(writes.at(-1).args[0]);assert.deepEqual(saved.prefixGroups,['consumed-reviewed-key']);
 const previous={records:[{...f.current.records[0],uid:'original-event',yarnIdentity:saved}]};assert.equal(applyReviewedReassignments(profile.id,previous,f.current,[oldReview]),previous);
 const g=await fixture(t);assert.throws(()=>policy.validatePrefixOperation(profile.id,g.plan.operations[profile.id][0],{}),/disabled/);
});
function children(op,{dryRun=false,duplicate=false,destination=false}={}){
 let rows=[{id:7,parent_id:3,dispo_number:op.prefixChange.oldDispo,quantity:'-439.00'}];
 const queries=[],db={query:async(sql,args)=>{queries.push(sql);if(sql.startsWith('SHOW'))return[[{Field:'id',Key:'PRI'},{Field:'dispo_number',Key:'PRI'}]];
  if(!sql.startsWith('SELECT'))throw Error('Unexpected SQL');
  const fields=[...sql.matchAll(/`([a-z_]+)` <=> \?/g)].map(m=>m[1]);
  let matches=rows.filter(r=>fields.every((k,i)=>String(r[k]).toLowerCase()===String(args[i]).toLowerCase()));
  if(duplicate&&fields.length===1&&fields[0]==='id')matches=[...matches,{...rows[0],parent_id:99}];
  if(destination&&fields.includes('dispo_number')&&args.includes(op.prefixChange.newDispo))matches=[{...rows[0],id:8}];
  return [matches.map(r=>({...r}))];}};
 const ctx={sync:{},syncOperation:op,conn:db,pool:db,dryRun,schema:{child:{id:'int',parent_id:'int',dispo_number:'varchar(80)',quantity:'decimal(10,2)'}}};
 const p={id:profile.id,tables:[{name:'child',natural_key:['dispo_number','parent_id'],parent:{parent_id_field:'parent_id'}}]},desired={parent_id:3,dispo_number:op.dispo,quantity:-439},calls=[];
 const callbacks={preview:()=>{throw Error('Wrong natural-key preview');},insert:()=>{throw Error('Must never insert');},previewPrefix:async(data,where)=>{calls.push(where);return{action:'previewed',id:where.id};},update:async(data,where)=>{calls.push(where);rows[0]={...rows[0],...data};}};
 return {ctx,p,desired,callbacks,calls,queries,rows:()=>rows};
}
test('composite-key child changes prefix in place with stable-ID evidence and postverify',async t=>{
 const prior=process.env.SYNC_ACCEPT_DISPO_PREFIX_EDITS;process.env.SYNC_ACCEPT_DISPO_PREFIX_EDITS='true';t.after(()=>{if(prior===undefined)delete process.env.SYNC_ACCEPT_DISPO_PREFIX_EDITS;else process.env.SYNC_ACCEPT_DISPO_PREFIX_EDITS=prior;});
 const op=(await fixture(t)).plan.operations[profile.id][0];
 for(const dryRun of [true,false]){const f=children(op,{dryRun});const result=await reconcileChildren(f.ctx,f.p,'child',{parent_id:3},[f.desired],f.callbacks);assert.deepEqual(f.calls,[{id:7}]);assert.equal(result[0].id,7);assert.equal(f.rows().length,1);if(!dryRun)assert.equal(f.rows()[0].dispo_number,op.dispo);}
 for(const flag of ['duplicate','destination']){const f=children(op,{[flag]:true});await assert.rejects(reconcileChildren(f.ctx,f.p,'child',{parent_id:3},[f.desired],f.callbacks),/not unique|occupied/);assert.equal(f.calls.length,0);}
});
test('business evidence checks original child before update and accepts the committed replay',async t=>{
 const op=(await fixture(t)).plan.operations[profile.id][0],f=children(op,{dryRun:true});
 const evidence=new BusinessEvidence('plan','manifest');evidence.begin(profile.id,op.uid);
 await evidence.capture(f.ctx,'child',{...f.desired,id:7},['id']);evidence.finish();
 const live=new BusinessEvidence('plan','manifest','apply',evidence.export());live.begin(profile.id,op.uid);f.ctx.dryRun=false;
 await live.beforeMutation(f.ctx,'update','child',f.desired,{id:7});await f.callbacks.update(f.desired,{id:7});live.finish();await live.verifyReplay(f.ctx);
 const drift=children(op,{dryRun:true}),captured=new BusinessEvidence('p','m');captured.begin(profile.id,op.uid);await captured.capture(drift.ctx,'child',{...drift.desired,id:7},['id']);const apply=new BusinessEvidence('p','m','apply',captured.export());apply.begin(profile.id,op.uid);drift.rows()[0].quantity='-440.00';await assert.rejects(apply.beforeMutation(drift.ctx,'update','child',drift.desired,{id:7}),/changed after qualification/);
});
test('composite-key audit records the new key and full old/new row under the unchanged numeric ID',async t=>{
 const prior=process.env.SYNC_ACCEPT_DISPO_PREFIX_EDITS;process.env.SYNC_ACCEPT_DISPO_PREFIX_EDITS='true';t.after(()=>{if(prior===undefined)delete process.env.SYNC_ACCEPT_DISPO_PREFIX_EDITS;else process.env.SYNC_ACCEPT_DISPO_PREFIX_EDITS=prior;});
 const op=(await fixture(t)).plan.operations[profile.id][0],f=children(op),before={...f.rows()[0]},writes=[];
 f.ctx.currentSourceDataset=profile.id;f.ctx.currentSourceUid=op.uid;f.ctx.runId='fixture';const query=f.ctx.conn.query;
 f.ctx.conn.query=async(sql,args)=>{if(sql.startsWith('INSERT INTO erp_sync_row_changes')){writes.push(args);return[{affectedRows:1}];}return query(sql,args);};
 await f.callbacks.update(f.desired,{id:7});
 await require('../lib/sync_row_history').updated(f.ctx,'child',{where:{id:7},pk:['id','dispo_number'],rows:[before]});
 assert.equal(writes.length,1);assert.deepEqual(JSON.parse(writes[0][9]),{id:7,dispo_number:op.dispo});assert.equal(JSON.parse(writes[0][13]).dispo_number,op.previousDispo);assert.equal(JSON.parse(writes[0][14]).dispo_number,op.dispo);assert.equal(JSON.parse(writes[0][14]).quantity,-439);
});
