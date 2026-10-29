'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {loadManualSkips,applyReceiptTotals,verifyRetained}=require('../lib/sync_manual_conflict_skips');
const {assertProtected}=require('../lib/hosted_protection_guard');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'manual-skip-proof-')),hex=n=>n.toString(16).padStart(64,'0'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const manifest=path.join(dir,'manifest.json');fs.writeFileSync(manifest,'{}');
const records=Array.from({length:6},(_,i)=>({profile:i===5?'yarn-issue':'yarn-receive',uid:hex(i+1),digest:hex(i+11),group:hex(i+21),rowNumber:i+1,businessDate:'2026-10-15'}));
const policy={version:2,mode:'owner-authorized-exact-skips',database:'weavonpq_weaving_main',hostname:'fixture-host',cycle:dir,sourceManifestSha256:hash('{}'),automaticRestartAuthorized:false,originalConflicts:Array.from({length:8},(_,i)=>'case-'+i),window:{start:'2026-09-22',end:'2026-10-29'},currentRows:records,oldRecords:[],absentLedger:records.map((r,i)=>({...r,uid:hex(i+101)})),protectedRows:[],receiptLots:[{lot:'fixture-lot',sourceTotal:1000,skippedTotal:300,retainedTotal:0,effectiveTotal:700}]};
const file=path.join(dir,'policy.json');fs.writeFileSync(file,JSON.stringify(policy));
const env={DB_NAME:policy.database,SYNC_EXPECTED_DB:policy.database,DB_HOST:'localhost',SYNC_START_DATE:policy.window.start,SYNC_MANUAL_SKIPS_FILE:file,SYNC_MANUAL_SKIPS_SHA256:hash(fs.readFileSync(file)),SOURCE_MANIFEST_FILE:manifest};
(async()=>{try{
 const loaded=loadManualSkips(env,policy.sourceManifestSha256,dir),fresh=records.filter(r=>r.profile==='yarn-receive'),other={...fresh[0],uid:hex(999),rowNumber:99};
 assert.equal(loaded.apply('yarn-receive',{previous:{records:[]},current:{records:[...fresh,other]}}).current.records[0].uid,other.uid);
 assert.throws(()=>loaded.apply('yarn-receive',{previous:{records:[]},current:{records:fresh.slice(1)}}));
 assert.throws(()=>loaded.apply('yarn-receive',{previous:{records:[policy.absentLedger[0]]},current:{records:fresh}}));
 assert.throws(()=>loaded.apply('yarn-receive',{previous:{records:[]},current:{records:fresh.map((r,i)=>i?r:{...r,digest:hex(999)})}}));
 for(const [k,v]of [['DB_NAME','another'],['SYNC_EXPECTED_DB','another'],['SYNC_MANUAL_SKIPS_SHA256',hex(2)]])assert.throws(()=>loadManualSkips({...env,[k]:v},policy.sourceManifestSha256,dir));
 assert.throws(()=>loadManualSkips(env,hex(77),dir));assert.throws(()=>loadManualSkips(env,policy.sourceManifestSha256,dir+'-wrong'));
 const receipts=new Map([['fixture-lot',{total:1000,rows:8}],['unrelated',{total:42,rows:1}]]);applyReceiptTotals(receipts,env);assert.equal(receipts.get('fixture-lot').total,700);assert.equal(receipts.get('unrelated').total,42);assert.throws(()=>applyReceiptTotals(receipts,env));
 const host={version:2,mode:'manual-exact-skips',database:policy.database,manualOnly:true,automaticRestartAuthorized:false,heldCases:[],originalExclusions:[],seedDispos:[],businessCorrectionsApproved:0,exactSkipsSha256:loaded.summary.sha256};
 const plan={ok:true,businessWindow:policy.window,manualSkips:loaded.summary,operations:{'yarn-receive':[{...other,action:'insert'}]}};
 assert.equal(assertProtected(plan,host,{env,manualSkips:loaded}),true);
 for(const mutate of [p=>p.operations['yarn-receive']=[fresh[0]],p=>p.businessWindow={start:'2026-01-01',end:'2026-10-29'},p=>p.exclusions={policy:'skip-dispos'},p=>p.operations['yarn-receive'][0].businessDate='2026-09-01']){const bad=JSON.parse(JSON.stringify(plan));mutate(bad);assert.throws(()=>assertProtected(bad,host,{env,manualSkips:loaded}));}
 assert.throws(()=>assertProtected(plan,host));
 const fake={query:async(sql,args)=>sql.startsWith('SELECT DATABASE()')?[[{databaseName:policy.database,hostname:'fixture-host'}]]:[[]]};
 assert.equal((await verifyRetained(fake,loaded)).absentPriorEvents,6);
 const drift={query:async(sql,args)=>sql.startsWith('SELECT DATABASE()')?[[{databaseName:policy.database,hostname:'fixture-host'}]]:[[{present:1}]]};await assert.rejects(()=>verifyRetained(drift,loaded));
 console.log('Exact manual skips: source/ledger/database/window/hash drift rejected; unrelated source retained; absent history protected; receipt dependency totals and manual hosted policy verified.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
