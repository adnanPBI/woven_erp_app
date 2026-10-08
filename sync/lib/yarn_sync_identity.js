'use strict';

const YARN_PROFILES = new Set(['yarn-issue', 'yarn-receive']);
// Never strip a factory prefix, slash component or leading zero from a Dispo.
const normalize = value => String(value ?? '').trim().toLowerCase();
function yarnIdentity(profile, headers, values) {
  if (!YARN_PROFILES.has(profile)) return null;
  const get = name => normalize(values[headers.indexOf(name)]);
  let direction = 'receipt'; // Receipt source has no warp/weft column.
  if (profile === 'yarn-issue') {
    const populated = ['Warp', 'Weft'].filter(h => get(h) !== '');
    const active = populated.filter(h => Number(get(h).replace(/,/g, '')) !== 0);
    direction = (active.length ? active : populated).map(h => h.toLowerCase()).join('+');
  }
  return {
    version: 1,
    dispo: get(profile === 'yarn-issue' ? 'Dispo No' : 'Received GD NO'),
    count: get('Yarn Count'), lot: get('Yarn Lot'), direction,
    date: get(profile === 'yarn-issue' ? 'Issue Date' : 'Received Date'),
    challan: get(profile === 'yarn-issue' ? 'S/R/Challan No' : 'Challan No'),
  };
}
function parseIdentity(value) {
  if (!value) return null;
  const identity = typeof value === 'string' ? JSON.parse(value) : value;
  if (identity.version !== 1) throw Error('Unsupported yarn identity version');
  return identity;
}
function yarnKey(identity) {
  const r = parseIdentity(identity);
  if (!r || !r.dispo || !r.count || !r.lot || !r.direction) return null;
  return JSON.stringify([r.dispo, r.count, r.direction, r.lot]);
}
function eventKey(identity) {
  const r = parseIdentity(identity), key = yarnKey(r);
  return key && r.date && r.challan ? JSON.stringify([key, r.date, r.challan]) : null;
}
// A legacy matchHash excludes only Last Received Date (receipts) or Delivery
// Place (issues). Neither is an identity field; an exact signature therefore
// proves the entire yarn identity even if that one non-identity field changed.
function hydrateIdentities(previous, snapshot) {
  const byDigest = new Map();
  const bySignature = new Map();
  for (const row of snapshot.records) {
    if (!row.yarnIdentity) continue;
    byDigest.set(row.digest, row.yarnIdentity);
    if (row.matchHash) {
      const value = JSON.stringify(parseIdentity(row.yarnIdentity));
      if (!bySignature.has(row.matchHash)) bySignature.set(row.matchHash, value);
      else if (bySignature.get(row.matchHash) !== value) bySignature.set(row.matchHash, null);
    }
  }
  const hydrated = [];
  for (const row of previous.records) {
    row.yarnIdentity = parseIdentity(row.yarnIdentity);
    if (!row.yarnIdentity && byDigest.has(row.digest)) {
      row.yarnIdentity = byDigest.get(row.digest);
      hydrated.push(row);
    } else if (!row.yarnIdentity && row.matchHash && bySignature.get(row.matchHash)) {
      row.yarnIdentity = JSON.parse(bySignature.get(row.matchHash));
      hydrated.push(row);
    }
  }
  return hydrated;
}
async function ensureIdentityColumn(connection) {
  const [columns] = await connection.query("SHOW COLUMNS FROM sheets_sync_events LIKE 'yarn_identity'");
  if (!columns.length) await connection.query('ALTER TABLE sheets_sync_events ADD COLUMN yarn_identity longtext NULL');
}
async function saveHydratedIdentities(connection, profile, rows) {
  if (!rows.length) return;
  await connection.beginTransaction();
  try {
    for (const row of rows) await connection.query(
      'UPDATE sheets_sync_events SET yarn_identity=? WHERE profile=? AND source_uid=? AND digest=? AND yarn_identity IS NULL',
      [JSON.stringify(row.yarnIdentity), profile, row.uid, row.digest]);
    await connection.commit();
  } catch (error) { await connection.rollback(); throw error; }
}
module.exports = {YARN_PROFILES, yarnIdentity, yarnKey, eventKey, parseIdentity, hydrateIdentities, ensureIdentityColumn, saveHydratedIdentities};
