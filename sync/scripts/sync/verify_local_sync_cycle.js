'use strict';
const fs=require('fs'),path=require('path'),mysql=require('mysql2/promise');
const root=path.resolve(__dirname,'../..');
(async()=>{
 const arg=process.argv.find(a=>a.startsWith('--cycle='));
 if(!arg)throw Error('Specify --cycle=local_data/sync_preview/cycles/<cycle>');
 const cycle=fs.realpathSync(path.resolve(arg.slice(8)));
 const cycleRoot=fs.realpathSync(path.join(root,'local_data/sync_preview/cycles'));
 if(!cycle.startsWith(cycleRoot+path.sep))throw Error('Local preview cycle required');
 const plan=JSON.parse(fs.readFileSync(path.join(cycle,'plan.json')));
 if(!plan.ok)throw Error('Plan has unresolved conflicts');
 const run=fs.readdirSync(path.join(cycle,'runs')).filter(n=>n.startsWith('sync_live_')).sort().at(-1);
 if(!run)throw Error('No live run exists');
 const runDir=path.join(cycle,'runs',run),status=JSON.parse(fs.readFileSync(path.join(runDir,'status.json')));
 if(status.status!=='completed'||status.rejected!==0)throw Error('Live run has not completed successfully');
 const env=require('dotenv').parse(fs.readFileSync(path.join(root,'local_data/sync_package/local.env.sync')));
 if(env.DB_NAME!=='weavonpq_weaving_sep22_preview'||!['localhost','127.0.0.1','::1'].includes(env.DB_HOST))throw Error('Local preview only');
 const c=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
 try{
  let checked=0;
  for(const [profile,operations]of Object.entries(plan.operations)){
   const [rows]=await c.query('SELECT source_uid,digest,group_key FROM sheets_sync_events WHERE profile=?',[profile]);
   const byUid=new Map(rows.map(r=>[r.source_uid,r]));
   for(const operation of operations){
    const row=byUid.get(operation.uid);
    if(!row||row.digest!==operation.digest||row.group_key!==operation.group)throw Error('Ledger differs from committed plan: '+profile+'/'+operation.uid);
    checked++;
   }
  }
  const report={ok:true,database:env.DB_NAME,cycle,run,checkedLedgerOperations:checked,added:plan.added,updated:plan.updated,refreshed:plan.refreshed,verifiedAt:new Date().toISOString()};
  const out=path.join(root,'local_data/sync_preview/verification',run);fs.mkdirSync(out,{recursive:true});
  for(const name of ['summary.json','status.json'])fs.copyFileSync(path.join(runDir,name),path.join(out,name));
  fs.copyFileSync(path.join(cycle,'plan.json'),path.join(out,'committed-plan.json'));
  fs.writeFileSync(path.join(out,'ledger-verification.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
 }finally{await c.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
