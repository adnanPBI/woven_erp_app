'use strict';
const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const bindings=require('../lib/sync_exact_identity_bindings'),history=require('../lib/sync_exact_identity_row_history');
const op={action:'update',uid:'synthetic-u',previousDigest:'old',digest:'new',group:'g',previousDispo:'OLD',dispo:'NEW',appliedReviewKeys:['review']};
const record={profile:'folding',sourceUid:'synthetic-u',oldDigest:'old',newDigest:'new',newGroup:'g',oldDispo:'OLD',newDispo:'NEW',reviewKey:'review',targets:[{table:'folding_production_breakdown',selector:{id:18},requiredMapped:{folding_production_id:17}}]};
const capture={pk:['id','dispo_number'],where:{id:18},rows:[{id:18,dispo_number:'OLD',folding_production_id:17,quantity:5}]};
const ctx=()=>({sync:true,dryRun:false,syncOperation:{...op},currentSourceDataset:'folding',runId:'synthetic-run',currentSourceUid:'synthetic-u'});
test('audit binding is restricted to exact original numeric selector',()=>a.throws(()=>bindings.auditBinding(ctx(),'folding_production_breakdown',{...capture,where:{id:19}},{records:[record]}),/selector drift/));
test('unreviewed row cannot acquire exact audit grant',()=>a.throws(()=>bindings.auditBinding({...ctx(),syncOperation:{...op,appliedReviewKeys:[]}},'folding_production_breakdown',capture,{records:[record]}),/review drift/));
test('ordinary unchanged primary key uses existing audit path',()=>a.equal(bindings.auditBinding(ctx(),'folding_production_form',{...capture,pk:['id']},{records:[record]}),null));
test('composite-key audit preserves old image and records new key in same transaction',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'exact-audit-')),file=path.join(dir,'request.json'),bytes=JSON.stringify({version:1,records:[record]});fs.writeFileSync(file,bytes);
 const oldFile=process.env.SYNC_EXACT_IDENTITY_BINDINGS_FILE,oldHash=process.env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256;
 process.env.SYNC_EXACT_IDENTITY_BINDINGS_FILE=file;process.env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256=crypto.createHash('sha256').update(bytes).digest('hex');
 try{
  let insert;const c=ctx();c.conn={query:async(sql,args)=>{if(sql.startsWith('SELECT'))return [[{...capture.rows[0],dispo_number:'NEW'}]];insert={sql,args};return [{affectedRows:1}]}};
  await history.updated(c,'folding_production_breakdown',capture);
  a(insert.sql.startsWith('INSERT INTO erp_sync_row_changes'));a.deepEqual(JSON.parse(insert.args[9]),{id:18,dispo_number:'NEW'});a.equal(JSON.parse(insert.args[13]).dispo_number,'OLD');a.equal(JSON.parse(insert.args[14]).dispo_number,'NEW');a.equal(insert.args[11],1);
 }finally{if(oldFile===undefined)delete process.env.SYNC_EXACT_IDENTITY_BINDINGS_FILE;else process.env.SYNC_EXACT_IDENTITY_BINDINGS_FILE=oldFile;if(oldHash===undefined)delete process.env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256;else process.env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256=oldHash;fs.rmSync(dir,{recursive:true,force:true})}
});
test('delivery composite audit keeps the original ID and canonical profile name',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'exact-delivery-audit-')),file=path.join(dir,'request.json');
 const r={...record,profile:'greige-delivery',targets:[{table:'greige_delivery_breakdown',selector:{id:18},requiredMapped:{greige_delivery_id:17}}]};
 const bytes=JSON.stringify({version:1,records:[r]}),cap={...capture,rows:[{id:18,dispo_number:'OLD',greige_delivery_id:17,quantity:5}]};fs.writeFileSync(file,bytes);
 const oldFile=process.env.SYNC_EXACT_IDENTITY_BINDINGS_FILE,oldHash=process.env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256;
 process.env.SYNC_EXACT_IDENTITY_BINDINGS_FILE=file;process.env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256=crypto.createHash('sha256').update(bytes).digest('hex');
 try{let args;const c={...ctx(),currentSourceDataset:'delivery'};c.conn={query:async(sql,p)=>{if(sql.startsWith('SELECT'))return [[{...cap.rows[0],dispo_number:'NEW'}]];args=p;return [{}]}};await history.updated(c,'greige_delivery_breakdown',cap);a.equal(args[1],'greige-delivery');a.equal(JSON.parse(args[9]).id,18);a.equal(JSON.parse(args[13]).dispo_number,'OLD');a.equal(JSON.parse(args[14]).dispo_number,'NEW')}
 finally{if(oldFile===undefined)delete process.env.SYNC_EXACT_IDENTITY_BINDINGS_FILE;else process.env.SYNC_EXACT_IDENTITY_BINDINGS_FILE=oldFile;if(oldHash===undefined)delete process.env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256;else process.env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256=oldHash;fs.rmSync(dir,{recursive:true,force:true})}
});
