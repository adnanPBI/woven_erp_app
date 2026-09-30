'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parseDate } = require('./source_index');
const { forEachCsvObjectSync } = require('./csv_stream');

const MAX_DETAIL_ROWS = Math.max(50, Number(process.env.SOURCE_REPORT_DETAIL_LIMIT || 1000));
const DUPLICATE_POLICY_PATH = path.resolve(__dirname, '../config/duplicate_aggregation_policy.v1.json');
const NORMALIZATION_POLICY_PATH = path.resolve(__dirname, '../config/normalization_policy.v3.2.3.json');
const PROVENANCE_POLICY_PATH = path.resolve(__dirname, '../config/provenance_policy.v3.2.3.json');
const RELEASE_BINDINGS_PATH = path.resolve(__dirname, '../config/release_bindings.v3.2.3.json');
let releaseBindings = {};
try { if (fs.existsSync(RELEASE_BINDINGS_PATH)) releaseBindings = JSON.parse(fs.readFileSync(RELEASE_BINDINGS_PATH, 'utf8')); } catch (_error) { /* verifier/certifier will fail closed if release bindings are unreadable */ }
let duplicatePolicy = { profiles: {} };
try { if (fs.existsSync(DUPLICATE_POLICY_PATH)) duplicatePolicy = JSON.parse(fs.readFileSync(DUPLICATE_POLICY_PATH, 'utf8')); } catch (_error) { /* certification remains conservative if policy is unreadable */ }
function duplicatePolicyEnabled() { return String(process.env.USE_DUPLICATE_AGGREGATION_POLICY || 'true').toLowerCase() !== 'false'; }

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}
function normalizeHeader(value) {
  return String(value || '').replace(/^\uFEFF/, '').replace(/\u00a0/g, ' ').trim();
}
function clean(value) {
  const text = String(value ?? '').replace(/\u00a0/g, ' ').trim();
  return text && !/^(?:n\/?a|none|null|-)$/i.test(text) ? text : '';
}
function norm(value) { return clean(value).toLowerCase().replace(/\s+/g, ' '); }
function first(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name) && clean(row[name])) return clean(row[name]);
  }
  return '';
}
function cappedPush(array, value, counter) {
  counter.total += 1;
  if (array.length < MAX_DETAIL_ROWS) array.push(value);
}
function extractDispoRef(value) {
  const text = clean(value);
  if (!text) return '';
  const match = text.match(/\b([A-Z0-9]{1,12}(?:\/[A-Z0-9_-]{1,20})*\/GD\/\d{2,4}\/\d{3,})\b/i)
    || text.match(/(?:DISPO|GD|D\/O|DO)\s*(?:No\.?|Number|#)?\s*[:\-]?\s*([A-Za-z0-9\/_-]{3,})/i)
    || text.match(/\b([A-Z]{1,5}\/?\d{3,}[A-Za-z0-9\/_-]*)\b/);
  return match ? match[1] : '';
}
function extractChallanRef(value) {
  const text = clean(value);
  if (!text) return '';
  const label = text.match(/(?:Challan|SR|S\/R)\s*(?:No\.?|#)?\s*[:\-]?\s*/i);
  if (!label || label.index === undefined) return '';
  let tail = text.slice(label.index + label[0].length);
  tail = tail.split(/-(?:Factory|Yarn Count|Last Received Date|Yarn Lot|Receipt Qty|Created By|Search Column)\s*:/i)[0];
  return clean(tail);
}

function sourceLogicalKey(profileId, row, dateOrder = 'mdy') {
  const certifiedUid = first(row, ['__MIG_SOURCE_UID']);
  if (certifiedUid) return { parts: [certifiedUid], normalized: [norm(certifiedUid)], key: norm(certifiedUid) };
  const date = (value) => parseDate(value, dateOrder) || norm(value);
  const dispoReceive = first(row, ['Received GD NO']) || extractDispoRef(first(row, ['Special Notes'])) || extractDispoRef(first(row, ['Search Column']));
  const challanReceive = first(row, ['Challan No']) || extractChallanRef(first(row, ['Special Notes'])) || extractChallanRef(first(row, ['Search Column']));
  const specs = {
    'pre-costing-bootstrap': [first(row, ['PRE_COSTING_NO'])],
    po: [first(row, ['PO NO', 'PO NUMBER'])],
    dispo: [first(row, ['Dispo No.', 'Dispo No', 'DISPO NUMBER'])],
    'yarn-receive': [first(row, ['Yarn Count']), first(row, ['Yarn brand', 'Yarn Brand']), first(row, ['Yarn Lot']), date(first(row, ['Received Date'])), dispoReceive, challanReceive],
    'yarn-issue': [first(row, ['Yarn Count']), first(row, ['Yarn Lot']), date(first(row, ['Issue Date'])), first(row, ['Dispo No']), first(row, ['S/R/Challan No'])],
    warping: [first(row, ['Dispo No']), first(row, ['Warping Program No']), date(first(row, ['Warping Date']))],
    sizing: [first(row, ['Dispo No']), first(row, ['Warping Program No']), date(first(row, ['Sizing Date']))],
    loom: [first(row, ['Dispo No']), date(first(row, ['Weaving Dates']))],
    folding: [first(row, ['Dispo No']), date(first(row, ['Folding Production Date']))],
    'greige-delivery': [first(row, ['Dispo No']), date(first(row, ['Delivery Date'])), first(row, ['Challan No'])],
  };
  const parts = specs[profileId];
  if (!parts) return null;
  return { parts, normalized: parts.map(norm), key: parts.map(norm).join('|') };
}

function createLogicalAnalyzer(profileId) {
  return {
    profileId,
    keys: new Map(),
    missingRows: [],
    missingCount: { total: 0 },
  };
}
function consumeLogicalAnalyzer(analyzer, row, sourceRow, dateOrder) {
  const logical = sourceLogicalKey(analyzer.profileId, row, dateOrder);
  if (!logical) return;
  if (logical.normalized.some((value) => !value)) {
    cappedPush(analyzer.missingRows, { source_row: sourceRow, key_parts: logical.parts }, analyzer.missingCount);
    return;
  }
  const current = analyzer.keys.get(logical.key);
  if (!current) analyzer.keys.set(logical.key, { count: 1, first: sourceRow, rows: [sourceRow] });
  else {
    current.count += 1;
    if (current.rows.length < MAX_DETAIL_ROWS) current.rows.push(sourceRow);
  }
}
function finalizeLogicalAnalyzer(analyzer) {
  const duplicates = [];
  let duplicateCount = 0;
  let completeRows = 0;
  for (const [key, entry] of analyzer.keys.entries()) {
    completeRows += entry.count;
    if (entry.count > 1) {
      duplicateCount += 1;
      if (duplicates.length < MAX_DETAIL_ROWS) duplicates.push({ key, source_rows: entry.rows, row_count: entry.count });
    }
  }
  const configuredTables = duplicatePolicyEnabled() ? (duplicatePolicy.profiles?.[analyzer.profileId]?.tables || {}) : {};
  const duplicatePolicyApplied = Object.keys(configuredTables).length > 0;
  const unresolvedDuplicateCount = duplicatePolicyApplied ? 0 : duplicateCount;
  return {
    profile: analyzer.profileId,
    logical_units_with_complete_key: completeRows,
    unique_natural_keys: analyzer.keys.size,
    missing_natural_key_rows: analyzer.missingRows,
    missing_natural_key_row_count: analyzer.missingCount.total,
    missing_natural_key_rows_truncated: analyzer.missingCount.total > analyzer.missingRows.length,
    duplicate_natural_keys: duplicates,
    duplicate_natural_key_count: duplicateCount,
    duplicate_natural_key_authorized_count: duplicatePolicyApplied ? duplicateCount : 0,
    duplicate_natural_key_unresolved_count: unresolvedDuplicateCount,
    duplicate_natural_keys_truncated: duplicateCount > duplicates.length,
    // PRE_COSTING_NO completeness is reported separately from the same PO CSV.
    // Counting it here as well would inflate a single source defect twice.
    blocking_findings: analyzer.profileId === 'pre-costing-bootstrap' ? 0 : analyzer.missingCount.total + unresolvedDuplicateCount,
  };
}

function analyzeLogicalKeys(filePath, profileIds, dateOrder = 'mdy') {
  const analyzers = profileIds.map(createLogicalAnalyzer);
  forEachCsvObjectSync(filePath, (row, meta) => {
    if (!meta.nonEmpty) return true;
    for (const analyzer of analyzers) consumeLogicalAnalyzer(analyzer, row, meta.sourceRowNumber, dateOrder);
    return true;
  });
  return analyzers.map(finalizeLogicalAnalyzer);
}

function createPreCostingAnalyzer(filePath) {
  return {
    source_file: path.basename(filePath),
    total: 0,
    byNumber: new Map(),
    missingRows: [],
    missingCount: { total: 0 },
    missingPoRows: [],
    missingPoCount: { total: 0 },
  };
}
function consumePreCostingAnalyzer(state, row, sourceRow) {
  state.total += 1;
  const preCostingNo = first(row, ['PRE_COSTING_NO']);
  const poNo = first(row, ['PO NO', 'PO NUMBER']);
  if (!preCostingNo) cappedPush(state.missingRows, { source_row: sourceRow, po_no: poNo || null }, state.missingCount);
  else {
    const key = norm(preCostingNo);
    const entry = state.byNumber.get(key) || { pre_costing_no: preCostingNo, count: 0, source_rows: [] };
    entry.count += 1;
    if (entry.source_rows.length < MAX_DETAIL_ROWS) entry.source_rows.push(sourceRow);
    state.byNumber.set(key, entry);
  }
  if (!poNo) cappedPush(state.missingPoRows, { source_row: sourceRow, pre_costing_no: preCostingNo || null }, state.missingPoCount);
}
function finalizePreCostingAnalyzer(state) {
  const duplicateGroups = [];
  let duplicateCount = 0;
  for (const entry of state.byNumber.values()) {
    if (entry.count <= 1) continue;
    duplicateCount += 1;
    if (duplicateGroups.length < MAX_DETAIL_ROWS) duplicateGroups.push({ pre_costing_no: entry.pre_costing_no, source_rows: entry.source_rows, row_count: entry.count });
  }
  const duplicatePolicyApplied = duplicatePolicyEnabled() && Object.keys(duplicatePolicy.profiles?.['pre-costing-bootstrap']?.tables || {}).length > 0;
  const unresolvedDuplicateCount = duplicatePolicyApplied ? 0 : duplicateCount;
  const blockingFindings = state.missingCount.total + unresolvedDuplicateCount + state.missingPoCount.total + (state.total ? 0 : 1);
  return {
    report_version: '1.1-low-memory',
    source_file: state.source_file,
    total_nonempty_rows: state.total,
    rows_with_pre_costing_no: state.total - state.missingCount.total,
    rows_missing_pre_costing_no: state.missingCount.total,
    missing_pre_costing_rows: state.missingRows,
    missing_pre_costing_rows_truncated: state.missingCount.total > state.missingRows.length,
    unique_pre_costing_numbers: state.byNumber.size,
    duplicate_pre_costing_groups: duplicateGroups,
    duplicate_pre_costing_group_count: duplicateCount,
    duplicate_pre_costing_groups_authorized_count: duplicatePolicyApplied ? duplicateCount : 0,
    duplicate_pre_costing_groups_unresolved_count: unresolvedDuplicateCount,
    duplicate_pre_costing_groups_truncated: duplicateCount > duplicateGroups.length,
    rows_missing_po_no: state.missingPoCount.total,
    missing_po_rows: state.missingPoRows,
    missing_po_rows_truncated: state.missingPoCount.total > state.missingPoRows.length,
    blocking_findings: blockingFindings,
    status: blockingFindings === 0 ? 'PASS' : 'FAIL',
  };
}
function analyzePreCostingNo(filePath) {
  const state = createPreCostingAnalyzer(filePath);
  forEachCsvObjectSync(filePath, (row, meta) => {
    if (meta.nonEmpty) consumePreCostingAnalyzer(state, row, meta.sourceRowNumber);
    return true;
  });
  return finalizePreCostingAnalyzer(state);
}
function applyPreCostingNullPolicy(report, _filePath) { return report; }

function createOrderedIdentifierAnalyzer(profileIds) {
  return profileIds.includes('greige-delivery') ? { invalidRows: [], invalidCount: { total: 0 } } : null;
}
function consumeOrderedIdentifierAnalyzer(state, row, sourceRow) {
  if (!state) return;
  const value = first(row, ['Challan No']);
  if (!value) return;
  if (!/^[\x20-\x7E]+$/.test(value)) cappedPush(state.invalidRows, { source_row: sourceRow, challan_no: value, reason: 'non_ascii_identifier' }, state.invalidCount);
}
function finalizeOrderedIdentifierAnalyzer(state) {
  if (!state) return null;
  return {
    rule: 'blank-first; 1-65 digit whole numbers numeric; remaining ASCII identifiers lowercase bytewise; source row tie-break',
    invalid_rows: state.invalidRows,
    invalid_row_count: state.invalidCount.total,
    invalid_rows_truncated: state.invalidCount.total > state.invalidRows.length,
    blocking_findings: state.invalidCount.total,
    status: state.invalidCount.total ? 'FAIL' : 'PASS',
  };
}
function analyzeOrderedIdentifiers(filePath, profileIds) {
  const state = createOrderedIdentifierAnalyzer(profileIds);
  if (!state) return null;
  forEachCsvObjectSync(filePath, (row, meta) => {
    if (meta.nonEmpty) consumeOrderedIdentifierAnalyzer(state, row, meta.sourceRowNumber);
    return true;
  });
  return finalizeOrderedIdentifierAnalyzer(state);
}

function inspectCsv(filePath) {
  const meta = forEachCsvObjectSync(filePath, () => true);
  return {
    headers: (meta.headers || []).map(normalizeHeader),
    parsed_rows: meta.parsed_rows,
    nonempty_rows: meta.nonempty_rows,
    blank_rows: meta.blank_rows,
    size_bytes: meta.size_bytes,
    sha256: meta.sha256,
  };
}

function expressionSourceColumns(expression) {
  const columns = [];
  const regex = /source\(\s*(["'])(.*?)\1\s*\)/g;
  let match;
  while ((match = regex.exec(String(expression || ''))) !== null) columns.push(match[2]);
  return columns;
}
function profileRequiredHeaders(profile, presentHeaders = null) {
  const headers = new Set();
  const present = presentHeaders ? new Set(presentHeaders) : null;
  const add = (column) => { if (column) headers.add(column); };
  for (const mapping of profile.mappings || []) {
    if (mapping.source_column) add(mapping.source_column);
    for (const column of mapping.source_columns || []) add(column);
    if (mapping.expression) for (const column of expressionSourceColumns(mapping.expression)) add(column);
    for (const fallback of mapping.fallbacks || []) {
      if (fallback.source) add(fallback.source);
      if (fallback.expression) for (const column of expressionSourceColumns(fallback.expression)) add(column);
      if (fallback.lookup?.source_column) add(fallback.lookup.source_column);
      if (fallback.lookup?.upto_date_source) add(fallback.lookup.upto_date_source);
      for (const where of fallback.lookup?.where || []) if (where.source_column) add(where.source_column);
    }
  }
  for (const group of profile.repeated_groups || []) {
    const [start] = group.range || [1, 1];
    const expand = (value) => String(value).replace(/\{i\}/g, String(start));
    if (group.parent_key_source) add(expand(group.parent_key_source));
    for (const globalField of group.global_fields || []) if (globalField.source_column) add(expand(globalField.source_column));
    for (const spec of Object.values(group.fields || {})) {
      const candidates = (Array.isArray(spec) ? spec : [spec])
        .filter((value) => typeof value === 'string' && !/field\(|sumSections\(/.test(value))
        .map(expand);
      if (!candidates.length) continue;
      const selected = present ? (candidates.find((candidate) => present.has(candidate)) || candidates[0]) : candidates[0];
      add(selected);
    }
  }
  return [...headers].filter(Boolean).sort();
}

function inspectAndAnalyzeCsv(filePath, relatedProfiles, dateOrder) {
  const profileIds = relatedProfiles.map((candidate) => candidate.id);
  const logicalAnalyzers = profileIds.map(createLogicalAnalyzer);
  const orderedAnalyzer = createOrderedIdentifierAnalyzer(profileIds);
  const preCostingAnalyzer = profileIds.includes('pre-costing-bootstrap') ? createPreCostingAnalyzer(filePath) : null;
  const meta = forEachCsvObjectSync(filePath, (row, rowMeta) => {
    if (!rowMeta.nonEmpty) return true;
    for (const analyzer of logicalAnalyzers) consumeLogicalAnalyzer(analyzer, row, rowMeta.sourceRowNumber, dateOrder);
    consumeOrderedIdentifierAnalyzer(orderedAnalyzer, row, rowMeta.sourceRowNumber);
    if (preCostingAnalyzer) consumePreCostingAnalyzer(preCostingAnalyzer, row, rowMeta.sourceRowNumber);
    return true;
  });
  return {
    inspected: {
      headers: (meta.headers || []).map(normalizeHeader),
      parsed_rows: meta.parsed_rows,
      nonempty_rows: meta.nonempty_rows,
      blank_rows: meta.blank_rows,
      size_bytes: meta.size_bytes,
      sha256: meta.sha256,
    },
    logicalKeyAnalysis: logicalAnalyzers.map(finalizeLogicalAnalyzer),
    orderedIdentifierAnalysis: finalizeOrderedIdentifierAnalyzer(orderedAnalyzer),
    preCostingNoReport: preCostingAnalyzer ? finalizePreCostingAnalyzer(preCostingAnalyzer) : null,
  };
}

function normalizationAttestationPath(csvDir) {
  return path.resolve(process.env.NORMALIZATION_ATTESTATION_FILE || path.join(csvDir, '..', 'audit', 'normalization-attestation.json'));
}
function validateNormalizationAttestation(csvDir) {
  const attestationPath = normalizationAttestationPath(csvDir);
  const findings = [];
  if (!fs.existsSync(attestationPath)) return { attestationPath, attestation: null, findings: [{ level: 'error', code: 'NORMALIZATION_ATTESTATION_MISSING', message: `Normalization attestation not found: ${attestationPath}` }] };
  let attestation;
  try { attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf8')); }
  catch (error) { return { attestationPath, attestation: null, findings: [{ level: 'error', code: 'NORMALIZATION_ATTESTATION_INVALID_JSON', message: error.message }] }; }
  if (attestation.status !== 'PASS' || Number(attestation.blocking_findings || 0) !== 0) findings.push({ level: 'error', code: 'NORMALIZATION_ATTESTATION_NOT_PASS', status: attestation.status, blocking_findings: attestation.blocking_findings });
  const actualCsvDir = path.resolve(csvDir);
  if (path.resolve(attestation.certified_source_dir || '') !== actualCsvDir) findings.push({ level: 'error', code: 'NORMALIZATION_CERTIFIED_DIR_MISMATCH', expected: attestation.certified_source_dir, actual: actualCsvDir });
  if (!fs.existsSync(NORMALIZATION_POLICY_PATH)) findings.push({ level: 'error', code: 'NORMALIZATION_POLICY_MISSING', path: NORMALIZATION_POLICY_PATH });
  else if (attestation.normalization_policy_sha256 !== sha256File(NORMALIZATION_POLICY_PATH)) findings.push({ level: 'error', code: 'NORMALIZATION_POLICY_HASH_MISMATCH', expected: attestation.normalization_policy_sha256, actual: sha256File(NORMALIZATION_POLICY_PATH) });
  for (const [filename, entry] of Object.entries(attestation.certified_files || {})) {
    const filePath = path.resolve(csvDir, filename);
    if (!fs.existsSync(filePath)) { findings.push({ level: 'error', code: 'NORMALIZATION_CERTIFIED_FILE_MISSING', filename }); continue; }
    const actual = sha256File(filePath);
    if (actual !== entry.sha256) findings.push({ level: 'error', code: 'NORMALIZATION_CERTIFIED_FILE_HASH_MISMATCH', filename, expected: entry.sha256, actual });
  }
  for (const [name, artifact] of Object.entries(attestation.artifacts || {})) {
    const artifactPath = path.resolve(artifact.path || '');
    if (!artifactPath || !fs.existsSync(artifactPath)) { findings.push({ level: 'error', code: 'NORMALIZATION_ARTIFACT_MISSING', artifact: name, path: artifact.path }); continue; }
    const actual = sha256File(artifactPath);
    if (actual !== artifact.sha256) findings.push({ level: 'error', code: 'NORMALIZATION_ARTIFACT_HASH_MISMATCH', artifact: name, expected: artifact.sha256, actual });
  }
  return { attestationPath, attestation, findings };
}

function buildManifest({ contractPath, csvDir, schemaPath }) {
  const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
  const contractFileSha256 = sha256File(contractPath);
  const normalization = validateNormalizationAttestation(csvDir);
  const normalizationErrorCount = normalization.findings.filter((finding) => finding.level === 'error').length;
  const normalizationStatus = normalizationErrorCount === 0 && normalization.attestation?.status === 'PASS' && Number(normalization.attestation?.blocking_findings || 0) === 0 ? 'PASS' : 'FAIL';
  const seen = new Set();
  const files = [];
  let preCostingNoReport = null;
  for (const profile of contract.profiles || []) {
    if (seen.has(profile.source_file)) continue;
    seen.add(profile.source_file);
    const filePath = path.resolve(csvDir, profile.source_file);
    const relatedProfiles = contract.profiles.filter((candidate) => candidate.source_file === profile.source_file);
    if (!fs.existsSync(filePath)) {
      const requiredHeaders = [...new Set(relatedProfiles.flatMap((candidate) => profileRequiredHeaders(candidate)))].sort();
      files.push({ profiles: relatedProfiles.map((candidate) => candidate.id), filename: profile.source_file, missing: true, required_headers: requiredHeaders, blocking_findings: 1, certification_status: 'rejected' });
      continue;
    }
    const analysis = inspectAndAnalyzeCsv(filePath, relatedProfiles, process.env.CSV_DATE_ORDER || 'mdy');
    const inspected = analysis.inspected;
    const present = new Set(inspected.headers);
    const requiredHeaders = [...new Set(relatedProfiles.flatMap((candidate) => profileRequiredHeaders(candidate, inspected.headers)))].sort();
    const missingRequiredHeaders = requiredHeaders.filter((header) => !present.has(header));
    if (analysis.preCostingNoReport) preCostingNoReport = analysis.preCostingNoReport;
    const blockingFindings = missingRequiredHeaders.length
      + analysis.logicalKeyAnalysis.reduce((sum, item) => sum + item.blocking_findings, 0)
      + Number(analysis.orderedIdentifierAnalysis?.blocking_findings || 0)
      + (inspected.nonempty_rows > 0 ? 0 : 1);
    files.push({
      profiles: relatedProfiles.map((candidate) => candidate.id),
      filename: profile.source_file,
      ...inspected,
      required_headers: requiredHeaders,
      missing_required_headers: missingRequiredHeaders,
      logical_key_analysis: analysis.logicalKeyAnalysis,
      ordered_identifier_analysis: analysis.orderedIdentifierAnalysis,
      blocking_findings: blockingFindings,
      certification_status: blockingFindings ? 'rejected' : 'pending-review',
    });
  }
  const totalBlockingFindings = files.reduce((sum, entry) => sum + Number(entry.blocking_findings || 0), 0)
    + Number(preCostingNoReport?.blocking_findings || 0)
    + normalization.findings.filter((finding) => finding.level === 'error').length;
  return {
    manifest_version: '3.2.3-hybrid-normalization-bound-2',
    manifest_status: totalBlockingFindings ? 'rejected' : 'pending-review',
    release_patch_revision: releaseBindings.release_patch_revision || null,
    generated_at: new Date().toISOString(),
    csv_dir: path.resolve(csvDir),
    contract_file: path.resolve(contractPath),
    contract_file_sha256: contractFileSha256,
    contract_sha256: contract.published_contract_sha256 || contractFileSha256,
    schema_file: schemaPath ? path.resolve(schemaPath) : null,
    schema_sha256: schemaPath && fs.existsSync(schemaPath) ? sha256File(schemaPath) : null,
    duplicate_aggregation_policy_file: fs.existsSync(DUPLICATE_POLICY_PATH) ? DUPLICATE_POLICY_PATH : null,
    duplicate_aggregation_policy_sha256: fs.existsSync(DUPLICATE_POLICY_PATH) ? sha256File(DUPLICATE_POLICY_PATH) : null,
    normalization_attestation_file: normalization.attestationPath,
    normalization_attestation_sha256: fs.existsSync(normalization.attestationPath) ? sha256File(normalization.attestationPath) : null,
    normalization_policy_file: NORMALIZATION_POLICY_PATH,
    normalization_policy_sha256: fs.existsSync(NORMALIZATION_POLICY_PATH) ? sha256File(NORMALIZATION_POLICY_PATH) : null,
    provenance_policy_file: PROVENANCE_POLICY_PATH,
    provenance_policy_sha256: fs.existsSync(PROVENANCE_POLICY_PATH) ? sha256File(PROVENANCE_POLICY_PATH) : null,
    normalization_status: normalizationStatus,
    normalization_attestation_status: normalization.attestation?.status || null,
    normalization_findings: normalization.findings,
    normalization_summary: normalization.attestation?.summary || null,
    report_detail_limit: MAX_DETAIL_ROWS,
    pre_costing_no_completeness: preCostingNoReport,
    total_blocking_findings: totalBlockingFindings,
    files,
  };
}

function validateManifest({ manifestPath, csvDir, contract, schemaPath, requireApproved = false }) {
  if (!fs.existsSync(manifestPath)) return [{ level: 'error', code: 'SOURCE_MANIFEST_MISSING', message: `Source manifest not found: ${manifestPath}` }];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const findings = [];
  const normalization = validateNormalizationAttestation(csvDir);
  if (manifest.manifest_version !== '3.2.3-hybrid-normalization-bound-2') findings.push({ level: 'error', code: 'MANIFEST_VERSION_UNSUPPORTED', actual: manifest.manifest_version, message: 'v3.2.3 live validation requires the normalization-bound manifest v2 format.' });
  if (manifest.release_patch_revision && releaseBindings.release_patch_revision && manifest.release_patch_revision !== releaseBindings.release_patch_revision) findings.push({ level: 'error', code: 'MANIFEST_RELEASE_PATCH_MISMATCH', expected: releaseBindings.release_patch_revision, actual: manifest.release_patch_revision });
  if (path.resolve(manifest.csv_dir || '') !== path.resolve(csvDir)) findings.push({ level: 'error', code: 'MANIFEST_CSV_DIR_MISMATCH', expected: path.resolve(csvDir), actual: manifest.csv_dir || null });
  if (manifest.normalization_status !== 'PASS') findings.push({ level: 'error', code: 'MANIFEST_NORMALIZATION_STATUS_NOT_PASS', actual: manifest.normalization_status || null });
  for (const finding of normalization.findings) findings.push(finding);
  if (manifest.normalization_attestation_sha256) {
    if (!fs.existsSync(normalization.attestationPath)) findings.push({ level: 'error', code: 'MANIFEST_NORMALIZATION_ATTESTATION_MISSING' });
    else if (sha256File(normalization.attestationPath) !== manifest.normalization_attestation_sha256) findings.push({ level: 'error', code: 'MANIFEST_NORMALIZATION_ATTESTATION_HASH_MISMATCH', expected: manifest.normalization_attestation_sha256, actual: sha256File(normalization.attestationPath) });
  } else findings.push({ level: 'error', code: 'MANIFEST_NORMALIZATION_ATTESTATION_HASH_MISSING' });
  if (requireApproved) {
    if (manifest.manifest_status !== 'approved' || manifest.approval?.status !== 'approved') findings.push({ level: 'error', code: 'SOURCE_MANIFEST_NOT_APPROVED', message: 'Live import requires a reviewed and hash-bound approved source manifest.' });
    const reviewedHash = String(manifest.approval?.reviewed_pending_manifest_sha256 || '');
    const pendingPath = path.resolve(path.dirname(manifestPath), manifest.approval?.pending_manifest_file || 'source-manifest.pending.json');
    if (!/^[a-f0-9]{64}$/i.test(reviewedHash)) findings.push({ level: 'error', code: 'PENDING_MANIFEST_REVIEW_HASH_MISSING', message: 'Approved manifest does not contain the reviewed pending-manifest SHA-256.' });
    else if (!fs.existsSync(pendingPath)) findings.push({ level: 'error', code: 'REVIEWED_PENDING_MANIFEST_MISSING', pending_path: pendingPath, message: 'The exact reviewed pending manifest must remain beside the approved manifest.' });
    else {
      const actualPendingHash = sha256File(pendingPath);
      if (actualPendingHash !== reviewedHash) findings.push({ level: 'error', code: 'REVIEWED_PENDING_MANIFEST_HASH_MISMATCH', expected: reviewedHash, actual: actualPendingHash, message: 'The pending manifest differs from the exact file approved by its reviewer.' });
    }
  }
  if (Number(manifest.pre_costing_no_completeness?.blocking_findings || 0) > 0 || manifest.pre_costing_no_completeness?.status !== 'PASS') findings.push({ level: 'error', code: 'PRE_COSTING_NO_COMPLETENESS_FAILED', report: manifest.pre_costing_no_completeness || null, message: 'PRE_COSTING_NO completeness is unresolved. Manifest approval and migration are blocked.' });
  const byFilename = new Map((manifest.files || []).map((entry) => [entry.filename, entry]));
  const inspectedCache = new Map();
  for (const profile of contract.profiles || []) {
    const entry = byFilename.get(profile.source_file);
    if (!entry) { findings.push({ level: 'error', code: 'SOURCE_MANIFEST_ENTRY_MISSING', profile: profile.id, source_file: profile.source_file, message: 'Source file is not listed in source manifest.' }); continue; }
    if (entry.missing) { findings.push({ level: 'error', code: 'SOURCE_FILE_MISSING', profile: profile.id, source_file: profile.source_file, message: 'Source manifest marks the file missing.' }); continue; }
    if (requireApproved && entry.certification_status !== 'approved') findings.push({ level: 'error', code: 'SOURCE_FILE_NOT_APPROVED', profile: profile.id, source_file: profile.source_file, status: entry.certification_status, message: 'Live import requires every source file to be approved.' });
    if (Number(entry.blocking_findings || 0) > 0) findings.push({ level: 'error', code: 'SOURCE_CERTIFICATION_FAILED', profile: profile.id, source_file: profile.source_file, blocking_findings: entry.blocking_findings, logical_key_analysis: entry.logical_key_analysis || [], ordered_identifier_analysis: entry.ordered_identifier_analysis || null, message: 'Source contains blocking header, key, ordering, or completeness findings.' });
    const filePath = path.resolve(csvDir, profile.source_file);
    if (!fs.existsSync(filePath)) { findings.push({ level: 'error', code: 'SOURCE_FILE_MISSING', profile: profile.id, source_file: profile.source_file, message: 'Source CSV is missing from CSV_DIR.' }); continue; }
    if (!inspectedCache.has(filePath)) inspectedCache.set(filePath, inspectCsv(filePath));
    const inspected = inspectedCache.get(filePath);
    for (const field of ['sha256', 'nonempty_rows', 'parsed_rows', 'size_bytes']) if (String(inspected[field]) !== String(entry[field])) findings.push({ level: 'error', code: `SOURCE_${field.toUpperCase()}_MISMATCH`, profile: profile.id, source_file: profile.source_file, expected: entry[field], actual: inspected[field], message: `Source ${field} does not match the frozen manifest.` });
    const headerSet = new Set(inspected.headers);
    for (const header of entry.required_headers || []) if (!headerSet.has(header)) findings.push({ level: 'error', code: 'SOURCE_REQUIRED_HEADER_MISSING', profile: profile.id, source_file: profile.source_file, source_column: header, message: 'Frozen source is missing a required header.' });
  }
  if (!manifest.contract_file_sha256) findings.push({ level: 'error', code: 'MANIFEST_CONTRACT_FILE_HASH_MISSING', message: 'Manifest must bind the serialized contract file SHA-256.' });
  else {
    const activeContractFile = path.resolve(manifest.contract_file || '');
    if (!fs.existsSync(activeContractFile)) findings.push({ level: 'error', code: 'MANIFEST_CONTRACT_FILE_MISSING', path: activeContractFile });
    else {
      const actualContractFileSha256 = sha256File(activeContractFile);
      if (actualContractFileSha256 !== manifest.contract_file_sha256) findings.push({ level: 'error', code: 'MANIFEST_CONTRACT_FILE_HASH_MISMATCH', expected: manifest.contract_file_sha256, actual: actualContractFileSha256 });
    }
  }
  if (manifest.contract_sha256 && contract.published_contract_sha256 && manifest.contract_sha256 !== contract.published_contract_sha256) findings.push({ level: 'error', code: 'MANIFEST_CONTRACT_HASH_MISMATCH', expected: manifest.contract_sha256, actual: contract.published_contract_sha256, message: 'Manifest was not frozen against the active published contract.' });
  if (!manifest.normalization_policy_sha256) findings.push({ level: 'error', code: 'MANIFEST_NORMALIZATION_POLICY_HASH_MISSING' });
  else if (!fs.existsSync(NORMALIZATION_POLICY_PATH)) findings.push({ level: 'error', code: 'NORMALIZATION_POLICY_MISSING', path: NORMALIZATION_POLICY_PATH });
  else {
    const actualNormalizationPolicySha256 = sha256File(NORMALIZATION_POLICY_PATH);
    if (manifest.normalization_policy_sha256 !== actualNormalizationPolicySha256) findings.push({ level: 'error', code: 'MANIFEST_NORMALIZATION_POLICY_HASH_MISMATCH', expected: manifest.normalization_policy_sha256, actual: actualNormalizationPolicySha256 });
  }
  if (!manifest.provenance_policy_sha256) findings.push({ level: 'error', code: 'MANIFEST_PROVENANCE_POLICY_HASH_MISSING' });
  else if (!fs.existsSync(PROVENANCE_POLICY_PATH)) findings.push({ level: 'error', code: 'PROVENANCE_POLICY_MISSING', path: PROVENANCE_POLICY_PATH });
  else {
    const actualProvenancePolicySha256 = sha256File(PROVENANCE_POLICY_PATH);
    if (manifest.provenance_policy_sha256 !== actualProvenancePolicySha256) findings.push({ level: 'error', code: 'MANIFEST_PROVENANCE_POLICY_HASH_MISMATCH', expected: manifest.provenance_policy_sha256, actual: actualProvenancePolicySha256 });
  }
  if (manifest.schema_sha256 && schemaPath && fs.existsSync(schemaPath)) {
    const actualSchemaHash = sha256File(schemaPath);
    if (manifest.schema_sha256 !== actualSchemaHash) findings.push({ level: 'error', code: 'MANIFEST_SCHEMA_HASH_MISMATCH', expected: manifest.schema_sha256, actual: actualSchemaHash, message: 'Manifest schema hash differs from active schema file.' });
  }
  if (manifest.duplicate_aggregation_policy_sha256) {
    if (!fs.existsSync(DUPLICATE_POLICY_PATH)) findings.push({ level: 'error', code: 'DUPLICATE_AGGREGATION_POLICY_MISSING', message: 'Manifest requires the duplicate aggregation policy used during certification.' });
    else {
      const actualPolicyHash = sha256File(DUPLICATE_POLICY_PATH);
      if (manifest.duplicate_aggregation_policy_sha256 !== actualPolicyHash) findings.push({ level: 'error', code: 'DUPLICATE_AGGREGATION_POLICY_HASH_MISMATCH', expected: manifest.duplicate_aggregation_policy_sha256, actual: actualPolicyHash, message: 'Duplicate aggregation policy differs from the file certified by the manifest.' });
    }
  }
  return findings;
}

module.exports = {
  sha256Buffer,
  sha256File,
  inspectCsv,
  profileRequiredHeaders,
  buildManifest,
  validateManifest,
  analyzeLogicalKeys,
  sourceLogicalKey,
  analyzePreCostingNo,
  applyPreCostingNullPolicy,
  analyzeOrderedIdentifiers,
  inspectAndAnalyzeCsv,
  validateNormalizationAttestation,
  normalizationAttestationPath,
  RELEASE_BINDINGS_PATH,
  NORMALIZATION_POLICY_PATH,
  PROVENANCE_POLICY_PATH,
};
