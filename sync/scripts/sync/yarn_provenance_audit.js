'use strict';
// SELECT-only original-ledger / migration-provenance / target-form reconciliation.
// Produces a private, unsigned review packet. Never updates a MySQL row.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const mysql=require('mysql2/promise'),dotenv=require('dotenv');
const ROOT=path.resolve(__dirname,'../..');
const norm=x=>String(x??'').trim().toLowerCase();
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const num=x=>Number(String(x??'0').replace(/,/g,''));
const unique=arr=>[...new Set(arr)];
const EXPECTED='weavonpq_weaving_main';
const OUTPUT=path.join(ROOT,'sync_data','yarn_identity_review.json');
async function getByIds(db,table,columns,ids,field='id'){
 const records=[];
 for(let i=0;i<ids.length;i+=100){
  const slice=ids.slice(i,i+100);
  if(!slice.length)continue;
  const [rows]=await db.query('SELECT '+columns+' FROM '+table+
   ' WHERE '+field+' IN ('+slice.map(()=>'?').join(',')+')',slice);
  records.push(...rows);
 }
 return records;
}
(async()=>{
 if(fs.existsSync(OUTPUT))throw Error('Private review packet already exists; do not overwrite');
 dotenv.config({path:'/home/weavonpq/public_html/main/.env',quiet:true});
 const db=await mysql.createConnection({host:process.env.DB_HOST||'localhost',
  port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,
  password:process.env.DB_PASSWORD,database:EXPECTED,connectTimeout:12000,dateStrings:true});
 try{
  await db.query('START TRANSACTION READ ONLY');
  const [[dbid]]=await db.query('SELECT DATABASE() db');
  if(dbid.db!==EXPECTED)throw Error('Database identity check failed');
  const [events]=await db.query(
   "SELECT profile,source_uid uid,group_key grp,digest,dispo,yarn_identity identityJson "+
   "FROM sheets_sync_events WHERE profile IN ('yarn-issue','yarn-receive')");
  const [provenance]=await db.query(
   "SELECT profile,source_uid uid,target_table, target_primary_key, "+
   "source_manifest_sha256 sourceSha,source_file,source_row_number,created_at "+
   "FROM migration_import_provenance WHERE profile IN ('yarn-issue','yarn-receive')");
  const byUid=new Map();
  for(const p of provenance){
   const k=p.profile+'|'+p.uid;
   if(!byUid.has(k))byUid.set(k,[]);
   byUid.get(k).push(p);
  }
  const present=new Set();
  for(const e of events)if(e.identityJson){
   try{
    const x=typeof e.identityJson==='string'?JSON.parse(e.identityJson):e.identityJson;
    present.add(JSON.stringify([e.profile,...['dispo','count','lot','direction','date','challan'].map(k=>norm(x[k]))]));
   }catch{throw Error('Existing Yarn identity is malformed; do not continue');}
  }
  const missing=events.filter(e=>!e.identityJson);
  if(missing.length!==557)throw Error('Missing yarn identity count changed; refresh review logic first');
  const result=[],summary={totalMissing:missing.length,candidates:0,holds:0,reasons:{},byProfile:{}};
  for(const profile of ['yarn-issue','yarn-receive']){
   const subset=missing.filter(e=>e.profile===profile);
   const targetTable=profile==='yarn-issue'?'yarn_issue_form':'yarn_receive_form';
   const detailTable=profile==='yarn-issue'?'yarn_issue_details':'yarn_received_details';
   const foreignKey=profile==='yarn-issue'?'yarn_issue_form_id':'yarn_receive_form_id';
   const links=subset.flatMap(x=>byUid.get(profile+'|'+x.uid)||[]);
   const ids=unique(links.map(x=>String(x.target_primary_key)).filter(x=>/^[1-9]\d*$/.test(x)));
   const pCols=profile==='yarn-issue'?
    'id,yarn_count,yarn_lot,issue_challan_no,total_warp_issue_kgs,total_weft_issue_kgs':
    'id,yarn_count,yarn_brand,yarn_lot,challan_no';
   const dCols=profile==='yarn-issue'?
    'id,yarn_issue_form_id,dispo_number,issue_date,issued_quantity':
    'id,yarn_receive_form_id,dispo_number,received_date,quantity_kgs';
   const parents=await getByIds(db,targetTable,pCols,ids);
   const details=await getByIds(db,detailTable,dCols,ids,foreignKey);
   const pm=new Map(parents.map(x=>[String(x.id),x])),dm=new Map();
   for(const row of details){
    const k=String(row[foreignKey]);
    if(!dm.has(k))dm.set(k,[]);
    dm.get(k).push(row);
   }
   const pending=[];
   for(const e of subset){
    const pLinks=byUid.get(profile+'|'+e.uid)||[];
    let reason=null,identity=null,target=null,evidenceDigest=null;
    if(pLinks.length!==1)reason='provenance_not_unique';
    else{
     const link=pLinks[0],parent=pm.get(String(link.target_primary_key));
     const child=(dm.get(String(link.target_primary_key))||[]).filter(x=>norm(x.dispo_number)===norm(e.dispo));
     if(link.target_table!==targetTable||!parent||child.length!==1)reason='target_form_or_detail_not_unique';
     else{
      const detail=child[0],date=norm(profile==='yarn-issue'?detail.issue_date:detail.received_date);
      const challan=norm(profile==='yarn-issue'?parent.issue_challan_no:parent.challan_no);
      const count=norm(parent.yarn_count),lot=norm(parent.yarn_lot),dispo=norm(detail.dispo_number);
      const group=profile==='yarn-issue'?[profile,count,lot,date,dispo,challan]:
       [profile,count,norm(parent.yarn_brand),lot,date,dispo,challan];
      if(group.some(x=>!x)||!(/^\d{4}-\d{2}-\d{2}$/.test(date)))reason='incomplete_group_fields';
      else if(sha(group)!==e.grp)reason='historical_group_digest_mismatch';
      else{
       let direction='receipt';
       if(profile==='yarn-issue'){
        const warp=num(parent.total_warp_issue_kgs),weft=num(parent.total_weft_issue_kgs);
        if(warp>0&&weft===0)direction='warp';
        else if(weft>0&&warp===0)direction='weft';
        else reason='warp_weft_direction_ambiguous';
       }
       if(!reason){
        identity={version:1,dispo,count,lot,direction,date,challan};
        const key=JSON.stringify([profile,dispo,count,lot,direction,date,challan]);
        if(present.has(key))reason='identity_collides_with_existing_ledger';
        else{
         target={table:targetTable,pk:String(parent.id),detailId:String(detail.id)};
         evidenceDigest=sha([profile,e.uid,e.digest,e.grp,link.sourceSha,
           link.source_file,link.source_row_number,target,identity]);
         pending.push({key});
        }
       }
      }
     }
    }
    result.push({profile,sourceUid:e.uid,expectedLedgerDigest:e.digest,
     expectedLedgerGroup:e.grp,dispo:e.dispo,target,
     provenance:pLinks.length===1?{sourceManifestSha256:pLinks[0].sourceSha,
       sourceFile:pLinks[0].source_file,sourceRow:pLinks[0].source_row_number}:null,
     reconstructedIdentity:identity,
     evidenceDigest,decision:reason?'HOLD':'REVIEW_REQUIRED',
     reason,approvedBy:null,independentReviewer:null,
     signedSourceEvidence:null});
   }
   const counts=new Map();for(const p of pending)counts.set(p.key,(counts.get(p.key)||0)+1);
   for(const e of result.filter(x=>x.profile===profile&&x.decision==='REVIEW_REQUIRED')){
    const y=e.reconstructedIdentity;
    const key=JSON.stringify([profile,...['dispo','count','lot','direction','date','challan'].map(k=>y[k])]);
    if(counts.get(key)>1){e.decision='HOLD';e.reason='duplicate_reconstructed_event_key';}
   }
   summary.byProfile[profile]={review:result.filter(x=>x.profile===profile&&x.decision==='REVIEW_REQUIRED').length,
     held:result.filter(x=>x.profile===profile&&x.decision==='HOLD').length};
  }
  for(const e of result){
   if(e.decision==='REVIEW_REQUIRED')summary.candidates++;
   else {summary.holds++;summary.reasons[e.reason]=(summary.reasons[e.reason]||0)+1;}
  }
  if(summary.candidates+summary.holds!==557)throw Error('Incomplete evidence classification');
  const packet={purpose:'private unsigned yarn identity recovery review',
   generatedAt:new Date().toISOString(),database:EXPECTED,
   state:'READ_ONLY_REVIEW_NO_EXECUTION',summary,records:result,
   warning:'Group-key equality plus current target values does not authorize automatic held corrections; obtain original-source validation, owner approval and independent second review'};
  await db.query('ROLLBACK');
  fs.writeFileSync(OUTPUT,JSON.stringify(packet,null,2),{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({output:OUTPUT,summary,productionWrites:0},null,2));
 }finally{await db.end()}
})().catch(e=>{console.error('YARN_REVIEW_ERROR '+(e.code||e.message));process.exitCode=1;});
