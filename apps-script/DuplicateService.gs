/**
 * DuplicateService.gs — possible-duplicate detection.
 * Records are never deleted or blocked automatically; a match only sets Duplicate_Flag = TRUE
 * and writes the matching Record_IDs into Notes for the administrator to review.
 */

/** Order-independent name key: "Ola ADEBAYO" and "Adebayo Ola" give the same key. */
function nameKey_(name) {
  return cleanText_(name).toUpperCase().replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
}

/**
 * candidate: { nameKey, phone, position, fullPuCode }
 * existing:  [{ recordId, nameKey, phone, position, fullPuCode }]
 * Returns up to 5 matches: [{ recordId, reasons: [...] }]
 */
function findDuplicateMatches_(candidate, existing) {
  const matches = [];
  for (let i = 0; i < existing.length && matches.length < 5; i++) {
    const row = existing[i];
    const reasons = [];
    const sameName = candidate.nameKey !== '' && candidate.nameKey === row.nameKey;

    if (candidate.phone && candidate.phone === row.phone) reasons.push('same phone number');
    if (sameName && candidate.position === row.position) reasons.push('same name and position');
    if (sameName && candidate.fullPuCode === row.fullPuCode) reasons.push('same name and polling unit');

    if (reasons.length) matches.push({ recordId: row.recordId, reasons: reasons });
  }
  return matches;
}

function describeMatches_(matches) {
  if (!matches.length) return '';
  return 'Possible duplicate of ' + matches.slice(0, 3).map(function (m) {
    return m.recordId + ' (' + m.reasons.join(', ') + ')';
  }).join('; ');
}

/** Reads the columns needed for duplicate checks from COORDINATOR_RECORDS. */
function readExistingForDuplicates_() {
  const sheet = getOrCreateSheet_(TK27.SHEETS.RECORDS);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = sheet.getRange(2, 1, last - 1, TK27.HEADERS.RECORDS.length).getValues();
  return rows.map(function (r) {
    return {
      recordId: String(r[0]),
      position: String(r[4]),
      fullPuCode: String(r[9]) + '/' + String(r[11]),
      nameKey: String(r[19]),
      phone: String(r[20])
    };
  }).filter(function (r) { return r.recordId; });
}
