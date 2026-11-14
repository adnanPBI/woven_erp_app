'use strict';
// Extend the ordinary audit only for a source/SQL-qualified exact stable-ID rekey.
const base=require('./sync_row_history');
const bindings=require('./sync_exact_identity_bindings');
const normal=x=>String(x??'').trim().toLowerCase();
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?String(v):v);
async function updated(ctx,table,capture){
 const proof=bindings.auditBinding(ctx,table,capture);
 if(!proof)return base.updated(ctx,table,capture);
 if(!ctx.sync||ctx.dryRun||!ctx.conn||!/^[A-Za-z0-9_]+$/.test(table))throw Error('Exact identity audit requires business transaction');
 const [rows]=await ctx.conn.query('SELECT * FROM `'+table+'` WHERE id=? LIMIT 2 FOR UPDATE',[capture.where.id]);
 const before=capture.rows[0],after=rows[0],field=capture.pk.includes('dispo_number')?'dispo_number':'dispo_no';
 if(rows.length!==1||String(after.id)!==String(before.id)||normal(before[field])!==normal(proof.oldDispo)||normal(after[field])!==normal(proof.newDispo))throw Error('Exact identity audit before/after binding drift');
 for(const k of capture.pk)if(k!==field&&json(before[k])!==json(after[k]))throw Error('Exact identity audit immutable primary key changed');
 for(const [k,v]of Object.entries(proof.target.requiredMapped||{}))if(normal(after[k])!==normal(v)||normal(before[k])!==normal(v))throw Error('Exact identity audit relationship changed');
 const changed=Object.keys({...before,...after}).filter(k=>json(before[k])!==json(after[k]));
 if(!changed.length)return;
 const previous=json(before),next=json(after);if(previous.length+next.length>8*1024*1024)throw Error('Exact identity audit payload exceeds limit');
 const key=Object.fromEntries(capture.pk.map(k=>[k,after[k]]));
 await ctx.conn.query(`INSERT INTO erp_sync_row_changes
 (run_id,profile,source_uid,source_file,source_row,source_action,dispo,table_name,action,row_key,identity_scope,affected_rows,changed_columns,before_json,after_json,note)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
  ctx.runId,ctx.currentSourceDataset==='delivery'?'greige-delivery':ctx.currentSourceDataset,ctx.currentSourceUid||ctx.syncOperation.uid,
  ctx.currentSourceFile||null,ctx.currentSourceRowNumber||null,ctx.syncOperation.action,
  ctx.syncOperation.dispo,table,'updated',json(key),'unique-row',1,json(changed),previous,next,
  'Exact source/SQL-qualified identity correction; original numeric ID preserved and old key retained in before_json.'
 ]);
}
module.exports={...base,updated};
