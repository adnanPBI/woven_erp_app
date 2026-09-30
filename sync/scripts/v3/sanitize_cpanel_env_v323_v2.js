#!/usr/bin/env node
'use strict';

/**
 * Hardened v3.2.3 cPanel sanitizer v2
 *
 * Goals:
 *   - Never write unless inherited process environment is already safe.
 *   - Verify immutable source freeze (exactly 9 SHA-256 entries).
 *   - Support --dry-run with redacted change preview and zero writes.
 *   - Require CSV_DATE_ORDER=dmy for the current raw source baseline.
 *   - Optionally accept ISO-normalized certified data only with explicit proof.
 *   - Reject Windows/UNC paths in --mode=cpanel and validate cPanel paths.
 *   - Rotate webhook secret only when one already exists, unless --enable-webhook.
 *   - Stage and validate all outputs before replacing originals.
 *   - Roll back CLI .env, VIS .env, and protected webhook-secret file on failure.
 *   - Generate a redacted evidence report.
 *   - Verify post-state safety, VIS code-level write isolation, and source freeze 9/9.
 *
 * IMPORTANT:
 *   This script cannot modify the parent shell or cPanel "Setup Node.js App"
 *   environment variables. It therefore FAILS when dangerous inherited values are
 *   active and prints the exact manual cleanup reminder.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '3.2.3-cpanel-sanitizer-v2';
const MANAGED_CLI_KEYS = [
  'ALLOW_PRODUCTION_DB',
  'BACKUP_CONFIRMED',
  'APPROVED_DRY_RUN_ID',
  'PRODUCTION_APPROVAL_TOKEN',
  'CSV_DATE_ORDER',
];
const MANAGED_VIS_KEYS = [
  'VISUAL_SQL_EXECUTOR_ENABLED',
  'GOOGLE_SHEETS_WEBHOOK_ACTION',
  'GOOGLE_SHEETS_WEBHOOK_LIVE_BACKGROUND',
  'ALLOW_PRODUCTION_DB',
  'BACKUP_CONFIRMED',
  'PRODUCTION_APPROVAL_TOKEN',
  'CSV_DATE_ORDER',
  'GSHEET_WEBHOOK_SECRET',
];
const CLI_PATH_KEYS = [
  'CSV_DIR',
  'SOURCE_MANIFEST_FILE',
  'MAPPING_CONTRACT_FILE',
  'LOG_DIR',
];
const VIS_PATH_KEYS = [
  'IMPORT_CLI_DIR',
  'CSV_DIR',
  'VISUAL_MAPPING_CONFIG',
  'MAPPING_CONTRACT_FILE',
  'MAPPING_CONTRACT_TEMPLATE',
  'CLI_PREVIEW_OUTPUT_DIR',
  'CLI_CONTRACT_OUTPUT_ROOT',
  'GOOGLE_SHEET_MAPPINGS_PATH',
  'GOOGLE_SHEET_SNAPSHOTS_PATH',
  'GOOGLE_SERVICE_ACCOUNT_JSON',
  'GOOGLE_SHEETS_CACHE_DIR',
  'GOOGLE_SHEETS_CACHE_BACKUP_DIR',
];
const SHELL_DANGER_KEYS = [
  'ALLOW_PRODUCTION_DB',
  'BACKUP_CONFIRMED',
  'PRODUCTION_APPROVAL_TOKEN',
  'APPROVED_DRY_RUN_ID',
  'IMPORT_BACKUP_CONFIRMED',
  'REVIEWED_PENDING_HASH',
];

class SanitizerError extends Error {
  constructor(message, code = 'SANITIZER_ERROR', details = undefined) {
    super(message);
    this.name = 'SanitizerError';
    this.code = code;
    this.details = details;
  }
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256Text(text) {
  return sha256Buffer(Buffer.from(text, 'utf8'));
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function boolTrue(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function nonBlank(value) {
  return String(value || '').trim().length > 0;
}

function redactValue(key, value) {
  const upper = String(key || '').toUpperCase();
  if (/PASSWORD|TOKEN|SECRET|KEY/.test(upper)) {
    return nonBlank(value) ? '<redacted:present>' : '<blank>';
  }
  return String(value ?? '');
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new SanitizerError(`Unexpected positional argument: ${token}`, 'ARGUMENT_ERROR');
    }
    const eq = token.indexOf('=');
    if (eq >= 0) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function helpText() {
  return `\n${VERSION}\n\nUsage:\n  node sanitize_cpanel_env_v323_v2.js \\\n    --cli-env=/home/USER/import_mapper_cli/.env \\\n    --vis-env=/home/USER/import_mapper_vis/.env \\\n    --freeze-dir=/home/USER/source_freeze_YYYYMMDD_HHMMSS \\\n    --webhook-secret-file=/home/USER/secure_keys/gsheet-webhook-v323.secret \\\n    [--mode=cpanel] [--dry-run] [--date-mode=dmy|iso] \\\n    [--iso-proof=/path/to/normalized_iso_date_proof.json] \\\n    [--enable-webhook] [--disable-webhook] \\\n    [--report=/home/USER/v323_preflight_evidence/sanitizer-report.json] \\\n    [--cpanel-home=/home/USER]\n\nDefaults:\n  --mode=cpanel\n  --date-mode=dmy\n  Webhook: rotate only when VIS .env already has a nonblank GSHEET_WEBHOOK_SECRET.\n           If absent, keep disabled unless --enable-webhook is supplied.\n\nIMPORTANT:\n  This script cannot modify parent-shell variables or cPanel Setup Node.js App\n  environment variables. Dangerous inherited values cause an immediate failure.\n`;
}

function requireExistingFile(filePath, label) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new SanitizerError(`${label} not found: ${resolved}`, 'FILE_NOT_FOUND', { path: resolved });
  }
  return resolved;
}

function requireExistingDir(dirPath, label) {
  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new SanitizerError(`${label} not found: ${resolved}`, 'DIRECTORY_NOT_FOUND', { path: resolved });
  }
  return resolved;
}

function parseEnvText(text) {
  const values = {};
  const occurrences = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value; // last definition is considered authoritative for validation/reporting
    occurrences[key] = occurrences[key] || [];
    occurrences[key].push({ line: i + 1, value });
  }
  return { values, occurrences, lines };
}

function envEncode(value) {
  const s = String(value ?? '');
  if (s === '') return '';
  if (/^[A-Za-z0-9_./:@+,-]+$/.test(s)) return s;
  return JSON.stringify(s);
}

function canonicalizeEnv(text, updates, dedupeExtraKeys = []) {
  const keys = new Set([...Object.keys(updates), ...dedupeExtraKeys]);
  const existing = parseEnvText(text);
  const firstWritten = new Set();
  const out = [];

  for (const line of existing.lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m || !keys.has(m[1])) {
      out.push(line);
      continue;
    }

    const key = m[1];
    if (firstWritten.has(key)) continue;
    firstWritten.add(key);

    const next = Object.prototype.hasOwnProperty.call(updates, key)
      ? updates[key]
      : existing.values[key];
    out.push(`${key}=${envEncode(next)}`);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (firstWritten.has(key)) continue;
    if (out.length && out[out.length - 1] !== '') out.push('');
    out.push(`${key}=${envEncode(value)}`);
    firstWritten.add(key);
  }

  return out.join('\n').replace(/\n*$/, '\n');
}

function checkInheritedEnvironment() {
  const status = {};
  const violations = [];

  for (const key of SHELL_DANGER_KEYS) {
    const raw = process.env[key];
    const present = raw !== undefined && String(raw).trim() !== '';
    const dangerous =
      key === 'ALLOW_PRODUCTION_DB' || key === 'BACKUP_CONFIRMED' || key === 'IMPORT_BACKUP_CONFIRMED'
        ? boolTrue(raw)
        : present;

    status[key] = {
      present,
      dangerous,
      value: /TOKEN|HASH/.test(key) ? (present ? '<redacted:present>' : '<absent>') : String(raw ?? '<absent>'),
    };

    if (dangerous) violations.push(key);
  }

  if (violations.length) {
    throw new SanitizerError(
      `Dangerous inherited shell/cPanel process environment is active: ${violations.join(', ')}. ` +
      `Unset these variables in the current shell and remove/disable any conflicting values in cPanel Setup Node.js App before rerunning.`,
      'INHERITED_ENV_UNSAFE',
      { violations, status }
    );
  }

  return status;
}

function verifyFreeze(freezeDir) {
  const dir = requireExistingDir(freezeDir, 'Source freeze directory');
  const sumsPath = requireExistingFile(path.join(dir, 'SHA256SUMS.txt'), 'Source freeze SHA256SUMS.txt');
  const lines = fs.readFileSync(sumsPath, 'utf8')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);

  if (lines.length !== 9) {
    throw new SanitizerError(`Expected exactly 9 entries in ${sumsPath}; found ${lines.length}.`, 'FREEZE_ENTRY_COUNT_MISMATCH');
  }

  const seen = new Set();
  const files = [];
  for (const line of lines) {
    const m = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/);
    if (!m) throw new SanitizerError(`Malformed SHA256SUMS line: ${line}`, 'FREEZE_SUM_FORMAT_ERROR');
    const expected = m[1].toLowerCase();
    const filename = path.basename(m[2].trim());
    if (seen.has(filename)) throw new SanitizerError(`Duplicate filename in SHA256SUMS: ${filename}`, 'FREEZE_DUPLICATE_FILE');
    seen.add(filename);
    const filePath = requireExistingFile(path.join(dir, filename), `Frozen source ${filename}`);
    const actual = sha256File(filePath);
    if (actual !== expected) {
      throw new SanitizerError(`SHA-256 mismatch for frozen source ${filename}`, 'FREEZE_HASH_MISMATCH', { filename, expected, actual });
    }
    files.push({ filename, sha256: actual, bytes: fs.statSync(filePath).size });
  }

  return {
    freezeDir: dir,
    sumsPath,
    sumsFileSha256: sha256File(sumsPath),
    verifiedCount: files.length,
    files,
  };
}

function isWindowsPath(value) {
  const s = String(value || '').trim();
  return /^[A-Za-z]:[\\/]/.test(s) || /^\\\\/.test(s);
}

function isUnder(parent, child) {
  const p = path.resolve(parent);
  const c = path.resolve(child);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : `${p}${path.sep}`);
}

function inferCpanelHome(cliEnvPath) {
  // /home/USER/import_mapper_cli/.env -> /home/USER
  const root = path.dirname(path.dirname(path.resolve(cliEnvPath)));
  return root;
}

function validateCpanelPaths({ cliEnvPath, visEnvPath, cliParsed, visParsed, cpanelHome, secretFile, reportPath }) {
  const checks = [];
  const problems = [];
  const home = path.resolve(cpanelHome || inferCpanelHome(cliEnvPath));

  function check(label, value, options = {}) {
    if (!nonBlank(value)) {
      if (options.required) problems.push(`${label} is blank`);
      return;
    }
    if (isWindowsPath(value)) {
      problems.push(`${label} uses a Windows/UNC path: ${value}`);
      return;
    }
    if (!path.isAbsolute(value)) {
      problems.push(`${label} is not an absolute POSIX path: ${value}`);
      return;
    }
    if (options.mustBeUnderHome && !isUnder(home, value)) {
      problems.push(`${label} escapes cPanel home ${home}: ${value}`);
      return;
    }
    checks.push({ label, value, ok: true });
  }

  check('CLI .env', cliEnvPath, { required: true, mustBeUnderHome: true });
  check('VIS .env', visEnvPath, { required: true, mustBeUnderHome: true });
  for (const key of CLI_PATH_KEYS) check(`CLI ${key}`, cliParsed.values[key], { mustBeUnderHome: true });
  for (const key of VIS_PATH_KEYS) check(`VIS ${key}`, visParsed.values[key], { mustBeUnderHome: true });
  check('Webhook secret file', secretFile, { required: true, mustBeUnderHome: true });
  check('Evidence report', reportPath, { required: true, mustBeUnderHome: true });

  for (const [label, value] of [
    ['Webhook secret file', secretFile],
    ['Evidence report', reportPath],
  ]) {
    if (String(path.resolve(value)).includes(`${path.sep}public_html${path.sep}`)) {
      problems.push(`${label} must not be stored under public_html: ${value}`);
    }
  }

  if (problems.length) {
    throw new SanitizerError('cPanel path validation failed.', 'CPANEL_PATH_VALIDATION_FAILED', { home, problems, checks });
  }

  return { home, checks, problems: [] };
}

function verifyVisWriteIsolation(visRoot) {
  const serverPath = requireExistingFile(path.join(visRoot, 'visual-map-server.js'), 'VIS visual-map-server.js');
  const text = fs.readFileSync(serverPath, 'utf8');
  const checks = [
    {
      id: 'sql_executor_hard_disabled',
      ok: /const\s+SQL_EXECUTOR_ENABLED\s*=\s*false\s*;/.test(text),
    },
    {
      id: 'webhook_action_hard_record_only',
      ok: /const\s+GOOGLE_SHEETS_WEBHOOK_ACTION\s*=\s*['"]record-only['"]\s*;/.test(text),
    },
    {
      id: 'child_env_production_disabled',
      ok: /ALLOW_PRODUCTION_DB\s*:\s*['"]false['"]/.test(text),
    },
    {
      id: 'child_env_token_blank',
      ok: /PRODUCTION_APPROVAL_TOKEN\s*:\s*['"]['"]/.test(text),
    },
    {
      id: 'vis_write_disabled_guard_present',
      ok: /VIS_WRITE_DISABLED/.test(text),
    },
  ];
  const failed = checks.filter((x) => !x.ok);
  if (failed.length) {
    throw new SanitizerError(
      `VIS code-level write isolation could not be verified: ${failed.map((x) => x.id).join(', ')}`,
      'VIS_WRITE_ISOLATION_NOT_VERIFIED',
      { serverPath, checks }
    );
  }
  return { serverPath, sha256: sha256File(serverPath), checks, ok: true };
}

function validateIsoProof(isoProofPath, freeze) {
  const proofPath = requireExistingFile(isoProofPath, 'ISO normalized-date proof');
  let proof;
  try {
    proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  } catch (error) {
    throw new SanitizerError(`ISO proof is not valid JSON: ${error.message}`, 'ISO_PROOF_INVALID_JSON');
  }

  const statusPass = String(proof.status || '').toUpperCase() === 'PASS' || proof.ok === true;
  const allDatesIso = proof.all_dates_iso === true || proof.allDatesIso === true;
  const freezeHash = String(proof.source_freeze_sha256 || proof.sourceFreezeSha256 || '').toLowerCase();
  if (!statusPass || !allDatesIso || freezeHash !== freeze.sumsFileSha256.toLowerCase()) {
    throw new SanitizerError(
      'ISO proof must show PASS/ok:true, all_dates_iso:true, and source freeze SHA256SUMS hash matching the verified freeze.',
      'ISO_PROOF_NOT_ACCEPTED',
      {
        proofPath,
        statusPass,
        allDatesIso,
        expectedSourceFreezeSha256: freeze.sumsFileSha256,
        providedSourceFreezeSha256: freezeHash || null,
      }
    );
  }

  return { proofPath, sha256: sha256File(proofPath), allDatesIso: true, sourceFreezeSha256: freezeHash };
}

function determineWebhookPlan({ visValues, enableWebhook, disableWebhook }) {
  if (enableWebhook && disableWebhook) {
    throw new SanitizerError('Use only one of --enable-webhook or --disable-webhook.', 'WEBHOOK_OPTION_CONFLICT');
  }
  const currentSecretPresent = nonBlank(visValues.GSHEET_WEBHOOK_SECRET);
  if (disableWebhook) {
    return { action: 'disable', currentSecretPresent, nextSecretPresent: false, generateNewSecret: false };
  }
  if (currentSecretPresent) {
    return { action: 'rotate-existing', currentSecretPresent: true, nextSecretPresent: true, generateNewSecret: true };
  }
  if (enableWebhook) {
    return { action: 'enable-new', currentSecretPresent: false, nextSecretPresent: true, generateNewSecret: true };
  }
  return { action: 'keep-disabled', currentSecretPresent: false, nextSecretPresent: false, generateNewSecret: false };
}

function diffManaged(beforeText, afterText, keys) {
  const before = parseEnvText(beforeText).values;
  const after = parseEnvText(afterText).values;
  const changes = [];
  for (const key of keys) {
    if ((before[key] ?? '') !== (after[key] ?? '')) {
      changes.push({ key, before: redactValue(key, before[key] ?? ''), after: redactValue(key, after[key] ?? '') });
    }
  }
  return changes;
}

function validateStagedEnvs({ cliText, visText, dateMode, webhookPlan, cliPathKeys, visPathKeys, cpanelMode, cpanelHome, cliEnvPath, visEnvPath, secretFile, reportPath }) {
  const cli = parseEnvText(cliText);
  const vis = parseEnvText(visText);
  const problems = [];

  const expected = [
    ['CLI ALLOW_PRODUCTION_DB', cli.values.ALLOW_PRODUCTION_DB, 'false'],
    ['CLI BACKUP_CONFIRMED', cli.values.BACKUP_CONFIRMED, 'false'],
    ['CLI APPROVED_DRY_RUN_ID', cli.values.APPROVED_DRY_RUN_ID || '', ''],
    ['CLI PRODUCTION_APPROVAL_TOKEN', cli.values.PRODUCTION_APPROVAL_TOKEN || '', ''],
    ['CLI CSV_DATE_ORDER', cli.values.CSV_DATE_ORDER, 'dmy'],
    ['VIS ALLOW_PRODUCTION_DB', vis.values.ALLOW_PRODUCTION_DB, 'false'],
    ['VIS BACKUP_CONFIRMED', vis.values.BACKUP_CONFIRMED, 'false'],
    ['VIS PRODUCTION_APPROVAL_TOKEN', vis.values.PRODUCTION_APPROVAL_TOKEN || '', ''],
    ['VIS VISUAL_SQL_EXECUTOR_ENABLED', vis.values.VISUAL_SQL_EXECUTOR_ENABLED, 'false'],
    ['VIS GOOGLE_SHEETS_WEBHOOK_ACTION', vis.values.GOOGLE_SHEETS_WEBHOOK_ACTION, 'record-only'],
    ['VIS GOOGLE_SHEETS_WEBHOOK_LIVE_BACKGROUND', vis.values.GOOGLE_SHEETS_WEBHOOK_LIVE_BACKGROUND, 'false'],
    ['VIS CSV_DATE_ORDER', vis.values.CSV_DATE_ORDER, 'dmy'],
  ];

  for (const [label, actual, wanted] of expected) {
    if (String(actual ?? '') !== wanted) problems.push(`${label}: expected ${wanted}, got ${redactValue(label, actual ?? '')}`);
  }

  if (webhookPlan.nextSecretPresent !== nonBlank(vis.values.GSHEET_WEBHOOK_SECRET)) {
    problems.push(`VIS GSHEET_WEBHOOK_SECRET presence does not match webhook plan ${webhookPlan.action}`);
  }

  for (const [key, list] of Object.entries(cli.occurrences)) {
    if (MANAGED_CLI_KEYS.includes(key) && list.length !== 1) problems.push(`CLI ${key} appears ${list.length} times after staging`);
  }
  for (const [key, list] of Object.entries(vis.occurrences)) {
    if (MANAGED_VIS_KEYS.includes(key) && list.length !== 1) problems.push(`VIS ${key} appears ${list.length} times after staging`);
  }

  if (dateMode === 'iso' && cli.values.CSV_DATE_ORDER !== 'dmy') {
    problems.push('ISO mode still requires CSV_DATE_ORDER=dmy as safe fallback for any unexpected non-ISO value.');
  }

  if (cpanelMode) {
    try {
      validateCpanelPaths({
        cliEnvPath,
        visEnvPath,
        cliParsed: cli,
        visParsed: vis,
        cpanelHome,
        secretFile,
        reportPath,
      });
    } catch (error) {
      if (error instanceof SanitizerError) problems.push(...(error.details?.problems || [error.message]));
      else throw error;
    }
  }

  if (problems.length) {
    throw new SanitizerError('Staged environment validation failed.', 'STAGED_ENV_VALIDATION_FAILED', { problems });
  }

  return { cli, vis, ok: true };
}

function ensureParentDirectory(filePath, mode = 0o700) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode });
}

function writeStage(targetPath, content, mode = 0o600) {
  ensureParentDirectory(targetPath, 0o700);
  const stage = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.v323v2.${process.pid}.${crypto.randomBytes(6).toString('hex')}.stage`
  );
  fs.writeFileSync(stage, content, { encoding: 'utf8', mode });
  fs.chmodSync(stage, mode);
  return stage;
}

function backupFile(targetPath, stamp) {
  const backup = `${targetPath}.pre-${VERSION}.${stamp}.bak`;
  fs.copyFileSync(targetPath, backup);
  fs.chmodSync(backup, 0o600);
  return backup;
}

function safeUnlink(filePath) {
  try { if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
}

function restoreFileFromBuffer(targetPath, originalBuffer, originalMode) {
  ensureParentDirectory(targetPath, 0o700);
  const temp = writeStage(targetPath, originalBuffer.toString('utf8'), originalMode || 0o600);
  fs.renameSync(temp, targetPath);
  fs.chmodSync(targetPath, originalMode || 0o600);
}

function commitTransaction({ cliEnvPath, visEnvPath, cliStage, visStage, secretFile, secretStage, webhookPlan, reportPath, reportObject }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const original = {
    cli: fs.readFileSync(cliEnvPath),
    vis: fs.readFileSync(visEnvPath),
    cliMode: fs.statSync(cliEnvPath).mode & 0o777,
    visMode: fs.statSync(visEnvPath).mode & 0o777,
    secretExists: fs.existsSync(secretFile),
    secret: fs.existsSync(secretFile) ? fs.readFileSync(secretFile) : null,
    secretMode: fs.existsSync(secretFile) ? (fs.statSync(secretFile).mode & 0o777) : null,
  };

  const backups = {
    cli: backupFile(cliEnvPath, stamp),
    vis: backupFile(visEnvPath, stamp),
    secret: null,
  };
  if (original.secretExists) {
    backups.secret = `${secretFile}.pre-${VERSION}.${stamp}.bak`;
    ensureParentDirectory(backups.secret, 0o700);
    fs.copyFileSync(secretFile, backups.secret);
    fs.chmodSync(backups.secret, 0o600);
  }

  let committedCli = false;
  let committedVis = false;
  let committedSecret = false;

  try {
    fs.renameSync(cliStage, cliEnvPath);
    fs.chmodSync(cliEnvPath, 0o600);
    committedCli = true;

    fs.renameSync(visStage, visEnvPath);
    fs.chmodSync(visEnvPath, 0o600);
    committedVis = true;

    if (webhookPlan.generateNewSecret) {
      fs.renameSync(secretStage, secretFile);
      fs.chmodSync(secretFile, 0o600);
      committedSecret = true;
    } else if (webhookPlan.action === 'disable') {
      if (fs.existsSync(secretFile)) fs.unlinkSync(secretFile);
      committedSecret = true;
    }

    ensureParentDirectory(reportPath, 0o700);
    fs.writeFileSync(reportPath, JSON.stringify(reportObject, null, 2) + '\n', { mode: 0o600 });
    fs.chmodSync(reportPath, 0o600);

    const rollback = () => {
      const rollbackErrors = [];
      try { restoreFileFromBuffer(cliEnvPath, original.cli, original.cliMode); } catch (e) { rollbackErrors.push(`CLI rollback: ${e.message}`); }
      try { restoreFileFromBuffer(visEnvPath, original.vis, original.visMode); } catch (e) { rollbackErrors.push(`VIS rollback: ${e.message}`); }
      try {
        if (original.secretExists) {
          ensureParentDirectory(secretFile, 0o700);
          fs.writeFileSync(secretFile, original.secret, { mode: original.secretMode || 0o600 });
          fs.chmodSync(secretFile, original.secretMode || 0o600);
        } else {
          safeUnlink(secretFile);
        }
      } catch (e) { rollbackErrors.push(`Secret rollback: ${e.message}`); }
      safeUnlink(reportPath);
      return rollbackErrors;
    };

    return { backups, committed: true, rollback };
  } catch (error) {
    const rollbackErrors = [];
    try { if (committedCli || !fs.existsSync(cliEnvPath)) restoreFileFromBuffer(cliEnvPath, original.cli, original.cliMode); } catch (e) { rollbackErrors.push(`CLI rollback: ${e.message}`); }
    try { if (committedVis || !fs.existsSync(visEnvPath)) restoreFileFromBuffer(visEnvPath, original.vis, original.visMode); } catch (e) { rollbackErrors.push(`VIS rollback: ${e.message}`); }
    try {
      if (original.secretExists) {
        ensureParentDirectory(secretFile, 0o700);
        fs.writeFileSync(secretFile, original.secret, { mode: original.secretMode || 0o600 });
        fs.chmodSync(secretFile, original.secretMode || 0o600);
      } else {
        safeUnlink(secretFile);
      }
    } catch (e) { rollbackErrors.push(`Secret rollback: ${e.message}`); }
    safeUnlink(cliStage);
    safeUnlink(visStage);
    safeUnlink(secretStage);

    throw new SanitizerError(
      `Sanitization transaction failed and rollback was attempted: ${error.message}`,
      'TRANSACTION_FAILED',
      { rollbackErrors, backups }
    );
  }
}

function buildReport({ args, cliEnvPath, visEnvPath, freeze, inheritedEnv, pathValidation, visIsolation, datePolicy, webhookPlan, before, after, changes, dryRun, reportPath }) {
  return {
    report_version: VERSION,
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    mode: args.mode || 'cpanel',
    operator_notice: [
      'This script cannot modify parent-shell environment variables.',
      'This script cannot modify cPanel Setup Node.js App environment variables.',
      'After success, separately verify cPanel Node App variables do not re-enable production writes or inject an approval token/run ID.',
    ],
    cli_env: {
      path: cliEnvPath,
      before_sha256: before.cliSha256,
      planned_or_after_sha256: after.cliSha256,
      changes: changes.cli,
    },
    vis_env: {
      path: visEnvPath,
      before_sha256: before.visSha256,
      planned_or_after_sha256: after.visSha256,
      changes: changes.vis,
    },
    inherited_process_environment: inheritedEnv,
    source_freeze: freeze,
    date_policy: datePolicy,
    webhook: {
      action: webhookPlan.action,
      current_secret_present: webhookPlan.currentSecretPresent,
      next_secret_present: webhookPlan.nextSecretPresent,
      secret_value_reported: false,
    },
    cpanel_path_validation: pathValidation,
    vis_write_isolation: visIsolation,
    required_post_state: {
      allow_production_db: false,
      backup_confirmed: false,
      production_approval_token_blank: true,
      approved_dry_run_id_blank: true,
      visual_sql_executor_enabled: false,
      google_sheets_webhook_action: 'record-only',
      google_sheets_webhook_live_background: false,
      csv_date_order: 'dmy',
      source_freeze_verified_count: 9,
      vis_write_isolation_active: true,
    },
    report_path: dryRun ? null : reportPath,
  };
}

function verifyPostState({ cliEnvPath, visEnvPath, freezeDir, visRoot, webhookPlan, secretFile, mode, cpanelHome, reportPath }) {
  const cliText = fs.readFileSync(cliEnvPath, 'utf8');
  const visText = fs.readFileSync(visEnvPath, 'utf8');
  const cli = parseEnvText(cliText);
  const vis = parseEnvText(visText);
  const freeze = verifyFreeze(freezeDir);
  const visIsolation = verifyVisWriteIsolation(visRoot);

  validateStagedEnvs({
    cliText,
    visText,
    dateMode: 'dmy',
    webhookPlan,
    cpanelMode: mode === 'cpanel',
    cpanelHome,
    cliEnvPath,
    visEnvPath,
    secretFile,
    reportPath,
  });

  if (webhookPlan.nextSecretPresent) {
    if (!fs.existsSync(secretFile)) throw new SanitizerError('Expected protected webhook secret file is missing.', 'POSTCHECK_SECRET_MISSING');
    const modeBits = fs.statSync(secretFile).mode & 0o777;
    if (modeBits !== 0o600) throw new SanitizerError(`Webhook secret file mode must be 600, got ${modeBits.toString(8)}`, 'POSTCHECK_SECRET_MODE');
  }

  return {
    ok: true,
    cli_env_sha256: sha256File(cliEnvPath),
    vis_env_sha256: sha256File(visEnvPath),
    allow_production_db: cli.values.ALLOW_PRODUCTION_DB === 'false' && vis.values.ALLOW_PRODUCTION_DB === 'false',
    backup_confirmed: cli.values.BACKUP_CONFIRMED === 'false' && vis.values.BACKUP_CONFIRMED === 'false',
    production_approval_token_blank: !nonBlank(cli.values.PRODUCTION_APPROVAL_TOKEN) && !nonBlank(vis.values.PRODUCTION_APPROVAL_TOKEN),
    approved_dry_run_id_blank: !nonBlank(cli.values.APPROVED_DRY_RUN_ID),
    visual_sql_executor_enabled: vis.values.VISUAL_SQL_EXECUTOR_ENABLED === 'true',
    google_sheets_webhook_action: vis.values.GOOGLE_SHEETS_WEBHOOK_ACTION,
    google_sheets_webhook_live_background: vis.values.GOOGLE_SHEETS_WEBHOOK_LIVE_BACKGROUND,
    csv_date_order_cli: cli.values.CSV_DATE_ORDER,
    csv_date_order_vis: vis.values.CSV_DATE_ORDER,
    source_freeze_verified_count: freeze.verifiedCount,
    vis_write_isolation_active: visIsolation.ok,
    webhook_secret_file_present: fs.existsSync(secretFile),
    webhook_secret_file_mode: fs.existsSync(secretFile) ? (fs.statSync(secretFile).mode & 0o777).toString(8) : null,
  };
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.h) {
    process.stdout.write(helpText());
    return;
  }

  const dryRun = Boolean(args['dry-run']);
  const mode = String(args.mode || 'cpanel').toLowerCase();
  const dateMode = String(args['date-mode'] || 'dmy').toLowerCase();
  if (!['cpanel', 'generic'].includes(mode)) throw new SanitizerError(`Unsupported --mode=${mode}`, 'ARGUMENT_ERROR');
  if (!['dmy', 'iso'].includes(dateMode)) throw new SanitizerError(`Unsupported --date-mode=${dateMode}`, 'ARGUMENT_ERROR');

  const cliEnvPath = requireExistingFile(args['cli-env'], 'CLI .env');
  const visEnvPath = requireExistingFile(args['vis-env'], 'VIS .env');
  const freezeDir = requireExistingDir(args['freeze-dir'], 'Source freeze directory');
  const secretFile = path.resolve(args['webhook-secret-file'] || '');
  if (!args['webhook-secret-file']) throw new SanitizerError('Missing --webhook-secret-file=PATH', 'ARGUMENT_ERROR');

  const cpanelHome = path.resolve(args['cpanel-home'] || inferCpanelHome(cliEnvPath));
  const defaultReport = path.join(cpanelHome, 'v323_preflight_evidence', `sanitize_cpanel_env_v323_v2_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const reportPath = path.resolve(args.report || defaultReport);
  const visRoot = path.dirname(visEnvPath);

  // Gate 1: inherited process environment must already be safe.
  const inheritedEnv = checkInheritedEnvironment();

  // Gate 2: immutable freeze must be 9/9 intact.
  const freeze = verifyFreeze(freezeDir);

  // Gate 3: VIS code must enforce write isolation regardless of .env.
  const visIsolation = verifyVisWriteIsolation(visRoot);

  const cliOriginal = fs.readFileSync(cliEnvPath, 'utf8');
  const visOriginal = fs.readFileSync(visEnvPath, 'utf8');
  const cliParsed = parseEnvText(cliOriginal);
  const visParsed = parseEnvText(visOriginal);

  const pathValidation = mode === 'cpanel'
    ? validateCpanelPaths({ cliEnvPath, visEnvPath, cliParsed, visParsed, cpanelHome, secretFile, reportPath })
    : { home: cpanelHome, checks: [], problems: [], skipped: true };

  let isoProof = null;
  if (dateMode === 'iso') {
    if (!args['iso-proof']) throw new SanitizerError('--date-mode=iso requires --iso-proof=PATH', 'ISO_PROOF_REQUIRED');
    isoProof = validateIsoProof(args['iso-proof'], freeze);
  }
  const datePolicy = {
    mode: dateMode,
    csv_date_order_required: 'dmy',
    rationale: dateMode === 'dmy'
      ? 'Current frozen source baseline contains ambiguous numeric dates; DMY is required to match the rehearsed source semantics.'
      : 'Certified source is claimed ISO-normalized; proof is required. CSV_DATE_ORDER remains DMY as a safe fallback for any unexpected non-ISO value.',
    iso_proof: isoProof,
  };

  const webhookPlan = determineWebhookPlan({
    visValues: visParsed.values,
    enableWebhook: Boolean(args['enable-webhook']),
    disableWebhook: Boolean(args['disable-webhook']),
  });

  let nextWebhookSecret = '';
  if (webhookPlan.generateNewSecret) nextWebhookSecret = crypto.randomBytes(48).toString('base64');

  const cliUpdates = {
    ALLOW_PRODUCTION_DB: 'false',
    BACKUP_CONFIRMED: 'false',
    APPROVED_DRY_RUN_ID: '',
    PRODUCTION_APPROVAL_TOKEN: '',
    CSV_DATE_ORDER: 'dmy',
  };

  const visUpdates = {
    VISUAL_SQL_EXECUTOR_ENABLED: 'false',
    GOOGLE_SHEETS_WEBHOOK_ACTION: 'record-only',
    GOOGLE_SHEETS_WEBHOOK_LIVE_BACKGROUND: 'false',
    ALLOW_PRODUCTION_DB: 'false',
    BACKUP_CONFIRMED: 'false',
    PRODUCTION_APPROVAL_TOKEN: '',
    CSV_DATE_ORDER: 'dmy',
    GSHEET_WEBHOOK_SECRET: webhookPlan.nextSecretPresent
      ? (webhookPlan.generateNewSecret ? nextWebhookSecret : visParsed.values.GSHEET_WEBHOOK_SECRET)
      : '',
  };

  // Deduplicate known path keys too, retaining their current value. This removes
  // harmless duplicate definitions without silently rewriting paths.
  const cliNext = canonicalizeEnv(cliOriginal, cliUpdates, CLI_PATH_KEYS);
  const visNext = canonicalizeEnv(visOriginal, visUpdates, VIS_PATH_KEYS);

  validateStagedEnvs({
    cliText: cliNext,
    visText: visNext,
    dateMode,
    webhookPlan,
    cliPathKeys: CLI_PATH_KEYS,
    visPathKeys: VIS_PATH_KEYS,
    cpanelMode: mode === 'cpanel',
    cpanelHome,
    cliEnvPath,
    visEnvPath,
    secretFile,
    reportPath,
  });

  const before = { cliSha256: sha256Text(cliOriginal), visSha256: sha256Text(visOriginal) };
  const after = { cliSha256: sha256Text(cliNext), visSha256: sha256Text(visNext) };
  const changes = {
    cli: diffManaged(cliOriginal, cliNext, [...MANAGED_CLI_KEYS, ...CLI_PATH_KEYS]),
    vis: diffManaged(visOriginal, visNext, [...MANAGED_VIS_KEYS, ...VIS_PATH_KEYS]),
  };

  const report = buildReport({
    args: { ...args, mode },
    cliEnvPath,
    visEnvPath,
    freeze,
    inheritedEnv,
    pathValidation,
    visIsolation,
    datePolicy,
    webhookPlan,
    before,
    after,
    changes,
    dryRun,
    reportPath,
  });

  if (dryRun) {
    process.stdout.write(JSON.stringify({
      ok: true,
      version: VERSION,
      dryRun: true,
      message: 'Dry run only: no files, secrets, backups, or reports were written.',
      operatorReminder: 'cPanel Setup Node.js App environment variables are outside this script and must be checked manually.',
      plan: report,
    }, null, 2) + '\n');
    return;
  }

  let cliStage = null;
  let visStage = null;
  let secretStage = null;
  try {
    cliStage = writeStage(cliEnvPath, cliNext, 0o600);
    visStage = writeStage(visEnvPath, visNext, 0o600);
    if (webhookPlan.generateNewSecret) {
      secretStage = writeStage(secretFile, `${nextWebhookSecret}\n`, 0o600);
    }

    // Re-read staged files from disk and validate before replacing originals.
    validateStagedEnvs({
      cliText: fs.readFileSync(cliStage, 'utf8'),
      visText: fs.readFileSync(visStage, 'utf8'),
      dateMode,
      webhookPlan,
      cliPathKeys: CLI_PATH_KEYS,
      visPathKeys: VIS_PATH_KEYS,
      cpanelMode: mode === 'cpanel',
      cpanelHome,
      cliEnvPath,
      visEnvPath,
      secretFile,
      reportPath,
    });

    const transaction = commitTransaction({
      cliEnvPath,
      visEnvPath,
      cliStage,
      visStage,
      secretFile,
      secretStage,
      webhookPlan,
      reportPath,
      reportObject: report,
    });

    let post;
    try {
      post = verifyPostState({
        cliEnvPath,
        visEnvPath,
        freezeDir,
        visRoot,
        webhookPlan,
        secretFile,
        mode,
        cpanelHome,
        reportPath,
      });

      // Rewrite the report with post-verification and backup locations; still redacted.
      const finalReport = {
        ...report,
        transaction: {
          committed: true,
          backups: transaction.backups,
        },
        post_verification: post,
        final_status: 'PASS',
      };
      fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2) + '\n', { mode: 0o600 });
      fs.chmodSync(reportPath, 0o600);
    } catch (error) {
      const rollbackErrors = transaction.rollback();
      throw new SanitizerError(
        `Post-commit verification/report finalization failed; transaction was rolled back: ${error.message}`,
        'POST_COMMIT_VERIFICATION_FAILED',
        { rollbackErrors, originalCode: error.code || null }
      );
    }

    process.stdout.write(JSON.stringify({
      ok: true,
      version: VERSION,
      dryRun: false,
      mode,
      sourceFreezeVerified: true,
      frozenFilesVerified: freeze.verifiedCount,
      dateMode,
      csvDateOrder: 'dmy',
      webhookAction: webhookPlan.action,
      webhookSecretPrinted: false,
      productionWritesEnabled: false,
      productionApprovalTokenClearedInEnvFiles: true,
      approvedDryRunIdClearedInCliEnv: true,
      visSqlExecutorEnabled: false,
      visWriteIsolationActive: true,
      reportPath,
      backups: transaction.backups,
      operatorReminder: [
        'This script did NOT and cannot modify parent-shell variables.',
        'This script did NOT and cannot modify cPanel Setup Node.js App environment variables.',
        'Verify those external environments before starting either Node application or any migration command.',
      ],
      postVerification: post,
    }, null, 2) + '\n');
  } finally {
    safeUnlink(cliStage);
    safeUnlink(visStage);
    safeUnlink(secretStage);
  }
}

try {
  main();
} catch (error) {
  const payload = {
    ok: false,
    version: VERSION,
    code: error.code || 'UNEXPECTED_ERROR',
    message: error.message || String(error),
    details: error.details || undefined,
    operatorReminder: [
      'No production migration should be attempted after sanitizer failure.',
      'This script cannot modify parent-shell or cPanel Setup Node.js App environment variables.',
    ],
  };
  process.stderr.write(JSON.stringify(payload, null, 2) + '\n');
  process.exit(1);
}
