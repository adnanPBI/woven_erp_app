const test=require('node:test'),assert=require('node:assert/strict'),m=require('../lib/sync_exact_costing_reference');
function fixture(){
 const r={sourceUid:'uid',oldDigest:'old',newDigest:'new',group:'group',dispo:'nh/test',oldCostingNo:'MIGPC-'+'1'.repeat(32),newCostingNo:'TEST/COST/2026/0001',poNo:'PO1'};
 r.originalPo={po_no:r.poNo,pre_costing_no:r.oldCostingNo,po_quantity:3241};r.originalMaster={pre_costing_no:r.oldCostingNo,buyer:'SYNTHETIC BUYER'};r.originalReferences=[{po_no:'PO1',pre_costing_no:r.oldCostingNo,dispo_number:'NH/TEST'}];
 const results=[[{group_key:r.group,digest:r.oldDigest}],[r.originalPo],[r.originalMaster],r.originalReferences,[]],queries=[];
 const ctx={sync:{},dryRun:false,syncOperation:{uid:r.sourceUid,action:'update',previousDigest:r.oldDigest,digest:r.newDigest,group:r.group,dispo:r.dispo},conn:{query:async(sql,args)=>{queries.push({sql,args});return [results.shift()]}}};
 return {r,results,queries,ctx,profile:{id:'pre-costing-bootstrap'},data:{pre_costing_no:r.newCostingNo},cfg:{version:1,records:[r]}};
}
const run=f=>m.allowMissing(f.ctx,f.profile,'pre_costing_data',f.data,f.cfg);
test('exact transition verifies all five preimages and performs SELECT only',async()=>{const f=fixture();assert.equal(await run(f),true);assert.equal(f.queries.length,5);assert(f.queries.every(x=>x.sql.startsWith('SELECT ')&&x.sql.endsWith('FOR UPDATE')))});
test('ordinary absent target receives no exception',async()=>{const f=fixture();f.cfg.records=[];assert.equal(await run(f),false);assert.equal(f.queries.length,0)});
test('other profile and table receive no exception',async()=>{const f=fixture();f.profile.id='po';assert.equal(await run(f),false);assert.equal(await m.allowMissing(f.ctx,{id:'pre-costing-bootstrap'},'PO_form_data',f.data,f.cfg),false)});
test('changed source digest is refused',async()=>{const f=fixture();f.ctx.syncOperation.digest='different';await assert.rejects(run(f),/source drift/)});
test('old consumed digest cannot grant a later edit',async()=>{const f=fixture();f.ctx.syncOperation.previousDigest='new';assert.equal(await run(f),false)});
test('occupied destination is refused',async()=>{const f=fixture();f.results[4]=[{pre_costing_no:f.r.newCostingNo}];await assert.rejects(run(f),/destination occupied/)});
test('historical master drift is refused',async()=>{const f=fixture();f.results[2]=[{...f.r.originalMaster,buyer:'CHANGED'}];await assert.rejects(run(f),/historical master drift/)});
test('additional historical peer is refused',async()=>{const f=fixture();f.results[3]=[...f.r.originalReferences,{po_no:'PO2'}];await assert.rejects(run(f),/peer scope drift/)});
test('real costing master cannot be silently replaced',async()=>{const f=fixture();f.r.oldCostingNo='REAL-OLD';await assert.rejects(run(f),/source drift/)});
test('duplicate authorization is refused',async()=>{const f=fixture();f.cfg.records.push({...f.r});await assert.rejects(run(f),/Duplicate/)});
test('dry qualification does not request write locks',async()=>{const f=fixture();f.ctx.dryRun=true;assert.equal(await run(f),true);assert(f.queries.every(x=>!x.sql.includes('FOR UPDATE')))});
