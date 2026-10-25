'use strict';
const assert=require('assert/strict');
const {planEdits}=require('../lib/sheets_sync_plan');
const row={uid:'issue',key:'key',group:'group',digest:'digest',dispo:'different-dispo',rowNumber:2,
 yarnIdentity:{version:1,dispo:'different-dispo',count:'20',lot:'001',direction:'warp',date:'2026-10-01',challan:'1'}};
const input={'yarn-issue':{headersHash:'headers',records:[row]}};
assert.equal(planEdits(input,input,[],{refreshLots:['001']}).refreshed,1);
assert.equal(planEdits(input,input,[],{refreshLots:['1']}).refreshed,0);
assert.equal(planEdits(input,input).refreshed,0);
assert.equal(planEdits(input,input,[],{refreshAll:true}).refreshed,1);
const blank={'yarn-issue':{headersHash:'headers',records:[{...row,dispo:'',yarnIdentity:null}]}};
assert.equal(planEdits(blank,blank,[],{refreshAll:true}).refreshed,1);
console.log('Cross-Dispo lot refresh, significant leading zeros and full-window refresh passed');
