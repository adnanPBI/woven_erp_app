'use strict';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function createReadPacer({intervalMs=1250,now=Date.now,wait=sleep}={}){
 if(!Number.isSafeInteger(intervalMs)||intervalMs<=0)throw Error('Invalid Google read pacing interval');
 let next=0,tail=Promise.resolve();
 return()=>{
  const slot=tail.then(async()=>{const delay=Math.max(0,next-now());if(delay)await wait(delay);next=now()+intervalMs;});
  tail=slot.catch(()=>{});return slot;
 };
}
function retryDelayMs(status,attempt,retryAfter,{now=Date.now,random=Math.random}={}){
 const text=String(retryAfter??'').trim(),seconds=Number(text),date=Date.parse(text);
 const supplied=text?(Number.isFinite(seconds)?Math.max(0,seconds*1000):Number.isFinite(date)?Math.max(0,date-now()):0):0;
 // A 429 can arrive near the start of Google's one-minute quota window.
 // Six retries ending after only 31 seconds can exhaust before it refills.
 const base=status===429?64000:Math.min(64000,1000*(2**attempt));
 return Math.max(supplied,base+Math.floor(random()*1001));
}
const pace=createReadPacer();
function retryableTransport(error){
 return ['TimeoutError','AbortError','SyntaxError'].includes(error?.name)||
  ['ECONNRESET','ETIMEDOUT','EAI_AGAIN','ECONNREFUSED','ENOTFOUND','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','UND_ERR_SOCKET'].includes(error?.cause?.code||error?.code)||
  error?.name==='TypeError'&&error.message==='fetch failed';
}
async function readGoogleJson(url,{getToken,fetchImpl=require('./google_http_transport').googleFetch,pacer=pace,wait=sleep,delay=retryDelayMs,requestTimeoutMs=45000,onRetry=details=>console.error(JSON.stringify({stage:'google-read-retry',...details}))}={}){
 if(!Number.isSafeInteger(requestTimeoutMs)||requestTimeoutMs<1)throw Error('Invalid Google request deadline');
 for(let attempt=0;attempt<6;attempt++){
  let response,json;
  try{
   const token=await getToken();await pacer();
   response=await fetchImpl(url,{headers:{authorization:`Bearer ${token}`},signal:AbortSignal.timeout(requestTimeoutMs)});
   try{json=await response.json();}catch(error){if(response.ok)throw error;json={error:'Non-JSON HTTP response'};}
  }catch(error){
   if(!retryableTransport(error)||attempt===5)throw error;
   const waitMs=delay(503,attempt,null);onRetry({kind:'transport',attempt:attempt+1,waitMs,reason:['TimeoutError','AbortError'].includes(error.name)?'deadline-or-abort':'connection-or-json'});await wait(waitMs);continue;
  }
  if(response.ok)return json;
  const error=Error(`Google Sheets API failed (${response.status}): ${JSON.stringify(json)}`);
  if(![429,500,502,503,504].includes(response.status)||attempt===5)throw error;
  const waitMs=delay(response.status,attempt,response.headers.get('retry-after'));onRetry({kind:'http',status:response.status,attempt:attempt+1,waitMs});await wait(waitMs);
 }
}
module.exports={createReadPacer,retryDelayMs,readGoogleJson,retryableTransport};
