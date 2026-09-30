#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function fail(message) { throw new Error(message); }
function argsOf(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    if (!a.startsWith('--')) continue;
    const i = a.indexOf('=');
    out[i > 0 ? a.slice(2, i) : a.slice(2)] = i > 0 ? a.slice(i + 1) : true;
  }
  return out;
}
function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const n = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!n) break;
      h.update(buffer.subarray(0, n));
    }
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}
function envGet(text, key) {
  const m = text.match(new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}=(.*)$`, 'm'));
  if (!m) return '';
  let v = m[1].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  return v;
}
function envSet(text, updates) {
  const keys = new Set(Object.keys(updates));
  const seen = new Set();
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || !keys.has(m[1])) { out.push(line); continue; }
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push(`${m[1]}=${updates[m[1]]}`);
  }
  for (const [k, v] of Object.entries(updates)) if (!seen.has(k)) out.push(`${k}=${v}`);
  return out.join('\n').replace(/\n*$/, '\n');
}
function atomicWrite(p, data) {
  const tmp = `${p}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, p);
  fs.chmodSync(p, 0o600);
}
function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }

function main() {
  const args = argsOf(process.argv);
  const root = path.resolve(__dirname, '../..');
  const cliEnvPath = path.resolve(args.env || path.join(root, '.env'));
  const visEnvPath = path.resolve(args['vis-env'] || path.join(root, '..', 'import_mapper_vis', '.env'));
  const normalizationRoot = path.resolve(args['normalization-root'] || '/home/weavonpq/source_remediation_v323');
  const certifiedDir = path.join(normalizationRoot, 'certified');
  const attestationPath = path.join(normalizationRoot, 'audit', 'normalization-attestation.json');
  const policyPath = path.join(root, 'config', 'normalization_policy.v3.2.3.json');

  if (!fs.existsSync(cliEnvPath)) fail(`CLI .env not found: ${cliEnvPath}`);
  if (!fs.existsSync(visEnvPath)) fail(`VIS .env not found: ${visEnvPath}`);
  if (!fs.existsSync(attestationPath)) fail(`Normalization attestation missing: ${attestationPath}`);
  if (!fs.existsSync(policyPath)) fail(`Normalization policy missing: ${policyPath}`);

  const att = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
  if (att.status !== 'PASS' || Number(att.blocking_findings || 0) !== 0) fail('Normalization attestation is not PASS/0-blocking.');
  if (path.resolve(att.certified_source_dir) !== path.resolve(certifiedDir)) fail('Attestation certified_source_dir does not match requested normalization root.');
  if (att.normalization_policy_sha256 !== sha256File(policyPath)) fail('Normalization policy hash mismatch.');

  const certifiedNames = Object.keys(att.certified_files || {});
  if (certifiedNames.length !== 9) fail(`Expected exactly nine attested certified files; found ${certifiedNames.length}.`);
  for (const [name, meta] of Object.entries(att.certified_files || {})) {
    const p = path.join(certifiedDir, name);
    if (!fs.existsSync(p)) fail(`Certified file missing: ${name}`);
    if (sha256File(p) !== meta.sha256) fail(`Certified hash mismatch: ${name}`);
  }

  const dangerousShell = ['PRODUCTION_APPROVAL_TOKEN', 'APPROVED_DRY_RUN_ID', 'REVIEWED_PENDING_HASH', 'IMPORT_BACKUP_CONFIRMED']
    .filter((k) => String(process.env[k] || '').trim());
  if (String(process.env.ALLOW_PRODUCTION_DB || '').toLowerCase() === 'true'
      || String(process.env.BACKUP_CONFIRMED || '').toLowerCase() === 'true'
      || dangerousShell.length) {
    fail('Inherited shell contains live-production controls. Clear them before activating certified sources.');
  }

  const commonSafe = {
    CSV_DIR: certifiedDir,
    NORMALIZATION_ATTESTATION_FILE: attestationPath,
    ALLOW_PRODUCTION_DB: 'false',
    BACKUP_CONFIRMED: 'false',
    PRODUCTION_APPROVAL_TOKEN: '',
    APPROVED_DRY_RUN_ID: '',
    CSV_DATE_ORDER: 'dmy',
    REPORT_DETAIL_LIMIT: '1000',
    PREVIEW_DETAIL_LIMIT: '500',
    SOURCE_REPORT_DETAIL_LIMIT: '1000',
  };
  const cliUpdates = { ...commonSafe, ALLOW_APPROVED_PLACEHOLDERS: 'true' };
  const visUpdates = {
    ...commonSafe,
    VISUAL_SQL_EXECUTOR_ENABLED: 'false',
    GOOGLE_SHEETS_WEBHOOK_ACTION: 'record-only',
    GOOGLE_SHEETS_WEBHOOK_LIVE_BACKGROUND: 'false',
  };

  const cliOriginal = fs.readFileSync(cliEnvPath, 'utf8');
  const visOriginal = fs.readFileSync(visEnvPath, 'utf8');
  const cliUpdated = envSet(cliOriginal, cliUpdates);
  const visUpdated = envSet(visOriginal, visUpdates);
  const ts = stamp();
  const cliBackup = `${cliEnvPath}.pre-v323-certified-activation.${ts}.bak`;
  const visBackup = `${visEnvPath}.pre-v323-certified-activation.${ts}.bak`;
  fs.copyFileSync(cliEnvPath, cliBackup); fs.chmodSync(cliBackup, 0o600);
  fs.copyFileSync(visEnvPath, visBackup); fs.chmodSync(visBackup, 0o600);

  let committedCli = false;
  let committedVis = false;
  try {
    atomicWrite(cliEnvPath, cliUpdated); committedCli = true;
    atomicWrite(visEnvPath, visUpdated); committedVis = true;

    const cliFinal = fs.readFileSync(cliEnvPath, 'utf8');
    const visFinal = fs.readFileSync(visEnvPath, 'utf8');
    const cliOk = envGet(cliFinal, 'CSV_DIR') === certifiedDir
      && envGet(cliFinal, 'NORMALIZATION_ATTESTATION_FILE') === attestationPath
      && envGet(cliFinal, 'ALLOW_PRODUCTION_DB') === 'false'
      && envGet(cliFinal, 'BACKUP_CONFIRMED') === 'false'
      && !envGet(cliFinal, 'PRODUCTION_APPROVAL_TOKEN')
      && !envGet(cliFinal, 'APPROVED_DRY_RUN_ID')
      && envGet(cliFinal, 'CSV_DATE_ORDER') === 'dmy'
      && envGet(cliFinal, 'ALLOW_APPROVED_PLACEHOLDERS') === 'true'
      && envGet(cliFinal, 'REPORT_DETAIL_LIMIT') === '1000'
      && envGet(cliFinal, 'PREVIEW_DETAIL_LIMIT') === '500'
      && envGet(cliFinal, 'SOURCE_REPORT_DETAIL_LIMIT') === '1000';
    const visOk = envGet(visFinal, 'CSV_DIR') === certifiedDir
      && envGet(visFinal, 'NORMALIZATION_ATTESTATION_FILE') === attestationPath
      && envGet(visFinal, 'ALLOW_PRODUCTION_DB') === 'false'
      && envGet(visFinal, 'BACKUP_CONFIRMED') === 'false'
      && !envGet(visFinal, 'PRODUCTION_APPROVAL_TOKEN')
      && !envGet(visFinal, 'APPROVED_DRY_RUN_ID')
      && envGet(visFinal, 'CSV_DATE_ORDER') === 'dmy'
      && envGet(visFinal, 'VISUAL_SQL_EXECUTOR_ENABLED') === 'false'
      && envGet(visFinal, 'GOOGLE_SHEETS_WEBHOOK_ACTION') === 'record-only'
      && envGet(visFinal, 'GOOGLE_SHEETS_WEBHOOK_LIVE_BACKGROUND') === 'false'
      && envGet(visFinal, 'REPORT_DETAIL_LIMIT') === '1000'
      && envGet(visFinal, 'PREVIEW_DETAIL_LIMIT') === '500'
      && envGet(visFinal, 'SOURCE_REPORT_DETAIL_LIMIT') === '1000';
    if (!cliOk || !visOk) fail('Post-activation verification failed.');

    console.log(JSON.stringify({
      ok: true,
      version: '3.2.3-hybrid',
      certifiedDir,
      attestationPath,
      attestationSha256: sha256File(attestationPath),
      certifiedFiles: 9,
      cliEnvBackup: cliBackup,
      visEnvBackup: visBackup,
      cliEnvSha256: sha256File(cliEnvPath),
      visEnvSha256: sha256File(visEnvPath),
      productionWritesEnabled: false,
      visWritesEnabled: false,
      csvDateOrder: 'dmy',
      allowApprovedPlaceholders: true,
      reportDetailLimit: 1000,
      previewDetailLimit: 500,
      sourceReportDetailLimit: 1000,
    }, null, 2));
  } catch (error) {
    try { if (committedCli) fs.copyFileSync(cliBackup, cliEnvPath); } catch (_) {}
    try { if (committedVis) fs.copyFileSync(visBackup, visEnvPath); } catch (_) {}
    throw error;
  }
}

try { main(); }
catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
