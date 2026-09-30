'use strict';
const assert=require('assert'); const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
const root=path.resolve(__dirname,'../..');
const runtime=require('../../lib/mapping_contract_runtime');
const provenance=require('../../lib/provenance');
const {SourceIndex}=require('../../lib/source_index');
(async()=>{
  const contract=JSON.parse(fs.readFileSync(path.join(root,'mappings','mapping-contract-v2.json'),'utf8'));
  assert.strictEqual(contract.contract_version,'2.0.0-production-migration-v3.2.3-hybrid');
  assert.strictEqual(contract.runtime_release,'5.6.0-production-migration-v3.2.3-hybrid');
  for(const id of ['yarn-receive','yarn-issue','warping','sizing','greige-delivery']) assert.strictEqual(contract.profiles.find(p=>p.id===id).idempotency,'provenance');
  const optional=[['yarn-receive','received_against_dispo_nos'],['yarn-receive','challan_no'],['yarn-receive','received_against_po_no'],['yarn-issue','received_against_dispo_nos'],['yarn-issue','issue_challan_no'],['yarn-issue','received_against_po_no'],['greige-delivery','challan_no'],['sizing','warping_set_no']];
  for(const [pid,field] of optional){const m=contract.profiles.find(p=>p.id===pid).mappings.find(m=>m.field===field); assert(m,`${pid}.${field}`); assert.strictEqual(Boolean(m.required),false,`${pid}.${field} required`); assert.strictEqual(Boolean(m.business_critical),false,`${pid}.${field} critical`);}
  const fn=runtime._test.compileSafeExpression('sum(source("A"), source("B"))');
  const helpers=['source','field','sum','subtract','divide','mod','round','parseNumber','toIntOrNull','parseDate','cleanText','firstNonNA','extractDispoRef','extractChallanRef','extractInt','extractLabelledInt','constructionCount','normalizeYarnCount','sanitizeToken','sourceRowNumber','sourceWarpingValue','sourceYarnReceiptSum','sourceLatestDate','sourceCumulative','cumulative','latestDate'];
  const values={source:(n)=>({A:2,B:3}[n]),sum:(...v)=>v.reduce((a,x)=>a+Number(x||0),0)};
  assert.strictEqual(fn(...helpers.map(k=>values[k])),5);
  assert.throws(()=>runtime._test.compileSafeExpression('process.exit(1)'),/Unsafe|Unsupported/);
  const policy=provenance.loadPolicy(root); assert(provenance.isProvenanceTable(policy,'yarn-issue','yarn_issue_form'));
  let preview=null; const ctx={currentSourceUid:'a'.repeat(64),currentSourceRowNumber:2,currentSourceFile:'x.csv',dryRun:true,pool:null,preview:(r)=>preview=r};
  const res=await runtime._test.upsertProvenanceParent(ctx,{id:'yarn-issue'},'yarn_issue_form',{yarn_lot:'L1'}); assert.strictEqual(res.action,'previewed'); assert(res.id.includes('a'.repeat(32))); assert.strictEqual(preview.source_uid,'a'.repeat(64));
  const idx=new SourceIndex({csvDir:'/nonexistent'}); assert.strictEqual(idx.loadedDatasets.size,0);
  const clone=JSON.parse(JSON.stringify(contract)); delete clone.published_contract_sha256; delete clone.generated_at; delete clone.normalization_report; if(clone.published_from){delete clone.published_from.visual_config;delete clone.published_from.template;}
  const hash=crypto.createHash('sha256').update(JSON.stringify(clone)).digest('hex'); assert.strictEqual(hash,contract.published_contract_sha256);
  console.log(JSON.stringify({ok:true,test:'v323_hybrid',contractHash:contract.published_contract_sha256},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
