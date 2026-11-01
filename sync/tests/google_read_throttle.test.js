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
