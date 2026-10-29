'use strict';
const {fingerprint,hash}=require('./sheets_sync_plan');
const {yarnIdentity}=require('./yarn_sync_identity');
const {BusinessEvidence}=require('./sync_business_evidence');
const {isoBusinessDate}=require('./sync_date_scope');
class SheetsSyncRuntime{
 constructor(plan,protectedMasters,manifestHash,options={}){
  if(!plan.ok||!protectedMasters)throw Error('Conflicted or unprotected synchronization plan');
  this.plan=plan;this.hash=hash({plan,manifestHash});this.manifestHash=manifestHash;
  this.protectedMasters=protectedMasters;this.options=options;this.selected=new Map();
  for(const [profile,rows]of Object.entries(plan.operations)){
   const map=new Map(),uids=new Set();
   for(const r of rows){
    if(!Number.isInteger(r.rowNumber)||!r.uid||!['insert','update','refresh'].includes(r.action)||map.has(r.rowNumber)||uids.has(r.uid))throw Error('Duplicate or malformed planned event');
    map.set(r.rowNumber,r);uids.add(r.uid);
   }
   this.selected.set(profile,map);
  }
 }
 has(profile,row){return this.selected.get(profile)?.has(row)||false;}
 async initialize(ctx){
  if(ctx.sourceManifestFileSha256!==this.manifestHash)throw Error('Sync manifest changed');
  const [[identity]]=await (ctx.conn||ctx.pool).query('SELECT DATABASE() db');
  if(this.plan.businessWindow){
   const w=this.plan.businessWindow;
   if(!isoBusinessDate(w.start)||!isoBusinessDate(w.end)||w.start>w.end)throw Error('Invalid synchronization date boundary');
   for(const ops of this.selected.values())for(const r of ops.values()){
    const d=isoBusinessDate(r.businessDate);if(!d||d<w.start||d>w.end)throw Error('Planned operation is outside the synchronization date boundary');
   }
  }
  if(identity.db==='weavonpq_weaving_main'){
   const w=this.plan.businessWindow;
   if(!w||!isoBusinessDate(w.start)||!isoBusinessDate(w.end)||w.start<'2026-09-21'||w.start>w.end)throw Error('Production requires an explicit business-date boundary');
   for(const ops of this.selected.values())for(const r of ops.values()){
    const d=isoBusinessDate(r.businessDate);if(!d||d<w.start||d>w.end)throw Error('Planned operation is outside the production date boundary');
   }
  }
  const mode=ctx.dryRun?(this.options.verifyOnly?'verify':'capture'):'apply';
  this.business=new BusinessEvidence(this.hash,this.manifestHash,mode,this.options.businessPreimages||null);
  ctx.localRetainedMasters=Object.fromEntries(Object.entries(this.protectedMasters).map(([t,s])=>[t,{key:s.key,values:new Set(s.values)}]));
 }
 async begin(ctx,profile,fileInfo,values){
  const op=this.selected.get(profile.id)?.get(ctx.currentSourceRowNumber);
  if(!op||fingerprint(fileInfo.headers,values,profile.id)!==op.digest)throw Error('Sync source differs from reviewed plan');
  ctx.syncOperation={...op,yarnIdentity:yarnIdentity(profile.id,fileInfo.headers,values)};
  this.business.begin(profile.id,op.uid);
  const [rows]=await (ctx.conn||ctx.pool).query('SELECT digest FROM sheets_sync_events WHERE profile=? AND source_uid=?'+(ctx.dryRun?'':' FOR UPDATE'),[profile.id,op.uid]);
  if(rows.length>1)throw Error('Ledger event is not unique');
  const actual=rows[0]?.digest||null;
  ctx.syncOperation.alreadyApplied=actual===op.digest&&op.action!=='refresh';
  if(this.options.verifyOnly){if(actual!==op.digest)throw Error('Independent verification: expected ledger digest is missing');return true;}
  if(actual===op.digest&&op.action!=='refresh'){
   if(!ctx.dryRun){await this.business.verifyReplay(ctx);return false;}
   return true;
  }
  if(actual!==(op.previousDigest??null))throw Error('Sync checkpoint changed; requalify actual database');
  // Qualification computed every mapped target from this frozen source. A
  // refresh already matching that result needs no repeated business writes.
  // Re-read and lock all captured targets; drift since qualification still
  // fails verification instead of being silently skipped.
  if(!ctx.dryRun&&op.action==='refresh'&&actual===op.digest&&this.business.canReplayCurrent()){
   await this.business.verifyReplay(ctx);this.unchangedRefreshes=(this.unchangedRefreshes||0)+1;return false;
  }
  const proofKeys=this.plan.lineageInput?.selectedProofKeys||[];
  const lineageKey=op.action==='insert'&&proofKeys.length?require('./sync_lineage').candidateKey(profile.id,op):null;
  if(lineageKey&&proofKeys.includes(lineageKey)){
   if(!this.options.lineageInputs)throw Error('Reviewed insert has no live lineage-input connection');
   if(!ctx.dryRun)await this.options.lineageInputs.beforeInsert(ctx,profile,op);
   else this.options.lineageInputs.assertCurrent();
  }
  return true;
 }
 captureTarget(ctx,table,data,keys,directionScope,sourceScope){return this.business.capture(ctx,table,data,keys,directionScope,sourceScope);}
 beforeMutation(ctx,action,table,data,where){return this.business.beforeMutation(ctx,action,table,data,where);}
 async verifyInserted(ctx,table,data,id){
  const safety=require('./sync_write_safety');
  const keys=await safety.primaryKeys(ctx,table);
  const where=keys.length===1&&keys[0]==='id'&&id?{id}:this.business.lastMutation?.where;
  if(!where||this.business.lastMutation?.table!==table)throw Error('Inserted target lacks a verified selector');
  await safety.assertMappedValues(ctx,table,where,data);
 }
 exportBusinessPreimages(){return this.business.export();}
 async finish(ctx,profile){
  this.business.finish();if(ctx.dryRun)return;
  const r=ctx.syncOperation;
  await ctx.conn.query('INSERT INTO sheets_sync_events (profile,source_uid,group_key,digest,dispo,match_hash) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE group_key=VALUES(group_key),digest=VALUES(digest),dispo=VALUES(dispo),match_hash=VALUES(match_hash),updated_at=CURRENT_TIMESTAMP',[profile.id,r.uid,r.group,r.digest,r.dispo||'',r.matchHash||null]);
  if(r.yarnIdentity)await ctx.conn.query('UPDATE sheets_sync_events SET yarn_identity=? WHERE profile=? AND source_uid=? AND digest=?',[JSON.stringify(r.yarnIdentity),profile.id,r.uid,r.digest]);
 }
}
module.exports={SheetsSyncRuntime};
