'use strict';

const fs = require('fs');
const path = require('path');
const { forEachCsvRowSync, isNonEmptyRow } = require('../../lib/csv_stream');

function parseArgs(argv) {
  const out = {};
  for (const item of argv) {
    if (!item.startsWith('--')) continue;
    const [key, ...rest] = item.slice(2).split('=');
    out[key] = rest.length ? rest.join('=') : true;
  }
  return out;
}
function quoteCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const args = parseArgs(process.argv.slice(2));
const inputDir = path.resolve(args.input || args['input-dir'] || 'csv_raw');
const outputDir = path.resolve(args.output || args['output-dir'] || 'csv_normalized');
if (!fs.existsSync(inputDir)) {
  console.error(JSON.stringify({ ok: false, error: `Input directory does not exist: ${inputDir}` }, null, 2));
  process.exit(1);
}
fs.mkdirSync(outputDir, { recursive: true });

const files = fs.readdirSync(inputDir).filter((name) => /\.csv$/i.test(name)).sort();
const report = [];
for (const filename of files) {
  const inputPath = path.join(inputDir, filename);
  const outputPath = path.join(outputDir, filename);
  const fd = fs.openSync(outputPath, 'w');
  let parsedRows = 0;
  let writtenRows = 0;
  let blankRowsRemoved = 0;
  let headerWritten = false;
  try {
    forEachCsvRowSync(inputPath, (row, logicalRowNumber) => {
      if (logicalRowNumber === 1) {
        fs.writeSync(fd, `${row.map(quoteCell).join(',')}\n`, null, 'utf8');
        headerWritten = true;
        return true;
      }
      parsedRows += 1;
      if (!isNonEmptyRow(row)) { blankRowsRemoved += 1; return true; }
      fs.writeSync(fd, `${row.map(quoteCell).join(',')}\n`, null, 'utf8');
      writtenRows += 1;
      return true;
    });
  } finally {
    fs.closeSync(fd);
  }
  report.push({
    filename,
    status: headerWritten ? 'normalized' : 'empty-file',
    parsedRows,
    writtenRows,
    blankRowsRemoved,
    inputBytes: fs.statSync(inputPath).size,
    outputBytes: fs.statSync(outputPath).size,
  });
}
const reportPath = path.join(outputDir, 'normalization-report.json');
fs.writeFileSync(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), inputDir, outputDir, streaming: true, files: report }, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, inputDir, outputDir, reportPath, files: report.length, streaming: true }, null, 2));
