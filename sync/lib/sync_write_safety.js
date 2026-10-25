'use strict';
// Sync-specific writes preserve existing primary keys and never remove child rows.
// Migration-only behavior is unchanged. Callers must use one live transaction.
const crypto=require('crypto');
const quote=x=>{if(!/^[A-Za-z0-9_]+$/.test(x))throw Error('Invalid SQL identifier');return '`'+x+'`';};
const error=(code,message)=>Object.assign(new Error(message),{code});
const sqlWhere=where=>Object.keys(where).map(k=>quote(k)+' <=> ?').join(' AND ');
function decimalString(value,scale){
 // MariaDB DECIMAL rounds exact base-ten ties away from zero. JS toFixed
 // operates on binary floats (0.015.toFixed(2) is 0.01), so it is not a
 // valid comparison for persisted DECIMAL values.
 const m=/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(String(value).trim());
 if(!m)throw error('SYNC_INVALID_DECIMAL','Invalid decimal value');
 const fraction=m[3]||'',shift=Number(m[4]||0)-fraction.length+scale;
 let n=BigInt(m[2]+fraction);
 if(shift>=0)n*=10n**BigInt(shift);
 else {const divisor=10n**BigInt(-shift);n=n/divisor+(n%divisor*2n>=divisor?1n:0n);}
 const s=n.toString().padStart(scale+1,'0');
 return (m[1]==='-'&&n!==0n?'-':'')+(scale?s.slice(0,-scale)+'.'+s.slice(-scale):s);
}
function canonical(value,type=''){
 if(value===null||value===undefined)return null;
 const t=String(type).toLowerCase();
 if(/^(tinyint|smallint|mediumint|int|integer|bigint)/.test(t)){
  const raw=String(value);if(!/^-?\d+$/.test(raw))return raw;
  return BigInt(raw).toString();
 }
 if(/^(decimal|numeric|float|double|real)/.test(t)){
  const n=Number(value);if(!Number.isFinite(n))throw error('SYNC_NONFINITE_VALUE','Non-finite numeric value');
  const m=/^(?:decimal|numeric)\(\d+,\s*(\d+)\)/.exec(t);
  return m?decimalString(value,Number(m[1])):String(n);
 }
 if(value instanceof Date)return value.toISOString().slice(0,t.startsWith('date ')||t==='date'?10:19).replace('T',' ');
 return Buffer.isBuffer(value)?value.toString('hex'):String(value);
}
function equal(a,b,type){return canonical(a,type)===canonical(b,type);}
async function lockedRows(ctx,table,where,limit=5001){
 const handle=ctx.dryRun?(ctx.pool||ctx.conn):ctx.conn;
 if(!handle||!Object.keys(where).length)throw error('SYNC_UNBOUNDED_TARGET','Bounded transaction required');
 const [rows]=await handle.query('SELECT * FROM '+quote(table)+' WHERE '+sqlWhere(where)+' LIMIT '+limit+(ctx.dryRun?'':' FOR UPDATE'),Object.values(where));
 if(rows.length>=limit)throw error('SYNC_TARGET_LIMIT','Target set exceeds bounded reconciliation limit');
 return rows;
}
async function primaryKeys(ctx,table){
 ctx.syncSafetyPrimaryKeys ||= new Map();
 if(!ctx.syncSafetyPrimaryKeys.has(table)){
  const [cols]=await (ctx.conn||ctx.pool).query('SHOW COLUMNS FROM '+quote(table));
  ctx.syncSafetyPrimaryKeys.set(table,cols.filter(x=>x.Key==='PRI').map(x=>x.Field));
 }
 return ctx.syncSafetyPrimaryKeys.get(table);
}
function keyObject(row,keys){
 if(!keys.length||keys.some(k=>row[k]===null||row[k]===undefined))
  throw error('SYNC_MISSING_STABLE_KEY','A complete stable child key is required');
 return Object.fromEntries(keys.map(k=>[k,row[k]]));
}
function fingerprint(row,keys,schema){
 return JSON.stringify(keys.map(k=>canonical(row[k],schema?.[k])));
}
async function assertMappedValues(ctx,table,where,expected){
 if(!ctx.sync||ctx.dryRun)return;
 const rows=await lockedRows(ctx,table,where,2);
 if(rows.length!==1)throw error('SYNC_POSTIMAGE_NOT_UNIQUE','Written target is not uniquely readable');
 const schema=ctx.schema?.[table]||{};
 const differs=Object.keys(expected).filter(k=>k!=='id'&&expected[k]!==undefined&&!equal(rows[0][k],expected[k],schema[k]));
 if(differs.length)throw error('SYNC_POSTIMAGE_MISMATCH','Database differs from mapped values in '+table+': '+differs.join(','));
}
async function reconcileChildren(ctx,profile,table,scope,desiredRows,callbacks){
 if(!ctx.sync)throw error('SYNC_ONLY_RECONCILER','Non-destructive reconciliation requires synchronization mode');
 if(!Array.isArray(desiredRows)||desiredRows.length>5000)throw error('SYNC_INVALID_CHILD_SET','Invalid child set');
 const spec=(profile.tables||[]).find(x=>x.name===table);
 const keys=spec?.natural_key||[];
 const schema=ctx.schema?.[table]||{};
 if(!keys.length)throw error('SYNC_CHILD_IDENTITY_MISSING','No mapped stable child identity for '+table);
 const desired=desiredRows.map(row=>({...row}));
 const seen=new Set();
 for(const row of desired){
  keyObject(row,keys);
  if(Object.keys(scope).some(k=>!equal(row[k],scope[k],schema[k])))
   throw error('SYNC_CHILD_SCOPE_MISMATCH','Child row escapes its verified parent scope');
  const k=fingerprint(row,keys,schema);
  if(seen.has(k))throw error('SYNC_DUPLICATE_CHILD_KEY','Two source children resolve to one key');
  seen.add(k);
 }
 const newVirtualParent=ctx.dryRun&&Object.entries(scope).some(([k,v])=>/^(tinyint|smallint|mediumint|int|bigint)/i.test(schema[k]||'')&&typeof v==='string'&&v.startsWith('DRY-'));
 const before=newVirtualParent?[]:await lockedRows(ctx,table,scope);
 const pks=await primaryKeys(ctx,table),identityKeys=pks.length?pks:keys;
 const original=new Map();
 for(const row of before){
  const k=fingerprint(row,identityKeys,schema);
  if(original.has(k))throw error('SYNC_DUPLICATE_EXISTING_CHILD','Existing child identity is ambiguous');
  original.set(k,row);
 }
 const matched=new Set(),decisions=[];
 for(const row of desired){
  const natural=keyObject(row,keys);
  const found=newVirtualParent?[]:await lockedRows(ctx,table,natural,3);
  if(found.length>1)throw error('SYNC_AMBIGUOUS_CHILD_TARGET','Natural key matches multiple existing children');
  if(found.length){
   const id=fingerprint(found[0],identityKeys,schema);
   if(!original.has(id))throw error('SYNC_CHILD_OUTSIDE_PARENT','Natural key resolves outside locked parent');
   if(matched.has(id))throw error('SYNC_DUPLICATE_CHILD_TARGET','Multiple source rows target the same existing child');
   matched.add(id);decisions.push({kind:'update',row,where:keyObject(found[0],identityKeys)});
  }else decisions.push({kind:'insert',row,natural});
 }
 const historical=[...original].filter(([key])=>!matched.has(key));
 if(historical.length){
  if(ctx.sync.plan?.missingRowPolicy!=='retain-history')
   throw error('SYNC_CHILD_REMOVAL_REQUIRED','Source omits existing children; explicit non-destructive review required');
  ctx.sync.retainedChildren ||= [];
  for(const [,row]of historical)ctx.sync.retainedChildren.push({profile:profile.id,uid:ctx.syncOperation?.uid,table,
   key:keyObject(row,identityKeys),beforeHash:crypto.createHash('sha256').update(JSON.stringify(row)).digest('hex')});
 }
 if(ctx.dryRun){
  const previews=[];
  // Keep preimage evidence in deterministic source order; never use Promise.all here.
  for(const row of desired)previews.push(await callbacks.preview(row));
  return previews;
 }
 const results=[];
 for(const d of decisions){
  if(d.kind==='update'){
   await callbacks.update(d.row,d.where);
   await assertMappedValues(ctx,table,d.where,d.row);
   results.push({action:'updated',id:d.where.id||null});
  }else{
   // Recheck within the same transaction to catch collated or concurrent duplicates.
   if((await lockedRows(ctx,table,d.natural,2)).length)
    throw error('SYNC_CHILD_INSERT_CONFLICT','Child key appeared after planning');
   const r=await callbacks.insert(d.row);
   const where=pks.length===1&&pks[0]==='id'&&r.insertId?{id:r.insertId}:d.natural;
   await assertMappedValues(ctx,table,where,d.row);
   results.push({action:'inserted',id:r.insertId||null});
  }
 }
 const after=await lockedRows(ctx,table,scope);
 if(after.length!==before.length+decisions.filter(x=>x.kind==='insert').length)
  throw error('SYNC_CHILD_COUNT_MISMATCH','Unexpected child-row cardinality after reconciliation');
 const retained=new Set(after.map(row=>fingerprint(row,identityKeys,schema)));
 if([...original.keys()].some(k=>!retained.has(k)))
  throw error('SYNC_CHILD_IDENTITY_LOST','An existing child identity was lost');
 for(const [key,row]of historical){
  const actual=after.find(r=>fingerprint(r,identityKeys,schema)===key);
  if(!actual||Object.keys(row).some(k=>!equal(row[k],actual[k],schema[k])))
   throw error('SYNC_RETAINED_CHILD_CHANGED','A retained historical child was modified');
 }
 return results;
}
function assertAllowedSQL(statement){
 const sql=typeof statement==='string'?statement:statement&&statement.sql;
 if(typeof sql!=='string'||/[;\x00]/.test(sql)||/\/\*[!M]/i.test(sql))throw error('SYNC_SQL_FORBIDDEN','Executable comments or unknown SQL are forbidden');
 const trimmed=sql.replace(/^\s*(?:(?:--[^\r\n]*(?:\r?\n|$))|(?:\/\*[\s\S]*?\*\/))*\s*/, '');
 const verb=/^([a-z]+)/i.exec(trimmed)?.[1]?.toUpperCase();
 if(!['SELECT','SHOW','INSERT','UPDATE'].includes(verb))
  throw error('SYNC_SQL_FORBIDDEN','Statement is outside SELECT/SHOW/INSERT/UPDATE synchronization policy');
 return true;
}
function fenceConnection(conn){
 const originals={};
 for(const name of ['query','execute']){
  if(typeof conn[name]!=='function')continue;
  originals[name]=conn[name];
  conn[name]=function(sql,...args){assertAllowedSQL(sql);return originals[name].call(this,sql,...args);};
 }
 return ()=>{for(const [name,fn]of Object.entries(originals))conn[name]=fn;};
}
async function assertReferencedKeysUnchanged(ctx,table,data,where){
 if(!ctx.sync||ctx.dryRun)return;
 ctx.syncReferencedKeys ||= new Map();
 if(!ctx.syncReferencedKeys.has(table)){
  const [refs]=await ctx.conn.query('SELECT DISTINCT REFERENCED_COLUMN_NAME col FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME=? AND REFERENCED_COLUMN_NAME IS NOT NULL',[table]);
  ctx.syncReferencedKeys.set(table,refs.map(r=>r.col));
 }
 const fields=ctx.syncReferencedKeys.get(table).filter(k=>data[k]!==undefined);
 if(!fields.length)return;
 const rows=await lockedRows(ctx,table,where,2);
 if(rows.length!==1)throw error('SYNC_PARENT_KEY_NOT_UNIQUE','Referenced parent target is not unique');
 if(fields.some(k=>!equal(rows[0][k],data[k],ctx.schema?.[table]?.[k])))
  throw error('SYNC_REFERENCED_KEY_CHANGE','A referenced parent identity cannot change through ordinary synchronization');
}
async function assertNoUnreviewedTriggers(ctx){
 if(!ctx.sync||!ctx.pool)return;
 const tables=[...new Set(ctx.contract.profiles.flatMap(p=>(p.tables||[]).map(t=>t.name)))];
 const [[identity]]=await ctx.pool.query('SELECT DATABASE() db');
 const [grants]=await ctx.pool.query('SHOW GRANTS');
 const visible=new Set();
 for(const row of grants){
  const sql=String(Object.values(row)[0]||'');
  const match=/^GRANT (.+?) ON (.+?) TO /i.exec(sql);
  if(!match||!/(^|,\s*)(TRIGGER|ALL PRIVILEGES)(,|$)/i.test(match[1]))continue;
  const scope=match[2].replace(/`/g,'').split('.');
  if(scope[0]==='*'&&scope[1]==='*'||scope[0]===identity.db&&scope[1]==='*')for(const t of tables)visible.add(t);
  else if(scope[0]===identity.db&&tables.includes(scope[1]))visible.add(scope[1]);
 }
 if(tables.some(t=>!visible.has(t)))throw error('SYNC_TRIGGER_VISIBILITY','Cannot establish trigger visibility for every mapped target table');
 const [triggers]=await ctx.pool.query('SELECT TRIGGER_NAME name,EVENT_OBJECT_TABLE target FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('+tables.map(()=>'?').join(',')+')',tables);
 if(triggers.length)throw error('SYNC_TRIGGER_REVIEW_REQUIRED','Mapped tables have triggers requiring independent no-delete review: '+triggers.map(x=>x.name).join(','));
}
module.exports={canonical,equal,lockedRows,primaryKeys,assertMappedValues,reconcileChildren,assertAllowedSQL,fenceConnection,assertNoUnreviewedTriggers,assertReferencedKeysUnchanged};
