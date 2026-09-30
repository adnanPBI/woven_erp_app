'use strict';

const fs = require('fs');
const path = require('path');

function cleanText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function loadPolicy(rootDir) {
  const file = path.resolve(rootDir, 'config', 'provenance_policy.v3.2.3.json');
  if (!fs.existsSync(file)) return { policy_version: 'missing', profiles: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isProvenanceTable(policy, profileId, table) {
  return Array.isArray(policy?.profiles?.[profileId]) && policy.profiles[profileId].includes(table);
}

async function findBinding(ctx, profileId, sourceUid, table) {
  if (!ctx.pool || !sourceUid) return null;
  const db = ctx.conn || ctx.pool;
  const [rows] = await db.query(
    `SELECT id, target_primary_key, source_manifest_sha256, first_run_id, last_run_id
       FROM migration_import_provenance
      WHERE profile = ? AND source_uid = ? AND target_table = ?
      LIMIT 1`,
    [profileId, sourceUid, table]
  );
  return rows[0] || null;
}

async function recordBinding(ctx, { profileId, sourceUid, table, targetPrimaryKey, action }) {
  if (!ctx.pool || ctx.dryRun) return;
  if (!sourceUid) throw new Error(`Cannot persist provenance for ${profileId}/${table}: source UID is blank.`);
  if (targetPrimaryKey === undefined || targetPrimaryKey === null || String(targetPrimaryKey).trim() === '') {
    throw new Error(`Cannot persist provenance for ${profileId}/${table}: target primary key is blank.`);
  }
  const db = ctx.conn || ctx.pool;
  await db.query(
    `INSERT INTO migration_import_provenance (
       profile, source_uid, source_manifest_sha256, source_file, source_row_number,
       target_table, target_primary_key, action, first_run_id, last_run_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       source_manifest_sha256 = VALUES(source_manifest_sha256),
       source_file = VALUES(source_file),
       source_row_number = VALUES(source_row_number),
       target_primary_key = VALUES(target_primary_key),
       action = VALUES(action),
       last_run_id = VALUES(last_run_id),
       updated_at = CURRENT_TIMESTAMP`,
    [
      profileId,
      sourceUid,
      ctx.sourceManifestFileSha256 || null,
      ctx.currentSourceFile || null,
      ctx.currentSourceRowNumber || null,
      table,
      String(targetPrimaryKey),
      action || 'upsert',
      ctx.runId,
      ctx.runId,
    ]
  );
}

async function verifyTargetExists(ctx, table, targetPrimaryKey) {
  const db = ctx.conn || ctx.pool;
  const [rows] = await db.query(`SELECT id FROM \`${table}\` WHERE id = ? LIMIT 1`, [targetPrimaryKey]);
  return rows[0] || null;
}

function validateSupportSchema(ctx, policy) {
  const requiredParents = new Set();
  for (const tables of Object.values(policy?.profiles || {})) for (const table of tables || []) requiredParents.add(table);
  if (!requiredParents.size || !ctx.pool) return [];

  const findings = [];
  const requiredSupport = {
    migration_import_provenance: ['profile','source_uid','source_manifest_sha256','source_file','source_row_number','target_table','target_primary_key','first_run_id','last_run_id'],
    import_placeholder_precosting_audit: ['placeholder_pre_costing_no','po_no','source_uid','source_manifest_sha256','first_run_id','last_run_id'],
    import_unlinked_source_row_audit: ['profile','source_uid','field_name','reason','source_manifest_sha256','first_run_id','last_run_id'],
  };
  for (const [table, columns] of Object.entries(requiredSupport)) {
    const actual = ctx.tableColumns[table];
    if (!actual) {
      findings.push({ level: 'error', code: `V323_SUPPORT_TABLE_MISSING_${table.toUpperCase()}`, scope: 'schema', table, message: `${table} is required. Apply sql/v3_2_3/01_v323_support_schema.sql before the accepted full dry-run.` });
      continue;
    }
    for (const column of columns) {
      if (!actual.has(column)) findings.push({ level: 'error', code: 'V323_SUPPORT_COLUMN_MISSING', scope: 'schema', table, column, message: `v3.2.3 support schema is missing ${table}.${column}.` });
    }
  }
  return findings;
}

module.exports = {
  loadPolicy,
  isProvenanceTable,
  findBinding,
  recordBinding,
  verifyTargetExists,
  validateSupportSchema,
  cleanText,
};
