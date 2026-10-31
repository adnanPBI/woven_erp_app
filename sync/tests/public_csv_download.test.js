'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),http=require('http');
const {downloadCsv}=require('../lib/public_csv_download');
test('interrupted/invalid exports never publish partial data, and a complete retry is accepted',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'csv-download-')),file=path.join(dir,'source.csv');let attempt=0;
 fs.writeFileSync(file,'previous accepted file');
 const server=http.createServer((req,res)=>{
  attempt++;if(attempt===1){res.writeHead(200,{'content-type':'text/csv','content-length':'200'});res.write('partial');setImmediate(()=>res.destroy());}
  else if(attempt===2){res.writeHead(200,{'content-type':'text/html'});res.end('<html>login</html>');}
  else{res.writeHead(200,{'content-type':'text/csv; charset=utf-8'});res.end('id,value\n1,"a,b"\n');}
 });server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{const retries=[];await downloadCsv('http://127.0.0.1:'+server.address().port,file,{timeoutMs:1000,wait:async()=>{assert.equal(fs.readFileSync(file,'utf8'),'previous accepted file');assert.equal(fs.existsSync(file+'.partial'),false);},onRetry:r=>retries.push(r)});
 assert.equal(attempt,3);assert.equal(retries.length,2);assert.equal(fs.readFileSync(file,'utf8'),'id,value\n1,"a,b"\n');assert.equal(fs.existsSync(file+'.partial'),false);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('timeout and empty CSV leave the accepted source intact and report the reason',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'csv-download-fail-')),file=path.join(dir,'source.csv');fs.writeFileSync(file,'accepted');
 const server=http.createServer((req,res)=>{if(req.url==='/empty'){res.writeHead(200,{'content-type':'text/csv'});res.end();}});server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{for(const route of ['/timeout','/empty']){await assert.rejects(downloadCsv('http://127.0.0.1:'+server.address().port+route,file,{attempts:1,timeoutMs:100}),route==='/timeout'?/timed out/:/empty/);assert.equal(fs.readFileSync(file,'utf8'),'accepted');assert.equal(fs.existsSync(file+'.partial'),false);}}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});
