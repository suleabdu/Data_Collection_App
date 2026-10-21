/**
 * SubmissionService.gs — accepts one coordinator record.
 *
 *   validate fields -> resolve geography from the master -> duplicate check
 *   -> (lock) allocate Record_ID, append -> audit
 *
 * Idempotent: the browser sends a random submissionKey; a repeat of the same key (double tap,
 * retry after a dropped connection) returns the original result instead of creating a second row.
 */

const SUBMISSION_KEY_PATTERN = /^[A-Za-z0-9\-]{16,64}$/;
const SUBMISSION_CACHE_SECONDS = 6 * 60 * 60;

function recordIdPrefix_(stateCode, position) {
  return stateCode + '-' + TK27.POSITIONS[position].idCode + '-';
}

function formatRecordId_(stateCode, position, sequence) {
  return recordIdPrefix_(stateCode, position) + zeroPad_(sequence, 6);
}

/** Builds the 21-column COORDINATOR_RECORDS row. Pure. */
function buildRecordRow_(clean, geo, matches, recordId, timestamp, cfg, submissionKey) {
  return [
    recordId, cfg.ACTIVE_STATE, cfg.STATE_CODE, clean.name, clean.position, clean.phone,
    geo.lgaName, geo.lgaCode, geo.wardName, geo.wardCode, geo.puName, geo.puCode,
    'PENDING', matches.length ? 'TRUE' : 'FALSE', timestamp, timestamp,
    'public-form', describeMatches_(matches), submissionKey, nameKey_(clean.name), clean.phone
  ];
}

function successData_(recordId, clean, geo, matches) {
  return {
    recordId: recordId,
    duplicate: matches.length > 0,
    duplicateMessage: matches.length ? 'This coordinator may already exist in the database. The record was saved and flagged for review.' : '',
    summary: {
      name: clean.name,
      position: TK27.POSITIONS[clean.position].label,
      phone: clean.phone,
      lga: geo.lgaName, ward: geo.wardName, pollingUnit: geo.puName
    }
  };
}

/** Next sequence number for a Record_ID prefix. Must be called while holding the script lock. */
function nextSequence_(prefix, sheet) {
  const props = PropertiesService.getScriptProperties();
  const propKey = 'SEQ_' + prefix;
  let current = Number(props.getProperty(propKey));
  if (!current) {
    // Property missing (first use, or cleared): continue after the highest id already in the sheet.
    current = 0;
    const last = sheet.getLastRow();
    if (last >= 2) {
      sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) {
        const id = String(r[0]);
        if (id.indexOf(prefix) === 0) current = Math.max(current, Number(id.slice(prefix.length)) || 0);
      });
    }
  }
  const next = current + 1;
  props.setProperty(propKey, String(next));
  return next;
}

function findRowByKey_(sheet, column, value) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const hit = sheet.getRange(2, column, last - 1, 1).createTextFinder(value).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}

function submitCoordinator(payload) {
  const cfg = getConfig_();
  const data = payload || {};

  if (cfg.APPLICATION_STATUS === 'PAUSED') {
    throw new AppError('COLLECTION_PAUSED', 'Data collection is paused at the moment. Please try again later.');
  }
  if (cleanText_(data.website) !== '') {          // honeypot field, humans leave it empty
    throw new AppError('VALIDATION_ERROR', 'Unable to submit this record.');
  }
  const submissionKey = String(data.submissionKey || '');
  if (!SUBMISSION_KEY_PATTERN.test(submissionKey)) {
    throw new AppError('BAD_REQUEST', 'Unable to submit this record right now. Please refresh the page and try again.');
  }

  const cache = CacheService.getScriptCache();
  const cached = cache.get('sub:' + submissionKey);
  if (cached) return JSON.parse(cached);

  const positions = String(cfg.POSITION_OPTIONS).split(',').map(cleanText_).filter(function (p) { return TK27.POSITIONS[p]; });
  const checked = validateSubmissionFields_(data, { positions: positions });
  if (Object.keys(checked.errors).length) {
    throw new AppError('VALIDATION_ERROR', 'Please correct the highlighted fields.', checked.errors);
  }

  const resolved = resolveGeography_(checked.clean, makeGeoLookup_());
  if (Object.keys(resolved.errors).length) {
    throw new AppError('VALIDATION_ERROR', 'Please correct the highlighted fields.', resolved.errors);
  }

  const clean = checked.clean;
  const geo = resolved.geo;
  const matches = findDuplicateMatches_(
    { nameKey: nameKey_(clean.name), phone: clean.phone, position: clean.position, fullPuCode: geo.fullPuCode },
    readExistingForDuplicates_());

  const sheet = getOrCreateSheet_(TK27.SHEETS.RECORDS);
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    throw new AppError('BUSY', 'The system is busy. Please try again in a moment.');
  }

  let recordId;
  let repeat = false;
  try {
    const existingRow = findRowByKey_(sheet, 19, submissionKey);
    if (existingRow) {
      recordId = String(sheet.getRange(existingRow, 1).getValue());
      repeat = true;
    } else {
      const prefix = recordIdPrefix_(cfg.STATE_CODE, clean.position);
      recordId = formatRecordId_(cfg.STATE_CODE, clean.position, nextSequence_(prefix, sheet));
      const row = buildRecordRow_(clean, geo, matches, recordId, nowIso_(), cfg, submissionKey);
      sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    }
  } finally {
    lock.releaseLock();
  }

  const result = successData_(recordId, clean, geo, repeat ? [] : matches);
  try { cache.put('sub:' + submissionKey, JSON.stringify(result), SUBMISSION_CACHE_SECONDS); } catch (err) { /* optional */ }
  if (!repeat) logAudit_('RECORD_CREATE', recordId, '', clean.position + ' ' + geo.fullPuCode, matches.length ? 'DUPLICATE_FLAGGED' : 'OK');
  return result;
}
