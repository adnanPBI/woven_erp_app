'use strict';
// One-field in-place Yarn Issue Dispo reallocation. Never infers a movement
// from row position or a generated __MIG_SOURCE_UID. Never edits SQL itself.
const path=require('path');
const {iterateCsvRows,dedupeHeaders}=require('./csv_stream');
const {fingerprint}=require('./sheets_sync_plan');
const {parseIdentity}=require('./yarn_sync_identity');
const normal=x=>String(x??'').trim().toLowerCase();
const numeric=x=>Number(String(x??'0').replace(/,/g,''));
const bad=x=>!x||/^(n\/a|none|null|unknown|-)$/i.test(x);
function sameParentPath(a,b){
 const x=normal(a).split('/'),y=normal(b).split('/');
 return x.length===y.length&&x.length>=4&&
 x.slice(0,-1).every((part,i)=>part===y[i])&&x[x.length-1]!==y[y.length-1];
}
function lineage(row){
 const y=parseIdentity(row.yarnIdentity);
 if(!y||['challan','date','count','lot'].some(k=>bad(y[k])))return null;
 if(!['','warp','weft'].includes(y.direction))return null;
 return JSON.stringify([y.challan,y.date,y.count,y.lot,y.direction]);
}
async function qualifySamePoYarnDispoEdits(profile,previous,current,opts={}){
 if(profile!=='yarn-issue')return previous;
 const {connection,csvDir,profileSpec,fullPrevious=previous,fullCurrent=current,sourceManifestSha256}=opts;
 if(!connection||!csvDir||profileSpec?.id!=='yarn-issue'||!/^[a-f0-9]{64}$/.test(sourceManifestSha256||''))throw Error('Exact Dispo qualifier requires bound certified source and SQL');
 const oldGroups=new Set(fullPrevious.records.map(r=>r.group));
 const newGroups=new Set(fullCurrent.records.map(r=>r.group));
 const oldRows=previous.records.filter(r=>!r.reviewedDigest&&!r.prefixChange&&!newGroups.has(r.group));
 const freshRows=current.records.filter(r=>!oldGroups.has(r.group)&&r.prefixMatchHash);
 const grouped=rows=>{
  const m=new Map();
  for(const r of rows){const k=lineage(r);if(!k)continue;if(!m.has(k))m.set(k,[]);m.get(k).push(r);}
  return m;
 };
 const fullOld=grouped(fullPrevious.records),fullNew=grouped(fullCurrent.records);
 const freshIndex=grouped(freshRows),want=new Map();
 for(const old of oldRows){
  const key=lineage(old),next=freshIndex.get(key)||[];
  if(!key||next.length!==1||fullOld.get(key)?.length!==1||fullNew.get(key)?.length!==1)continue;
  const candidate=next[0];
  if(!sameParentPath(old.dispo,candidate.dispo)||normal(old.dispo)===normal(candidate.dispo)||
    !old.digest||!candidate.digest||!candidate.entryAmounts||!old.yarnIdentity||!candidate.yarnIdentity)continue;
  if(!want.has(candidate.rowNumber))want.set(candidate.rowNumber,[]);
  want.get(candidate.rowNumber).push({old,next:candidate});
 }
 if(want.size>80)throw Error('Too many simultaneous unqualified Dispo reassignments');
 if(!want.size)return previous;
 const proved=[];let headers;
 for await(const row of iterateCsvRows(path.join(csvDir,profileSpec.source_file))){
  if(row.logicalRowNumber<=Number(profileSpec.header_row||0))continue;
  if(!headers){headers=dedupeHeaders(row.values);continue;}
  const found=want.get(row.logicalRowNumber);if(!found)continue;
  const i=headers.indexOf('Dispo No'),j=headers.indexOf('Search Column');
  if(i<0||j<0)throw Error('Dispo inverse source columns absent');
  const newValue=String(row.values[i]??'');
  for(const {old,next} of found){
   if(normal(newValue)!==normal(next.dispo)||fingerprint(headers,row.values,'yarn-issue')!==next.digest)continue;
   const oldValue=old.dispo;
   const variations=[oldValue,oldValue.toUpperCase(),oldValue.toLowerCase()];
   for(const value of variations){
    const altered=row.values.map((v,k)=>k===i?value:k===j?String(v??'').split(newValue).join(value):v);
    if(fingerprint(headers,altered,'yarn-issue')===old.digest){
     proved.push({old,next,changed:['Dispo No','Search Column'],oldValue:value});break;
    }
   }
  }
 }
 const oldCount=new Map(),newCount=new Map();
 for(const p of proved){oldCount.set(p.old.uid,(oldCount.get(p.old.uid)||0)+1);newCount.set(p.next.rowNumber,(newCount.get(p.next.rowNumber)||0)+1);}
 const accepted=new Map();
 for(const p of proved){
  const {old,next}=p;
  if(oldCount.get(old.uid)!==1||newCount.get(next.rowNumber)!==1)continue;
  const y=parseIdentity(old.yarnIdentity),v=parseIdentity(next.yarnIdentity);
  if(['count','lot','date','challan','direction'].some(k=>y[k]!==v[k]))continue;
  let entry;try{entry=JSON.parse(next.entryAmounts);}catch{continue;}
  if(!Array.isArray(entry)||entry.length!==3||entry.filter(x=>x!==null&&Number.isFinite(x)&&x>0).length!==1||
    entry.some(x=>x!==null&&(!Number.isFinite(x)||x<0)))continue;
  const [links]=await connection.query('SELECT target_table,target_primary_key,source_row_number FROM migration_import_provenance WHERE profile=? AND source_uid=?',
   [profile,old.uid]);
  if(links.length!==1||links[0].target_table!=='yarn_issue_form'||!/^[1-9]\d*$/.test(String(links[0].target_primary_key)))continue;
  const id=Number(links[0].target_primary_key);
  const [forms]=await connection.query('SELECT * FROM yarn_issue_form WHERE id=?',[id]);
  const [children]=await connection.query('SELECT * FROM yarn_issue_details WHERE yarn_issue_form_id=?',[id]);
  if(forms.length!==1||children.length!==1||!Number.isSafeInteger(id))continue;
  const form=forms[0],child=children[0];
  if(normal(form.issue_challan_no)!==y.challan||normal(form.yarn_count)!==y.count||normal(form.yarn_lot)!==y.lot||
    normal(form.received_against_dispo_nos)!==normal(old.dispo)||normal(child.dispo_number)!==normal(old.dispo)||
    normal(child.issue_date)!==y.date||normal(form.issue_date)!==y.date||Number(child.yarn_issue_form_id)!==id)continue;
  const original=[numeric(form.outside_issue_kg),numeric(form.total_warp_issue_kgs),numeric(form.total_weft_issue_kgs)];
  if(original.some((x,i)=>!Number.isFinite(x)||x!==(entry[i]??0))||
    numeric(child.issued_quantity)!==original.reduce((a,b)=>a+b,0))continue;
  const [masters]=await connection.query('SELECT dispo_number,po_no FROM dispo_form_data WHERE LOWER(TRIM(dispo_number)) IN (?,?)',
    [normal(old.dispo),normal(next.dispo)]);
  const [plans]=await connection.query('SELECT dispo_no,po_no FROM dispo_plan_form WHERE LOWER(TRIM(dispo_no)) IN (?,?)',
    [normal(old.dispo),normal(next.dispo)]);
  if(masters.length!==2||plans.length!==2||
    new Set(masters.map(r=>normal(r.dispo_number))).size!==2||
    new Set(plans.map(r=>normal(r.dispo_no))).size!==2)continue;
  const pos=new Set([...masters,...plans].map(x=>normal(x.po_no)));
  if(pos.size!==1||bad([...pos][0])||normal(form.received_against_po_no)!==[...pos][0])continue;
  const [targetEvents]=await connection.query('SELECT source_uid FROM sheets_sync_events WHERE profile=? AND group_key=?',
    [profile,next.group]);
  const [targetPhysical]=await connection.query('SELECT d.id FROM yarn_issue_details d JOIN yarn_issue_form f ON f.id=d.yarn_issue_form_id WHERE LOWER(TRIM(d.dispo_number))=? AND d.issue_date=? AND LOWER(TRIM(f.issue_challan_no))=? LIMIT 3',
    [normal(next.dispo),y.date,y.challan]);
  if(targetEvents.length||targetPhysical.length)continue;
  const change={version:2,policy:'source-full-inverse-same-po-v1',proof:'full-inverse',
    oldDispo:old.dispo,newDispo:next.dispo,oldGroup:old.group,oldDigest:old.digest,
    newGroup:next.group,newDigest:next.digest,matchHash:next.prefixMatchHash,
    targetParentId:id,targetChildId:Number(child.id),sourceRow:next.rowNumber,
    sourceManifestSha256,poNo:[...pos][0]};
  accepted.set(old.uid,{...old,group:next.group,reviewedDigest:next.digest,prefixChange:change});
 }
 return {...previous,records:previous.records.map(r=>accepted.get(r.uid)||r)};
}
module.exports={sameParentPath,lineage,qualifySamePoYarnDispoEdits};
