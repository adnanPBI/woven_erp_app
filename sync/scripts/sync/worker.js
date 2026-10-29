'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const {spawn}=require('child_process');
const {pipeline}=require('stream/promises');
const ROOT=path.resolve(__dirname,'../..');
const args=Object.fromEntries(process.argv.slice(2).filter(a=>a.startsWith('--')).map(a=>{const i=a.indexOf('=');return i<0?[a.slice(2),true]:[a.slice(2,i),a.slice(i+1)];}));
const stamp=()=>new Date().toISOString().replace(/[:.]/g,'-');
const storage=require('../../lib/sync_storage');
const {ensureIdentityColumn,hydrateIdentities,saveHydratedIdentities}=require('../../lib/yarn_sync_identity');
let lockHeartbeat;
let connection,lockName,dataDir,storageConfig,activeCycle,hasLock=false,storageReady=false;
async function handshake(type,reply,details={}) {
 if(!process.send)throw Error('Use scripts/sync/run.js so storage supervision is active');
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{process.removeListener('message',listener);reject(Error('Storage supervisor timeout'));},30000);
  const listener=message=>{if(message.type===reply){clearTimeout(timer);process.removeListener('message',listener);resolve();}};
  process.on('message',listener);process.send({type,...details});
 });
}
async function upgradeMatching(bundle,bundlePath){
 if(!bundle.matchSignatures)throw Error('Matching signatures missing from baseline package');
 const file=path.join(path.dirname(bundlePath),bundle.matchSignatures.file);
 const checksum=require('../local/common').sha256File(file);
 if(checksum!==bundle.matchSignatures.sha256)throw Error('Matching signature checksum mismatch');
 const [cols]=await connection.query("SHOW COLUMNS FROM sheets_sync_events LIKE 'match_hash'");
 if(!cols.length)await connection.query('ALTER TABLE sheets_sync_events ADD COLUMN match_hash char(64) NULL');
 await ensureIdentityColumn(connection);
 await connection.beginTransaction();let count=0;
 try{
  const input=fs.createReadStream(file).pipe(zlib.createGunzip());
  for await(const line of require('readline').createInterface({input,crlfDelay:Infinity})){
   const [profile,uid,digest,signature,yarnIdentity]=JSON.parse(line);
   await connection.query('UPDATE sheets_sync_events SET match_hash=? WHERE profile=? AND source_uid=? AND digest=?',[signature,profile,uid,digest]);count++;
   if(yarnIdentity)await connection.query('UPDATE sheets_sync_events SET yarn_identity=? WHERE profile=? AND source_uid=? AND digest=?',[JSON.stringify(yarnIdentity),profile,uid,digest]);
  }
  if(count!==bundle.matchSignatures.records)throw Error('Incomplete signature baseline');
  await connection.commit();
 }catch(e){await connection.rollback();throw e;}
}
function json(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2));fs.renameSync(tmp,file);}
async function command(file,argv,env,log){
 storage.assertCapacity(dataDir,storageConfig);
 await new Promise((resolve,reject)=>{
  const p=spawn(process.execPath,[file,...argv],{cwd:ROOT,env,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  require('../../lib/sync_process_tracking').track(p);
  let error;
  const append=d=>{try{storage.appendLog(log,d,storageConfig);}catch(e){error=e;p.kill();}};
  p.stdout.on('data',append);p.stderr.on('data',append);
  p.on('error',reject);p.on('close',code=>error?reject(error):code===0?resolve():reject(Error(path.basename(file)+' failed; see '+log)));
 });
 storage.assertCapacity(dataDir,storageConfig);
}
async function backup(env,cycle){
 // A resumed cycle already has its first backup; preserve it and create a fresh one.
 const backupDir=path.join(dataDir,'backups');
 fs.mkdirSync(backupDir,{recursive:true});
 const file=path.join(backupDir,'before_sync_'+stamp()+'.sql.gz');
 const partial=file+'.partial';
 storage.assertCapacity(dataDir,storageConfig);
 const bin=env.SYNC_MYSQLDUMP||(process.platform==='win32'?'C:/xampp/mysql/bin/mysqldump.exe':'mysqldump');
 const p=spawn(bin,['--host='+env.DB_HOST,'--port='+(env.DB_PORT||3306),'--user='+env.DB_USER,'--single-transaction','--quick','--triggers',env.DB_NAME],{env:{...process.env,MYSQL_PWD:env.DB_PASSWORD},stdio:['ignore','pipe','pipe'],windowsHide:true});
 require('../../lib/sync_process_tracking').track(p);
 let error='';p.stderr.on('data',d=>{error+=d;});
 const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>code===0?resolve():reject(Error('Pre-sync backup failed: '+error)));});
 try {
  await Promise.all([done,pipeline(p.stdout,zlib.createGzip(),fs.createWriteStream(partial,{flags:'wx'}))]);
  if(!fs.statSync(partial).size)throw Error('Empty pre-sync backup');
  fs.renameSync(partial,file);
 }catch(e){p.kill();if(fs.existsSync(partial))fs.unlinkSync(partial);throw e;}
 storage.assertCapacity(dataDir,storageConfig);
 return file;
}
async function main(){
 if(!process.send)throw Error('Use scripts/sync/run.js, not worker.js');
 if(!args.env)throw Error('Specify a private --env=/path/.env.sync; the local .env is not used');
 const env=require('dotenv').parse(fs.readFileSync(path.resolve(args.env)));
 storageConfig=storage.settings(env);
 const local=args.local===true;
 const expected=local?'weavonpq_weaving_sep22_preview':'weavonpq_weaving_main';
 if(env.DB_NAME!==expected||env.SYNC_EXPECTED_DB!==expected)throw Error('Sync database must equal '+expected);
 if(!['localhost','127.0.0.1','::1'].includes(env.DB_HOST))throw Error('Sync must run on its database server, using loopback');
 if(!local&&process.platform==='win32')throw Error('Run cPanel mode on the hosting server; use --local only for the preview copy');
 if(env.SYNC_EXISTING_ROW_POLICY!=='apply-edits')throw Error('Confirmed apply-edits policy required');
 if(!env.DB_USER||/CHANGE_ME/.test(env.DB_USER)||env.DB_PASSWORD==='CHANGE_ME')throw Error('Configure server-side credentials');
 if(!args.maintenance&&!args.initialize&&!args.plan&&!args['dry-run']&&!args['upgrade-matching']&&!args['upgrade-yarn-identities']&&env.SYNC_ENABLED!=='true')throw Error('SYNC_ENABLED must be true to apply scheduled changes');
 dataDir=path.resolve(env.SYNC_DATA_DIR||path.join(ROOT,'sync_data'));
 fs.mkdirSync(dataDir,{recursive:true});
 connection=await require('mysql2/promise').createConnection({host:env.DB_HOST,port:Number(env.DB_PORT||3306),user:env.DB_USER,password:env.DB_PASSWORD,database:expected,dateStrings:true});
 if(env.SYNC_EXPECTED_HOSTNAME){
  const [[server]]=await connection.query('SELECT @@hostname hostname');
  if(String(server.hostname).toLowerCase()!==env.SYNC_EXPECTED_HOSTNAME.toLowerCase())throw Error('Connected MySQL server hostname differs from the configured XAMPP server');
 }
 lockName='weaving_sheets_sync_'+expected;
 const [[lock]]=await connection.query('SELECT GET_LOCK(?,0) acquired',[lockName]);
 if(Number(lock.acquired)!==1){console.log('Another sync is active; this interval was skipped.');return;}
 hasLock=true;
 // Shared hosts may close an idle connection during fetch/normalization. The
 // advisory lock belongs to THIS connection, so keep it alive and stop the
 // supervised writer if ownership could be lost. A second pooled connection
 // would not keep this lock session alive.
 let heartbeatPending=false;
 lockHeartbeat=setInterval(()=>{if(heartbeatPending)return;heartbeatPending=true;
  connection.query('SELECT 1').catch(()=>{console.error('Advisory-lock heartbeat failed; stopping supervised writer');process.kill(process.ppid,'SIGTERM');}).finally(()=>{heartbeatPending=false;});
 },10000);lockHeartbeat.unref();
 const pendingBefore=storage.readJson(path.join(dataDir,'pending.json'));
 const previousStatus=storage.readJson(path.join(dataDir,'status.json'));
 activeCycle=pendingBefore?.cycle||(args['prepared-cycle']?path.resolve(args['prepared-cycle']):undefined);
 const cleanup=storage.cleanup(dataDir,storageConfig,{current:activeCycle,reserve:args.maintenance?0:storageConfig.reserveBytes});
 console.log(JSON.stringify({maintenance:true,beforeBytes:cleanup.beforeBytes,afterBytes:cleanup.afterBytes,reclaimedBytes:cleanup.reclaimedBytes,removedCount:cleanup.removed.length}));
 if(args.maintenance){storage.assertCapacity(dataDir,storageConfig);return;}
 storage.assertCapacity(dataDir,storageConfig,storageConfig.reserveBytes);
 storageReady=true;
 await handshake('storage-ready','storage-start',{cycle:activeCycle});
 const bundlePath=path.resolve(env.SYNC_BASELINE_FILE||path.join(ROOT,'baseline.meta.json'));
 const bundle=JSON.parse(fs.readFileSync(bundlePath));
 if(bundle.version!==2)throw Error('Streaming baseline version 2 required');
 const bundleHash=bundle.baselineHash;
 if(args.initialize){
  const [existing]=await connection.query("SHOW TABLES LIKE 'sheets_sync_meta'");
  if(existing.length)throw Error('Sync baseline already exists; refusing to reinitialize');
  for(const item of bundle.checks){const [[r]]=await connection.query('SELECT COUNT(*) n FROM `'+item.table+'`');const [[s]]=await connection.query('CHECKSUM TABLE `'+item.table+'` EXTENDED');if(Number(r.n)!==item.rows||String(s.Checksum)!==String(item.checksum))throw Error('Baseline differs from final export: '+item.table+'; reconcile before initializing');}
  await connection.query('CREATE TABLE sheets_sync_events (profile varchar(40) NOT NULL,source_uid char(64) NOT NULL,group_key char(64) NOT NULL,digest char(64) NOT NULL,dispo varchar(255) NOT NULL DEFAULT \'\',updated_at timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY(profile,source_uid)) ENGINE=InnoDB');
  await connection.query('CREATE TABLE sheets_sync_meta (id int PRIMARY KEY,baseline_sha char(64) NOT NULL,headers_json longtext NOT NULL) ENGINE=InnoDB');
  await connection.beginTransaction();
  try{
   const input=fs.createReadStream(path.join(path.dirname(bundlePath),bundle.eventsFile)).pipe(zlib.createGunzip());let batch=[],count=0;
   for await(const line of require('readline').createInterface({input,crlfDelay:Infinity})){batch.push(JSON.parse(line));count++;if(batch.length===500){await connection.query('INSERT INTO sheets_sync_events (profile,source_uid,group_key,digest,dispo) VALUES ?',[batch]);batch=[];}}
   if(batch.length)await connection.query('INSERT INTO sheets_sync_events (profile,source_uid,group_key,digest,dispo) VALUES ?',[batch]);
   if(count!==bundle.records)throw Error('Incomplete baseline event stream');
   await connection.query('INSERT INTO sheets_sync_meta VALUES (1,?,?)',[bundleHash,JSON.stringify(bundle.headers)]);
   await connection.commit();
  }catch(e){await connection.rollback();throw e;}
  await upgradeMatching(bundle,bundlePath);
  json(path.join(dataDir,'status.json'),{status:'initialized',database:expected,at:new Date().toISOString(),baselineCutoff:bundle.cutoff});
  console.log('Baseline initialized without changing business data. Run --plan next.');return;
 }
 const [[meta]]=await connection.query('SELECT * FROM sheets_sync_meta WHERE id=1');
 if(!meta||meta.baseline_sha!==bundleHash)throw Error('Matching initialized baseline is required');
 await ensureIdentityColumn(connection);
 if(args['upgrade-matching']){await upgradeMatching(bundle,bundlePath);console.log('Matching signatures installed; business rows unchanged.');return;}
 if(args['upgrade-yarn-identities']){
  if(typeof args['upgrade-yarn-identities']!=='string')throw Error('Specify --upgrade-yarn-identities=<previous-certified-directory>');
  const {inventory}=require('../../lib/sheets_sync_plan');
  let hydrated=0;
  for(const profile of require('../../mappings/mapping-contract-v2.json').profiles.filter(p=>['yarn-issue','yarn-receive'].includes(p.id))){
   const snapshot=(await inventory(path.resolve(args['upgrade-yarn-identities']),[profile]))[profile.id];
   const [records]=await connection.query('SELECT source_uid uid,digest,match_hash matchHash,yarn_identity yarnIdentity FROM sheets_sync_events WHERE profile=?',[profile.id]);
   const rows=hydrateIdentities({records},snapshot);
   await saveHydratedIdentities(connection,profile.id,rows);hydrated+=rows.length;
  }
  console.log(JSON.stringify({status:'yarn-identities-upgraded',hydrated,businessRowsChanged:0}));return;
 }
 const date=(local&&args.cutoff)||env.SYNC_END_DATE||new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const pendingFile=path.join(dataDir,'pending.json');
 const pending=fs.existsSync(pendingFile)?JSON.parse(fs.readFileSync(pendingFile)):null;
 if(args['prepared-cycle']&&!local)throw Error('Prepared fixture reuse is local-only');
 const resume=args['resume-host-cycle']?path.resolve(args['resume-host-cycle']):null;
 if(resume&&(!resume.startsWith(path.resolve(dataDir,'cycles')+path.sep)||!require('fs').existsSync(path.join(resume,'local_state.json'))))throw Error('Only an existing certified hosted cycle can resume');
 const cycle=pending?.cycle||resume||(args['prepared-cycle']?path.resolve(args['prepared-cycle']):path.join(dataDir,'cycles',stamp()));
 if(!path.resolve(cycle).startsWith(path.resolve(dataDir,'cycles')+path.sep))throw Error('Cycle must be within sync data directory');
 activeCycle=cycle;
 fs.mkdirSync(cycle,{recursive:true});
 const log=path.join(cycle,'worker.log');
 // Explicit child environment prevents production reuse of local rehearsal paths/settings.
 const childEnv={...process.env,...env,LOCAL_DATA_ROOT:cycle,LOCAL_CUTOFF_START:'2024-01-01',LOCAL_CUTOFF_END:date,GOOGLE_AUTH_MODE:'service-account',GOOGLE_SERVICE_ACCOUNT_JSON:env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH||'',GOOGLE_SNAPSHOT_DIR:'',PREPARE_REVIEWER:'AUTHORIZED_SCHEDULED_SHEETS_SYNC',CSV_DATE_ORDER:'dmy',IMPORT_VALIDATION_MODE:'strict',LOCAL_PRESERVE_RETAINED:'false',DB_NAME:expected,IMPORT_EXPECTED_DB:expected,REQUIRE_DB_GUARD:'true',PRODUCTION_DB_NAME:expected,ALLOW_PRODUCTION_DB:'true',PRODUCTION_APPROVAL_TOKEN:crypto.randomBytes(24).toString('hex')};
 json(path.join(dataDir,'status.json'),{status:'fetching',database:expected,cycle,at:new Date().toISOString()});
 if(!pending&&!args['prepared-cycle']&&!resume){
 if(args.snapshot){if(!local)throw Error('Snapshot fixture mode is only permitted locally');childEnv.GOOGLE_SNAPSHOT_DIR=path.resolve(args.snapshot);}
 else if(env.SYNC_GOOGLE_MODE==='public-csv'){
  await command('scripts/local/download_public_sources.js',[],childEnv,log);
  childEnv.GOOGLE_SNAPSHOT_DIR=JSON.parse(fs.readFileSync(path.join(cycle,'latest_sheet_snapshot.json'))).dir;
 }
 await command('scripts/local/fetch_google_sheets.js',[],childEnv,log);
 await command('scripts/local/prepare_sources.js',[],childEnv,log);
 }
 const prepared=JSON.parse(fs.readFileSync(path.join(cycle,'local_state.json')));
 json(path.join(dataDir,'status.json'),{status:'planning',database:expected,cycle,at:new Date().toISOString()});
 const {inventory,planEdits,applyReviewedReassignments}=require('../../lib/sheets_sync_plan');
 const reviewed=env.SYNC_REVIEWED_REASSIGNMENTS?JSON.parse(fs.readFileSync(path.resolve(env.SYNC_REVIEWED_REASSIGNMENTS))):[];
 if(!Array.isArray(reviewed))throw Error('Reviewed reassignments must be an array');
 const contract=require('../../mappings/mapping-contract-v2.json');
 const headers=JSON.parse(meta.headers_json);
 const exclusionEntries=env.SYNC_EXCLUSIONS_FILE?JSON.parse(fs.readFileSync(path.resolve(env.SYNC_EXCLUSIONS_FILE))):[];
 const exclusionPolicy=env.SYNC_CONFLICT_POLICY||'block';
 const repairMode=env.SYNC_VERIFIED_WRITES==='true';
 const windowStart=env.SYNC_START_DATE||null;
 if(args['refresh-window']&&(!windowStart||(!local&&!env.SYNC_MANUAL_SKIPS_FILE)))throw Error('Full-window refresh requires a bounded local or qualified manual run');
 if(windowStart&&!repairMode)throw Error('A bounded sync window requires verified writes');
 if(env.SYNC_MISSING_ROW_POLICY&&!['block','retain-history'].includes(env.SYNC_MISSING_ROW_POLICY))throw Error('Unknown missing-row policy');
 // Bind the fresh source before planning. Explicit resume/pending reuses the
 // already frozen qualification, rather than reselecting source rows on retry.
 const scheduledSkips=await require('../../lib/sync_scheduled_skips').qualifyScheduledSkips(env,prepared,cycle,date,{pending:!!pending||!!resume,connection});
 // The mapper's SourceIndex runs through childEnv/process.env. Forward the
 // exact same per-cycle file/hash so yarn balances cannot include skipped stock.
 if(scheduledSkips)Object.assign(childEnv,{SYNC_MANUAL_SKIPS_FILE:env.SYNC_MANUAL_SKIPS_FILE,SYNC_MANUAL_SKIPS_SHA256:env.SYNC_MANUAL_SKIPS_SHA256});
 const manualSkips=scheduledSkips||require('../../lib/sync_manual_conflict_skips').loadManualSkips(env,require('../local/common').sha256File(prepared.latestSourceManifest),cycle);
 if(env.SYNC_END_DATE&&(!manualSkips||env.SYNC_END_DATE!==manualSkips.policy.window.end))throw Error('Frozen end date requires exact manual qualification');
 if(manualSkips)await require('../../lib/sync_manual_conflict_skips').verifyRetained(connection,manualSkips);
 function scoped(profile,previous,current){
  if(manualSkips)({previous,current}=manualSkips.apply(profile,{previous,current}));
  return windowStart?require('../../lib/sync_history_policy').scopeHistory(previous,current,windowStart,date):{previous,current};
 }
 const changedReceiptLots=new Set();
 function historyPlan(profile,previous,current,upstream=[]){
  const partial=planEdits({[profile]:previous},{[profile]:current},upstream,{refreshAll:args['refresh-window']===true,refreshLots:[...changedReceiptLots]});
  return env.SYNC_MISSING_ROW_POLICY==='retain-history'?require('../../lib/sync_history_policy').retainMissingHistory(profile,partial,previous,current):partial;
 }
 const exclusions=(exclusionEntries.length||exclusionPolicy!=='block')?new (require('../../lib/sync_exclusions').SyncExclusions)(exclusionEntries,exclusionPolicy):null;
 // Legacy dependency-wide exclusions remain available to legacy installs.
 // Authorized v2/v3 modes remove those broad restrictions, not business rows;
 // their exact exception and zero-exclusion scope are checked again below.
 const protection=!local?JSON.parse(fs.readFileSync(path.join(ROOT,'protection-policy.json'))):null;
 if(protection&&!['manual-exact-skips','scheduled-exact-skips'].includes(protection.mode)){
  if(protection.heldCases.length!==42||protection.originalExclusions.length!==14||!exclusions)throw Error('Required protections missing');
  for(const dispo of protection.seedDispos)exclusions.dispos.add(dispo);
  for(const e of protection.originalExclusions)exclusions.edge(e.dispo,e.lot);
 }
 const plan=pending?JSON.parse(fs.readFileSync(path.join(cycle,'plan.json'))):{ok:true,added:0,updated:0,refreshed:0,operations:{},conflicts:[]};
 if(!pending&&windowStart)plan.businessWindow={start:windowStart,end:date};
 if(!pending&&manualSkips)plan.manualSkips=manualSkips.summary;
 if(protection?.mode==='manual-exact-skips'&&!args.plan&&!args['dry-run']&&!resume&&!pending)throw Error('Manual hosted apply requires an explicitly resumed frozen cycle');
 if(!pending&&repairMode&&local)plan.originalFingerprintDatabase='weavonpq_weaving_local';
 if(!pending)plan.missingRowPolicy=env.SYNC_MISSING_ROW_POLICY||'block';
 if(!pending){
 for(const profile of contract.profiles){
  if(global.gc)global.gc();
  console.log(JSON.stringify({stage:'planning-profile',profile:profile.id,heapMiB:Math.round(process.memoryUsage().heapUsed/1048576),rssMiB:Math.round(process.memoryUsage().rss/1048576)}));
  const current=await inventory(prepared.latestCertifiedDir,[profile]);
  const [events]=await connection.query('SELECT source_uid uid,group_key `group`,digest,dispo,match_hash matchHash,yarn_identity yarnIdentity FROM sheets_sync_events WHERE profile=?',[profile.id]);
  await saveHydratedIdentities(connection,profile.id,hydrateIdentities({records:events},current[profile.id]));
  let previous=applyReviewedReassignments(profile.id,{headersHash:headers[profile.id],records:events},current[profile.id],reviewed);
  // Protection preimages and shared-lot closure use full evidence; only the
  // write planner is narrowed to the authorized business-date window.
  const exclusionPrevious=previous,exclusionCurrent=current[profile.id];
  const bounded=scoped(profile.id,previous,current[profile.id]);previous=bounded.previous;current[profile.id]=bounded.current;
  const partial=historyPlan(profile.id,previous,current[profile.id]);
  if(profile.id==='yarn-receive'){
   const old=new Map(events.map(r=>[r.uid,r]));
   for(const op of partial.operations[profile.id]||[])for(const identity of [op.yarnIdentity,old.get(op.uid)?.yarnIdentity]){
    const parsed=require('../../lib/yarn_sync_identity').parseIdentity(identity);
    const lot=require('../../lib/source_index').normalizeYarnLotIdentity(parsed?.lot);
    if(lot)changedReceiptLots.add(lot);
   }
  }
  if(partial.retainedHistory?.length)(plan.retainedHistory||=[]).push(...partial.retainedHistory);
  if(exclusions)exclusions.inspect(profile.id,exclusionPrevious,exclusionCurrent,partial);
  plan.ok=plan.ok&&partial.ok;plan.added+=partial.added;plan.updated+=partial.updated;plan.refreshed+=partial.refreshed;Object.assign(plan.operations,partial.operations);plan.conflicts.push(...partial.conflicts);
 }
 if(exclusions){exclusions.seal();exclusions.filter(plan);}
 // The planner is streamed one profile at a time. Carry upstream changes into
 // a second pass so unchanged downstream rows recompute their derived values.
 if(plan.ok&&plan.added+plan.updated>0){
  const order=contract.import_order||contract.profiles.map(p=>p.id),affected=new Map();
  for(const [profile,rows]of Object.entries(plan.operations))for(const r of rows)for(const dispo of [r.dispo,r.previousDispo])if(dispo)affected.set(dispo,Math.min(affected.get(dispo)??99,order.indexOf(profile)));
  for(const profile of contract.profiles){
  if(global.gc)global.gc();
  console.log(JSON.stringify({stage:'planning-profile',profile:profile.id,heapMiB:Math.round(process.memoryUsage().heapUsed/1048576),rssMiB:Math.round(process.memoryUsage().rss/1048576)}));
   if(![...affected.values()].some(index=>index<order.indexOf(profile.id)))continue;
   const current=await inventory(prepared.latestCertifiedDir,[profile]);
   const [events]=await connection.query('SELECT source_uid uid,group_key `group`,digest,dispo,match_hash matchHash,yarn_identity yarnIdentity FROM sheets_sync_events WHERE profile=?',[profile.id]);
   let previous=applyReviewedReassignments(profile.id,{headersHash:headers[profile.id],records:events},current[profile.id],reviewed);
   const bounded=scoped(profile.id,previous,current[profile.id]);previous=bounded.previous;current[profile.id]=bounded.current;
   const partial=historyPlan(profile.id,previous,current[profile.id],[...affected]);
   plan.ok=plan.ok&&partial.ok;Object.assign(plan.operations,partial.operations);plan.conflicts.push(...partial.conflicts);
  }
 }
 if(exclusions)exclusions.filter(plan);
 plan.refreshed=Object.values(plan.operations).flat().filter(r=>r.action==='refresh').length;
 json(path.join(cycle,'plan.json'),plan);
 if(plan.exclusions)json(path.join(dataDir,'excluded-records-report.json'),{at:new Date().toISOString(),cycle,...plan.exclusions});
 }
 if(protection)require('../../lib/hosted_protection_guard').assertProtected(plan,protection,{manualSkips,env});
 if(!plan.ok){
  json(path.join(dataDir,'conflict-review.json'),{at:new Date().toISOString(),cycle,conflicts:plan.conflicts});
  throw Error('Ambiguous edits/deletions or changed keys require review: '+path.join(cycle,'plan.json'));
 }
 if(args.plan||(!args['dry-run']&&plan.added+plan.updated+(plan.refreshed||0)===0)){json(path.join(dataDir,'status.json'),{status:args.plan?'planned':'unchanged',database:expected,cycle,at:new Date().toISOString(),added:plan.added,updated:plan.updated});console.log(JSON.stringify({readOnly:!!args.plan,added:plan.added,updated:plan.updated,cycle}));return;}
 storage.assertCapacity(dataDir,storageConfig);
 const {sha256File}=require('../local/common');
 const {SheetsSyncRuntime}=require(repairMode?'../../lib/sheets_sync_runtime.repair':'../../lib/sheets_sync_runtime');
 Object.assign(process.env,childEnv,{CSV_DIR:prepared.latestCertifiedDir,SOURCE_MANIFEST_FILE:prepared.latestSourceManifest,NORMALIZATION_ATTESTATION_FILE:prepared.latestNormalizationAttestation,CLI_CONTRACT_OUTPUT_ROOT:path.join(cycle,'runs'),IMPORT_PROGRESS_JSONL:'true',IMPORT_PROGRESS_EVERY:'1000'});
 const {runDynamicImport}=require(repairMode?'../../lib/mapping_contract_runtime.repair':'../../lib/mapping_contract_runtime');
 const hash=sha256File(prepared.latestSourceManifest);
 const planHash=sha256File(path.join(cycle,'plan.json'));
 if(pending&&(pending.manifestHash!==hash||pending.planHash!==planHash||pending.database!==expected))throw Error('Pending sync evidence changed');
 const dryId='sync_dry_'+stamp();
 json(path.join(dataDir,'status.json'),{status:'validating',database:expected,cycle,dryId,at:new Date().toISOString(),added:plan.added,updated:plan.updated,refreshed:plan.refreshed});
 const drySync=new SheetsSyncRuntime(plan,bundle.protectedMasters,hash);
 await runDynamicImport({rootDir:ROOT,args:{'dry-run':true,'run-id':dryId,'output-dir':path.join(cycle,'runs',dryId)},sync:drySync});
 // Capture against the actual target schema. Apply checks these business
 // preimages inside row transactions; a dry-run success is not a write receipt.
 const preimages=repairMode?drySync.exportBusinessPreimages():null;
 if(preimages)json(path.join(cycle,'business-preimages.json'),preimages);
 if(args['dry-run']){
  json(path.join(dataDir,'status.json'),{status:'dry-run-completed',database:expected,cycle,dryId,at:new Date().toISOString(),added:plan.added,updated:plan.updated,refreshed:plan.refreshed});
  console.log(JSON.stringify({status:'dry-run-completed',dryId,cycle}));return;
 }
 json(path.join(dataDir,'status.json'),{status:'backing-up',database:expected,cycle,dryId,at:new Date().toISOString()});
 const backupFile=await backup(env,cycle);
 if(repairMode&&local)await connection.query(`CREATE TABLE IF NOT EXISTS erp_sync_row_changes (
 id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,run_id VARCHAR(120),profile VARCHAR(40),source_uid VARCHAR(64),
 source_file VARCHAR(255),source_row INT,source_action VARCHAR(30),dispo VARCHAR(255),table_name VARCHAR(64),
 action VARCHAR(30),row_key TEXT,identity_scope VARCHAR(40),affected_rows INT,changed_columns TEXT,
 before_json LONGTEXT,after_json LONGTEXT,note TEXT,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 KEY idx_sync_history_run(run_id),KEY idx_sync_history_source(profile,source_uid)) ENGINE=InnoDB`);
 // Recovery owns this exact source/plan/backup. Do not remove pending.json or
 // rebuild the tracking baseline to make a partially applied run appear clean.
 json(pendingFile,{cycle,database:expected,manifestHash:hash,planHash,backupFile});
 if(manualSkips)await require('../../lib/sync_manual_conflict_skips').verifyRetained(connection,manualSkips);
 const liveId='sync_live_'+stamp();
 json(path.join(dataDir,'status.json'),{status:'applying',database:expected,cycle,liveId,backupFile,at:new Date().toISOString()});
 await runDynamicImport({rootDir:ROOT,args:{live:true,yes:true,'backup-confirmed':true,'approved-dry-run':dryId,'run-id':liveId,'output-dir':path.join(cycle,'runs',liveId),'production-approval':childEnv.PRODUCTION_APPROVAL_TOKEN},sync:new SheetsSyncRuntime(plan,bundle.protectedMasters,hash,repairMode?{businessPreimages:preimages}:{})});
 if(repairMode){
  const verifyId='sync_verify_'+stamp(),verifySync=new SheetsSyncRuntime(plan,bundle.protectedMasters,hash,{verifyOnly:true});
  await runDynamicImport({rootDir:ROOT,args:{'dry-run':true,'run-id':verifyId,'output-dir':path.join(cycle,'runs',verifyId)},sync:verifySync});
  const createdCostingMasters=await require('../../lib/sync_business_evidence').verifyCapturedCostingMasters(connection,preimages);
  json(path.join(cycle,'business-verification.json'),{ok:true,verifyId,manifestHash:hash,planHash,targetsVerified:verifySync.business.targetsVerified,createdCostingMasters,sharedMasterReuses:verifySync.sharedMasterReuses||[],retainedBlankAmounts:verifySync.retainedBlankAmounts||[],retainedChildren:verifySync.retainedChildren||[]});
 }
 if(manualSkips)json(path.join(cycle,'manual-skips-verification.json'),await require('../../lib/sync_manual_conflict_skips').verifyRetained(connection,manualSkips));
 json(path.join(dataDir,'status.json'),{status:'completed',database:expected,cycle,backupFile,at:new Date().toISOString(),added:plan.added,updated:plan.updated});
 fs.unlinkSync(pendingFile);

 console.log(JSON.stringify({status:'completed',added:plan.added,updated:plan.updated,cycle}));
}
main().catch(e=>{
 if(hasLock)json(path.join(dataDir,'status.json'),{status:'failed',cycle:activeCycle,at:new Date().toISOString(),error:e.message});
 console.error(e.stack);process.exitCode=1;
}).finally(async()=>{
 try {
  if(hasLock&&storageConfig){
   storage.cleanup(dataDir,storageConfig,{current:activeCycle});
   if(storageReady)await handshake('storage-finished','storage-finished-ack');
  }
 }catch(e){console.error('Storage maintenance failed: '+e.message);process.exitCode=1;}
 finally {
  clearInterval(lockHeartbeat);
  if(connection){if(hasLock)await connection.query('SELECT RELEASE_LOCK(?)',[lockName]).catch(()=>{});await connection.end();}
  if(process.connected)process.disconnect();
 }
});
