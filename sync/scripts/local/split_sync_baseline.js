'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto');
const {once}=require('events');
(async()=>{
 const dir=path.resolve('local_data/sync_package');
 const raw=zlib.gunzipSync(fs.readFileSync(path.join(dir,'baseline.json.gz')));
 const baselineHash=crypto.createHash('sha256').update(raw).digest('hex');
 const data=JSON.parse(raw.toString());
 const out=fs.createWriteStream(path.join(dir,'baseline.events.jsonl.gz'));const gz=zlib.createGzip();gz.pipe(out);
 let records=0;
 for(const [profile,spec]of Object.entries(data.profiles))for(const r of spec.records){if(!gz.write(JSON.stringify([profile,r.uid,r.group,r.digest,r.dispo||''])+'\n'))await once(gz,'drain');records++;}
 gz.end();await once(out,'finish');
 const meta={version:2,baselineHash,records,cutoff:data.cutoff,sqlSha256:data.sqlSha256,protectedMasters:data.protectedMasters,checks:data.checks,headers:Object.fromEntries(Object.entries(data.profiles).map(([p,s])=>[p,s.headersHash])),eventsFile:'baseline.events.jsonl.gz'};
 fs.writeFileSync(path.join(dir,'baseline.meta.json'),JSON.stringify(meta));console.log(JSON.stringify({records,baselineHash}));
})().catch(e=>{console.error(e);process.exitCode=1;});
