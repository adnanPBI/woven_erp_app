'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{createReadPacer,retryDelayMs,readGoogleJson}=require('../lib/google_read_throttle');
test('concurrent metadata/pages/retries share slots below 60 reads in any minute without real sleeps',async()=>{
 let now=0;const starts=[],gate=createReadPacer({now:()=>now,wait:async ms=>{now+=ms;}});
 await Promise.all(Array.from({length:120},async()=>{await gate();starts.push(now);}));
 assert.equal(starts.length,120);for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=1250);
 for(const start of starts)assert.ok(starts.filter(t=>t>=start&&t<start+60000).length<=48);
});
test('429 backoff crosses a full quota window and honors seconds/date Retry-After',()=>{
 const deps={now:()=>Date.UTC(2026,0,1),random:()=>0};
 assert.equal(retryDelayMs(429,0,null,deps),64000);assert.equal(retryDelayMs(429,5,'2',deps),64000);assert.equal(retryDelayMs(429,0,'120',deps),120000);
 assert.equal(retryDelayMs(503,0,'Thu, 01 Jan 2026 00:02:00 GMT',deps),120000);assert.equal(retryDelayMs(500,2,'invalid',deps),4000);
});
test('quota failure retries the same requested page through the pacing gate; permanent errors stop; retries are bounded',async()=>{
 let calls=0,gates=0;const waits=[],urls=[],deps={getToken:async()=>'fixture',pacer:async()=>{gates++;},wait:async ms=>waits.push(ms),delay:(status,n,header)=>retryDelayMs(status,n,header,{random:()=>0}),fetchImpl:async(url,options)=>{urls.push(url);assert.equal(options.headers.authorization,'Bearer fixture');calls++;return{ok:calls===2,status:calls===2?200:429,headers:{get:()=>null},json:async()=>calls===2?{values:[['001','x']]}:{error:'quota'}};}};
 assert.deepEqual(await readGoogleJson('https://example.invalid/page?range=A2:Z5001',deps),{values:[['001','x']]});assert.equal(gates,2);assert.deepEqual(waits,[64000]);assert.equal(new Set(urls).size,1);
 let denied=0;await assert.rejects(readGoogleJson('https://example.invalid',{...deps,fetchImpl:async()=>{denied++;return{ok:false,status:403,json:async()=>({error:'denied'})};}}),/403/);assert.equal(denied,1);
 calls=0;waits.length=0;await assert.rejects(readGoogleJson('https://example.invalid',{...deps,fetchImpl:async()=>{calls++;return{ok:false,status:429,headers:{get:()=>null},json:async()=>({error:'quota'})};}}),/429/);assert.equal(calls,6);assert.equal(waits.length,5);
});

test('native transport preserves formatted JSON, uses IPv4/fresh sockets and enforces its response budget',async()=>{
 const http=require('http'),{createGoogleFetch}=require('../lib/google_http_transport'),payload={values:[['001','2026-10-30',' a,b ','"quoted"']]},server=http.createServer((req,res)=>{assert.equal(req.headers.authorization,'Bearer fixture');assert.equal(req.headers['accept-encoding'],'identity');res.setHeader('X-Fixture','yes');res.end(JSON.stringify(payload));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/values';let options;
 const transport=createGoogleFetch({request:(u,o,cb)=>{options=o;return http.request(u,o,cb);}});
 try{const r=await transport(url,{headers:{authorization:'Bearer fixture'}});assert.equal(r.status,200);assert.equal(r.headers.get('X-Fixture'),'yes');assert.deepEqual(await r.json(),payload);assert.equal(options.family,4);assert.equal(options.agent,false);
  await assert.rejects(createGoogleFetch({request:http.request,maxBytes:4})(url,{headers:{authorization:'Bearer fixture'}}),{code:'GOOGLE_RESPONSE_TOO_LARGE'});
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('stalled headers AND stalled bodies hit a hard deadline, retry the same page and stop after six attempts',async()=>{
 const http=require('http'),{createGoogleFetch}=require('../lib/google_http_transport'),server=http.createServer((req,res)=>{if(req.url==='/body'){res.writeHead(200,{'Content-Type':'application/json'});res.write('{"values":');}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const retries=[],calls=[],transport=createGoogleFetch({request:http.request});
 try{for(const part of ['headers','body']){
  retries.length=0;calls.length=0;const url='http://127.0.0.1:'+server.address().port+'/'+part;
  await assert.rejects(readGoogleJson(url,{getToken:async()=>'private-fixture-token',fetchImpl:(u,o)=>{calls.push(u);return transport(u,o);},pacer:async()=>{},wait:async()=>{},delay:()=>0,requestTimeoutMs:50,onRetry:r=>retries.push(r)}),error=>['TimeoutError','AbortError'].includes(error.name)||error.code==='ECONNRESET');
  assert.equal(calls.length,6);assert.ok(calls.every(u=>u===url));assert.equal(retries.length,5);assert.ok(retries.every(r=>r.kind==='transport'));assert.ok(!JSON.stringify(retries).includes('private-fixture-token'));assert.ok(!JSON.stringify(retries).includes(url));
 }}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('connection resets and malformed successful JSON retry safely; payload budget and certificate errors stop',async()=>{
 const {retryableTransport}=require('../lib/google_read_throttle');let attempts=0;const r=await readGoogleJson('https://example.invalid/exact-page',{getToken:async()=>'fixture',pacer:async()=>{},wait:async()=>{},onRetry:()=>{},fetchImpl:async()=>{attempts++;if(attempts===1)throw Object.assign(Error('reset'),{code:'ECONNRESET'});return{ok:true,json:async()=>{if(attempts===2)throw SyntaxError('truncated');return{values:[['001']]};}};}});
 assert.deepEqual(r,{values:[['001']]});assert.equal(attempts,3);assert.equal(retryableTransport({code:'GOOGLE_RESPONSE_TOO_LARGE'}),false);assert.equal(retryableTransport({code:'CERT_HAS_EXPIRED'}),false);
});
