'use strict';
// Three-way evidence: frozen source + ledger + actual mapped database rows.
const crypto=require('crypto');
const {canonical}=require('./sync_write_safety');
const quote=n=>{if(!/^[A-Za-z0-9_]+$/.test(n))throw Error('Invalid evidence SQL identifier');return '`'+n+'`';};
const fail=(code,message)=>Object.assign(new Error(message),{code});
function stable(value){
 if(value===null||value===undefined)return null;
 if(value instanceof Date)return value.toISOString();
 if(Buffer.isBuffer(value))return {hex:value.toString('hex')};
 if(typeof value==='bigint')return value.toString();
 if(Array.isArray(value))return value.map(stable);
 if(typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
 return value;
}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const rowHash=rows=>digest(rows.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
async function select(ctx,table,where,lock,directionScope){
 const fields=Object.keys(where);
 if(!fields.length)throw fail('SYNC_EVIDENCE_UNBOUNDED','Empty target selector');
 let directionSql='';const params=fields.map(k=>where[k]);
 if(directionScope!==undefined){
  if(table!=='yarn_issue_form'||!['','warp','weft','warp+weft'].includes(directionScope))throw fail('SYNC_INVALID_DIRECTION_SCOPE','Invalid issue direction scope');
  directionSql=" AND (CASE WHEN COALESCE(total_warp_issue_kgs,0)<>0 AND COALESCE(total_weft_issue_kgs,0)<>0 THEN 'warp+weft' WHEN COALESCE(total_warp_issue_kgs,0)<>0 THEN 'warp' WHEN COALESCE(total_weft_issue_kgs,0)<>0 THEN 'weft' WHEN total_warp_issue_kgs IS NOT NULL AND total_weft_issue_kgs IS NOT NULL THEN 'warp+weft' WHEN total_warp_issue_kgs IS NOT NULL THEN 'warp' WHEN total_weft_issue_kgs IS NOT NULL THEN 'weft' ELSE '' END)=?";
  params.push(directionScope);
 }
 const [rows]=await (ctx.conn||ctx.pool).query('SELECT * FROM '+quote(table)+' WHERE '+fields.map(k=>quote(k)+' <=> ?').join(' AND ')+directionSql+' LIMIT 3'+(lock?' FOR UPDATE':''),params);
 if(rows.length>1)throw fail('SYNC_EVIDENCE_AMBIGUOUS','Target selector is not unique: '+table);
 return rows;
}
const businessDateFields={
 pre_costing_data:'pre_costing_date',PO_form_data:'po_issue_date',
 dispo_plan_form:'po_issue_date',dispo_form_data:'dispo_creating_date',
 yarn_receive_form:'received_start_date',yarn_received_details:'received_date',
 yarn_issue_form:'issue_date',yarn_issue_details:'issue_date',
 warping_form:'warping_date',warping_breakdown:'warping_date',
 sizing_form:'sizing_date',sizing_breakdown:'sizing_date',
 loom_production_form:'weaving_date',loom_production_breakdown:'loom_production_date',
 folding_production_form:'folding_production_date',folding_production_breakdown:'folding_production_date',
 greige_delivery_form:'delivery_date',greige_delivery_breakdown:'greige_delivery_date'
};
function assertExistingDate(ctx,table,row){
 const window=ctx.sync?.plan?.businessWindow,field=businessDateFields[table];
 if(!window||!field||!row)return;
 // Masters are reused by current events and may have no creation date.
 // Their source operation is date-bounded; original-row protection is separate.
 if(['pre_costing_data','PO_form_data','dispo_plan_form','dispo_form_data'].includes(table))return;
 const date=String(row[field]??'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<window.start||date>window.end)
  throw fail('SYNC_PRIOR_BUSINESS_DATE_OUTSIDE_WINDOW','Existing target is historical or undated and cannot be changed by this recovery: '+table);
}
function assertData(ctx,table,actual,expected,dynamic=[]){
 const schema=ctx.schema?.[table]||{};
 const wrong=Object.keys(expected).filter(k=>k!=='id'&&!dynamic.includes(k)&&expected[k]!==undefined&&canonical(actual[k],schema[k])!==canonical(expected[k],schema[k]));
 if(wrong.length)throw fail('SYNC_BUSINESS_VALUE_MISMATCH','Mapped business values disagree in '+table+': '+wrong.join(','));
}
async function assertNotOriginal(ctx,table,row){
 const original=ctx.sync?.plan?.originalFingerprintDatabase;
 if(!original||!row)return;
 if(original!=='weavonpq_weaving_local')throw fail('SYNC_ORIGINAL_GUARD','Unexpected original baseline database');
 const db=ctx.conn||ctx.pool;
 const [[target]]=await db.query('SELECT DATABASE() db');
 if(target.db!=='weavonpq_weaving_sep22_preview')throw fail('SYNC_ORIGINAL_GUARD','Original baseline guard is local-only');
 const [cols]=await db.query('SHOW COLUMNS FROM '+quote(table));
 const primary=cols.filter(c=>c.Key==='PRI').map(c=>c.Field);
 const keys=primary.length?primary:cols.map(c=>c.Field);
 if(!keys.length||keys.some(k=>row[k]===undefined))throw fail('SYNC_ORIGINAL_GUARD','Complete original-row selector required');
 const expr='SHA2(CAST(JSON_ARRAY('+cols.map(c=>'t.'+quote(c.Field)).join(',')+') AS CHAR),256)';
 const [matches]=await db.query('SELECT 1 FROM '+quote(table)+' t JOIN '+quote(original)+'.local_retained_fingerprints f ON f.table_name=? AND f.row_sha='+expr+' WHERE '+keys.map(k=>'t.'+quote(k)+' <=> ?').join(' AND ')+' LIMIT 1',[table,...keys.map(k=>row[k])]);
 if(matches.length)throw fail('SYNC_PROTECTED_ORIGINAL_ROW','Refusing to modify a protected original row in '+table);
}
class BusinessEvidence{
 constructor(planHash,manifestHash,mode='capture',bundle=null){
  if(!['capture','apply','verify'].includes(mode))throw Error('Invalid evidence mode');
  this.planHash=planHash;this.manifestHash=manifestHash;this.mode=mode;
  this.records={};this.cursors=new Map();this.visited=new Set();this.targetsVerified=0;
  this.absentTargets=new Map();
  if(mode==='apply'){
   if(!bundle||bundle.planHash!==planHash||bundle.manifestHash!==manifestHash||bundle.version!==1||bundle.fingerprint!==digest(bundle.records))
    throw fail('SYNC_EVIDENCE_CHANGED','Missing or changed source/plan-bound business preimages');
   this.records=structuredClone(bundle.records);
  }
 }
 begin(profile,uid){this.active=profile+'|'+uid;this.cursors.set(this.active,0);this.visited.add(this.active);if(this.mode!=='apply')this.records[this.active]=[];}
 async capture(ctx,table,data,keyFields,directionScope){
  if(!this.active||!Array.isArray(keyFields)||!keyFields.length||keyFields.some(k=>data[k]===undefined||
    (data[k]===null&&/NOT NULL/i.test(ctx.schema?.[table]?.[k]||'')))||keyFields.every(k=>data[k]===null))
   throw fail('SYNC_EVIDENCE_KEY_MISSING','Complete target identity is required');
  if(this.mode==='apply')throw Error('Cannot capture replacement evidence during apply');
  for(const [field,value]of Object.entries(data)){
   const limit=/^(?:var)?char\((\d+)\)/i.exec(ctx.databaseColumnTypes?.[table]?.[field]||'');
   if(limit&&typeof value==='string'&&[...value].length>Number(limit[1]))
    throw fail('SYNC_MAPPED_VALUE_TOO_LONG','Mapped source exceeds live database column capacity: '+table+'.'+field);
  }
  const dynamic=Object.keys(data).filter(k=>/^(tinyint|smallint|mediumint|int|bigint)/i.test(ctx.schema?.[table]?.[k]||'')&&typeof data[k]==='string'&&data[k].startsWith('DRY-'));
  const where=Object.fromEntries(keyFields.map(k=>[k,data[k]]));
  const rows=dynamic.some(k=>keyFields.includes(k))?[]:await select(ctx,table,where,false,directionScope);
  if(rows[0])assertExistingDate(ctx,table,rows[0]);
  if(rows[0]&&this.mode!=='verify')await assertNotOriginal(ctx,table,rows[0]);
  if(this.mode==='verify'||ctx.syncOperation?.alreadyApplied){
   if(rows.length!==1)throw fail('SYNC_POSTVERIFY_TARGET_MISSING','Expected target missing in '+table);
   assertData(ctx,table,rows[0],data,dynamic);this.targetsVerified++;
  }
  // Two source operations must not both qualify the same physical absence.
  // The first insert would invalidate the second preimage during application.
  // Report that conflict before backup/live writes, retaining both source rows
  // for an explicit identity or revision resolution.
  if(this.mode==='capture'&&!rows.length){
   const reservation=digest({table,selector:where,directionScope:directionScope??null});
   const prior=this.absentTargets.get(reservation);
   if(prior&&prior!==this.active)
    throw fail('SYNC_PLANNED_TARGET_COLLISION','Multiple source operations qualify the same absent target in '+table+': '+prior+' and '+this.active);
   this.absentTargets.set(reservation,this.active);
  }
  let mappedMatches=false;
  if(rows.length===1&&!dynamic.length){
   try{assertData(ctx,table,rows[0],data);mappedMatches=true;}
   catch(error){if(error.code!=='SYNC_BUSINESS_VALUE_MISMATCH')throw error;}
  }
  const item={table,keyFields:[...keyFields],selector:where,...(directionScope===undefined?{}:{directionScope}),beforeHash:rowHash(rows),beforeCount:rows.length,mappedMatches,
   mappedData:Object.fromEntries(Object.entries(data).filter(([,v])=>v!==undefined)),dynamicFields:dynamic};
  this.records[this.active].push(item);
  return rows[0]||null;
 }
 async beforeMutation(ctx,action,table,data,where){
  if(this.mode!=='apply'||!this.active)throw fail('SYNC_EVIDENCE_REQUIRED','Business write lacks exact qualified preimage evidence');
  const i=this.cursors.get(this.active)||0,items=this.records[this.active],item=items?.[i];
  if(!item||item.table!==table)throw fail('SYNC_EVIDENCE_SEQUENCE_CHANGED','Business target sequence differs from qualification');
  const keys=v=>Object.keys(v).filter(k=>k!=='id'&&v[k]!==undefined).sort();
  if(JSON.stringify(keys(data))!==JSON.stringify(keys(item.mappedData)))
   throw fail('SYNC_EVIDENCE_FIELDS_CHANGED','Mutation field set differs from qualified mapped fields');
  assertData(ctx,table,data,item.mappedData,item.dynamicFields);
  for(const k of item.keyFields){
   if(item.dynamicFields.includes(k))continue;
   const actual=where&&Object.hasOwn(where,k)?where[k]:data[k];
   if(canonical(actual,ctx.schema?.[table]?.[k])!==canonical(item.selector[k],ctx.schema?.[table]?.[k]))
    throw fail('SYNC_EVIDENCE_SELECTOR_CHANGED','Mutation selector differs from qualified target');
  }
  const key=where||Object.fromEntries(item.keyFields.map(k=>[k,data[k]]));
  if(Object.values(key).some(v=>v===undefined)||Object.values(key).every(v=>v===null))
   throw fail('SYNC_EVIDENCE_KEY_MISSING','Live selector is incomplete');
  const rows=await select(ctx,table,key,true,item.directionScope);
  if(rows[0])assertExistingDate(ctx,table,rows[0]);
  if(rows[0])await assertNotOriginal(ctx,table,rows[0]);
  if(rowHash(rows)!==item.beforeHash||rows.length!==item.beforeCount)
   throw fail('SYNC_BUSINESS_PREIMAGE_CHANGED','Actual database target changed after qualification: '+table);
  if(action==='insert'&&rows.length!==0||action==='update'&&rows.length!==1)
   throw fail('SYNC_EVIDENCE_ACTION_CHANGED','Insert/update identity differs from qualified target');
  this.lastMutation={table,where:key};
  this.cursors.set(this.active,i+1);
 }
 finish(){
  if(this.mode==='apply'&&(this.cursors.get(this.active)||0)!==(this.records[this.active]?.length||0))
   throw fail('SYNC_EVIDENCE_TARGETS_INCOMPLETE','Not all qualified targets were checked');
 }
 canReplayCurrent(){
  const items=this.records[this.active];
  return Array.isArray(items)&&items.length>0&&items.every(item=>item.mappedMatches===true&&!item.dynamicFields.length);
 }
 async verifyReplay(ctx){
  const items=this.records[this.active];
  if(!Array.isArray(items))throw fail('SYNC_REPLAY_EVIDENCE_MISSING','Cannot verify a prior commit without business evidence');
  for(const item of items){
   if(item.dynamicFields.length)throw fail('SYNC_REPLAY_REQUALIFY','Committed parent IDs must be requalified before resuming');
   const rows=await select(ctx,item.table,item.selector,true,item.directionScope);
   if(rows.length!==1)throw fail('SYNC_REPLAY_TARGET_MISSING','Committed target is missing');
   assertData(ctx,item.table,rows[0],item.mappedData);this.targetsVerified++;
  }
  this.cursors.set(this.active,items.length);
 }
 export(){return {version:1,planHash:this.planHash,manifestHash:this.manifestHash,records:this.records,fingerprint:digest(this.records)};}
}
async function verifyCapturedCostingMasters(connection,bundle){
 if(!bundle||bundle.fingerprint!==digest(bundle.records))throw fail('SYNC_EVIDENCE_CHANGED','Costing verification evidence changed');
 const items=Object.values(bundle.records).flat().filter(r=>r.table==='pre_costing_data');
 if(!items.length)return {targets:0,verified:0};
 const [cols]=await connection.query('SHOW COLUMNS FROM pre_costing_data');
 const ctx={conn:connection,schema:{pre_costing_data:Object.fromEntries(cols.map(c=>[c.Field,c.Type]))}};
 for(const item of items){
  const rows=await select(ctx,item.table,item.selector,false);
  if(rows.length!==1)throw fail('SYNC_POSTVERIFY_TARGET_MISSING','Created costing master missing');
  assertData(ctx,item.table,rows[0],item.mappedData);
 }
 return {targets:items.length,verified:items.length};
}
module.exports={BusinessEvidence,digest,rowHash,stable,assertData,assertExistingDate,verifyCapturedCostingMasters};
