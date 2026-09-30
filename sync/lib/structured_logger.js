'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const contextStorage = new AsyncLocalStorage();
const LEVELS = Object.freeze({ trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 });
const SECRET_KEY_RE = /(?:pass(?:word)?|secret|token|authorization|cookie|session|api[_-]?key|private[_-]?key|client[_-]?secret|webhook[_-]?secret|db[_-]?password|credentials?)/i;
const DEFAULT_SECRET_ENV_RE = /(?:PASS(?:WORD)?|SECRET|TOKEN|API[_-]?KEY|PRIVATE[_-]?KEY|AUTH|COOKIE|SESSION|CREDENTIAL)/i;
const processHandlerRegistry = new Set();

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function intEnv(name, fallback, min = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(min, Math.trunc(value)) : fallback;
}

function normalizeLevel(level, fallback = 'info') {
  const value = String(level || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(LEVELS, value) ? value : fallback;
}

function dateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function safeName(value, fallback = 'application') {
  const normalized = String(value || fallback).replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function collectSecretValues(extraSecrets = []) {
  const values = new Set();
  for (const [key, value] of Object.entries(process.env)) {
    if (!DEFAULT_SECRET_ENV_RE.test(key) || value === undefined || value === null) continue;
    const text = String(value);
    if (text.length >= 4) values.add(text);
  }
  for (const value of extraSecrets || []) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (text.length >= 4) values.add(text);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

function redactText(input, secretValues = []) {
  if (input === undefined || input === null) return input;
  let text = String(input);
  for (const secret of secretValues) {
    if (!secret || secret === '[REDACTED]') continue;
    text = text.split(secret).join('[REDACTED]');
  }
  return text
    .replace(/(authorization\s*[:=]\s*)(?:basic|bearer)\s+[^\s,;]+/ig, '$1[REDACTED]')
    .replace(/((?:password|passwd|pwd|secret|token|api[_-]?key|private[_-]?key|client[_-]?secret|webhook[_-]?secret)\s*[:=]\s*)[^\s,;]+/ig, '$1[REDACTED]')
    .replace(/("(?:password|passwd|pwd|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|client[_-]?secret)"\s*:\s*")[^"]*(")/ig, '$1[REDACTED]$2')
    .replace(/(mysql:\/\/[^:\s/]+:)[^@\s/]+(@)/ig, '$1[REDACTED]$2')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}

function serializeError(error, secretValues = [], depth = 0) {
  if (!error) return null;
  if (!(error instanceof Error) && typeof error !== 'object') return redactText(String(error), secretValues);
  const out = {
    name: error.name || 'Error',
    message: redactText(error.message || String(error), secretValues),
    stack: redactText(error.stack || '', secretValues),
  };
  for (const key of ['code', 'errno', 'syscall', 'address', 'port', 'status', 'statusCode', 'sqlState', 'sqlMessage']) {
    if (error[key] !== undefined) out[key] = redactValue(error[key], { secretValues, depth: depth + 1 });
  }
  if (error.cause && depth < 3) out.cause = serializeError(error.cause, secretValues, depth + 1);
  return out;
}

function redactValue(value, options = {}) {
  const {
    secretValues = [],
    depth = 0,
    maxDepth = intEnv('LOG_MAX_OBJECT_DEPTH', 7, 1),
    maxStringLength = intEnv('LOG_MAX_STRING_LENGTH', 12000, 256),
    maxArrayLength = intEnv('LOG_MAX_ARRAY_LENGTH', 100, 10),
    seen = new WeakSet(),
    key = '',
  } = options;

  if (SECRET_KEY_RE.test(String(key))) return '[REDACTED]';
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') {
    const redacted = redactText(value, secretValues);
    return redacted.length > maxStringLength ? `${redacted.slice(0, maxStringLength)}…[truncated ${redacted.length - maxStringLength} chars]` : redacted;
  }
  if (value instanceof Error) return serializeError(value, secretValues, depth);
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes sha256=${crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)}>`;
  if (value instanceof Date) return value.toISOString();
  if (depth >= maxDepth) return '[MaxDepth]';
  if (typeof value !== 'object') return redactText(String(value), secretValues);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const out = value.slice(0, maxArrayLength).map((item) => redactValue(item, { ...options, secretValues, depth: depth + 1, seen, key: '' }));
    if (value.length > maxArrayLength) out.push(`[Truncated ${value.length - maxArrayLength} items]`);
    return out;
  }
  const out = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    out[childKey] = redactValue(childValue, { ...options, secretValues, depth: depth + 1, seen, key: childKey });
  }
  return out;
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_error) {}
}

function appendPrivate(filePath, content) {
  ensurePrivateDir(path.dirname(filePath));
  fs.appendFileSync(filePath, content, { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(filePath, 0o600); } catch (_error) {}
}

function segmentPath(logDir, prefix, suffix, maxBytes) {
  const base = path.join(logDir, `${prefix}-${dateKey()}${suffix}`);
  try {
    if (!fs.existsSync(base) || fs.statSync(base).size < maxBytes) return base;
  } catch (_error) { return base; }
  for (let part = 1; part <= 9999; part += 1) {
    const candidate = path.join(logDir, `${prefix}-${dateKey()}.${part}${suffix}`);
    try {
      if (!fs.existsSync(candidate) || fs.statSync(candidate).size < maxBytes) return candidate;
    } catch (_error) { return candidate; }
  }
  return path.join(logDir, `${prefix}-${dateKey()}.${process.pid}.${Date.now()}${suffix}`);
}

function cleanupOldFiles(logDir, prefix, retentionDays) {
  if (!retentionDays || retentionDays < 1) return;
  const cutoff = Date.now() - retentionDays * 86400000;
  try {
    for (const name of fs.readdirSync(logDir)) {
      if (!name.startsWith(`${prefix}-`)) continue;
      const full = path.join(logDir, name);
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) fs.unlinkSync(full);
    }
  } catch (_error) {}
}

function createLogger(options = {}) {
  const app = safeName(options.app || process.env.LOG_APP_NAME || 'application');
  const component = safeName(options.component || 'main');
  const logDir = path.resolve(options.logDir || process.env.APP_LOG_DIR || path.join(process.cwd(), 'logs'));
  const filePrefix = safeName(options.filePrefix || app);
  const minLevel = normalizeLevel(options.level || process.env.LOG_LEVEL || 'info');
  const maxBytes = Math.max(1024 * 1024, Number(options.maxBytes || intEnv('LOG_MAX_FILE_BYTES', 25 * 1024 * 1024, 1024 * 1024)));
  const retentionDays = Math.max(1, Number(options.retentionDays || intEnv('LOG_RETENTION_DAYS', 30, 1)));
  const humanReadable = options.humanReadable !== undefined ? Boolean(options.humanReadable) : boolEnv('LOG_HUMAN_READABLE', true);
  const stderrMirror = options.stderrMirror !== undefined ? Boolean(options.stderrMirror) : boolEnv('LOG_STDERR_MIRROR', false);
  const secretValues = collectSecretValues(options.extraSecrets || []);
  const baseContext = redactValue(options.baseContext || {}, { secretValues });
  let lastCleanupAt = 0;

  ensurePrivateDir(logDir);
  cleanupOldFiles(logDir, filePrefix, retentionDays);

  function shouldLog(level) { return LEVELS[normalizeLevel(level)] >= LEVELS[minLevel]; }

  function write(level, event, message, meta = {}) {
    const normalized = normalizeLevel(level);
    if (!shouldLog(normalized)) return null;
    const requestContext = contextStorage.getStore() || {};
    const entry = {
      ts: new Date().toISOString(),
      level: normalized,
      app,
      component,
      event: safeName(event || 'log_event', 'log_event'),
      message: redactText(message === undefined ? '' : String(message), secretValues),
      pid: process.pid,
      ppid: process.ppid,
      hostname: os.hostname(),
      ...baseContext,
      ...redactValue(requestContext, { secretValues }),
      ...redactValue(meta || {}, { secretValues }),
    };
    const jsonLine = `${JSON.stringify(entry)}\n`;
    try {
      appendPrivate(segmentPath(logDir, filePrefix, '.jsonl', maxBytes), jsonLine);
      if (LEVELS[normalized] >= LEVELS.error) appendPrivate(segmentPath(logDir, `${filePrefix}-errors`, '.jsonl', maxBytes), jsonLine);
      if (humanReadable) {
        const ctx = [entry.requestId && `requestId=${entry.requestId}`, entry.runId && `runId=${entry.runId}`, entry.importer && `importer=${entry.importer}`].filter(Boolean).join(' ');
        const tail = meta && Object.keys(meta).length ? ` ${redactText(util.inspect(redactValue(meta, { secretValues }), { depth: 5, breakLength: 180, compact: true }), secretValues)}` : '';
        appendPrivate(segmentPath(logDir, filePrefix, '.log', maxBytes), `${entry.ts} ${normalized.toUpperCase().padEnd(5)} ${entry.event}${ctx ? ` ${ctx}` : ''} ${entry.message}${tail}\n`);
      }
      if (stderrMirror && LEVELS[normalized] >= LEVELS.error) process.stderr.write(jsonLine);
      if (Date.now() - lastCleanupAt > 3600000) {
        lastCleanupAt = Date.now();
        cleanupOldFiles(logDir, filePrefix, retentionDays);
        cleanupOldFiles(logDir, `${filePrefix}-errors`, retentionDays);
      }
    } catch (writeError) {
      try { process.stderr.write(`[LOGGER_WRITE_FAILURE] ${writeError.stack || writeError}\n`); } catch (_error) {}
    }
    return entry;
  }

  const logger = {
    app,
    component,
    logDir,
    filePrefix,
    level: minLevel,
    secretValues,
    trace: (event, message, meta) => write('trace', event, message, meta),
    debug: (event, message, meta) => write('debug', event, message, meta),
    info: (event, message, meta) => write('info', event, message, meta),
    warn: (event, message, meta) => write('warn', event, message, meta),
    error: (event, message, meta) => write('error', event, message, meta),
    fatal: (event, message, meta) => write('fatal', event, message, meta),
    log: write,
    child(extraContext = {}, childComponent = component) {
      return createLogger({ ...options, app, component: childComponent, logDir, filePrefix, level: minLevel, maxBytes, retentionDays, humanReadable, stderrMirror, extraSecrets: secretValues, baseContext: { ...baseContext, ...redactValue(extraContext, { secretValues }) } });
    },
    withContext(context, fn) { return contextStorage.run({ ...(contextStorage.getStore() || {}), ...redactValue(context || {}, { secretValues }) }, fn); },
    getContext() { return contextStorage.getStore() || {}; },
    serializeError: (error) => serializeError(error, secretValues),
    redact: (value) => redactValue(value, { secretValues }),
    redactText: (value) => redactText(value, secretValues),
    listFiles() {
      try {
        return fs.readdirSync(logDir).filter((name) => name.startsWith(`${filePrefix}-`)).map((name) => {
          const fullPath = path.join(logDir, name);
          const stat = fs.statSync(fullPath);
          return { name, path: fullPath, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
        }).sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      } catch (_error) { return []; }
    },
  };
  return logger;
}

function installConsoleBridge(logger, options = {}) {
  if (!logger || global.__IMPORT_MAPPER_CONSOLE_BRIDGE__) return;
  const originals = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const echo = options.echo !== undefined ? Boolean(options.echo) : true;
  const map = { log: 'info', info: 'info', warn: 'warn', error: 'error', debug: 'debug' };
  for (const method of Object.keys(originals)) {
    console[method] = (...args) => {
      const text = util.format(...args);
      logger[map[method]](`console_${method}`, text, {});
      if (echo) originals[method].apply(console, args);
    };
  }
  global.__IMPORT_MAPPER_CONSOLE_BRIDGE__ = { originals };
}

function installProcessHandlers(logger, options = {}) {
  if (!logger) return;
  const key = `${logger.app}:${logger.component}:${logger.logDir}:${logger.filePrefix}`;
  if (processHandlerRegistry.has(key)) return;
  processHandlerRegistry.add(key);
  const exitOnUnhandled = options.exitOnUnhandled !== undefined ? Boolean(options.exitOnUnhandled) : boolEnv('LOG_EXIT_ON_UNHANDLED', true);
  process.on('warning', (warning) => logger.warn('process_warning', warning.message, { error: warning }));
  process.on('unhandledRejection', (reason) => {
    logger.fatal('unhandled_rejection', 'Unhandled promise rejection', { error: reason instanceof Error ? reason : new Error(util.inspect(reason)) });
    if (exitOnUnhandled) { process.exitCode = 1; setTimeout(() => process.exit(1), 50); }
  });
  process.on('uncaughtException', (error) => {
    logger.fatal('uncaught_exception', 'Uncaught exception', { error });
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 50);
  });
  let signalExitStarted = false;
  const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(signal, () => {
      logger.warn('process_signal', `Process received ${signal}`, { signal });
      if (signalExitStarted) return;
      signalExitStarted = true;
      process.exitCode = signalExitCodes[signal] || 1;
      setTimeout(() => process.exit(process.exitCode), 75);
    });
  }
}

function requestIdFrom(req) {
  const supplied = String(req?.headers?.['x-request-id'] || '').trim();
  if (/^[A-Za-z0-9_.:-]{8,128}$/.test(supplied)) return supplied;
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

function createHttpLoggingMiddleware(logger, options = {}) {
  const skip = typeof options.skip === 'function' ? options.skip : () => false;
  return function httpLoggingMiddleware(req, res, next) {
    const requestId = requestIdFrom(req);
    const started = process.hrtime.bigint();
    res.setHeader('X-Request-Id', requestId);
    logger.withContext({ requestId }, () => {
      if (!skip(req)) {
        logger.info('http_request_started', `${req.method} ${req.originalUrl || req.url}`, {
          method: req.method,
          path: req.path,
          query: req.query,
          ip: req.ip || req.socket?.remoteAddress,
          userAgent: req.headers['user-agent'] || '',
          contentLength: req.headers['content-length'] || null,
          referer: req.headers.referer || null,
        });
      }
      res.on('finish', () => {
        if (skip(req)) return;
        const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
        logger[level]('http_request_completed', `${req.method} ${req.originalUrl || req.url} -> ${res.statusCode}`, {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Number(durationMs.toFixed(3)),
          responseLength: res.getHeader('content-length') || null,
        });
      });
      next();
    });
  };
}

module.exports = {
  LEVELS,
  createLogger,
  installConsoleBridge,
  installProcessHandlers,
  createHttpLoggingMiddleware,
  serializeError,
  redactText,
  redactValue,
  collectSecretValues,
};
