'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { TextDecoder } = require('util');

function dedupeHeaders(headers) {
  const seen = new Map();
  return headers.map((header) => {
    const clean = String(header ?? '').replace(/^\uFEFF/, '').replace(/\u00a0/g, ' ').trim();
    const count = (seen.get(clean) || 0) + 1;
    seen.set(clean, count);
    return count === 1 ? clean : `${clean}_${count}`;
  });
}

function isNonEmptyRow(row) {
  return Array.isArray(row) && row.some((cell) => String(cell ?? '').replace(/\u00a0/g, ' ').trim() !== '');
}

/**
 * Synchronous, chunked CSV reader used by certification and immutable indexes.
 * It never loads the full file or all parsed rows into memory. Quoted commas,
 * escaped quotes and quoted line breaks are supported.
 */
function forEachCsvRowSync(filePath, onRow, { chunkSize = 1024 * 1024 } = {}) {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(chunkSize);
  const decoder = new TextDecoder('utf-8');
  const hash = crypto.createHash('sha256');
  let totalBytes = 0;
  let field = '';
  let row = [];
  let quoted = false;
  let quotePending = false;
  let skipLf = false;
  let firstCharacter = true;
  let logicalRowNumber = 0;
  let stopped = false;

  const emitRow = () => {
    row.push(field);
    field = '';
    logicalRowNumber += 1;
    const current = row;
    row = [];
    const result = onRow(current, logicalRowNumber);
    if (result === false) stopped = true;
  };

  const consumeUnquoted = (char) => {
    if (skipLf) {
      skipLf = false;
      if (char === '\n') return;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
      return;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      return;
    }
    if (char === '\r') {
      emitRow();
      skipLf = true;
      return;
    }
    if (char === '\n') {
      emitRow();
      return;
    }
    field += char;
  };

  const consumeText = (text) => {
    for (let index = 0; index < text.length && !stopped; index += 1) {
      let char = text[index];
      if (firstCharacter) {
        firstCharacter = false;
        if (char === '\uFEFF') continue;
      }
      if (quoted) {
        if (quotePending) {
          if (char === '"') {
            field += '"';
            quotePending = false;
            continue;
          }
          quoted = false;
          quotePending = false;
          consumeUnquoted(char);
          continue;
        }
        if (char === '"') quotePending = true;
        else field += char;
        continue;
      }
      consumeUnquoted(char);
    }
  };

  try {
    while (!stopped) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      const chunk = buffer.subarray(0, bytesRead);
      totalBytes += bytesRead;
      hash.update(chunk);
      consumeText(decoder.decode(chunk, { stream: true }));
    }
    if (!stopped) consumeText(decoder.decode());
    if (quotePending) {
      quotePending = false;
      quoted = false;
    }
    if (!stopped && (field.length > 0 || row.length > 0)) emitRow();
  } finally {
    fs.closeSync(fd);
  }

  return {
    rows: logicalRowNumber,
    size_bytes: totalBytes,
    sha256: hash.digest('hex'),
    stopped,
  };
}

function forEachCsvObjectSync(filePath, onObject, { headerRow = 0, includeBlank = false } = {}) {
  let headers = null;
  let rawHeaders = null;
  let parsedRows = 0;
  let nonEmptyRows = 0;
  let blankRows = 0;
  const meta = forEachCsvRowSync(filePath, (values, logicalRowNumber) => {
    if (logicalRowNumber <= headerRow) return true;
    if (logicalRowNumber === headerRow + 1) {
      rawHeaders = values.map((value) => String(value ?? '').replace(/^\uFEFF/, '').replace(/\u00a0/g, ' ').trim());
      headers = dedupeHeaders(rawHeaders);
      return true;
    }
    parsedRows += 1;
    const nonEmpty = isNonEmptyRow(values);
    if (!nonEmpty) {
      blankRows += 1;
      if (!includeBlank) return true;
    } else {
      nonEmptyRows += 1;
    }
    const record = {};
    headers.forEach((header, index) => { record[header] = values[index] ?? ''; });
    return onObject(record, {
      sourceRowNumber: logicalRowNumber,
      dataRowNumber: parsedRows,
      nonEmpty,
      values,
      headers,
      rawHeaders,
    });
  });
  return {
    ...meta,
    headers: headers || [],
    rawHeaders: rawHeaders || [],
    parsed_rows: parsedRows,
    nonempty_rows: nonEmptyRows,
    blank_rows: blankRows,
  };
}

async function* iterateCsvRows(filePath) {
  const decoder = new TextDecoder('utf-8');
  let field = '';
  let row = [];
  let quoted = false;
  let quotePending = false;
  let skipLf = false;
  let firstCharacter = true;
  let logicalRowNumber = 0;

  const completed = [];
  const emitRow = () => {
    row.push(field);
    field = '';
    logicalRowNumber += 1;
    completed.push({ values: row, logicalRowNumber });
    row = [];
  };
  const consumeUnquoted = (char) => {
    if (skipLf) {
      skipLf = false;
      if (char === '\n') return;
    }
    if (char === '"' && field.length === 0) { quoted = true; return; }
    if (char === ',') { row.push(field); field = ''; return; }
    if (char === '\r') { emitRow(); skipLf = true; return; }
    if (char === '\n') { emitRow(); return; }
    field += char;
  };
  const consumeText = (text) => {
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (firstCharacter) {
        firstCharacter = false;
        if (char === '\uFEFF') continue;
      }
      if (quoted) {
        if (quotePending) {
          if (char === '"') { field += '"'; quotePending = false; continue; }
          quoted = false;
          quotePending = false;
          consumeUnquoted(char);
          continue;
        }
        if (char === '"') quotePending = true;
        else field += char;
      } else consumeUnquoted(char);
    }
  };

  for await (const chunk of fs.createReadStream(filePath)) {
    consumeText(decoder.decode(chunk, { stream: true }));
    while (completed.length) yield completed.shift();
  }
  consumeText(decoder.decode());
  if (quotePending) { quotePending = false; quoted = false; }
  if (field.length > 0 || row.length > 0) emitRow();
  while (completed.length) yield completed.shift();
}

module.exports = {
  dedupeHeaders,
  isNonEmptyRow,
  forEachCsvRowSync,
  forEachCsvObjectSync,
  iterateCsvRows,
};
