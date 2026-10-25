'use strict';
// Full reviewed-input -> scoped plan -> importer -> ledger -> independent verification.
// Test-only keys/approvals and a newly created loopback MySQL fixture; never production.
const fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),Module=require('module');
const mysql=require('mysql2/promise'),dotenv=require('dotenv');
const {inventory,planEdits}=require('../lib/sheets_sync_plan');
const {SyncExclusions}=require('../lib/sync_exclusions');
const {payloadFor}=require('../lib/sync_lineage');
const {loadLineageInputs,ledgerFingerprint,targetChecks,targetAbsence,hash,assertLedgerFresh}=require('../lib/sync_lineage_inputs');
const {qualifyRecoveryWindow}=require('../lib/sync_date_scope');
const {SheetsSyncRuntime}=require('../lib/sheets_sync_runtime.repair');
const safety=require('../lib/sync_write_safety');
const ROOT=path.resolve(__dirname,'..'),runtimeFile=path.join(ROOT,'lib/mapping_contract_runtime.repair.js');
const mod=new Module(runtimeFile,module);mod.filename=runtimeFile;mod.paths=Module._nodeModulePaths(path.dirname(runtimeFile));
mod._compile(fs.readFileSync(runtimeFile,'utf8')+'\nmodule.exports.integrationOnly={upsertRow,insertRow,updateRow,deleteChildren};',runtimeFile);
const runtime=mod.exports.integrationOnly;
const env=dotenv.parse(fs.readFileSync(path.join(ROOT,'local_data/sync_package/local.env.sync'),'utf8'));
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'weaving-release-test-'));
const database='zz_sync_release_'+crypto.randomBytes(6).toString('hex');
const window={start:'2026-09-21',end:'2026-10-14'};
let db,created=false,testCount=0;
const now=Date.now(),clock={now};
const at=ms=>new Date(ms).toISOString();
const p={id:'po',source_file:'po.csv',header_row:0,tables:[
 {name:'PO_form_data',natural_key:['po_no']},
 {name:'po_detail',natural_key:['po_no','line_no'],parent:{parent_table:'PO_form_data',parent_id_field:'po_no'}}],
 mappings:[{table:'PO_form_data',field:'po_no',type:'direct',source_column:'PO NO'}]};
const schema={PO_form_data:{po_no:'varchar(60)',dispo_number:'varchar(60)',po_issue_date:'date',quantity:'decimal(12,3)'},
 po_detail:{id:'int(11)',po_no:'varchar(60)',line_no:'int(11)',quantity:'decimal(12,3)'}};
const headers=['PO NO','DISPO NUMBER','PO Issue Date','Quantity','__MIG_SOURCE_UID'];
const values=['NEW-QUALIFIED-PO','independent-dispo','2026-10-14','25','export-transient-uid'];
const contract={profiles:[p]},policy={heldCases:Array.from({length:42},(_,i)=>({dispo:'protected-'+i})),
 originalExclusions:Array.from({length:14},(_,i)=>({dispo:'protected-'+i,lot:'held-lot-'+i})),seedDispos:Array.from({length:42},(_,i)=>'protected-'+i)};
function write(relative,value){const f=path.join(fixture,relative);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof value==='string'?value:JSON.stringify(value,null,2),{mode:0o600});return f;}
let sourceFile,contractFile,policyFile,inputFile,registryFile,originalRegistry,approval,loaderArgs,plan,inputs,current,events;
async function expectError(action,code){await assert.rejects(action,e=>e.code===code);testCount++;}
function context(dry,options={}){return {sync:new SheetsSyncRuntime(plan,{PO_form_data:{key:'po_no',values:Array.from({length:42},(_,i)=>'OLD-'+i)}},hash(fs.readFileSync(sourceFile)),{lineageInputs:inputs,...options}),dryRun:dry,pool:db,conn:null,schema,contract,sourceManifestFileSha256:hash(fs.readFileSync(sourceFile)),provenancePolicy:{profiles:{}},cache:{lookups:new Map()},duplicateAggregation:{},preview:()=>{},reject:x=>{throw Error(JSON.stringify(x))},runId:'release-local-fixture',currentSourceDataset:'po',currentSourceFile:'po.csv'};}
async function execute(ctx){
 const op=plan.operations.po[0];ctx.currentSourceRowNumber=op.rowNumber;ctx.currentSourceUid=op.uid;
 if(!await ctx.sync.begin(ctx,p,{headers},values))return;
 await runtime.upsertRow(ctx,p,'PO_form_data',{po_no:values[0],dispo_number:values[1],po_issue_date:values[2],quantity:25});
 await safety.reconcileChildren(ctx,p,'po_detail',{po_no:values[0]},[
  {po_no:values[0],line_no:1,quantity:10},{po_no:values[0],line_no:2,quantity:15}],{
   preview:r=>runtime.upsertRow(ctx,p,'po_detail',r),
   insert:r=>runtime.insertRow(ctx,'po_detail',r),update:(r,w)=>runtime.updateRow(ctx,'po_detail',r,w)});
 await ctx.sync.finish(ctx,p);
}
async function transaction(ctx){await db.beginTransaction();ctx.conn=db;const restore=safety.fenceConnection(db);try{await execute(ctx);await db.commit();}catch(e){await db.rollback();throw e;}finally{restore();ctx.conn=null;}}
async function capture(verifyOnly=false){const c=context(true,{verifyOnly});await c.sync.initialize(c);await execute(c);return c;}
(async()=>{
 if(!['localhost','127.0.0.1','::1'].includes(env.DB_HOST)||env.DB_NAME!=='weavonpq_weaving_sep22_preview')throw Error('Wrong local MySQL fixture configuration');
 db=await mysql.createConnection({host:'127.0.0.1',port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,dateStrings:true,multipleStatements:false});
 const [[id]]=await db.query('SELECT DATABASE() db,@@hostname host');assert.equal(id.db,env.DB_NAME);assert.equal(id.host.toLowerCase(),'rnd');
 await db.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4');created=true;await db.query('USE `'+database+'`');
 await db.query('CREATE TABLE PO_form_data(po_no VARCHAR(60) PRIMARY KEY,dispo_number VARCHAR(60),po_issue_date DATE,quantity DECIMAL(12,3)) ENGINE=InnoDB');
 await db.query('CREATE TABLE po_detail(id INT AUTO_INCREMENT PRIMARY KEY,po_no VARCHAR(60),line_no INT,quantity DECIMAL(12,3),UNIQUE KEY nk(po_no,line_no),FOREIGN KEY(po_no) REFERENCES PO_form_data(po_no)) ENGINE=InnoDB');
 await db.query('CREATE TABLE sheets_sync_events(profile VARCHAR(40),source_uid CHAR(64),group_key CHAR(64),digest CHAR(64),dispo VARCHAR(255),match_hash CHAR(64),yarn_identity LONGTEXT,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(profile,source_uid)) ENGINE=InnoDB');
 await db.query('CREATE TABLE erp_sync_row_changes(id INT AUTO_INCREMENT PRIMARY KEY,run_id VARCHAR(120),profile VARCHAR(40),source_uid VARCHAR(64),source_file VARCHAR(255),source_row INT,source_action VARCHAR(30),dispo VARCHAR(255),table_name VARCHAR(64),action VARCHAR(30),row_key TEXT,identity_scope VARCHAR(40),affected_rows INT,changed_columns TEXT,before_json LONGTEXT,after_json LONGTEXT,note TEXT) ENGINE=InnoDB');
 for(let i=0;i<42;i++)await db.query('INSERT INTO PO_form_data VALUES (?,?,?,?)',['OLD-'+i,'protected-'+i,'2025-08-01',100+i]);
 events=Array.from({length:14},(_,i)=>({uid:hash('old-'+i),group:hash('old-group-'+i),digest:hash('old-digest-'+i),dispo:'protected-'+i,matchHash:null,yarnIdentity:null}));
 for(const e of events)await db.query('INSERT INTO sheets_sync_events(profile,source_uid,group_key,digest,dispo) VALUES (?,?,?,?,?)',['po',e.uid,e.group,e.digest,e.dispo]);
 const [protectedBefore]=await db.query("SELECT * FROM PO_form_data WHERE po_no LIKE 'OLD-%' ORDER BY po_no");
 const protectedHash=hash(protectedBefore);
 const csvDir=path.join(fixture,'certified');write('certified/po.csv',[headers.join(','),values.join(',')].join('\n')+'\n');
 sourceFile=write('source-manifest.json',{certified:'fixture-source-only',files:[{name:'po.csv',sha256:hash(fs.readFileSync(path.join(csvDir,'po.csv')))}]});
 contractFile=write('mappings/mapping-contract-v2.json',contract);policyFile=write('protection-policy.json',policy);
 current=(await inventory(csvDir,[p])).po;
 const row=current.records[0];
 const owner=crypto.generateKeyPairSync('ed25519'),reviewer=crypto.generateKeyPairSync('ed25519');
 registryFile=write('lineage-reviewers.json',{version:1,reviewers:[
  {id:'owner-test',principalId:'test-person-A',role:'businessOwner',active:true,publicKeyPem:owner.publicKey.export({type:'spki',format:'pem'}),validFrom:at(now-60000),validUntil:at(now+3600000)},
  {id:'reviewer-test',principalId:'test-person-B',role:'secondReviewer',active:true,publicKeyPem:reviewer.publicKey.export({type:'spki',format:'pem'}),validFrom:at(now-60000),validUntil:at(now+3600000)}]});
 originalRegistry=fs.readFileSync(registryFile);
 write('protection.sha256',hash(originalRegistry)+'  lineage-reviewers.json\n');
 const targetHash=await targetAbsence(db,database,targetChecks(p,headers,values));
 const evidence={kind:'verified-independent-source-event-v2',profile:'po',group:row.group,digest:row.digest,dispo:row.dispo,businessDate:row.businessDate,sourceRowKey:row.key,sourceRowNumber:row.rowNumber,
  sourceManifestSha256:hash(fs.readFileSync(sourceFile)),productionLedgerSha256:ledgerFingerprint(events),targetAbsentPreimageSha256:targetHash,
  nativeRevisionReference:'TEST-ONLY-revision',immutableEventEvidenceReference:'TEST-ONLY-original-order',priorEventSearchEvidenceReference:'TEST-ONLY-prior-events',
  database,releaseId:'fixture-reviewed-release',contractSha256:hash(fs.readFileSync(contractFile)),protectionPolicySha256:hash(fs.readFileSync(policyFile)),windowStart:window.start,windowEnd:window.end,approvedAt:at(now-1000),expiresAt:at(now+600000)};
 const proof={evidence,signatures:{businessOwner:{id:'owner-test'},secondReviewer:{id:'reviewer-test'}}};
 proof.signatures.businessOwner.signature=crypto.sign(null,payloadFor(proof),owner.privateKey).toString('base64');
 proof.signatures.secondReviewer.signature=crypto.sign(null,payloadFor(proof),reviewer.privateKey).toString('base64');
 approval={version:2,database,businessWindow:window,createdAt:evidence.approvedAt,expiresAt:evidence.expiresAt,
  sourceManifestSha256:evidence.sourceManifestSha256,contractSha256:evidence.contractSha256,protectionPolicySha256:evidence.protectionPolicySha256,
  productionLedgerFingerprints:{po:ledgerFingerprint(events)},records:[proof]};
 inputFile=write('sync_data/approvals/reviewed-input.json',approval);
 loaderArgs={root:fixture,inputFile,inputSha256:hash(fs.readFileSync(inputFile)),sourceManifest:sourceFile,csvDir,contractPath:contractFile,policyPath:policyFile,database,window,clock:()=>clock.now};
 // File loader rejects scope drift, absence of hash pin, and forged signatures.
 assert.throws(()=>loadLineageInputs({...loaderArgs,inputSha256:hash('wrong')}),e=>e.code==='LINEAGE_FILE_HASH');testCount++;
 assert.throws(()=>loadLineageInputs({...loaderArgs,window:{start:window.start,end:'2026-10-15'}}),e=>e.code==='LINEAGE_INPUT_SCOPE');testCount++;
 clock.now=now+700000;assert.throws(()=>loadLineageInputs(loaderArgs),e=>e.code==='LINEAGE_EXPIRED');clock.now=now;testCount++;
 const forged=JSON.parse(JSON.stringify(approval));forged.records[0].signatures.secondReviewer.signature=forged.records[0].signatures.businessOwner.signature;
 write('sync_data/approvals/reviewed-input.json',forged);
 const bad=loadLineageInputs({...loaderArgs,inputSha256:hash(fs.readFileSync(inputFile))});
 await expectError(()=>bad.forProfile(p,current,events,db),'LINEAGE_SIGNATURE');
 write('sync_data/approvals/reviewed-input.json',approval);
 inputs=loadLineageInputs(loaderArgs);
 const contextForProfile=await inputs.forProfile(p,current,events,db);
 const base={headersHash:current.headersHash,records:events};
 plan=planEdits({po:base},{po:current});
 const exclusions=new SyncExclusions(events.map((e,i)=>({profile:'po',sourceUid:e.uid,digest:e.digest,dispo:e.dispo,lot:'held-lot-'+i})),'skip-dispos',contextForProfile);
 for(const d of policy.seedDispos)exclusions.dispos.add(d);
 exclusions.inspect('po',base,current,plan);exclusions.seal();exclusions.filter(plan);
 const qualified=qualifyRecoveryWindow(plan,window);
 plan.operations=qualified.authorizedOperations;plan.businessWindow=window;plan.productionLedgerFingerprints={po:ledgerFingerprint(events)};
 inputs.bindPlan(plan);
 assert.equal(plan.operations.po.length,1);assert.equal(plan.exclusions.verifiedIndependentInserts,1);assert.equal(plan.lineageInput.selectedProofKeys.length,1);testCount++;
 assert(policy.seedDispos.every(x=>plan.exclusions.dispos.includes(x)));testCount++;
 await assertLedgerFresh(db,plan);testCount++;
 await expectError(()=>assertLedgerFresh(db,{operations:plan.operations}),'SYNC_LEDGER_EVIDENCE_MISSING');
 const dry=await capture(),preimages=dry.sync.exportBusinessPreimages();
 const expanded=context(false,{businessPreimages:preimages});await expanded.sync.initialize(expanded);
 await db.beginTransaction();expanded.conn=db;expanded.currentSourceRowNumber=2;
 await expanded.sync.begin(expanded,p,{headers},values);
 await expectError(()=>runtime.upsertRow(expanded,p,'PO_form_data',{po_no:values[0],dispo_number:values[1],po_issue_date:values[2],quantity:25,unreviewed_extra_field:1}),'SYNC_EVIDENCE_FIELDS_CHANGED');
 await db.rollback();
 assert.equal(Object.values(preimages.records).flat().length,3);testCount++;
 const unavailable=context(false,{businessPreimages:preimages,lineageInputs:null});await unavailable.sync.initialize(unavailable);
 await assert.rejects(transaction(unavailable),/no live lineage-input connection/);testCount++;
 // A newly colliding target cannot slip in between approval and mutation.
 await db.beginTransaction();await db.query('INSERT INTO PO_form_data VALUES (?,?,?,?)',[values[0],values[1],values[2],999]);
 const changed=context(false,{businessPreimages:preimages});await changed.sync.initialize(changed);changed.conn=db;changed.currentSourceRowNumber=2;
 await expectError(()=>changed.sync.begin(changed,p,{headers},values),'LINEAGE_TARGET_EXISTS');await db.rollback();
 // The actual source event is now applied using the same modules the worker invokes.
 const live=context(false,{businessPreimages:preimages});await live.sync.initialize(live);await transaction(live);testCount++;
 await safety.assertNoUnreviewedTriggers({sync:{},pool:db,contract});testCount++;
 await db.beginTransaction();
 await expectError(()=>safety.assertReferencedKeysUnchanged({sync:{},dryRun:false,conn:db,schema},'PO_form_data',{po_no:'ILLEGAL-RENAME'},{po_no:values[0]}),'SYNC_REFERENCED_KEY_CHANGE');
 await db.rollback();
 const [[actual]]=await db.query('SELECT * FROM PO_form_data WHERE po_no=?',[values[0]]);assert.equal(actual.quantity,'25.000');
 const [children]=await db.query('SELECT * FROM po_detail WHERE po_no=? ORDER BY line_no',[values[0]]);assert.equal(children.length,2);assert.equal(children[0].quantity,'10.000');testCount++;
 const verify=await capture(true);assert.equal(verify.sync.business.targetsVerified,3);testCount++;
 const fresh=await capture();const replay=context(false,{businessPreimages:fresh.sync.exportBusinessPreimages()});await replay.sync.initialize(replay);await transaction(replay);
 const [[n]]=await db.query('SELECT COUNT(*) n FROM po_detail');assert.equal(n.n,2);testCount++;
 const [protectedAfter]=await db.query("SELECT * FROM PO_form_data WHERE po_no LIKE 'OLD-%' ORDER BY po_no");assert.equal(hash(protectedAfter),protectedHash);testCount++;
 await db.beginTransaction();await db.query('UPDATE po_detail SET quantity=99 WHERE id=?',[children[0].id]);
 await expectError(()=>capture(true),'SYNC_BUSINESS_VALUE_MISMATCH');await db.rollback();
 await db.beginTransaction();const c=context(false,{businessPreimages:preimages});c.conn=db;
 await expectError(()=>safety.reconcileChildren(c,p,'po_detail',{po_no:values[0]},[],{preview:()=>{},insert:()=>{},update:()=>{}}),'SYNC_CHILD_REMOVAL_REQUIRED');await db.rollback();
 for(const sql of ['DELETE FROM po_detail','TRUNCATE po_detail','REPLACE INTO po_detail VALUES(1)','CALL erase()'])assert.throws(()=>safety.assertAllowedSQL(sql));testCount++;
 const [[journal]]=await db.query("SELECT COUNT(*) total,SUM(action='deleted') deleted FROM erp_sync_row_changes");assert.equal(Number(journal.deleted),0);assert.equal(journal.total,3);testCount++;
 // Registry tampering is detected even after the input was initially loaded.
 fs.appendFileSync(registryFile,' ');assert.throws(()=>inputs.assertCurrent(),e=>e.code==='LINEAGE_EVIDENCE_CHANGED');fs.writeFileSync(registryFile,originalRegistry);testCount++;
 console.log(JSON.stringify({test:'integrated reviewed input to protected no-delete MySQL execution',passed:testCount,
  proofFileLoaded:true,realSignatureVerification:true,plannerReleasedOnlyReviewedEvent:true,
  signedDateWindow:window,protectedFixtureRows:42,explicitFixtureExclusions:14,
  businessRowsInserted:3,businessTargetsIndependentlyVerified:3,deletedBusinessRows:0,replayDuplicates:0,
  productionConnections:0,approvalKeys:'ephemeral fixture only'}));
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;}).finally(async()=>{
 if(db){if(created){try{await db.query('DROP DATABASE `'+database+'`');console.log('LOCAL_INTEGRATION_DATABASE_REMOVED');}catch(e){console.error('LOCAL_CLEANUP_FAILED '+e.message);process.exitCode=1}}await db.end();}
 fs.rmSync(fixture,{recursive:true,force:true});
});
