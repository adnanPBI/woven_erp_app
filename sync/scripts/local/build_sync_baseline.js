'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {inventory}=require('../../lib/sheets_sync_plan');
const {connect}=require('./db');
const {readState,readJson,ensureDir,DATA_ROOT}=require('./common');
const {loadRetainedMasterKeys}=require('./protect_retained_rows');
(async()=>{
 const state=readState(),manifest=readJson(state.latestFinalExportManifest);
 if(!manifest?.restoreTest?.ok)throw Error('Verified final export required');
 const contract=require('../../mappings/mapping-contract-v2.json');
 const records=await inventory(state.latestCertifiedDir,contract.profiles);
 const c=await connect();let protectedMasters;
 try{protectedMasters=await loadRetainedMasterKeys(c);}finally{await c.end();}
 protectedMasters=Object.fromEntries(Object.entries(protectedMasters).map(([t,s])=>[t,{key:s.key,values:[...s.values]}]));
 const business=new Set(contract.profiles.flatMap(p=>p.tables.map(t=>t.name.toLowerCase())));
 const checks=manifest.restoreTest.tableChecks.filter(t=>business.has(t.table.toLowerCase()));
 const result={version:1,cutoff:manifest.cutoff,sqlSha256:manifest.sha256,protectedMasters,checks,profiles:records};
 const file=path.join(ensureDir(path.join(DATA_ROOT,'sync_package')),'baseline.json.gz');
 fs.writeFileSync(file,zlib.gzipSync(JSON.stringify(result)));
 console.log(JSON.stringify({file,bytes:fs.statSync(file).size,profiles:Object.keys(records).length,checks:checks.length}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
