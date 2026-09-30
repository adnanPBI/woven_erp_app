'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function args(argv) { const out = {}; for (const item of argv) { if (!item.startsWith('--')) continue; const [k, ...rest] = item.slice(2).split('='); out[k] = rest.length ? rest.join('=') : true; } return out; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sameSet(a,b){ const x=[...new Set((a||[]).map(String))].sort(); const y=[...new Set((b||[]).map(String))].sort(); return x.length===y.length&&x.every((v,i)=>v===y[i]); }
const o=args(process.argv.slice(2));
const profile=String(o.profile||'').trim();
const rootDir=path.resolve(o['live-root']||'');
const sourceRows=Number(o['source-rows']);
const chunkSize=Number(o['chunk-size']||500);
const manifestSha=String(o['manifest-sha256']||'').trim().toLowerCase();
const dryRunId=String(o['approved-dry-run-id']||'').trim();
if (!profile || !rootDir || !Number.isFinite(sourceRows) || sourceRows < 0 || chunkSize !== 500) throw new Error('Usage: --profile --live-root --source-rows --chunk-size=500 --manifest-sha256 --approved-dry-run-id');
const chunkCount=Math.ceil(sourceRows/chunkSize);
const chunks=[];
const totals={processed:0,inserted:0,updated:0,previewed:0,rejected:0,lookup_misses:0,rolled_back:0,errors:0};
let expectedOffset=0;
for(let i=0;i<chunkCount;i+=1){
  const limit=Math.min(chunkSize,sourceRows-expectedOffset);
  const chunkDir=path.join(rootDir,'chunks',`${String(i+1).padStart(4,'0')}_offset_${String(expectedOffset).padStart(9,'0')}`);
  const required=['summary.json','status.json','validation.json','reconciliation.json','fk_dependency_report.json'];
  for(const f of required) if(!fs.existsSync(path.join(chunkDir,f))) throw new Error(`Missing live chunk evidence ${profile}#${i+1}: ${f}`);
  const summary=readJson(path.join(chunkDir,'summary.json'));
  const status=readJson(path.join(chunkDir,'status.json'));
  const validation=readJson(path.join(chunkDir,'validation.json'));
  const recon=readJson(path.join(chunkDir,'reconciliation.json'))?.[profile];
  const fk=readJson(path.join(chunkDir,'fk_dependency_report.json'));
  const errors=[];
  if(summary.mode!=='live'||summary.status!=='completed'||status.status!=='completed') errors.push('not-completed-live');
  if(Number(summary.offset||0)!==expectedOffset||Number(summary.limit||0)!==limit||summary.unlimited!==false) errors.push('range-mismatch');
  if(!sameSet(summary.selectedProfiles,[profile])) errors.push('profile-mismatch');
  if(summary.sourceManifestFileSha256!==manifestSha) errors.push('manifest-hash-mismatch');
  if(summary.approvedDryRunId!==dryRunId) errors.push('approved-dry-run-mismatch');
  if(Number(summary.validationErrors||0)!==0||Number(summary.requiredLookupMisses||0)!==0||Number(summary.criticalLookupMisses||0)!==0||Number(summary.rejectedRows||0)!==0||Number(summary.fkDependencyFailures||0)!==0) errors.push('blocking-findings');
  if(!Array.isArray(validation)||!validation.some(r=>r.scope==='db'&&/Connected to MySQL/i.test(String(r.message||'')))) errors.push('not-db-backed');
  if(!Array.isArray(fk)||!fk.every(r=>r.ok!==false)) errors.push('fk-failure');
  if(!recon||Number(recon.sourceRows||0)!==sourceRows||Number(recon.processedRows||0)!==limit||Number(recon.rejectedRows||0)!==0||Number(recon.rolledBackRows||0)!==0) errors.push('reconciliation-failure');
  if(errors.length) throw new Error(`Live chunk ${profile}#${i+1} failed aggregation: ${errors.join(', ')}`);
  const stat=summary.stats?.[profile]||{};
  for(const k of Object.keys(totals)) totals[k]+=Number(stat[k]||0);
  chunks.push({index:i+1,offset:expectedOffset,limit,processedRows:Number(recon.processedRows||0),outputDir:chunkDir,summarySha256:sha256File(path.join(chunkDir,'summary.json')),statusSha256:sha256File(path.join(chunkDir,'status.json')),validationSha256:sha256File(path.join(chunkDir,'validation.json')),reconciliationSha256:sha256File(path.join(chunkDir,'reconciliation.json')),fkDependencyReportSha256:sha256File(path.join(chunkDir,'fk_dependency_report.json')),ok:true});
  expectedOffset+=limit;
}
if(expectedOffset!==sourceRows||totals.processed!==sourceRows) throw new Error(`Live chunk coverage failed for ${profile}: covered=${expectedOffset}, processed=${totals.processed}, expected=${sourceRows}`);
const result={ok:true,version:'3.2.3-live-profile-row-chunks-20260816',profile,sourceRows,processedRows:totals.processed,chunkSize,chunkCount,manifestSha256:manifestSha,approvedDryRunId:dryRunId,totals,chunks,completedAt:new Date().toISOString()};
fs.writeFileSync(path.join(rootDir,'live_chunk_index.json'),`${JSON.stringify(result,null,2)}\n`,'utf8');
console.log(JSON.stringify(result,null,2));
