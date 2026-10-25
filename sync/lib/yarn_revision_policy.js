'use strict';
// Select a replacement revision, never sum quantities. This is an explicit
// recovery policy; callers must keep raw inputs and supersession evidence.
const {eventKey,parseIdentity}=require('./yarn_sync_identity');
const {parseDate}=require('./source_index');
function outsideRevisionSignature(headers,values){
 const get=h=>String(values[headers.indexOf(h)]??'').trim();
 if(get('Warp')!==''||get('Weft')!==''||get('Out Side')===''||!Number.isFinite(Number(get('Out Side').replace(/,/g,''))))return null;
 const fields=headers.map((h,i)=>[h,String(values[i]??'')]).filter(([h])=>
  h!=='Out Side'&&!/^Last Modified(?: Date)?$/i.test(h)&&!['Search Column','Stock Column'].includes(h)&&!h.startsWith('__MIG_'));
 return require('crypto').createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
function revisionTime(value){
 const raw=String(value??'').trim();if(!raw)return null;
 const date=parseDate(raw,'dmy');if(!date)return null;
 const time=raw.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
 const hour=Number(time?.[1]||0),minute=Number(time?.[2]||0),second=Number(time?.[3]||0);
 if(hour>23||minute>59||second>59)return null;
 return Date.parse(date+'T00:00:00Z')+(hour*3600+minute*60+second)*1000;
}
function selectLatestYarnRevisions(profile,records,{start,end,allowSourceOrder=false,preserveEntries=false}={}){
 if(!['yarn-receive','yarn-issue'].includes(profile))throw Error('Yarn profile required');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start||'')||!/^\d{4}-\d{2}-\d{2}$/.test(end||'')||start>end)throw Error('Explicit revision window required');
 if(preserveEntries)return {selected:[...records].sort((a,b)=>a.rowNumber-b.rowNumber),superseded:[],conflicts:[]};
 const groups=new Map(),selected=[],superseded=[],conflicts=[];
 for(const row of records){
  let y=parseIdentity(row.yarnIdentity);
  // Outside issues have no warp/weft direction. Recognize them only with an
  // explicit numeric outside amount and identical remaining source fields.
  // Keep persisted identities unchanged; this is revision selection evidence.
  const outside=profile==='yarn-issue'&&y?.direction===''&&/^[a-f0-9]{64}$/.test(row.outsideRevisionSignature||'');
  if(outside)y={...y,direction:'outside'};
  const complete=y&&['dispo','count','lot','direction','date','challan'].every(k=>y[k]&&!/^(?:n\/?a|none|null|unknown|-)$/i.test(y[k]));
  const key=complete?eventKey(y)+(outside?'|'+row.outsideRevisionSignature:''):null;
  if(!key||row.businessDate<start||row.businessDate>end){selected.push(row);continue;}
  if(!Number.isInteger(row.rowNumber))throw Error('Source row evidence required');
  if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
 }
 for(const [key,rows]of groups){
  if(rows.length===1){selected.push(rows[0]);continue;}
  if(new Set(rows.map(r=>r.rowNumber)).size!==rows.length)throw Error('Duplicate source row number');
  const times=rows.map(r=>revisionTime(r.lastModified));
  let basis;
  if(times.every(t=>t!==null))basis='last-modified-then-source-order';
  else if(times.every(t=>t===null)&&rows.every(r=>!String(r.lastModified??'').trim())&&allowSourceOrder)basis='later-source-row';
  else {conflicts.push({key,reason:'revision_order_not_established',rows:rows.map(r=>r.rowNumber)});selected.push(...rows);continue;}
  const ranked=rows.map((r,i)=>({r,t:times[i]??0})).sort((a,b)=>a.t-b.t||a.r.rowNumber-b.r.rowNumber);
  const winner=ranked.at(-1).r;selected.push(winner);
  for(const {r} of ranked.slice(0,-1))superseded.push({profile,key,sourceRow:r.rowNumber,digest:r.digest,selectedSourceRow:winner.rowNumber,selectedDigest:winner.digest,basis});
 }
 selected.sort((a,b)=>a.rowNumber-b.rowNumber);
 return {selected,superseded,conflicts};
}
module.exports={selectLatestYarnRevisions,revisionTime,outsideRevisionSignature};
