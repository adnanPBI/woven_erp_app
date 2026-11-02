'use strict';
const {test}=require('node:test'),assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {inventory,planEdits}=require('../lib/sheets_sync_plan'),{scopeHistory}=require('../lib/sync_history_policy');
const profile={id:'folding',source_file:'folding.csv'},window={start:'2026-09-22',end:'2026-11-02'};
test('bounded streaming inventory retains complete selected records and duplicate ordinals with every source group',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'window-inventory-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const rows=[['Folding Production Date','Dispo No','A-Grade'],['2024-01-01','YT/OLD/24/0001','9'],['2026-09-22','YT/NEW/26/0002','3'],['2026-09-22','YT/NEW/26/0002','3'],['2026-11-02','NH/NEW/26/0003','4'],['2026-11-03','NH/FUTURE/26/0004','5']];fs.writeFileSync(path.join(dir,profile.source_file),rows.map(r=>r.join(',')).join('\n'));
 const full=(await inventory(dir,[profile]))[profile.id],bounded=(await inventory(dir,[profile],{window}))[profile.id];
 assert.equal(bounded.headersHash,full.headersHash);assert.deepEqual(bounded.records,full.records.filter(r=>r.businessDate>=window.start&&r.businessDate<=window.end));assert.equal(bounded.records.length,3);assert.equal(bounded.fullGroups.size,4);assert.equal(new Set(bounded.records.map(r=>r.key)).size,3);
 const previous={...full,records:full.records.map((r,i)=>({...r,uid:'old-'+i}))};
 const legacy=scopeHistory(previous,full,window.start,window.end),reduced=scopeHistory(previous,bounded,window.start,window.end);
 assert.deepEqual(reduced.previous,legacy.previous);assert.deepEqual(reduced.current.records,legacy.current.records);assert.deepEqual(planEdits({folding:reduced.previous},{folding:reduced.current},[],{refreshAll:true}),planEdits({folding:legacy.previous},{folding:legacy.current},[],{refreshAll:true}));
 // A genuinely missing historical group must still reach the normal review
 // guard; a present older group must not become a false deletion conflict.
 const absent={...previous.records[0],uid:'missing',group:'missing-group',digest:'missing-digest'};const a=scopeHistory({...previous,records:[...previous.records,absent]},bounded,window.start,window.end);assert(a.previous.records.some(r=>r.uid==='missing'));assert(!a.previous.records.some(r=>r.uid==='old-0'));
 await assert.rejects(inventory(dir,[profile],{window:{start:'2026-11-03',end:'2026-11-02'}}),/Invalid inventory date window/);
});
test('historical payload volume does not enter a bounded window inventory',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'window-history-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const lines=['Folding Production Date,Dispo No,A-Grade'];for(let i=0;i<12000;i++)lines.push('2024-01-01,YT/OLD/24/'+String(i).padStart(6,'0')+',1');lines.push('2026-10-31,YT/CURRENT/26/000001,343');fs.writeFileSync(path.join(dir,profile.source_file),lines.join('\n'));
 const actual=(await inventory(dir,[profile],{window}))[profile.id];assert.equal(actual.records.length,1);assert.equal(actual.records[0].rowNumber,12002);assert.equal(actual.fullGroups.size,12001);
});
