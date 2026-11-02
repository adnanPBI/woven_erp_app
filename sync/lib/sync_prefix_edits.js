'use strict';
// Owner-authorized edits of a movement's factory prefix. The complete Dispo
// remains its real identity everywhere else; this is deliberately not a global
// suffix matcher. Only numeric provenance parents support this transition.
const crypto=require('crypto'),path=require('path');
const {iterateCsvRows,dedupeHeaders}=require('./csv_stream');
const {parseIdentity}=require('./yarn_sync_identity');
const headersByProfile={'yarn-receive':'Received GD NO','yarn-issue':'Dispo No',warping:'Dispo No',sizing:'Dispo No','greige-delivery':'Dispo No'};
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const normalized=x=>String(x??'').trim().toLowerCase();
function parts(value){const m=/^(nh|yt|sw|sc)\/(\S+(?:\/\S+)*)$/i.exec(String(value??'').trim());return m?{prefix:m[1].toLowerCase(),body:m[2].toLowerCase()}:null;}
function prefixOnly(a,b){a=parts(a);b=parts(b);return !!(a&&b&&a.prefix!==b.prefix&&a.body===b.body);}
function prefixFingerprint(profile,headers,values){
 const field=headersByProfile[profile];if(!field)return null;
 const dispo=parts(values[headers.indexOf(field)]);if(!dispo)return null;
 // Audit timestamps and generated display/search fields aren't business data.
 // Every other field (including dates, quantities, factory, lot and notes) is
 // exact. Even leading zeros and all components after the prefix are retained.
 const ignored=new Set(['Created By','Last Modified Date','Search Column','Stock Column','Count ID']);
 return sha(headers.map((h,i)=>{
  let v=String(values[i]??'');
  if(h===field||(profile==='yarn-issue'&&h==='Received Start Date'&&parts(v)?.body===dispo.body))v='[prefix]/'+dispo.body;
  return [h,v];
 }).filter(([h])=>!h.startsWith('__MIG_')&&!ignored.has(h)));
}
function metadata(row){return parseIdentity(row.yarnIdentity)||{version:1};}
async function backfillSignatures(connection,profile,previous,current){
 if(!headersByProfile[profile])return;
 const exact=new Map();for(const r of current.records)if(r.prefixMatchHash)exact.set(r.group+'|'+r.digest,r.prefixMatchHash);
 const selected=[];
 for(const r of previous.records){const signature=exact.get(r.group+'|'+r.digest);if(!signature||metadata(r).prefixMatchHash===signature)continue;r.yarnIdentity={...metadata(r),prefixMatchHash:signature};selected.push(r);}
 if(!selected.length)return;
 await connection.beginTransaction();try{
  for(const r of selected)await connection.query('UPDATE sheets_sync_events SET yarn_identity=? WHERE profile=? AND source_uid=? AND group_key=? AND digest=?',[JSON.stringify(r.yarnIdentity),profile,r.uid,r.group,r.digest]);
  await connection.commit();
 }catch(e){await connection.rollback();throw e;}
}
async function qualifyPrefixEdits(profile,previous,current,{csvDir,profileSpec,fullCurrent=current,fullPrevious=previous}={}){
 if(!headersByProfile[profile])return previous;
 const fullGroups=fullCurrent.fullGroups||new Set(fullCurrent.records.map(r=>r.group)),occupied=new Set(fullPrevious.records.map(r=>r.group));
 const fresh=current.records.filter(r=>r.prefixMatchHash&&!occupied.has(r.group));
 const candidates=previous.records.filter(r=>!r.reviewedDigest&&!fullGroups.has(r.group)&&fresh.some(n=>prefixOnly(r.dispo,n.dispo)));
 if(!candidates.length)return previous;
 const proofs=new Map();
 for(const old of candidates)for(const next of fresh)if(prefixOnly(old.dispo,next.dispo)&&metadata(old).prefixMatchHash===next.prefixMatchHash){proofs.set(old.uid+'|'+next.rowNumber,'business-signature');}
 // Upgrade legacy events only if reversing the prefix reproduces the ENTIRE
 // stored SHA256. Row position, amount alone and the regenerated source UID
 // never qualify an edit. Retain only candidate records while streaming CSV.
 const legacy=candidates.filter(r=>!metadata(r).prefixMatchHash);
 if(legacy.length&&csvDir&&profileSpec){
  const wanted=new Map(fresh.map(r=>[r.rowNumber,r]));let headers;
  for await(const row of iterateCsvRows(path.join(csvDir,profileSpec.source_file))){
   if(row.logicalRowNumber<=Number(profileSpec.header_row||0))continue;
   if(!headers){headers=dedupeHeaders(row.values);continue;}
   const next=wanted.get(row.logicalRowNumber);if(!next)continue;
   const index=headers.indexOf(headersByProfile[profile]),raw=String(row.values[index]??'');
   for(const old of legacy){if(!prefixOnly(old.dispo,next.dispo))continue;
    const variants=new Set([old.dispo,String(old.dispo).toUpperCase(),parts(old.dispo).prefix.toUpperCase()+'/'+raw.split('/').slice(1).join('/')]);
    for(const value of variants){const values=row.values.map((v,i)=>i===index?value:(headers[i]==='Search Column'?String(v).split(raw).join(value):profile==='yarn-issue'&&headers[i]==='Received Start Date'&&normalized(v)===normalized(raw)?value:v));
     if(require('./sheets_sync_plan').fingerprint(headers,values,profile)===old.digest)proofs.set(old.uid+'|'+next.rowNumber,'full-inverse');
    }
   }
  }
 }
 const accepted=new Map();
 for(const old of candidates){
  const matches=fresh.filter(n=>proofs.has(old.uid+'|'+n.rowNumber));
  if(matches.length!==1)continue;const next=matches[0];
  if(candidates.filter(r=>proofs.has(r.uid+'|'+next.rowNumber)).length!==1)continue;
  accepted.set(old.uid,{...old,group:next.group,reviewedDigest:next.digest,prefixChange:{version:1,policy:'latest-source-prefix-v1',oldDispo:old.dispo,newDispo:next.dispo,oldDigest:old.digest,matchHash:next.prefixMatchHash,proof:proofs.get(old.uid+'|'+next.rowNumber)}});
 }
 return {...previous,records:previous.records.map(r=>accepted.get(r.uid)||r)};
}
function validatePrefixOperation(profile,op,env=process.env){
 const p=op.prefixChange;if(!p)return;
 if(env.SYNC_ACCEPT_DISPO_PREFIX_EDITS!=='true'||!headersByProfile[profile]||op.action!=='update'||p.version!==1||p.policy!=='latest-source-prefix-v1'||!['business-signature','full-inverse'].includes(p.proof)||!prefixOnly(p.oldDispo,p.newDispo)||normalized(p.oldDispo)!==normalized(op.previousDispo)||normalized(p.newDispo)!==normalized(op.dispo)||p.oldDigest!==op.previousDigest||!/^[a-f0-9]{64}$/.test(p.matchHash)||p.matchHash!==op.prefixMatchHash)throw Error('Unqualified or disabled Dispo prefix edit');
}
module.exports={parts,prefixOnly,prefixFingerprint,backfillSignatures,qualifyPrefixEdits,validatePrefixOperation};
