'use strict';
// Read-only current source -> ledger -> original provenance -> PO target.
// Private review evidence, never an import instruction or approval.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const mysql=require('mysql2/promise'),dotenv=require('dotenv');
const {inventory,planEdits}=require('../../lib/sheets_sync_plan');
const {iterateCsvRows,dedupeHeaders}=require('../../lib/csv_stream');
const ROOT=path.resolve(__dirname,'../..'),DB_NAME='weavonpq_weaving_main';
const output=path.join(ROOT,'sync_data/po_recovery_review.json');
const norm=x=>String(x??'').trim().toLowerCase();
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const hobj=x=>sha(JSON.stringify(x));
const list=arr=>[...new Set(arr.filter(Boolean))];
async function batch(db,sql,ids){
 let out=[];
 for(let i=0;i<ids.length;i+=80){
  const chunk=ids.slice(i,i+80);
  const [rows]=await db.query(sql.replace('/*IDS*/',chunk.map(()=>'?').join(',')),chunk);
  out.push(...rows);
 }
 return out;
}
(async()=>{
 if(fs.existsSync(output))throw Error('PO review already exists; refusing overwrite');
 const cycles=fs.readdirSync(path.join(ROOT,'sync_data/cycles')).sort().reverse();
 let chosen,source,sourceManifest,plan;
 for(const name of cycles){
  const dir=path.join(ROOT,'sync_data/cycles',name),file=path.join(dir,'local_state.json');
  if(!fs.existsSync(file)||!fs.existsSync(path.join(dir,'plan.json')))continue;
  const s=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!s.latestCertifiedDir||!fs.existsSync(s.latestCertifiedDir)||
   !s.latestSourceManifest||!fs.existsSync(s.latestSourceManifest))continue;
  chosen=name;source=s.latestCertifiedDir;sourceManifest=s.latestSourceManifest;
  plan=JSON.parse(fs.readFileSync(path.join(dir,'plan.json'),'utf8'));break;
 }
 if(!chosen)throw Error('No retained certified source plan');
 const sourceHash=sha(fs.readFileSync(sourceManifest));
 const profile=require('../../mappings/mapping-contract-v2.json').profiles.find(p=>p.id==='po');
 const pCurrent=(await inventory(source,[profile])).po;
 const raw=new Map();let h=null;
 for await(const row of iterateCsvRows(path.join(source,profile.source_file))){
  if(row.logicalRowNumber<=Number(profile.header_row||0))continue;
  if(!h){h=dedupeHeaders(row.values);continue;}
  raw.set(row.logicalRowNumber,row.values);
 }
 const col={};for(const name of ['PO NO','DISPO NUMBER','PO Issue Date','PO Quantity (Yds)',
  'BUYER NAME','BUYER STYLE/REF','Fabric Type','Order Type','Last Modified Date']){
  const i=h.indexOf(name);if(i<0)throw Error('Missing PO source column '+name);
  col[name]=i;
 }
 const value=(r,k)=>String((raw.get(r.rowNumber)||[])[col[k]]??'').trim();
 dotenv.config({path:'/home/weavonpq/public_html/main/.env',quiet:true});
 const db=await mysql.createConnection({host:process.env.DB_HOST||'localhost',
   port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
   password:process.env.DB_PASSWORD,database:DB_NAME,connectTimeout:12000,dateStrings:true});
 try{
  await db.query('START TRANSACTION READ ONLY');
  const [[identity]]=await db.query('SELECT DATABASE() db');
  if(identity.db!==DB_NAME)throw Error('Wrong database');
  const [[meta]]=await db.query('SELECT headers_json FROM sheets_sync_meta WHERE id=1');
  const [ledgerRows]=await db.query('SELECT source_uid uid,group_key grp,digest,dispo,match_hash matchHash FROM sheets_sync_events WHERE profile=? ORDER BY source_uid',['po']);
  const prev={headersHash:JSON.parse(meta.headers_json).po,
   records:ledgerRows.map(r=>({...r,group:r.grp}))};
  const rebuilt=planEdits({po:prev},{po:pCurrent});
  const sourceGroups=new Set(pCurrent.records.map(r=>r.group));
  const missingOld=prev.records.filter(r=>!sourceGroups.has(r.group));
  const inserts=rebuilt.operations.po.filter(r=>r.action==='insert');
  const considered=inserts.map(r=>({
   candidate:r,po:value(r,'PO NO'),dispo:value(r,'DISPO NUMBER'),
   businessDate:value(r,'PO Issue Date'),
   qty:value(r,'PO Quantity (Yds)').replace(/,/g,''),
   buyer:value(r,'BUYER NAME'),style:value(r,'BUYER STYLE/REF'),
   fabricType:value(r,'Fabric Type'),orderType:value(r,'Order Type'),
   lastModified:value(r,'Last Modified Date')
  })).filter(x=>x.businessDate>='2026-09-21'&&x.businessDate<='2026-10-14');
  const currentPoKeys=list(considered.map(x=>x.po));
  const candidateDispos=list(considered.map(x=>x.dispo));
  const targetColumns='po_no,dispo_number,po_issue_date,po_quantity,buyer_name,buyer_style_ref,fabric_type,order_type';
  const direct=await batch(db,'SELECT '+targetColumns+' FROM PO_form_data WHERE po_no IN (/*IDS*/)',currentPoKeys);
  const sameDispo=await batch(db,'SELECT '+targetColumns+' FROM PO_form_data WHERE dispo_number IN (/*IDS*/)',candidateDispos);
  const [missingProvenance]=missingOld.length?
   await db.query('SELECT source_uid,target_table,target_primary_key,source_manifest_sha256,source_row_number FROM migration_import_provenance WHERE profile=? AND source_uid IN ('+missingOld.map(()=>'?').join(',')+')',['po',...missingOld.map(x=>x.uid)]):[[]];
  const historicalPk=list(missingProvenance.filter(x=>x.target_table==='PO_form_data').map(x=>x.target_primary_key));
  const historical=await batch(db,'SELECT '+targetColumns+' FROM PO_form_data WHERE po_no IN (/*IDS*/)',historicalPk);
  const protectedPolicy=JSON.parse(fs.readFileSync(path.join(ROOT,'protection-policy.json')));
  if(protectedPolicy.heldCases.length!==42||protectedPolicy.originalExclusions.length!==14)
    throw Error('Original protections unexpectedly changed');
  const bound=new Set(protectedPolicy.seedDispos.map(norm));
  const closure=new Set((plan.exclusions?.dispos||[]).map(norm));
  const directKeys=new Set(direct.map(x=>norm(x.po_no)));
  const sameDispoCounts=new Map();
  for(const r of sameDispo)sameDispoCounts.set(norm(r.dispo_number),(sameDispoCounts.get(norm(r.dispo_number))||0)+1);
  const sourcePoCount=new Map();for(const r of pCurrent.records){
   const name=value(r,'PO NO');if(name)sourcePoCount.set(norm(name),(sourcePoCount.get(norm(name))||0)+1);
  }
  const riskReason=(item)=>{
   if(historical.length!==1)return 'historical_key_reassignment_not_resolved';
   const old=historical[0];
   const equal={
    qty:Number(item.qty)===Number(old.po_quantity),
    date:item.businessDate===String(old.po_issue_date),
    buyer:norm(item.buyer)===norm(old.buyer_name),
    style:norm(item.style)===norm(old.buyer_style_ref),
    fabricType:norm(item.fabricType)===norm(old.fabric_type)
   };
   return Object.values(equal).filter(Boolean).length>=3?'possible_historical_rekey_multiple_fields_match':'historical_rekey_not_excluded_without_revision_history';
  };
  const records=[];
  for(const item of considered){
   if(!item.po||!/^\d{4}-\d{2}-\d{2}$/.test(item.businessDate))
     throw Error('Incomplete or invalid source PO candidate');
   records.push({po:item.po,dispo:item.dispo,qty:item.qty,
    businessDate:item.businessDate,buyer:item.buyer,style:item.style,
    sourceRowNumber:item.candidate.rowNumber,sourceRowKey:item.candidate.key,
    sourceDigest:item.candidate.digest,sourceGroup:item.candidate.group,
    lastModified:item.lastModified,
    targetAbsentByCurrentPo:!directKeys.has(norm(item.po)),
    targetAbsentByCurrentDispo:!sameDispoCounts.has(norm(item.dispo)),
    sourceNaturalKeyUnique:sourcePoCount.get(norm(item.po))===1,
    originalSeedProtected:bound.has(norm(item.dispo)),
    effectiveDispoHeld:closure.has(norm(item.dispo)),
    possibleHistoricalRenameRisk:riskReason(item),
    targetAbsenceFingerprint:hobj([DB_NAME,item.po,item.dispo,
       !directKeys.has(norm(item.po)),!sameDispoCounts.has(norm(item.dispo))]),
    status:'REVIEW_REQUIRED_NOT_APPROVED',ownerApproval:null,independentReviewer:null});
  }
  const ledgerSha=hobj(ledgerRows.map(r=>[r.uid,r.grp,r.digest,r.dispo,r.matchHash]));
  const report={audit:'current-source-to-PO-ledger-target-reconciliation',
    generatedAt:new Date().toISOString(),sourceCycle:chosen,sourceManifestSha256:sourceHash,
    database:DB_NAME,poLedgerFingerprintSha256:ledgerSha,
    authorizedWindow:['2026-09-21','2026-10-14'],
    sourcePoRecords:pCurrent.records.length,poLedgerRows:ledgerRows.length,
    sourceInsertActionsAcrossHistory:inserts.length,
    historicalMissingLedgerKeys:missingOld.length,
    priorRemovedEventsWithProvenance:missingProvenance.length,
    priorRemovedTargetRows:historical.length,
    originalProtectionCases:42,originalExclusions:14,
    candidateCount:records.length,
    currentPoAbsent:records.filter(r=>r.targetAbsentByCurrentPo).length,
    currentDispoAbsent:records.filter(r=>r.targetAbsentByCurrentDispo).length,
    currentPoUnique:records.filter(r=>r.sourceNaturalKeyUnique).length,
    directExplicitProtected:records.filter(r=>r.originalSeedProtected).length,
    effectivelyHeld:records.filter(r=>r.effectiveDispoHeld).length,
    historicalRenameRiskMatches:records.filter(r=>r.possibleHistoricalRenameRisk.startsWith('possible_historical')).length,
    requiresSignedLineageReview:true,
    productionWrites:0,productionApprovals:0,records};
  if(sha(fs.readFileSync(sourceManifest))!==sourceHash)throw Error('Certified source changed while auditing');
  await db.query('ROLLBACK');
  fs.writeFileSync(output,JSON.stringify(report,null,2),{encoding:'utf8',flag:'wx',mode:0o600});
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report).filter(([key])=>key!=='records')),null,2));
 }finally{await db.end()}
})().catch(e=>{console.error('PO_LINEAGE_AUDIT_ERROR '+(e.code||e.message));process.exitCode=1});
