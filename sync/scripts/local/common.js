'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const DATA_ROOT = process.env.LOCAL_DATA_ROOT ? path.resolve(process.env.LOCAL_DATA_ROOT) : path.join(ROOT, 'local_data');
const STATE_PATH = path.join(DATA_ROOT, 'local_state.json');

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const b = Buffer.allocUnsafe(1024 * 1024);
  try { while (true) { const n = fs.readSync(fd, b, 0, b.length, null); if (!n) break; h.update(b.subarray(0, n)); } }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function loadEnv() {
  require('dotenv').config({ path: path.join(ROOT, '.env'), override: false });
  return process.env;
}
function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}
function writeJson(p, value) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}
function readState() { return readJson(STATE_PATH, { version: 1, root: ROOT }); }
function updateState(patch) {
  const state = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  writeJson(STATE_PATH, state);
  return state;
}
function isPlaceholderId(v) {
  const s = String(v || '').trim();
  return !s || /^PASTE_/i.test(s) || /^YOUR_/i.test(s);
}
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      stdio: opts.stdio || ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '', stderr = '';
    if (child.stdout) child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; if (!opts.quiet) process.stdout.write(s); });
    if (child.stderr) child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; if (!opts.quiet) process.stderr.write(s); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ code, stdout, stderr });
      else {
        const e = new Error(`${cmd} exited with code ${code}`);
        e.code = code; e.stdout = stdout; e.stderr = stderr; reject(e);
      }
    });
  });
}
function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]; if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq >= 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (argv[i + 1] && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}
module.exports = { ROOT, DATA_ROOT, STATE_PATH, ensureDir, stamp, sha256File, loadEnv, readJson, writeJson, readState, updateState, isPlaceholderId, csvCell, run, parseCliArgs };
