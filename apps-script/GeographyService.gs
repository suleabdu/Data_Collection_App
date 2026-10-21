/**
 * GeographyService.gs — read-only lookups over MASTER_GEOGRAPHY for the dropdowns and for
 * server-side validation. The master is indexed once and cached in small pieces (one cache entry
 * per LGA and per ward) so each dropdown request returns only what it needs.
 * Cache keys include the master's refresh timestamp, so a new publish invalidates them automatically.
 */

const GEO_CACHE_SECONDS = 6 * 60 * 60;

/** Builds { lgas, wardsByLga, pusByWard } from master rows (array of arrays). Pure. */
function buildGeoIndex_(masterRows) {
  const lgas = {}, wardsByLga = {}, pusByWard = {};
  masterRows.forEach(function (r) {
    if (String(r[10]) !== 'ACTIVE') return;
    const lgaCode = String(r[4]), wardCode = String(r[6]);
    lgas[lgaCode] = String(r[3]);
    (wardsByLga[lgaCode] = wardsByLga[lgaCode] || {})[wardCode] = String(r[5]);
    (pusByWard[wardCode] = pusByWard[wardCode] || []).push({
      code: String(r[8]), fullCode: String(r[9]), name: String(r[7])
    });
  });

  const byName = function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : (a.code < b.code ? -1 : 1)); };
  const index = { lgas: [], wardsByLga: {}, pusByWard: {} };
  Object.keys(lgas).forEach(function (code) { index.lgas.push({ code: code, name: lgas[code] }); });
  index.lgas.sort(byName);
  Object.keys(wardsByLga).forEach(function (lgaCode) {
    index.wardsByLga[lgaCode] = Object.keys(wardsByLga[lgaCode]).map(function (code) {
      return { code: code, name: wardsByLga[lgaCode][code] };
    }).sort(byName);
  });
  Object.keys(pusByWard).forEach(function (wardCode) {
    index.pusByWard[wardCode] = pusByWard[wardCode].sort(function (a, b) { return a.fullCode < b.fullCode ? -1 : 1; });
  });
  return index;
}

function geoCacheVersion_() {
  const stamp = String(getConfig_().LAST_MASTER_REFRESH || '').replace(/[^0-9]/g, '');
  return stamp || '0';
}

function geoCacheKey_(version, suffix) {
  return 'g' + version + ':' + suffix;
}

function putGeoIndexInCache_(cache, version, index) {
  const entries = {};
  entries[geoCacheKey_(version, 'lgas')] = JSON.stringify(index.lgas);
  Object.keys(index.wardsByLga).forEach(function (code) {
    entries[geoCacheKey_(version, 'w:' + code)] = JSON.stringify(index.wardsByLga[code]);
  });
  Object.keys(index.pusByWard).forEach(function (code) {
    entries[geoCacheKey_(version, 'p:' + code)] = JSON.stringify(index.pusByWard[code]);
  });
  const keys = Object.keys(entries);
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = {};
    keys.slice(i, i + 100).forEach(function (k) { chunk[k] = entries[k]; });
    cache.putAll(chunk, GEO_CACHE_SECONDS);
  }
}

function readMasterRows_() {
  return readDataRows_(TK27.SHEETS.MASTER, TK27.HEADERS.MASTER.length);
}

/** Fetches one piece of the geography (cache first; rebuilds the whole index on a miss). */
function geoLookup_(suffix, pick) {
  const cache = CacheService.getScriptCache();
  const version = geoCacheVersion_();
  const hit = cache.get(geoCacheKey_(version, suffix));
  if (hit) return JSON.parse(hit);

  const rows = readMasterRows_();
  if (!rows.length) {
    throw new AppError('MASTER_NOT_READY', 'The location list is not available yet. Please contact the administrator.');
  }
  const index = buildGeoIndex_(rows);
  try { putGeoIndexInCache_(cache, version, index); } catch (err) { console.warn('Geo cache write failed: ' + err); }
  return pick(index);
}

function getLGAs_() {
  return geoLookup_('lgas', function (index) { return index.lgas; });
}

function getWards_(lgaCode) {
  const code = normalizeCode_(lgaCode, [2, 2]);
  if (!TK27.CODE_PATTERNS.LGA.test(code)) throw new AppError('VALIDATION_ERROR', MESSAGES.lga);
  return geoLookup_('w:' + code, function (index) { return index.wardsByLga[code] || []; });
}

/** wardCode is the full INEC ward code (27/01/03). lgaCode is optional and, if sent, must match. */
function getPollingUnits_(lgaCode, wardCode) {
  const ward = normalizeCode_(wardCode, [2, 2, 2]);
  if (!TK27.CODE_PATTERNS.WARD.test(ward)) throw new AppError('VALIDATION_ERROR', MESSAGES.ward);
  if (lgaCode) {
    const lga = normalizeCode_(lgaCode, [2, 2]);
    if (ward.indexOf(lga + '/') !== 0) throw new AppError('VALIDATION_ERROR', MESSAGES.ward);
  }
  return geoLookup_('p:' + ward, function (index) { return index.pusByWard[ward] || []; });
}

/** Lookup object used by resolveGeography_ (server-side hierarchy check). */
function makeGeoLookup_() {
  return {
    lgaName: function (lgaCode) {
      const hit = getLGAs_().filter(function (l) { return l.code === lgaCode; })[0];
      return hit ? hit.name : null;
    },
    wardName: function (lgaCode, wardCode) {
      const hit = getWards_(lgaCode).filter(function (w) { return w.code === wardCode; })[0];
      return hit ? hit.name : null;
    },
    pu: function (wardCode, fullPuCode) {
      return getPollingUnits_('', wardCode).filter(function (p) { return p.fullCode === fullPuCode; })[0] || null;
    }
  };
}
