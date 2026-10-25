'use strict';
const crypto = require('crypto');
const path = require('path');
const {iterateCsvRows, dedupeHeaders, isNonEmptyRow} = require('./csv_stream');
const {YARN_PROFILES, yarnIdentity} = require('./yarn_sync_identity');
const {matchYarn} = require('./yarn_sync_match');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Run/file/row-position metadata changes on every export and is not an event ID.
const metadata = new Set(['__MIG_SOURCE_UID', '__MIG_SOURCE_ROW', '__MIG_SOURCE_ROW_COUNT', '__MIG_ACTION', '__MIG_BRIDGE_SOURCE']);
const businessDateColumns={
 'pre-costing-bootstrap':'PO Issue Date',po:'PO Issue Date',dispo:'PO Received Date',
 'yarn-receive':'Received Date','yarn-issue':'Issue Date',warping:'Warping Date',
 sizing:'Sizing Date',loom:'Weaving Dates',folding:'Folding Production Date',
 'greige-delivery':'Delivery Date'
};
const identityColumns={
 'pre-costing-bootstrap':['PO NO'],po:['PO NO'],dispo:['Dispo No.'],
 'yarn-receive':['Yarn Count','Yarn brand','Yarn Lot','Received Date','Received GD NO','Challan No'],
 'yarn-issue':['Yarn Count','Yarn Lot','Issue Date','Dispo No','S/R/Challan No'],
 warping:['Dispo No','Warping Program No','Warping Date'],sizing:['Dispo No','Warping Program No','Sizing Date'],
 loom:['Dispo No','Weaving Dates'],folding:['Dispo No','Folding Production Date'],
 'greige-delivery':['Dispo No','Delivery Date','Challan No']
};
function fingerprintColumn(profile,header){
 return !metadata.has(header)&&!(profile==='folding'&&['Search Column','#REF!'].includes(header));
}
function fingerprint(headers, values, profile) {
  return hash(headers.map((h,i)=>[h,String(values[i]??'')]).filter(([h])=>fingerprintColumn(profile,h)));
}
async function inventory(csvDir, profiles) {
  const result = {};
  for (const profile of profiles) {
    const records = [], occurrences = new Map(); let headers;
    for await (const row of iterateCsvRows(path.join(csvDir,profile.source_file))) {
      if (row.logicalRowNumber <= Number(profile.header_row||0)) continue;
      if (!headers) { headers=dedupeHeaders(row.values); continue; }
      if (!isNonEmptyRow(row.values)) continue;
      const digest=fingerprint(headers,row.values,profile.id), n=(occurrences.get(digest)||0)+1;
      occurrences.set(digest,n);
      const columns=identityColumns[profile.id]||[];
      for(const column of columns)if(!headers.includes(column))throw Error('Missing identity column '+column+' for '+profile.id);
      const group=hash([profile.id,...columns.map(h=>String(row.values[headers.indexOf(h)]??'').trim().toLowerCase())]);
      const uid=String(row.values[headers.indexOf('__MIG_SOURCE_UID')]||'');
      // This cumulative date can change on multiple distinct receipts at once.
      // Keep an exact signature of every other field to distinguish those rows.
      const mutableMatchField={'yarn-receive':'Last Received Date','yarn-issue':'Delivery Place'}[profile.id];
      const matchHash=mutableMatchField?hash(headers.map((h,i)=>[h,String(row.values[i]??'')]).filter(([h])=>!metadata.has(h)&&h!==mutableMatchField)):null;
      const dispoHeader=['Dispo No.','Dispo No','Received GD NO','DISPO NUMBER'].find(h=>headers.includes(h));
      const dateField=businessDateColumns[profile.id];
      const dateIndex=dateField?headers.indexOf(dateField):-1;
      if(dateField&&dateIndex<0)throw Error('Missing business-date column '+dateField+' for '+profile.id);
      const businessDate=dateIndex<0?'':String(row.values[dateIndex]??'').trim();
      const amountFields=profile.id==='yarn-receive'?['Receipt Qty (Kgs)','Floor Return in kg']:profile.id==='yarn-issue'?['Out Side','Warp','Weft']:[];
      const amounts=amountFields.map(h=>{const raw=String(row.values[headers.indexOf(h)]??'').trim().replace(/,/g,'');return raw===''?null:Number(raw);});
      const entryAmounts=amounts.some(v=>v!==null)&&amounts.every(v=>v===null||Number.isFinite(v))?JSON.stringify(amounts):null;
      records.push({key:hash([profile.id,digest,n]),digest,group,uid,matchHash,entryAmounts,yarnIdentity:yarnIdentity(profile.id,headers,row.values),rowNumber:row.logicalRowNumber,businessDate,dispo:dispoHeader?String(row.values[headers.indexOf(dispoHeader)]||'').trim().toLowerCase():''});
    }
    if(!headers)throw Error('Missing certified headers: '+profile.id);
    result[profile.id]={headersHash:hash(headers.filter(h=>fingerprintColumn(profile.id,h))),records};
  }
  return result;
}
function compare(previous,current) {
  const profiles={},conflicts=[];let additions=0;
  for(const [profile,next]of Object.entries(current)) {
    const prior=previous[profile];
    if(!prior||prior.headersHash!==next.headersHash) {conflicts.push({profile,reason:'schema_changed_or_missing_baseline'});continue;}
    const oldKeys=new Set(prior.records.map(r=>r.key)), newKeys=new Set(next.records.map(r=>r.key));
    const missing=prior.records.filter(r=>!newKeys.has(r.key));
    const added=next.records.filter(r=>!oldKeys.has(r.key));
    profiles[profile]={added,missing,unchanged:next.records.length-added.length};
    additions+=added.length;
    if(missing.length)conflicts.push({profile,reason:'existing_rows_changed_or_removed',count:missing.length});
  }
  for(const profile of Object.keys(previous))if(!current[profile])conflicts.push({profile,reason:'source_profile_missing'});
  return {ok:conflicts.length===0,additions,profiles,conflicts};
}
function planEdits(previous,current, upstreamChanges = [], options = {}) {
 const operations={},conflicts=[],matched={};let added=0,updated=0,refreshed=0;
 for(const [profile,next]of Object.entries(current)){
  const prior=previous[profile];operations[profile]=[];matched[profile]=[];
  if(!prior||prior.headersHash!==next.headersHash){conflicts.push({profile,reason:'schema_changed'});continue;}
  if(YARN_PROFILES.has(profile)&&next.records.some(r=>r.yarnIdentity)){
   const yarn=matchYarn(prior,next);
   conflicts.push(...yarn.conflicts.map(c=>({profile,...c})));
   for(const [before,after]of yarn.pairs){
    const row={...after,uid:before.uid,previousDigest:before.digest,previousDispo:before.dispo};
    if(before.digest===after.digest)matched[profile].push(row);
    else{operations[profile].push({...row,action:'update'});updated++;}
   }
   for(const row of yarn.inserts){operations[profile].push({...row,uid:hash(['sync',profile,row.key]),previousDigest:null,action:'insert'});added++;}
   continue;
  }
  const oldGroups=new Map(),newGroups=new Map();
  for(const [records,map]of [[prior.records,oldGroups],[next.records,newGroups]])for(const row of records){if(!map.has(row.group))map.set(row.group,[]);map.get(row.group).push(row);}
  for(const group of new Set([...oldGroups.keys(),...newGroups.keys()])){
   const old=[...(oldGroups.get(group)||[])],fresh=[...(newGroups.get(group)||[])];
   for(let j=old.length-1;j>=0;j--){
    if(!old[j].reviewedDigest)continue;
    const candidates=fresh.filter(r=>r.digest===old[j].reviewedDigest);
    if(candidates.length!==1)throw Error('Reviewed correction is not unique within its destination group');
    operations[profile].push({...candidates[0],uid:old[j].uid,previousDigest:old[j].digest,previousDispo:old[j].dispo,action:'update'});updated++;
    fresh.splice(fresh.indexOf(candidates[0]),1);old.splice(j,1);
   }
   for(let i=0;i<fresh.length;){const j=old.findIndex(r=>r.digest===fresh[i].digest);if(j>=0){matched[profile].push({...fresh[i],uid:old[j].uid,previousDigest:old[j].digest});fresh.splice(i,1);old.splice(j,1);}else i++;}
   for(let i=fresh.length-1;i>=0;i--){
    const signature=fresh[i].matchHash;
    if(!signature||fresh.filter(r=>r.matchHash===signature).length!==1)continue;
    const candidates=old.filter(r=>r.matchHash===signature);
    if(candidates.length!==1)continue;
    operations[profile].push({...fresh[i],uid:candidates[0].uid,previousDigest:candidates[0].digest,previousDispo:candidates[0].dispo,action:'update'});updated++;
    old.splice(old.indexOf(candidates[0]),1);fresh.splice(i,1);
   }
   if(old.length===1&&fresh.length===1){operations[profile].push({...fresh[0],uid:old[0].uid,previousDigest:old[0].digest,previousDispo:old[0].dispo,action:'update'});updated++;}
   else if(old.length===0){for(const r of fresh){operations[profile].push({...r,uid:hash(['sync',profile,r.key]),previousDigest:null,action:'insert'});added++;}}
   else conflicts.push({profile,group,reason:'ambiguous_edit_key_change_or_deletion',previousUnmatched:old.length,currentUnmatched:fresh.length});
  }
 }
 for(const profile of Object.keys(previous))if(!current[profile])conflicts.push({profile,reason:'source_profile_missing'});
 const order=['pre-costing-bootstrap','po','dispo','yarn-receive','yarn-issue','warping','sizing','loom','folding','greige-delivery'];
 const affected=new Map(upstreamChanges);
 for(const [profile,rows]of Object.entries(operations))for(const r of rows)for(const dispo of [r.dispo,r.previousDispo])if(dispo)affected.set(dispo,Math.min(affected.get(dispo)??99,order.indexOf(profile)));
 const refreshLots=new Set(options.refreshLots||[]);
 for(const [profile,rows]of Object.entries(matched))for(const r of rows){
  const lot=profile==='yarn-issue'?require('./source_index').normalizeYarnLotIdentity(r.yarnIdentity?.lot):'';
  if(options.refreshAll||(lot&&refreshLots.has(lot))||(r.dispo&&affected.has(r.dispo)&&order.indexOf(profile)>affected.get(r.dispo))){operations[profile].push({...r,action:'refresh'});refreshed++;}
 }
 // Freeze the source cohort for shared references. This permits a new audit
 // entry to coexist with a peer's proven provenance target, even when the
 // physical payload is identical. Unknown/unbound targets remain collisions.
 for(const [profile,rows]of Object.entries(operations)){
  if(!YARN_PROFILES.has(profile)||!rows.length)continue;
  const wantedGroups=new Set(rows.map(r=>r.group));
  const grouped=new Map();
  for(const cohort of [matched[profile]||[],rows])for(const r of cohort){if(!wantedGroups.has(r.group))continue;if(!grouped.has(r.group))grouped.set(r.group,new Map());grouped.get(r.group).set(r.uid,{uid:r.uid,digest:r.digest,previousDigest:r.previousDigest??null});}
  for(const r of rows){const peers=[...(grouped.get(r.group)?.values()||[])];if(peers.length>1)r.peerSources=peers;}
 }
 return {ok:conflicts.length===0,added,updated,refreshed,operations,conflicts};
}
function applyReviewedReassignments(profile,previous,current,reviews){
 for(const review of reviews.filter(r=>r.profile===profile)){
  const old=previous.records.find(r=>r.uid===review.sourceUid);
  if(!old&&review.introducedAfterBaseline===true)continue;
  if(!old)throw Error('Reviewed source UID not found: '+profile);
  const approvedDigests=[review.oldDigest,...(review.previousApprovedDigests||[])];
  if(review.action==='superseded-revision'){
   const {eventKey,parseIdentity}=require('./yarn_sync_identity');
   const identity=parseIdentity(old.yarnIdentity);
   const complete=identity&&['dispo','count','lot','direction','date','challan'].every(k=>identity[k]&&!/^(?:n\/?a|none|null|unknown|-)$/i.test(identity[k]));
   const key=complete?eventKey(identity):null;
   const selected=current.records.filter(r=>eventKey(r.yarnIdentity)===key);
   if(!key||key!==review.eventKey||old.group!==review.oldGroup||!approvedDigests.includes(old.digest)||
      selected.length!==1||!review.businessNeutralized||!review.evidenceFile||
      !previous.records.some(r=>r.uid===review.survivorUid&&eventKey(r.yarnIdentity)===key))
    throw Error('Superseded revision evidence is stale or ambiguous: '+profile);
   previous.records=previous.records.filter(r=>r.uid!==review.sourceUid);
   continue;
  }
  if(review.action==='retain-missing'){
   // Explicitly reviewed source removals retain ERP business rows. If the key
   // reappears, normal matching resumes instead of silently ignoring its edit.
   if(current.records.some(r=>r.group===old.group))continue;
   if(old.group!==review.oldGroup||!approvedDigests.includes(old.digest))throw Error('Reviewed removal evidence is stale: '+profile);
   previous.records=previous.records.filter(r=>r.uid!==review.sourceUid);
   continue;
  }
  // A reviewed split can keep the same natural key. Bind its exact destination
  // fingerprint once, then let subsequent edits use normal tracked matching.
  if(old.group===review.newGroup&&(review.oldGroup!==review.newGroup||!approvedDigests.includes(old.digest)))continue;
  const candidate=current.records.filter(r=>r.group===review.newGroup&&r.digest===review.newDigest);
  if(old.group!==review.oldGroup||!approvedDigests.includes(old.digest)||candidate.length!==1)throw Error('Reviewed reassignment is stale or ambiguous: '+profile);
  if(current.records.some(r=>r.group===review.oldGroup&&r.digest===review.oldDigest))throw Error('Original receipt still exists; refusing reassignment');
  old.group=review.newGroup;
  old.reviewedDigest=review.newDigest;
 }
 return previous;
}
module.exports={fingerprint,fingerprintColumn,inventory,compare,planEdits,hash,applyReviewedReassignments};
