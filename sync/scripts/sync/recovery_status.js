#!/usr/bin/env node
'use strict';
// Read-only recovery state and guarded preflight-failure recording. No SQL access.
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const recovery=require('../../lib/sync_recovery_v2');
const envFile=process.argv.find(v=>v.startsWith('--env='));
if(!envFile)throw Error('Specify a private --env=/path/.env.sync');
const env=require('dotenv').parse(fs.readFileSync(path.resolve(envFile.slice(6))));
const dir=path.resolve(env.SYNC_DATA_DIR||path.join(ROOT,'sync_data'));
const failure=process.argv.find(v=>v.startsWith('--preflight-failed='));
if(failure){
 const category=failure.split('=')[1];
 if(category!=='hosting-capacity')throw Error('Only verified quota failures can record an early failure');
 recovery.preflightFailure(dir,category);
 console.log(JSON.stringify({version:2,recorded:'preflight-failed',category}));
}else{
 console.log(JSON.stringify(recovery.publicView(dir),null,2));
}
