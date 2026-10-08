'use strict';
const fs = require('fs');
const path = require('path');
const MiB = 1024 * 1024;
const cycleName = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;
function settings(env = {}) {
  const number = (key, fallback) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isSafeInteger(n) || n < 1) throw Error('Invalid positive integer: ' + key);
    return n;
  };
  const config = {
    cycles: number('SYNC_KEEP_CYCLES', 2), backups: number('SYNC_KEEP_BACKUPS', 2),
    maxBytes: number('SYNC_MAX_DATA_MB', 4096) * MiB,
    reserveBytes: number('SYNC_RUN_RESERVE_MB', 1024) * MiB,
    minFreeBytes: number('SYNC_MIN_FREE_MB', 2048) * MiB,
    logBytes: number('SYNC_LOG_MAX_MB', 5) * MiB,
    logFiles: number('SYNC_LOG_KEEP', 3)
  };
  if (config.reserveBytes >= config.maxBytes) throw Error('Run reserve must be smaller than sync budget');
  return config;
}
function readJson(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null; }
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temporary = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}
// Reject links, including junctions, before traversing or deleting anything.
function size(root) {
  let st;
  try {st = fs.lstatSync(root);} catch (e) {if(e.code === 'ENOENT')return 0;throw e;}
  if (st.isSymbolicLink()) throw Error('Refusing linked storage path: ' + root);
  if (!st.isDirectory()) return st.size;
  let bytes = 0;
  let entries;
  try {entries = fs.readdirSync(root);} catch (e) {if(e.code === 'ENOENT')return 0;throw e;}
  for (const entry of entries) bytes += size(path.join(root, entry));
  return bytes;
}
function contained(root, target) {
  const base = fs.realpathSync(root), resolved = fs.realpathSync(target);
  if (!resolved.startsWith(base + path.sep)) throw Error('Storage path escapes its parent');
  size(target); // Recursively reject nested junctions before recursive removal.
  return resolved;
}
function scan(root) {
  const bytes = size(root);
  if (!fs.statfsSync) throw Error('Storage guard requires Node 18.15 or newer');
  const st = fs.statfsSync(root);
  return {bytes, freeBytes: Number(st.bavail) * Number(st.bsize)};
}
function assertCapacity(root, config, reserve = 0) {
  const measurement = scan(root);
  if (measurement.bytes + reserve > config.maxBytes) throw Error('Sync storage budget exceeded; retain recovery evidence and free space or increase SYNC_MAX_DATA_MB');
  if (measurement.freeBytes < config.minFreeBytes + reserve) throw Error('Insufficient free disk space for sync reserve');
  return measurement;
}
// Only call while holding this database's advisory lock. Unknown files and
// durable verification evidence are measured but never automatically removed.
function cleanup(root, config, {current, extraProtected = [], reserve = 0} = {}) {
  const beforeBytes = size(root), removed = [];
  const pending = readJson(path.join(root, 'pending.json'));
  const status = readJson(path.join(root, 'status.json'));
  const protect = new Set([current, pending?.cycle, status?.cycle, ...extraProtected].filter(Boolean).map(p => path.resolve(p)));
  const base = path.join(root, 'cycles');
  const cycles = fs.existsSync(base) ? fs.readdirSync(base).filter(n => cycleName.test(n)).sort().map(n => path.join(base, n)) : [];
  if (fs.existsSync(base)) contained(root, base);
  for (const cycle of cycles) contained(base, cycle);
  const backupDir = path.join(root, 'backups');
  if (fs.existsSync(backupDir)) contained(root, backupDir);
  const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(n => /^before_sync_\d{4}-\d{2}-\d{2}T[\dZ-]+\.sql\.gz$/.test(n)).sort().map(n => path.join(backupDir, n)) : [];
  const protectedBackups = new Set([pending?.backupFile, status?.backupFile, ...backups.slice(-config.backups)].filter(Boolean).map(p => path.resolve(p)));
  // Old pending format does not name its backup: keep every backup until resumed.
  if (pending && !pending.backupFile) backups.forEach(p => protectedBackups.add(path.resolve(p)));
  const remove = (file, parent) => {
    const resolved = contained(parent, file);
    fs.rmSync(resolved, {recursive: fs.lstatSync(resolved).isDirectory()});
    removed.push(path.relative(root, file));
  };
  // A partial dump was never accepted as a backup. No writer can be active
  // while the caller holds the sync lock.
  if (fs.existsSync(backupDir)) for (const name of fs.readdirSync(backupDir)) {
    if (/^before_sync_\d{4}-\d{2}-\d{2}T[\dZ-]+\.sql\.gz\.partial$/.test(name)) remove(path.join(backupDir, name), backupDir);
  }
  const legacyLogs = path.join(root, 'scheduler_logs');
  if (fs.existsSync(legacyLogs)) {
    contained(root, legacyLogs);
    const logs = fs.readdirSync(legacyLogs).filter(n => /^\d{4}-\d{2}-\d{2}\.log$/.test(n)).sort();
    for (const name of logs.slice(0, Math.max(0, logs.length - config.logFiles))) remove(path.join(legacyLogs, name), legacyLogs);
  }
  for (const file of backups) if (!protectedBackups.has(path.resolve(file))) remove(file, backupDir);
  // Pending/current/status always win over count and byte limits.
  for (const cycle of cycles.slice(0, Math.max(0, cycles.length - config.cycles))) if (!protect.has(path.resolve(cycle))) remove(cycle, base);
  let bytes = size(root);
  for (const cycle of cycles) {
    if (bytes + reserve <= config.maxBytes) break;
    if (protect.has(path.resolve(cycle)) || !fs.existsSync(cycle)) continue;
    remove(cycle, base); bytes = size(root);
  }
  const report = {at: new Date().toISOString(), beforeBytes, afterBytes: bytes, reclaimedBytes: beforeBytes - bytes, removed, protectedCycles: [...protect]};
  writeJson(path.join(root, 'cleanup-report.json'), report);
  if (removed.length) writeJson(path.join(root, 'last-pruned.json'), report);
  return report;
}
function appendLog(file, data, config) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  let offset = 0;
  while (offset < buffer.length) {
    let n = fs.existsSync(file) ? fs.statSync(file).size : 0;
    if (n >= config.logBytes) {
      for (let i = config.logFiles; i >= 1; i--) {
        const source = i === 1 ? file : file + '.' + (i - 1), dest = file + '.' + i;
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        if (fs.existsSync(source)) fs.renameSync(source, dest);
      }
      n = 0;
    }
    const end = Math.min(buffer.length, offset + config.logBytes - n);
    fs.appendFileSync(file, buffer.subarray(offset, end)); offset = end;
  }
}
module.exports = {settings, readJson, writeJson, size, scan, assertCapacity, cleanup, appendLog, contained};
