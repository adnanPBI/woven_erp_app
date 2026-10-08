'use strict';
const {yarnKey, eventKey, hydrateIdentities} = require('./yarn_sync_identity');

function matchYarn(previous, current) {
  previous = {...previous, records: previous.records.map(row => ({...row}))};
  hydrateIdentities(previous, current);
  const old = new Set(previous.records), fresh = new Set(current.records);
  const pairs = [], conflicts = [];
  const reviewedGroups = new Set(previous.records.filter(r => r.reviewedDigest).map(r => r.group));
  const pair = (a, b) => {
    pairs.push([a, b]); old.delete(a); fresh.delete(b);
  };
  // Explicit fingerprint-bound reviews have priority over automatic matching.
  for (const a of [...old]) if (a.reviewedDigest) {
    const candidates = [...fresh].filter(b => b.digest === a.reviewedDigest && b.group === a.group);
    if (candidates.length !== 1) throw Error('Reviewed correction is not unique within its destination group');
    pair(a, candidates[0]);
  }
  const byDigest = new Map();
  for (const row of old) {
    if (!byDigest.has(row.digest)) byDigest.set(row.digest, []);
    byDigest.get(row.digest).push(row);
  }
  for (const b of [...fresh]) {
    const a = byDigest.get(b.digest)?.pop();
    if (a) pair(a, b);
  }
  const unique = (key, compatible = () => true) => {
    const index = rows => {
      const groups = new Map();
      for (const row of rows) {
        const k = key(row);
        if (k) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(row); }
      }
      return groups;
    };
    const before = index(old), after = index(fresh);
    for (const [k, rows] of after) {
      const candidates = before.get(k) || [];
      if (rows.length === 1 && candidates.length === 1 && compatible(candidates[0], rows[0])) pair(candidates[0], rows[0]);
    }
  };
  // Existing exact-except-one-field signatures also work on legacy ledgers.
  unique(r => r.matchHash);
  unique(r => eventKey(r.yarnIdentity));
  unique(r => yarnKey(r.yarnIdentity), (a, b) => ['date', 'challan'].every(k =>
    !a.yarnIdentity[k] || !b.yarnIdentity[k] || a.yarnIdentity[k] === b.yarnIdentity[k]));
  // A date correction retains the full yarn key and the same challan.
  unique(r => {
    const k = yarnKey(r.yarnIdentity), c = r.yarnIdentity?.challan;
    return k && c ? JSON.stringify([k, c]) : null;
  });
  // One corrected yarn field may change its key. Require the full Dispo and
  // both event references, with one unambiguous old/new record on each side.
  unique(r => {
    const y = r.yarnIdentity;
    return yarnKey(y) && y.date && y.challan ? JSON.stringify([y.dispo, y.date, y.challan]) : null;
  }, (a, b) => ['count', 'lot', 'direction'].filter(k => a.yarnIdentity[k] !== b.yarnIdentity[k]).length === 1);

  for (const row of old) conflicts.push({reason: row.yarnIdentity ? 'ambiguous_yarn_edit_or_removal' : 'yarn_identity_backfill_required', sourceUid: row.uid, group: row.group});
  const inserts = [];
  const collisionKey = row => {
    const y = row.yarnIdentity, key = yarnKey(y);
    return key ? JSON.stringify([key,y.date,y.challan]) : null;
  };
  const priorEvents = new Set(previous.records.map(collisionKey).filter(Boolean));
  const digestCounts = new Map(), eventCounts = new Map();
  for (const row of current.records) {
    digestCounts.set(row.digest, (digestCounts.get(row.digest) || 0) + 1);
    const key = collisionKey(row);
    if (key) eventCounts.set(key, (eventCounts.get(key) || 0) + 1);
  }
  for (const [a, b] of pairs) {
    const key = collisionKey(b);
    if (!a.reviewedDigest && key && key !== collisionKey(a) && eventCounts.get(key) > 1) {
      conflicts.push({reason: 'yarn_correction_destination_not_unique', sourceUid: a.uid, rowNumber: b.rowNumber});
    }
  }
  for (const row of fresh) {
    const key = collisionKey(row);
    if (digestCounts.get(row.digest) > 1 || (!reviewedGroups.has(row.group) && key && (priorEvents.has(key) || eventCounts.get(key) > 1))) {
      conflicts.push({reason: 'duplicate_or_ambiguous_yarn_event', rowNumber: row.rowNumber, group: row.group});
    } else inserts.push(row);
  }
  return {pairs, inserts, conflicts};
}
module.exports = {matchYarn};
