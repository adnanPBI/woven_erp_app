#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { parseDate, parseNumber, normalizeMatchText } = require('../../lib/source_index');

const EXPECTED_FILES = [
  'po database.csv', 'Dispo create form.csv', 'Greige yarn receive.csv', 'Greige yarn issue.csv',
  'Warping database.csv', 'sizing database.csv', 'Loom production database.csv',
  'Folding production database.csv', 'Greige delivery database.csv',
];
const TECH_BASE = ['__MIG_SOURCE_UID', '__MIG_SOURCE_ROW', '__MIG_SOURCE_ROW_COUNT', '__MIG_ACTION'];
const TECH_PO = [...TECH_BASE, '__MIG_PC_BUYER', '__MIG_PC_CONSTRUCTION', '__MIG_PC_WEAVE_TYPE', '__MIG_PC_FINISH_WIDTH', '__MIG_PC_ORDER_QUANTITY', '__MIG_PC_DATE', '__MIG_PC_WARP_COUNT', '__MIG_PC_WEFT_COUNT', '__MIG_PC_MASTER_FINGERPRINT', '__MIG_BRIDGE_SOURCE'];
const TECH_DISPO = [...TECH_BASE, '__MIG_OPERATIONAL_DISPO', '__MIG_BRIDGE_SOURCE'];

const DATE_HEADERS = {
  'po database.csv': ['PO Issue Date', 'PO Revise Date', 'PO Approval/Dispo Creating Date', 'PP Delivery Date', 'Bulk Delivery Date', 'PI Date'],
  'Dispo create form.csv': ['PO Issue Date', 'PO Received Date', 'PP Sample Delivery Date', 'Bulk Fabric Delivery Date', 'PO Revised Date'],
  'Greige yarn receive.csv': ['L/C Date', 'Received Date', 'Last Received Date'],
  'Greige yarn issue.csv': ['L/C Date', 'Received Start Date', 'Last Received Date', 'Issue Date'],
  'Warping database.csv': ['Warping Date'], 'sizing database.csv': ['Sizing Date'],
  'Loom production database.csv': ['Weaving Dates'], 'Folding production database.csv': ['Folding Production Date'],
  'Greige delivery database.csv': ['Delivery Date'],
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]; if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    if (eq >= 0) out[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[arg.slice(2)] = argv[++i];
    else out[arg.slice(2)] = true;
  }
  return out;
}
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sha256File(filePath) { const h = crypto.createHash('sha256'); const fd = fs.openSync(filePath,'r'); const b=Buffer.allocUnsafe(1024*1024); try { while(true){const n=fs.readSync(fd,b,0,b.length,null); if(!n)break; h.update(b.subarray(0,n));} } finally {fs.closeSync(fd);} return h.digest('hex'); }
function clean(value) { const t=String(value??'').replace(/\u00a0/g,' ').trim(); return t && !/^(?:n\/?a|#n\/?a|none|null|-)$/i.test(t) ? t : ''; }
function norm(value) { return normalizeMatchText(value); }
function num(value) { return parseNumber(value); }
function csvCell(value) { const t=value===null||value===undefined?'':String(value); return /[",\r\n]/.test(t)?`"${t.replace(/"/g,'""')}"`:t; }
function writeRow(fd,row){fs.writeSync(fd,`${row.map(csvCell).join(',')}\n`,null,'utf8');}
function rowHash(values){return sha256(JSON.stringify(values.map(v=>String(v??''))));}
function sourceUid(profile,fileHash,row,hash){return sha256(`row|${profile}|${fileHash}|${row}|${hash}`);}
function groupUid(profile,key){return sha256(`group|${profile}|${key}`);}
function placeholderPreCosting(po){return `MIGPC-${sha256(`PO|${norm(po)}`).slice(0,32)}`;}
function validBusinessId(v){const t=clean(v);return !!t && !/^(?:n\/?a|none|null|unknown|0)$/i.test(t);}
function iso(v){const t=clean(v); return !t?'':(parseDate(t,'dmy')||t);}
function timestampRank(v){const t=clean(v);if(!t)return 0;const d=parseDate(t,'dmy');if(d){const tm=t.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?/);const sec=tm?(+tm[1]*3600+ +tm[2]*60+ +(tm[3]||0)):0;return Date.parse(`${d}T00:00:00Z`)/1000+sec;}const n=Date.parse(t);return Number.isFinite(n)?n/1000:0;}
function numericRevision(v){const m=clean(v).match(/\d+/g);return m?Math.max(...m.map(Number).filter(Number.isFinite)):0;}
function compareTuple(a,b){for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]??0,y=b[i]??0;if(x<y)return-1;if(x>y)return 1;}return 0;}
function makeIndex(headers){const m=new Map();headers.forEach((h,i)=>{const k=String(h??'').replace(/^\uFEFF/,'').replace(/\u00a0/g,' ').trim();if(!m.has(k))m.set(k,i);});return m;}
function get(row,idx,name){const i=idx.get(name);return i===undefined?'':(row[i]??'');}
function set(row,idx,name,v){const i=idx.get(name);if(i!==undefined)row[i]=v??'';}
function copyWithTech(row,headers,tech){return [...row,...headers.map(h=>tech[h]??'')];}
function writeJson(file,value){ensureDir(path.dirname(file));fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`,'utf8');}
function writeJsonl(fd,value){fs.writeSync(fd,`${JSON.stringify(value)}\n`,null,'utf8');}
function nonEmpty(row){return row.some(c=>clean(c));}

function bucketIndex(key,count=64){const h=crypto.createHash('sha256').update(key).digest();return h.readUInt32BE(0)%count;}
async function eachJsonl(filePath,onValue){const rl=readline.createInterface({input:fs.createReadStream(filePath,{encoding:'utf8'}),crlfDelay:Infinity});for await(const line of rl){if(!line)continue;await onValue(JSON.parse(line));}}
function normalizeDates(filename,row,idx,invalid,sourceRow){for(const h of DATE_HEADERS[filename]||[]){const raw=clean(get(row,idx,h));if(!raw)continue;const p=parseDate(raw,'dmy');if(p)set(row,idx,h,p);else invalid.push({source_file:filename,source_row:sourceRow,column:h,value:raw});}}

function csvRecordComplete(text){
  let quoted=false;
  for(let i=0;i<text.length;i++){
    if(text[i]!=="\"")continue;
    if(quoted && text[i+1]==="\""){i++;continue;}
    quoted=!quoted;
  }
  return !quoted;
}
function parseCsvRecord(text){
  const out=[];let field='';let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==="\""){if(text[i+1]==="\""){field+='\"';i++;}else quoted=false;}
      else field+=ch;
      continue;
    }
    if(ch==="\"" && field.length===0){quoted=true;continue;}
    if(ch===','){out.push(field);field='';continue;}
    field+=ch;
  }
  out.push(field);return out;
}
async function eachCsv(filePath,onRow){
  const rl=readline.createInterface({input:fs.createReadStream(filePath,{encoding:'utf8'}),crlfDelay:Infinity});
  let headers=null,rowNo=0,nonempty=0,pending='';
  for await(const line of rl){
    pending=pending?`${pending}\n${line}`:line;
    if(!csvRecordComplete(pending))continue;
    let rec=parseCsvRecord(pending);pending='';rowNo++;
    if(rowNo===1){if(rec.length)rec[0]=String(rec[0]??'').replace(/^\uFEFF/,'');headers=rec.map(v=>String(v??'').replace(/\u00a0/g,' ').trim());continue;}
    if(!nonEmpty(rec))continue;nonempty++;await onRow(rec,rowNo,headers);
  }
  if(pending){const rec=parseCsvRecord(pending);rowNo++;if(rowNo===1)headers=rec;else if(nonEmpty(rec)){nonempty++;await onRow(rec,rowNo,headers);}}
  return {headers:headers||[],nonempty_rows:nonempty};
}
async function fileMeta(filePath){let count=0,headers=[];const r=await eachCsv(filePath,async()=>{count++;});headers=r.headers;return{headers,nonempty_rows:count,sha256:sha256File(filePath),bytes:fs.statSync(filePath).size};}

async function canonicalWinners(filePath,keyHeader,ranker){
  const winners=new Map(),counts=new Map();let headers=[],idx;
  const meta=await eachCsv(filePath,async(row,rowNo,h)=>{if(!headers.length){headers=h;idx=makeIndex(h);}const value=clean(get(row,idx,keyHeader));if(!value)return;const key=norm(value);counts.set(key,(counts.get(key)||0)+1);const rank=ranker(row,idx,rowNo);const cur=winners.get(key);if(!cur||compareTuple(cur.rank,rank)<0)winners.set(key,{sourceRow:rowNo,rank,value});});
  return{winners,counts,headers,idx,meta};
}
async function canonicalRows(filePath,canonical,keyHeader){
  const byKey=new Map(),memberInfo=new Map();let headers=[],idx;
  const meta=await eachCsv(filePath,async(row,rowNo,h)=>{if(!headers.length){headers=h;idx=makeIndex(h);}const value=clean(get(row,idx,keyHeader));if(!value)return;const key=norm(value);let info=memberInfo.get(key);if(!info){info={count:0,rows:[]};memberInfo.set(key,info);}info.count++;if(info.rows.length<10000)info.rows.push({sourceRow:rowNo,rowHash:rowHash(row)});if(canonical.winners.get(key)?.sourceRow===rowNo)byKey.set(key,{sourceRow:rowNo,values:row.slice(),rawRowHash:rowHash(row)});});
  return{byKey,memberInfo,headers,idx,meta};
}

function consensus(values,latest=''){const vals=values.map(clean).filter(Boolean);if(!vals.length)return{value:'',conflict:false,variants:[]};const counts=new Map(),original=new Map();for(const v of vals){const k=norm(v);counts.set(k,(counts.get(k)||0)+1);if(!original.has(k))original.set(k,v);}const max=Math.max(...counts.values());let candidates=[...counts].filter(([,c])=>c===max).map(([k])=>k).sort();const lk=norm(latest);const selected=lk&&candidates.includes(lk)?lk:candidates[0];return{value:original.get(selected),conflict:counts.size>1,variants:[...original.values()]};}
function commonOrBlank(values){const vals=[...new Set(values.map(clean).filter(Boolean))];return vals.length===1?vals[0]:'';}

async function scanHistoricalDispos(inputDir,known){
  const specs=[
    ['Greige yarn receive.csv','yarn-receive',['Received GD NO'],['Special Notes','Search Column']],
    ['Greige yarn issue.csv','yarn-issue',['Dispo No'],[]],['Warping database.csv','warping',['Dispo No'],[]],
    ['sizing database.csv','sizing',['Dispo No'],[]],['Loom production database.csv','loom',['Dispo No'],[]],
    ['Folding production database.csv','folding',['Dispo No'],[]],['Greige delivery database.csv','greige-delivery',['Dispo No'],[]],
  ];
  const found=new Map();const re=/\b([A-Z0-9]{1,12}(?:\/[A-Z0-9_-]{1,20})*\/GD\/\d{2,4}\/\d{3,})\b/i;
  for(const [filename,profile,direct,texts] of specs){let idx;await eachCsv(path.join(inputDir,filename),async(row,rowNo,h)=>{if(!idx)idx=makeIndex(h);let dispo='';for(const k of direct){dispo=clean(get(row,idx,k));if(dispo)break;}if(!dispo)for(const k of texts){const m=clean(get(row,idx,k)).match(re);if(m){dispo=m[1];break;}}const key=norm(dispo);if(!key||known.has(key)||found.has(key))return;found.set(key,{dispo,profile,source_file:filename,source_row:rowNo,buyer:clean(get(row,idx,'Buyer'))||clean(get(row,idx,'BUYER NAME')),construction:clean(get(row,idx,'Construction'))||clean(get(row,idx,'Production Construction')),composition:clean(get(row,idx,'Fabric Composition'))});});}
  return found;
}

async function main(){
  const args=parseArgs(process.argv.slice(2));const root=path.resolve(__dirname,'../..');
  const inputDir=path.resolve(args.input||args['input-dir']||process.env.V323_RAW_SOURCE_DIR||'');
  const outputRoot=path.resolve(args.output||args['output-root']||process.env.V323_NORMALIZATION_ROOT||path.join(root,'output','v323_normalization'));
  const policyPath=path.resolve(args.policy||path.join(root,'config','normalization_policy.v3.2.3.json'));
  if(!inputDir||!fs.existsSync(inputDir))throw new Error(`Input/freeze directory not found: ${inputDir}`);if(!fs.existsSync(policyPath))throw new Error(`Normalization policy not found: ${policyPath}`);
  for(const f of EXPECTED_FILES)if(!fs.existsSync(path.join(inputDir,f)))throw new Error(`Frozen source missing: ${f}`);
  const certifiedDir=path.join(outputRoot,'certified'),auditDir=path.join(outputRoot,'audit'),manifestDir=path.join(outputRoot,'manifests');ensureDir(certifiedDir);ensureDir(auditDir);ensureDir(manifestDir);
  const policyHash=sha256File(policyPath);const raw={};for(const f of EXPECTED_FILES){raw[f]={sha256:sha256File(path.join(inputDir,f)),bytes:fs.statSync(path.join(inputDir,f)).size};}
  fs.writeFileSync(path.join(manifestDir,'raw_SHA256SUMS.txt'),EXPECTED_FILES.slice().sort().map(f=>`${raw[f].sha256}  ${f}`).join('\n')+'\n');
  const lineageFd=fs.openSync(path.join(auditDir,'normalization_lineage.jsonl'),'w'),placeholderFd=fs.openSync(path.join(auditDir,'placeholder_precosting.jsonl'),'w'),conflictFd=fs.openSync(path.join(auditDir,'pre_costing_master_conflicts.jsonl'),'w'),revisionFd=fs.openSync(path.join(auditDir,'canonical_revisions.jsonl'),'w'),unlinkedFd=fs.openSync(path.join(auditDir,'unlinked_source_rows.jsonl'),'w');
  const invalidDates=[];const summary={version:'3.2.3-hybrid-1',generated_at:new Date().toISOString(),input_dir:inputDir,certified_dir:certifiedDir,policy_sha256:policyHash,files:{},counts:{}};
  try{
    const poPath=path.join(inputDir,'po database.csv'),dispoPath=path.join(inputDir,'Dispo create form.csv');
    const poCan=await canonicalWinners(poPath,'PO NO',(r,i,n)=>[numericRevision(get(r,i,'PO Revised No')),timestampRank(get(r,i,'PO Revise Date')),timestampRank(get(r,i,'Last Modified Date')),timestampRank(get(r,i,'PO Approval/Dispo Creating Date')),n]);
    const dispoCan=await canonicalWinners(dispoPath,'Dispo No.',(r,i,n)=>[numericRevision(get(r,i,'Bulk Revised No.')),numericRevision(get(r,i,'Reproduction Revised No.')),timestampRank(get(r,i,'PO Revised Date')),n]);
    const poData=await canonicalRows(poPath,poCan,'PO NO'),dispoData=await canonicalRows(dispoPath,dispoCan,'Dispo No.');
    raw['po database.csv'].nonempty_rows=poData.meta.nonempty_rows;raw['Dispo create form.csv'].nonempty_rows=dispoData.meta.nonempty_rows;
    const knownPo=new Set(poData.byKey.keys()),knownDispo=new Set(dispoData.byKey.keys()),poIdx=poData.idx,dispoIdx=dispoData.idx;
    const bridgePos=new Map();
    for(const rec of dispoData.byKey.values()){const po=clean(get(rec.values,dispoIdx,'PO No.'));if(!validBusinessId(po))continue;const pk=norm(po);if(knownPo.has(pk)||bridgePos.has(pk))continue;const row=new Array(poData.headers.length).fill('');set(row,poIdx,'PO NO',po);set(row,poIdx,'BUYER NAME',clean(get(rec.values,dispoIdx,'Buyer')));set(row,poIdx,'WEAVE TYPE',clean(get(rec.values,dispoIdx,'Weave')));set(row,poIdx,'PRODUCTION CONSTRUCTION',clean(get(rec.values,dispoIdx,'Production Construction')));set(row,poIdx,'STICKER CONSTRUCTION',clean(get(rec.values,dispoIdx,'Sticker Construction')));set(row,poIdx,'FABRIC COMPOSITION',clean(get(rec.values,dispoIdx,'Fabric Composition')));set(row,poIdx,'DISPO NUMBER',clean(get(rec.values,dispoIdx,'Dispo No.')));set(row,poIdx,'DISPO OVERALL WIDTH',clean(get(rec.values,dispoIdx,'Finish Width (Inch)')));set(row,poIdx,'PO Quantity (Yds)',clean(get(rec.values,dispoIdx,'PO Quantity (Yds)')));set(row,poIdx,'PO Issue Date',clean(get(rec.values,dispoIdx,'PO Issue Date')));bridgePos.set(pk,{sourceRow:rec.sourceRow,values:row,rawRowHash:rowHash(row),bridgeSource:`Dispo create form.csv:${rec.sourceRow}`});}
    for(const [k,v] of bridgePos){poData.byKey.set(k,v);knownPo.add(k);}
    const historical=await scanHistoricalDispos(inputDir,knownDispo);

    const preGroups=new Map();let placeholders=0;
    for(const rec of poData.byKey.values()){const po=clean(get(rec.values,poIdx,'PO NO'));let pre=clean(get(rec.values,poIdx,'PRE_COSTING_NO'));if(!pre){pre=placeholderPreCosting(po);set(rec.values,poIdx,'PRE_COSTING_NO',pre);placeholders++;writeJsonl(placeholderFd,{placeholder_pre_costing_no:pre,po_no:po,action:'approved_deterministic_placeholder',source_row:rec.sourceRow,bridge_source:rec.bridgeSource||null});}const k=norm(pre);if(!preGroups.has(k))preGroups.set(k,[]);preGroups.get(k).push(rec);}
    const pcByPre=new Map();let conflictGroups=0;
    for(const [k,recs] of preGroups){const latest=recs.slice().sort((a,b)=>a.sourceRow-b.sourceRow).at(-1);const f={buyer:consensus(recs.map(r=>get(r.values,poIdx,'BUYER NAME')),get(latest.values,poIdx,'BUYER NAME')),construction:consensus(recs.map(r=>clean(get(r.values,poIdx,'PRODUCTION CONSTRUCTION'))||clean(get(r.values,poIdx,'STICKER CONSTRUCTION'))),clean(get(latest.values,poIdx,'PRODUCTION CONSTRUCTION'))||clean(get(latest.values,poIdx,'STICKER CONSTRUCTION'))),weave:consensus(recs.map(r=>get(r.values,poIdx,'WEAVE TYPE')),get(latest.values,poIdx,'WEAVE TYPE')),width:consensus(recs.map(r=>get(r.values,poIdx,'DISPO OVERALL WIDTH')),get(latest.values,poIdx,'DISPO OVERALL WIDTH')),warp_count:consensus(recs.map(r=>get(r.values,poIdx,'WARP COUNT')),get(latest.values,poIdx,'WARP COUNT')),weft_count:consensus(recs.map(r=>get(r.values,poIdx,'WEFT COUNT')),get(latest.values,poIdx,'WEFT COUNT'))};const conflicts=Object.entries(f).filter(([,v])=>v.conflict).map(([n])=>n);if(conflicts.length){conflictGroups++;writeJsonl(conflictFd,{pre_costing_no:clean(get(recs[0].values,poIdx,'PRE_COSTING_NO')),po_numbers:recs.map(r=>clean(get(r.values,poIdx,'PO NO'))),conflict_fields:conflicts,resolution:'field_consensus_then_latest_rank',selected:Object.fromEntries(Object.entries(f).map(([n,v])=>[n,v.value])),variants:Object.fromEntries(Object.entries(f).filter(([,v])=>v.conflict).map(([n,v])=>[n,v.variants]))});}const pc={buyer:f.buyer.value,construction:f.construction.value,weave:f.weave.value,width:f.width.value,warp_count:f.warp_count.value,weft_count:f.weft_count.value,order_quantity:commonOrBlank(recs.map(r=>get(r.values,poIdx,'PO Quantity (Yds)'))),pre_costing_date:commonOrBlank(recs.map(r=>iso(get(r.values,poIdx,'PO Issue Date'))))};pc.fingerprint=sha256(JSON.stringify(pc));pcByPre.set(k,pc);}

    let poWritten=0;const poFd=fs.openSync(path.join(certifiedDir,'po database.csv'),'w');writeRow(poFd,[...poData.headers,...TECH_PO]);
    for(const [pk,rec] of [...poData.byKey].sort((a,b)=>a[0].localeCompare(b[0]))){normalizeDates('po database.csv',rec.values,poIdx,invalidDates,rec.sourceRow);const po=clean(get(rec.values,poIdx,'PO NO')),pre=clean(get(rec.values,poIdx,'PRE_COSTING_NO')),pc=pcByPre.get(norm(pre)),members=poData.memberInfo.get(pk),count=members?.count||1,uid=groupUid('po',pk),action=rec.bridgeSource?'bridge_real_po_from_dispo':(count>1?'canonical_revision':'passthrough');writeRow(poFd,copyWithTech(rec.values,TECH_PO,{__MIG_SOURCE_UID:uid,__MIG_SOURCE_ROW:rec.sourceRow,__MIG_SOURCE_ROW_COUNT:count,__MIG_ACTION:action,__MIG_PC_BUYER:pc?.buyer||'',__MIG_PC_CONSTRUCTION:pc?.construction||'',__MIG_PC_WEAVE_TYPE:pc?.weave||'',__MIG_PC_FINISH_WIDTH:pc?.width||'',__MIG_PC_ORDER_QUANTITY:pc?.order_quantity||'',__MIG_PC_DATE:pc?.pre_costing_date||'',__MIG_PC_WARP_COUNT:pc?.warp_count||'',__MIG_PC_WEFT_COUNT:pc?.weft_count||'',__MIG_PC_MASTER_FINGERPRINT:pc?.fingerprint||'',__MIG_BRIDGE_SOURCE:rec.bridgeSource||''}));poWritten++;if(members)for(const m of members.rows)writeJsonl(lineageFd,{p:'po',f:'po database.csv',r:m.sourceRow,h:m.rowHash,u:uid,a:action,k:po});else writeJsonl(lineageFd,{p:'po',f:'Dispo create form.csv',r:rec.sourceRow,h:rec.rawRowHash,u:uid,a:action,k:po,b:rec.bridgeSource});if(count>1)writeJsonl(revisionFd,{profile:'po',key:po,member_rows:members.rows.map(x=>x.sourceRow),selected_source_row:rec.sourceRow,action});}
    fs.closeSync(poFd);summary.files['po database.csv']={raw_rows:raw['po database.csv'].nonempty_rows,certified_rows:poWritten,bridge_rows:bridgePos.size};

    let dispoWritten=0,planOnly=0;const dispoFd=fs.openSync(path.join(certifiedDir,'Dispo create form.csv'),'w');writeRow(dispoFd,[...dispoData.headers,...TECH_DISPO]);
    for(const [dk,rec] of [...dispoData.byKey].sort((a,b)=>a[0].localeCompare(b[0]))){normalizeDates('Dispo create form.csv',rec.values,dispoIdx,invalidDates,rec.sourceRow);const dispo=clean(get(rec.values,dispoIdx,'Dispo No.')),po=clean(get(rec.values,dispoIdx,'PO No.')),operational=validBusinessId(po)&&knownPo.has(norm(po)),members=dispoData.memberInfo.get(dk),count=members?.count||1,uid=groupUid('dispo',dk),action=count>1?'canonical_revision':'passthrough';if(!operational)planOnly++;writeRow(dispoFd,copyWithTech(rec.values,TECH_DISPO,{__MIG_SOURCE_UID:uid,__MIG_SOURCE_ROW:rec.sourceRow,__MIG_SOURCE_ROW_COUNT:count,__MIG_ACTION:action,__MIG_OPERATIONAL_DISPO:operational?'full':'plan-only',__MIG_BRIDGE_SOURCE:''}));dispoWritten++;if(members)for(const m of members.rows)writeJsonl(lineageFd,{p:'dispo',f:'Dispo create form.csv',r:m.sourceRow,h:m.rowHash,u:uid,a:action,k:dispo});if(!operational)writeJsonl(unlinkedFd,{profile:'dispo',source_file:'Dispo create form.csv',source_row:rec.sourceRow,dispo_number:dispo,po_number:po||null,reason:'plan_only_missing_or_invalid_po'});if(count>1)writeJsonl(revisionFd,{profile:'dispo',key:dispo,member_rows:members.rows.map(x=>x.sourceRow),selected_source_row:rec.sourceRow,action});}
    for(const [dk,b] of [...historical].sort((a,b)=>a[0].localeCompare(b[0]))){const row=new Array(dispoData.headers.length).fill('');set(row,dispoIdx,'Dispo No.',b.dispo);set(row,dispoIdx,'Buyer',b.buyer);set(row,dispoIdx,'Production Construction',b.construction);set(row,dispoIdx,'Fabric Composition',b.composition);const uid=groupUid('dispo',dk);writeRow(dispoFd,copyWithTech(row,TECH_DISPO,{__MIG_SOURCE_UID:uid,__MIG_SOURCE_ROW:b.source_row,__MIG_SOURCE_ROW_COUNT:1,__MIG_ACTION:'historical_plan_bridge',__MIG_OPERATIONAL_DISPO:'plan-only',__MIG_BRIDGE_SOURCE:`${b.source_file}:${b.source_row}`}));dispoWritten++;planOnly++;writeJsonl(lineageFd,{p:'dispo',f:b.source_file,r:b.source_row,u:uid,a:'historical_plan_bridge',k:b.dispo});writeJsonl(unlinkedFd,{profile:b.profile,source_file:b.source_file,source_row:b.source_row,dispo_number:b.dispo,reason:'historical_dispo_not_in_master_source_plan_bridge_created'});}
    fs.closeSync(dispoFd);summary.files['Dispo create form.csv']={raw_rows:raw['Dispo create form.csv'].nonempty_rows,certified_rows:dispoWritten,historical_plan_bridges:historical.size,plan_only_rows:planOnly};

    const pass=[['Greige yarn receive.csv','yarn-receive'],['Greige yarn issue.csv','yarn-issue'],['Warping database.csv','warping'],['sizing database.csv','sizing'],['Greige delivery database.csv','greige-delivery']];
    for(const [filename,profile] of pass){const inPath=path.join(inputDir,filename),fd=fs.openSync(path.join(certifiedDir,filename),'w');let idx,headers,written=0;const meta=await eachCsv(inPath,async(row,rowNo,h)=>{if(!headers){headers=h;idx=makeIndex(h);writeRow(fd,[...h,...TECH_BASE]);}const original=row.slice(),rh=rowHash(original),uid=sourceUid(profile,raw[filename].sha256,rowNo,rh);normalizeDates(filename,row,idx,invalidDates,rowNo);writeRow(fd,copyWithTech(row,TECH_BASE,{__MIG_SOURCE_UID:uid,__MIG_SOURCE_ROW:rowNo,__MIG_SOURCE_ROW_COUNT:1,__MIG_ACTION:'preserved_source_event'}));writeJsonl(lineageFd,{p:profile,f:filename,r:rowNo,h:rh,u:uid,a:'preserved_source_event'});if(profile==='yarn-receive'){if(!clean(get(original,idx,'Received GD NO')))writeJsonl(unlinkedFd,{profile,source_file:filename,source_row:rowNo,field:'dispo',reason:'nullable_missing_dispo'});if(!clean(get(original,idx,'Challan No')))writeJsonl(unlinkedFd,{profile,source_file:filename,source_row:rowNo,field:'challan',reason:'nullable_missing_challan'});if(!clean(get(original,idx,'Yarn brand')))writeJsonl(unlinkedFd,{profile,source_file:filename,source_row:rowNo,field:'yarn_brand',reason:'nullable_missing_brand'});}else if(profile==='yarn-issue'){if(!clean(get(original,idx,'Dispo No')))writeJsonl(unlinkedFd,{profile,source_file:filename,source_row:rowNo,field:'dispo',reason:'nullable_missing_dispo'});if(!clean(get(original,idx,'S/R/Challan No')))writeJsonl(unlinkedFd,{profile,source_file:filename,source_row:rowNo,field:'challan',reason:'nullable_missing_challan'});}else if(profile==='greige-delivery'&&!clean(get(original,idx,'Challan No')))writeJsonl(unlinkedFd,{profile,source_file:filename,source_row:rowNo,field:'challan',reason:'nullable_missing_challan'});written++;});fs.closeSync(fd);raw[filename].nonempty_rows=meta.nonempty_rows;summary.files[filename]={raw_rows:meta.nonempty_rows,certified_rows:written,preserved_events:written};}

    {const filename='Loom production database.csv',inPath=path.join(inputDir,filename);let idx,headers;const bucketDir=path.join(outputRoot,'tmp','loom');ensureDir(bucketDir);const bucketCount=64,bucketFds=Array.from({length:bucketCount},(_,i)=>fs.openSync(path.join(bucketDir,`${String(i).padStart(2,'0')}.jsonl`),'w'));const meta=await eachCsv(inPath,async(row,rowNo,h)=>{if(!headers){headers=h;idx=makeIndex(h);}const key=`${norm(get(row,idx,'Dispo No'))}|${iso(get(row,idx,'Weaving Dates'))}`,uid=groupUid('loom',key),bi=bucketIndex(key,bucketCount);fs.writeSync(bucketFds[bi],`${JSON.stringify([rowNo,row,key,uid])}\n`);writeJsonl(lineageFd,{p:'loom',f:filename,r:rowNo,h:rowHash(row),u:uid,a:'daily_aggregate',k:key});});for(const fd of bucketFds)fs.closeSync(fd);raw[filename].nonempty_rows=meta.nonempty_rows;const fd=fs.openSync(path.join(certifiedDir,filename),'w');writeRow(fd,[...headers,...TECH_BASE]);let groupCount=0,multi=0;for(let bi=0;bi<bucketCount;bi++){const groups=new Map();await eachJsonl(path.join(bucketDir,`${String(bi).padStart(2,'0')}.jsonl`),async item=>{const [rowNo,row,key,uid]=item,production=(num(get(row,idx,'In house Production/Day'))||0)+(num(get(row,idx,'Out Side Production/Day'))||0),rpm=num(get(row,idx,'Avg RPM'));let g=groups.get(key);if(!g)g={values:row.slice(),firstRow:rowNo,count:0,inHouse:0,outside:0,run:null,beam:null,rpmWeighted:0,rpmWeight:0,rpmValues:[],uid};g.count++;g.values=row.slice();g.inHouse+=num(get(row,idx,'In house Production/Day'))||0;g.outside+=num(get(row,idx,'Out Side Production/Day'))||0;const run=num(get(row,idx,'Total Run Loom')),beam=num(get(row,idx,'Total No of beam'));if(run!==null)g.run=g.run===null?run:Math.max(g.run,run);if(beam!==null)g.beam=g.beam===null?beam:Math.max(g.beam,beam);if(rpm!==null){g.rpmValues.push(rpm);if(production>0){g.rpmWeighted+=rpm*production;g.rpmWeight+=production;}}groups.set(key,g);});for(const g of groups.values()){const row=g.values.slice();normalizeDates(filename,row,idx,invalidDates,g.firstRow);set(row,idx,'In house Production/Day',Number(g.inHouse.toFixed(6)));set(row,idx,'Out Side Production/Day',Number(g.outside.toFixed(6)));if(g.run!==null)set(row,idx,'Total Run Loom',g.run);if(g.beam!==null)set(row,idx,'Total No of beam',g.beam);const avg=g.rpmWeight>0?g.rpmWeighted/g.rpmWeight:(g.rpmValues.length?g.rpmValues.reduce((a,b)=>a+b,0)/g.rpmValues.length:null);if(avg!==null)set(row,idx,'Avg RPM',Number(avg.toFixed(4)));writeRow(fd,copyWithTech(row,TECH_BASE,{__MIG_SOURCE_UID:g.uid,__MIG_SOURCE_ROW:g.firstRow,__MIG_SOURCE_ROW_COUNT:g.count,__MIG_ACTION:g.count>1?'daily_aggregate':'passthrough'}));groupCount++;if(g.count>1)multi++;}}fs.closeSync(fd);fs.rmSync(bucketDir,{recursive:true,force:true});summary.files[filename]={raw_rows:meta.nonempty_rows,certified_rows:groupCount,aggregated_rows_removed_from_operational_view:meta.nonempty_rows-groupCount,multirow_groups:multi};}

    {const filename='Folding production database.csv',inPath=path.join(inputDir,filename);let idx,headers;const bucketDir=path.join(outputRoot,'tmp','folding');ensureDir(bucketDir);const bucketCount=64,bucketFds=Array.from({length:bucketCount},(_,i)=>fs.openSync(path.join(bucketDir,`${String(i).padStart(2,'0')}.jsonl`),'w'));const meta=await eachCsv(inPath,async(row,rowNo,h)=>{if(!headers){headers=h;idx=makeIndex(h);}const key=`${norm(get(row,idx,'Dispo No'))}|${iso(get(row,idx,'Folding Production Date'))}`,uid=groupUid('folding',key),bi=bucketIndex(key,bucketCount);fs.writeSync(bucketFds[bi],`${JSON.stringify([rowNo,row,key,uid])}\n`);writeJsonl(lineageFd,{p:'folding',f:filename,r:rowNo,h:rowHash(row),u:uid,a:'daily_aggregate',k:key});});for(const fd of bucketFds)fs.closeSync(fd);raw[filename].nonempty_rows=meta.nonempty_rows;const fd=fs.openSync(path.join(certifiedDir,filename),'w');writeRow(fd,[...headers,...TECH_BASE]);let groupCount=0,multi=0;for(let bi=0;bi<bucketCount;bi++){const groups=new Map();await eachJsonl(path.join(bucketDir,`${String(bi).padStart(2,'0')}.jsonl`),async item=>{const [rowNo,row,key,uid]=item;let g=groups.get(key);if(!g)g={values:row.slice(),firstRow:rowNo,count:0,sums:{'A-Grade':0,'B-Grade':0,'C-Grade':0,'Reject/C grade':0},uid};g.count++;g.values=row.slice();for(const h2 of Object.keys(g.sums))g.sums[h2]+=num(get(row,idx,h2))||0;groups.set(key,g);});for(const g of groups.values()){const row=g.values.slice();normalizeDates(filename,row,idx,invalidDates,g.firstRow);for(const [h2,v] of Object.entries(g.sums))set(row,idx,h2,Number(v.toFixed(6)));writeRow(fd,copyWithTech(row,TECH_BASE,{__MIG_SOURCE_UID:g.uid,__MIG_SOURCE_ROW:g.firstRow,__MIG_SOURCE_ROW_COUNT:g.count,__MIG_ACTION:g.count>1?'daily_aggregate':'passthrough'}));groupCount++;if(g.count>1)multi++;}}fs.closeSync(fd);fs.rmSync(bucketDir,{recursive:true,force:true});summary.files[filename]={raw_rows:meta.nonempty_rows,certified_rows:groupCount,aggregated_rows_removed_from_operational_view:meta.nonempty_rows-groupCount,multirow_groups:multi};}

    summary.counts={placeholders_created:placeholders,pre_costing_master_conflict_groups_resolved:conflictGroups,bridge_real_po_rows:bridgePos.size,historical_dispo_plan_bridges:historical.size,invalid_date_values_preserved:invalidDates.length};
  } finally {for(const fd of [lineageFd,placeholderFd,conflictFd,revisionFd,unlinkedFd])try{fs.closeSync(fd);}catch(_){} }

  writeJson(path.join(auditDir,'invalid_date_values.json'),invalidDates);writeJson(path.join(auditDir,'normalization_summary.json'),summary);
  const certified={};for(const f of EXPECTED_FILES){const p=path.join(certifiedDir,f);certified[f]={sha256:sha256File(p),bytes:fs.statSync(p).size,nonempty_rows:summary.files[f]?.certified_rows??0};}
  fs.writeFileSync(path.join(manifestDir,'certified_SHA256SUMS.txt'),EXPECTED_FILES.slice().sort().map(f=>`${certified[f].sha256}  ${f}`).join('\n')+'\n');
  const artifactPaths={normalization_lineage:path.join(auditDir,'normalization_lineage.jsonl'),placeholder_precosting:path.join(auditDir,'placeholder_precosting.jsonl'),pre_costing_master_conflicts:path.join(auditDir,'pre_costing_master_conflicts.jsonl'),canonical_revisions:path.join(auditDir,'canonical_revisions.jsonl'),unlinked_source_rows:path.join(auditDir,'unlinked_source_rows.jsonl'),invalid_date_values:path.join(auditDir,'invalid_date_values.json'),normalization_summary:path.join(auditDir,'normalization_summary.json'),raw_sums:path.join(manifestDir,'raw_SHA256SUMS.txt'),certified_sums:path.join(manifestDir,'certified_SHA256SUMS.txt')};
  const artifacts=Object.fromEntries(Object.entries(artifactPaths).map(([n,p])=>[n,{path:p,sha256:sha256File(p),bytes:fs.statSync(p).size}]));
  const att={attestation_version:'3.2.3-hybrid-1',status:'PASS',generated_at:new Date().toISOString(),raw_source_dir:inputDir,certified_source_dir:certifiedDir,normalization_policy_file:policyPath,normalization_policy_sha256:policyHash,raw_files:raw,certified_files:certified,artifacts,summary:summary.counts,blocking_findings:0};
  const attPath=path.join(auditDir,'normalization-attestation.json');writeJson(attPath,att);console.log(JSON.stringify({ok:true,status:'PASS',outputRoot,certifiedDir,auditDir,manifestDir,attestationPath:attPath,attestationSha256:sha256File(attPath),policySha256:policyHash,files:9,summary:summary.counts},null,2));
}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.message,stack:e.stack},null,2));process.exit(1);});
