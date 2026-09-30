'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT, loadEnv } = require('./common');

loadEnv();
let tokenCache = null;
let snapshotCache = null;
function snapshotProfile(spreadsheetId) {
  if (!process.env.GOOGLE_SNAPSHOT_DIR) return null;
  const dir = path.resolve(ROOT, process.env.GOOGLE_SNAPSHOT_DIR);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'snapshot.json'), 'utf8'));
  const profile = manifest.profiles.find(p => p.spreadsheetId === spreadsheetId);
  if (!profile) throw new Error('Spreadsheet missing from snapshot.');
  if (!snapshotCache || snapshotCache.id !== spreadsheetId) {
    const file = path.join(dir, profile.sourceFile);
    if (require('./common').sha256File(file) !== profile.sha256) throw new Error('Snapshot checksum mismatch.');
    snapshotCache = {id: spreadsheetId, rows: require('csv-parse/sync').parse(fs.readFileSync(file), {bom:true, relax_column_count:true})};
  }
  return {...profile, rows:snapshotCache.rows};
}

function base64url(value) {
  const b = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  return b.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function resolveKeyPath() {
  const configured = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './local_secrets/google-service-account.json';
  return path.resolve(ROOT, configured);
}
function readServiceAccount() {
  const keyPath = resolveKeyPath();
  if (!fs.existsSync(keyPath)) throw new Error(`Google service-account JSON not found: ${keyPath}`);
  const obj = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  if (!obj.client_email || !obj.private_key) throw new Error('Service-account JSON is missing client_email/private_key.');
  return obj;
}
async function getAccessToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60000) return tokenCache.accessToken;
  const sa = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), sa.private_key);
  const assertion = `${signingInput}.${base64url(signature)}`;
  const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
  const response = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) throw new Error(`Google OAuth token request failed (${response.status}): ${JSON.stringify(json)}`);
  tokenCache = { accessToken: json.access_token, expiresAt: Date.now() + Number(json.expires_in || 3600) * 1000 };
  return tokenCache.accessToken;
}
async function googleGet(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const token = await getAccessToken();
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
    const json = await response.json().catch(() => ({}));
    if (response.ok) return json;
    lastError = new Error(`Google Sheets API failed (${response.status}): ${JSON.stringify(json)}`);
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 5) throw lastError;
    const retryAfter = Number(response.headers.get('retry-after') || 0);
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : Math.min(16000, 1000 * (2 ** attempt));
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw lastError || new Error('Google Sheets API request failed.');
}
async function getSpreadsheetMetadata(spreadsheetId) {
  const snapshot = snapshotProfile(spreadsheetId);
  if (snapshot) return {properties:{title:snapshot.id}, sheets:[{properties:{title:snapshot.sheetName, gridProperties:{rowCount:snapshot.rows.length, columnCount:Math.max(...snapshot.rows.slice(0,3).map(r=>r.length))}}}]};
  const fields = encodeURIComponent('properties(title),sheets(properties(title,gridProperties(rowCount,columnCount)))');
  return googleGet(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${fields}`);
}
async function getValues(spreadsheetId, range) {
  const snapshot = snapshotProfile(spreadsheetId);
  if (snapshot) {
    const m = range.match(/!A(\d+):([A-Z]+)(\d+)$/);
    if (!m || !range.startsWith(`${quoteSheetName(snapshot.sheetName)}!`)) throw new Error('Unsupported snapshot range.');
    const cols = [...m[2]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
    return {values:snapshot.rows.slice(Number(m[1])-1, Number(m[3])).map(r=>r.slice(0,cols))};
  }
  const q = new URLSearchParams({ valueRenderOption: 'FORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING', majorDimension: 'ROWS' });
  return googleGet(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${q}`);
}
function columnLetter(n) {
  let s = ''; let x = Number(n);
  while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); }
  return s || 'A';
}
function quoteSheetName(name) { return `'${String(name).replace(/'/g, "''")}'`; }
module.exports = { getSpreadsheetMetadata, getValues, columnLetter, quoteSheetName, resolveKeyPath };
