'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compileContract } = require('../../lib/contract_compiler');

const root = path.resolve(__dirname, '../..');
const templatePath = path.join(root, 'mappings/mapping-contract-v2.template.json');
const visualPath = path.resolve(root, '../import_mapper_vis/visual-mapping.config.json');
const schemaPath = path.join(root, 'schema/weavonpq_weaving.schema.json');
const outputPath = path.join(os.tmpdir(), `mapping-contract-v323-test-${process.pid}.json`);
const result = compileContract({ visualConfigPath: visualPath, templatePath, schemaPath, outputPath, backupDir: path.join(os.tmpdir(), 'v323-contract-backups') });
assert.strictEqual(result.report.errors.length, 0);
assert.strictEqual(result.report.droppedVisualMappings.length, 0);
assert.strictEqual(result.report.silentBusinessRuleReplacements.length, 0);

const visual = JSON.parse(fs.readFileSync(visualPath, 'utf8'));
const duplicates = [];
for (const profile of visual.profiles || []) {
  const seen = new Map();
  for (const step of profile.steps || []) {
    for (const mapping of step.mappings || []) {
      const key = `${step.targetTable}::${mapping.targetColumn}`;
      if (seen.has(key)) duplicates.push({ profile: profile.id, key });
      seen.set(key, mapping.id);
    }
  }
}
assert.deepStrictEqual(duplicates, []);

const contract = result.contract;
function mapping(profileId, table, field) {
  const profile = contract.profiles.find((item) => item.id === profileId);
  return profile.mappings.find((item) => item.table === table && item.field === field);
}

assert.match(mapping('sizing', 'sizing_form', 'actual_warp_length_mtr').expression, /cleanText\(source\("Warp Length\(Mtr\)"\)\).*sourceWarpingValue/);
assert.strictEqual(mapping('sizing', 'sizing_form', 'actual_warp_length_mtr').business_critical, false);
assert.strictEqual(mapping('sizing', 'sizing_form', 'warping_date').business_critical, false);
assert.strictEqual(mapping('sizing', 'sizing_form', 'warping_set_no').business_critical, false);
assert.strictEqual(mapping('sizing', 'sizing_form', 'total_warp_beam').business_critical, false);
assert.strictEqual(mapping('yarn-issue', 'yarn_issue_form', 'total_received_kg').expression, 'sourceYarnReceiptSum(source("Yarn Lot"))');
assert.strictEqual(mapping('yarn-issue', 'yarn_issue_form', 'total_received_kg').business_critical, true);
assert.match(mapping('folding', 'folding_production_breakdown', 'folding_production_qty_yds').expression, /sourceCumulative\("folding"/);
assert.match(mapping('greige-delivery', 'greige_delivery_breakdown', 'greige_folding_qty_yds').expression, /sourceCumulative\("folding"/);
assert.match(mapping('greige-delivery', 'greige_delivery_breakdown', 'greige_delivery_qty_yds').expression, /sourceCumulative\("delivery"/);

// The 12 formerly duplicated targets are single source-first lookup mappings.
const mergedTargets = [
  ['warping', 'warping_form', 'buyer'], ['warping', 'warping_form', 'production_construction'],
  ['sizing', 'sizing_form', 'buyer'], ['sizing', 'sizing_form', 'production_construction'],
  ['loom', 'loom_production_form', 'buyer'], ['loom', 'loom_production_form', 'production_construction'],
  ['folding', 'folding_production_form', 'buyer'], ['folding', 'folding_production_form', 'production_construction'], ['folding', 'folding_production_form', 'fabric_composition'],
  ['greige-delivery', 'greige_delivery_form', 'buyer'], ['greige-delivery', 'greige_delivery_form', 'production_construction'], ['greige-delivery', 'greige_delivery_form', 'fabric_composition'],
];
for (const [profileId, table, field] of mergedTargets) {
  const m = mapping(profileId, table, field);
  assert.strictEqual(m.type, 'lookup', `${profileId}.${field} must be a lookup chain`);
  assert.ok(m.fallbacks[0]?.source, `${profileId}.${field} must preserve direct source first`);
  assert.ok(m.fallbacks.some((f) => f.lookup?.table === 'dispo_plan_form'));
  assert.ok(m.fallbacks.some((f) => f.lookup?.table === 'dispo_form_data'));
  assert.strictEqual(m.business_critical, true);
}

// v3.2.3 event parents use provenance identity and nullable source links remain optional.
for (const profileId of ['yarn-receive', 'yarn-issue', 'warping', 'sizing', 'greige-delivery']) {
  assert.strictEqual(contract.profiles.find((item) => item.id === profileId).idempotency, 'provenance');
}
for (const [profileId, table, field] of [
  ['yarn-receive', 'yarn_receive_form', 'received_against_dispo_nos'],
  ['yarn-receive', 'yarn_receive_form', 'challan_no'],
  ['yarn-receive', 'yarn_receive_form', 'received_against_po_no'],
  ['yarn-issue', 'yarn_issue_form', 'received_against_dispo_nos'],
  ['yarn-issue', 'yarn_issue_form', 'issue_challan_no'],
  ['yarn-issue', 'yarn_issue_form', 'received_against_po_no'],
  ['greige-delivery', 'greige_delivery_form', 'challan_no'],
]) {
  const m = mapping(profileId, table, field);
  assert.strictEqual(Boolean(m.required), false, `${profileId}.${field} must be optional`);
  assert.strictEqual(Boolean(m.business_critical), false, `${profileId}.${field} must not become a row blocker`);
}

// Parent yarn receive can extract a real Dispo without fabricating one.
const yarnReceiveDispo = mapping('yarn-receive', 'yarn_receive_form', 'received_against_dispo_nos');
assert.match(yarnReceiveDispo.expression, /extractDispoRef\(source\("Special Notes"\)\)/);
assert.ok(!yarnReceiveDispo.expression.includes('NO-DISPO-'));

const serialized = JSON.stringify({ template: JSON.parse(fs.readFileSync(templatePath, 'utf8')).profiles, contract: contract.profiles });
for (const synthetic of ['NO-DISPO-', 'AUTO-DISPO-', 'AUTO-PO-', 'AUTO-PRECOST-']) assert.ok(!serialized.includes(synthetic), `synthetic identifier remains: ${synthetic}`);
for (const stale of ['issued_quantity_kgs', 'required_greige_production"', 'required_print_production"', 'required_warp_length"']) assert.ok(!serialized.includes(stale), `stale target found: ${stale}`);

// Compiler itself must block a future duplicate target regression.
const badVisual = JSON.parse(JSON.stringify(visual));
const firstStep = badVisual.profiles.find((p) => p.id === 'sizing').steps[0];
firstStep.mappings.push({ ...firstStep.mappings[0], id: 'intentional_duplicate_test' });
const badVisualPath = path.join(os.tmpdir(), `bad-visual-${process.pid}.json`);
fs.writeFileSync(badVisualPath, JSON.stringify(badVisual));
let duplicateBlocked = false;
try {
  compileContract({ visualConfigPath: badVisualPath, templatePath, schemaPath, outputPath: `${outputPath}.bad`, backupDir: path.join(os.tmpdir(), 'v323-contract-backups') });
} catch (error) {
  duplicateBlocked = Boolean(error.report?.errors?.some((row) => row.code === 'DUPLICATE_VISUAL_TARGET_MAPPING'));
}
assert.strictEqual(duplicateBlocked, true);

fs.rmSync(outputPath, { force: true });
fs.rmSync(badVisualPath, { force: true });
console.log('contract_semantics.test.js: PASS');
