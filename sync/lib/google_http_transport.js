'use strict';
const https=require('https');
function createGoogleFetch({request=https.request,maxBytes=32*1024*1024}={}){
 return(url,options={})=>new Promise((resolve,reject)=>{
  const signal=options.signal||AbortSignal.timeout(45000);let req,res,done=false;
  const cleanup=()=>signal.removeEventListener('abort',aborted);
  const fail=error=>{if(done)return;done=true;cleanup();req?.destroy();res?.destroy();reject(error);};
  const aborted=()=>fail(signal.reason||Object.assign(Error('Google request aborted'),{name:'AbortError'}));
  if(signal.aborted)return aborted();signal.addEventListener('abort',aborted,{once:true});
  try{
   // On this host, fetch/Undici can stall while the identical authenticated
   // request succeeds over fresh IPv4 HTTPS. Keep TLS verification enabled,
   // avoid stale pooled connections, and bound both headers and the body.
   req=request(url,{method:options.method||'GET',headers:{...options.headers,'accept-encoding':'identity'},family:4,agent:false},response=>{
    res=response;let bytes=0;const chunks=[];
    res.on('error',fail);res.on('aborted',()=>fail(Object.assign(Error('Google response aborted'),{code:'ECONNRESET'})));
    res.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)return fail(Object.assign(Error('Google response exceeds its byte budget'),{code:'GOOGLE_RESPONSE_TOO_LARGE'}));chunks.push(chunk);});
    res.on('end',()=>{if(done)return;done=true;cleanup();const body=Buffer.concat(chunks),status=res.statusCode;resolve({ok:status>=200&&status<300,status,headers:{get:name=>res.headers[name.toLowerCase()]??null},json:async()=>JSON.parse(body.toString('utf8'))});});
   });req.on('error',fail);req.end(options.body?.toString());
  }catch(error){fail(error);}
 });
}
module.exports={createGoogleFetch,googleFetch:createGoogleFetch()};
