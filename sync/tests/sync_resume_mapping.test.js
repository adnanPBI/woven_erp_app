'use strict';
const assert=require('assert/strict');
const {BusinessEvidence}=require('../lib/sync_business_evidence');
const {buildTableRows}=require('../lib/mapping_contract_runtime.repair')._test;
(async()=>{
 const {canonical}=require('../lib/sync_write_safety');
 for(const [input,expected] of [[0.015,'0.02'],[-0.015,'-0.02'],[1.005,'1.01'],[2.675,'2.68'],[1e-7,'0.00']])assert.equal(canonical(input,'decimal(10,2)'),expected);
 const p={id:'po',tables:[{name:'PO_form_data'}],mappings:[
  {table:'PO_form_data',field:'order_status',type:'direct',source_column:'DOCUMENT STATUS',target_type:"enum('pending','approved','cancelled')"},
  {table:'PO_form_data',field:'special_note',type:'direct',source_column:'Special Note',target_type:'text'}]};
 const info={normalizedMap:new Map([['DOCUMENT STATUS',0],['Special Note',1]])};
 const note=(await buildTableRows({sync:{}},p,info,['IMPORT GREY','Keep packing note'])).PO_form_data;
 assert.equal(note.special_note,'Keep packing note\nDOCUMENT STATUS: IMPORT GREY');
 assert.equal(Object.hasOwn(note,'order_status'),false);
 const valid=(await buildTableRows({sync:{}},p,info,['Approved','Keep packing note'])).PO_form_data;
 assert.equal(valid.order_status,'approved');assert.equal(valid.special_note,'Keep packing note');
 const captured=new BusinessEvidence('plan','manifest');captured.begin('bootstrap','uid');
 const applied=new BusinessEvidence('plan','manifest','apply',captured.export());applied.begin('bootstrap','uid');
 await applied.verifyReplay({});applied.finish();
 applied.begin('bootstrap','missing');await assert.rejects(applied.verifyReplay({}),{code:'SYNC_REPLAY_EVIDENCE_MISSING'});
 const {upsertProvenanceParent}=require('../lib/mapping_contract_runtime.repair')._test;
 const issueProfile={id:'yarn-issue',tables:[{name:'yarn_issue_form',natural_key:['yarn_count','yarn_lot']}]};
 let binding=[],issueCaptured;
 const issueCtx={dryRun:true,currentSourceUid:'source',pool:{query:async()=>[binding]},preview:()=>{},
  syncOperation:{action:'insert',yarnIdentity:{direction:''}},
  sync:{captureTarget:async(ctx,table,data,keys,scope)=>{issueCaptured={keys,scope};return null;}}};
 await upsertProvenanceParent(issueCtx,issueProfile,'yarn_issue_form',{yarn_count:'16',yarn_lot:'lot',yarn_type:'KW',yarn_composition:'Organic Cotton'});
 assert.deepEqual(issueCaptured,{keys:['yarn_count','yarn_lot','yarn_type','yarn_composition'],scope:'warp+weft'});
 binding=[{target_primary_key:123}];issueCtx.syncOperation.alreadyApplied=true;
 await upsertProvenanceParent(issueCtx,issueProfile,'yarn_issue_form',{yarn_count:'16',yarn_lot:'lot',yarn_type:'KW',yarn_composition:'Organic Cotton'});
 assert.deepEqual(issueCaptured,{keys:['id'],scope:undefined});
 binding=[];issueCtx.syncOperation={action:'insert'};
 const deliveryProfile={id:'greige-delivery',tables:[{name:'greige_delivery_form',natural_key:['dispo_number','delivery_date','challan_no']}]};
 const deliveryData={dispo_number:'D',delivery_date:'2026-10-11',challan_no:'C',total_no_of_than_roll:20,delivery_quantity_a_grade:3964};
 await upsertProvenanceParent(issueCtx,deliveryProfile,'greige_delivery_form',{...deliveryData});
 assert.deepEqual(issueCaptured,{keys:['dispo_number','delivery_date','challan_no','total_no_of_than_roll','delivery_quantity_a_grade'],scope:undefined});
 binding=[{target_primary_key:70000}];issueCtx.syncOperation={action:'update'};
 await upsertProvenanceParent(issueCtx,deliveryProfile,'greige_delivery_form',{...deliveryData});
 assert.deepEqual(issueCaptured,{keys:['id'],scope:undefined});
 const emptyDb={pool:{query:async()=>[[]]}};
 const tooLong=new BusinessEvidence('p','m');tooLong.begin('fixture','long');
 await assert.rejects(tooLong.capture({...emptyDb,databaseColumnTypes:{fixture:{code:'varchar(3)'}}},'fixture',{code:'four'},['code']),{code:'SYNC_MAPPED_VALUE_TOO_LONG'});
 await tooLong.capture({...emptyDb,databaseColumnTypes:{fixture:{code:'varchar(4)'}}},'fixture',{code:'four'},['code']);
 const reservations=new BusinessEvidence('p','m');
 reservations.begin('greige-delivery','first');
 await reservations.capture(emptyDb,'greige_delivery_form',{challan_no:'shared',quantity:10},['challan_no']);
 reservations.begin('greige-delivery','second');
 await assert.rejects(reservations.capture(emptyDb,'greige_delivery_form',{challan_no:'shared',quantity:20},['challan_no']),{code:'SYNC_PLANNED_TARGET_COLLISION'});
 // Separate physical selectors and direction scopes remain independent.
 await reservations.capture(emptyDb,'greige_delivery_form',{challan_no:'other',quantity:20},['challan_no']);
 reservations.begin('yarn-issue','warp');
 await reservations.capture(emptyDb,'yarn_issue_form',{code:'same'},['code'],'warp');
 reservations.begin('yarn-issue','weft');
 await reservations.capture(emptyDb,'yarn_issue_form',{code:'same'},['code'],'weft');
 console.log('PO notes, enum mapping, evidence replay, issue specification selectors and planned absence collision checks passed');
})().catch(e=>{console.error(e);process.exitCode=1});
