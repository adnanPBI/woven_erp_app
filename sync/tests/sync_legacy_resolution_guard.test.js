'use strict';
const assert=require('assert/strict');
const {DispoResolutionService}=require('../lib/dispo_resolution');
(async()=>{
 let sqlCalls=0;
 const ctx={sync:{},dryRun:false,pool:{query:()=>{sqlCalls++;throw Error('No database writes permitted in this test');}},conn:{query:()=>{sqlCalls++;throw Error('No database writes permitted in this test');}},sourceIndex:{dispoMaster:()=>null}};
 const resolver=new DispoResolutionService(ctx);
 await assert.rejects(resolver.createApprovedPlaceholder({approved_by:'fixture',approved_at:'2026-10-14'},{}),e=>e.code==='SYNC_UNPLANNED_PLACEHOLDER');
 resolver.loaded=true;resolver.findCurrentMaster=async()=>null;
 resolver.findManual=()=>({action_mode:'relink_to_existing_master',resolved_dispo_number:'OTHER',status:'approved'});
 await assert.rejects(resolver.resolve({profileId:'folding',sourceTable:'folding_production_form',rawDispo:'ORIGINAL'}),e=>e.code==='SYNC_UNQUALIFIED_LEGACY_RESOLUTION');
 assert.equal(sqlCalls,0);
 ctx.sourceIndex.dispoMaster=()=>({dispoNumber:'EXISTING-CERTIFIED'});
 assert.equal(await resolver.resolve({profileId:'folding',sourceTable:'folding_production_form',rawDispo:'EXISTING-CERTIFIED'}),'EXISTING-CERTIFIED');
 assert.equal(sqlCalls,0);
 console.log('PASS: unplanned placeholders and implicit manual relinks cannot bypass the qualified write path; ordinary certified-master lookup remains read-only');
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
