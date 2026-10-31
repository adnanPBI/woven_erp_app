'use strict';const test=require('node:test'),assert=require('node:assert/strict'),{Writable}=require('stream'),{boundedChunkRows,sourceChildArgs,writeCsvRow,MAX_API_CELLS}=require('../lib/google_fetch_budget');
test('API batches bound wide-tab cell counts without changing snapshot pages or DB-worker limits',()=>{
 assert.equal(boundedChunkRows(5000,626),399);assert.ok(boundedChunkRows(5000,626)*626<=MAX_API_CELLS);assert.equal(boundedChunkRows(5000,30),5000);assert.equal(boundedChunkRows(5000,626,{snapshot:true}),5000);
 for(const n of [NaN,0,-1,99,1.5,50001])assert.throws(()=>boundedChunkRows(n,30));
 for(const columns of [0,NaN,1.5])assert.throws(()=>boundedChunkRows(5000,columns));
 assert.deepEqual(sourceChildArgs('scripts/local/fetch_google_sheets.js',[],{GOOGLE_SNAPSHOT_DIR:''}),['--expose-gc','--max-old-space-size=128','scripts/local/fetch_google_sheets.js']);
 assert.deepEqual(sourceChildArgs('scripts/local/fetch_google_sheets.js',[],{GOOGLE_SNAPSHOT_DIR:'/frozen'}),['scripts/local/fetch_google_sheets.js']);
 assert.deepEqual(sourceChildArgs('import.js',['--dry-run'],{}),['import.js','--dry-run']);
});
test('slow CSV output applies backpressure and preserves quoting, row order and exact values',async()=>{
 const chunks=[],out=new Writable({highWaterMark:1,write(chunk,encoding,done){chunks.push(Buffer.from(chunk));setTimeout(done,2);}});let peak=0;
 for(const row of [['id','value'],['001','a,b'],['002','line\nbreak'],['003','"quoted"'],['004','']]){await writeCsvRow(out,row);peak=Math.max(peak,out.writableLength);}
 await new Promise(r=>out.end(r));assert.equal(Buffer.concat(chunks).toString(),'id,value\n001,"a,b"\n002,"line\nbreak"\n003,"""quoted"""\n004,\n');assert.equal(peak,0,'each congested row drained before producing the next');
});
