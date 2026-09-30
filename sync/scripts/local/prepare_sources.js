#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const { ROOT, DATA_ROOT, ensureDir, stamp, sha256File, readState, updateState, run, loadEnv, parseCliArgs }=require('./common');
loadEnv();
const args=parseCliArgs(process.argv.slice(2));
(async()=>{
 const state=readState();
 const fetchDir=path.resolve(args['fetch-dir']||state.latestFetchDir||'');
 const rawDir=path.join(fetchDir,'raw');
 if(!fetchDir||!fs.existsSync(rawDir))throw new Error('No Google fetch run found. Run fetch_google_sheets.js first.');
 const prepareId=`prepared_${stamp()}`;
 const prepRoot=ensureDir(path.join(DATA_ROOT,'prepared',prepareId));
 console.log(`PREPARE_ROOT=${prepRoot}`);
 await run(process.execPath,['--max-old-space-size=1024','scripts/v3/normalize_sources_v323.js',`--input=${rawDir}`,`--output=${prepRoot}`],{cwd:ROOT});
 const certified=path.join(prepRoot,'certified');
 const attestation=path.join(prepRoot,'audit','normalization-attestation.json');
 const pending=path.join(prepRoot,'source-manifest.pending.json');
 const approved=path.join(prepRoot,'source-manifest.json');
 const approvalRecord=path.join(prepRoot,'source-manifest.approval.json');
 const env={CSV_DIR:certified,NORMALIZATION_ATTESTATION_FILE:attestation,SOURCE_MANIFEST_FILE:approved};
 await run(process.execPath,['scripts/v3/certify_sources_v323.js',`--normalization-root=${prepRoot}`,`--csv-dir=${certified}`,`--normalization-attestation=${attestation}`,`--output=${pending}`],{cwd:ROOT,env});
 const pendingHash=sha256File(pending);
 await run(process.execPath,['scripts/v3/approve_source_manifest.js',`--pending=${pending}`,`--pending-hash=${pendingHash}`,`--reviewer=${process.env.PREPARE_REVIEWER||'LOCAL_REHEARSAL'}`,`--output=${approved}`,`--approval-record=${approvalRecord}`,`--csv-dir=${certified}`],{cwd:ROOT,env});
 const statePatch={latestPreparedId:prepareId,latestPreparedRoot:prepRoot,latestCertifiedDir:certified,latestNormalizationAttestation:attestation,latestSourceManifest:approved,latestPendingManifest:pending,latestSourceManifestSha256:sha256File(approved),preparedAt:new Date().toISOString()};
 updateState(statePatch);
 console.log(JSON.stringify({ok:true,fetchDir,prepareId,...statePatch},null,2));
})().catch(e=>{console.error(e.stack||String(e));process.exit(1);});
