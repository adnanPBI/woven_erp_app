'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { profileRequiredHeaders } = require('../../lib/source_manifest');

const root = path.resolve(__dirname, '..', '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'weaving-v322-lowmem-'));
const csvDir = path.join(temp, 'csv');
fs.mkdirSync(csvDir, { recursive: true });
const contract = JSON.parse(fs.readFileSync(path.join(root, 'mappings/mapping-contract-v2.json'), 'utf8'));

function valueFor(header, index) {
  const h = String(header).toLowerCase();
  if (h.includes('pre_costing')) return `PC-${index}`;
  if (h.includes('dispo')) return `D-${index}`;
  if (h.includes('po no') || h.includes('po number')) return `PO-${index}`;
  if (h.includes('warping program')) return String(index);
  if (h.includes('yarn lot')) return `LOT-${index}`;
  if (h.includes('yarn count')) return '20/1';
  if (h.includes('yarn brand')) return 'BRAND';
  if (h.includes('challan') || h.includes('s/r')) return String(index);
  if (h.includes('date')) return '01/01/2026';
  if (h.includes('buyer')) return 'BUYER';
  if (h.includes('construction')) return '20x20/60x60';
  if (h.includes('composition')) return '100% COTTON';
  return '1';
}
function cell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const byFile = new Map();
for (const profile of contract.profiles) {
  if (!byFile.has(profile.source_file)) byFile.set(profile.source_file, []);
  byFile.get(profile.source_file).push(profile);
}
for (const [filename, profiles] of byFile) {
  const headers = [...new Set(profiles.flatMap((profile) => profileRequiredHeaders(profile)))];
  const count = filename === 'Warping database.csv' ? 50000 : 1;
  const out = fs.createWriteStream(path.join(csvDir, filename));
  out.write(`${headers.map(cell).join(',')}\n`);
  for (let index = 1; index <= count; index += 1) out.write(`${headers.map((header) => cell(valueFor(header, index))).join(',')}\n`);
  out.end();
}

function waitForStreams() {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      const pending = fs.readdirSync(csvDir).some((name) => fs.statSync(path.join(csvDir, name)).size === 0);
      if (!pending) { clearInterval(timer); setTimeout(resolve, 50); }
    }, 10);
  });
}

(async () => {
  await waitForStreams();
  const manifestPath = path.join(temp, 'source-manifest.pending.json');
  const manifestRun = spawnSync(process.execPath, ['--max-old-space-size=96', path.join(root, 'scripts/v3/certify_sources.js'), `--csv-dir=${csvDir}`, `--output=${manifestPath}`], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CSV_DIR: csvDir, FOLDING_SOURCE_UNIT: 'yards', DELIVERY_SOURCE_UNIT: 'yards', QUIET_LOGS: 'true' },
    timeout: 120000,
  });
  assert.strictEqual(manifestRun.signal, null, `manifest process was killed: ${manifestRun.signal}\n${manifestRun.stderr}`);
  assert.ok(fs.existsSync(manifestPath), `manifest was not produced\nstdout=${manifestRun.stdout}\nstderr=${manifestRun.stderr}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.manifest_version, '3.2.2-low-memory');
  assert.strictEqual(manifest.files.find((entry) => entry.filename === 'Warping database.csv').nonempty_rows, 50000);

  const validateRun = spawnSync(process.execPath, ['--max-old-space-size=128', path.join(root, 'scripts/validate_contract_v2.js'), '--contract=mappings/mapping-contract-v2.json', `--csv-dir=${csvDir}`], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, CSV_DIR: csvDir, SKIP_SOURCE_MANIFEST_CHECK: 'true', REQUIRE_SOURCE_MANIFEST: 'false', REQUIRE_DB_FOR_DISPO_RESOLUTION: 'false', FOLDING_SOURCE_UNIT: 'yards', DELIVERY_SOURCE_UNIT: 'yards', DB_USER: '', DB_PASSWORD: '', QUIET_LOGS: 'true' },
    timeout: 120000,
  });
  assert.strictEqual(validateRun.signal, null, `contract validation was killed: ${validateRun.signal}\n${validateRun.stderr}`);
  assert.notStrictEqual(validateRun.status, null);
  console.log('cpanel_low_memory_v322.test.js: PASS');
})().catch((error) => { console.error(error); process.exitCode = 1; });
