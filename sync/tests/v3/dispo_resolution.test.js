'use strict';

const assert = require('assert');
const { DispoResolutionService } = require('../../lib/dispo_resolution');

function makePool() {
  return {
    async query(sql, params = []) {
      if (/FROM dispo_form_data/.test(sql) && /LOWER\(TRIM/.test(sql)) {
        if (params[0] === 'd-200') {
          return [[{ dispo_number: 'D-200', po_no: 'PO-2', precosting_number: 'PC-2' }]];
        }
        return [[]];
      }
      if (/FROM dispo_plan_form/.test(sql) && /LOWER\(TRIM/.test(sql)) return [[]];
      if (/FROM dispo_form_data/.test(sql)) return [[{ dispo_number: 'D-100', po_no: 'PO-1', precosting_number: 'PC-1' }]];
      if (/FROM dispo_plan_form/.test(sql)) return [[]];
      if (/FROM import_manual_dispo_resolution/.test(sql)) return [[{
        id: 1,
        source_module: 'sizing',
        source_dispo_number: ' old d-100 ',
        resolved_dispo_number: 'D-100',
        resolved_po_no: 'PO-1',
        resolved_pre_costing_no: 'PC-1',
        action_mode: 'relink_to_existing_master',
        status: 'ready',
        notes: null,
        created_by: 'tester',
        applied_at: null,
        approved_by: null,
        approved_at: null,
      }]];
      if (/UPDATE import_manual_dispo_resolution/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO import_unmatched_dispo_audit/.test(sql)) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

const events = [];
const ctx = {
  pool: makePool(),
  conn: null,
  dryRun: true,
  tableColumns: { import_manual_dispo_resolution: new Set(['approved_by', 'approved_at']) },
  log(level, event, message, meta) { events.push({ level, event, message, meta }); },
  addValidation() {},
};

(async () => {
  const service = new DispoResolutionService(ctx);
  await service.load();
  assert.strictEqual(await service.resolve({ profileId: 'sizing', sourceTable: 'sizing database.csv', rawDispo: ' d-100 ' }), 'D-100');
  assert.strictEqual(await service.resolve({ profileId: 'sizing', sourceTable: 'sizing database.csv', rawDispo: 'OLD   D-100' }), 'D-100');

  // D-200 was not present when the resolver cache was loaded. It simulates a
  // master inserted by the dispo profile earlier in the same all-profile run.
  assert.strictEqual(await service.resolve({ profileId: 'warping', sourceTable: 'Warping database.csv', rawDispo: ' d-200 ' }), 'D-200');

  let blocked = false;
  try {
    await service.resolve({ profileId: 'sizing', sourceTable: 'sizing database.csv', rawDispo: 'MISSING-1' });
  } catch (error) {
    blocked = error.code === 'UNMATCHED_DISPO';
  }
  assert.ok(blocked);
  assert.strictEqual(ctx.dispoAuditRows.length, 1);
  console.log('dispo_resolution.test.js: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
