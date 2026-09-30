'use strict';
// Read-only server-side readiness check. Never imports the local workspace .env.
const fs=require('fs');
const path=require('path');
const mysql=require('mysql2/promise');
const dotenv=require('dotenv');
(async()=>{
 const arg=process.argv.find(a=>a.startsWith('--env='));
 if(!arg)throw Error('Usage: node scripts/sync/check_cpanel.js --env=/private/path/.env.sync');
 const env=dotenv.parse(fs.readFileSync(path.resolve(arg.slice(6))));
 if(env.SYNC_EXPECTED_DB!=='weavonpq_weaving_main'||env.DB_NAME!==env.SYNC_EXPECTED_DB)throw Error('Expected target must be exactly weavonpq_weaving_main');
 if(!['localhost','127.0.0.1','::1'].includes(env.DB_HOST))throw Error('Run this check on the cPanel server using its local database endpoint; remote access is disabled');
 if(!env.DB_USER||env.DB_USER==='CHANGE_ME'||env.DB_PASSWORD==='CHANGE_ME')throw Error('Configure the private server-side DB credentials first');
 const c=await mysql.createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
 try{
  const [[identity]]=await c.query('SELECT DATABASE() database_name, VERSION() version');
  if(identity.database_name!==env.SYNC_EXPECTED_DB)throw Error('Connected database mismatch');
  const tables=['PO_form_data','dispo_form_data','yarn_receive_form','yarn_issue_form','warping_form','sizing_form','loom_production_form','folding_production_form','greige_delivery_form'];
  const counts={};for(const table of tables){const [[r]]=await c.query('SELECT COUNT(*) n FROM `'+table+'`');counts[table]=Number(r.n);}
  const [engines]=await c.query('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE=\'BASE TABLE\'');
  const nonTransactional=engines.filter(r=>tables.some(t=>t.toLowerCase()===r.TABLE_NAME.toLowerCase())&&r.ENGINE!=='InnoDB');
  if(nonTransactional.length)throw Error('Business tables must support transactions: '+nonTransactional.map(r=>r.TABLE_NAME).join(', '));
  console.log(JSON.stringify({ok:true,readOnly:true,node:process.version,database:identity.database_name,version:identity.version,counts,configuredIntervalMinutes:env.SYNC_INTERVAL_MINUTES,existingRowPolicy:env.SYNC_EXISTING_ROW_POLICY,schedulerEnabled:false},null,2));
 }finally{await c.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
