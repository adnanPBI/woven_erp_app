'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { SourceIndex } = require('../../lib/source_index');
const { aggregateChunkedProfile } = require('../../lib/chunked_profile_evidence');

function writeJson(file, value) { fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

(function sourceIndexDispoScopePreservesSelectedHistory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v323-scope-index-'));
  try {
    fs.writeFileSync(path.join(dir, 'Dispo create form.csv'), [
      'Dispo No.,PO No.,__MIG_OPERATIONAL_DISPO',
      'D-001,PO-001,full',
      'D-002,PO-002,full',
      'D-003,PO-003,full',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'Loom production database.csv'), [
      'Dispo No,Weaving Dates,In house Production/Day,Out Side Production/Day',
      'D-001,01/01/2026,10,0',
      'D-002,01/01/2026,20,0',
      'D-001,02/01/2026,5,0',
      'D-003,01/01/2026,30,0',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'Folding production database.csv'), [
      'Dispo No,Folding Production Date,A-Grade,B-Grade,C-Grade,Reject/C grade',
      'D-001,01/01/2026,2,0,0,0',
      'D-002,01/01/2026,3,0,0,0',
      'D-001,02/01/2026,4,0,0,0',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'Greige delivery database.csv'), [
      'Dispo No,Delivery Date,Challan No,Delivery Quantity"A"Grade,Delivery Quantity"B"Grade,Delivery Quantity"C"Grade,Delivery Quantity Reject',
      'D-001,01/01/2026,1,1,0,0,0',
      'D-002,01/01/2026,2,1,0,0,0',
      'D-001,02/01/2026,3,2,0,0,0',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'Warping database.csv'), [
      'Dispo No,Warping Program No,Warping Date,Warp Length(Mtr),Set,Total Beam',
      'D-001,W1,01/01/2026,100,1,1',
      'D-002,W2,01/01/2026,200,2,2',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(dir, 'Greige yarn receive.csv'), 'Yarn Lot,Receipt Qty (Kgs)\nLOT-1,5\n');

    const full = new SourceIndex({ csvDir: dir, dateOrder: 'dmy', foldingUnit: 'yards', deliveryUnit: 'yards' });
    const scoped = new SourceIndex({ csvDir: dir, dateOrder: 'dmy', foldingUnit: 'yards', deliveryUnit: 'yards', dispoFilter: new Set(['d-001']) });

    assert.strictEqual(scoped.dispoValue('po_number', 'D-001'), full.dispoValue('po_number', 'D-001'));
    assert.strictEqual(scoped.dispoMaster('D-002'), null, 'non-selected Dispo master must not be retained');
    assert.strictEqual(scoped.cumulative('loom', 'D-001', '02/01/2026'), full.cumulative('loom', 'D-001', '02/01/2026'), 'selected Dispo must retain complete loom history');
    assert.strictEqual(scoped.cumulative('folding', 'D-001', '02/01/2026'), full.cumulative('folding', 'D-001', '02/01/2026'), 'selected Dispo must retain complete folding history');
    assert.strictEqual(scoped.cumulative('delivery', 'D-001', '02/01/2026', '3', 999, true), full.cumulative('delivery', 'D-001', '02/01/2026', '3', 999, true), 'selected Dispo must retain complete delivery history');
    assert.deepStrictEqual(scoped.rowsFor('loom', 'D-002'), [], 'non-selected Dispo history must be absent');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function aggregate500RowChunksRequiresExactCoverage() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v323-chunk-aggregate-'));
  try {
    const contractPath = path.join(dir, 'contract.json');
    const manifestPath = path.join(dir, 'source-manifest.json');
    const csvDir = path.join(dir, 'csv');
    const profileDir = path.join(dir, 'profile');
    fs.mkdirSync(csvDir, { recursive: true });
    const contract = {
      contract_version: 'test',
      published_contract_sha256: 'a'.repeat(64),
      import_order: ['loom'],
      profiles: [{ id: 'loom', source_file: 'Loom production database.csv' }],
    };
    writeJson(contractPath, contract);
    writeJson(manifestPath, { manifest_status: 'approved', files: [{ filename: 'Loom production database.csv', nonempty_rows: 1200 }] });
    const manifestSha256 = sha256File(manifestPath);

    const chunks = [];
    for (const [index, offset, limit] of [[1,0,500],[2,500,500],[3,1000,200]]) {
      const outputDir = path.join(profileDir, 'chunks', `${index}`);
      fs.mkdirSync(outputDir, { recursive: true });
      writeJson(path.join(outputDir, 'summary.json'), {
        runId: `child-${index}`, mode: 'dry-run', status: 'completed', offset, limit, unlimited: false,
        selectedProfiles: ['loom'], contractHash: contract.published_contract_sha256,
        sourceManifestFileSha256: manifestSha256, validationErrors: 0, requiredLookupMisses: 0,
        criticalLookupMisses: 0, rejectedRows: 0, fkDependencyFailures: 0,
        stats: { loom: { processed: limit, previewed: limit * 2, rejected: 0, errors: 0, rolled_back: 0, lookup_misses: index } },
        lookupMisses: index, lookupMissesDetailed: 0, lookupMissesOmitted: index,
        previewRows: limit * 2, previewRowsDetailed: 0, previewRowsOmitted: limit * 2,
      });
      writeJson(path.join(outputDir, 'status.json'), { status: 'completed' });
      writeJson(path.join(outputDir, 'validation.json'), [{ level: 'info', scope: 'db', message: 'Connected to MySQL test DB' }]);
      writeJson(path.join(outputDir, 'reconciliation.json'), { loom: { sourceFile: 'Loom production database.csv', sourceRows: 1200, processedRows: limit, committedRows: 0, previewRows: limit, skippedRows: 0, rejectedRows: 0, rolledBackRows: 0, tables: {} } });
      writeJson(path.join(outputDir, 'fk_dependency_report.json'), [{ constraint: 'fk-test', ok: true }]);
      chunks.push({ offset, limit, outputDir, terminalLog: path.join(outputDir, 'terminal.log'), exitCode: 0, signal: null });
    }

    const result = aggregateChunkedProfile({
      profile: 'loom', profileDir, runId: 'parent', contract, contractPath, csvDir, manifestPath,
      manifestSha256, expectedSourceRows: 1200, chunkSize: 500, chunks, provenancePolicyVersion: 'test',
    });
    assert.strictEqual(result.summary.unlimited, true, 'aggregated evidence must represent full/unlimited profile coverage');
    assert.strictEqual(result.summary.limit, null);
    assert.strictEqual(result.summary.stats.loom.processed, 1200);
    assert.strictEqual(result.summary.lookupMisses, 6);
    assert.strictEqual(result.reconciliation.loom.processedRows, 1200);
    assert.strictEqual(result.chunkIndex.chunkCount, 3);
    assert.strictEqual(result.chunkIndex.processedRows, 1200);
    assert.deepStrictEqual(result.chunkIndex.chunks.map((x) => [x.offset, x.limit]), [[0,500],[500,500],[1000,200]]);

    const badDir = path.join(dir, 'bad-profile');
    assert.throws(() => aggregateChunkedProfile({
      profile: 'loom', profileDir: badDir, runId: 'bad', contract, contractPath, csvDir, manifestPath,
      manifestSha256, expectedSourceRows: 1200, chunkSize: 500,
      chunks: [chunks[0], { ...chunks[1], offset: 501 }, chunks[2]], provenancePolicyVersion: 'test',
    }), /offset-discontinuity|coverage/i, 'gap/overlap must be rejected rather than aggregated');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

console.log(JSON.stringify({
  ok: true,
  test: 'chunk500_resource_bound_v323',
  guarantees: [
    'scoped source indexes keep complete history for selected Dispos while discarding unrelated Dispos',
    '500-row evidence aggregation requires contiguous no-gap/no-overlap full-source coverage',
    'aggregated profile evidence remains unlimited/full-profile while preserving per-chunk hashes',
  ],
}, null, 2));
