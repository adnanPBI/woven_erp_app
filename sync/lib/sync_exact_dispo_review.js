'use strict';
// Read-only operator qualification, NEVER an automatic matching fallback.
// A row position or matching quantity alone cannot authorize moving an issue.
// The complete old fingerprint, one provenance target and unique new source
// must agree. Callers preserve this proof privately and use the normal reviewed
// plan/dry/preimage/backup/apply path; this function writes nothing.
const {fingerprint,hash}=require('./sheets_sync_plan');
const normalized=v=>String(v??'').trim().toLowerCase();
function qualifyExactDispoReview({profile,ledger,provenance,targetDispo,headers,rows,destinationEvents=[]}){
 const fail=message=>{throw Error('Exact Dispo review: '+message);};
 if(profile!=='yarn-issue'||!ledger?.uid||!ledger.digest||!ledger.group||!ledger.dispo)fail('complete original issue required');
 if(!provenance||provenance.profile!==profile||provenance.source_uid!==ledger.uid||provenance.target_table!=='yarn_issue_form'||!/^\d+$/.test(String(provenance.target_primary_key))||normalized(targetDispo)!==normalized(ledger.dispo))fail('provenance or physical Dispo mismatch');
 const required=['Yarn Count','Yarn Lot','Issue Date','Dispo No','S/R/Challan No'];
 if(!Array.isArray(headers)||required.some(h=>!headers.includes(h))||!Array.isArray(rows))fail('complete source fields required');
 const field=(row,h)=>String(row.values[headers.indexOf(h)]??'');
 const group=row=>hash([profile,...required.map(h=>normalized(field(row,h)))]);
 if(rows.some(row=>group(row)===ledger.group))fail('original event still present');
 const candidates=[];
 for(const row of rows){
  const dispo=field(row,'Dispo No');
  if(normalized(dispo)===normalized(targetDispo)||!/^[-A-Za-z0-9_]+(?:\/[-A-Za-z0-9_]+){2,}$/.test(dispo))continue;
  const before=row.values.map((value,i)=>['Dispo No','Search Column'].includes(headers[i])?String(value??'').split(dispo).join(targetDispo):value);
  if(fingerprint(headers,before,profile)!==ledger.digest)continue;
  candidates.push({row,dispo,digest:fingerprint(headers,row.values,profile),group:group(row),changedFields:headers.filter((h,i)=>String(before[i]??'')!==String(row.values[i]??''))});
 }
 if(candidates.length!==1)fail('old fingerprint must identify exactly one corrected source record');
 const c=candidates[0];
 if(rows.filter(r=>group(r)===c.group).length!==1||destinationEvents.some(e=>e.group===c.group))fail('destination is not unique or is already tracked');
 return {review:{profile,sourceUid:ledger.uid,oldGroup:ledger.group,oldDigest:ledger.digest,newGroup:c.group,newDigest:c.digest,reason:'Full original fingerprint reproduced by reversing only the Dispo and its derived search helper; one existing provenance target. Preserve source binding and parent ID.'},proof:{targetTable:'yarn_issue_form',targetPrimaryKey:String(provenance.target_primary_key),oldDispo:targetDispo,newDispo:c.dispo,changedFields:c.changedFields,currentSourceRow:c.row.rowNumber,inverseDigest:ledger.digest}};
}
module.exports={qualifyExactDispoReview};
