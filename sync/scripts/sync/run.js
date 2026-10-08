'use strict';
// Supervisor stays responsive while the worker does synchronous processing.
const fs = require('fs'), path = require('path');
const {spawn} = require('child_process');
const storage = require('../../lib/sync_storage');
async function supervise(argv = process.argv.slice(2), options = {}) {
  const envArg = argv.find(a => a.startsWith('--env='));
  if (!envArg) throw Error('Specify a private --env=/path/.env.sync');
  const env = require('dotenv').parse(fs.readFileSync(path.resolve(envArg.slice(6))));
  const config = storage.settings(env);
  const root = path.resolve(env.SYNC_DATA_DIR || path.join(__dirname, '../../sync_data'));
  const child = spawn(process.execPath, [options.workerFile || path.join(__dirname, 'worker.js'), ...argv], {
    cwd: path.resolve(__dirname, '../..'), windowsHide: true,
    detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let owned = false, monitoring = false, stopping = false, timer, peakBytes = 0, minFreeBytes = Infinity, stoppedReason;
  let cycle;
  const descendants = new Set();
  const terminate = reason => {
    if (stopping) return;
    stopping = true; stoppedReason = reason;
    if (owned && monitoring) {
      // Ownership is acknowledged before work starts and retained until the
      // finish handshake. Record the stop before killing/releasing that lock.
      try {
        const status = storage.readJson(path.join(root, 'status.json')) || {};
        storage.writeJson(path.join(root, 'status.json'), {...status, status: 'failed', at: new Date().toISOString(), error: reason});
        storage.writeJson(path.join(root, 'storage-report.json'), {at: new Date().toISOString(), cycle: status.cycle || cycle,
          peakBytes, minFreeBytes, maxBytes: config.maxBytes, stoppedReason: reason});
      } catch {} // Disk-full errors must not prevent terminating our child.
    }
    if (process.platform === 'win32') {
      const fallback = () => {
        for (const pid of descendants) {try {process.kill(pid);} catch {}}
        child.kill();
      };
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
      killer.on('error', fallback);
      killer.on('close', code => {if (code !== 0) fallback();});
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
      const force = setTimeout(() => {try {process.kill(-child.pid, 'SIGKILL');} catch {}}, 3000); force.unref();
    }
  };
  const sample = () => {
    if (!monitoring || stopping) return;
    try {
      const s = storage.scan(root);
      peakBytes = Math.max(peakBytes, s.bytes); minFreeBytes = Math.min(minFreeBytes, s.freeBytes);
      if (s.bytes > config.maxBytes) terminate('Sync storage budget exceeded during run');
      else if (s.freeBytes < config.minFreeBytes) terminate('Free disk reserve exhausted during run');
    } catch (e) { terminate(e.message); }
  };
  child.on('message', message => {
    if (message.type === 'sync-child-start' && Number.isSafeInteger(message.pid) && message.pid > 0) {
      descendants.add(message.pid);
      if(stopping){try {process.kill(message.pid);} catch {}}
    } else if (message.type === 'sync-child-end') {
      descendants.delete(message.pid);
    } else if (message.type === 'storage-ready') {
      owned = true; monitoring = true; cycle = message.cycle;
      sample(); timer = setInterval(sample, options.intervalMs || 1000);
      if (!stopping) child.send({type: 'storage-start'});
    } else if (message.type === 'storage-finished') {
      // Acknowledge before the worker releases its database lock.
      sample(); monitoring = false; clearInterval(timer);
      if (!stopping) {
        storage.writeJson(path.join(root, 'storage-report.json'), {at: new Date().toISOString(), cycle: storage.readJson(path.join(root, 'status.json'))?.cycle || cycle,
          peakBytes, minFreeBytes, maxBytes: config.maxBytes, intervalMs: 1000, stoppedReason: null});
        child.send({type: 'storage-finished-ack'});
      }
    }
  });
  const log = data => {
    if (owned && monitoring) {
      try {storage.appendLog(path.join(root, 'logs', 'sync.log'), data, config);} catch (e) {terminate('Log write failed: ' + e.message);}
    }
    process.stdout.write(data);
  };
  child.stdout.on('data', log); child.stderr.on('data', log);
  const onSignal = () => terminate('Sync supervisor interrupted');
  process.once('SIGTERM', onSignal); process.once('SIGINT', onSignal);
  const code = await new Promise((resolve, reject) => {child.on('error', reject); child.on('close', code => resolve(code ?? 1));});
  clearInterval(timer); process.removeListener('SIGTERM', onSignal); process.removeListener('SIGINT', onSignal);
  if (stoppedReason) {
    // Shared status belongs to the lock holder; never overwrite another run.
    console.error(stoppedReason + '; pending recovery evidence was preserved.');
    return 1;
  }
  return code;
}
if (require.main === module) supervise().then(code => {process.exitCode = code;}).catch(e => {console.error(e.message);process.exitCode = 1;});
module.exports = {supervise};
