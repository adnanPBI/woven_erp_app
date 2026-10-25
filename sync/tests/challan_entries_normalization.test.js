'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const {iterateCsvRows}=require('../lib/csv_stream');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'challan-entries-')),raw=path.join(dir,'raw'),out=path.join(dir,'out');fs.mkdirSync(raw);
 const write=(name,headers,rows)=>fs.writeFileSync(path.join(raw,name),[headers,...rows].map(r=>r.join(',')).join('\n')+'\n');
 try{
  const dispo='NH/FIXTURE/26/001',date='2026-10-01';
  write('po database.csv',['PO NO','PO Issue Date'],[['FIXTURE-PO',date]]);
  write('Dispo create form.csv',['Dispo No.','PO NO','PO Received Date'],[[dispo,'FIXTURE-PO',date]]);
  write('Greige yarn receive.csv',['Yarn Count','Yarn Lot','Received Date','Received GD NO','Challan No','Receipt Qty (Kgs)'],[100,30].map(n=>['20','LOT',date,dispo,'SHARED',n]));
  write('Greige yarn issue.csv',['Yarn Count','Yarn Lot','Issue Date','Dispo No','S/R/Challan No','Warp','Weft','Out Side'],[100,30].map(n=>['20','LOT',date,dispo,'SHARED',n,'','']));
  write('Warping database.csv',['Dispo No','Warping Date'],[[dispo,date]]);
  write('sizing database.csv',['Dispo No','Sizing Date'],[[dispo,date]]);
  write('Loom production database.csv',['Dispo No','Weaving Dates'],[[dispo,date]]);
  write('Folding production database.csv',['Dispo No','Folding Production Date'],[[dispo,date]]);
  write('Greige delivery database.csv',['Dispo No','Delivery Date','Challan No','A-Grade'],[100,30,20,10].map(n=>[dispo,date,'SHARED',n]));
  const run=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/v3/normalize_sources_v323.js'),'--input='+raw,'--output='+out],{encoding:'utf8',windowsHide:true});
  assert.equal(run.status,0,run.stderr||run.stdout);
  for(const [file,column,amounts]of [['Greige yarn receive.csv','Receipt Qty (Kgs)',[100,30]],['Greige yarn issue.csv','Warp',[100,30]],['Greige delivery database.csv','A-Grade',[100,30,20,10]]]){
   let headers;const actual=[];
   for await(const row of iterateCsvRows(path.join(out,'certified',file))){if(!headers){headers=row.values;continue;}actual.push(Number(row.values[headers.indexOf(column)]));}
   assert.deepEqual(actual,amounts,file+' must retain separate amounts under one challan/Dispo/date');
  }
  console.log('PASS: actual nine-file normalization preserves simultaneous receipt, issue and delivery amounts');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
