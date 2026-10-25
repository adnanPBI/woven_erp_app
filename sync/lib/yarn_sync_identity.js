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
// Reconstruct only from a one-to-one source UID → provenance PK → business
// detail binding. This is READ-ONLY evidence: callers must not auto-release
// held events or write metadata without separate authorization.
function recoverFromVerifiedProvenance(profile, ledger, link, form, detail) {
  const reject=reason=>({ok:false,reason});
  if(!YARN_PROFILES.has(profile)||!ledger?.uid||!ledger?.digest||!ledger?.group||
     !ledger?.dispo||!link||!form||!detail)return reject('incomplete_preimage');
  const expectedTable=profile==='yarn-issue'?'yarn_issue_form':'yarn_receive_form';
  const foreignKey=profile==='yarn-issue'?'yarn_issue_form_id':'yarn_receive_form_id';
  if(link.profile!==profile||link.source_uid!==ledger.uid||
     link.target_table!==expectedTable||
     !/^[1-9]\d*$/.test(String(link.target_primary_key||''))||
     String(link.target_primary_key)!==String(form.id)||
     String(detail[foreignKey])!==String(form.id))return reject('provenance_target_mismatch');
  const dispo=normalize(detail.dispo_number);
  if(dispo!==normalize(ledger.dispo))return reject('dispo_preimage_mismatch');
  const count=normalize(form.yarn_count),lot=normalize(form.yarn_lot);
  const date=normalize(profile==='yarn-issue'?detail.issue_date:detail.received_date);
  const challan=normalize(profile==='yarn-issue'?form.issue_challan_no:form.challan_no);
  const brand=profile==='yarn-receive'?normalize(form.yarn_brand):null;
  if(!count||!lot||!dispo||!challan||
     !/^\d{4}-\d{2}-\d{2}$/.test(date)||
     (profile==='yarn-receive'&&!brand))return reject('incomplete_original_group_fields');
  const cols=profile==='yarn-issue'?
    [profile,count,lot,date,dispo,challan]:
    [profile,count,brand,lot,date,dispo,challan];
  const groupHash=require('crypto').createHash('sha256')
    .update(JSON.stringify(cols)).digest('hex');
  if(groupHash!==ledger.group)return reject('historical_group_digest_mismatch');
  let direction='receipt';
  if(profile==='yarn-issue'){
    const n=x=>Number(String(x??'0').replace(/,/g,''));
    const warp=n(form.total_warp_issue_kgs),weft=n(form.total_weft_issue_kgs);
    if(!Number.isFinite(warp)||!Number.isFinite(weft)||warp<0||weft<0)
      return reject('invalid_direction_values');
    if(warp>0&&weft===0)direction='warp';
    else if(weft>0&&warp===0)direction='weft';
    else return reject('warp_weft_direction_ambiguous');
  }
  const identity={version:1,dispo,count,lot,direction,date,challan};
  const evidenceDigest=require('crypto').createHash('sha256')
    .update(JSON.stringify([profile,ledger.uid,ledger.digest,ledger.group,
      expectedTable,String(form.id),String(detail.id),identity])).digest('hex');
  return {ok:true,identity,evidenceDigest,
    targetTable:expectedTable,targetPrimaryKey:String(form.id),
    targetDetailId:String(detail.id),requiresIndependentReview:true};
}
module.exports = {YARN_PROFILES, yarnIdentity, yarnKey, eventKey, parseIdentity, hydrateIdentities, ensureIdentityColumn, saveHydratedIdentities, recoverFromVerifiedProvenance};
