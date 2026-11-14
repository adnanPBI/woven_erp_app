'use strict';
/**
 * Five exact owner-approved Dispo plan->full promotions, including recovery.
 * A promotion grant is emitted ONLY for an uncommitted, exact original
 * transition. Already-existing full parents use normal importer guards.
 * No SQL writes, no approval reuse for later ordinary edits.
 */
const fs=require('fs');
const {pathToFileURL}=require('url');
function createPolicy(config={}) {
const {receiptFile:RECEIPT,requestFile:REQUEST,approverModule:APPROVER,requestSha256:EXPECTED_SHA}=config;
const sha=x=>require('crypto').createHash('sha256').update(x).digest('hex');
const norm=x=>String(x??'').trim().toLowerCase();
const refusal=reason=>{const e=new Error('SYNC_DISPO_FIVE_REFUSED: '+reason);e.code='SYNC_DISPO_FIVE_REFUSED';throw e;};
function expectedRequest(){
 const raw=fs.readFileSync(REQUEST);
 if(sha(raw)!==EXPECTED_SHA)refusal('Exact five-Dispo approval request evidence changed');
 const p=JSON.parse(raw);
 if(p.database!=='weavonpq_weaving_main'||p.status!=='PENDING_AUTH0_OWNER_APPROVAL_AND_REHEARSAL'||
    p.writeAuthorized!==false||p.dispo?.count!==5||!Array.isArray(p.dispo.sourceRows)||
    p.dispo.sourceRows.length!==5||new Set(p.dispo.sourceRows.map(x=>x.sourceUid)).size!==5)
   refusal('Five-item approval scope mismatch');
 return p;
}
function exactPromotion(op,row){
 return !!op&&op.action==='update'&&op.uid===row.sourceUid&&
   op.dispo===row.dispo&&op.previousDispo===row.dispo&&
   op.previousDigest===row.oldDigest&&op.digest===row.newDigest&&
   op.group===row.identityGroup&&Number.isSafeInteger(op.rowNumber);
}
function grant(op,row){
 return {sourceUid:op.uid,sourceRow:op.rowNumber,dispo:row.dispo,
  identityGroup:op.group,previousDigest:row.oldDigest,proposedDigest:row.newDigest,ownerVerified:true};
}
function validatePlan(plan){
 if(!plan.ok||plan.conflicts?.length||plan.manualSkips?.skippedCurrentRows!==5)
   refusal('Plan conflicts or owner-authorized source skips changed');
}
function select(plan,p){ // Legacy exact-first-apply selector; never use for ordinary edits.
 validatePlan(plan);
 const operations=plan.operations?.dispo||[],map=new Map();
 for(const row of p.dispo.sourceRows){
  const matches=operations.filter(x=>x.uid===row.sourceUid);
  if(matches.length!==1||!exactPromotion(matches[0],row))
   refusal('Original approval transition is not exact: '+row.dispo);
  map.set(row.sourceUid,grant(matches[0],row));
 }
 return map;
}
async function readState(connection,row){
 const [ledger]=await connection.query(
  'SELECT digest,group_key FROM sheets_sync_events WHERE profile=? AND source_uid=?',
  ['dispo',row.sourceUid]);
 if(ledger.length!==1||ledger[0].group_key!==row.identityGroup)
   refusal('Missing, duplicated or changed source identity: '+row.dispo);
 const [plans]=await connection.query(
  'SELECT dispo_no,po_no FROM dispo_plan_form WHERE LOWER(TRIM(dispo_no))=? LIMIT 3',
  [row.dispo]);
 if(plans.length!==1||norm(plans[0].dispo_no)!==row.dispo)
   refusal('Missing or duplicate plan master: '+row.dispo);
 const [full]=await connection.query(
  'SELECT dispo_number FROM dispo_form_data WHERE LOWER(TRIM(dispo_number))=? LIMIT 3',
  [row.dispo]);
 if(full.length>1||full.some(x=>norm(x.dispo_number)!==row.dispo))
   refusal('Duplicated or mismatched full master: '+row.dispo);
 // Ledger + physical state must agree: an original ledger cannot coexist
 // with a full parent; a later ledger cannot point at a missing full parent.
 if(ledger[0].digest===row.oldDigest){
  if(full.length||plans[0].po_no!==null)
   refusal('Partially committed promotion: old ledger with full/PO master '+row.dispo);
  return {kind:'pending',digest:ledger[0].digest};
 }
 if(!full.length||plans[0].po_no===null)
   refusal('Applied/edited ledger but missing full master or PO '+row.dispo);
 return {kind:'full',digest:ledger[0].digest};
}
async function inspect(plan,p,connection){
 validatePlan(plan);
 const [[db]]=await connection.query('SELECT DATABASE() db,@@hostname host');
 if(db.db!=='weavonpq_weaving_main'||db.host!=='server905.web-hosting.com')
   refusal('Wrong physical production database');
 const operations=plan.operations?.dispo||[];
 const matched=new Map(),pending=new Map();
 for(const row of p.dispo.sourceRows){
  const ops=operations.filter(x=>x.uid===row.sourceUid);
  if(ops.length>1)refusal('Duplicate selected UID '+row.dispo);
  const op=ops[0]||null;
  const state=await readState(connection,row);
  if(state.kind==='pending'){
   // A pending promotion needs the exact original source, and MUST NOT
   // accidentally be resumed using a later edit or a refresh.
   if(!exactPromotion(op,row))refusal('Pending promotion lacks exact approved operation '+row.dispo);
   pending.set(row.sourceUid,grant(op,row));
  } else if(op){
   // Once full, an ordinary edit/refresh is covered by the existing mapper
   // preimage + mapped target checks. Never reuse an expired approval.
   const frozenCompletedReplay=exactPromotion(op,row)&&state.digest===row.newDigest;
   if(!frozenCompletedReplay&&(!['update','refresh'].includes(op.action)||op.dispo!==row.dispo||
     op.previousDispo!==row.dispo||op.group!==row.identityGroup||
     op.previousDigest!==state.digest||!Number.isSafeInteger(op.rowNumber)))
    refusal('Already-promoted record has inconsistent ordinary preimage '+row.dispo);
   matched.set(row.sourceUid,op);
  }
 }
 return {pending,ordinary:matched};
}
async function physicalReadback(map,connection){ // Preserve legacy test contract: only pending grants.
 const p=expectedRequest();
 const found=await inspect({ok:true,conflicts:[],manualSkips:{skippedCurrentRows:5},
  operations:{dispo:[...map.values()].map(g=>({
   uid:g.sourceUid,rowNumber:g.sourceRow,action:'update',dispo:g.dispo,
   previousDispo:g.dispo,previousDigest:g.previousDigest,digest:g.proposedDigest,
   group:g.identityGroup
  }))}},p,connection);
 if(found.pending.size!==map.size)refusal('Pending physical preimages changed');
 return true;
}
async function qualify(plan,connection){
 if(!REQUEST&&!RECEIPT&&!APPROVER&&!EXPECTED_SHA)return new Map();
 if(!REQUEST||!RECEIPT||!APPROVER||!/^[a-f0-9]{64}$/.test(EXPECTED_SHA||''))refusal('Incomplete private promotion configuration');
 const p=expectedRequest();
 const uids=new Set(p.dispo.sourceRows.map(x=>x.sourceUid));
 const targeted=(plan.operations?.dispo||[]).filter(x=>uids.has(x.uid));
 if(targeted.length===0)return new Map();
 const {pending}=await inspect(plan,p,connection);
 if(pending.size===0)return new Map(); // Later ordinary edits/refreshes need NO historical receipt.
 // Explicit authenticated business authority is necessary only for still
 // uncommitted transitions. Expired/invalid receipts fail closed here.
 if(!fs.existsSync(RECEIPT))refusal('Pending promotion lacks owner receipt');
 const {SyncDispoFiveApproval}=await import(pathToFileURL(APPROVER).href);
 const signed=await new SyncDispoFiveApproval().verifyReceipt();
 if(signed.valid!==true||signed.approvedBusinessTransitions!==5)
   refusal('Pending promotion has invalid/expired Auth0 owner approval');
 // Only pending records have zero children and zero provenance. Already-full
 // records can have legitimate children and historical provenance.
 for(const g of pending.values()){
  const [prov]=await connection.query(
   'SELECT target_table FROM migration_import_provenance WHERE profile=? AND source_uid=? LIMIT 2',
   ['dispo',g.sourceUid]);
  if(prov.length)refusal('Pending promotion has unexpected provenance '+g.dispo);
  for(const table of ['warp_yarn_details','weft_yarn_details','warp_broken_section','warp_broken_pattern']){
   const [rows]=await connection.query('SELECT dispo_number FROM `'+table+'` WHERE LOWER(TRIM(dispo_number))=? LIMIT 1',[g.dispo]);
   if(rows.length)refusal('Pending promotion destination occupied in '+table+' '+g.dispo);
  }
 }
 return pending;
}
return {qualify,select,physicalReadback,inspect,exactPromotion,expectedRequest};
}
module.exports={...createPolicy({requestFile:process.env.SYNC_DISPO_PROMOTION_REQUEST_FILE,requestSha256:process.env.SYNC_DISPO_PROMOTION_REQUEST_SHA256,receiptFile:process.env.SYNC_DISPO_PROMOTION_RECEIPT_FILE,approverModule:process.env.SYNC_DISPO_PROMOTION_APPROVER_MODULE}),createPolicy};
