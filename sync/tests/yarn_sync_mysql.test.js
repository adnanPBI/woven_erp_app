'use strict';
// Connection-scoped temporary tables only, in the existing isolated test DB.
const assert = require('assert');
const {cfg} = require('../scripts/local/db');
const {fingerprint, hash, planEdits} = require('../lib/sheets_sync_plan');
const {yarnIdentity, ensureIdentityColumn, hydrateIdentities, saveHydratedIdentities} = require('../lib/yarn_sync_identity');
const {SheetsSyncRuntime} = require('../lib/sheets_sync_runtime');
const {upsertProvenanceParent} = require('../lib/mapping_contract_runtime')._test;

(async()=>{
 const conn=await require('mysql2/promise').createConnection({...cfg(),database:'weavonpq_erp_sync_test',dateStrings:true});
 try {
  const [[db]]=await conn.query('SELECT DATABASE() name'); assert.equal(db.name,'weavonpq_erp_sync_test');
  await conn.query('CREATE TEMPORARY TABLE sheets_sync_events (profile varchar(40),source_uid char(64),group_key char(64),digest char(64),dispo varchar(255),match_hash char(64),updated_at timestamp DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(profile,source_uid)) ENGINE=InnoDB');
  await ensureIdentityColumn(conn);
  await ensureIdentityColumn(conn);
  await conn.query('CREATE TEMPORARY TABLE yarn_issue_form (id int AUTO_INCREMENT PRIMARY KEY,yarn_lot varchar(40),warp decimal(12,3),weft decimal(12,3)) ENGINE=InnoDB');
  await conn.query('CREATE TEMPORARY TABLE migration_import_provenance (id int AUTO_INCREMENT PRIMARY KEY,profile varchar(40),source_uid char(64),target_table varchar(80),target_primary_key varchar(40),source_manifest_sha256 varchar(80),source_file text,source_row_number int,action varchar(30),first_run_id varchar(80),last_run_id varchar(80),updated_at timestamp DEFAULT CURRENT_TIMESTAMP,UNIQUE KEY binding(profile,source_uid,target_table)) ENGINE=InnoDB');
  const headers=['Yarn Count','Yarn Lot','Issue Date','Dispo No','S/R/Challan No','Warp','Weft'];
  const profile={id:'yarn-issue'}, source=['30','001','2026-10-01','NHTML/26/123','C1','100',''];
  const record=(values)=>{const digest=fingerprint(headers,values);return {key:hash(digest),digest,group:hash('legacy-event'),uid:'csv-file-uid',rowNumber:2,dispo:values[3].toLowerCase(),yarnIdentity:yarnIdentity(profile.id,headers,values)};};
  const inv=records=>({[profile.id]:{headersHash:'schema',records}});
  const ctx={pool:conn,conn,dryRun:false,sourceManifestFileSha256:'fixture',currentSourceFile:'fixture.csv',currentSourceRowNumber:2,runId:'yarn-identity-test'};
  const apply=async(plan,values,fail=false)=>{
   ctx.sync=new SheetsSyncRuntime(plan,{},'fixture'); await ctx.sync.initialize(ctx);
   await conn.beginTransaction();
   try {
    if(await ctx.sync.begin(ctx,profile,{headers},values)){
     ctx.currentSourceUid=ctx.syncOperation.uid;
     await upsertProvenanceParent(ctx,profile,'yarn_issue_form',{yarn_lot:values[1],warp:Number(values[5]||0),weft:Number(values[6]||0)});
     await ctx.sync.finish(ctx,profile);
     if(fail)throw Error('simulated failure after ledger');
    }
    await conn.commit();
   }catch(error){await conn.rollback();throw error;}
  };
  const events=async()=>{const [rows]=await conn.query('SELECT source_uid uid,group_key `group`,digest,dispo,match_hash matchHash,yarn_identity yarnIdentity FROM sheets_sync_events');return rows;};
  let plan=planEdits(inv([]),inv([record(source)])); assert(plan.ok); await apply(plan,source);
  const [original]=await conn.query('SELECT * FROM yarn_issue_form'); assert.equal(original.length,1);
  // Exercise legacy metadata backfill using exact source fingerprints.
  await conn.query('UPDATE sheets_sync_events SET yarn_identity=NULL');
  const previous={records:await events()};
  await saveHydratedIdentities(conn,profile.id,hydrateIdentities(previous,{records:[record(source)]}));
  let before=inv(await events());
  const revised=[...source];revised[1]='002';revised[5]='-25';
  plan=planEdits(before,inv([record(revised)])); assert(plan.ok); assert.equal(plan.updated,1);assert.equal(plan.added,0);
  await apply(plan,revised);
  const [updated]=await conn.query('SELECT * FROM yarn_issue_form');assert.equal(updated.length,1);assert.equal(updated[0].id,original[0].id);assert.equal(Number(updated[0].warp),-25);assert.equal(updated[0].yarn_lot,'002');
  await apply(plan,revised);assert.equal((await conn.query('SELECT * FROM yarn_issue_form'))[0].length,1);
  before=inv(await events());plan=planEdits(before,inv([record(revised)]));assert(plan.ok);assert.equal(plan.added+plan.updated,0);
  const next=[...revised];next[5]='70';plan=planEdits(before,inv([record(next)]));assert(plan.ok);
  await assert.rejects(apply(plan,next,true),/simulated failure/);
  assert.deepEqual((await conn.query('SELECT * FROM yarn_issue_form'))[0],updated);assert.deepEqual(await events(),before[profile.id].records);
  await conn.query('DELETE FROM migration_import_provenance'); // Temporary fixture only.
  ctx.dryRun=true;await assert.rejects(apply(plan,next),/Missing tracked yarn binding/);
  ctx.dryRun=false;await assert.rejects(apply(plan,next),/Missing tracked yarn binding/);
  assert.equal((await conn.query('SELECT * FROM yarn_issue_form'))[0].length,1);
  console.log('MySQL temporary-table integration passed: identity upgrade, in-place lot/quantity correction, retry, no-op, atomic rollback and missing-binding refusal. Persistent business tables unchanged.');
 } finally {await conn.end();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
