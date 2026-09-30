'use strict';

const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  if (!rows || rows.length === 0) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  return [headers.map(csvEscape).join(','), ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(','))].join('\n') + '\n';
}

class PreviewWriter {
  constructor({ rootDir, runId, meta = {} }) {
    this.runId = runId;
    this.rootDir = path.resolve(rootDir);
    this.runDir = path.join(this.rootDir, runId);
    this.meta = meta;
    this.records = [];
    this.rejectedRows = [];
    this.tableStats = {};
    ensureDir(this.runDir);
  }

  addRecord(record) {
    this.records.push(record);
  }

  addRejected(row) {
    this.rejectedRows.push(row);
  }

  bump(table, key, amount = 1) {
    this.tableStats[table] ||= {
      candidate: 0,
      valid: 0,
      rejected: 0,
      inserted: 0,
      updated: 0,
      deleted: 0,
      unchanged: 0,
      rolledBack: 0,
    };
    this.tableStats[table][key] = (this.tableStats[table][key] || 0) + amount;
  }

  writeStatus(status) {
    const payload = { runId: this.runId, updatedAt: new Date().toISOString(), ...status };
    const temp = path.join(this.runDir, 'status.json.tmp');
    const target = path.join(this.runDir, 'status.json');
    fs.writeFileSync(temp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(temp, target);
    return target;
  }

  finalize(extra = {}) {
    const generatedAt = new Date().toISOString();
    const preview = {
      runId: this.runId,
      generatedAt,
      ...this.meta,
      ...extra,
      tableStats: this.tableStats,
      records: this.records,
      rejectedRows: this.rejectedRows,
    };
    const previewPath = path.join(this.runDir, 'preview.json');
    const summaryPath = path.join(this.runDir, 'summary.csv');
    const rejectedPath = path.join(this.runDir, 'rejected_rows.csv');
    fs.writeFileSync(previewPath, JSON.stringify(preview, null, 2), 'utf8');
    const summaryRows = Object.entries(this.tableStats).map(([table, stat]) => ({ table, ...stat }));
    fs.writeFileSync(summaryPath, rowsToCsv(summaryRows), 'utf8');
    fs.writeFileSync(rejectedPath, rowsToCsv(this.rejectedRows), 'utf8');
    return { runDir: this.runDir, previewPath, summaryPath, rejectedPath };
  }
}

module.exports = { PreviewWriter, rowsToCsv };
