/**
 * ExportService.gs — CSV exports for the administrator (opens directly in Excel).
 * Free-text cells that start with = + - @ are prefixed with an apostrophe so a spreadsheet never
 * runs them as formulas (CSV injection).
 */

const EXPORT_TYPES = {
  ALL: 'All records',
  STATE_EXCO: 'State Excos',
  LGA_COORDINATOR: 'LGA Coordinators',
  WARD_COORDINATOR: 'Ward Coordinators',
  DUPLICATES: 'Duplicate review list',
  MASTER: 'Master geography'
};

const FREE_TEXT_HEADERS = ['Name', 'LGA', 'Ward', 'Polling_Unit', 'Submitted_By', 'Notes', 'State'];

function csvCell_(value, protect) {
  let text = value == null ? '' : String(value);
  if (protect && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
  return text;
}

function toCsv_(headers, rows) {
  const protect = headers.map(function (h) { return FREE_TEXT_HEADERS.indexOf(h) !== -1; });
  const lines = [headers.map(function (h) { return csvCell_(h, false); }).join(',')];
  rows.forEach(function (row) {
    lines.push(headers.map(function (h, i) { return csvCell_(row[i], protect[i]); }).join(','));
  });
  return lines.join('\r\n');
}

function exportData(type) {
  if (!EXPORT_TYPES[type]) throw new AppError('VALIDATION_ERROR', 'Unknown export type.');
  let headers, rows;

  if (type === 'MASTER') {
    headers = TK27.HEADERS.MASTER;
    rows = readMasterRows_();
  } else {
    headers = TK27.HEADERS.RECORDS.slice(0, 18);   // internal helper columns are not exported
    rows = readRecordRows_().filter(function (r) {
      if (!r[0]) return false;
      if (type === 'ALL') return true;
      if (type === 'DUPLICATES') return String(r[13]) === 'TRUE';
      return String(r[4]) === type;
    }).map(function (r) { return r.slice(0, 18); });
  }

  const stamp = nowIso_().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  logAudit_('EXPORT', '', '', type + ' (' + rows.length + ' rows)', 'OK');
  return {
    filename: 'TK27_' + cfgStateSlug_() + '_' + type.toLowerCase() + '_' + stamp + '.csv',
    mimeType: 'text/csv',
    rowCount: rows.length,
    content: toCsv_(headers, rows)
  };
}

function cfgStateSlug_() {
  return String(getConfig_().ACTIVE_STATE || 'state').replace(/[^A-Za-z0-9]/g, '');
}
