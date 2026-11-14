'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),Module=require('module');
const root=path.resolve(__dirname,'..');
const out=path.join(root,'unused-test-fallback');
const fname=root+'/lib/sync_same_po_yarn_dispo.js';
let policy;
if(fs.existsSync(fname))policy=require(fname);
else{
 const m=new Module(fname);m.filename=fname;m.paths=Module._nodeModulePaths(path.dirname(fname));
 m._compile(fs.readFileSync(out+'/sync_same_po_yarn_dispo.js','utf8'),fname);
 policy=m.exports;
}
const {fingerprint,hash,planEdits}=require(root+'/lib/sheets_sync_plan');
const {sameParentPath,qualifySamePoYarnDispoEdits}=policy;
const old='NH/TEST/GD/26/90001CM-1',now='NH/TEST/GD/26/90001CM-4',po='TEST/GD/26/90001';
const cols=['Yarn Count','Yarn Lot','Issue Date','Dispo No','S/R/Challan No','Out Side','Warp','Weft','Search Column'];
const cells=(dispo,qty='37')=>['40','3242','2026-11-06',dispo,'test-issue-01',qty,'','',dispo+' -Issue Date:46332 -Lot:3242'];
const group=values=>hash(['yarn-issue',values[0],values[1],values[2],values[3].toLowerCase(),values[4]]);
const ident=dispo=>({version:1,dispo:dispo.toLowerCase(),count:'40',lot:'3242',direction:'',date:'2026-11-06',challan:'test-issue-01'});
const original=cells(old),changed=cells(now);
const ledger={uid:'a'.repeat(64),group:group(original),digest:fingerprint(cols,original,'yarn-issue'),
 dispo:old.toLowerCase(),yarnIdentity:ident(old)};
const source=(values,rowNumber=2)=>({
 uid:'generated-unstable-id',rowNumber,group:group(values),digest:fingerprint(cols,values,'yarn-issue'),
 dispo:values[3].toLowerCase(),yarnIdentity:ident(values[3]),businessDate:'2026-11-06',
 entryAmounts:JSON.stringify([Number(values[5]),null,null]),prefixMatchHash:'b'.repeat(64)});
const latest=source(changed);
const spec={id:'yarn-issue',header_row:0,source_file:'Greige yarn issue.csv'};
function fixture(lines=[changed]){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'weaving-same-po-test-'));
 fs.writeFileSync(path.join(folder,spec.source_file),[cols.join(','),...lines.map(x=>x.join(','))].join('\n')+'\n');
 return folder;
}
const mock=flags=>({
 async query(sql,args){
  if(sql.includes('FROM migration_import_provenance'))return [flags.missingProvenance?[]:[{target_table:'yarn_issue_form',target_primary_key:'1001',source_row_number:2}]];
  if(sql.includes('FROM yarn_issue_form WHERE id=?'))return [[{
   id:1001,issue_challan_no:'test-issue-01',yarn_count:'40',yarn_lot:'3242',received_against_dispo_nos:old,
   issue_date:'2026-11-06',received_against_po_no:po,outside_issue_kg:'37.00',
   total_warp_issue_kgs:'0.00',total_weft_issue_kgs:'0.00'}]];
  if(sql.includes('FROM yarn_issue_details WHERE yarn_issue_form_id=?'))return [[{id:1002,yarn_issue_form_id:1001,
    dispo_number:old,issue_date:'2026-11-06',issued_quantity:flags.wrongQuantity?'40.00':'37.00'},...(flags.duplicateChild?[{id:170000}]:[])]];
  if(sql.includes('FROM dispo_form_data'))return [flags.noNewMaster?[{dispo_number:old,po_no:po}]:[
   {dispo_number:old,po_no:po},{dispo_number:now,po_no:flags.badPo?'DIFFERENT_PO':po}]];
  if(sql.includes('FROM dispo_plan_form'))return [[{dispo_no:old,po_no:po},{dispo_no:now,po_no:po}]];
  if(sql.includes('SELECT source_uid FROM sheets_sync_events'))return [flags.occupiedEvent?[{source_uid:'other'}]:[]];
  if(sql.includes('FROM yarn_issue_details d JOIN yarn_issue_form'))return [flags.occupiedTarget?[{id:170001}]:[]];
  throw Error('Unexpected SQL '+sql);
 }
});
async function qualify({records=[latest],lines=[changed],oldRecords=[ledger],flags={}}={}){
 const prior={headersHash:'h',records:oldRecords},next={headersHash:'h',records};
 const result=await qualifySamePoYarnDispoEdits('yarn-issue',prior,next,{
  connection:mock(flags),csvDir:fixture(lines),profileSpec:spec,
  fullPrevious:{records:oldRecords},fullCurrent:{records},sourceManifestSha256:'c'.repeat(64)
 });
 return {prior:result,next};
}
test('valid suffix edit retains parent and original UID; exactly one update',async()=>{
 const {prior,next}=await qualify();
 assert.equal(prior.records[0].reviewedDigest,latest.digest);
 assert.equal(prior.records[0].prefixChange.version,2);
 assert.equal(prior.records[0].prefixChange.targetParentId,1001);
 assert.equal(prior.records[0].prefixChange.targetChildId,1002);
 const plan=planEdits({'yarn-issue':prior},{'yarn-issue':next});
 assert.equal(plan.ok,true);assert.equal(plan.added,0);assert.equal(plan.updated,1);assert.equal(plan.conflicts.length,0);
 const op=plan.operations['yarn-issue'][0];assert.equal(op.uid,ledger.uid);
 assert.equal(op.previousDispo,old.toLowerCase());assert.equal(op.dispo,now.toLowerCase());
});
test('other business field or amount changed is not automatically rebound',async()=>{
 const q=cells(now,'38'),{prior}=await qualify({records:[source(q)],lines:[q]});
 assert.equal(prior.records[0].reviewedDigest,undefined);
});
test('duplicate new source lines fail closed',async()=>{
 const {prior}=await qualify({records:[latest,source(changed,3)],lines:[changed,changed]});
 assert.equal(prior.records[0].reviewedDigest,undefined);
});
test('duplicate historical same identity fails closed',async()=>{
 const {prior}=await qualify({oldRecords:[ledger,{...ledger,uid:'c'.repeat(64)}]});
 assert.equal(prior.records[0].reviewedDigest,undefined);
});
for(const [name,flags] of Object.entries({
 'missing_provenance':{missingProvenance:true},'missing_destination_master':{noNewMaster:true},
 'different_destination_PO':{badPo:true},'wrong_historical_quantity':{wrongQuantity:true},
 'duplicate_sql_child':{duplicateChild:true},'destination_ledger_occupied':{occupiedEvent:true},
 'destination_physical_occupied':{occupiedTarget:true}
})){
 test('unsafe '+name+' is blocked',async()=>{const {prior}=await qualify({flags});assert.equal(prior.records[0].reviewedDigest,undefined);});
}
test('factory prefix and suffix changed together stays review-gated',async()=>{
 assert.equal(sameParentPath(old,'SW/TEST/GD/26/90001CM-4'),false);
});
test('normal source reappearing alongside new variant remains review-gated',async()=>{
 const olds=source(original,3),{prior}=await qualify({records:[latest,olds],lines:[changed,original]});
 assert.equal(prior.records[0].reviewedDigest,undefined);
});
