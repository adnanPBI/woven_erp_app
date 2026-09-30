'use strict';

const { normalizeMatchText, cleanText } = require('./source_index');

const DOWNSTREAM_PROFILES = new Set([
  'yarn-receive',
  'yarn-issue',
  'warping',
  'sizing',
  'loom',
  'folding',
  'greige-delivery',
]);

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function dbHandle(ctx) { return ctx.conn || ctx.pool; }

class DispoResolutionService {
  constructor(ctx) {
    this.ctx = ctx;
    this.loaded = false;
    this.masterByNormalized = new Map();
    this.manualByKey = new Map();
    this.unmatchedRunCounts = new Map();
  }

  log(level, event, message, meta = {}) {
    this.ctx.log?.(level, event, message, meta);
  }

  shouldResolve(profileId) {
    return DOWNSTREAM_PROFILES.has(profileId);
  }

  async load() {
    if (this.loaded || !this.ctx.pool) return;

    const [dispoRows] = await this.ctx.pool.query(`
      SELECT dispo_number, po_no, precosting_number
      FROM dispo_form_data
      WHERE dispo_number IS NOT NULL AND TRIM(dispo_number) <> ''
    `);
    for (const row of dispoRows) this.addMaster(row.dispo_number, row.po_no, row.precosting_number, 'dispo_form_data');

    const [planRows] = await this.ctx.pool.query(`
      SELECT dispo_no AS dispo_number, po_no, NULL AS precosting_number
      FROM dispo_plan_form
      WHERE dispo_no IS NOT NULL AND TRIM(dispo_no) <> ''
    `);
    for (const row of planRows) this.addMaster(row.dispo_number, row.po_no, row.precosting_number, 'dispo_plan_form');

    const manualColumns = this.ctx.tableColumns.import_manual_dispo_resolution || new Set();
    const hasApproval = manualColumns.has('approved_by') && manualColumns.has('approved_at');
    const selectApproval = hasApproval ? ', approved_by, approved_at' : ', NULL AS approved_by, NULL AS approved_at';
    const [manualRows] = await this.ctx.pool.query(`
      SELECT id, source_module, source_dispo_number,
             resolved_dispo_number, resolved_po_no, resolved_pre_costing_no,
             action_mode, status, notes, created_by, applied_at
             ${selectApproval}
      FROM import_manual_dispo_resolution
      WHERE status IN ('ready', 'applied')
    `);
    for (const row of manualRows) {
      const source = normalizeMatchText(row.source_dispo_number);
      if (!source) continue;
      this.manualByKey.set(`${normalizeMatchText(row.source_module)}|${source}`, row);
    }

    this.loaded = true;
    this.log('info', 'dispo_resolution_loaded', 'Loaded master and approved manual dispo-resolution indexes.', {
      masters: this.masterByNormalized.size,
      resolutions: this.manualByKey.size,
      placeholderApprovalColumnsAvailable: hasApproval,
    });
  }

  addMaster(dispoNumber, poNo, preCostingNo, sourceTable) {
    const normalized = normalizeMatchText(dispoNumber);
    if (!normalized) return;
    const current = this.masterByNormalized.get(normalized);
    const candidate = {
      dispoNumber: cleanText(dispoNumber),
      poNo: cleanText(poNo),
      preCostingNo: cleanText(preCostingNo),
      sourceTable,
    };
    if (!current || sourceTable === 'dispo_form_data') this.masterByNormalized.set(normalized, candidate);
  }

  findManual(profileId, normalizedSource) {
    return this.manualByKey.get(`${normalizeMatchText(profileId)}|${normalizedSource}`)
      || this.manualByKey.get(`all|${normalizedSource}`)
      || null;
  }

  async findCurrentMaster(normalizedDispo) {
    if (!this.ctx.pool || !normalizedDispo) return null;

    // The production database may be empty when the run starts and receive the
    // dispo profile earlier in the same process. Query on cache miss so newly
    // committed masters are visible to downstream profiles without requiring a
    // second CLI process. LOWER/TRIM mirrors the in-memory normalization used by
    // the resolver while preserving the canonical database value.
    const [dispoRows] = await this.ctx.pool.query(`
      SELECT dispo_number, po_no, precosting_number
      FROM dispo_form_data
      WHERE LOWER(TRIM(dispo_number)) = ?
      ORDER BY dispo_number
      LIMIT 1
    `, [normalizedDispo]);
    if (dispoRows.length) {
      const row = dispoRows[0];
      this.addMaster(row.dispo_number, row.po_no, row.precosting_number, 'dispo_form_data');
      return this.masterByNormalized.get(normalizedDispo) || null;
    }

    const [planRows] = await this.ctx.pool.query(`
      SELECT dispo_no AS dispo_number, po_no, NULL AS precosting_number
      FROM dispo_plan_form
      WHERE LOWER(TRIM(dispo_no)) = ?
      ORDER BY dispo_no
      LIMIT 1
    `, [normalizedDispo]);
    if (planRows.length) {
      const row = planRows[0];
      this.addMaster(row.dispo_number, row.po_no, row.precosting_number, 'dispo_plan_form');
      return this.masterByNormalized.get(normalizedDispo) || null;
    }

    return null;
  }

  async recordUnmatched({ profileId, sourceTable, rawDispo, sample = {}, reason }) {
    const auditKey = `${profileId}|${normalizeMatchText(rawDispo, { blank: '<blank>' })}`;
    const count = (this.unmatchedRunCounts.get(auditKey) || 0) + 1;
    this.unmatchedRunCounts.set(auditKey, count);
    const auditRow = {
      source_module: profileId,
      source_table: sourceTable,
      source_dispo_number: cleanText(rawDispo) || '<BLANK>',
      source_rows: count,
      sample_buyer: cleanText(sample.buyer),
      sample_construction: cleanText(sample.construction),
      sample_composition: cleanText(sample.composition),
      master_dispo_found: 0,
      status: 'pending-review',
      note: reason,
    };
    this.ctx.dispoAuditRows ||= [];
    const existingIndex = this.ctx.dispoAuditRows.findIndex((row) => row.source_module === auditRow.source_module && row.source_dispo_number === auditRow.source_dispo_number);
    if (existingIndex >= 0) this.ctx.dispoAuditRows[existingIndex] = auditRow;
    else this.ctx.dispoAuditRows.push(auditRow);

    // Audit must survive rollback of the rejected logical unit, so use the pool rather
    // than the active row transaction connection.
    if (this.ctx.pool && !this.ctx.dryRun) {
      await this.ctx.pool.query(`
        INSERT INTO import_unmatched_dispo_audit (
          source_module, source_table, source_dispo_number, source_rows,
          sample_buyer, sample_construction, sample_composition,
          master_dispo_found, status, note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending-review', ?)
        ON DUPLICATE KEY UPDATE
          source_table = VALUES(source_table),
          source_rows = GREATEST(source_rows, VALUES(source_rows)),
          sample_buyer = COALESCE(VALUES(sample_buyer), sample_buyer),
          sample_construction = COALESCE(VALUES(sample_construction), sample_construction),
          sample_composition = COALESCE(VALUES(sample_composition), sample_composition),
          master_dispo_found = 0,
          status = 'pending-review',
          note = VALUES(note),
          updated_at = CURRENT_TIMESTAMP
      `, [
        auditRow.source_module,
        auditRow.source_table,
        auditRow.source_dispo_number,
        auditRow.source_rows,
        auditRow.sample_buyer,
        auditRow.sample_construction,
        auditRow.sample_composition,
        auditRow.note,
      ]);
    }
    this.log('warn', 'unmatched_dispo_recorded', 'Unmatched dispo was audited and blocked.', auditRow);
  }

  validateResolvedMaster(resolution, master) {
    if (!master) return 'Resolved dispo does not exist in dispo_form_data or dispo_plan_form.';
    const expectedPo = normalizeMatchText(resolution.resolved_po_no);
    const actualPo = normalizeMatchText(master.poNo);
    if (expectedPo && actualPo && expectedPo !== actualPo) return `Resolved PO mismatch: expected ${resolution.resolved_po_no}, master has ${master.poNo}.`;
    const expectedPre = normalizeMatchText(resolution.resolved_pre_costing_no);
    const actualPre = normalizeMatchText(master.preCostingNo);
    if (expectedPre && actualPre && expectedPre !== actualPre) return `Resolved pre-costing mismatch: expected ${resolution.resolved_pre_costing_no}, master has ${master.preCostingNo}.`;
    return null;
  }

  async markApplied(resolution) {
    if (!this.ctx.pool || this.ctx.dryRun || resolution.status === 'applied') return;
    await dbHandle(this.ctx).query(`
      UPDATE import_manual_dispo_resolution
      SET status = 'applied', applied_at = COALESCE(applied_at, CURRENT_TIMESTAMP)
      WHERE id = ?
    `, [resolution.id]);
  }

  async createApprovedPlaceholder(resolution, sample) {
    if (!envBool('ALLOW_APPROVED_PLACEHOLDERS', false)) {
      throw new Error('Approved placeholder exists but ALLOW_APPROVED_PLACEHOLDERS is not enabled.');
    }
    if (!this.ctx.conn || this.ctx.dryRun) {
      throw new Error('Approved placeholders may be created only during a live transactional import.');
    }
    if (!cleanText(resolution.approved_by) || !resolution.approved_at) {
      throw new Error('Placeholder resolution is missing approved_by or approved_at.');
    }

    const dispoNumber = cleanText(resolution.resolved_dispo_number);
    const poNo = cleanText(resolution.resolved_po_no);
    const preCostingNo = cleanText(resolution.resolved_pre_costing_no);
    if (!dispoNumber || !poNo || !preCostingNo) {
      throw new Error('Approved placeholder requires explicit resolved_dispo_number, resolved_po_no, and resolved_pre_costing_no.');
    }

    const conn = this.ctx.conn;
    await conn.query(`
      INSERT INTO pre_costing_data (pre_costing_no, buyer, construction)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE
        buyer = COALESCE(buyer, VALUES(buyer)),
        construction = COALESCE(construction, VALUES(construction))
    `, [preCostingNo, cleanText(sample.buyer), cleanText(sample.construction)]);

    await conn.query(`
      INSERT INTO PO_form_data (
        po_no, pre_costing_no, buyer_name, production_construction,
        fabric_composition, dispo_number, special_note
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        pre_costing_no = VALUES(pre_costing_no),
        dispo_number = COALESCE(dispo_number, VALUES(dispo_number)),
        special_note = COALESCE(special_note, VALUES(special_note))
    `, [
      poNo,
      preCostingNo,
      cleanText(sample.buyer),
      cleanText(sample.construction),
      cleanText(sample.composition),
      dispoNumber,
      `Approved migration placeholder. Resolution ID ${resolution.id}; approved by ${resolution.approved_by}.`,
    ]);

    await conn.query(`
      INSERT INTO dispo_form_data (
        dispo_number, po_no, precosting_number, buyer_name,
        production_construction, fabric_composition, additional_remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        po_no = VALUES(po_no),
        precosting_number = VALUES(precosting_number),
        additional_remarks = COALESCE(additional_remarks, VALUES(additional_remarks))
    `, [
      dispoNumber,
      poNo,
      preCostingNo,
      cleanText(sample.buyer),
      cleanText(sample.construction),
      cleanText(sample.composition),
      `Approved migration placeholder. Resolution ID ${resolution.id}.`,
    ]);

    await conn.query(`
      INSERT INTO dispo_plan_form (
        po_no, buyer, dispo_no, production_construction, fabric_composition
      ) VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        buyer = COALESCE(buyer, VALUES(buyer)),
        production_construction = COALESCE(production_construction, VALUES(production_construction)),
        fabric_composition = COALESCE(fabric_composition, VALUES(fabric_composition))
    `, [
      poNo,
      cleanText(sample.buyer),
      dispoNumber,
      cleanText(sample.construction),
      cleanText(sample.composition),
    ]);

    await conn.query(`
      INSERT INTO import_placeholder_dispo_audit (
        dispo_number, placeholder_pre_costing_no, placeholder_po_no,
        source_modules, source_rows, sample_buyer,
        sample_construction, sample_composition
      ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        source_modules = VALUES(source_modules),
        source_rows = GREATEST(source_rows, VALUES(source_rows)),
        sample_buyer = COALESCE(VALUES(sample_buyer), sample_buyer),
        sample_construction = COALESCE(VALUES(sample_construction), sample_construction),
        sample_composition = COALESCE(VALUES(sample_composition), sample_composition)
    `, [
      dispoNumber,
      preCostingNo,
      poNo,
      resolution.source_module,
      cleanText(sample.buyer),
      cleanText(sample.construction),
      cleanText(sample.composition),
    ]);

    await this.markApplied(resolution);
    const master = { dispoNumber, poNo, preCostingNo, sourceTable: 'approved_placeholder' };
    this.masterByNormalized.set(normalizeMatchText(dispoNumber), master);
    return master;
  }

  async resolve({ profileId, sourceTable, rawDispo, sample = {} }) {
    if (!this.shouldResolve(profileId)) return cleanText(rawDispo);
    const normalized = normalizeMatchText(rawDispo);
    if (!normalized) {
      await this.recordUnmatched({ profileId, sourceTable, rawDispo, sample, reason: 'Source dispo is blank or invalid.' });
      const error = new Error(`Unmatched dispo for ${profileId}: source dispo is blank.`);
      error.code = 'UNMATCHED_DISPO';
      throw error;
    }

    // Certified Dispo CSV is an immutable master source. It permits a complete
    // strict dry run even when the target migration tables are still empty.
    // Live runs still validate manual relinks/placeholders against the database.
    const sourceMaster = this.ctx.sourceIndex?.dispoMaster(rawDispo) || null;
    if (sourceMaster) return sourceMaster.dispoNumber;

    if (!this.ctx.pool) {
      if (envBool('REQUIRE_DB_FOR_DISPO_RESOLUTION', false)) {
        throw new Error('DB connection is required for strict dispo resolution.');
      }
      this.ctx.addValidation({ level: 'warn', code: 'DISPO_RESOLUTION_SKIPPED_NO_DB', profile: profileId, source_dispo_number: rawDispo, message: 'Dispo master resolution skipped because DB is unavailable.' });
      return cleanText(rawDispo);
    }

    await this.load();
    let directMaster = this.masterByNormalized.get(normalized);
    if (!directMaster) directMaster = await this.findCurrentMaster(normalized);
    if (directMaster) return directMaster.dispoNumber;

    const resolution = this.findManual(profileId, normalized);
    if (resolution) {
      if (resolution.action_mode === 'relink_to_existing_master') {
        const resolvedKey = normalizeMatchText(resolution.resolved_dispo_number);
        let master = this.masterByNormalized.get(resolvedKey);
        if (!master) master = await this.findCurrentMaster(resolvedKey);
        const invalidReason = this.validateResolvedMaster(resolution, master);
        if (!invalidReason) {
          await this.markApplied(resolution);
          this.log('info', 'manual_dispo_resolution_applied', 'Manual dispo resolution applied.', {
            profileId,
            sourceDispo: rawDispo,
            resolvedDispo: master.dispoNumber,
            resolutionId: resolution.id,
          });
          return master.dispoNumber;
        }
        await this.recordUnmatched({ profileId, sourceTable, rawDispo, sample, reason: `Manual resolution invalid: ${invalidReason}` });
        const error = new Error(`Manual dispo resolution ${resolution.id} is invalid: ${invalidReason}`);
        error.code = 'INVALID_MANUAL_DISPO_RESOLUTION';
        throw error;
      }

      if (resolution.action_mode === 'create_approved_placeholder') {
        const master = await this.createApprovedPlaceholder(resolution, sample);
        return master.dispoNumber;
      }

      await this.recordUnmatched({ profileId, sourceTable, rawDispo, sample, reason: `Resolution ${resolution.id} is audit_only and does not authorize import.` });
      const error = new Error(`Dispo ${rawDispo} has audit-only resolution and remains blocked.`);
      error.code = 'UNMATCHED_DISPO';
      throw error;
    }

    await this.recordUnmatched({ profileId, sourceTable, rawDispo, sample, reason: 'No master dispo and no ready manual resolution.' });
    const error = new Error(`No master or approved resolution for dispo ${rawDispo}.`);
    error.code = 'UNMATCHED_DISPO';
    throw error;
  }
}

module.exports = { DispoResolutionService, DOWNSTREAM_PROFILES, envBool };
