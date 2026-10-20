/**
 * Utilities.gs — small reusable helpers (text cleaning, ids, sheet helpers).
 * Pure functions here are unit-tested outside Apps Script.
 */

function nowIso_() {
  return new Date().toISOString();
}

function newId_(prefix) {
  return prefix + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

function zeroPad_(value, width) {
  let text = String(value);
  while (text.length < width) text = '0' + text;
  return text;
}

// ---------------------------------------------------------------------------
// Text normalisation
// ---------------------------------------------------------------------------

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities_(text) {
  return String(text)
    .replace(/&#(\d+);/g, function (m, n) { return String.fromCharCode(Number(n)); })
    .replace(/&#x([0-9a-f]+);/gi, function (m, h) { return String.fromCharCode(parseInt(h, 16)); })
    .replace(/&([a-z]+);/gi, function (m, name) {
      const key = name.toLowerCase();
      return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : m;
    });
}

/** Removes tags (replacing them with a space so adjacent cells do not fuse), decodes entities. */
function stripTags_(html) {
  const withoutScripts = String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ');
  return cleanText_(decodeEntities_(withoutScripts.replace(/<[^>]*>/g, ' ')));
}

/** Trims and collapses all whitespace (including non-breaking spaces). */
function cleanText_(value) {
  return String(value == null ? '' : value).replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Title-cases a geographic name and repairs common source quirks:
 *   "ake ii"            -> "Ake II"
 *   "Ijade / Imepe Ii"  -> "Ijade/Imepe II"
 *   "Ode -Lemo"         -> "Ode-Lemo"   (tight hyphen, wards/LGAs only)
 * options.tightHyphen: remove spaces around hyphens (use for wards and LGAs).
 */
function normalizeName_(value, options) {
  const opts = options || {};
  let text = cleanText_(value);
  if (!text) return '';
  text = text.replace(/\s*\/\s*/g, '/');
  if (opts.tightHyphen) text = text.replace(/\s*-\s*/g, '-');
  text = text.toLowerCase().replace(/(^|[\s\/\-\.\(,])([a-z])/g, function (m, sep, ch) {
    return sep + ch.toUpperCase();
  });
  return text.replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix)\b/g, function (m) { return m.toUpperCase(); });
}

/** Upper-case, accent-free, alphanumeric-only key for comparisons. */
function compareKey_(value) {
  return cleanText_(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Normalises an INEC-style code: trims, converts '-' to '/', and zero-pads each
 * segment when the segment count matches `widths`. Otherwise returns the cleaned
 * text unchanged so validation can reject it.
 */
function normalizeCode_(value, widths) {
  const text = cleanText_(value).replace(/\s+/g, '').replace(/-/g, '/');
  if (!text) return '';
  const parts = text.split('/');
  if (parts.length !== widths.length) return text;
  if (!parts.every(function (p) { return /^\d+$/.test(p); })) return text;
  return parts.map(function (p, i) { return zeroPad_(p, widths[i]); }).join('/');
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function getOrCreateSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/**
 * Writes the header row if the sheet is empty. If a different header row is
 * already there it is left untouched (never destroy data) and false is returned.
 */
function ensureHeaders_(sheet, headers, forceText) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const existing = sheet.getLastRow() > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  const isBlank = existing.every(function (cell) { return cell === ''; });
  let matches = isBlank;
  if (!isBlank) {
    matches = headers.every(function (h, i) { return String(existing[i]) === h; });
  }
  if (isBlank) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  if (isBlank || matches) {
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setFontWeight('bold').setBackground('#F3F4F6');
    sheet.setFrozenRows(1);
    if (forceText) {
      sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).setNumberFormat('@');
    }
  }
  return matches;
}

/** Appends rows to a sheet in a single call. */
function appendRows_(sheetName, rows) {
  if (!rows.length) return;
  const sheet = getOrCreateSheet_(sheetName);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/** Clears all data rows below the header row. */
function clearDataRows_(sheet) {
  const last = sheet.getLastRow();
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, Math.max(sheet.getLastColumn(), 1)).clearContent();
  }
}

/** Returns data rows (below header) as arrays; [] when the sheet has no data. */
function readDataRows_(sheetName, width) {
  const sheet = getOrCreateSheet_(sheetName);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, width).getValues();
}
