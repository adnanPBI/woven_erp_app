'use strict';

function safeJson(value) {
  if (value === undefined) return null;
  try { return JSON.stringify(value); } catch (_error) { return JSON.stringify({ serializationError: true }); }
}

async function safeExecute(handle, sql, params = [], onError = null) {
  if (!handle) return false;
  try {
    await handle.query(sql, params);
    return true;
  } catch (error) {
    if (onError) onError(error);
    return false;
  }
}

async function ensureAuditTables(pool, onError = null) {
  if (!pool) return false;
  const statements = [
    `CREATE TABLE IF NOT EXISTS import_runs (
      run_id VARCHAR(96) NOT NULL,
      mode ENUM('dry-run','live') NOT NULL,
      importer_scope VARCHAR(255) NULL,
      validation_mode VARCHAR(32) NOT NULL DEFAULT 'strict',
      status VARCHAR(32) NOT NULL DEFAULT 'running',
      source_files JSON NULL,
      stats JSON NULL,
      preview_path TEXT NULL,
      error_summary TEXT NULL,
      started_at DATETIME(3) NOT NULL,
      completed_at DATETIME(3) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (run_id),
      KEY idx_import_runs_status_started (status, started_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS import_row_audit (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_id VARCHAR(96) NOT NULL,
      importer_id VARCHAR(64) NOT NULL,
      dispo_number VARCHAR(50) NULL,
      source_row_number INT NULL,
      target_table VARCHAR(128) NULL,
      action VARCHAR(64) NULL,
      status VARCHAR(32) NOT NULL,
      candidate_count INT NOT NULL DEFAULT 0,
      valid_count INT NOT NULL DEFAULT 0,
      rejected_count INT NOT NULL DEFAULT 0,
      inserted_count INT NOT NULL DEFAULT 0,
      updated_count INT NOT NULL DEFAULT 0,
      deleted_count INT NOT NULL DEFAULT 0,
      message TEXT NULL,
      details JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_import_row_audit_run (run_id),
      KEY idx_import_row_audit_dispo (dispo_number),
      CONSTRAINT fk_import_row_audit_run FOREIGN KEY (run_id) REFERENCES import_runs(run_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS import_rejected_rows (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      run_id VARCHAR(96) NOT NULL,
      importer_id VARCHAR(64) NOT NULL,
      dispo_number VARCHAR(50) NULL,
      source_row_number INT NULL,
      source_file TEXT NULL,
      target_table VARCHAR(128) NULL,
      candidate_slot VARCHAR(64) NULL,
      rejection_code VARCHAR(96) NOT NULL,
      reason TEXT NOT NULL,
      rule_name VARCHAR(255) NULL,
      candidate_data JSON NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_import_rejected_run (run_id),
      KEY idx_import_rejected_dispo (dispo_number),
      CONSTRAINT fk_import_rejected_run FOREIGN KEY (run_id) REFERENCES import_runs(run_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ];
  let ok = true;
  for (const sql of statements) ok = (await safeExecute(pool, sql, [], onError)) && ok;
  return ok;
}

async function createRun(pool, run, onError = null) {
  return safeExecute(pool, `INSERT INTO import_runs
    (run_id, mode, importer_scope, validation_mode, status, source_files, stats, preview_path, started_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE mode=VALUES(mode), importer_scope=VALUES(importer_scope), validation_mode=VALUES(validation_mode), status=VALUES(status), source_files=VALUES(source_files), stats=VALUES(stats), preview_path=VALUES(preview_path), started_at=VALUES(started_at), completed_at=NULL, error_summary=NULL`, [
    run.runId, run.mode, run.importerScope || null, run.validationMode || 'strict', run.status || 'running',
    safeJson(run.sourceFiles || {}), safeJson(run.stats || {}), run.previewPath || null, run.startedAt || new Date(),
  ], onError);
}

async function updateRun(pool, runId, patch, onError = null) {
  const fields = [];
  const values = [];
  const mapping = {
    status: 'status',
    sourceFiles: 'source_files',
    stats: 'stats',
    previewPath: 'preview_path',
    errorSummary: 'error_summary',
    completedAt: 'completed_at',
  };
  for (const [key, column] of Object.entries(mapping)) {
    if (!(key in patch)) continue;
    fields.push(`\`${column}\` = ?`);
    values.push(key === 'sourceFiles' || key === 'stats' ? safeJson(patch[key]) : patch[key]);
  }
  if (!fields.length) return true;
  values.push(runId);
  return safeExecute(pool, `UPDATE import_runs SET ${fields.join(', ')} WHERE run_id = ?`, values, onError);
}

async function recordRowAudit(handle, row, onError = null) {
  return safeExecute(handle, `INSERT INTO import_row_audit
    (run_id, importer_id, dispo_number, source_row_number, target_table, action, status, candidate_count, valid_count, rejected_count, inserted_count, updated_count, deleted_count, message, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    row.runId, row.importerId, row.dispoNumber || null, row.sourceRowNumber || null, row.targetTable || null,
    row.action || null, row.status, row.candidateCount || 0, row.validCount || 0, row.rejectedCount || 0,
    row.insertedCount || 0, row.updatedCount || 0, row.deletedCount || 0, row.message || null, safeJson(row.details || null),
  ], onError);
}

async function recordRejectedRow(handle, row, onError = null) {
  return safeExecute(handle, `INSERT INTO import_rejected_rows
    (run_id, importer_id, dispo_number, source_row_number, source_file, target_table, candidate_slot, rejection_code, reason, rule_name, candidate_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
    row.runId, row.importerId, row.dispoNumber || null, row.sourceRowNumber || null, row.sourceFile || null,
    row.targetTable || null, row.candidateSlot || null, row.rejectionCode || 'VALIDATION_FAILED', row.reason || 'Validation failed',
    row.ruleName || null, safeJson(row.candidateData || null),
  ], onError);
}

module.exports = {
  ensureAuditTables,
  createRun,
  updateRun,
  recordRowAudit,
  recordRejectedRow,
};
