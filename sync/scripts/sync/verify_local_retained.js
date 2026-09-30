'use strict';
// Read-only comparison against the original migration's retained-row evidence.
const fs=require('fs'),path=require('path'),mysql=require('mysql2/promise');
const root=path.resolve(__dirname,'../..');
const env=require('dotenv').parse(fs.readFileSync(path.join(root,'local_data/sync_package/local.env.sync')));
const q=s=>'`'+s.replace(/`/g,'``')+'`';
(async()=>{
 if(env.DB_NAME!=='weavonpq_weaving_sep22_preview'||!['localhost','127.0.0.1','::1'].includes(env.DB_HOST))throw Error('Local preview only');
 const c=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
 const tables=[];
 try{
  const [baselineTables]=await c.query('SELECT table_name FROM weavonpq_weaving_local.local_retained_tables');
  if(!baselineTables.length)throw Error('Original retained baseline missing');
  for(const {table_name:table}of baselineTables){
   const [cols]=await c.query('SHOW COLUMNS FROM '+q(table));
   const hash='SHA2(CAST(JSON_ARRAY('+cols.map(r=>q(r.Field)).join(',')+') AS CHAR),256)';
   const [actual]=await c.query('SELECT '+hash+' row_sha,COUNT(*) n FROM '+q(table)+' GROUP BY '+hash);
   const [baseline]=await c.query('SELECT row_sha,occurrences FROM weavonpq_weaving_local.local_retained_fingerprints WHERE table_name=?',[table]);
   const counts=new Map(actual.map(r=>[r.row_sha,Number(r.n)]));
   tables.push({table,retainedRows:baseline.reduce((n,r)=>n+Number(r.occurrences),0),changedFingerprints:baseline.filter(r=>(counts.get(r.row_sha)||0)<Number(r.occurrences)).length});
  }
  const report={ok:tables.every(t=>t.changedFingerprints===0),database:env.DB_NAME,checkedAt:new Date().toISOString(),tables};
  const dir=path.join(root,'local_data/sync_preview/verification');fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'retained_'+report.checkedAt.replace(/[:.]/g,'-')+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({ok:report.ok,tables:tables.length,file}));if(!report.ok)process.exitCode=1;
 }finally{await c.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
