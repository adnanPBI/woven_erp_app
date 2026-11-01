'use strict';
const assert=require('assert/strict'),{test}=require('node:test');
const {preserveBlankIssueAmounts}=require('../lib/mapping_contract_runtime.repair')._test;
const profile={id:'yarn-issue'},file={headers:['Warp','Weft','Out Side'],normalizedMap:new Map([['Warp',0],['Weft',1],['Out Side',2]])};
function fixture(){
 const queries=[],prior={id:7,total_warp_issue_kgs:'0.00',total_weft_issue_kgs:'0.00',outside_issue_kg:'439.00',total_issued_kg:'439.00',total_received_kg:'1000.00'},pool={query:async(sql)=>{queries.push(sql);if(sql.includes('migration_import_provenance'))return[[{target_primary_key:7}]];if(sql.includes('yarn_issue_details'))return[[{id:9,issued_quantity:'439.00'}]];if(sql.includes('yarn_issue_form'))return[[prior]];throw Error('Unexpected query');}};
 return {queries,ctx:{sync:{},syncOperation:{action:'update'},currentSourceUid:'fixture-event',pool,cache:{lookups:new Map()}},rows:{yarn_issue_form:{outside_issue_kg:0,total_warp_issue_kgs:0,total_weft_issue_kgs:0,total_issued_kg:0,total_received_kg:1000,remaining_stock_kg:1000},yarn_issue_details:{issued_quantity:0}}};
}
test('explicit outside zero and other numeric corrections survive blank warp/weft without historical substitution',async()=>{
 for(const value of ['0','0.00','250','-12.5']){const f=fixture(),amount=Number(value);Object.assign(f.rows.yarn_issue_form,{outside_issue_kg:amount,total_issued_kg:amount,remaining_stock_kg:1000-amount});f.rows.yarn_issue_details.issued_quantity=amount;
 await preserveBlankIssueAmounts(f.ctx,profile,file,['','',value],f.rows);assert.equal(f.rows.yarn_issue_form.outside_issue_kg,amount);assert.equal(f.rows.yarn_issue_form.total_issued_kg,amount);assert.equal(f.rows.yarn_issue_form.remaining_stock_kg,1000-amount);assert.equal(f.rows.yarn_issue_details.issued_quantity,amount);assert.equal(f.queries.length,0);assert.equal(f.ctx.sync.retainedBlankAmounts,undefined);}
});
test('all three amount cells blank retain original parent/detail quantities and recompute balance',async()=>{
 const f=fixture();await preserveBlankIssueAmounts(f.ctx,profile,file,[' ','',''],f.rows);assert.equal(f.rows.yarn_issue_form.outside_issue_kg,'439.00');assert.equal(f.rows.yarn_issue_form.total_issued_kg,'439.00');assert.equal(f.rows.yarn_issue_form.remaining_stock_kg,561);assert.equal(f.rows.yarn_issue_details.issued_quantity,'439.00');assert.equal(f.ctx.sync.retainedBlankAmounts.length,1);assert.equal(f.queries.length,3);
});
test('blank preservation refuses missing provenance or ambiguous original details',async()=>{
 for(const ambiguity of ['binding','details']){const f=fixture(),original=f.ctx.pool.query;f.ctx.pool.query=async sql=>sql.includes(ambiguity==='binding'?'migration_import_provenance':'yarn_issue_details')?[[]]:original(sql);await assert.rejects(preserveBlankIssueAmounts(f.ctx,profile,file,['','',''],f.rows),ambiguity==='binding'?/no historical binding/:/ambiguous historical quantities/);}
});
