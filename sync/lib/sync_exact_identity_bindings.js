'use strict';
// Private, hash-pinned exact bindings supplement ordinary importer guards.
// A matching review alone cannot choose a replacement SQL target.
const fs=require('fs'),crypto=require('crypto');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const norm=x=>String(x??'').trim().toLowerCase();
const allowed={dispo:new Set(['dispo_plan_form','dispo_form_data','warp_yarn_details','weft_yarn_details','warp_broken_section','warp_broken_pattern']),folding:new Set(['folding_production_form','folding_production_breakdown']),warping:new Set(['warping_form','warping_breakdown']),sizing:new Set(['sizing_form','sizing_breakdown']),'greige-delivery':new Set(['greige_delivery_breakdown'])};
function load(env=process.env){
 const file=env.SYNC_EXACT_IDENTITY_BINDINGS_FILE,pin=env.SYNC_EXACT_IDENTITY_BINDINGS_SHA256;
 if(!file&&!pin)return null;
 if(!file||!/^[a-f0-9]{64}$/.test(pin||''))throw Error('Exact identity binding configuration incomplete');
 const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>512*1024)throw Error('Exact identity binding file rejected');
 const bytes=fs.readFileSync(file);if(sha(bytes)!==pin)throw Error('Exact identity binding hash changed');
 const cfg=JSON.parse(bytes);if(cfg.version!==1||!Array.isArray(cfg.records)||cfg.records.length>64)throw Error('Exact identity binding schema rejected');
 if(cfg.poReferenceAliases!==undefined&&(!Array.isArray(cfg.poReferenceAliases)||cfg.poReferenceAliases.length>20))throw Error('Canonical PO alias schema rejected');
 return cfg;
}
function selectRule(config,profile,op){
 if(!config||!op||op.action!=='update')return null;
 const rows=config.records.filter(r=>r.profile===profile&&r.sourceUid===op.uid);
 if(rows.length>1)throw Error('Duplicate exact identity binding');
 const r=rows[0];if(!r)return null;
 // Once committed, ordinary later edits do not need the original exact grant.
 if(op.previousDigest!==r.oldDigest)return null;
 if(op.digest!==r.newDigest||op.group!==r.newGroup||norm(op.dispo)!==norm(r.newDispo)||
    norm(op.previousDispo)!==norm(r.oldDispo)||!op.appliedReviewKeys?.includes(r.reviewKey))
  throw Error('Exact identity source or review drift');
 return r;
}
async function resolve(ctx,profile,table,data,config=load()){
 const r=selectRule(config,profile.id,ctx.syncOperation);if(!r)return null;
 if(!allowed[profile.id]?.has(table)||!Array.isArray(r.targets))throw Error('Exact identity table outside approved scope');
 const tc=profile.tables.find(t=>t.name===table);if(!tc)throw Error('Exact identity table missing from contract');
 const match=r.targets.filter(t=>t.table===table&&Object.entries(t.match||{}).every(([k,v])=>norm(data[k])===norm(v)));
 if(match.length!==1)throw Error('Exact identity target missing or ambiguous');
 const target=match[0],selector=target.selector,fields=Object.keys(selector||{});
 if(!fields.length||fields.some(k=>!['id','po_no','order_no'].includes(k))||Object.values(selector).some(v=>v===null||v===undefined||v===''))throw Error('Exact identity stable selector invalid');
 if(fields.includes('id')&&(!Number.isSafeInteger(Number(selector.id))||Number(selector.id)<=0))throw Error('Exact identity numeric ID invalid');
 for(const [k,v]of Object.entries(selector))if(k!=='id'&&norm(data[k])!==norm(v))throw Error('Exact identity immutable selector changed');
 const dispoField=table==='dispo_plan_form'?'dispo_no':'dispo_number';
 if(norm(data[dispoField])!==norm(r.newDispo))throw Error('Exact identity incoming Dispo changed');
 for(const [k,v]of Object.entries(target.requiredMapped||{}))if(norm(data[k])!==norm(v))throw Error('Exact identity mapped relationship changed');
 const db=ctx.conn||ctx.pool;
 const [rows]=await db.query('SELECT * FROM `'+table+'` WHERE '+fields.map(k=>'`'+k+'` <=> ?').join(' AND '),fields.map(k=>selector[k]));
 if(rows.length!==1||norm(rows[0][dispoField])!==norm(ctx.syncOperation.alreadyApplied?r.newDispo:r.oldDispo))throw Error('Exact identity original physical record missing or changed');
 const nk=tc.natural_key||[];
 if(!nk.length||nk.some(k=>data[k]===undefined))throw Error('Exact identity destination key incomplete');
 const [dest]=await db.query('SELECT * FROM `'+table+'` WHERE '+nk.map(k=>'`'+k+'` <=> ?').join(' AND '),nk.map(k=>data[k]));
 if(dest.some(d=>fields.some(k=>norm(d[k])!==norm(selector[k]))))throw Error('Exact identity destination already occupied');
 return {selector,id:rows[0].id??null};
}
async function assertChildSet(ctx,profile,table,desired,config=load()){
 const r=selectRule(config,profile.id,ctx.syncOperation);if(!r)return false;
 const childTables={dispo:['warp_yarn_details','weft_yarn_details','warp_broken_section','warp_broken_pattern'],folding:['folding_production_breakdown'],warping:['warping_breakdown'],sizing:['sizing_breakdown'],'greige-delivery':['greige_delivery_breakdown']};
 if(!childTables[profile.id]?.includes(table))throw Error('Exact child table outside approved scope');
 const targets=r.targets.filter(t=>t.table===table);
 if(desired.length!==targets.length||targets.some(t=>!Number.isSafeInteger(Number(t.selector?.id))||Number(t.selector.id)<=0))throw Error('Exact child set differs from qualified source');
 let sql='SELECT id,dispo_number FROM `'+table+'` WHERE LOWER(TRIM(dispo_number)) IN (?,?)',args=[norm(r.oldDispo),norm(r.newDispo)];
 const parentField={'folding':'folding_production_id',warping:'warping_form_id',sizing:'sizing_form_id','greige-delivery':'greige_delivery_id'}[profile.id];
 if(parentField){
  const parents=[...new Set(targets.map(t=>t.requiredMapped?.[parentField]))];
  if(parents.length!==1||!Number.isSafeInteger(parents[0]))throw Error('Exact child parent binding missing');
  sql='SELECT id,dispo_number FROM `'+table+'` WHERE `'+parentField+'`=?';args=[parents[0]];
 }
 const [rows]=await (ctx.conn||ctx.pool).query(sql+(ctx.dryRun?'':' FOR UPDATE'),args);
 if(rows.some(row=>![norm(r.oldDispo),norm(r.newDispo)].includes(norm(row.dispo_number))))throw Error('Exact child original Dispo changed');
 const ids=rows.map(x=>Number(x.id)).sort((a,b)=>a-b),expected=targets.map(t=>Number(t.selector.id)).sort((a,b)=>a-b);
 if(JSON.stringify(ids)!==JSON.stringify(expected))throw Error('Exact original child census changed');
 return true;
}
function auditBinding(ctx,table,capture,config=load()){
 if(!capture||!capture.pk?.some(k=>['dispo_number','dispo_no'].includes(k)))return null;
 const profile=ctx.currentSourceDataset==='delivery'?'greige-delivery':ctx.currentSourceDataset;
 const r=selectRule(config,profile,ctx.syncOperation);if(!r)return null;
 if(!allowed[profile]?.has(table)||capture.rows?.length!==1||Object.keys(capture.where||{}).join(',')!=='id')throw Error('Exact identity audit requires original unique numeric ID');
 const matches=r.targets.filter(t=>t.table===table&&Object.keys(t.selector||{}).join(',')==='id'&&Number(t.selector.id)===Number(capture.where.id));
 if(matches.length!==1||Number(capture.rows[0].id)!==Number(capture.where.id))throw Error('Exact identity audit selector drift');
 return {oldDispo:r.oldDispo,newDispo:r.newDispo,target:matches[0]};
}
function canonicalPoAlias(ctx,profile,rawDispo,poNo,config=load()){
 if(!ctx.sync||profile.id!=='po')return null;
 const op=ctx.syncOperation,aliases=config?.poReferenceAliases||[];
 const matches=aliases.filter(r=>r.profile==='po'&&r.sourceUid===op?.uid&&r.sourceGroup===op?.group);
 if(matches.length>1)throw Error('Canonical PO alias is not unique');
 const r=matches[0];
 if(!r){if(op?.canonicalReferenceRefresh)throw Error('Canonical reference refresh lacks exact alias policy');return null;}
 if(norm(rawDispo)!==norm(r.oldDispo))return null;
 if(norm(poNo)!==norm(r.poNo)||norm(r.oldDispo).replaceAll('/','')!==norm(r.newDispo).replaceAll('/',''))throw Error('Canonical PO alias scope drift');
 const keys=[...(op.appliedReviewKeys||[]),...(op.previousIdentity?.appliedReviewKeys||[])];
 if(!keys.includes(r.reviewKey))throw Error('Canonical PO alias has no exact approved review');
 const master=ctx.sourceIndex?.dispoMaster(r.newDispo);
 if(!master||master.operationalMode!=='full'||norm(master.dispoNumber)!==norm(r.newDispo)||norm(master.values?.po_no)!==norm(r.poNo))throw Error('Canonical PO alias full source master changed');
 return master.dispoNumber;
}
module.exports={load,selectRule,resolve,assertChildSet,auditBinding,canonicalPoAlias};
