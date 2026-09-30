'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const visPath = path.resolve(root, '../import_mapper_vis/visual-mapping.config.json');
const mappingsDir = path.resolve(root, 'mappings');
const stale = new Set([
  'issued_quantity_kgs',
  'required_greige_production',
  'required_print_production',
  'required_warp_length',
  'receive_date',
  'receive_quantity',
]);
const forbiddenBusinessIdentifiers = ['NO-DISPO-', 'AUTO-DISPO-', 'AUTO-PO-', 'AUTO-PRECOST-', 'NO-CHALLAN-'];
const findings = [];

function inspectExpression(file, profile, table, field, expression) {
  const text = String(expression || '');
  for (const token of forbiddenBusinessIdentifiers) {
    if (text.includes(token)) findings.push({ code: 'FORBIDDEN_SYNTHETIC_BUSINESS_IDENTIFIER', file, profile, table, target: field, token });
  }
}

function scanVisual() {
  const visual = JSON.parse(fs.readFileSync(visPath, 'utf8'));
  for (const profile of visual.profiles || []) {
    const seen = new Map();
    for (const step of profile.steps || []) {
      for (const mapping of step.mappings || []) {
        const key = `${step.targetTable}::${mapping.targetColumn}`;
        if (seen.has(key)) findings.push({ code: 'DUPLICATE_VISUAL_TARGET', file: visPath, profile: profile.id, table: step.targetTable, target: mapping.targetColumn, first: seen.get(key), duplicate: mapping.id });
        else seen.set(key, mapping.id);
        if (stale.has(mapping.targetColumn)) findings.push({ code: 'STALE_TARGET', file: visPath, profile: profile.id, table: step.targetTable, target: mapping.targetColumn });
        inspectExpression(visPath, profile.id, step.targetTable, mapping.targetColumn, mapping.formula);
        inspectExpression(visPath, profile.id, step.targetTable, mapping.targetColumn, mapping.executableFormula);
        for (const fallback of mapping.executableFallbacks || []) inspectExpression(visPath, profile.id, step.targetTable, mapping.targetColumn, fallback.expression);
      }
    }
  }
}

function scanCliExport(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const seen = new Map();
  for (const mapping of data.mappings || []) {
    const key = `${mapping.target_table}::${mapping.target_field}`;
    if (seen.has(key)) findings.push({ code: 'DUPLICATE_CLI_TARGET', file: filePath, profile: mapping.profile_id, table: mapping.target_table, target: mapping.target_field });
    else seen.set(key, true);
    if (stale.has(mapping.target_field)) findings.push({ code: 'STALE_TARGET', file: filePath, profile: mapping.profile_id, table: mapping.target_table, target: mapping.target_field });
    inspectExpression(filePath, mapping.profile_id, mapping.target_table, mapping.target_field, mapping.formula);
    inspectExpression(filePath, mapping.profile_id, mapping.target_table, mapping.target_field, mapping.executable_formula);
    for (const fallback of mapping.executable_fallbacks || []) inspectExpression(filePath, mapping.profile_id, mapping.target_table, mapping.target_field, fallback.expression);
  }
}

function scanContract(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  for (const profile of data.profiles || []) {
    const seen = new Map();
    for (const mapping of profile.mappings || []) {
      const key = `${mapping.table}::${mapping.field}`;
      if (seen.has(key)) findings.push({ code: 'DUPLICATE_CONTRACT_TARGET', file: filePath, profile: profile.id, table: mapping.table, target: mapping.field });
      else seen.set(key, true);
      if (stale.has(mapping.field)) findings.push({ code: 'STALE_TARGET', file: filePath, profile: profile.id, table: mapping.table, target: mapping.field });
      inspectExpression(filePath, profile.id, mapping.table, mapping.field, mapping.expression);
      for (const fallback of mapping.fallbacks || []) inspectExpression(filePath, profile.id, mapping.table, mapping.field, fallback.expression);
    }
  }
}

scanVisual();
for (const file of fs.readdirSync(mappingsDir)) if (/-cli-mapping\.json$/.test(file)) scanCliExport(path.join(mappingsDir, file));
scanContract(path.join(mappingsDir, 'mapping-contract-v2.template.json'));
scanContract(path.join(mappingsDir, 'mapping-contract-v2.json'));

console.log(JSON.stringify({ ok: findings.length === 0, staleTargets: [...stale], forbiddenBusinessIdentifiers, findings }, null, 2));
if (findings.length) process.exitCode = 1;
