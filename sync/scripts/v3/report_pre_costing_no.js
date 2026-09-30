'use strict';
const fs = require('fs');
const path = require('path');
const { analyzePreCostingNo } = require('../../lib/source_manifest');
function args(argv) { const out = {}; for (const item of argv) { if (!item.startsWith('--')) continue; const [key, ...rest] = item.slice(2).split('='); out[key] = rest.length ? rest.join('=') : true; } return out; }
const options = args(process.argv.slice(2));
const root = path.resolve(__dirname, '../..');
const input = path.resolve(options.input || path.join(process.env.CSV_DIR || path.join(root, 'csv_files'), 'po database.csv'));
const output = path.resolve(options.output || path.join(root, 'output/pre_costing_no_completeness_report.json'));
if (!fs.existsSync(input)) throw new Error(`PO source file not found: ${input}`);
const report = analyzePreCostingNo(input);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ok: report.status === 'PASS', output, ...report }, null, 2));
if (report.status !== 'PASS') process.exitCode = 1;
