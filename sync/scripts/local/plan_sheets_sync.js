'use strict';
// Read-only: compare two normalized/certified snapshots; never connects to MySQL.
const fs=require('fs');
const path=require('path');
const {inventory,compare}=require('../../lib/sheets_sync_plan');
const {parseCliArgs,writeJson}=require('./common');
(async()=>{
 const args=parseCliArgs(process.argv.slice(2));
 if(!args.baseline||!args.current||!args.output)throw Error('Usage: node scripts/local/plan_sheets_sync.js --baseline=<certified-dir> --current=<certified-dir> --output=<report.json>');
 const contract=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../mappings/mapping-contract-v2.json'),'utf8'));
 const baseline=await inventory(path.resolve(args.baseline),contract.profiles);
 const current=await inventory(path.resolve(args.current),contract.profiles);
 const plan=compare(baseline,current);
 writeJson(path.resolve(args.output),{...plan,createdAt:new Date().toISOString(),readOnly:true,policy:'append-only-candidate-analysis',baseline:path.resolve(args.baseline),current:path.resolve(args.current)});
 console.log(JSON.stringify({ok:plan.ok,additions:plan.additions,conflicts:plan.conflicts,output:path.resolve(args.output),readOnly:true}));
 if(!plan.ok)process.exitCode=2;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
