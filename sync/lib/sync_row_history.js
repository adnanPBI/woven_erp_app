'use strict';
// Audit writes use the SAME connection/transaction as the business mutation.
// A rollback removes both; a resumed committed source row is not logged twice.
const crypto=require('crypto');
const quote=n=>{if(!/^[A-Za-z0-9_]+$/.test(n))throw Error('Invalid history identifier');return '`'+n+'`';};
const enabled=ctx=>!!ctx.sync&&!ctx.dryRun;
const json=value=>JSON.stringify(value,(_,v)=>typeof v==='bigint'?String(v):v);
const whereSql=where=>Object.keys(where).map(k=>quote(k)+' <=> ?').join(' AND ');
async function columns(ctx,table){
 ctx.syncHistorySchema ||= new Map();
 if(!ctx.syncHistorySchema.has(table)){const [rows]=await ctx.conn.query('SHOW COLUMNS FROM '+quote(table));ctx.syncHistorySchema.set(table,rows);}
 return ctx.syncHistorySchema.get(table);
}
async function snapshot(ctx,table,where){
 if(!ctx.conn)throw Error('Sync row history requires the business transaction');
 if(!Object.keys(where).length)throw Error('Unbounded row history capture refused');
 const [rows]=await ctx.conn.query('SELECT * FROM '+quote(table)+' WHERE '+whereSql(where)+' LIMIT 10001 FOR UPDATE',Object.values(where));
 if(rows.length>10000)throw Error('Row history capture exceeds per-mutation limit');
 return rows;
}
async function record(ctx,table,action,key,before,after,scope,count,note){
 if(!ctx.conn)throw Error('Sync row history requires the business transaction');
 const previous=before===null?null:json(before),next=after===null?null:json(after);
 if((previous?.length||0)+(next?.length||0)>8*1024*1024)throw Error('Row history payload exceeds limit');
 const changed=scope==='unique-row'?Object.keys({...before,...after}).filter(k=>json(before?.[k])!==json(after?.[k])):[];
 if(action==='updated'&&previous===next)return;
 await ctx.conn.query(`INSERT INTO erp_sync_row_changes
 (run_id,profile,source_uid,source_file,source_row,source_action,dispo,table_name,action,row_key,identity_scope,affected_rows,changed_columns,before_json,after_json,note)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[
  ctx.runId,ctx.currentSourceDataset==='delivery'?'greige-delivery':ctx.currentSourceDataset,
  ctx.currentSourceUid||ctx.syncOperation?.uid||null,ctx.currentSourceFile||null,ctx.currentSourceRowNumber||null,
  ctx.syncOperation?.action||null,ctx.syncOperation?.dispo||'',table,action,json(key),scope,count,json(changed),previous,next,note||null
 ]);
}
async function before(ctx,table,where){
 if(!enabled(ctx))return null;
 const schema=await columns(ctx,table);const pk=schema.filter(c=>c.Key==='PRI').map(c=>c.Field);
 return{where,pk,rows:await snapshot(ctx,table,where)};
}
async function updated(ctx,table,capture){
 if(!capture)return;
 if(!capture.pk.length){const after=await snapshot(ctx,table,capture.where);await record(ctx,table,'updated',capture.where,capture.rows,after,'matching-row-set',capture.rows.length,'Table has no unique primary key; before/after values describe the complete matching row set.');return;}
 for(const row of capture.rows){const key=Object.fromEntries(capture.pk.map(k=>[k,row[k]]));const after=await snapshot(ctx,table,key);if(after.length!==1)throw Error('Updated audit row is not unique');await record(ctx,table,'updated',key,row,after[0],'unique-row',1);}
}
async function deleted(ctx,table,capture){
 if(!capture)return;
 if(!capture.pk.length){if(capture.rows.length)await record(ctx,table,'deleted',capture.where,capture.rows,null,'matching-row-set',capture.rows.length,'Detail replacement: importer removes old children before rebuilding them; this is not source-row deletion mirroring.');return;}
 for(const row of capture.rows)await record(ctx,table,'deleted',Object.fromEntries(capture.pk.map(k=>[k,row[k]])),row,null,'unique-row',1,'Detail replacement: importer removes old children before rebuilding them; this is not source-row deletion mirroring.');
}
async function inserted(ctx,table,data,insertId){
 if(!enabled(ctx))return;
 const schema=await columns(ctx,table),pk=schema.filter(c=>c.Key==='PRI').map(c=>c.Field),values={...data};
 for(const col of schema)if(col.Extra.includes('auto_increment')&&insertId)values[col.Field]=insertId;
 const key=Object.fromEntries(pk.filter(k=>values[k]!==undefined).map(k=>[k,values[k]]));
 if(pk.length&&Object.keys(key).length===pk.length){const rows=await snapshot(ctx,table,key);if(rows.length!==1)throw Error('Inserted audit row is not unique');await record(ctx,table,'added',key,null,rows[0],'unique-row',1);}
 else{
  const businessKey=Object.fromEntries(Object.entries(values).filter(([k])=>/^(id|dispo_number|dispo_no|po_no|pre_costing_no)$/.test(k)));
  if(!Object.keys(businessKey).length)businessKey.sourceValueFingerprint=crypto.createHash('sha256').update(json(data)).digest('hex');
  await record(ctx,table,'added',businessKey,null,data,'submitted-values',1,'Table has no unique primary key. These are submitted source values; server defaults are not included.');
 }
}
module.exports={before,updated,deleted,inserted};
