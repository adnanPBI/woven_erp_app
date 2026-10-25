'use strict';
// Runs actual candidate write functions and checkpoint code only on new local fixtures.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),assert=require('assert/strict'),Module=require('module');
const mysql=require('mysql2/promise'),dotenv=require('dotenv');
const {fingerprint}=require('../lib/sheets_sync_plan');
const {SheetsSyncRuntime}=require('../lib/sheets_sync_runtime.repair');
const safety=require('../lib/sync_write_safety');
const ROOT=path.resolve(__dirname,'..'),runtimeFile=path.join(ROOT,'lib/mapping_contract_runtime.repair.js');
const m=new Module(runtimeFile,module);m.filename=runtimeFile;m.paths=Module._nodeModulePaths(path.dirname(runtimeFile));
m._compile(fs.readFileSync(runtimeFile,'utf8')+'\nmodule.exports.fixtureOnly={upsertRow,insertRow,updateRow,deleteChildren};',runtimeFile);
const runtime=m.exports.fixtureOnly;
const env=dotenv.parse(fs.readFileSync(process.env.SYNC_TEST_ENV||path.join(ROOT,'local_data/sync_package/local.env.sync'),'utf8'));
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const dbName='zz_sync_runtime_'+crypto.randomBytes(6).toString('hex');let db,created=false,cases=0;
const profile={id:'fixture',source_file:'fixture.csv',tables:[{name:'fixture_parent',natural_key:['code']},{name:'fixture_detail',natural_key:['parent_id'],parent:{parent_table:'fixture_parent',parent_id_field:'parent_id'}}]};
const schema={fixture_parent:{id:'int(11)',code:'varchar(30)',quantity:'decimal(12,3)',business_date:'date'},fixture_detail:{id:'int(11)',parent_id:'int(11)',quantity:'decimal(12,3)',business_date:'date'}};
const headers=['Code','Quantity'],data=[['one','15'],['two','8']],oldDigest=fingerprint(headers,['one','10']);
const ops=data.map((v,i)=>({uid:hash('source'+i),key:hash('source-row'+i),rowNumber:i+2,group:hash('group'+i),digest:fingerprint(headers,v),previousDigest:i===0?oldDigest:null,dispo:'UNHELD-FIXTURE',businessDate:'2026-10-01',action:i===0?'update':'insert'}));
const plan={ok:true,operations:{fixture:ops},businessWindow:{start:'2026-09-21',end:'2026-10-14'}};
const manifest=hash('fixture-only-manifest');
function context(dry,options={}){return {sync:new SheetsSyncRuntime(plan,{},manifest,options),dryRun:dry,pool:db,conn:null,schema,contract:{profiles:[profile]},sourceManifestFileSha256:manifest,provenancePolicy:{profiles:{}},cache:{lookups:new Map()},duplicateAggregation:{},preview:()=>{},reject:x=>{throw Error(JSON.stringify(x))},runId:'local-fixture',currentSourceDataset:'fixture',currentSourceFile:'fixture.csv'};}
async function execute(ctx,index){
 ctx.currentSourceRowNumber=index+2;ctx.currentSourceUid=ops[index].uid;ctx.currentSourceDataset='fixture';
 if(!await ctx.sync.begin(ctx,profile,{headers},data[index]))return;
 const parent={code:data[index][0],quantity:Number(data[index][1]),business_date:'2026-10-01'};
 const result=await runtime.upsertRow(ctx,profile,'fixture_parent',parent);
 const child={parent_id:result.id,quantity:parent.quantity,business_date:parent.business_date};
 await safety.reconcileChildren(ctx,profile,'fixture_detail',{parent_id:result.id},[child],{
  preview:r=>runtime.upsertRow(ctx,profile,'fixture_detail',r),
  insert:r=>runtime.insertRow(ctx,'fixture_detail',r),
  update:(r,w)=>runtime.updateRow(ctx,'fixture_detail',r,w)
 });
 await ctx.sync.finish(ctx,profile);
}
async function transaction(ctx,index){await db.beginTransaction();ctx.conn=db;const restore=safety.fenceConnection(db);try{await execute(ctx,index);await db.commit();}catch(e){await db.rollback();throw e;}finally{restore();ctx.conn=null;}}
async function capture(verifyOnly=false){const ctx=context(true,{verifyOnly});await ctx.sync.initialize(ctx);for(let i=0;i<data.length;i++)await execute(ctx,i);return ctx;}
(async()=>{
 if(!['localhost','127.0.0.1','::1'].includes(env.DB_HOST)||env.DB_NAME!=='weavonpq_weaving_sep22_preview')throw Error('Fixture is not the approved local MySQL endpoint');
 db=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME,dateStrings:true,multipleStatements:false});
 const [[identity]]=await db.query('SELECT DATABASE() db,@@hostname host');if(identity.db!==env.DB_NAME||identity.host.toLowerCase()!=='rnd')throw Error('Wrong fixture server');
 await db.query('CREATE DATABASE `'+dbName+'` CHARACTER SET utf8mb4');created=true;await db.query('USE `'+dbName+'`');
 await db.query('CREATE TABLE fixture_parent (id INT AUTO_INCREMENT PRIMARY KEY,code VARCHAR(30) UNIQUE NOT NULL,quantity DECIMAL(12,3),business_date DATE) ENGINE=InnoDB');
 await db.query('CREATE TABLE fixture_detail (id INT AUTO_INCREMENT PRIMARY KEY,parent_id INT UNIQUE NOT NULL,quantity DECIMAL(12,3),business_date DATE,FOREIGN KEY(parent_id) REFERENCES fixture_parent(id)) ENGINE=InnoDB');
 await db.query('CREATE TABLE sheets_sync_events(profile VARCHAR(40),source_uid CHAR(64),group_key CHAR(64),digest CHAR(64),dispo VARCHAR(255),match_hash CHAR(64),yarn_identity LONGTEXT,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(profile,source_uid)) ENGINE=InnoDB');
 await db.query('CREATE TABLE erp_sync_row_changes(id INT AUTO_INCREMENT PRIMARY KEY,run_id VARCHAR(120),profile VARCHAR(40),source_uid VARCHAR(64),source_file VARCHAR(255),source_row INT,source_action VARCHAR(30),dispo VARCHAR(255),table_name VARCHAR(64),action VARCHAR(30),row_key TEXT,identity_scope VARCHAR(40),affected_rows INT,changed_columns TEXT,before_json LONGTEXT,after_json LONGTEXT,note TEXT) ENGINE=InnoDB');
 await db.query("INSERT INTO fixture_parent (id,code,quantity,business_date) VALUES (1,'one',10,'2026-10-01')");await db.query("INSERT INTO fixture_detail (id,parent_id,quantity,business_date) VALUES (10,1,10,'2026-10-01')");
 await db.query('INSERT INTO sheets_sync_events(profile,source_uid,group_key,digest,dispo) VALUES (?,?,?,?,?)',['fixture',ops[0].uid,ops[0].group,oldDigest,ops[0].dispo]);
 const dry=await capture();const bundle=JSON.parse(JSON.stringify(dry.sync.exportBusinessPreimages()));assert.equal(Object.values(bundle.records).flat().length,4);cases++;
 // A direct ERP edit after qualification must not be overwritten.
 await db.query("UPDATE fixture_parent SET quantity=99 WHERE id=1");let live=context(false,{businessPreimages:bundle});await live.sync.initialize(live);await assert.rejects(transaction(live,0),e=>e.code==='SYNC_BUSINESS_PREIMAGE_CHANGED');const [[unchanged]]=await db.query('SELECT quantity FROM fixture_parent WHERE id=1');assert.equal(unchanged.quantity,'99.000');cases++;
 await db.query('UPDATE fixture_parent SET quantity=10 WHERE id=1');live=context(false,{businessPreimages:bundle});await live.sync.initialize(live);await transaction(live,0);await transaction(live,1);cases++;
 const [parents]=await db.query('SELECT * FROM fixture_parent ORDER BY id');const [children]=await db.query('SELECT * FROM fixture_detail ORDER BY id');assert.equal(parents.length,2);assert.equal(children.length,2);assert.equal(children[0].id,10);assert.equal(children[0].quantity,'15.000');cases++;
 const verify=await capture(true);assert.equal(verify.sync.business.targetsVerified,4);cases++;
 // Requalify committed operations before replay; check actual mapped values, not only ledger digests.
 const again=await capture();const replay=context(false,{businessPreimages:again.sync.exportBusinessPreimages()});await replay.sync.initialize(replay);await transaction(replay,0);await transaction(replay,1);const [[n]]=await db.query('SELECT COUNT(*) n FROM fixture_detail');assert.equal(n.n,2);cases++;
 await db.query('UPDATE fixture_detail SET quantity=999 WHERE id=10');await assert.rejects(capture(true),e=>e.code==='SYNC_BUSINESS_VALUE_MISMATCH');cases++;
 const [[journal]]=await db.query("SELECT COUNT(*) total,SUM(action='deleted') deleted FROM erp_sync_row_changes");assert.equal(Number(journal.deleted),0);assert.equal(journal.total,4);cases++;
 // A refresh deliberately recomputes derived values even with an unchanged
 // source digest. It must capture drift, not mistake it for a completed replay.
 ops[0].action='refresh';ops[0].previousDigest=ops[0].digest;
 const refreshDry=await capture(),refreshLive=context(false,{businessPreimages:refreshDry.sync.exportBusinessPreimages()});
 await refreshLive.sync.initialize(refreshLive);await transaction(refreshLive,0);
 assert.equal((await db.query('SELECT quantity FROM fixture_detail WHERE id=10'))[0][0].quantity,'15.000');cases++;
 const currentDry=await capture(),currentLive=context(false,{businessPreimages:currentDry.sync.exportBusinessPreimages()});
 await currentLive.sync.initialize(currentLive);
 const beforeNoop=(await db.query('SELECT COUNT(*) n FROM erp_sync_row_changes'))[0][0].n;
 await transaction(currentLive,0);
 assert.equal(currentLive.sync.unchangedRefreshes,1);
 assert.equal((await db.query('SELECT COUNT(*) n FROM erp_sync_row_changes'))[0][0].n,beforeNoop);cases++;
 // Changes made after qualification must still fail even on the skip path.
 await db.query('UPDATE fixture_detail SET quantity=77 WHERE id=10');
 await assert.rejects(transaction(currentLive,0),{code:'SYNC_BUSINESS_VALUE_MISMATCH'});
 assert.equal((await db.query('SELECT quantity FROM fixture_detail WHERE id=10'))[0][0].quantity,'77.000');
 await db.query('UPDATE fixture_detail SET quantity=15 WHERE id=10');cases++;
 await db.query('CREATE TABLE pre_costing_data(pre_costing_no VARCHAR(40) PRIMARY KEY,weave_type VARCHAR(40)) ENGINE=InnoDB');
 await db.query("INSERT INTO pre_costing_data VALUES ('C1','existing costing')");
 const costProfile={id:'pre-costing-bootstrap',tables:[{name:'pre_costing_data',natural_key:['pre_costing_no']}]};
 const costCtx=context(true);costCtx.contract={profiles:[costProfile]};costCtx.schema.pre_costing_data={pre_costing_no:'varchar(40)',weave_type:'varchar(40)'};
 costCtx.syncOperation={uid:'new-po',action:'insert'};
 assert.equal((await runtime.upsertRow(costCtx,costProfile,'pre_costing_data',{pre_costing_no:'C1',weave_type:'PO fallback'})).action,'preserved_shared_master');
 assert.equal((await db.query("SELECT weave_type FROM pre_costing_data WHERE pre_costing_no='C1'"))[0][0].weave_type,'existing costing');cases++;
 await db.query('CREATE TABLE historical_child(id INT PRIMARY KEY,parent_id INT,serial INT,quantity DECIMAL(12,3),UNIQUE(parent_id,serial)) ENGINE=InnoDB');
 await db.query('INSERT INTO historical_child VALUES (1,1,1,10),(2,1,2,9)');
 const historyProfile={id:'fixture',tables:[{name:'historical_child',natural_key:['parent_id','serial']}]};
 const historyCtx={sync:{plan:{missingRowPolicy:'retain-history'}},dryRun:false,conn:db,schema:{historical_child:{id:'int',parent_id:'int',serial:'int',quantity:'decimal(12,3)'}}};
 const desired=[{parent_id:1,serial:1,quantity:15}];
 await safety.reconcileChildren(historyCtx,historyProfile,'historical_child',{parent_id:1},desired,{update:async(row,key)=>{await db.query('UPDATE historical_child SET quantity=? WHERE id=?',[row.quantity,key.id]);},insert:()=>{throw Error('Unexpected insert');}});
 assert.equal((await db.query('SELECT quantity FROM historical_child WHERE id=2'))[0][0].quantity,'9.000');
 assert.equal(historyCtx.sync.retainedChildren.length,1);cases++;
 await assert.rejects(runtime.deleteChildren({sync:{},dryRun:true},'fixture_detail',{parent_id:1}),e=>e.code==='SYNC_DELETE_FORBIDDEN');cases++;
 for(const forbidden of ['DELETE FROM detail','TRUNCATE detail','REPLACE INTO detail VALUES(1)','CALL unsafe()','SELECT 1; DELETE FROM detail','/*! DELETE FROM detail */'])assert.throws(()=>safety.assertAllowedSQL(forbidden),e=>e.code==='SYNC_SQL_FORBIDDEN');cases++;
 // Same event references may have distinct warp/weft parents. Scope absence
 // by direction while still rejecting an intervening same-direction insert.
 await db.query('CREATE TABLE yarn_issue_form(id INT PRIMARY KEY,code VARCHAR(20),total_warp_issue_kgs DECIMAL(12,3) DEFAULT 0,total_weft_issue_kgs DECIMAL(12,3) DEFAULT 0)');
 await db.query("INSERT INTO yarn_issue_form VALUES (1,'same-event',10,0)");
 const {BusinessEvidence}=require('../lib/sync_business_evidence');
 const issueCtx={conn:db,schema:{yarn_issue_form:{code:'varchar(20)',total_warp_issue_kgs:'decimal(12,3)',total_weft_issue_kgs:'decimal(12,3)'}}};
 const issueData={code:'same-event',total_warp_issue_kgs:0,total_weft_issue_kgs:20};
 const issueDry=new BusinessEvidence('p','m');issueDry.begin('yarn-issue','weft');
 assert.equal(await issueDry.capture(issueCtx,'yarn_issue_form',issueData,['code'],'weft'),null);
 const issueLive=new BusinessEvidence('p','m','apply',issueDry.export());issueLive.begin('yarn-issue','weft');
 await issueLive.beforeMutation(issueCtx,'insert','yarn_issue_form',issueData);issueLive.finish();
 await db.query("INSERT INTO yarn_issue_form VALUES (2,'same-event',0,19)");
 issueLive.begin('yarn-issue','weft');
 await assert.rejects(issueLive.beforeMutation(issueCtx,'insert','yarn_issue_form',issueData),{code:'SYNC_BUSINESS_PREIMAGE_CHANGED'});cases++;
 // Outside issues have both direction quantities zero but may be different
 // yarn specifications. An identical specification must still block a race.
 await db.query('ALTER TABLE yarn_issue_form ADD yarn_type VARCHAR(30), ADD yarn_composition VARCHAR(100)');
 await db.query("INSERT INTO yarn_issue_form VALUES (3,'outside',0,0,'KW','BCI Cotton')");
 const outsideData={code:'outside',yarn_type:'KW',yarn_composition:'Organic Cotton'};
 const outsideDry=new BusinessEvidence('p','m');outsideDry.begin('yarn-issue','organic');
 assert.equal(await outsideDry.capture(issueCtx,'yarn_issue_form',outsideData,['code','yarn_type','yarn_composition'],'warp+weft'),null);
 const outsideLive=new BusinessEvidence('p','m','apply',outsideDry.export());outsideLive.begin('yarn-issue','organic');
 await outsideLive.beforeMutation(issueCtx,'insert','yarn_issue_form',outsideData);outsideLive.finish();
 await db.query("INSERT INTO yarn_issue_form VALUES (4,'outside',0,0,'KW','Organic Cotton')");
 outsideLive.begin('yarn-issue','organic');
 await assert.rejects(outsideLive.beforeMutation(issueCtx,'insert','yarn_issue_form',outsideData),{code:'SYNC_BUSINESS_PREIMAGE_CHANGED'});cases++;
 // Four source delivery entries on one challan must retain separate parents.
 await db.query('CREATE TABLE greige_delivery_form(id INT AUTO_INCREMENT PRIMARY KEY,challan_no VARCHAR(20),total_no_of_than_roll INT,delivery_quantity_a_grade DECIMAL(12,2))');
 const deliveryCtx={conn:db,schema:{greige_delivery_form:{challan_no:'varchar(20)',total_no_of_than_roll:'int',delivery_quantity_a_grade:'decimal(12,2)'}}};
 const deliveries=[[22,4217],[20,3964],[7,1441],[22,4114]].map(([rolls,quantity])=>({challan_no:'shared',total_no_of_than_roll:rolls,delivery_quantity_a_grade:quantity}));
 const deliveryDry=new BusinessEvidence('p','m');
 for(let i=0;i<deliveries.length;i++){
  deliveryDry.begin('greige-delivery',String(i));
  assert.equal(await deliveryDry.capture(deliveryCtx,'greige_delivery_form',deliveries[i],Object.keys(deliveries[i])),null);
 }
 const deliveryLive=new BusinessEvidence('p','m','apply',deliveryDry.export());
 for(let i=0;i<deliveries.length;i++){
  deliveryLive.begin('greige-delivery',String(i));
  await deliveryLive.beforeMutation(deliveryCtx,'insert','greige_delivery_form',deliveries[i]);deliveryLive.finish();
  await db.query('INSERT INTO greige_delivery_form(challan_no,total_no_of_than_roll,delivery_quantity_a_grade) VALUES (?,?,?)',Object.values(deliveries[i]));
 }
 assert.equal((await db.query('SELECT COUNT(*) n FROM greige_delivery_form'))[0][0].n,4);
 deliveryLive.begin('greige-delivery','0');
 await assert.rejects(deliveryLive.beforeMutation(deliveryCtx,'insert','greige_delivery_form',deliveries[0]),{code:'SYNC_BUSINESS_PREIMAGE_CHANGED'});cases++;
 // Distinct amounts in the same issue direction keep separate audit rows.
 const siblings=[10,20].map(total_warp_issue_kgs=>({code:'audit-warp',total_warp_issue_kgs,total_weft_issue_kgs:0}));
 const siblingDry=new BusinessEvidence('p','m');
 for(let i=0;i<siblings.length;i++){siblingDry.begin('yarn-issue','amount'+i);await siblingDry.capture(issueCtx,'yarn_issue_form',siblings[i],Object.keys(siblings[i]),'warp');}
 const siblingLive=new BusinessEvidence('p','m','apply',siblingDry.export());
 for(let i=0;i<siblings.length;i++){siblingLive.begin('yarn-issue','amount'+i);await siblingLive.beforeMutation(issueCtx,'insert','yarn_issue_form',siblings[i]);siblingLive.finish();await db.query('INSERT INTO yarn_issue_form(id,code,total_warp_issue_kgs,total_weft_issue_kgs) VALUES (?,?,?,?)',[10+i,...Object.values(siblings[i])]);}
 assert.equal((await db.query("SELECT COUNT(*) n FROM yarn_issue_form WHERE code='audit-warp'"))[0][0].n,2);cases++;
 const [[ledgerCount]]=await db.query('SELECT COUNT(*) n FROM sheets_sync_events');assert.equal(ledgerCount.n,2);
 console.log(JSON.stringify({test:'actual importer SQL plus source/ledger/business evidence',passed:cases,parentAndChildTargets:4,auditedBusinessMutations:journal.total,deletedBusinessRows:0,replayCreatedDuplicates:0,concurrentEditProtected:true,independentDriftDetection:true,productionConnections:0}));
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;}).finally(async()=>{if(db){if(created){try{await db.query('DROP DATABASE `'+dbName+'`');console.log('DISPOSABLE_RUNTIME_FIXTURE_REMOVED');}catch(e){console.error('LOCAL_TEST_CLEANUP_FAILED '+e.message);process.exitCode=1}}await db.end();}});
