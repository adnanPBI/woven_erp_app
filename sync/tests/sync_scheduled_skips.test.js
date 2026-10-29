'use strict';
const assert=require('assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {rebindPolicy,qualifyScheduledSkips}=require('../lib/sync_scheduled_skips'),{loadManualSkips,verifyRetained,applyReceiptTotals}=require('../lib/sync_manual_conflict_skips'),{assertProtected}=require('../lib/hosted_protection_guard');
const hex=n=>n.toString(16).padStart(64,'0'),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),copy=x=>JSON.parse(JSON.stringify(x));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'scheduled-skip-'));
(async()=>{try{
 const anchors=Array.from({length:6},(_,i)=>({profile:i===5?'yarn-issue':'yarn-receive',uid:hex(i+1),digest:hex((i===2?1:i)+20),group:hex((i===2?1:i)+40),rowNumber:i+2,businessDate:'2026-10-15'}));
 const lots=['a','b','b','c','d','a'],base={version:2,mode:'owner-authorized-exact-skips',automaticRestartAuthorized:false,database:'weavonpq_weaving_main',hostname:'fixture',cycle:dir,sourceManifestSha256:hex(88),window:{start:'2026-09-22',end:'2026-10-29'},originalConflicts:Array.from({length:8},(_,i)=>i),currentRows:anchors,oldRecords:[],absentLedger:anchors.map((r,i)=>({...r,uid:hex(i+201)})),protectedRows:[],physicalAbsences:[{table:'fixture_table',selector:{id:1}}],receiptLots:['a','b','c','d'].map((lot,i)=>({lot,sourceTotal:100*(i+1),skippedTotal:lot==='b'?20:10,retainedTotal:0,effectiveTotal:100*(i+1)-(lot==='b'?20:10)}))};
 const fresh=anchors.map((r,i)=>({...r,uid:hex(i+101),rowNumber:20-i,yarnIdentity:{lot:lots[i]},entryAmounts:'[10,null]'})),snapshots={'yarn-receive':{records:fresh.slice(0,5)},'yarn-issue':{records:fresh.slice(5)}};
 const totals=new Map(base.receiptLots.map(r=>[r.lot,r.sourceTotal])),scope={cycle:dir,manifestSha256:sha('{}'),baseSha256:hex(90),end:'2026-10-30'};
 totals.set('a',150);const policy=rebindPolicy(base,snapshots,totals,scope);
 assert.equal(policy.currentRows.length,6);assert.equal(policy.receiptLots[0].effectiveTotal,140);assert.equal(policy.window.end,'2026-10-30');assert.equal(policy.automaticRestartAuthorized,true);assert.equal(base.automaticRestartAuthorized,false);
 for(const change of [s=>s['yarn-receive'].records.pop(),s=>s['yarn-receive'].records[0].digest=hex(999),s=>s['yarn-receive'].records.push({...s['yarn-receive'].records[1],uid:hex(999),rowNumber:99}),s=>s['yarn-receive'].records[0].uid=s['yarn-receive'].records[1].uid]){const bad=copy(snapshots);change(bad);assert.throws(()=>rebindPolicy(base,bad,totals,scope));}
 assert.throws(()=>rebindPolicy(base,snapshots,totals,{...scope,end:'2026-10-28'}));
 const wrongAmount=copy(snapshots);wrongAmount['yarn-receive'].records[0].entryAmounts='[11,null]';assert.throws(()=>rebindPolicy(base,wrongAmount,totals,scope));
 const file=path.join(dir,'skip.json'),manifest=path.join(dir,'manifest.json');fs.writeFileSync(file,JSON.stringify(policy));fs.writeFileSync(manifest,'{}');
 const env={DB_NAME:base.database,SYNC_EXPECTED_DB:base.database,DB_HOST:'localhost',SYNC_START_DATE:base.window.start,SYNC_MANUAL_SKIPS_FILE:file,SYNC_MANUAL_SKIPS_SHA256:sha(fs.readFileSync(file)),SYNC_AUTOMATIC_RESTART_AUTHORIZED:'true',SYNC_SCHEDULED_SKIPS_BASE_SHA256:scope.baseSha256,SOURCE_MANIFEST_FILE:manifest};
 const loaded=loadManualSkips(env,scope.manifestSha256,dir),other={...fresh[0],uid:hex(999),digest:hex(999),rowNumber:99};
 assert.deepEqual(loaded.apply('yarn-receive',{previous:{records:[]},current:{records:[...fresh.slice(0,5),other]}}).current.records,[other]);
 const hosted={version:3,mode:'scheduled-exact-skips',database:base.database,manualOnly:false,automaticRestartAuthorized:true,intervalMinutes:10,windowStart:base.window.start,baseSkipsSha256:scope.baseSha256,heldCases:[],originalExclusions:[],seedDispos:[],businessCorrectionsApproved:0};
 const plan={ok:true,manualSkips:loaded.summary,businessWindow:policy.window,operations:{'yarn-receive':[other]}};
 assert.equal(assertProtected(plan,hosted,{env,manualSkips:loaded}),true);
 for(const mutate of [p=>p.automaticRestartAuthorized=false,p=>p.baseSkipsSha256=hex(99),p=>p.intervalMinutes=5,p=>p.heldCases=[{}]]){const bad=copy(hosted);mutate(bad);assert.throws(()=>assertProtected(plan,bad,{env,manualSkips:loaded}));}
 assert.throws(()=>loadManualSkips({...env,SYNC_AUTOMATIC_RESTART_AUTHORIZED:'false'},scope.manifestSha256,dir));
 assert.throws(()=>assertProtected(plan,hosted,{env:{...env,SYNC_AUTOMATIC_RESTART_AUTHORIZED:'false'},manualSkips:loaded}));
 const receiptIndex=new Map(policy.receiptLots.map(r=>[r.lot,{total:r.sourceTotal}]));applyReceiptTotals(receiptIndex,env);assert.equal(receiptIndex.get('a').total,140);
 const fake={query:async sql=>sql.startsWith('SELECT DATABASE()')?[[{databaseName:base.database,hostname:'fixture'}]]:[[]]};assert.equal((await verifyRetained(fake,loaded)).absentPhysicalTargets,1);
 const appeared={query:async sql=>sql.startsWith('SELECT DATABASE()')?[[{databaseName:base.database,hostname:'fixture'}]]:sql.includes('fixture_table')?[[{present:1}]]:[[]]};await assert.rejects(()=>verifyRetained(appeared,loaded),/absent physical/);
 // Exercise actual certified CSV inventory, qualification persistence and a
 // resumed job across a date rollover, rather than only the pure binder.
 const contract=require('../mappings/mapping-contract-v2.json'),profiles=contract.profiles.filter(p=>['yarn-receive','yarn-issue'].includes(p.id));
 const receiptHeaders=['Yarn Count','Yarn brand','Yarn Lot','Received Date','Received GD NO','Challan No','Receipt Qty (Kgs)','Floor Return in kg','__MIG_SOURCE_UID'];
 const receiptRows=lots.slice(0,5).map((lot,i)=>['40','fixture',lot,'2026-10-15','fixture-dispo','challan-'+(i===2?1:i),'10','',hex(i+1)]);
 const issueHeaders=['Yarn Count','Yarn Lot','Issue Date','Dispo No','S/R/Challan No','Out Side','Warp','Weft','__MIG_SOURCE_UID'];
 const issueRow=['40','a','2026-10-15','fixture-dispo','issue-1','','10','',hex(6)];
 const csv=(headers,rows)=>[headers,...rows].map(r=>r.join(',')).join('\n')+'\n';
 const receiptsFile=path.join(dir,'Greige yarn receive.csv'),issuesFile=path.join(dir,'Greige yarn issue.csv');
 fs.writeFileSync(receiptsFile,csv(receiptHeaders,receiptRows));fs.writeFileSync(issuesFile,csv(issueHeaders,[issueRow]));
 const original=await require('../lib/sheets_sync_plan').inventory(dir,profiles),integrationBase={...base,currentRows:profiles.flatMap(p=>original[p.id].records.map(r=>({...r,profile:p.id})))};
 const baseFile=path.join(dir,'base.json');fs.writeFileSync(baseFile,JSON.stringify(integrationBase));
 fs.writeFileSync(receiptsFile,csv(receiptHeaders,[...receiptRows].reverse().map((r,i)=>[...r.slice(0,-1),hex(i+301)]).concat([['40','fixture','a','2026-10-30','fixture-dispo','new-challan','10','',hex(399)]])));
 fs.writeFileSync(issuesFile,csv(issueHeaders,[[...issueRow.slice(0,-1),hex(400)]]));
 const integrationEnv={...env,SYNC_SCHEDULED_SKIPS_BASE_FILE:baseFile,SYNC_SCHEDULED_SKIPS_BASE_SHA256:sha(fs.readFileSync(baseFile))},prepared={latestSourceManifest:manifest,latestCertifiedDir:dir};
 const rebound=await qualifyScheduledSkips(integrationEnv,prepared,dir,'2026-10-30',{connection:fake});
 assert.equal(rebound.policy.receiptLots[0].effectiveTotal,10);assert.equal(rebound.policy.currentRows.length,6);
 const qualificationBytes=fs.readFileSync(integrationEnv.SYNC_MANUAL_SKIPS_FILE);
 const resumed=await qualifyScheduledSkips(integrationEnv,prepared,dir,'2026-10-31',{connection:fake,pending:true});assert.equal(resumed.policy.window.end,'2026-10-30');assert.deepEqual(fs.readFileSync(integrationEnv.SYNC_MANUAL_SKIPS_FILE),qualificationBytes);
 await assert.rejects(()=>qualifyScheduledSkips(integrationEnv,prepared,dir,'2026-10-30',{connection:fake}),/already qualified/);
 await assert.rejects(()=>qualifyScheduledSkips({...integrationEnv,SYNC_SCHEDULED_SKIPS_BASE_SHA256:hex(77)},prepared,dir,'2026-10-30',{connection:fake,pending:true}),/checksum/);
 fs.writeFileSync(manifest,'{"drift":true}');await assert.rejects(()=>qualifyScheduledSkips(integrationEnv,prepared,dir,'2026-10-30',{connection:fake,pending:true}),/binding/);
 console.log('Scheduled skips: advancing/reordered snapshots, exact duplicate multiplicity, receipt totals, authorization, source/DB drift and physical absence checks passed.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1;});
