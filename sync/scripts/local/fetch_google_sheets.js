#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, DATA_ROOT, ensureDir, stamp, readJson, writeJson, updateState, isPlaceholderId, csvCell, loadEnv } = require('./common');
const { getSpreadsheetMetadata, getValues, columnLetter, quoteSheetName, resolveKeyPath } = require('./google_sheets_client');

loadEnv();
const configPath = path.join(ROOT, 'config', 'local_google_sheets.json');
const config = readJson(configPath);
if (!config || !Array.isArray(config.profiles) || config.profiles.length !== 9) throw new Error('config/local_google_sheets.json must contain exactly nine profiles.');
const start = String(process.env.LOCAL_CUTOFF_START || config.window?.start || '2024-01-01');
const end = String(process.env.LOCAL_CUTOFF_END || config.window?.end || '2026-12-31');
const chunkRows = Math.max(100, Number(process.env.GOOGLE_FETCH_CHUNK_ROWS || 5000));
const runId = `google_${stamp()}`;
const runDir = ensureDir(path.join(DATA_ROOT, 'google_raw', runId));
const rawDir = ensureDir(path.join(runDir, 'raw'));
const auditDir = ensureDir(path.join(runDir, 'audit'));

const MONTHS = { jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12 };
function iso(y,m,d){ const dt=new Date(Date.UTC(y,m-1,d)); return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d ? dt.toISOString().slice(0,10) : null; }
function parseBusinessDate(value) {
  const s = String(value ?? '').replace(/\u00a0/g,' ').trim(); if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/(?:^|[^0-9])(\d{1,2})-([A-Za-z]{3,9})-(\d{2,4})$/);
  if (m) { let y=Number(m[3]); if(y<100)y+=y>=70?1900:2000; const mm=MONTHS[m[2].toLowerCase()]; if(mm)return iso(y,mm,Number(m[1])); }
  m = s.match(/(?:^|[^0-9])(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+.*)?$/);
  if (m) { let y=Number(m[3]); if(y<100)y+=y>=70?1900:2000; let a=Number(m[1]),b=Number(m[2]); let d=a,mm=b; if(a<=12&&b>12){mm=a;d=b;} return iso(y,mm,d); }
  m = s.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
  if (m) return iso(Number(m[1]),Number(m[2]),Number(m[3]));
  return null;
}
function normalizeHeader(s){ return String(s||'').replace(/\u00a0/g,' ').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ' ).replace(/\s+/g,' ').trim(); }
function nonEmptyRow(row){ return (row||[]).some(v=>String(v??'').trim()!==''); }
function inWindow(d){ return d && d >= start && d <= end; }
function writeCsvRow(stream,row){ stream.write(`${row.map(csvCell).join(',')}\n`); }

async function fetchProfile(profile) {
  if (isPlaceholderId(profile.spreadsheetId)) throw new Error(`${profile.label}: spreadsheetId is still a placeholder.`);
  const meta = await getSpreadsheetMetadata(profile.spreadsheetId);
  const sheet = (meta.sheets || []).find(s => s.properties?.title === profile.sheetName);
  if (!sheet) throw new Error(`${profile.label}: sheet tab "${profile.sheetName}" not found in spreadsheet "${meta.properties?.title || profile.spreadsheetId}".`);
  const rowCount = Number(sheet.properties.gridProperties?.rowCount || 0);
  const colCount = Number(sheet.properties.gridProperties?.columnCount || 0);
  const headerRow = Math.max(1, Number(profile.headerRow || 1));
  const fullLastCol = columnLetter(Math.max(1, colCount));
  const headerRange = `${quoteSheetName(profile.sheetName)}!A${headerRow}:${fullLastCol}${headerRow}`;
  const headerResp = await getValues(profile.spreadsheetId, headerRange);
  const rawHeaders = (headerResp.values?.[0] || []).map(v => String(v ?? '').replace(/\u00a0/g,' ').trim());
  let lastHeader = rawHeaders.length - 1; while (lastHeader >= 0 && !rawHeaders[lastHeader]) lastHeader -= 1;
  if (lastHeader < 0) throw new Error(`${profile.label}: configured header row ${headerRow} is empty.`);
  const headers = rawHeaders.slice(0, lastHeader + 1);
  const lastCol = columnLetter(headers.length);
  const headerIndex = new Map(); headers.forEach((h,i)=>{ const n=normalizeHeader(h); if(n&&!headerIndex.has(n))headerIndex.set(n,i); });
  const dateIndexes = (profile.dateColumns || []).map(name => ({ name, idx: headerIndex.get(normalizeHeader(name)) })).filter(x => Number.isInteger(x.idx));
  if (!dateIndexes.length) throw new Error(`${profile.label}: none of configured date columns found: ${(profile.dateColumns||[]).join(', ')}`);

  const outPath = path.join(rawDir, profile.sourceFile);
  const out = fs.createWriteStream(outPath, { encoding: 'utf8' });
  writeCsvRow(out, headers);
  const rejectedPath = path.join(auditDir, `${profile.id}_excluded_rows.csv`);
  const rejected = fs.createWriteStream(rejectedPath, { encoding: 'utf8' });
  writeCsvRow(rejected, ['sheet_row','reason','date_value','parsed_date','key_hint']);

  let fetched=0,included=0,excludedBefore=0,excludedAfter=0,undated=0,blank=0;
  const dataStart = headerRow + 1;
  for (let from=dataStart; from<=rowCount; from+=chunkRows) {
    const to = Math.min(rowCount, from + chunkRows - 1);
    const range = `${quoteSheetName(profile.sheetName)}!A${from}:${lastCol}${to}`;
    const resp = await getValues(profile.spreadsheetId, range);
    const rows = resp.values || [];
    for (let i=0;i<rows.length;i++) {
      const rowNo=from+i; const row=rows[i] || [];
      if(!nonEmptyRow(row)){blank++;continue;}
      fetched++;
      let parsed=null, rawDate='';
      for(const d of dateIndexes){ const val=row[d.idx]; const p=parseBusinessDate(val); if(p){parsed=p;rawDate=String(val??'');break;} if(!rawDate&&String(val??'').trim())rawDate=String(val); }
      const keyHint = String(row[headers.findIndex(h=>/dispo/i.test(h))] ?? row[0] ?? '').slice(0,120);
      if(!parsed){undated++;writeCsvRow(rejected,[rowNo,'unparseable_or_missing_date',rawDate,'',keyHint]);continue;}
      if(parsed<start){excludedBefore++;writeCsvRow(rejected,[rowNo,'before_window',rawDate,parsed,keyHint]);continue;}
      if(parsed>end){excludedAfter++;writeCsvRow(rejected,[rowNo,'after_window',rawDate,parsed,keyHint]);continue;}
      const padded = headers.map((_,idx)=>row[idx] ?? '');
      writeCsvRow(out,padded);included++;
    }
    process.stdout.write(`[FETCH] ${profile.id}: rows ${from}-${to} | included=${included} fetched=${fetched}\n`);
  }
  await Promise.all([new Promise(r=>out.end(r)),new Promise(r=>rejected.end(r))]);
  return {
    id:profile.id,label:profile.label,sourceFile:profile.sourceFile,spreadsheetId:profile.spreadsheetId,sheetName:profile.sheetName,
    spreadsheetTitle:meta.properties?.title||null,headerRow,rowCount,colCount,dateColumnsFound:dateIndexes.map(x=>x.name),
    fetchedNonBlank:fetched,included,excludedBefore,excludedAfter,undated,blank,outputPath:outPath,rejectedAuditPath:rejectedPath
  };
}

(async()=>{
  if (String(process.env.GOOGLE_AUTH_MODE || 'service-account').toLowerCase() !== 'service-account') throw new Error('This ready package currently requires GOOGLE_AUTH_MODE=service-account for private production sheets.');
  if (!process.env.GOOGLE_SNAPSHOT_DIR && !fs.existsSync(resolveKeyPath())) throw new Error(`Missing service-account file: ${resolveKeyPath()}`);
  const results=[];
  for(const profile of config.profiles){ console.log(`\n=== ${profile.label} ===`); results.push(await fetchProfile(profile)); }
  const manifest={ok:true,runId,generatedAt:new Date().toISOString(),window:{start,end},rawDir,auditDir,profiles:results,totalIncluded:results.reduce((a,b)=>a+b.included,0),totalUndated:results.reduce((a,b)=>a+b.undated,0)};
  writeJson(path.join(runDir,'fetch_manifest.json'),manifest);
  updateState({latestFetchRunId:runId,latestFetchDir:runDir,latestRawDir:rawDir,latestFetchManifest:path.join(runDir,'fetch_manifest.json')});
  console.log(`\nFETCH_COMPLETE=${runDir}`);
  console.log(JSON.stringify(manifest,null,2));
})().catch(err=>{console.error(err.stack||String(err));process.exit(1);});
