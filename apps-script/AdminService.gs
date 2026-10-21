/**
 * AdminService.gs — administrator operations. Every admin action requires the passcode stored in
 * Script Properties (ADMIN_PASSCODE). This is a gate, not a user system: Version 1 has one admin role.
 */

function safeEquals_(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length === y.length ? 0 : 1;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

function requireAdmin_(passcode) {
  const stored = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSCODE');
  if (!stored || !safeEquals_(stored, String(passcode || ''))) {
    Utilities.sleep(1500); // slows down guessing
    throw new AppError('UNAUTHORIZED', 'Incorrect admin passcode.');
  }
}

function readRecordRows_() {
  return readDataRows_(TK27.SHEETS.RECORDS, TK27.HEADERS.RECORDS.length);
}

function recordRowToObject_(r) {
  return {
    recordId: String(r[0]), name: String(r[3]), position: String(r[4]), phone: String(r[5]),
    lga: String(r[6]), ward: String(r[8]), pollingUnit: String(r[10]), pollingUnitCode: String(r[11]),
    verificationStatus: String(r[12]), duplicate: String(r[13]) === 'TRUE',
    submittedAt: String(r[14]), notes: String(r[17])
  };
}

/** Pure: counts for the dashboard cards. */
function computeStats_(rows) {
  const stats = { total: 0, STATE_EXCO: 0, LGA_COORDINATOR: 0, WARD_COORDINATOR: 0, pendingReview: 0, possibleDuplicates: 0 };
  rows.forEach(function (r) {
    if (!r[0]) return;
    stats.total++;
    if (stats.hasOwnProperty(String(r[4]))) stats[String(r[4])]++;
    if (String(r[12]) === 'PENDING') stats.pendingReview++;
    if (String(r[13]) === 'TRUE') stats.possibleDuplicates++;
  });
  return stats;
}

function getDashboardStats() {
  const cfg = getConfig_();
  return {
    stats: computeStats_(readRecordRows_()),
    master: getMasterStatus(),
    applicationStatus: cfg.APPLICATION_STATUS,
    systemName: cfg.SYSTEM_NAME
  };
}

/**
 * Pure: analytics for the admin dashboard.
 * rows = COORDINATOR_RECORDS rows, index = buildGeoIndex_() result, now = Date (for the daily chart).
 * Days are bucketed in Nigerian time (UTC+1).
 */
function computeAnalytics_(rows, index, now) {
  const records = rows.filter(function (r) { return r[0]; });
  const byPosition = { STATE_EXCO: 0, LGA_COORDINATOR: 0, WARD_COORDINATOR: 0 };
  const byStatus = { PENDING: 0, VERIFIED: 0, REJECTED: 0 };
  const lgaStats = {};
  let wardsTotal = 0;

  index.lgas.forEach(function (l) {
    const wards = (index.wardsByLga[l.code] || []).length;
    wardsTotal += wards;
    lgaStats[l.code] = { code: l.code, lga: l.name, records: 0, lgaCoordinators: 0, wardCoordinators: 0,
      wardsTotal: wards, covered: {} };
  });

  const dayKey = function (ms) { return new Date(ms + 3600000).toISOString().slice(0, 10); };
  const daily = {};
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const key = dayKey(now.getTime() - i * 86400000);
    daily[key] = 0;
    days.push(key);
  }

  const coveredWards = {};
  let lastSubmission = '';
  records.forEach(function (r) {
    const position = String(r[4]), status = String(r[12]);
    if (byPosition.hasOwnProperty(position)) byPosition[position]++;
    if (byStatus.hasOwnProperty(status)) byStatus[status]++;

    const lga = lgaStats[String(r[7])];
    if (lga) {
      lga.records++;
      if (position === 'LGA_COORDINATOR') lga.lgaCoordinators++;
      if (position === 'WARD_COORDINATOR') { lga.wardCoordinators++; lga.covered[String(r[9])] = true; }
    }
    if (position === 'WARD_COORDINATOR') coveredWards[String(r[9])] = true;

    const ms = Date.parse(String(r[14]));
    if (!isNaN(ms)) {
      const key = dayKey(ms);
      if (daily.hasOwnProperty(key)) daily[key]++;
      if (String(r[14]) > lastSubmission) lastSubmission = String(r[14]);
    }
  });

  const lgas = Object.keys(lgaStats).sort().map(function (code) {
    const s = lgaStats[code];
    return { code: s.code, lga: s.lga, records: s.records, lgaCoordinators: s.lgaCoordinators,
      wardCoordinators: s.wardCoordinators, wardsTotal: s.wardsTotal, wardsCovered: Object.keys(s.covered).length };
  });

  return {
    total: records.length,
    byPosition: byPosition,
    byStatus: byStatus,
    daily: days.map(function (d) { return { date: d, count: daily[d] }; }),
    lgas: lgas,
    coverage: {
      wardsTotal: wardsTotal,
      wardsCovered: Object.keys(coveredWards).length,
      lgasTotal: lgas.length,
      lgasWithCoordinator: lgas.filter(function (l) { return l.lgaCoordinators > 0; }).length
    },
    lastSubmission: lastSubmission
  };
}

function getAnalytics() {
  return computeAnalytics_(readRecordRows_(), buildGeoIndex_(readMasterRows_()), new Date());
}

/** Pure: filter + paginate record rows (newest first). */
function filterRecords_(rows, params) {
  const q = compareKey_(params.q || '');
  // Phones are stored as +234XXXXXXXXXX but people search the way they type: 0801..., 801..., 234801...
  const nationalDigits = function (value) { return String(value || '').replace(/\D/g, '').replace(/^(234|0)/, ''); };
  const qPhone = nationalDigits(params.q);
  const out = rows.filter(function (r) {
    if (!r[0]) return false;
    if (params.position && String(r[4]) !== params.position) return false;
    if (params.status && String(r[12]) !== params.status) return false;
    if (params.duplicatesOnly && String(r[13]) !== 'TRUE') return false;
    if (q) {
      const haystack = compareKey_(r[3] + ' ' + r[6] + ' ' + r[8] + ' ' + r[10] + ' ' + r[0]);
      const phoneMatch = qPhone.length >= 4 && nationalDigits(r[5]).indexOf(qPhone) !== -1;
      if (haystack.indexOf(q) === -1 && !phoneMatch) return false;
    }
    return true;
  });
  return out.reverse();
}

function getRecordsPage(params) {
  const p = params || {};
  const pageSize = Math.min(Math.max(Number(p.pageSize) || 25, 1), 100);
  const page = Math.max(Number(p.page) || 1, 1);
  const filtered = filterRecords_(readRecordRows_(), p);
  const start = (page - 1) * pageSize;
  return {
    total: filtered.length, page: page, pageSize: pageSize,
    rows: filtered.slice(start, start + pageSize).map(recordRowToObject_)
  };
}

function setVerification(recordId, status) {
  if (TK27.VERIFICATION_STATUSES.indexOf(status) === -1) throw new AppError('VALIDATION_ERROR', 'Unknown status.');
  const sheet = getOrCreateSheet_(TK27.SHEETS.RECORDS);
  const rowNumber = findRowByKey_(sheet, 1, String(recordId || ''));
  if (!rowNumber) throw new AppError('NOT_FOUND', 'Record not found.');
  const old = String(sheet.getRange(rowNumber, 13).getValue());
  sheet.getRange(rowNumber, 13).setValue(status);
  sheet.getRange(rowNumber, 16).setValue(nowIso_());
  logAudit_('RECORD_VERIFY', recordId, old, status, 'OK');
  return { recordId: recordId, verificationStatus: status };
}

function getAuditLog(limit) {
  const max = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const sheet = getOrCreateSheet_(TK27.SHEETS.AUDIT);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const count = Math.min(max, last - 1);
  return sheet.getRange(last - count + 1, 1, count, TK27.HEADERS.AUDIT.length).getValues().reverse().map(function (r) {
    return { timestamp: String(r[1]), user: String(r[2]), action: String(r[3]), recordId: String(r[4]),
      oldValue: String(r[5]), newValue: String(r[6]), result: String(r[7]) };
  });
}

function setApplicationStatus(status) {
  if (['LIVE', 'PAUSED'].indexOf(status) === -1) throw new AppError('VALIDATION_ERROR', 'Unknown status.');
  setConfigValue_('APPLICATION_STATUS', status);
  logAudit_('APPLICATION_STATUS', '', '', status, 'OK');
  return { applicationStatus: status };
}

/** Rebuild the master from the web. Uses the document lock so submissions (script lock) are never blocked. */
function adminBuildMaster() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) throw new AppError('BUSY', 'A master build is already running. Please wait for it to finish.');
  try {
    return buildMasterFromWeb('ADMIN_PAGE');
  } finally {
    lock.releaseLock();
  }
}
