'use strict';
// Only this loader connects private reviewed lineage evidence to the worker.
// No private keys, generated approvals, arbitrary SQL, or database mutations.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {iterateCsvRows,dedupeHeaders}=require('./csv_stream');
const {isoBusinessDate}=require('./sync_date_scope');
const {candidateKey,verifyIndependentInsert}=require('./sync_lineage');
const HEX=/^[a-f0-9]{64}$/;
const fail=(code,message)=>Object.assign(new Error(message),{code});
function stable(v){
 if(v===undefined||v===null)return null;
 if(v instanceof Date)return v.toISOString();
 if(Array.isArray(v))return v.map(stable);
 if(typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
 if(typeof v==='bigint')return v.toString();
 return v;
}
const hash=x=>crypto.createHash('sha256').update(typeof x==='string'||Buffer.isBuffer(x)?x:JSON.stringify(stable(x))).digest('hex');
function inside(root,file){const r=path.relative(root,file);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);}
function readPinned(root,file,expected,limit=8*1024*1024){
 const target=path.resolve(file),base=fs.realpathSync(root);
 if(!inside(base,target)||!inside(base,fs.realpathSync(target))||fs.lstatSync(target).isSymbolicLink())
  throw fail('LINEAGE_PATH','Evidence must be a regular private file beneath its approved root');
 const st=fs.statSync(target);
 if(!st.isFile()||st.size>limit||(process.platform!=='win32'&&(st.mode&0o022)))
  throw fail('LINEAGE_FILE','Evidence file is oversized, writable by others, or not regular');
 const bytes=fs.readFileSync(target);
 if(!HEX.test(expected||'')||hash(bytes)!==expected)throw fail('LINEAGE_FILE_HASH','Evidence fingerprint changed');
 return {file:target,bytes,data:JSON.parse(bytes.toString('utf8'))};
}
function manifestEntry(root,relative){
 const lines=fs.readFileSync(path.join(root,'protection.sha256'),'utf8').replace(/^\uFEFF/,'').split(/\r?\n/);
 const matches=lines.map(l=>/^([a-f0-9]{64})\s+\*?(.+)$/.exec(l)).filter(m=>m&&m[2]===relative);
 if(matches.length!==1)throw fail('LINEAGE_TRUST_UNPINNED','Reviewer registry must have exactly one entry in protection.sha256');
 return matches[0][1];
}
function validUtc(x){return typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(x)&&Number.isFinite(Date.parse(x));}
function ledgerFingerprint(rows){
 const seen=new Set(),h=crypto.createHash('sha256');
 for(const r of [...rows].sort((a,b)=>a.uid<b.uid?-1:a.uid>b.uid?1:0)){
  if(!r.uid||seen.has(r.uid))throw fail('LINEAGE_LEDGER_DUPLICATE','Duplicate or missing ledger UID');
  seen.add(r.uid);
  let y=r.yarnIdentity??null;if(typeof y==='string'&&y)y=JSON.parse(y);
  h.update(JSON.stringify(stable([r.uid,r.group,r.digest,r.dispo,r.matchHash??null,y]))+'\n');
 }
 return h.digest('hex');
}
function reviewers(registry,now){
 if(registry.version!==1||!Array.isArray(registry.reviewers))throw fail('LINEAGE_REGISTRY','Invalid reviewer registry');
 const keys={businessOwner:Object.create(null),secondReviewer:Object.create(null)},principals={businessOwner:Object.create(null),secondReviewer:Object.create(null)};
 for(const r of registry.reviewers){
  if(!Object.hasOwn(keys,r.role)||!/^[-\w.@]{1,128}$/.test(r.id||'')||!/^[-\w.@]{1,128}$/.test(r.principalId||''))
   throw fail('LINEAGE_REVIEWER','Invalid reviewer identity');
  if(Object.hasOwn(keys[r.role],r.id))throw fail('LINEAGE_REVIEWER_DUPLICATE','Duplicate reviewer role/ID');
  if(r.active!==true)continue;
  if(!validUtc(r.validFrom)||!validUtc(r.validUntil)||Date.parse(r.validFrom)>now||Date.parse(r.validUntil)<=now)continue;
  const key=crypto.createPublicKey(r.publicKeyPem);
  if(key.asymmetricKeyType!=='ed25519')throw fail('LINEAGE_KEY_TYPE','Review signatures require Ed25519 public keys');
  keys[r.role][r.id]=key;principals[r.role][r.id]=r.principalId;
 }
 return {trustedReviewers:keys,reviewerPrincipals:principals};
}
const quote=x=>{if(!/^[A-Za-z0-9_]+$/.test(x))throw fail('LINEAGE_IDENTIFIER','Invalid mapped SQL identifier');return '`'+x+'`';};
function targetChecks(profile,headers,values){
 // Use the actual mapping contract and the fingerprint-checked source, never
 // caller-authored SQL/selectors. Special formula keys must first be resolved
 // by the existing identity parser; arbitrary formula evaluation is forbidden.
 const primary=(profile.tables||[])[0];
 if(!primary?.natural_key?.length)throw fail('LINEAGE_TARGET_MAPPING','Missing root target natural key');
 const value=name=>{const i=headers.indexOf(name);if(i<0)throw fail('LINEAGE_SOURCE_FIELD','Source field missing: '+name);return String(values[i]??'').trim();};
 const where={};
 const yarn=profile.id==='yarn-receive'?require('./yarn_sync_identity').yarnIdentity(profile.id,headers,values):null;
 for(const field of primary.natural_key){
  const options=(profile.mappings||[]).filter(m=>m.table===primary.name&&m.field===field);
  if(options.length!==1)throw fail('LINEAGE_TARGET_MAPPING','Target key mapping is not unique');
  const m=options[0];let v;
  if(m.type==='direct'&&m.source_column)v=value(m.source_column);
  else if(profile.id==='yarn-receive'&&field==='received_against_dispo_nos')v=yarn?.dispo;
  else if(profile.id==='yarn-receive'&&field==='challan_no')v=yarn?.challan;
  else throw fail('LINEAGE_TARGET_FORMULA','Unresolved target-key formula requires business mapping review');
  if(!v||/^(?:n\/a|na|null)$/i.test(v))throw fail('LINEAGE_TARGET_KEY','Empty or placeholder target key');
  if(/date/.test(field)&&!isoBusinessDate(v))throw fail('LINEAGE_TARGET_DATE','Noncanonical target business date');
  where[field]=v;
 }
 const checks=[{table:primary.name,where}];
 // Both master representations must be absent for an independent Dispo insert.
 if(profile.id==='dispo')checks.push({table:'dispo_form_data',where:{dispo_number:value('Dispo No.')}});
 // A renamed PO might preserve its Dispo. Check both identities independently.
 if(profile.id==='po')checks.push({table:'PO_form_data',where:{dispo_number:value('DISPO NUMBER')}});
 return checks;
}
async function targetAbsence(db,database,checks,lock=false){
 const facts=[];
 for(const {table,where}of checks){
  const fields=Object.keys(where);
  if(!fields.length)throw fail('LINEAGE_TARGET_KEY','Unbounded target check refused');
  const [rows]=await db.query('SELECT 1 AS present FROM '+quote(table)+' WHERE '+fields.map(k=>quote(k)+' <=> ?').join(' AND ')+' LIMIT 2'+(lock?' FOR UPDATE':''),fields.map(k=>where[k]));
  if(rows.length)throw fail('LINEAGE_TARGET_EXISTS','An approved new-event target already exists: '+table);
  facts.push({table,where,rows:0});
 }
 return hash({database,checks:facts});
}
class LineageInputs{
 constructor(o){Object.assign(this,o);this.contexts=new Map();this.selections=new Map();this.used=new Set();}
 assertCurrent(){
  const now=this.clock();
  if(now<Date.parse(this.data.createdAt)||now>=Date.parse(this.data.expiresAt))throw fail('LINEAGE_EXPIRED','Lineage evidence is not currently valid');
  for(const [file,expected]of [[this.input.file,this.inputHash],[this.registry.file,this.registryHash],
    [this.sourceManifest,this.sourceHash],[this.contractPath,this.contractHash],[this.policyPath,this.policyHash]])
   if(hash(fs.readFileSync(file))!==expected)throw fail('LINEAGE_EVIDENCE_CHANGED','Source, mapping, protection or reviewer evidence changed');
  if(manifestEntry(this.root,this.registryRelative)!==this.registryHash)throw fail('LINEAGE_TRUST_CHANGED','Reviewer trust pin changed');
  return reviewers(this.registry.data,now);
 }
 async forProfile(profile,current,events,db){
  const proofList=this.data.records.filter(p=>p.evidence.profile===profile.id);
  const trust=this.assertCurrent(),fingerprint=ledgerFingerprint(events);
  const expected=this.data.productionLedgerFingerprints[profile.id];
  if(proofList.length&&fingerprint!==expected)throw fail('LINEAGE_LEDGER_CHANGED','Reviewed profile ledger changed: '+profile.id);
  const context={...trust,requireV2:true,sourceManifestSha256:this.sourceHash,
   productionLedgerSha256:expected||fingerprint,database:this.database,
   contractSha256:this.contractHash,protectionPolicySha256:this.policyHash,
   windowStart:this.window.start,windowEnd:this.window.end,clock:this.clock,
   proofs:new Map(),targetAbsenceEvidenceByKey:new Map()};
  if(!proofList.length){this.contexts.set(profile.id,context);return context;}
  const byRow=new Map(current.records.map(r=>[r.rowNumber,r]));
  const wanted=new Map();
  for(const p of proofList){
   const row=byRow.get(p.evidence.sourceRowNumber);
   if(!row||row.action&&row.action!=='insert'||row.key!==p.evidence.sourceRowKey||row.digest!==p.evidence.digest||row.group!==p.evidence.group||row.dispo!==p.evidence.dispo||row.businessDate!==p.evidence.businessDate)
    throw fail('LINEAGE_SOURCE_CHANGED','Reviewed event no longer matches certified source');
   const key=candidateKey(profile.id,row);
   if(wanted.has(row.rowNumber)||context.proofs.has(key))throw fail('LINEAGE_PROOF_DUPLICATE','Duplicate approval for a source event');
   // Signature verification needs the actual absence digest below.
   context.targetAbsenceEvidenceByKey.set(key,p.evidence.targetAbsentPreimageSha256);
   if(!verifyIndependentInsert(p,profile.id,row,context))throw fail('LINEAGE_SIGNATURE','Lineage signatures or signed scope are invalid');
   context.targetAbsenceEvidenceByKey.delete(key);
   context.proofs.set(key,p);wanted.set(row.rowNumber,row);
  }
  let headers;const found=new Set();
  for await(const r of iterateCsvRows(path.join(this.csvDir,profile.source_file))){
   if(r.logicalRowNumber<=Number(profile.header_row||0))continue;
   if(!headers){headers=dedupeHeaders(r.values);continue;}
   const row=wanted.get(r.logicalRowNumber);if(!row)continue;
   if(require('./sheets_sync_plan').fingerprint(headers,r.values,profile.id)!==row.digest)throw fail('LINEAGE_SOURCE_CHANGED','Source changed while constructing lineage context');
   const key=candidateKey(profile.id,row),p=context.proofs.get(key),checks=targetChecks(profile,headers,r.values);
   const actual=await targetAbsence(db,this.database,checks);
   if(actual!==p.evidence.targetAbsentPreimageSha256)throw fail('LINEAGE_TARGET_CHANGED','Reviewed target absence fingerprint changed');
   context.targetAbsenceEvidenceByKey.set(key,actual);
   this.selections.set(key,{profile:profile.id,proof:p,row,checks,context});found.add(row.rowNumber);
  }
  if(found.size!==wanted.size)throw fail('LINEAGE_SOURCE_MISSING','Not all reviewed source rows were found');
  this.contexts.set(profile.id,context);return context;
 }
 bindPlan(plan){
  const selected=new Set();
  for(const [profile,ops]of Object.entries(plan.operations))for(const op of ops){
   if(op.action!=='insert')continue;
   const key=candidateKey(profile,op);
   if(this.selections.has(key))selected.add(key);
  }
  this.used=selected;
  plan.lineageInput={version:2,inputSha256:this.inputHash,reviewerRegistrySha256:this.registryHash,
   sourceManifestSha256:this.sourceHash,contractSha256:this.contractHash,
   protectionPolicySha256:this.policyHash,businessWindow:this.window,
   selectedProofKeys:[...selected].sort(),reviewedProofCount:this.data.records.length,
   expiresAt:this.data.expiresAt};
 }
 async beforeInsert(ctx,profile,op){
  const key=candidateKey(profile.id,op);
  if(!this.used.has(key))return;
  const s=this.selections.get(key),trust=this.assertCurrent();
  if(!s||!verifyIndependentInsert(s.proof,profile.id,op,{...s.context,...trust}))throw fail('LINEAGE_APPLY_AUTH','Reviewed event authorization expired or changed');
  const actual=await targetAbsence(ctx.conn,this.database,s.checks,true);
  if(actual!==s.proof.evidence.targetAbsentPreimageSha256)throw fail('LINEAGE_TARGET_CHANGED','Reviewed insert target changed before mutation');
 }
 summary(){return {inputSha256:this.inputHash,reviewedProofs:this.data.records.length,selectedProofs:this.used.size,expiresAt:this.data.expiresAt};}
}
function loadLineageInputs({root,inputFile,inputSha256,sourceManifest,csvDir,contractPath,policyPath,database,window,clock=Date.now}){
 if(!inputFile&&!inputSha256)return null;
 if(!inputFile||!inputSha256||!window||!isoBusinessDate(window.start)||!isoBusinessDate(window.end)||window.start>window.end)
  throw fail('LINEAGE_INPUT_ARGUMENTS','Lineage input, exact fingerprint and explicit date boundary are required');
 const registryRelative='lineage-reviewers.json',registryHash=manifestEntry(root,registryRelative);
 const registry=readPinned(root,path.join(root,registryRelative),registryHash,256*1024);
 const approvalsRoot=path.join(root,'sync_data','approvals');
 const input=readPinned(approvalsRoot,inputFile,inputSha256);
 const data=input.data,sourceHash=hash(fs.readFileSync(sourceManifest)),contractHash=hash(fs.readFileSync(contractPath)),policyHash=hash(fs.readFileSync(policyPath));
 if(data.version!==2||data.database!==database||data.sourceManifestSha256!==sourceHash||data.contractSha256!==contractHash||data.protectionPolicySha256!==policyHash||
    JSON.stringify(stable(data.businessWindow))!==JSON.stringify(stable(window))||!Array.isArray(data.records)||data.records.length>5000||!data.productionLedgerFingerprints||
    !validUtc(data.createdAt)||!validUtc(data.expiresAt)||Date.parse(data.createdAt)>=Date.parse(data.expiresAt)||Date.parse(data.expiresAt)-Date.parse(data.createdAt)>86400000)
  throw fail('LINEAGE_INPUT_SCOPE','Reviewed input does not match this source, policy, mapping, database or window');
 const knownProfiles=new Set(JSON.parse(fs.readFileSync(contractPath,'utf8')).profiles.map(p=>p.id));
 for(const p of data.records){
  const e=p?.evidence;
  if(!knownProfiles.has(e?.profile))throw fail('LINEAGE_UNKNOWN_PROFILE','Evidence refers to an unknown source profile');
  if(e?.kind!=='verified-independent-source-event-v2'||e.database!==database||e.sourceManifestSha256!==sourceHash||e.contractSha256!==contractHash||e.protectionPolicySha256!==policyHash||
     e.windowStart!==window.start||e.windowEnd!==window.end||e.approvedAt!==data.createdAt||e.expiresAt!==data.expiresAt||e.productionLedgerSha256!==data.productionLedgerFingerprints[e.profile]||!HEX.test(e.productionLedgerSha256||''))
   throw fail('LINEAGE_PROOF_SCOPE','Signed record is not bound to its input envelope');
 }
 const loaded=new LineageInputs({root,input,inputHash:inputSha256,registry,registryHash,registryRelative,
  sourceManifest,sourceHash,csvDir,contractPath,contractHash,policyPath,policyHash,database,window,clock,data});
 loaded.assertCurrent();return loaded;
}
async function assertLedgerFresh(db,plan){
 const fingerprints=plan.productionLedgerFingerprints;
 if(!fingerprints||!Object.keys(fingerprints).length||Object.entries(plan.operations||{}).some(([p,ops])=>ops.length&&!HEX.test(fingerprints[p]||'')))
  throw fail('SYNC_LEDGER_EVIDENCE_MISSING','Every selected profile requires its original ledger fingerprint');
 for(const [profile,expected]of Object.entries(plan.productionLedgerFingerprints||{})){
  const [events]=await db.query('SELECT source_uid uid,group_key `group`,digest,dispo,match_hash matchHash,yarn_identity yarnIdentity FROM sheets_sync_events WHERE profile=? ORDER BY source_uid',[profile]);
  if(ledgerFingerprint(events)!==expected)throw fail('SYNC_LEDGER_FRESHNESS','Ledger changed since plan qualification: '+profile);
 }
}
module.exports={loadLineageInputs,LineageInputs,ledgerFingerprint,assertLedgerFresh,targetChecks,targetAbsence,hash,stable,reviewers,validUtc};
