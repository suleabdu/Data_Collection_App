// Offline tests for the pure Apps Script logic. Run: node tests/run-tests.js
// Loads the .gs files into one vm context (like Apps Script's shared global scope).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'apps-script');
const context = vm.createContext({
  console: { log: console.log, warn() {}, error() {} },
  Utilities: { getUuid: () => require('crypto').randomUUID(), sleep() {} },
  Session: {}, SpreadsheetApp: {}, UrlFetchApp: {},
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'ADMIN_PASSCODE' ? 'SECRET1234' : null) }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }) }
});
['Config.gs', 'Utilities.gs', 'AuditService.gs', 'MasterDataService.gs', 'ValidationService.gs', 'DuplicateService.gs',
  'GeographyService.gs', 'SubmissionService.gs', 'AdminService.gs', 'ExportService.gs', 'Router.gs', 'Code.gs'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context, { filename: f });
});
const run = (code) => vm.runInContext(code, context);
const call = (name, ...args) => { context.__args = args; return run(`${name}(...__args)`); };

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

const cfg = {
  ACTIVE_STATE: 'Ogun', STATE_CODE: 'OG', INEC_STATE_NO: '27',
  MASTER_SOURCE_NAME: 'Nigeria 2.0 (nigeria2.com)', MASTER_SOURCE_VERIFICATION: 'UNVERIFIED_THIRD_PARTY',
  EXPECTED_LGAS: '0', EXPECTED_WARDS: '0', EXPECTED_PUS: '0'
};

// ---- text normalisation ----
console.log('Normalisation');
test('roman numerals and case', () => {
  assert.strictEqual(call('normalizeName_', 'ake ii'), 'Ake II');
  assert.strictEqual(call('normalizeName_', 'Ibara Iii'), 'Ibara III');
  assert.strictEqual(call('normalizeName_', 'muslim pry. school ago-oko i'), 'Muslim Pry. School Ago-Oko I');
});
test('slash and hyphen spacing', () => {
  assert.strictEqual(call('normalizeName_', 'Ijade / Imepe Ii'), 'Ijade/Imepe II');
  assert.strictEqual(call('normalizeName_', 'Ijasi/ Idepo'), 'Ijasi/Idepo');
  assert.strictEqual(call('normalizeName_', 'Ode -Lemo', { tightHyphen: true }), 'Ode-Lemo');
});
test('apostrophes are not word breaks', () => {
  assert.strictEqual(call('normalizeName_', "st. paul's church"), "St. Paul's Church");
});
test('code normalisation', () => {
  assert.strictEqual(call('normalizeCode_', '27-1-3-1', [2, 2, 2, 3]), '27/01/03/001');
  assert.strictEqual(call('normalizeCode_', ' 27/01/03/001 ', [2, 2, 2, 3]), '27/01/03/001');
  assert.strictEqual(call('normalizeCode_', 'abc', [2, 2, 2]), 'abc');
});

// ---- parsers ----
console.log('Parsers');
const indexHtml = `
<head><meta name="description" content="Ogun State has 236 electoral wards and 5,042 polling units across 20 local government areas."></head>
<h2>Complete Directory of Wards in Ogun State</h2>
<h3>Abeokuta North Local Government</h3><p>2 wards</p>
<a href="https://nigeria2.com/ward/27-01-03"><span>Ago Oko</span><span>27/01/03</span><span>APC</span> <span>3 PUs</span></a>
<a href="/ward/27-01-16">Ibara Orile/Onisasa27/01/16APC 2 PUs</a>
<h3>Abeokuta South Local Government</h3>
<a href="/ward/27-02-10">Sodeke/Sale-Ijeun I27/02/10APC 1 PUs</a>
<a href="/ward/27-02-10">Sodeke/Sale-Ijeun I27/02/10APC 1 PUs</a>
<a href="/ward/99-02-11">Other state99/02/11APC 1 PUs</a>
<h3>How many wards are in Ogun State?</h3>`;
test('ward index', () => {
  const idx = call('parseWardIndex_', indexHtml, '27');
  assert.strictEqual(idx.wards.length, 3, 'wards (dedupes repeats, skips other states)');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(idx.wards[0])),
    { lga: 'Abeokuta North', ward: 'Ago Oko', wardCode: '27/01/03', expectedPUs: 3 });
  assert.strictEqual(idx.wards[1].ward, 'Ibara Orile/Onisasa');
  assert.strictEqual(idx.wards[2].lga, 'Abeokuta South');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(idx.sourceTotals)), { wards: 236, pus: 5042, lgas: 20 });
});
test('ward name ending in a digit is not confused with the code', () => {
  const idx = call('parseWardIndex_', '<h3>Sagamu Local Government</h3><a href="/ward/27-20-04">Sabo 127/20/04APC 34 PUs</a>', '27');
  assert.strictEqual(idx.wards[0].ward, 'Sabo 1');
  assert.strictEqual(idx.wards[0].expectedPUs, 34);
});
const wardHtml = `<table><thead><tr><th>Polling unit</th><th>Code</th><th>Winner</th></tr></thead><tbody>
<tr><td>space at itamorin i</td><td>27/01/03/001</td><td>APC</td><td>766</td></tr>
<tr><td>open space near public water, itamorin</td><td>27/01/03/002</td><td>APC</td></tr>
<tr><td>Muslim Pry. School &amp; Annex</td><td>27/01/03/003</td></tr></tbody></table>`;
test('ward page', () => {
  const pus = call('parseWardPage_', wardHtml);
  assert.strictEqual(pus.length, 3);
  assert.strictEqual(pus[0].name, 'space at itamorin i');
  assert.strictEqual(pus[0].puCode, '27/01/03/001');
  assert.strictEqual(pus[2].name, 'Muslim Pry. School & Annex');
});

// ---- validation ----
console.log('Validation');
function raw(n, lga, ward, pu, code, expected) {
  const parts = code.split('/');
  return { rowNumber: n, state: 'Ogun', lga, ward, pu, lgaCode: parts.slice(0, 2).join('/'),
    wardCode: parts.slice(0, 3).join('/'), puCode: code, expectedWardPUs: expected === undefined ? '' : expected };
}
const norm = (list) => list.map((r) => call('normalizeRawRecord_', r, cfg));
const ctx = () => ({ importId: 'IMP-T', preIssues: [], sourceTotals: null, retrievedAt: new Date('2026-10-20T10:00:00Z') });
const build = (list, c, x) => JSON.parse(JSON.stringify(call('validateAndBuild_', norm(list), c || cfg, x || ctx(), {})));

const good = [
  raw(2, 'abeokuta north', 'ago oko', 'space at itamorin i', '27/01/03/001', 2),
  raw(3, 'abeokuta north', 'ago oko', 'space at itamorin ii', '27/01/03/002', 2),
  raw(4, 'abeokuta south', 'sodeke/sale-ijeun i', 'palace', '27/02/10/001', 1)
];
test('clean import is WARNING only because source is unverified', () => {
  const r = build(good);
  assert.strictEqual(r.report.status, 'WARNING');
  assert.strictEqual(r.report.errors, 0);
  assert.ok(r.issues.some((i) => i.code === 'SOURCE_UNVERIFIED'));
  assert.deepStrictEqual([r.report.lgas, r.report.wards, r.report.pollingUnits], [2, 2, 3]);
});
test('master row shape and ids', () => {
  const r = build(good);
  const row = r.masterRows[0];
  assert.strictEqual(row.length, 15);
  assert.strictEqual(row[0], 'OG-01-03-001');
  assert.deepStrictEqual(row.slice(1, 11),
    ['Ogun', 'OG', 'Abeokuta North', '27/01', 'Ago Oko', '27/01/03', 'Space At Itamorin I', '001', '27/01/03/001', 'ACTIVE']);
  assert.ok(row[11].includes('[unverified]'));
});
test('official verification yields VALID', () => {
  const r = build(good, Object.assign({}, cfg, { MASTER_SOURCE_VERIFICATION: 'OFFICIAL' }));
  assert.strictEqual(r.report.status, 'VALID');
});
test('exact duplicate removed, not fatal', () => {
  const r = build(good.concat([raw(5, 'abeokuta south', 'sodeke/sale-ijeun i', 'palace', '27/02/10/001', 1)]));
  assert.strictEqual(r.report.duplicates, 1);
  assert.strictEqual(r.report.finalMaster, 3);
  assert.notStrictEqual(r.report.status, 'FAILED');
});
test('conflicting duplicate code fails', () => {
  const r = build(good.concat([raw(5, 'abeokuta south', 'sodeke/sale-ijeun i', 'different place', '27/02/10/001', 1)]));
  assert.strictEqual(r.report.status, 'FAILED');
  assert.ok(r.issues.some((i) => i.code === 'CONFLICTING_DUPLICATE'));
});
test('ward in two LGAs fails', () => {
  const r = build(good.concat([raw(5, 'abeokuta south', 'ago oko', 'x', '27/01/03/003', 3)]));
  assert.strictEqual(r.report.status, 'FAILED');
  assert.ok(r.issues.some((i) => i.code === 'WARD_IN_MULTIPLE_LGAS'));
});
test('orphan (code hierarchy mismatch) fails', () => {
  const bad = raw(5, 'abeokuta north', 'ago oko', 'x', '27/01/04/001');
  bad.wardCode = '27/01/03'; // says ward 03 but PU code is under ward 04
  const r = build(good.concat([bad]));
  assert.strictEqual(r.report.orphans, 1);
  assert.strictEqual(r.report.status, 'FAILED');
});
test('missing fields and malformed codes fail', () => {
  const r1 = build(good.concat([raw(5, 'abeokuta north', 'ago oko', '', '27/01/03/009')]));
  assert.ok(r1.issues.some((i) => i.code === 'MISSING_FIELD') && r1.report.status === 'FAILED');
  const r2 = build(good.concat([{ rowNumber: 6, state: 'Ogun', lga: 'a', ward: 'b', pu: 'c', puCode: '12/ab' }]));
  assert.ok(r2.report.invalid >= 1 && r2.report.status === 'FAILED');
});
test('wrong-state code fails', () => {
  const r = build(good.concat([raw(5, 'x', 'y', 'z', '01/01/01/001')]));
  assert.ok(r.issues.some((i) => i.code === 'WRONG_STATE'));
});
test('incomplete ward (fewer PUs than advertised) fails', () => {
  const r = build([good[0], good[2]].map((x) => Object.assign({}, x, { expectedWardPUs: x.wardCode === '27/01/03' ? 2 : 1 })));
  assert.ok(r.issues.some((i) => i.code === 'WARD_PU_COUNT_MISMATCH'));
  assert.strictEqual(r.report.status, 'FAILED');
});
test('source totals mismatch fails; failed fetch pre-issue fails', () => {
  const x = ctx(); x.sourceTotals = { lgas: 20, wards: 236, pus: 5042 };
  assert.ok(build(good, cfg, x).issues.some((i) => i.code === 'SOURCE_TOTAL_MISMATCH'));
  const y = ctx(); y.preIssues = [{ severity: 'ERROR', code: 'WARD_FETCH_FAILED', message: 'm', reference: '' }];
  assert.strictEqual(build(good, cfg, y).report.status, 'FAILED');
});
test('INEC totals mismatch is only a warning', () => {
  const r = build(good, Object.assign({}, cfg, { EXPECTED_LGAS: '20', EXPECTED_WARDS: '236', EXPECTED_PUS: '5042' }));
  assert.ok(r.issues.some((i) => i.code === 'COUNT_DIFFERS_FROM_INEC_TOTALS'));
  assert.strictEqual(r.report.status, 'WARNING');
});
test('created timestamp is preserved on refresh', () => {
  const r = JSON.parse(JSON.stringify(call('validateAndBuild_', norm(good), cfg, ctx(), { 'OG-01-03-001': '2026-01-01T00:00:00.000Z' })));
  assert.strictEqual(r.masterRows[0][13], '2026-01-01T00:00:00.000Z');
});
test('lenient code forms are accepted (bare LGA/PU numbers)', () => {
  const n = call('normalizeRawRecord_', { rowNumber: 2, state: 'Ogun', lga: 'a', ward: 'b', pu: 'c',
    lgaCode: '1', wardCode: '27-01-03', puCode: '7' }, cfg);
  assert.strictEqual(n.fullPuCode, '27/01/03/007');
  assert.strictEqual(n.lgaCode, '27/01');
});

// ---- CSV mapping ----
console.log('CSV');
test('csv headers are matched loosely', () => {
  const rows = call('csvRowsToRaw_', [
    ['State', 'Local Government', 'Ward', 'Polling Unit', 'PU Code'],
    ['Ogun', 'Ifo', 'Ifo I', 'Town Hall', '27/07/01/001'],
    ['', '', '', '', '']
  ], { importId: 'I', source: 'file', sourceUrl: '', retrievedAt: 'now' });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].lga, 'Ifo');
  assert.strictEqual(rows[0].puCode, '27/07/01/001');
});

// ---- scale smoke test ----
console.log('Scale');
test('5,042 PUs validate quickly', () => {
  const list = [];
  let n = 2;
  for (let l = 1; l <= 20; l++) for (let w = 1; w <= 12; w++) for (let p = 1; p <= 22 && list.length < 5042; p++) {
    const code = [27, l, w, p].map((v, i) => String(v).padStart(i === 3 ? 3 : 2, '0')).join('/');
    list.push(raw(n++, 'Lga ' + l, 'Ward ' + w, 'Unit ' + p, code));
  }
  const t = Date.now();
  const r = build(list);
  assert.strictEqual(r.report.pollingUnits, 5042);
  assert.ok(Date.now() - t < 3000, 'took ' + (Date.now() - t) + 'ms');
});

// =====================================================================
// Phase 3-6: submission, duplicates, admin, export, router
// =====================================================================
const J = (v) => JSON.parse(JSON.stringify(v));
const frontend = require(path.join(__dirname, 'legacy-validate.js'));

console.log('Phone and name validation');
test('phone formats normalise to +234', () => {
  const ok = { '08012345678': '+2348012345678', '+2348012345678': '+2348012345678', '2348012345678': '+2348012345678',
    '8012345678': '+2348012345678', '+234 801 234 5678': '+2348012345678', '0901 234 5678': '+2349012345678',
    '07012345678': '+2347012345678', '+23408012345678': '+2348012345678', '0803-123-4567': '+2348031234567' };
  Object.keys(ok).forEach((k) => assert.strictEqual(call('normalizePhone_', k), ok[k], k));
});
test('invalid phones rejected', () => {
  ['', 'abc', '0801234567', '080123456789', '06012345678', '08212345678', '12345', '+44 7911 123456'].forEach((k) =>
    assert.strictEqual(call('normalizePhone_', k), '', k));
});
test('names: tidy, accept, reject', () => {
  assert.strictEqual(call('validPersonName_', 'ola adebayo'), 'Ola Adebayo');
  assert.strictEqual(call('validPersonName_', 'ADEBAYO OLA'), 'Adebayo Ola');
  assert.strictEqual(call('validPersonName_', "John O'Brien"), "John O'Brien");
  assert.strictEqual(call('validPersonName_', 'Chidi Okeke-Eze'), 'Chidi Okeke-Eze');
  assert.strictEqual(call('validPersonName_', 'Mc Donald'), 'Mc Donald');
  ['Ola', 'Ade123 Bola', '', 'A B', '12 34', 'x'.repeat(120) + ' y'].forEach((v) =>
    assert.strictEqual(call('validPersonName_', v), '', v));
});
test('browser validation matches the server', () => {
  ['08012345678', '+2348012345678', '0801234567', 'abc', '', '07012345678', '+44 7911 123456', '2348012345678'].forEach((p) =>
    assert.strictEqual(frontend.normalizePhone(p), call('normalizePhone_', p), p));
  ['ola adebayo', 'Ola', "John O'Brien", 'Ade123 Bola', 'A B', 'Chidi Okeke'].forEach((n) =>
    assert.strictEqual(frontend.isValidName(n), call('validPersonName_', n) !== '', n));
});

console.log('Submission fields and geography');
const rules = { positions: ['STATE_EXCO', 'LGA_COORDINATOR', 'WARD_COORDINATOR'] };
const goodPayload = { position: 'WARD_COORDINATOR', name: 'ola adebayo', phone: '0801 234 5678',
  lgaCode: '27/01', wardCode: '27/01/03', puCode: '27/01/03/001' };
test('empty submission reports every field', () => {
  const r = J(call('validateSubmissionFields_', {}, rules));
  assert.deepStrictEqual(Object.keys(r.errors).sort(), ['lga', 'name', 'phone', 'position', 'pu', 'ward']);
});
test('each missing field is reported on its own', () => {
  ['position', 'name', 'phone', 'lgaCode', 'wardCode', 'puCode'].forEach((f) => {
    const p = Object.assign({}, goodPayload); delete p[f];
    assert.strictEqual(Object.keys(J(call('validateSubmissionFields_', p, rules)).errors).length, 1, f);
  });
});
test('bad position and bad phone rejected, good payload cleaned', () => {
  assert.ok(J(call('validateSubmissionFields_', Object.assign({}, goodPayload, { position: 'PRESIDENT' }), rules)).errors.position);
  assert.ok(J(call('validateSubmissionFields_', Object.assign({}, goodPayload, { phone: '123' }), rules)).errors.phone);
  const r = J(call('validateSubmissionFields_', goodPayload, rules));
  assert.deepStrictEqual(r.errors, {});
  assert.strictEqual(r.clean.phone, '+2348012345678');
  assert.strictEqual(r.clean.name, 'Ola Adebayo');
});
const lookup = {
  lgaName: (c) => ({ '27/01': 'Abeokuta North', '27/02': 'Abeokuta South' }[c] || null),
  wardName: (l, w) => ({ '27/01/03': 'Ago Oko', '27/02/10': 'Sodeke' }[w] && w.indexOf(l + '/') === 0 ? { '27/01/03': 'Ago Oko', '27/02/10': 'Sodeke' }[w] : null),
  pu: (w, full) => (full === '27/01/03/001' && w === '27/01/03' ? { name: 'Space At Itamorin I', code: '001', fullCode: full } : null)
};
const geoClean = { lgaCode: '27/01', wardCode: '27/01/03', fullPuCode: '27/01/03/001' };
test('valid geography resolves names from the master, not the browser', () => {
  const r = J(call('resolveGeography_', geoClean, lookup));
  assert.deepStrictEqual(r.errors, {});
  assert.strictEqual(r.geo.puName, 'Space At Itamorin I');
  assert.strictEqual(r.geo.lgaName, 'Abeokuta North');
});
test('invalid hierarchy rejected', () => {
  assert.ok(J(call('resolveGeography_', Object.assign({}, geoClean, { lgaCode: '27/02' }), lookup)).errors.ward);   // ward under another LGA
  assert.ok(J(call('resolveGeography_', Object.assign({}, geoClean, { fullPuCode: '27/02/10/001' }), lookup)).errors.pu); // PU under another ward
  assert.ok(J(call('resolveGeography_', Object.assign({}, geoClean, { fullPuCode: '27/01/03/999' }), lookup)).errors.pu); // unknown PU
  assert.ok(J(call('resolveGeography_', Object.assign({}, geoClean, { lgaCode: '27/99' }), lookup)).errors.lga);          // unknown LGA
});

console.log('Duplicates and record rows');
const existing = [
  { recordId: 'OG-WC-000001', nameKey: call('nameKey_', 'Ola Adebayo'), phone: '+2348012345678', position: 'WARD_COORDINATOR', fullPuCode: '27/01/03/001' },
  { recordId: 'OG-WC-000002', nameKey: call('nameKey_', 'Bola Tinubu'), phone: '+2347011111111', position: 'LGA_COORDINATOR', fullPuCode: '27/02/10/001' }
];
const cand = (o) => Object.assign({ nameKey: call('nameKey_', 'Chidi Okeke'), phone: '+2349099999999', position: 'WARD_COORDINATOR', fullPuCode: '27/05/01/001' }, o);
test('different person is not flagged', () => assert.strictEqual(call('findDuplicateMatches_', cand({}), existing).length, 0));
test('same phone, different name is flagged', () => {
  const m = J(call('findDuplicateMatches_', cand({ phone: '+2348012345678' }), existing));
  assert.strictEqual(m[0].recordId, 'OG-WC-000001');
  assert.ok(m[0].reasons.includes('same phone number'));
});
test('same name in another word order and the same position is flagged', () => {
  const m = J(call('findDuplicateMatches_', cand({ nameKey: call('nameKey_', 'ADEBAYO ola') }), existing));
  assert.ok(m[0].reasons.includes('same name and position'));
});
test('same name, different position and place is not flagged', () => {
  assert.strictEqual(call('findDuplicateMatches_', cand({ nameKey: call('nameKey_', 'Ola Adebayo'), position: 'STATE_EXCO' }), existing).length, 0);
});
test('same name at the same polling unit is flagged', () => {
  const m = J(call('findDuplicateMatches_', cand({ nameKey: call('nameKey_', 'Ola Adebayo'), position: 'STATE_EXCO', fullPuCode: '27/01/03/001' }), existing));
  assert.ok(m[0].reasons.includes('same name and polling unit'));
});
test('record id format and record row shape', () => {
  assert.strictEqual(call('formatRecordId_', 'OG', 'WARD_COORDINATOR', 184), 'OG-WC-000184');
  assert.strictEqual(call('formatRecordId_', 'OG', 'STATE_EXCO', 1), 'OG-EXCO-000001');
  assert.strictEqual(call('formatRecordId_', 'OG', 'LGA_COORDINATOR', 12), 'OG-LGA-000012');
  const clean = { name: 'Ola Adebayo', position: 'WARD_COORDINATOR', phone: '+2348012345678' };
  const geo = { lgaName: 'Abeokuta North', lgaCode: '27/01', wardName: 'Ago Oko', wardCode: '27/01/03', puName: 'Space', puCode: '001' };
  const row = J(call('buildRecordRow_', clean, geo, [{ recordId: 'OG-WC-000001', reasons: ['same phone number'] }], 'OG-WC-000002', 'T', { ACTIVE_STATE: 'Ogun', STATE_CODE: 'OG' }, 'KEY'));
  assert.strictEqual(row.length, TK27_HEADERS_RECORDS_LENGTH());
  assert.strictEqual(row[12], 'PENDING');
  assert.strictEqual(row[13], 'TRUE');
  assert.ok(row[17].includes('OG-WC-000001'));
  assert.strictEqual(row[18], 'KEY');
});
function TK27_HEADERS_RECORDS_LENGTH() { return run('TK27.HEADERS.RECORDS.length'); }

console.log('Geography index, admin, export');
const mrow = (lga, lc, ward, wc, pu, pc, status) => [`OG-${wc.slice(3)}-${pc}`, 'Ogun', 'OG', lga, lc, ward, wc, pu, pc, `${wc}/${pc}`, status || 'ACTIVE'];
const masterRows = [mrow('Beta', '27/02', 'W2', '27/02/01', 'Unit B', '001'), mrow('Alpha', '27/01', 'W1', '27/01/01', 'Unit Z', '002'),
  mrow('Alpha', '27/01', 'W1', '27/01/01', 'Unit A', '001'), mrow('Alpha', '27/01', 'W3', '27/01/02', 'Gone', '001', 'INACTIVE')];
test('geo index: sorted, active only, scoped', () => {
  const idx = J(call('buildGeoIndex_', masterRows));
  assert.deepStrictEqual(idx.lgas.map((l) => l.name), ['Alpha', 'Beta']);
  assert.deepStrictEqual(idx.wardsByLga['27/01'].map((w) => w.code), ['27/01/01']);
  assert.deepStrictEqual(idx.pusByWard['27/01/01'].map((p) => p.code), ['001', '002']);
  assert.strictEqual(idx.pusByWard['27/01/02'], undefined);
});
const rec = (id, pos, status, dup, lgaCode, wardCode, when, name, phone) => {
  const r = new Array(21).fill('');
  r[0] = id; r[3] = name || 'Some Person'; r[4] = pos; r[5] = phone || '+2348000000000'; r[6] = 'Alpha'; r[7] = lgaCode; r[8] = 'W1'; r[9] = wardCode;
  r[10] = 'Unit A'; r[11] = '001'; r[12] = status; r[13] = dup; r[14] = when; r[17] = ''; return r;
};
const now = new Date('2026-10-20T12:00:00Z');
const recs = [
  rec('OG-WC-000001', 'WARD_COORDINATOR', 'PENDING', 'FALSE', '27/01', '27/01/01', '2026-10-20T08:00:00Z', 'Ola Adebayo', '+2348012345678'),
  rec('OG-WC-000002', 'WARD_COORDINATOR', 'VERIFIED', 'TRUE', '27/01', '27/01/01', '2026-10-19T23:30:00Z'),   // 00:30 on the 20th in Nigeria
  rec('OG-LGA-000001', 'LGA_COORDINATOR', 'PENDING', 'FALSE', '27/02', '27/02/01', '2026-10-18T10:00:00Z'),
  rec('OG-EXCO-000001', 'STATE_EXCO', 'REJECTED', 'FALSE', '', '', '2026-09-01T10:00:00Z')
];
test('stats', () => {
  const s = J(call('computeStats_', recs));
  assert.deepStrictEqual([s.total, s.STATE_EXCO, s.LGA_COORDINATOR, s.WARD_COORDINATOR, s.pendingReview, s.possibleDuplicates], [4, 1, 1, 2, 2, 1]);
});
test('analytics: coverage, per-LGA, daily buckets in Nigerian time', () => {
  const a = J(call('computeAnalytics_', recs, J(call('buildGeoIndex_', masterRows)), now));
  assert.strictEqual(a.total, 4);
  assert.deepStrictEqual(a.byStatus, { PENDING: 2, VERIFIED: 1, REJECTED: 1 });
  assert.deepStrictEqual(a.coverage, { wardsTotal: 2, wardsCovered: 1, lgasTotal: 2, lgasWithCoordinator: 1 });
  const alpha = a.lgas.find((l) => l.lga === 'Alpha');
  assert.deepStrictEqual([alpha.records, alpha.wardCoordinators, alpha.wardsCovered, alpha.wardsTotal], [2, 2, 1, 1]);
  assert.strictEqual(a.daily.length, 14);
  assert.strictEqual(a.daily[13].date, '2026-10-20');
  assert.strictEqual(a.daily[13].count, 2);                                   // 08:00Z and 23:30Z (the previous UTC day)
  assert.strictEqual(a.daily.find((d) => d.date === '2026-10-18').count, 1);
  assert.strictEqual(a.lastSubmission, '2026-10-20T08:00:00Z');
});
test('records filter: newest first, search by name and partial phone, flags', () => {
  assert.strictEqual(J(call('filterRecords_', recs, {}))[0][0], 'OG-EXCO-000001');          // reversed
  assert.strictEqual(call('filterRecords_', recs, { q: 'adebayo' }).length, 1);
  assert.strictEqual(call('filterRecords_', recs, { q: '0801234' }).length, 1);
  assert.strictEqual(call('filterRecords_', recs, { duplicatesOnly: true }).length, 1);
  assert.strictEqual(call('filterRecords_', recs, { position: 'WARD_COORDINATOR', status: 'PENDING' }).length, 1);
});
test('csv export neutralises formulas and quotes cells', () => {
  const csv = call('toCsv_', ['Name', 'Phone', 'Notes'], [['=HYPERLINK("x")', '+2348012345678', 'a, "b"'], ['@cmd', '', '-1+1']]);
  const lines = csv.split('\r\n');
  assert.strictEqual(lines[1], `"'=HYPERLINK(""x"")",+2348012345678,"a, ""b"""`);
  assert.strictEqual(lines[2], "'@cmd,,'-1+1");
});
test('admin passcode check is strict', () => {
  call('requireAdmin_', 'SECRET1234');
  ['', 'secret1234', 'SECRET12345', 'SECRET123', undefined].forEach((p) => assert.throws(() => call('requireAdmin_', p), /Incorrect admin passcode/));
});

console.log('Router — Supabase cutover');
const respond = (action, params, method) => JSON.parse(call('handleRequest_', action, params, method).text);
test('legacy public and admin APIs are retired after Supabase cutover', () => {
  ['getState', 'getLGAs', 'getWards', 'getPollingUnits', 'submitCoordinator', 'getRecords', 'getDashboardStats', 'exportRecords'].forEach((action) => {
    const method = action === 'submitCoordinator' || action === 'exportRecords' ? 'POST' : 'GET';
    const r = respond(action, {}, method);
    assert.strictEqual(r.success, false, action);
    assert.strictEqual(r.error.code, 'MIGRATED', action);
  });
});
test('sync receiver cannot be invoked via GET', () => {
  const r = respond('syncSupabaseRecord', { syncSecret: 'not-a-secret' }, 'GET');
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.error.code, 'MIGRATED');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
