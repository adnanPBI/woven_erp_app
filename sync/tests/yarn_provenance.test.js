'use strict';
const assert=require('assert/strict'),crypto=require('crypto');
const {recoverFromVerifiedProvenance,eventKey}=require('../lib/yarn_sync_identity');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const issue={uid:'original-uid',digest:'1'.repeat(64),dispo:'sw/ndsd/gd/26/1',
 group:hash(['yarn-issue','30','167','2026-09-23','sw/ndsd/gd/26/1','ch012'])};
const issueLink={profile:'yarn-issue',source_uid:'original-uid',target_table:'yarn_issue_form',
 target_primary_key:'10'};
const form={id:10,yarn_count:'30',yarn_lot:'167',issue_challan_no:'CH012',
 total_warp_issue_kgs:'3500',total_weft_issue_kgs:'0'};
const detail={id:100,yarn_issue_form_id:10,dispo_number:'SW/NDSD/GD/26/1',
 issue_date:'2026-09-23',issued_quantity:'3500'};
const x=recoverFromVerifiedProvenance('yarn-issue',issue,issueLink,form,detail);
assert(x.ok);assert.equal(x.identity.direction,'warp');assert.equal(x.targetPrimaryKey,'10');
assert.equal(x.requiresIndependentReview,true);assert(eventKey(x.identity));
assert.equal(recoverFromVerifiedProvenance('yarn-issue',issue,issueLink,
 {...form,total_warp_issue_kgs:'3500',total_weft_issue_kgs:'300'},detail).reason,
 'warp_weft_direction_ambiguous');
assert.equal(recoverFromVerifiedProvenance('yarn-issue',issue,issueLink,form,
 {...detail,issue_date:'2026-09-24'}).reason,'historical_group_digest_mismatch');
assert.equal(recoverFromVerifiedProvenance('yarn-issue',issue,issueLink,form,
 {...detail,dispo_number:'different'}).reason,'dispo_preimage_mismatch');
assert.equal(recoverFromVerifiedProvenance('yarn-issue',issue,
 {...issueLink,target_primary_key:'999'},form,detail).reason,
 'provenance_target_mismatch');
const received={uid:'receipt-uid',digest:'2'.repeat(64),dispo:'yt/ndsd/gd/26/25',
 group:hash(['yarn-receive','34','cotton mills','l01','2026-10-09','yt/ndsd/gd/26/25','cl05'])};
const receiveLink={profile:'yarn-receive',source_uid:'receipt-uid',target_table:'yarn_receive_form',
 target_primary_key:'20'};
const receiveForm={id:20,yarn_count:'34',yarn_brand:'Cotton Mills',yarn_lot:'L01',
 challan_no:'CL05'};
const receiveDetail={id:101,yarn_receive_form_id:20,dispo_number:'YT/NDSD/GD/26/25',
 received_date:'2026-10-09'};
const y=recoverFromVerifiedProvenance('yarn-receive',received,receiveLink,
 receiveForm,receiveDetail);
assert(y.ok);assert.equal(y.identity.direction,'receipt');
assert.equal(recoverFromVerifiedProvenance('yarn-receive',received,receiveLink,
 {...receiveForm,yarn_brand:'wrong brand'},receiveDetail).reason,
 'historical_group_digest_mismatch');
console.log('PASS: exact historical group, provenance PK, child Dispo and warp/weft safety checks.');
