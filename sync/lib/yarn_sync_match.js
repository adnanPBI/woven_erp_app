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
  // A blank quantity has no warp/weft direction. When the complete legacy
  // group is unique on both sides, keep that event binding without guessing
  // a direction. A subsequent numeric amount can restore its direction.
  const groupCounts=rows=>{const m=new Map();for(const r of rows)m.set(r.group,(m.get(r.group)||0)+1);return m;};
  const priorGroups=groupCounts(previous.records),currentGroups=groupCounts(current.records);
  unique(r=>r.group,(a,b)=>{
    const x=a.yarnIdentity,y=b.yarnIdentity;
    return priorGroups.get(a.group)===1&&currentGroups.get(b.group)===1&&x&&y&&
      (!x.direction||!y.direction)&&['dispo','count','lot','date','challan'].every(k=>x[k]===y[k]);
  });
  unique(r => {
    const y=r.yarnIdentity,key=yarnKey(y);
    return key&&y.date&&y.weavingReturnReference?JSON.stringify([key,y.date,y.weavingReturnReference]):null;
  });
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
  const amountGroups=new Map();
  for (const row of current.records) {
    digestCounts.set(row.digest, (digestCounts.get(row.digest) || 0) + 1);
    const key = collisionKey(row);
    if (key) eventCounts.set(key, (eventCounts.get(key) || 0) + 1);
    if(key){if(!amountGroups.has(key))amountGroups.set(key,[]);amountGroups.get(key).push(row);}
  }
  for (const [a, b] of pairs) {
    const key = collisionKey(b);
    if (!a.reviewedDigest && key && key !== collisionKey(a) && eventCounts.get(key) > 1) {
      conflicts.push({reason: 'yarn_correction_destination_not_unique', sourceUid: a.uid, rowNumber: b.rowNumber});
    }
  }
  for (const row of fresh) {
    const key = collisionKey(row);
    const siblings=amountGroups.get(key)||[];
    // Multiple supplied amounts are separate audit entries, even when the
    // complete challan/Dispo/date and yarn identity are the same. Exact copies,
    // missing references and unresolved edits still fail for review.
    const returnReferences=siblings.map(r=>r.yarnIdentity?.weavingReturnReference);
    const referencedReturns=row.yarnIdentity?.direction==='receipt'&&returnReferences.every(r=>/^ysr\d{6,20}$/.test(r||''))&&new Set(returnReferences).size===siblings.length;
    const separateAmounts=eventKey(row.yarnIdentity)&&(!/^(?:n\/?a|none|null|unknown|-)$/i.test(row.yarnIdentity.challan)||referencedReturns)&&siblings.length>1&&siblings.every(r=>r.entryAmounts)&&new Set(siblings.map(r=>r.digest)).size===siblings.length;
    if (digestCounts.get(row.digest) > 1 || (!separateAmounts&&!reviewedGroups.has(row.group) && key && (priorEvents.has(key) || eventCounts.get(key) > 1))) {
      conflicts.push({reason: 'duplicate_or_ambiguous_yarn_event', rowNumber: row.rowNumber, group: row.group});
    } else inserts.push(row);
  }
  return {pairs, inserts, conflicts};
}
module.exports = {matchYarn};
