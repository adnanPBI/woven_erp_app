'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const {inventory}=require('../../lib/sheets_sync_plan');
const {readState,writeJson,sha256File}=require('./common');
(async()=>{
 const profiles=require('../../mappings/mapping-contract-v2.json').profiles.filter(p=>['yarn-receive','yarn-issue'].includes(p.id));
 const rows=[];
 for(const p of profiles)for(const r of (await inventory(readState().latestCertifiedDir,[p]))[p.id].records)rows.push([p.id,r.uid,r.digest,r.matchHash]);
 const dir=path.resolve('local_data/sync_package'),file=path.join(dir,'baseline.match-signatures.jsonl.gz');
 fs.writeFileSync(file,zlib.gzipSync(rows.map(r=>JSON.stringify(r)).join('\n')+'\n'));
 const metaPath=path.join(dir,'baseline.meta.json'),meta=JSON.parse(fs.readFileSync(metaPath));
 meta.matchSignatures={file:path.basename(file),sha256:sha256File(file),records:rows.length};writeJson(metaPath,meta);
 console.log(JSON.stringify({file,records:rows.length}));
})().catch(e=>{console.error(e);process.exitCode=1;});
