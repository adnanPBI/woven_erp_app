'use strict';
// A private, frozen source/DB exception. No record selection is shipped in Git.
const fs=require('fs'),crypto=require('crypto'),path=require('path');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const fail=message=>{throw Error('Exact manual skips: '+message);};
function loadManualSkips(env,manifestSha256,cycle){
 if(!env.SYNC_MANUAL_SKIPS_FILE)return null;
 const bytes=fs.readFileSync(env.SYNC_MANUAL_SKIPS_FILE),hash=sha(bytes),p=JSON.parse(bytes);
 if(hash!==env.SYNC_MANUAL_SKIPS_SHA256||p.version!==2||p.mode!=='owner-authorized-exact-skips'||
  p.database!==env.DB_NAME||p.database!==env.SYNC_EXPECTED_DB||!['localhost','127.0.0.1','::1'].includes(env.DB_HOST)||
  p.sourceManifestSha256!==manifestSha256||path.resolve(p.cycle)!==path.resolve(cycle)||
  !(p.automaticRestartAuthorized===false||(p.automaticRestartAuthorized===true&&p.qualification==='scheduled-exact-rebind'&&
   env.SYNC_AUTOMATIC_RESTART_AUTHORIZED==='true'&&hex(p.scheduledBaseSha256)&&p.scheduledBaseSha256===env.SYNC_SCHEDULED_SKIPS_BASE_SHA256))||
  p.originalConflicts?.length!==8||p.currentRows?.length!==6||
  !Array.isArray(p.oldRecords)||!Array.isArray(p.absentLedger)||p.oldRecords.length+p.absentLedger.length!==6||
  !Array.isArray(p.protectedRows)||!Array.isArray(p.receiptLots)||!p.window||p.window.start!==env.SYNC_START_DATE)fail('binding or scope changed');
 const valid=r=>['yarn-receive','yarn-issue'].includes(r.profile)&&hex(r.uid)&&hex(r.digest)&&hex(r.group);
 if([...p.currentRows,...p.oldRecords,...p.absentLedger].some(r=>!valid(r))||
  new Set(p.currentRows.map(r=>r.profile+'|'+r.uid)).size!==6||
  new Set([...p.oldRecords,...p.absentLedger].map(r=>r.profile+'|'+r.uid)).size!==6||
  p.currentRows.some(r=>!Number.isInteger(r.rowNumber)||r.businessDate<p.window.start||r.businessDate>p.window.end)||
  p.receiptLots.some(r=>!r.lot||![r.sourceTotal,r.skippedTotal,r.retainedTotal,r.effectiveTotal].every(Number.isFinite)||
   r.skippedTotal<0||r.retainedTotal<0||Math.abs(r.sourceTotal-r.skippedTotal+r.retainedTotal-r.effectiveTotal)>1e-7||r.effectiveTotal<0)||
  new Set(p.receiptLots.map(r=>r.lot)).size!==p.receiptLots.length)fail('malformed record or lot evidence');
 const apply=(profile,view)=>{
  const old=p.oldRecords.filter(r=>r.profile===profile),fresh=p.currentRows.filter(r=>r.profile===profile);
  for(const r of old){const found=view.previous.records.filter(x=>x.uid===r.uid);if(found.length!==1||found[0].digest!==r.digest||found[0].group!==r.group)fail('retained ledger drift');}
  for(const r of p.absentLedger.filter(r=>r.profile===profile))if(view.previous.records.some(x=>x.uid===r.uid))fail('absent ledger appeared');
  for(const r of fresh){const found=view.current.records.filter(x=>x.uid===r.uid);if(found.length!==1||found[0].digest!==r.digest||found[0].group!==r.group||found[0].businessDate!==r.businessDate||found[0].rowNumber!==r.rowNumber)fail('current source drift');}
  return {previous:{...view.previous,records:view.previous.records.filter(r=>!old.some(s=>s.uid===r.uid))},current:{...view.current,records:view.current.records.filter(r=>!fresh.some(s=>s.uid===r.uid))}};
 };
 return {policy:p,apply,summary:{policy:'owner-authorized-exact-skips',sha256:hash,originalConflictFindings:8,skippedCurrentRows:6,retainedLedgerEvents:p.oldRecords.length,absentPriorEvents:p.absentLedger.length,receiptLots:p.receiptLots}};
}
async function verifyRetained(db,loaded){
 if(!loaded)return null;
 const {rowHash}=require('./sync_business_evidence'),p=loaded.policy;
 const [[identity]]=await db.query('SELECT DATABASE() databaseName,@@hostname hostname');
 if(identity.databaseName!==p.database||identity.hostname!==p.hostname)fail('physical database identity');
 for(const r of p.oldRecords){const [rows]=await db.query('SELECT digest,group_key FROM sheets_sync_events WHERE profile=? AND source_uid=?',[r.profile,r.uid]);if(rows.length!==1||rows[0].digest!==r.digest||rows[0].group_key!==r.group)fail('retained ledger changed');}
 for(const r of p.absentLedger){const [rows]=await db.query('SELECT 1 FROM sheets_sync_events WHERE profile=? AND source_uid=?',[r.profile,r.uid]);if(rows.length)fail('absent historical ledger appeared');}
 for(const r of p.currentRows){if(p.oldRecords.some(o=>o.profile===r.profile&&o.uid===r.uid))continue;const [rows]=await db.query('SELECT 1 FROM sheets_sync_events WHERE profile=? AND source_uid=?',[r.profile,r.uid]);if(rows.length)fail('skipped source was applied');}
 let physicalRows=0,absentPhysicalTargets=0;
 for(const r of p.physicalAbsences||[]){
  const fields=Object.keys(r.selector||{});if(!/^\w+$/.test(r.table)||!fields.length||fields.some(k=>!/^\w+$/.test(k)))fail('unsafe absence selector');
  const [rows]=await db.query('SELECT 1 FROM `'+r.table+'` WHERE '+fields.map(k=>'`'+k+'` <=> ?').join(' AND ')+' LIMIT 1',fields.map(k=>r.selector[k]));
  if(rows.length)fail('absent physical target appeared');absentPhysicalTargets++;
 }
 for(const r of p.protectedRows){for(const name of [r.table,r.child,r.fk])if(!/^\w+$/.test(name))fail('unsafe identifier');const [parents]=await db.query('SELECT * FROM `'+r.table+'` WHERE id=?',[r.parentId]),[children]=await db.query('SELECT * FROM `'+r.child+'` WHERE `'+r.fk+'`=?',[r.parentId]);if(parents.length!==r.parentCount||children.length!==r.childCount||rowHash(parents)!==r.parentHash||rowHash(children)!==r.childHash)fail('retained physical rows changed');physicalRows+=parents.length+children.length;}
 return {ok:true,retainedPhysicalRows:physicalRows,retainedLedgerEvents:p.oldRecords.length,absentPriorEvents:p.absentLedger.length,absentPhysicalTargets,skippedCurrentRows:6};
}
function applyReceiptTotals(receipts,env=process.env){
 if(!env.SYNC_MANUAL_SKIPS_FILE)return;
 if(!env.SOURCE_MANIFEST_FILE)fail('receipt adjustment requires source manifest');
 const manifestHash=sha(fs.readFileSync(env.SOURCE_MANIFEST_FILE));
 const raw=JSON.parse(fs.readFileSync(env.SYNC_MANUAL_SKIPS_FILE));
 const loaded=loadManualSkips(env,manifestHash,raw.cycle);
 for(const r of loaded.policy.receiptLots){const actual=receipts.get(r.lot)?.total??0;if(Math.abs(actual-r.sourceTotal)>1e-7)fail('receipt source total drift');const prior=receipts.get(r.lot)||{rows:0};receipts.set(r.lot,{...prior,total:r.effectiveTotal,manualSkipAdjusted:true});}
}
module.exports={loadManualSkips,verifyRetained,applyReceiptTotals};
