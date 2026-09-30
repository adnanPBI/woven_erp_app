'use strict';
const {fingerprint,hash}=require('./sheets_sync_plan');
class SheetsSyncRuntime {
 constructor(plan,protectedMasters,manifestHash){
  if(!plan.ok)throw Error('Conflicted sync plan cannot run');
  this.plan=plan;this.hash=hash({plan,manifestHash});this.manifestHash=manifestHash;
  this.protectedMasters=protectedMasters;
  this.selected=new Map(Object.entries(plan.operations).map(([p,rows])=>[p,new Map(rows.map(r=>[r.rowNumber,r]))]));
 }
 has(profile,row){return this.selected.get(profile)?.has(row)||false;}
 async initialize(ctx){
  if(ctx.sourceManifestFileSha256!==this.manifestHash)throw Error('Sync manifest changed');
  ctx.localRetainedMasters=Object.fromEntries(Object.entries(this.protectedMasters).map(([t,s])=>[t,{key:s.key,values:new Set(s.values)}]));
 }
 async begin(ctx,profile,fileInfo,values){
  const operation=this.selected.get(profile.id)?.get(ctx.currentSourceRowNumber);
  if(!operation||fingerprint(fileInfo.headers,values)!==operation.digest)throw Error('Sync source row differs from planned row');
  ctx.syncOperation=operation;
  const [rows]=await (ctx.conn||ctx.pool).query('SELECT digest FROM sheets_sync_events WHERE profile=? AND source_uid=?'+(ctx.dryRun?'':' FOR UPDATE'),[profile.id,operation.uid]);
  const actual=rows[0]?.digest||null;
  if(actual===operation.digest&&operation.action!=='refresh')return false; // Previous attempt committed before interruption.
  if(actual!==operation.previousDigest)throw Error('Sync checkpoint changed; rebuild plan');
  return true;
 }
 async finish(ctx,profile){
  if(ctx.dryRun)return;
  const r=ctx.syncOperation;
  await ctx.conn.query('INSERT INTO sheets_sync_events (profile,source_uid,group_key,digest,dispo,match_hash) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE group_key=VALUES(group_key),digest=VALUES(digest),dispo=VALUES(dispo),match_hash=VALUES(match_hash),updated_at=CURRENT_TIMESTAMP',[profile.id,r.uid,r.group,r.digest,r.dispo||'',r.matchHash||null]);
 }
}
module.exports={SheetsSyncRuntime};
