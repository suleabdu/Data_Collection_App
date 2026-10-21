/**
 * ValidationService.gs — server-side validation of a coordinator submission.
 * The browser also validates, but nothing here trusts it.
 * Pure functions (no Apps Script services) so they can be unit-tested.
 */

const MESSAGES = {
  position: 'Please select a position.',
  name: "Please enter the coordinator's full name (first and last name).",
  phone: 'Please enter a valid Nigerian phone number, for example 08012345678.',
  lga: 'Please select a local government.',
  ward: 'Please select a ward.',
  pu: 'Please select a valid polling unit.'
};

/**
 * Normalises a Nigerian mobile number to +234XXXXXXXXXX.
 * Accepts 08012345678, 8012345678, 2348012345678, +2348012345678, +234 801 234 5678,
 * and the common mistake +2340801234567 8. Returns '' when the number is not valid.
 */
function normalizePhone_(input) {
  let raw = String(input == null ? '' : input).replace(/[\s\-().]/g, '');
  if (!raw) return '';
  let national;
  if (raw.indexOf('+234') === 0) national = raw.slice(4);
  else if (raw.indexOf('234') === 0 && raw.length >= 13) national = raw.slice(3);
  else if (raw.charAt(0) === '0') national = raw.slice(1);
  else national = raw;

  if (national.charAt(0) === '0' && national.length === 11) national = national.slice(1);
  // Mobile prefixes: 70x, 80x, 81x, 90x, 91x.
  return /^[789][01]\d{8}$/.test(national) ? '+234' + national : '';
}

/** Capitalises a person's name only when it was typed all-lower or all-upper. */
function tidyPersonName_(value) {
  const text = cleanText_(value);
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, function (m, sep, ch) {
    return sep + ch.toUpperCase();
  });
}

/** Returns a cleaned name, or '' when it is not an acceptable full name. */
function validPersonName_(value) {
  const text = tidyPersonName_(value);
  if (text.length < 3 || text.length > 100) return '';
  if (!/^\p{L}[\p{L}\s'.\-]*$/u.test(text)) return '';
  const words = text.split(' ').filter(Boolean);
  if (words.length < 2) return '';
  if (text.replace(/[^\p{L}]/gu, '').length < 3) return '';
  return text;
}

/**
 * Validates the fields of a submission (not the geography lookups, which need the master list).
 * rules: { positions: ['STATE_EXCO', ...] }
 * Returns { errors: {field: message}, clean: {...} }.
 */
function validateSubmissionFields_(payload, rules) {
  const errors = {};
  const clean = {};
  const data = payload || {};

  const position = cleanText_(data.position);
  if (rules.positions.indexOf(position) === -1) errors.position = MESSAGES.position; else clean.position = position;

  const name = validPersonName_(data.name);
  if (!name) errors.name = MESSAGES.name; else clean.name = name;

  const phone = normalizePhone_(data.phone);
  if (!phone) errors.phone = MESSAGES.phone; else clean.phone = phone;

  const lga = normalizeCode_(data.lgaCode, [2, 2]);
  if (!TK27.CODE_PATTERNS.LGA.test(lga)) errors.lga = MESSAGES.lga; else clean.lgaCode = lga;

  const ward = normalizeCode_(data.wardCode, [2, 2, 2]);
  if (!TK27.CODE_PATTERNS.WARD.test(ward)) errors.ward = MESSAGES.ward; else clean.wardCode = ward;

  const pu = normalizeCode_(data.puCode, [2, 2, 2, 3]);
  if (!TK27.CODE_PATTERNS.PU.test(pu)) errors.pu = MESSAGES.pu; else clean.fullPuCode = pu;

  return { errors: errors, clean: clean };
}

/**
 * Cross-checks the chosen codes against each other and against the master list.
 * lookup: { lgaName(lgaCode), wardName(lgaCode, wardCode), pu(wardCode, fullPuCode) } — all return null when unknown.
 * Never trusts anything the browser sent beyond the codes themselves.
 */
function resolveGeography_(clean, lookup) {
  const errors = {};
  const lgaName = lookup.lgaName(clean.lgaCode);
  if (!lgaName) { errors.lga = MESSAGES.lga; return { errors: errors }; }

  if (clean.wardCode.indexOf(clean.lgaCode + '/') !== 0) { errors.ward = MESSAGES.ward; return { errors: errors }; }
  const wardName = lookup.wardName(clean.lgaCode, clean.wardCode);
  if (!wardName) { errors.ward = MESSAGES.ward; return { errors: errors }; }

  if (clean.fullPuCode.indexOf(clean.wardCode + '/') !== 0) { errors.pu = MESSAGES.pu; return { errors: errors }; }
  const pu = lookup.pu(clean.wardCode, clean.fullPuCode);
  if (!pu) { errors.pu = MESSAGES.pu; return { errors: errors }; }

  return {
    errors: errors,
    geo: {
      lgaName: lgaName, lgaCode: clean.lgaCode,
      wardName: wardName, wardCode: clean.wardCode,
      puName: pu.name, puCode: pu.code, fullPuCode: pu.fullCode
    }
  };
}
