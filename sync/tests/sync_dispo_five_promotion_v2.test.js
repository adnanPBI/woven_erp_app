'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const os=require('os'),path=require('path'),crypto=require('crypto');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sync-promotion-test-'));
test.after(()=>{if(path.basename(tmp).startsWith('sync-promotion-test-'))fs.rmSync(tmp,{recursive:true,force:true});});
const packet={database:'weavonpq_weaving_main',status:'PENDING_AUTH0_OWNER_APPROVAL_AND_REHEARSAL',writeAuthorized:false,dispo:{count:5,sourceRows:Array.from({length:5},(_,i)=>({sourceUid:'uid-'+i,dispo:'nh/test/gd/26/'+(90000+i),identityGroup:'group-'+i,oldDigest:'old-'+i,newDigest:'new-'+i,sourceRowAtFrozenManifest:i+2}))}};
const requestFile=path.join(tmp,'request.json'),receiptFile=path.join(tmp,'receipt.json'),approverModule=path.join(tmp,'approver.mjs');
fs.writeFileSync(requestFile,JSON.stringify(packet));fs.writeFileSync(receiptFile,'{}');
fs.writeFileSync(approverModule,'export class SyncDispoFiveApproval { async verifyReceipt(){throw Error("Invalid or expired owner approval");} }');
const mod=require('../lib/sync_dispo_five_promotion').createPolicy({requestFile,receiptFile,approverModule,requestSha256:crypto.createHash('sha256').update(fs.readFileSync(requestFile)).digest('hex')});
const rows=packet.dispo.sourceRows;
function op(row){return {uid:row.sourceUid,dispo:row.dispo,previousDispo:row.dispo,
 group:row.identityGroup,action:'update',rowNumber:row.sourceRowAtFrozenManifest,
 previousDigest:row.oldDigest,digest:row.newDigest}}
function plan(ops){return {ok:true,conflicts:[],manualSkips:{skippedCurrentRows:5},operations:{dispo:ops}}}
function fixture(states,override={}){
 return {query:async(sql,params)=>{
  if(sql.startsWith('SELECT DATABASE()'))return [[{db:override.db||'weavonpq_weaving_main',host:override.host||'server905.web-hosting.com'}]];
  const row=rows.find(x=>x.sourceUid===params?.[1]||x.dispo===params?.[0]);
  if(!row)throw Error('Unexpected query: '+sql);
  const state=states[row.sourceUid]||{kind:'pending',digest:row.oldDigest,po:null};
  if(sql.includes('FROM sheets_sync_events'))return [[{digest:state.digest,group_key:state.group||row.identityGroup}]];
  if(sql.includes('FROM dispo_plan_form'))return [[{dispo_no:row.dispo,po_no:state.po===undefined?(state.kind==='full'?'PO-VALID':null):state.po}]];
  if(sql.includes('FROM dispo_form_data'))return [state.kind==='full'?[{dispo_number:row.dispo}]:[]];
  if(sql.includes('FROM migration_import_provenance'))return [[]];
  if(sql.includes('FROM `'))return [[]];
  throw Error('Unexpected query: '+sql);
 }};
}
const states=(mode='full')=>Object.fromEntries(rows.map(x=>[x.sourceUid,{kind:mode,digest:mode==='full'?x.newDigest:x.oldDigest}]));
test('original exact source classifies five pending, with exact grants',async()=>{
 const result=await mod.inspect(plan(rows.map(op)),packet,fixture(states('pending')));
 assert.equal(result.pending.size,5);assert.equal(result.ordinary.size,0);
 assert.deepEqual([...result.pending.values()].map(x=>x.dispo),rows.map(x=>x.dispo));
});
test('complete applied plan replay issues zero new grants even with old plan operations',async()=>{
 const result=await mod.inspect(plan(rows.map(op)),packet,fixture(states('full')));
 assert.equal(result.pending.size,0);
 assert.equal(result.ordinary.size,5);
});
test('one later ordinary edit is allowed without obsolete promotion grant',async()=>{
 const r=rows[0],x={...op(r),previousDigest:r.newDigest,digest:'a'.repeat(64),rowNumber:999};
 const result=await mod.inspect(plan([x]),packet,fixture(states('full')));
 assert.equal(result.pending.size,0);assert.equal(result.ordinary.size,1);
});
test('one later dependency refresh is allowed without obsolete promotion grant',async()=>{
 const r=rows[1],x={...op(r),action:'refresh',previousDigest:r.newDigest,digest:r.newDigest};
 const result=await mod.inspect(plan([x]),packet,fixture(states('full')));
 assert.equal(result.pending.size,0);assert.equal(result.ordinary.size,1);
});
test('partial committed promotion selects only exact still pending records',async()=>{
 const t=states('full');t[rows[1].sourceUid]={kind:'pending',digest:rows[1].oldDigest};
 t[rows[4].sourceUid]={kind:'pending',digest:rows[4].oldDigest};
 const result=await mod.inspect(plan(rows.map(op)),packet,fixture(t));
 assert.deepEqual([...result.pending.keys()],[rows[1].sourceUid,rows[4].sourceUid]);
 assert.equal(result.ordinary.size,3);
});
test('pending promotion with later edited source is rejected',async()=>{
 const x=op(rows[0]);x.digest='b'.repeat(64);
 await assert.rejects(()=>mod.inspect(plan([x]),packet,fixture(states('pending'))),/exact approved operation/);
});
test('stale ledger on full parent rejected',async()=>{
 const t=states('full');t[rows[0].sourceUid].digest=rows[0].oldDigest;
 await assert.rejects(()=>mod.inspect(plan([op(rows[0])]),packet,fixture(t)),/Partially committed promotion/);
});
test('updated ledger missing physical full target rejected',async()=>{
 const t=states('full');t[rows[0].sourceUid].kind='pending';
 await assert.rejects(()=>mod.inspect(plan([op(rows[0])]),packet,fixture(t)),/missing full master/);
});
test('future edit must have exact live ledger preimage',async()=>{
 const x={...op(rows[0]),previousDigest:'c'.repeat(64),digest:'d'.repeat(64)};
 await assert.rejects(()=>mod.inspect(plan([x]),packet,fixture(states('full'))),/ordinary preimage/);
});
test('duplicate full master or missing plan parent rejected',async()=>{
 const base=fixture(states('full'));
 const bad={query:async(sql,p)=>sql.includes('FROM dispo_form_data')?[[{dispo_number:rows[0].dispo},{dispo_number:rows[0].dispo}]]:base.query(sql,p)};
 await assert.rejects(()=>mod.inspect(plan([op(rows[0])]),packet,bad),/Duplicated/);
});
test('changed identity group rejected even on full target',async()=>{
 const t=states('full');t[rows[0].sourceUid].group='a'.repeat(64);
 await assert.rejects(()=>mod.inspect(plan([op(rows[0])]),packet,fixture(t)),/source identity/);
});
test('invalid/expired approval rejected for genuinely pending promotion',async()=>{
 // Verifier in real MCP rejects expiry; unlike already-full edits it MUST be called here.
 await assert.rejects(()=>mod.qualify(plan(rows.map(op)),fixture(states('pending'))),
  /invalid|expired|approval|receipt|owner|refus/i);
});
test('later edit uses verified physical state and never calls expired approval',async()=>{
 const x={...op(rows[0]),previousDigest:rows[0].newDigest,digest:'f'.repeat(64)};
 const grants=await mod.qualify(plan([x]),fixture(states('full')));
 assert.equal(grants.size,0);
});
test('empty true replay returns zero grants without needing receipt',async()=>{
 assert.equal((await mod.qualify(plan([]),fixture(states('full')))).size,0);
});
test('wrong target database and conflicts fail closed',async()=>{
 await assert.rejects(()=>mod.inspect(plan([op(rows[0])]),packet,fixture(states('full'),{db:'wrong'})),/Wrong physical/);
 const p=plan([op(rows[0])]);p.ok=false;
 await assert.rejects(()=>mod.inspect(p,packet,fixture(states('full'))),/Plan conflicts/);
});
test('unconfigured public adapter grants nothing and incomplete config fails closed',async()=>{
 const {createPolicy}=require('../lib/sync_dispo_five_promotion');
 assert.equal((await createPolicy().qualify(plan(rows.map(op)),fixture(states('pending')))).size,0);
 await assert.rejects(()=>createPolicy({requestFile}).qualify(plan(rows.map(op)),fixture(states('pending'))),/Incomplete private/);
});
test('exact pending transitions receive grants only after independent verifier acceptance',async()=>{
 const good=path.join(tmp,'accepted-approver.mjs');
 fs.writeFileSync(good,'export class SyncDispoFiveApproval { async verifyReceipt(){return {valid:true,approvedBusinessTransitions:5};} }');
 const approved=require('../lib/sync_dispo_five_promotion').createPolicy({requestFile,receiptFile,approverModule:good,requestSha256:crypto.createHash('sha256').update(fs.readFileSync(requestFile)).digest('hex')});
 assert.equal((await approved.qualify(plan(rows.map(op)),fixture(states('pending')))).size,5);
});
