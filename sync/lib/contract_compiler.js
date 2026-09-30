'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, filePath);
}
function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : (typeof value === 'string' ? value : JSON.stringify(value));
  return crypto.createHash('sha256').update(input).digest('hex');
}
function nowStamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function mappingKey(table, field) { return `${table}::${field}`; }
function visualMappings(profile) {
  const out = [];
  for (const step of profile.steps || []) {
    for (const mapping of step.mappings || []) out.push({ step, mapping });
  }
  return out;
}
function compileSimpleLookup(visual, templateMapping) {
  const fallbacks = [];
  if (visual.sourceColumn) fallbacks.push({ source: visual.sourceColumn });
  const sourceColumn = visual.anchorSourceColumn || visual.sourceColumn;
  if (visual.lookupTable && visual.lookupKeyColumn && visual.lookupReturnColumn && sourceColumn) {
    fallbacks.push({ lookup: {
      table: visual.lookupTable,
      key_field: visual.lookupKeyColumn,
      source_column: sourceColumn,
      result_field: visual.lookupReturnColumn,
    } });
  }
  if (!fallbacks.length && templateMapping?.fallbacks?.length) return templateMapping.fallbacks;
  return fallbacks;
}
function expressionSourceColumns(expression = '') {
  const out = [];
  const re = /source\(\s*(["'])(.*?)\1\s*\)/g;
  let match;
  while ((match = re.exec(String(expression || ''))) !== null) out.push(match[2]);
  return [...new Set(out.filter(Boolean))];
}

function knownFormula(formula = '', target = '') {
  const f = String(formula || '').trim().toLowerCase();
  if (f === 'out side + warp + weft') return 'sum(source("Out Side"), source("Warp"), source("Weft"))';
  if (target === 'issued_quantity' && /out side.*warp.*weft/.test(f)) return 'sum(source("Out Side"), source("Warp"), source("Weft"))';
  return null;
}

function compileContract({ visualConfigPath, templatePath, schemaPath, outputPath, backupDir }) {
  const visual = readJson(visualConfigPath);
  const template = readJson(templatePath);
  const schema = readJson(schemaPath);
  const contract = JSON.parse(JSON.stringify(template));
  const report = { generatedAt: new Date().toISOString(), visualConfigPath: 'import_mapper_vis/visual-mapping.config.json', templatePath: 'import_mapper_cli/mappings/mapping-contract-v2.template.json', outputPath: 'import_mapper_cli/mappings/mapping-contract-v2.json', applied: [], warnings: [], errors: [], droppedVisualMappings: [], silentBusinessRuleReplacements: [] };
  const templateProfiles = new Map(contract.profiles.map(p => [p.id, p]));
  const visualProfiles = new Map((visual.profiles || []).map(p => [p.id, p]));

  // A target may have only one visual mapping. Allowing multiple entries causes
  // order-dependent compilation (the later mapping silently overwrites the first).
  // Treat this as a publication-blocking configuration error.
  for (const [profileId, visualProfile] of visualProfiles) {
    const seenTargets = new Map();
    for (const { step, mapping } of visualMappings(visualProfile)) {
      const table = step.targetTable;
      const field = mapping.targetColumn;
      if (!table || !field) continue;
      const key = mappingKey(table, field);
      const prior = seenTargets.get(key);
      if (prior) {
        report.errors.push({
          code: 'DUPLICATE_VISUAL_TARGET_MAPPING',
          profile: profileId,
          table,
          field,
          firstMappingId: prior,
          duplicateMappingId: mapping.id,
          message: 'Each target field must have one unambiguous VIS mapping.',
        });
      } else {
        seenTargets.set(key, mapping.id);
      }
    }
  }

  for (const [profileId, visualProfile] of visualProfiles) {
    const targetProfile = templateProfiles.get(profileId);
    if (!targetProfile) {
      report.warnings.push({ code: 'VISUAL_PROFILE_NOT_IN_TEMPLATE', profile: profileId });
      continue;
    }
    targetProfile.name = visualProfile.name || targetProfile.name;
    targetProfile.source_file = visualProfile.sourceFile || targetProfile.source_file;
    const templateByTarget = new Map((targetProfile.mappings || []).map(m => [mappingKey(m.table, m.field), m]));
    const repeatedTables = new Set((targetProfile.repeated_groups || []).map(g => g.target_table));

    for (const { step, mapping: visualMapping } of visualMappings(visualProfile)) {
      const table = step.targetTable;
      const field = visualMapping.targetColumn;
      if (!table || !field) continue;
      if (!schema[table] || !schema[table][field]) {
        report.droppedVisualMappings.push({ profile: profileId, table, field, mappingId: visualMapping.id, reason: 'target_missing_from_schema' });
        continue;
      }
      if (repeatedTables.has(table)) {
        report.applied.push({ profile: profileId, table, field, mappingId: visualMapping.id, action: 'covered_by_repeated_group_contract' });
        continue;
      }
      const key = mappingKey(table, field);
      const current = templateByTarget.get(key);
      if (!current) {
        const typeRaw = String(visualMapping.mappingType || visualMapping.uiMappingType || 'direct').toLowerCase();
        let compiled;
        if (typeRaw === 'direct') {
          if (!visualMapping.sourceColumn) {
            report.errors.push({ code: 'DIRECT_MAPPING_SOURCE_MISSING', profile: profileId, table, field, mappingId: visualMapping.id });
            continue;
          }
          compiled = { table, field, type: 'direct', source_column: visualMapping.sourceColumn, source_columns: visualMapping.sourceColumns?.length ? visualMapping.sourceColumns : [visualMapping.sourceColumn] };
        } else if (typeRaw === 'lookup') {
          const fallbacks = compileSimpleLookup(visualMapping, null);
          if (!fallbacks.length) {
            report.errors.push({ code: 'LOOKUP_RULE_INCOMPLETE', profile: profileId, table, field, mappingId: visualMapping.id });
            continue;
          }
          compiled = { table, field, type: 'lookup', fallbacks };
        } else {
          const expression = visualMapping.executableFormula || knownFormula(visualMapping.formula, field);
          if (!expression) {
            report.errors.push({ code: 'UNSUPPORTED_COMPUTED_FORMULA', profile: profileId, table, field, mappingId: visualMapping.id, formula: visualMapping.formula || '' });
            continue;
          }
          compiled = { table, field, type: 'formula', expression, source_columns: visualMapping.sourceColumns || [] };
        }
        compiled.business_critical = Boolean(visualMapping.businessCritical);
        compiled.critical_lookup = Boolean(visualMapping.criticalLookup);
        compiled.required = Boolean(visualMapping.required || compiled.business_critical || compiled.critical_lookup);
        compiled.allow_null = !compiled.required;
        compiled.original_mapping_type = visualMapping.mappingType || visualMapping.uiMappingType || compiled.type;
        compiled.target_type = schema[table][field];
        compiled.transform = 'auto';
        targetProfile.mappings.push(compiled);
        templateByTarget.set(key, compiled);
        report.applied.push({ profile: profileId, table, field, mappingId: visualMapping.id, action: 'added_from_visual' });
        continue;
      }

      current.business_critical = Boolean(visualMapping.businessCritical || current.business_critical);
      current.critical_lookup = Boolean(visualMapping.criticalLookup || current.critical_lookup);
      current.required = Boolean(visualMapping.required || current.required || current.business_critical || current.critical_lookup);
      current.allow_null = !current.required;
      const typeRaw = String(visualMapping.mappingType || visualMapping.uiMappingType || current.type).toLowerCase();
      const authoritative = Boolean(visualMapping.executionAuthoritative);

      if (visualMapping.executableFormula) {
        current.type = 'formula';
        current.expression = visualMapping.executableFormula;
        current.source_columns = visualMapping.sourceColumns || expressionSourceColumns(visualMapping.executableFormula);
        delete current.source_column;
        delete current.fallbacks;
        report.applied.push({ profile: profileId, table, field, mappingId: visualMapping.id, action: 'visual_authoritative_formula' });
      } else if (Array.isArray(visualMapping.executableFallbacks) && visualMapping.executableFallbacks.length) {
        current.type = 'lookup';
        current.fallbacks = visualMapping.executableFallbacks;
        current.source_columns = visualMapping.sourceColumns || [];
        delete current.source_column;
        delete current.expression;
        report.applied.push({ profile: profileId, table, field, mappingId: visualMapping.id, action: 'visual_authoritative_lookup' });
      } else if (typeRaw === 'direct' && visualMapping.sourceColumn) {
        current.type = 'direct';
        current.source_column = visualMapping.sourceColumn;
        current.source_columns = visualMapping.sourceColumns?.length ? visualMapping.sourceColumns : [visualMapping.sourceColumn];
        delete current.fallbacks;
        delete current.expression;
        report.applied.push({ profile: profileId, table, field, mappingId: visualMapping.id, action: 'visual_authoritative_direct' });
      } else if (authoritative) {
        report.errors.push({ code: 'AUTHORITATIVE_VISUAL_EXECUTION_MISSING', profile: profileId, table, field, mappingId: visualMapping.id });
        continue;
      } else {
        report.applied.push({ profile: profileId, table, field, mappingId: visualMapping.id, action: 'template_semantics_unchanged' });
      }
      current.target_type = schema[table][field];
    }
  }

  for (const profile of contract.profiles || []) {
    const seen = new Set();
    for (const mapping of profile.mappings || []) {
      const key = mappingKey(mapping.table, mapping.field);
      if (seen.has(key)) {
        report.errors.push({ code: 'DUPLICATE_CONTRACT_TARGET', profile: profile.id, table: mapping.table, field: mapping.field, message: 'Each executable target must occur exactly once.' });
      }
      seen.add(key);
      if (mapping.business_critical || mapping.critical_lookup) {
        mapping.required = true;
        mapping.allow_null = false;
      }
    }
  }

  contract.generated_at = new Date().toISOString();
  contract.published_from = {
    visual_config: 'import_mapper_vis/visual-mapping.config.json',
    visual_config_sha256: sha256(fs.readFileSync(visualConfigPath)),
    template: 'import_mapper_cli/mappings/mapping-contract-v2.template.json',
    template_sha256: sha256(fs.readFileSync(templatePath)),
    publisher: 'Mapping Contract v2 compiler',
  };
  contract.normalization_report = { ...(contract.normalization_report || {}), publish_report: report };
  // Hash only executable contract semantics plus source/template content hashes.
  // Publishing the same unchanged VIS mapping twice must keep the same contract hash,
  // otherwise the live dry-run gate would be invalidated by timestamps alone.
  const contractWithoutHash = JSON.parse(JSON.stringify(contract));
  delete contractWithoutHash.published_contract_sha256;
  delete contractWithoutHash.generated_at;
  delete contractWithoutHash.normalization_report;
  if (contractWithoutHash.published_from) {
    delete contractWithoutHash.published_from.visual_config;
    delete contractWithoutHash.published_from.template;
  }
  contract.published_contract_sha256 = sha256(JSON.stringify(contractWithoutHash));

  if (report.errors.length) {
    const error = new Error(`Contract publish blocked by ${report.errors.length} compiler error(s).`);
    error.report = report;
    throw error;
  }
  if (fs.existsSync(outputPath)) {
    const dir = backupDir || path.join(path.dirname(outputPath), 'backups');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(outputPath, path.join(dir, `${path.basename(outputPath, '.json')}.${nowStamp()}.json`));
  }
  writeJsonAtomic(outputPath, contract);
  return { contract, report, contractHash: contract.published_contract_sha256 };
}

module.exports = { compileContract, sha256 };
