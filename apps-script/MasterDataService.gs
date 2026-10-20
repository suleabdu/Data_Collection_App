/**
 * MasterDataService.gs — builds MASTER_GEOGRAPHY.
 *
 *   source (web pages or CSV)  ->  RAW_IMPORT  ->  normalise  ->  validate
 *                              ->  NORMALIZED_GEOGRAPHY  ->  MASTER_GEOGRAPHY (only if validation passes)
 *
 * The published master is only touched after validation succeeds, so a failed
 * import can never destroy the previous valid master list.
 *
 * Code convention stored in the master (INEC format):
 *   LGA_Code = "27/01"   Ward_Code = "27/01/03"   Polling_Unit_Code = "001"   Full_PU_Code = "27/01/03/001"
 */

// ===========================================================================
// 1. SOURCE PARSERS (pure — no Apps Script services)
// ===========================================================================

/**
 * Parses the ward index page. Expects, in document order:
 *   <h3>Abeokuta North Local Government</h3>
 *   <a href=".../ward/27-01-03">Ago Oko 27/01/03 APC 17 PUs</a> ...
 * Returns { wards: [{lga, ward, wardCode, expectedPUs}], sourceTotals: {wards, pus, lgas} | null }.
 */
function parseWardIndex_(html, stateNo) {
  const tokenRe = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>|<a\s[^>]*?href="([^"]*\/ward\/(\d{2}-\d{2}-\d{2}))"[^>]*>([\s\S]*?)<\/a>/gi;
  const wards = [];
  const seen = {};
  let currentLga = '';
  let match;

  while ((match = tokenRe.exec(html)) !== null) {
    if (match[1] !== undefined) {
      const heading = stripTags_(match[1]);
      const lgaMatch = /^(.*?)\s+Local Government(?: Area)?$/i.exec(heading);
      if (lgaMatch) currentLga = cleanText_(lgaMatch[1]);
      continue;
    }

    const wardCode = match[3].replace(/-/g, '/');
    if (stateNo && wardCode.split('/')[0] !== stateNo) continue;
    if (seen[wardCode]) continue;

    const text = stripTags_(match[4]);
    const at = text.lastIndexOf(wardCode);
    const name = cleanText_(at > 0 ? text.slice(0, at) : text);
    const puMatch = /(\d[\d,]*)\s*PUs?\b/i.exec(at >= 0 ? text.slice(at + wardCode.length) : text);

    seen[wardCode] = true;
    wards.push({
      lga: currentLga,
      ward: name,
      wardCode: wardCode,
      expectedPUs: puMatch ? Number(puMatch[1].replace(/,/g, '')) : null
    });
  }

  // Matches both the page body and the meta description (raw html is searched too).
  const totalsMatch = /(\d[\d,]*)\s+electoral wards and\s+(\d[\d,]*)\s+polling units(?:\s+spread)?\s+across\s+(\d+)\s+local government/i.exec(
    stripTags_(html) + ' ' + html);
  const sourceTotals = totalsMatch ? {
    wards: Number(totalsMatch[1].replace(/,/g, '')),
    pus: Number(totalsMatch[2].replace(/,/g, '')),
    lgas: Number(totalsMatch[3])
  } : null;

  return { wards: wards, sourceTotals: sourceTotals };
}

/**
 * Parses one ward page. Finds table rows containing a full polling-unit code
 * (NN/NN/NN/NNN); the polling-unit name is the cell just before the code.
 * Returns [{ name, puCode }].
 */
function parseWardPage_(html) {
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const codeRe = /^\d{2}\/\d{2}\/\d{2}\/\d{3}$/;
  let rowMatch;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = [];
    let cellMatch;
    cellRe.lastIndex = 0;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) cells.push(stripTags_(cellMatch[1]));

    for (let i = 0; i < cells.length; i++) {
      if (codeRe.test(cells[i])) {
        rows.push({ name: i > 0 ? cells[i - 1] : '', puCode: cells[i] });
        break;
      }
    }
  }
  return rows;
}

// ===========================================================================
// 2. NORMALISATION & VALIDATION (pure)
// ===========================================================================

/** Raw record -> normalised record. */
function normalizeRawRecord_(raw, cfg) {
  const stateNo = String(cfg.INEC_STATE_NO || '').trim();
  let full = normalizeCode_(raw.puCode, [2, 2, 2, 3]);
  let ward = normalizeCode_(raw.wardCode, [2, 2, 2]);
  let lga = normalizeCode_(raw.lgaCode, [2, 2]);

  // A bare LGA number ("01") means stateNo/01.
  if (/^\d{1,2}$/.test(cleanText_(raw.lgaCode)) && stateNo) {
    lga = stateNo + '/' + zeroPad_(cleanText_(raw.lgaCode), 2);
  }
  // A bare PU number ("001") is combined with the ward code.
  if (/^\d{1,3}$/.test(cleanText_(raw.puCode)) && ward) {
    full = ward + '/' + zeroPad_(cleanText_(raw.puCode), 3);
  }

  const parts = full.split('/');
  const derivedWard = parts.length === 4 ? parts.slice(0, 3).join('/') : '';
  const derivedLga = parts.length === 4 ? parts.slice(0, 2).join('/') : '';

  return {
    rowNumber: raw.rowNumber,
    state: normalizeName_(raw.state || cfg.ACTIVE_STATE, { tightHyphen: true }),
    lga: normalizeName_(raw.lga, { tightHyphen: true }),
    ward: normalizeName_(raw.ward, { tightHyphen: true }),
    pu: normalizeName_(raw.pu),
    givenLgaCode: lga,
    givenWardCode: ward,
    lgaCode: lga || derivedLga,
    wardCode: ward || derivedWard,
    fullPuCode: full,
    puCode: parts.length === 4 ? parts[3] : '',
    expectedWardPUs: raw.expectedWardPUs === '' || raw.expectedWardPUs == null ? null : Number(raw.expectedWardPUs)
  };
}

/**
 * Validates normalised rows and builds the master rows.
 * Pure: no sheet access. Returns { report, issues, normalizedRows, masterRows }.
 */
function validateAndBuild_(rows, cfg, ctx, existingCreated) {
  const issues = (ctx.preIssues || []).slice();
  const add = function (severity, code, message, reference) {
    issues.push({ severity: severity, code: code, message: message, reference: reference || '' });
  };
  const stateNo = String(cfg.INEC_STATE_NO || '').trim();
  const stateCode = cfg.STATE_CODE;
  const patterns = TK27.CODE_PATTERNS;

  let invalid = 0, orphans = 0, duplicates = 0;
  const accepted = [];
  const byFull = {};
  const normalizedOut = [];

  rows.forEach(function (row) {
    const ref = 'row ' + row.rowNumber + ' (' + (row.fullPuCode || 'no code') + ')';
    let status = 'VALID';
    let note = '';

    const missing = [];
    if (!row.lga) missing.push('LGA');
    if (!row.ward) missing.push('Ward');
    if (!row.pu) missing.push('Polling Unit');
    if (!row.fullPuCode) missing.push('PU code');

    if (missing.length) {
      status = 'INVALID'; note = 'Missing: ' + missing.join(', ');
      add('ERROR', 'MISSING_FIELD', note, ref);
    } else if (!patterns.PU.test(row.fullPuCode)) {
      status = 'INVALID'; note = 'Malformed polling-unit code';
      add('ERROR', 'BAD_PU_CODE', 'Malformed polling-unit code "' + row.fullPuCode + '"', ref);
    } else if (stateNo && row.fullPuCode.split('/')[0] !== stateNo) {
      status = 'INVALID'; note = 'Code belongs to another state';
      add('ERROR', 'WRONG_STATE', 'Code ' + row.fullPuCode + ' is not in state ' + stateNo, ref);
    } else if (!patterns.WARD.test(row.wardCode) || !patterns.LGA.test(row.lgaCode)) {
      status = 'INVALID'; note = 'Malformed ward/LGA code';
      add('ERROR', 'BAD_PARENT_CODE', 'Malformed ward or LGA code', ref);
    } else if (row.fullPuCode.indexOf(row.wardCode + '/') !== 0 || row.wardCode.indexOf(row.lgaCode + '/') !== 0) {
      status = 'ORPHAN'; note = 'Code hierarchy mismatch';
      add('ERROR', 'ORPHAN_RECORD', 'Polling unit ' + row.fullPuCode + ' does not sit under ward ' + row.wardCode +
        ' / LGA ' + row.lgaCode, ref);
    }

    if (status === 'INVALID') invalid++;
    if (status === 'ORPHAN') orphans++;

    if (status === 'VALID') {
      const first = byFull[row.fullPuCode];
      if (!first) {
        byFull[row.fullPuCode] = row;
        accepted.push(row);
      } else if (first.lga === row.lga && first.ward === row.ward && first.pu === row.pu) {
        status = 'DUPLICATE'; note = 'Exact duplicate removed';
        duplicates++;
        add('WARNING', 'EXACT_DUPLICATE', 'Exact duplicate of ' + row.fullPuCode + ' removed', ref);
      } else {
        status = 'INVALID'; note = 'Conflicting duplicate code';
        invalid++;
        add('ERROR', 'CONFLICTING_DUPLICATE', 'Code ' + row.fullPuCode + ' appears with different names ("' +
          first.pu + '" vs "' + row.pu + '")', ref);
      }
    }

    normalizedOut.push([
      ctx.importId, row.state, stateCode, row.lga, row.lgaCode, row.ward, row.wardCode,
      row.pu, row.puCode, row.fullPuCode, status, note
    ]);
  });

  // ---- hierarchy conflicts across accepted rows ----
  const wardNames = {}, wardLgas = {}, lgaNames = {}, lgaCodesByName = {};
  const wardsByLga = {}, pusByWard = {}, puNameKeys = {};
  const addTo = function (map, key, value) {
    (map[key] = map[key] || {})[value] = true;
  };

  accepted.forEach(function (row) {
    addTo(wardNames, row.wardCode, row.ward);
    addTo(wardLgas, row.wardCode, row.lga);
    addTo(lgaNames, row.lgaCode, row.lga);
    addTo(lgaCodesByName, row.lga, row.lgaCode);
    addTo(wardsByLga, row.lgaCode, row.wardCode);
    (pusByWard[row.wardCode] = pusByWard[row.wardCode] || []).push(row);
  });

  Object.keys(wardLgas).forEach(function (code) {
    if (Object.keys(wardLgas[code]).length > 1) {
      add('ERROR', 'WARD_IN_MULTIPLE_LGAS', 'Ward ' + code + ' belongs to conflicting LGAs: ' + Object.keys(wardLgas[code]).join(' / '), code);
    }
  });
  Object.keys(wardNames).forEach(function (code) {
    if (Object.keys(wardNames[code]).length > 1) {
      add('ERROR', 'WARD_CODE_MULTIPLE_NAMES', 'Ward code ' + code + ' has several names: ' + Object.keys(wardNames[code]).join(' / '), code);
    }
  });
  Object.keys(lgaNames).forEach(function (code) {
    if (Object.keys(lgaNames[code]).length > 1) {
      add('ERROR', 'LGA_CODE_MULTIPLE_NAMES', 'LGA code ' + code + ' has several names: ' + Object.keys(lgaNames[code]).join(' / '), code);
    }
  });
  Object.keys(lgaCodesByName).forEach(function (name) {
    if (Object.keys(lgaCodesByName[name]).length > 1) {
      add('ERROR', 'LGA_NAME_MULTIPLE_CODES', 'LGA "' + name + '" has several codes: ' + Object.keys(lgaCodesByName[name]).join(' / '), name);
    }
  });

  // Same ward name twice under one LGA makes the dropdown ambiguous (warning only).
  Object.keys(wardsByLga).forEach(function (lgaCode) {
    const byName = {};
    Object.keys(wardsByLga[lgaCode]).forEach(function (wardCode) {
      const name = Object.keys(wardNames[wardCode])[0];
      (byName[compareKey_(name)] = byName[compareKey_(name)] || []).push(wardCode);
    });
    Object.keys(byName).forEach(function (key) {
      if (byName[key].length > 1) {
        add('WARNING', 'DUPLICATE_WARD_NAME', 'Wards ' + byName[key].join(', ') + ' share a name within LGA ' + lgaCode, lgaCode);
      }
    });
  });

  // Same PU name twice in one ward (warning only; codes still distinguish them).
  Object.keys(pusByWard).forEach(function (wardCode) {
    const seen = {};
    pusByWard[wardCode].forEach(function (row) {
      const key = compareKey_(row.pu);
      if (seen[key]) {
        add('WARNING', 'DUPLICATE_PU_NAME', 'Ward ' + wardCode + ' has two polling units named "' + row.pu + '"', row.fullPuCode);
      }
      seen[key] = true;
    });
  });

  // ---- completeness: advertised PU count per ward ----
  Object.keys(pusByWard).forEach(function (wardCode) {
    const expected = pusByWard[wardCode].reduce(function (acc, row) {
      return acc === null ? row.expectedWardPUs : acc;
    }, null);
    if (expected !== null && expected !== pusByWard[wardCode].length) {
      add('ERROR', 'WARD_PU_COUNT_MISMATCH', 'Ward ' + wardCode + ' has ' + pusByWard[wardCode].length +
        ' polling units but the source advertises ' + expected, wardCode);
    }
  });

  const lgaCount = Object.keys(lgaNames).length;
  const wardCount = Object.keys(wardNames).length;
  const puCount = accepted.length;

  if (ctx.sourceTotals) {
    const t = ctx.sourceTotals;
    if (t.lgas !== lgaCount || t.wards !== wardCount || t.pus !== puCount) {
      add('ERROR', 'SOURCE_TOTAL_MISMATCH', 'Collected ' + lgaCount + ' LGAs / ' + wardCount + ' wards / ' + puCount +
        ' PUs but the source itself states ' + t.lgas + ' / ' + t.wards + ' / ' + t.pus + ' (incomplete import)', '');
    }
  }

  // ---- reconciliation with INEC published totals (warning: counts can legitimately change) ----
  const expectedLgas = Number(cfg.EXPECTED_LGAS || 0);
  const expectedWards = Number(cfg.EXPECTED_WARDS || 0);
  const expectedPus = Number(cfg.EXPECTED_PUS || 0);
  if ((expectedLgas && expectedLgas !== lgaCount) || (expectedWards && expectedWards !== wardCount) ||
      (expectedPus && expectedPus !== puCount)) {
    add('WARNING', 'COUNT_DIFFERS_FROM_INEC_TOTALS', 'Collected ' + lgaCount + ' LGAs / ' + wardCount + ' wards / ' + puCount +
      ' PUs; INEC totals configured as ' + expectedLgas + ' / ' + expectedWards + ' / ' + expectedPus, '');
  }

  if (cfg.MASTER_SOURCE_VERIFICATION !== 'OFFICIAL') {
    add('WARNING', 'SOURCE_UNVERIFIED', 'Source "' + cfg.MASTER_SOURCE_NAME +
      '" is a third-party compilation, not an INEC publication. Verify before treating it as official.', '');
  }

  const hasError = issues.some(function (i) { return i.severity === 'ERROR'; });
  const hasWarning = issues.some(function (i) { return i.severity === 'WARNING'; });
  const status = hasError ? 'FAILED' : (hasWarning ? 'WARNING' : 'VALID');

  // ---- master rows ----
  const sourceLabel = cfg.MASTER_SOURCE_NAME + (cfg.MASTER_SOURCE_VERIFICATION === 'OFFICIAL' ? '' : ' [unverified]');
  const today = (ctx.retrievedAt || new Date()).toISOString().slice(0, 10);
  const stamp = nowIso_();
  const created = existingCreated || {};

  const sorted = accepted.slice().sort(function (a, b) {
    return a.fullPuCode < b.fullPuCode ? -1 : (a.fullPuCode > b.fullPuCode ? 1 : 0);
  });
  const masterRows = sorted.map(function (row) {
    const id = stateCode + '-' + row.fullPuCode.split('/').slice(1).join('-');
    return [
      id, row.state, stateCode, row.lga, row.lgaCode, row.ward, row.wardCode,
      row.pu, row.puCode, row.fullPuCode, 'ACTIVE', sourceLabel, today, created[id] || stamp, stamp
    ];
  });

  const report = {
    totalSource: rows.length,
    valid: rows.length - invalid - orphans,
    invalid: invalid,
    duplicates: duplicates,
    orphans: orphans,
    finalMaster: masterRows.length,
    lgas: lgaCount,
    wards: wardCount,
    pollingUnits: puCount,
    status: status,
    errors: issues.filter(function (i) { return i.severity === 'ERROR'; }).length,
    warnings: issues.filter(function (i) { return i.severity === 'WARNING'; }).length
  };

  return { report: report, issues: issues, normalizedRows: normalizedOut, masterRows: masterRows };
}

/** Maps a 2-D array (CSV with header row) to raw records. Header names are matched loosely. */
function csvRowsToRaw_(table, meta) {
  if (!table.length) return [];
  const aliases = {
    state: ['state', 'rawstate'],
    lga: ['lga', 'localgovernment', 'localgovernmentarea', 'lganame', 'rawlga'],
    ward: ['ward', 'wardname', 'registrationarea', 'rawward'],
    pu: ['pollingunit', 'pollingunitname', 'pu', 'puname', 'rawpollingunit'],
    stateCode: ['statecode', 'rawstatecode'],
    lgaCode: ['lgacode', 'lgaid', 'rawlgacode'],
    wardCode: ['wardcode', 'wardid', 'rawwardcode'],
    puCode: ['fullpucode', 'pucode', 'pollingunitcode', 'rawpucode']
  };
  const header = table[0].map(function (h) { return compareKey_(h).toLowerCase(); });
  const index = {};
  Object.keys(aliases).forEach(function (field) {
    for (let i = 0; i < header.length; i++) {
      if (aliases[field].indexOf(header[i]) !== -1) { index[field] = i; return; }
    }
  });

  const out = [];
  for (let r = 1; r < table.length; r++) {
    const line = table[r];
    if (line.every(function (c) { return cleanText_(c) === ''; })) continue;
    const pick = function (field) { return index[field] === undefined ? '' : line[index[field]]; };
    out.push({
      rowNumber: r + 1,
      importId: meta.importId, source: meta.source, sourceUrl: meta.sourceUrl, retrievedAt: meta.retrievedAt,
      state: pick('state'), lga: pick('lga'), ward: pick('ward'), pu: pick('pu'),
      stateCode: pick('stateCode'), lgaCode: pick('lgaCode'), wardCode: pick('wardCode'), puCode: pick('puCode'),
      expectedWardPUs: ''
    });
  }
  return out;
}

// ===========================================================================
// 3. RAW <-> sheet conversion
// ===========================================================================

function rawToRow_(raw) {
  return [raw.importId, raw.source, raw.sourceUrl, raw.retrievedAt, raw.state, raw.lga, raw.ward, raw.pu,
    raw.stateCode, raw.lgaCode, raw.wardCode, raw.puCode,
    raw.expectedWardPUs === null || raw.expectedWardPUs === undefined ? '' : raw.expectedWardPUs];
}

function rowToRaw_(row, index) {
  return {
    rowNumber: index + 2,
    importId: row[0], source: row[1], sourceUrl: row[2], retrievedAt: row[3],
    state: row[4], lga: row[5], ward: row[6], pu: row[7],
    stateCode: row[8], lgaCode: row[9], wardCode: row[10], puCode: row[11],
    expectedWardPUs: row[12]
  };
}

function replaceRawImport_(rawRecords) {
  const sheet = getOrCreateSheet_(TK27.SHEETS.RAW);
  clearDataRows_(sheet);
  if (!rawRecords.length) return;
  const rows = rawRecords.map(rawToRow_);
  if (sheet.getMaxRows() < rows.length + 1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  }
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

// ===========================================================================
// 4. WEB FETCHING (Apps Script services)
// ===========================================================================

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; TK27-master-importer; +admin)',
  'Accept': 'text/html,application/xhtml+xml'
};

function fetchOptions_(url) {
  return { url: url, method: 'get', muteHttpExceptions: true, followRedirects: true, headers: FETCH_HEADERS };
}

function fetchWithRetry_(url, attempts) {
  let last = { ok: false, code: 0, body: '' };
  for (let i = 0; i < attempts; i++) {
    try {
      const response = UrlFetchApp.fetch(url, fetchOptions_(url));
      const code = response.getResponseCode();
      last = { ok: code === 200, code: code, body: code === 200 ? response.getContentText() : '' };
      if (last.ok) return last;
    } catch (err) {
      last = { ok: false, code: 0, body: '', error: String(err) };
    }
    Utilities.sleep(1000 * (i + 1));
  }
  return last;
}

function fetchBatch_(urls) {
  try {
    return UrlFetchApp.fetchAll(urls.map(fetchOptions_)).map(function (response) {
      const code = response.getResponseCode();
      return { ok: code === 200, code: code, body: code === 200 ? response.getContentText() : '' };
    });
  } catch (err) {
    return urls.map(function () { return { ok: false, code: 0, body: '', error: String(err) }; });
  }
}

// ===========================================================================
// 5. ORCHESTRATION
// ===========================================================================

function newImportContext_(cfg, trigger) {
  return {
    importId: newId_('IMP'),
    trigger: trigger || 'MANUAL',
    startedAt: new Date(),
    retrievedAt: new Date(),
    sourceName: cfg.MASTER_SOURCE_NAME,
    sourceUrl: cfg.MASTER_SOURCE_URL,
    preIssues: [],
    sourceTotals: null
  };
}

/** Download wards + polling units from the configured web source and publish if valid. */
function buildMasterFromWeb(trigger) {
  const cfg = getConfig_();
  const ctx = newImportContext_(cfg, trigger);
  const deadline = ctx.startedAt.getTime() + Number(cfg.MAX_RUNTIME_SECONDS || 300) * 1000;

  try {
    const indexResponse = fetchWithRetry_(cfg.MASTER_SOURCE_URL, 3);
    if (!indexResponse.ok) {
      return failImport_(ctx, 'SOURCE_UNREACHABLE', 'Could not open the source page (HTTP ' + indexResponse.code +
        '). Use the manual import: paste the official file into RAW_IMPORT and run "Process RAW_IMPORT sheet".');
    }

    const index = parseWardIndex_(indexResponse.body, String(cfg.INEC_STATE_NO || ''));
    if (!index.wards.length) {
      return failImport_(ctx, 'SOURCE_FORMAT_CHANGED', 'The source page layout was not recognised (no wards found). ' +
        'Use the manual import instead.');
    }
    ctx.sourceTotals = index.sourceTotals;

    const batchSize = Math.max(1, Number(cfg.FETCH_BATCH_SIZE || 10));
    const base = String(cfg.MASTER_SOURCE_BASE).replace(/\/+$/, '');
    const raws = [];
    let rowNumber = 1;
    let completed = 0;

    for (let start = 0; start < index.wards.length; start += batchSize) {
      if (Date.now() > deadline) {
        ctx.preIssues.push({ severity: 'ERROR', code: 'TIMEOUT', reference: '',
          message: 'Stopped after ' + completed + ' of ' + index.wards.length + ' wards (time limit). Previous master kept.' });
        break;
      }
      const batch = index.wards.slice(start, start + batchSize);
      const urls = batch.map(function (w) { return base + '/ward/' + w.wardCode.replace(/\//g, '-'); });
      const results = fetchBatch_(urls);

      batch.forEach(function (ward, i) {
        let result = results[i];
        if (!result.ok) result = fetchWithRetry_(urls[i], 2);
        if (!result.ok) {
          ctx.preIssues.push({ severity: 'ERROR', code: 'WARD_FETCH_FAILED', reference: ward.wardCode,
            message: 'Could not load ward ' + ward.ward + ' (' + ward.wardCode + '), HTTP ' + result.code });
          return;
        }
        const pus = parseWardPage_(result.body);
        if (!pus.length) {
          ctx.preIssues.push({ severity: 'ERROR', code: 'WARD_PARSE_EMPTY', reference: ward.wardCode,
            message: 'No polling units found on the page for ' + ward.ward + ' (' + ward.wardCode + ')' });
          return;
        }
        pus.forEach(function (pu) {
          raws.push({
            rowNumber: rowNumber++,
            importId: ctx.importId, source: ctx.sourceName, sourceUrl: urls[i],
            retrievedAt: nowIso_(), state: cfg.ACTIVE_STATE, lga: ward.lga, ward: ward.ward, pu: pu.name,
            stateCode: ward.wardCode.split('/')[0], lgaCode: ward.wardCode.split('/').slice(0, 2).join('/'),
            wardCode: ward.wardCode, puCode: pu.puCode, expectedWardPUs: ward.expectedPUs
          });
        });
        completed++;
      });
      Utilities.sleep(250);
    }

    replaceRawImport_(raws);
    return processImport_(ctx, raws);
  } catch (err) {
    return failImport_(ctx, 'UNEXPECTED_ERROR', 'Import stopped unexpectedly. The previous master list is unchanged. (' + err + ')');
  }
}

/** Process whatever is currently in the RAW_IMPORT sheet (manual file upload path). */
function processRawImportSheet(trigger) {
  const cfg = getConfig_();
  const ctx = newImportContext_(cfg, trigger || 'MANUAL_UPLOAD');
  ctx.sourceName = 'Manual upload';
  ctx.preIssues = [];

  try {
    const rows = readDataRows_(TK27.SHEETS.RAW, TK27.HEADERS.RAW.length);
    const filled = rows.filter(function (row) {
      return row.some(function (cell) { return cleanText_(cell) !== ''; });
    });
    if (!filled.length) {
      return failImport_(ctx, 'RAW_IMPORT_EMPTY', 'RAW_IMPORT has no data rows. Paste the official file there first.');
    }
    const raws = filled.map(function (row, i) {
      const raw = rowToRaw_(row, i);
      raw.importId = ctx.importId;
      raw.source = cleanText_(raw.source) || 'Manual upload';
      raw.retrievedAt = cleanText_(raw.retrievedAt) || nowIso_();
      return raw;
    });
    ctx.sourceName = raws[0].source;
    ctx.sourceUrl = raws[0].sourceUrl || '';
    // Stamp the import id/source back so the sheet stays traceable.
    replaceRawImport_(raws);
    return processImport_(ctx, raws);
  } catch (err) {
    return failImport_(ctx, 'UNEXPECTED_ERROR', 'Processing stopped unexpectedly. The previous master list is unchanged. (' + err + ')');
  }
}

/** Import CSV text (header row required) from an admin upload. */
function importCsvText(csvText, sourceName, sourceUrl) {
  const cfg = getConfig_();
  const ctx = newImportContext_(cfg, 'CSV_UPLOAD');
  ctx.sourceName = sourceName || 'Manual upload';
  ctx.sourceUrl = sourceUrl || '';
  try {
    const raws = csvRowsToRaw_(Utilities.parseCsv(csvText), {
      importId: ctx.importId, source: ctx.sourceName, sourceUrl: ctx.sourceUrl, retrievedAt: nowIso_()
    });
    if (!raws.length) return failImport_(ctx, 'CSV_EMPTY', 'The CSV has no usable rows.');
    replaceRawImport_(raws);
    return processImport_(ctx, raws);
  } catch (err) {
    return failImport_(ctx, 'CSV_ERROR', 'Could not read the CSV. The previous master list is unchanged. (' + err + ')');
  }
}

function readExistingCreated_() {
  const map = {};
  try {
    readDataRows_(TK27.SHEETS.MASTER, TK27.HEADERS.MASTER.length).forEach(function (row) {
      if (row[0]) map[String(row[0])] = String(row[13]);
    });
  } catch (err) { /* first build */ }
  return map;
}

/** normalise -> validate -> log -> publish (only if not FAILED). */
function processImport_(ctx, rawRecords) {
  const cfg = getConfig_();
  const normalized = rawRecords.map(function (raw) { return normalizeRawRecord_(raw, cfg); });
  const result = validateAndBuild_(normalized, cfg, ctx, readExistingCreated_());
  const report = result.report;

  writeNormalized_(result.normalizedRows);
  logValidationIssues_(ctx.importId, result.issues);

  let published = false;
  if (report.status !== 'FAILED') {
    publishMaster_(result.masterRows);
    published = true;
    setConfigValues_({
      LAST_MASTER_REFRESH: nowIso_(),
      MASTER_STATUS: report.status,
      MASTER_LGAS: report.lgas,
      MASTER_WARDS: report.wards,
      MASTER_PUS: report.pollingUnits,
      MASTER_PUBLISHED_SOURCE: ctx.sourceName
    });
  }

  const message = published
    ? 'Published ' + report.finalMaster + ' polling units (' + report.warnings + ' warnings).'
    : 'NOT published: ' + report.errors + ' errors. Previous master list is unchanged. See VALIDATION_LOG.';
  setConfigValues_({ LAST_IMPORT_AT: nowIso_(), LAST_IMPORT_STATUS: report.status, LAST_IMPORT_MESSAGE: message });
  logImport_(ctx, report, published, message);
  logAudit_(published ? 'MASTER_REFRESH' : 'MASTER_IMPORT_REJECTED', '', '', ctx.importId + ': ' + report.status, published ? 'OK' : 'FAILED');

  return { success: published, importId: ctx.importId, published: published, report: report,
    message: message, topIssues: result.issues.slice(0, 15) };
}

function failImport_(ctx, code, message) {
  const report = { totalSource: 0, valid: 0, invalid: 0, duplicates: 0, orphans: 0, finalMaster: 0,
    lgas: 0, wards: 0, pollingUnits: 0, status: 'FAILED', errors: 1, warnings: 0 };
  logValidationIssues_(ctx.importId, [{ severity: 'ERROR', code: code, message: message, reference: '' }]);
  setConfigValues_({ LAST_IMPORT_AT: nowIso_(), LAST_IMPORT_STATUS: 'FAILED', LAST_IMPORT_MESSAGE: message });
  logImport_(ctx, report, false, message);
  logAudit_('MASTER_IMPORT_FAILED', '', '', ctx.importId + ': ' + code, 'FAILED');
  return { success: false, importId: ctx.importId, published: false, report: report, message: message,
    topIssues: [{ severity: 'ERROR', code: code, message: message, reference: '' }] };
}

// ===========================================================================
// 6. SHEET WRITERS
// ===========================================================================

function writeNormalized_(rows) {
  const sheet = getOrCreateSheet_(TK27.SHEETS.NORM);
  clearDataRows_(sheet);
  if (!rows.length) return;
  if (sheet.getMaxRows() < rows.length + 1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), rows.length + 1 - sheet.getMaxRows());
  }
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/** Overwrites in place, then trims leftovers — the sheet is never empty mid-publish. */
function publishMaster_(masterRows) {
  const sheet = getOrCreateSheet_(TK27.SHEETS.MASTER);
  const width = TK27.HEADERS.MASTER.length;
  const previousLast = sheet.getLastRow();
  if (sheet.getMaxRows() < masterRows.length + 1) {
    sheet.insertRowsAfter(sheet.getMaxRows(), masterRows.length + 1 - sheet.getMaxRows());
  }
  sheet.getRange(2, 1, masterRows.length, width).setValues(masterRows);
  if (previousLast > masterRows.length + 1) {
    sheet.getRange(masterRows.length + 2, 1, previousLast - masterRows.length - 1, width).clearContent();
  }
}

// ===========================================================================
// 7. ADMIN QUERIES
// ===========================================================================

/** Re-validates the currently published master (no source checks). */
function validateMasterList() {
  const cfg = getConfig_();
  const rows = readDataRows_(TK27.SHEETS.MASTER, TK27.HEADERS.MASTER.length);
  if (!rows.length) {
    return { success: false, message: 'MASTER_GEOGRAPHY is empty. Build it first.', report: null, topIssues: [] };
  }
  const raws = rows.map(function (row, i) {
    return { rowNumber: i + 2, state: row[1], lga: row[3], ward: row[5], pu: row[7],
      lgaCode: row[4], wardCode: row[6], puCode: row[9], expectedWardPUs: null };
  });
  const ctx = { importId: 'VALIDATE', preIssues: [], sourceTotals: null, retrievedAt: new Date() };
  const checkCfg = Object.assign({}, cfg, { MASTER_SOURCE_VERIFICATION: 'OFFICIAL' }); // source warning is not re-raised here
  const result = validateAndBuild_(raws.map(function (r) { return normalizeRawRecord_(r, cfg); }), checkCfg, ctx, {});
  logAudit_('MASTER_VALIDATE', '', '', result.report.status, result.report.status === 'FAILED' ? 'FAILED' : 'OK');
  return { success: result.report.status !== 'FAILED', report: result.report, topIssues: result.issues.slice(0, 15),
    message: 'Master list status: ' + result.report.status };
}

function getMasterStatus() {
  const cfg = getConfig_();
  return {
    state: cfg.ACTIVE_STATE,
    lgas: Number(cfg.MASTER_LGAS || 0),
    wards: Number(cfg.MASTER_WARDS || 0),
    pollingUnits: Number(cfg.MASTER_PUS || 0),
    lastUpdated: cfg.LAST_MASTER_REFRESH,
    source: cfg.MASTER_PUBLISHED_SOURCE,
    verification: cfg.MASTER_SOURCE_VERIFICATION,
    status: cfg.MASTER_STATUS,
    lastImportStatus: cfg.LAST_IMPORT_STATUS,
    lastImportMessage: cfg.LAST_IMPORT_MESSAGE
  };
}
