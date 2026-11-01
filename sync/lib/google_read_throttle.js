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
async function readGoogleJson(url,{getToken,fetchImpl=global.fetch,pacer=pace,wait=sleep,delay=retryDelayMs}={}){
 for(let attempt=0;attempt<6;attempt++){
  const token=await getToken();await pacer();
  const response=await fetchImpl(url,{headers:{authorization:`Bearer ${token}`}}),json=await response.json().catch(()=>({}));
  if(response.ok)return json;
  const error=Error(`Google Sheets API failed (${response.status}): ${JSON.stringify(json)}`);
  if(![429,500,502,503,504].includes(response.status)||attempt===5)throw error;
  await wait(delay(response.status,attempt,response.headers.get('retry-after')));
 }
}
module.exports={createReadPacer,retryDelayMs,readGoogleJson};
