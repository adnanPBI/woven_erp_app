'use strict';

function parseCsvRows(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0 || text.endsWith(',')) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function dedupeHeaders(headers) {
  const seen = new Map();
  return headers.map((header) => {
    const clean = String(header ?? '').replace(/\u00a0/g, ' ').trim();
    const count = (seen.get(clean) || 0) + 1;
    seen.set(clean, count);
    return count === 1 ? clean : `${clean}_${count}`;
  });
}

function parseCsvObjects(input) {
  const rows = parseCsvRows(input);
  const headers = dedupeHeaders(rows[0] || []);
  return rows.slice(1).map((values) => {
    const record = {};
    headers.forEach((header, index) => { record[header] = values[index] ?? ''; });
    return record;
  });
}

module.exports = { parseCsvRows, parseCsvObjects, dedupeHeaders };
