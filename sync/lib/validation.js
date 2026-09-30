'use strict';

const fs = require('fs');
const path = require('path');

function isPresent(value) {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function isPositive(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

function isNonNegative(value) {
  if (value === null || value === undefined || value === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0;
}

function loadRuleFiles(rulesDir) {
  const rules = {};
  if (!fs.existsSync(rulesDir)) return rules;
  for (const name of fs.readdirSync(rulesDir)) {
    if (!name.endsWith('.rules.json')) continue;
    const fullPath = path.join(rulesDir, name);
    const parsed = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    const table = parsed.table || name.replace(/\.rules\.json$/i, '');
    rules[table] = parsed;
  }
  return rules;
}

function validateField(row, field, contract) {
  const value = row[field];
  if (contract === 'required') return isPresent(value);
  if (contract === 'positive') return isPositive(value);
  if (contract === 'non_negative') return isNonNegative(value);
  return true;
}

function validateRow(table, row, rule, mode = 'strict') {
  if (!rule) return { valid: true, errors: [], warnings: [] };
  const errors = [];
  const warnings = [];
  const strict = String(mode || 'strict').toLowerCase() === 'strict';

  for (const field of rule.required || []) {
    if (!isPresent(row[field])) {
      (strict ? errors : warnings).push({
        code: 'REQUIRED_FIELD_MISSING',
        field,
        rule: `${table}.required`,
        reason: `${field} is required`,
      });
    }
  }

  for (const field of rule.requiredPositive || []) {
    if (!isPositive(row[field])) {
      (strict ? errors : warnings).push({
        code: 'REQUIRED_POSITIVE_FIELD_MISSING',
        field,
        rule: `${table}.requiredPositive`,
        reason: `${field} must be greater than zero`,
      });
    }
  }

  for (const group of rule.anyOf || []) {
    const fields = Array.isArray(group.fields) ? group.fields : [];
    const contract = group.contract || 'required';
    if (!fields.some((field) => validateField(row, field, contract))) {
      (strict ? errors : warnings).push({
        code: group.code || 'ANY_OF_CONTRACT_FAILED',
        fields,
        rule: group.name || `${table}.anyOf`,
        reason: group.reason || `At least one of ${fields.join(', ')} must satisfy ${contract}`,
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateCandidates(table, candidates, rule, mode = 'strict') {
  const valid = [];
  const rejected = [];
  for (const candidate of candidates || []) {
    const result = validateRow(table, candidate.data || candidate, rule, mode);
    const decorated = { ...candidate, validation: result };
    if (result.valid) valid.push(decorated);
    else rejected.push(decorated);
  }
  return { valid, rejected };
}

module.exports = {
  isPresent,
  isPositive,
  loadRuleFiles,
  validateRow,
  validateCandidates,
};
