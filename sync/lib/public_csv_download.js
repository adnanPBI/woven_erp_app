'use strict';
const fs=require('fs'),{Readable}=require('stream'),{pipeline}=require('stream/promises');
async function downloadCsv(url,file,options={}) {
  const fetchCsv=options.fetch||fetch,attempts=options.attempts||3;
  const wait=options.wait||(ms=>new Promise(r=>setTimeout(r,ms)));
  const partial=file+'.partial';
  for(let attempt=1;attempt<=attempts;attempt++){
    try{
      // Keep the standard Google CSV endpoint and its formatted cell values.
      // A different export API can infer types or drop header rows. Never use
      // an old snapshot, HTML response or interrupted file as a fresh source.
      const response=await fetchCsv(url,{signal:AbortSignal.timeout(options.timeoutMs||180000)});
      if(!response.ok||!/\b(?:text|application)\/(?:[^;]+\+)?csv\b/i.test(response.headers.get('content-type')||'')){
        await response.body?.cancel();throw Error('CSV export returned HTTP '+response.status+' or a non-CSV response');
      }
      await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(partial,{flags:'wx',mode:0o600}));
      if(!fs.statSync(partial).size)throw Error('CSV export was empty');
      fs.renameSync(partial,file);return;
    }catch(e){
      // A failed attempt never changes an accepted file or snapshot pointer.
      if(fs.existsSync(partial))fs.unlinkSync(partial);
      const reason=e.name==='TimeoutError'||e.name==='AbortError'?'request timed out':String(e.cause?.code||e.message).replace(/[\r\n]/g,' ').slice(0,180);
      options.onRetry?.({attempt,attempts,reason});
      if(attempt===attempts)throw Error('CSV download failed after '+attempts+' attempts: '+reason,{cause:e});
      await wait(attempt*5000);
    }
  }
}
module.exports={downloadCsv};
