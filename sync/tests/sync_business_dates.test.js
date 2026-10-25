'use strict';
const assert=require('assert/strict'),os=require('os'),path=require('path'),fs=require('fs');
const {inventory}=require('../lib/sheets_sync_plan');
const {iterateCsvRows,dedupeHeaders}=require('../lib/csv_stream');
const ROOT=path.resolve(__dirname,'..');
const map={
 'pre-costing-bootstrap':'PO Issue Date',po:'PO Issue Date',dispo:'PO Received Date',
 'yarn-receive':'Received Date','yarn-issue':'Issue Date',warping:'Warping Date',
 sizing:'Sizing Date',loom:'Weaving Dates',folding:'Folding Production Date',
 'greige-delivery':'Delivery Date'
};
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sync-date-fields-'));
 try{
  const f=path.join(dir,'po.csv');
  fs.writeFileSync(f,'PO NO,PO Issue Date,DISPO NUMBER,__MIG_SOURCE_UID\nPO001,2026-10-14,NEW/26/01,transient\n');
  const p={id:'po',source_file:'po.csv',header_row:0};
  const x=(await inventory(dir,[p])).po.records;
  assert.equal(x.length,1);assert.equal(x[0].businessDate,'2026-10-14');
  assert(x[0].group&&x[0].digest&&x[0].key);
  fs.writeFileSync(f,'PO NO,DISPO NUMBER\nPO001,NEW/26/01\n');
  await assert.rejects(inventory(dir,[p]),/Missing business-date column/);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
 const identities={po:['PO NO'],'pre-costing-bootstrap':['PO NO'],dispo:['Dispo No.'],
  'yarn-receive':['Yarn Count','Yarn brand','Yarn Lot','Received GD NO','Challan No'],
  'yarn-issue':['Yarn Count','Yarn Lot','Dispo No','S/R/Challan No'],
  warping:['Dispo No','Warping Program No'],sizing:['Dispo No','Warping Program No'],
  loom:['Dispo No'],folding:['Dispo No'],'greige-delivery':['Dispo No','Challan No']};
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'sync-all-dates-'));
 try{
  let confirmed=0;
  for(const profile of require('../mappings/mapping-contract-v2.json').profiles){
   const headers=[...new Set([...identities[profile.id],map[profile.id]])];
   const values=headers.map(h=>h===map[profile.id]?'2026-10-14':'FIXTURE');
   const p={...profile,header_row:0,source_file:profile.id+'.csv'};
   fs.writeFileSync(path.join(fixture,p.source_file),[headers.join(','),values.join(',')].join('\n')+'\n');
   assert.equal((await inventory(fixture,[p]))[p.id].records[0].businessDate,'2026-10-14');confirmed++;
  }
  assert.equal(confirmed,10);
 }finally{fs.rmSync(fixture,{recursive:true,force:true});}
 console.log('PASS: business-date inventory field, missing-header rejection, 10 synthetic profile headers');
})().catch(e=>{console.error(e.stack||e.message);process.exitCode=1});
