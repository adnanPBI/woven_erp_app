'use strict';const test=require('node:test'),assert=require('node:assert/strict'),{resolveSourceSheet}=require('../lib/google_source_sheet');
test('live API follows the CSV tab ID after rename, including valid zero, rather than another tab with the old title',()=>{
 const meta={sheets:[{properties:{sheetId:0,title:"Renamed 'production' tab"}},{properties:{sheetId:7,title:'Old title'}}]},profile={id:'fixture',sheetId:0,sheetName:'Old title'};
 assert.equal(resolveSourceSheet(profile,meta),meta.sheets[0]);assert.equal(resolveSourceSheet({...profile,sheetId:'0'},meta),meta.sheets[0]);
 for(const id of [1,-1,0.5,'bad'])assert.throws(()=>resolveSourceSheet({...profile,sheetId:id},meta),/pinned/);
 assert.throws(()=>resolveSourceSheet(profile,{sheets:[meta.sheets[1]]}),/missing/);
});
test('legacy title-only API and immutable snapshot adapter retain their original selection',()=>{
 const meta={sheets:[{properties:{title:'Frozen tab'}}]},profile={id:'fixture',sheetId:0,sheetName:'Frozen tab'};
 assert.equal(resolveSourceSheet(profile,meta,{snapshot:true}),meta.sheets[0]);assert.equal(resolveSourceSheet({id:'fixture',sheetName:'Frozen tab'},meta),meta.sheets[0]);
 assert.throws(()=>resolveSourceSheet({...profile,sheetName:'Foreign tab'},meta,{snapshot:true}),/missing/);
});
test('the real metadata client requests tab IDs and keeps authentication read-only',async()=>{
 const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'google-readonly-')),key=path.join(dir,'fixture.json'),original=global.fetch,oldKey=process.env.GOOGLE_SERVICE_ACCOUNT_JSON,oldSnapshot=process.env.GOOGLE_SNAPSHOT_DIR;
 const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});fs.writeFileSync(key,JSON.stringify({client_email:'fixture@example.invalid',private_key:privateKey.export({type:'pkcs8',format:'pem'}),token_uri:'https://oauth2.googleapis.com/token'}));
 process.env.GOOGLE_SERVICE_ACCOUNT_JSON=key;process.env.GOOGLE_SNAPSHOT_DIR='';
 try{global.fetch=async(url,options)=>{
  if(String(url).includes('oauth2.googleapis.com')){const assertion=options.body.get('assertion'),payload=JSON.parse(Buffer.from(assertion.split('.')[1],'base64url'));assert.equal(payload.scope,'https://www.googleapis.com/auth/spreadsheets.readonly');return{ok:true,json:async()=>({access_token:'fixture-token',expires_in:3600})};}
  const fields=new URL(url).searchParams.get('fields'),properties={title:'Renamed tab',gridProperties:{rowCount:10,columnCount:5}};if(fields.includes('sheetId'))properties.sheetId=0;
  assert.equal(options.headers.authorization,'Bearer fixture-token');return{ok:true,json:async()=>({properties:{title:'Fixture'},sheets:[{properties}]})};
 };const metadata=await require('../scripts/local/google_sheets_client').getSpreadsheetMetadata('fixture');assert.equal(resolveSourceSheet({id:'fixture',sheetId:0,sheetName:'Old name'},metadata).properties.sheetId,0);
 }finally{global.fetch=original;if(oldKey===undefined)delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;else process.env.GOOGLE_SERVICE_ACCOUNT_JSON=oldKey;if(oldSnapshot===undefined)delete process.env.GOOGLE_SNAPSHOT_DIR;else process.env.GOOGLE_SNAPSHOT_DIR=oldSnapshot;fs.rmSync(dir,{recursive:true,force:true});}
});
