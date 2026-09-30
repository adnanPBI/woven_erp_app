'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const {parse} = require('csv-parse/sync');
const {forEachCsvRowSync} = require('../../lib/csv_stream');
const {readJson,sha256File} = require('./common');
const contract = require('../../mappings/mapping-contract-v2.json');
function failedRows(runDir, summary) {
  assert(summary.mode === 'live' && summary.status === 'failed', 'Expected failed live evidence');
  for (const key of ['validationErrors','requiredLookupMisses','criticalLookupMisses','fkDependencyFailures']) assert(Number(summary[key]) === 0, `Cannot recover non-row failure: ${key}`);
  const recon = readJson(path.join(runDir,'reconciliation.json'));
  for (const profile of contract.import_order) assert(recon?.[profile] && recon[profile].processedRows === recon[profile].sourceRows, `Incomplete main run: ${profile}`);
  const rows = parse(fs.readFileSync(path.join(runDir,'rejected_rows.csv')), {columns:true});
  assert(rows.length > 0 && rows.length === summary.rejectedRows, 'Failure detail coverage mismatch');
  for (const r of rows) assert(r.profile === 'loom' && r.reason === 'logical_unit_rolled_back' && /Deadlock found/.test(r.error), 'Only isolated Loom deadlocks are supported by this recovery');
  assert(new Set(rows.map(r=>r.profile+'|'+r.rowNumber)).size === rows.length, 'Duplicate failed-row evidence');
  return rows;
}
function sourceRow(summary, rowNumber) {
  const file = path.join(summary.csvDir,'Loom production database.csv');
  let headers, result, ordinal=0;
  forEachCsvRowSync(file,(values,n)=>{
    if(n===1){headers=values;return;}
    if(values.some(v=>String(v||'').trim())) ordinal++;
    if(n===Number(rowNumber)){result={values:Object.fromEntries(headers.map((h,i)=>[h,values[i]])),offset:ordinal-1};return false;}
  });
  assert(result && result.offset>=0 && result.values.__MIG_SOURCE_UID,'Failed source row not found');
  return result;
}
async function verifyRecoveredRows(state, summary, c) {
  if(!state.latestLiveRecovery) return 0;
  const report = readJson(state.latestLiveRecovery);
  assert(report && path.resolve(report.originalRunDir)===path.resolve(state.latestLiveRunDir),'Recovery belongs to another run');
  assert(report.originalSummarySha256===sha256File(path.join(state.latestLiveRunDir,'summary.json')),'Original failure evidence changed');
  const failures = failedRows(state.latestLiveRunDir,summary);
  assert(report.retries.length===failures.length,'Incomplete recovery');
  const used = new Set();
  for(const failure of failures){
    const r=report.retries.find(r=>r.profile===failure.profile && Number(r.sourceRowNumber)===Number(failure.rowNumber));
    assert(r && !used.has(r.runDir),'Missing or repeated retry');used.add(r.runDir);
    const file=path.join(r.runDir,'summary.json');assert(sha256File(file)===r.summarySha256,'Retry evidence changed');
    const retry=readJson(file),status=readJson(path.join(r.runDir,'status.json'));
    const source=sourceRow(summary,failure.rowNumber);
    assert(retry.mode==='live' && retry.status==='completed' && status.status==='completed','Retry did not complete');
    assert(retry.selectedProfiles.length===1 && retry.selectedProfiles[0]===failure.profile && retry.limit===1 && retry.offset===source.offset,'Retry scope mismatch');
    assert(retry.sourceManifestFileSha256===summary.sourceManifestFileSha256 && retry.approvedDryRunId===summary.approvedDryRunId,'Retry not bound to the same accepted source');
    for(const key of ['validationErrors','requiredLookupMisses','criticalLookupMisses','rejectedRows','fkDependencyFailures']) assert(Number(retry[key])===0,`Retry failed: ${key}`);
    const progress=fs.readFileSync(path.join(r.runDir,'row_progress.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));
    assert(progress.length===1 && progress[0].outcome==='committed' && progress[0].importer===failure.profile && Number(progress[0].sourceRowNumber)===Number(failure.rowNumber),'Retry commit/row evidence mismatch');
    const [parents]=await c.query('SELECT id FROM loom_production_form WHERE LOWER(TRIM(dispo_number))=? AND weaving_date=?',[source.values['Dispo No'].trim().toLowerCase(),source.values['Weaving Dates']]);
    assert(parents.length===1,'Recovered Loom parent missing or duplicated');
    const [[children]]=await c.query('SELECT COUNT(*) n FROM loom_production_breakdown WHERE loom_production_id=?',[parents[0].id]);
    assert(Number(children.n)===1,'Recovered Loom detail missing or duplicated');
  }
  return failures.length;
}
module.exports={failedRows,sourceRow,verifyRecoveredRows};
