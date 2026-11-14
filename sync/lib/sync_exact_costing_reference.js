'use strict';
// Exact owner-qualified synthetic-to-real costing references. Never rekeys or
// deletes the historical master, and never grants ordinary missing-parent inserts.
const fs=require('fs'),crypto=require('crypto'),assert=require('assert/strict');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
function load(env=process.env){
 const file=env.SYNC_EXACT_COSTING_REFERENCES_FILE,pin=env.SYNC_EXACT_COSTING_REFERENCES_SHA256;
 if(!file&&!pin)return null;
 if(!file||!/^[a-f0-9]{64}$/.test(pin||''))throw Error('Exact costing reference configuration incomplete');
 const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>512*1024)throw Error('Exact costing reference file rejected');
 const bytes=fs.readFileSync(file);if(sha(bytes)!==pin)throw Error('Exact costing reference hash changed');
 const cfg=JSON.parse(bytes);if(cfg.version!==1||!Array.isArray(cfg.records)||cfg.records.length>20)throw Error('Exact costing reference schema rejected');return cfg;
}
async function allowMissing(ctx,profile,table,data,config=load()){
 if(!ctx.sync||profile.id!=='pre-costing-bootstrap'||table!=='pre_costing_data'||ctx.syncOperation?.action!=='update'||ctx.syncOperation.alreadyApplied)return false;
 const op=ctx.syncOperation,records=(config?.records||[]).filter(r=>r.sourceUid===op.uid);
 if(records.length>1)throw Error('Duplicate exact costing reference');const r=records[0];if(!r)return false;
 if(op.previousDigest!==r.oldDigest)return false;
 if(op.digest!==r.newDigest||op.group!==r.group||op.dispo!==r.dispo||data.pre_costing_no!==r.newCostingNo||!/^MIGPC-[a-f0-9]{32}$/.test(r.oldCostingNo)||r.newCostingNo.startsWith('MIGPC-'))throw Error('Exact costing reference source drift');
 assert.equal(r.originalPo.po_no,r.poNo);assert.equal(r.originalPo.pre_costing_no,r.oldCostingNo);assert.equal(r.originalMaster.pre_costing_no,r.oldCostingNo);
 const db=ctx.conn||ctx.pool,lock=ctx.dryRun?'':' FOR UPDATE';
 const [ledger]=await db.query('SELECT group_key,digest FROM sheets_sync_events WHERE profile=? AND source_uid=?'+lock,[profile.id,op.uid]);
 assert.deepEqual(ledger,[{group_key:r.group,digest:r.oldDigest}],'Exact costing reference ledger drift');
 const [po]=await db.query('SELECT * FROM PO_form_data WHERE po_no=?'+lock,[r.poNo]);assert.deepEqual(po,[r.originalPo],'Exact costing reference PO preimage drift');
 const [old]=await db.query('SELECT * FROM pre_costing_data WHERE pre_costing_no=?'+lock,[r.oldCostingNo]);assert.deepEqual(old,[r.originalMaster],'Exact costing reference historical master drift');
 const [refs]=await db.query('SELECT po_no,pre_costing_no,dispo_number FROM PO_form_data WHERE pre_costing_no=? ORDER BY po_no'+lock,[r.oldCostingNo]);assert.deepEqual(refs,r.originalReferences,'Exact costing reference peer scope drift');
 const [destination]=await db.query('SELECT pre_costing_no FROM pre_costing_data WHERE pre_costing_no=?'+lock,[r.newCostingNo]);assert.equal(destination.length,0,'Exact costing reference destination occupied');
 ctx.sync.qualifiedCostingReferenceCreates||=[];ctx.sync.qualifiedCostingReferenceCreates.push({sourceUid:op.uid,poNo:r.poNo,oldCostingNo:r.oldCostingNo,newCostingNo:r.newCostingNo,historicalMasterPreserved:true});
 return true;
}
module.exports={load,allowMissing};
