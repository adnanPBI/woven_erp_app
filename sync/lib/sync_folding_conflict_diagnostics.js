'use strict';
// Read-only diagnostics for existing Folding movements whose Dispo prefix was
// revised in the source. NEVER approves a reassignment or changes business rows.
const path=require('path');
const {iterateCsvRows,dedupeHeaders}=require('./csv_stream');
const {fingerprint,hash}=require('./sheets_sync_plan');
const {prefixOnly}=require('./sync_prefix_edits');
const norm=x=>String(x??'').trim().toLowerCase();

async function diagnoseFoldingConflicts(plan,{connection,csvDir,profileSpec}={}){
 if(!plan||!Array.isArray(plan.conflicts))throw Error('Invalid Folding diagnosis input');
 const conflicts=plan.conflicts.map(c=>({...c})),evidence=[];
 const relevant=conflicts.filter(c=>c.profile==='folding'&&c.reason==='ambiguous_edit_key_change_or_deletion'&&c.previousUnmatched===1&&c.currentUnmatched===0);
 if(!relevant.length)return {conflicts,evidence};
 if(!connection||!csvDir||!profileSpec||profileSpec.id!=='folding')throw Error('Folding diagnostic requires read-only production context');
 const insertions=(plan.operations?.folding||[]).filter(o=>o.action==='insert');
 const tasks=[];
 for(const conflict of relevant){
  const [ledger]=await connection.query('SELECT source_uid uid,group_key grp,digest,dispo FROM sheets_sync_events WHERE profile=? AND group_key=?',['folding',conflict.group]);
  if(ledger.length!==1){evidence.push({group:conflict.group,kind:'ledger_cardinality_unverified',count:ledger.length});continue;}
  const prior=ledger[0];
  const candidates=insertions.filter(o=>prefixOnly(prior.dispo,o.dispo));
  if(!candidates.length){
   // An existing, already written Folding parent is no longer represented
   // anywhere by its original source identity. This is a review case, never
   // permission to delete the parent or to waive the source missing alert.
   const [history]=await connection.query(
    'SELECT row_key,after_json FROM erp_sync_row_changes WHERE profile=? AND source_uid=? AND table_name=? AND action=? ORDER BY id DESC LIMIT 4',
    ['folding',prior.uid,'folding_production_form','added']);
   if(history.length!==1)continue;
   let id;try{id=JSON.parse(history[0].row_key)?.id}catch{}
   if(!Number.isSafeInteger(Number(id))||Number(id)<=0)continue;
   const [parents]=await connection.query('SELECT id,dispo_number,folding_production_date FROM folding_production_form WHERE id=?',[id]);
   if(parents.length!==1||norm(parents[0].dispo_number)!==norm(prior.dispo))continue;
   const [children]=await connection.query('SELECT id FROM folding_production_breakdown WHERE folding_production_id=?',[id]);
   const [currentSame]=await connection.query('SELECT source_uid FROM sheets_sync_events WHERE profile=? AND group_key=?',
     ['folding',conflict.group]);
   if(currentSame.length!==1)continue;
   Object.assign(conflict,{reason:'folding_historical_source_identity_missing_requires_exact_retention_review',
    sourceUid:prior.uid,previousDispo:prior.dispo,previousBusinessDate:parents[0].folding_production_date,
    originalParentId:Number(id),existingBreakdownCount:children.length,previousDigest:prior.digest,
    currentMatchingInsertCandidates:0,originalSqlRowsPreserved:true});
   evidence.push({group:conflict.group,sourceUid:prior.uid,reason:conflict.reason,
    priorDigest:prior.digest,oldDispo:prior.dispo,oldDate:parents[0].folding_production_date,
    parentId:Number(id),childIds:children.map(x=>Number(x.id)),sourceOldGroupMissing:true,
    currentNewInsertCandidates:0,operatorDecision:'RESTORE_SOURCE_OR_APPROVE_EXACT_HISTORICAL_RETENTION',
    writeAuthorized:false,noDeletionAuthorized:true});
   continue;
  }
  tasks.push({conflict,prior,candidates,proofs:[]});
 }
 if(!tasks.length)return {conflicts,evidence};
 const wanted=new Map();
 for(const task of tasks)for(const candidate of task.candidates){
  if(!wanted.has(candidate.rowNumber))wanted.set(candidate.rowNumber,[]);
  wanted.get(candidate.rowNumber).push({task,candidate});
 }
 let headers;
 for await(const row of iterateCsvRows(path.join(csvDir,profileSpec.source_file))){
  if(row.logicalRowNumber<=Number(profileSpec.header_row||0))continue;
  if(!headers){headers=dedupeHeaders(row.values);continue;}
  const waiting=wanted.get(row.logicalRowNumber);
  if(!waiting)continue;
  const pos=headers.indexOf('Dispo No');
  if(pos<0)throw Error('Missing Folding Dispo column in approved CSV');
  const raw=String(row.values[pos]??'');
  for(const {task,candidate} of waiting){
   if(norm(raw)!==norm(candidate.dispo)||fingerprint(headers,row.values,'folding')!==candidate.digest)continue;
   const suffix=raw.includes('/')?raw.slice(raw.indexOf('/')):'';
   const oldPrefix=task.prior.dispo.split('/')[0];
   const variants=new Set([task.prior.dispo,task.prior.dispo.toUpperCase(),oldPrefix.toUpperCase()+suffix,oldPrefix.toLowerCase()+suffix]);
   for(const substitute of variants){
    const changed=row.values.map((v,i)=>i===pos?substitute:v);
    if(fingerprint(headers,changed,'folding')===task.prior.digest){
     task.proofs.push({rowNumber:row.logicalRowNumber,newGroup:candidate.group,newDigest:candidate.digest,
      newDispo:candidate.dispo,businessDate:candidate.businessDate,
      oldGroup:task.prior.grp,oldDigest:task.prior.digest,changedFields:['Dispo No'],proof:'full-row-inverse-fingerprint'});
     break;
    }
   }
  }
 }
 for(const task of tasks){
  if(task.proofs.length!==1){
   evidence.push({group:task.conflict.group,kind:task.proofs.length?'multiple_fingerprint_candidates':'inverse_fingerprint_not_verified',
    candidateCount:task.proofs.length});
   continue;
  }
  const match=task.proofs[0];
  const [history]=await connection.query(
   'SELECT row_key,after_json FROM erp_sync_row_changes WHERE profile=? AND source_uid=? AND table_name=? AND action=? ORDER BY id DESC LIMIT 4',
   ['folding',task.prior.uid,'folding_production_form','added']);
  if(history.length!==1) {
   evidence.push({...match,kind:'prior_physical_target_unverified',historyRows:history.length});continue;
  }
  let id;try{id=JSON.parse(history[0].row_key)?.id}catch{}
  if(!Number.isSafeInteger(Number(id))||Number(id)<=0) {
   evidence.push({...match,kind:'prior_physical_identifier_invalid'});continue;
  }
  const [priorParent]=await connection.query('SELECT id,dispo_number,folding_production_date FROM folding_production_form WHERE id=?',[id]);
  if(priorParent.length!==1||norm(priorParent[0].dispo_number)!==norm(task.prior.dispo)||
    priorParent[0].folding_production_date!==match.businessDate){
   evidence.push({...match,kind:'prior_physical_target_drift'});continue;
  }
  const [child]=await connection.query('SELECT id FROM folding_production_breakdown WHERE folding_production_id=?',[id]);
  const [planMasters]=await connection.query('SELECT dispo_no,po_no FROM dispo_plan_form WHERE LOWER(TRIM(dispo_no))=?',[norm(match.newDispo)]);
  const [fullMasters]=await connection.query('SELECT dispo_number,po_no FROM dispo_form_data WHERE LOWER(TRIM(dispo_number))=?',[norm(match.newDispo)]);
  const [destination]=await connection.query('SELECT id FROM folding_production_form WHERE LOWER(TRIM(dispo_number))=? AND folding_production_date=?',[norm(match.newDispo),match.businessDate]);
  const [event]=await connection.query('SELECT source_uid FROM sheets_sync_events WHERE profile=? AND group_key=?',['folding',match.newGroup]);
  const unique=destination.length===0&&event.length===0;
  const reason=!(fullMasters.length===1&&planMasters.length===1)?
   'folding_dispo_reassignment_destination_master_missing':
   !unique?'folding_dispo_reassignment_target_occupied':
   'folding_dispo_reassignment_requires_exact_review';
  Object.assign(task.conflict,{reason,sourceUid:task.prior.uid,previousDispo:task.prior.dispo,
   currentDispo:match.newDispo,currentSourceRow:match.rowNumber,
   originalParentId:Number(id),existingBreakdownCount:child.length,
   destinationFullMasters:fullMasters.length,destinationPlanMasters:planMasters.length,
   destinationFoldingRows:destination.length,originalDigest:task.prior.digest,
   proposedDigest:match.newDigest,changeEvidence:match.proof});
  evidence.push({...match,reason,sourceUid:task.prior.uid,originalParentId:Number(id),
   existingBreakdownIds:child.map(c=>Number(c.id)),destinationFullMasters:fullMasters.length,
   destinationPlanMasters:planMasters.length,destinationFoldingRows:destination.length,
   destinationLedgerEvents:event.length,writeAuthorized:false,priorRowPreserved:true});
 }
 return {conflicts,evidence};
}
module.exports={diagnoseFoldingConflicts};
