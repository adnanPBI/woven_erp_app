'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtime = require('../../lib/mapping_contract_runtime');
const { SourceIndex } = require('../../lib/source_index');

const { isPolicyAuthorizedNullable, authorizedNullableReason } = runtime._test;

function mapping(table, field, required = true) {
  return { table, field, required, business_critical: required, critical_lookup: required };
}

(function testPlanOnlyMasterEnrichmentPolicy() {
  const planOnly = { currentPlanOnlyDispo: true };
  const operational = { currentPlanOnlyDispo: false };
  const warping = { id: 'warping' };

  assert.strictEqual(
    isPolicyAuthorizedNullable(planOnly, warping, mapping('warping_form', 'po_number'), {}),
    true,
    'plan-only warping PO enrichment must be nullable without fabrication'
  );
  assert.strictEqual(
    authorizedNullableReason(planOnly, warping, mapping('warping_form', 'po_number')),
    'certified_plan_only_dispo_missing_master_enrichment'
  );
  assert.strictEqual(
    isPolicyAuthorizedNullable(operational, warping, mapping('warping_form', 'po_number'), {}),
    false,
    'operational Dispo must retain strict master enrichment requirements'
  );
  assert.strictEqual(
    isPolicyAuthorizedNullable(planOnly, warping, mapping('warping_form', 'dispo_number'), {}),
    false,
    'source event identity must never be relaxed by the plan-only exception'
  );
})();

(function testHistoricalUpstreamPolicyIsNarrow() {
  const ctx = { currentPlanOnlyDispo: false };
  const folding = { id: 'folding' };
  const delivery = { id: 'greige-delivery' };

  assert.strictEqual(
    isPolicyAuthorizedNullable(ctx, folding, mapping('folding_production_breakdown', 'loom_production_qty_yds'), {}),
    true,
    'missing earlier loom checkpoint may be NULL for preserved historical folding event'
  );
  assert.strictEqual(
    isPolicyAuthorizedNullable(ctx, folding, mapping('folding_production_breakdown', 'folding_production_qty_yds'), {}),
    false,
    'current folding event quantity must remain strict'
  );
  assert.strictEqual(
    isPolicyAuthorizedNullable(ctx, folding, mapping('folding_production_breakdown', 'folding_balance'), {
      folding_production_breakdown: { folding_production_qty_yds: 120, loom_production_qty_yds: null },
    }),
    true,
    'folding balance may be NULL only when its historical upstream loom checkpoint is unavailable'
  );
  assert.strictEqual(
    isPolicyAuthorizedNullable(ctx, folding, mapping('folding_production_breakdown', 'folding_balance'), {
      folding_production_breakdown: { folding_production_qty_yds: 120, loom_production_qty_yds: 300 },
    }),
    false,
    'folding balance remains required when both operands exist'
  );

  assert.strictEqual(
    isPolicyAuthorizedNullable(ctx, delivery, mapping('greige_delivery_breakdown', 'greige_folding_qty_yds'), {}),
    true,
    'missing earlier folding checkpoint may be NULL for preserved historical delivery event'
  );
  assert.strictEqual(
    isPolicyAuthorizedNullable(ctx, delivery, mapping('greige_delivery_breakdown', 'greige_delivery_qty_yds'), {}),
    false,
    'current delivery event quantity must remain strict'
  );
  assert.strictEqual(
    isPolicyAuthorizedNullable(ctx, delivery, mapping('greige_delivery_breakdown', 'delivery_balance'), {
      greige_delivery_breakdown: { greige_delivery_qty_yds: 50, greige_folding_qty_yds: null },
    }),
    true,
    'delivery balance may be NULL only when its historical upstream folding checkpoint is unavailable'
  );
  assert.strictEqual(
    isPolicyAuthorizedNullable(ctx, delivery, mapping('greige_delivery_breakdown', 'delivery_balance'), {
      greige_delivery_breakdown: { greige_delivery_qty_yds: 50, greige_folding_qty_yds: 200 },
    }),
    false,
    'delivery balance remains required when both operands exist'
  );
})();

(function testCertifiedPlanOnlyMarkerIsReadFromSourceIndex() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v323-plan-only-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'Dispo create form.csv'),
      [
        'Dispo No.,PO No.,__MIG_OPERATIONAL_DISPO,__MIG_ACTION,__MIG_BRIDGE_SOURCE',
        'PLAN-001,,plan-only,historical_plan_bridge,dispo_plan',
        'FULL-001,PO-001,full,operational,po_master',
        '',
      ].join('\n'),
      'utf8'
    );
    const index = new SourceIndex({ csvDir: dir, dateOrder: 'dmy' });
    assert.strictEqual(index.isPlanOnlyDispo(' PLAN-001 '), true);
    assert.strictEqual(index.dispoOperationalMode('PLAN-001'), 'plan-only');
    assert.strictEqual(index.isPlanOnlyDispo('FULL-001'), false);
    assert.strictEqual(index.dispoMaster('PLAN-001').migrationAction, 'historical_plan_bridge');
    assert.strictEqual(index.dispoMaster('PLAN-001').bridgeSource, 'dispo_plan');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

console.log(JSON.stringify({
  ok: true,
  test: 'historical_partial_source_policy_v323',
  guarantees: [
    'plan-only exceptions are limited to certified downstream master-enrichment fields',
    'full/operational Dispos remain strict',
    'current source event identity and quantities remain strict',
    'historical upstream checkpoint fields may remain NULL rather than being fabricated',
    'policy-authorized lookup gaps remain auditable',
  ],
}, null, 2));
