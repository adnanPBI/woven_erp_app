'use strict';
const fs = require('fs');
const path = require('path');
const { ROOT, DATA_ROOT, ensureDir, stamp, writeJson, sha256File } = require('./common');
const config = require('../../config/local_google_sheets.json');
(async () => {
  const dir = ensureDir(path.join(DATA_ROOT, 'sheet_snapshots', stamp()));
  const results = [];
  for (const p of config.profiles) {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(p.spreadsheetId)}/export?format=csv&gid=${p.sheetId}`;
    const response = await fetch(url, {signal: AbortSignal.timeout(180000)});
    if (!response.ok || !/csv/i.test(response.headers.get('content-type') || '')) throw new Error(`${p.id}: CSV export failed: ${response.status}`);
    const file = path.join(dir, p.sourceFile);
    await require('stream/promises').pipeline(require('stream').Readable.fromWeb(response.body), fs.createWriteStream(file));
    results.push({...p, file, sha256: sha256File(file), bytes: fs.statSync(file).size});
    console.log(`${p.id}: downloaded ${fs.statSync(file).size} bytes`);
  }
  writeJson(path.join(dir, 'snapshot.json'), {downloadedAt: new Date().toISOString(), profiles: results});
  writeJson(path.join(DATA_ROOT, 'latest_sheet_snapshot.json'), {dir});
  console.log(`SNAPSHOT=${dir}`);
})().catch(e => {console.error(e.message); process.exitCode = 1;});
