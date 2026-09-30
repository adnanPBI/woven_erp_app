'use strict';
const assert = require('assert');
const {isRetainedMaster} = require('../scripts/local/protect_retained_rows');
const {cfg} = require('../scripts/local/db');
const runtime = require('../lib/mapping_contract_runtime');
(async () => {
  const keys = {PO_form_data:{key:'po_no',values:new Set(['po-2023'])}};
  assert(isRetainedMaster(keys,'PO_form_data',{po_no:' PO-2023 '}));
  assert(!isRetainedMaster(keys,'PO_form_data',{po_no:'PO-2024'}));
  assert(!isRetainedMaster(keys,'yarn_issue_form',{id:1}));
  const result = await runtime._test.upsertRow({localRetainedMasters:keys,pool:{query:()=>{throw new Error('Must not write retained master');}}},{id:'po'},'PO_form_data',{po_no:'PO-2023',po_issue_date:'2024-01-01'});
  assert.strictEqual(result.action,'preserved');
  let queries=0;
  const cacheCtx={pool:{},conn:{query:async()=>{queries++;return [[{po_no:'PO-2023'}]];}},cache:{lookups:new Map()},stableMasterLookupTables:new Set(['PO_form_data']),stableMasterLookupCache:new Map()};
  await runtime._test.findOne(cacheCtx,'PO_form_data',{po_no:'PO-2023'},null);
  runtime._test.resetRowScopedCaches(cacheCtx);
  await runtime._test.findOne(cacheCtx,'PO_form_data',{po_no:'PO-2023'},null);
  assert.strictEqual(queries,1,'Read-only master should be reused across rows');
  cacheCtx.stableMasterLookupTables.clear();
  await runtime._test.findOne(cacheCtx,'PO_form_data',{po_no:'PO-2023'},null);
  assert.strictEqual(queries,2,'Writable table must query current transaction');
  cacheCtx.stableMasterLookupTables.add('PO_form_data');cacheCtx.stableMasterLookupCache.clear();cacheCtx.conn.query=async()=>{queries++;return [[]];};
  await runtime._test.findOne(cacheCtx,'PO_form_data',{po_no:'NEW'},null);
  await runtime._test.findOne(cacheCtx,'PO_form_data',{po_no:'NEW'},null);
  assert.strictEqual(queries,4,'Live misses must not hide newly created masters');
  const previous = process.env.DB_HOST;
  try {process.env.DB_HOST='production.example.com';assert.throws(()=>cfg('weavonpq_weaving_local'),/guard/);process.env.DB_HOST='127.0.0.1';assert.throws(()=>cfg('weavonpq_weaving'),/guard/);assert.strictEqual(cfg('weavonpq_weaving_local').database,'weavonpq_weaving_local');}
  finally {if(previous===undefined)delete process.env.DB_HOST;else process.env.DB_HOST=previous;}
  console.log('local_preservation.test.js: PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
