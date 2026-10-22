// Offline tests for validation, duplicates, submission rows, analytics, export, and the router.
// Run: node tests/run-tests-api.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'apps-script');
const context = vm.createContext({
  console,
  Utilities: { getUuid: () => require('crypto').randomUUID(), sleep() {} },
  Session: {}, SpreadsheetApp: {}, PropertiesService: {}, UrlFetchApp: {}, CacheService: {}, LockService: {},
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) }
});
['Config.gs', 'Utilities.gs', 'AuditService.gs', 'MasterDataService.gs', 'ValidationService.gs', 'DuplicateService.gs',
  'GeographyService.gs', 'SubmissionService.gs', 'AdminService.gs', 'ExportService.gs', 'Router.gs', 'Code.gs'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context, { filename: f });
});
const call = (name, ...args) => { context.__args = args; return vm.runInContext(`${name}(...__args)`, context); };
const json = (v) => JSON.parse(JSON.stringify(v));
const client = require('./legacy-validate.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('Phone');
const phoneCases = [
  ['08012345678', '+2348012345678'], ['8012345678', '+2348012345678'], ['+2348012345678', '+2348012345678'],
  ['2348012345678', '+2348012345678'], ['+234 801 234 5678', '+2348012345678'], ['0801-234-5678', '+2348012345678'],
  ['+23408012345678', '+2348012345678'], ['07061234567', '+2347061234567'], ['09012345678', '+2349012345678'],
  ['0801234567', ''], ['080123456789', ''], ['06012345678', ''], ['abc', ''], ['', ''], ['00000000000', ''], ['12345', '']
];
test('server phone normalisation', () => phoneCases.forEach(([i, o]) => assert.strictEqual(call('normalizePhone_', i), o, i)));
test('browser and server phone rules agree', () => phoneCases.forEach(([i]) => assert.strictEqual(client.normalizePhone(i), call('normalizePhone_', i), i)));

console.log('Names');
const nameCases = [
  ['Ola Adebayo', true], ['ola adebayo', true], ["Chidi O'Brien", true], ['Mary-Jane Okafor', true], ['Ọlá Adéyemí', true],
  ['Ola', false], ['A B', false], ['12345 678', false], ['', false], ['Ola <script>', false], ['=cmd|calc Smith', false]
];
test('server name rules', () => nameCases.forEach(([n, ok]) => assert.strictEqual(call('validPersonName_', n) !== '', ok, n)));
test('browser and server name rules agree', () => nameCases.forEach(([n]) => assert.strictEqual(client.isValidName(n), call('validPersonName_', n) !== '', n)));
test('lower/upper-case names are tidied, mixed case kept', () => {
  assert.strictEqual(call('tidyPersonName_', 'ola ADEBAYO'), 'ola ADEBAYO');
  assert.strictEqual(call('tidyPersonName_', 'ola adebayo'), 'Ola Adebayo');
  assert.strictEqual(call('tidyPersonName_', 'OLA ADEBAYO'), 'Ola Adebayo');
  assert.strictEqual(call('tidyPersonName_', 'McDonald Eze'), 'McDonald Eze');
});

console.log('Submission fields');
const rules = { positions: ['STATE_EXCO', 'LGA_COORDINATOR', 'WARD_COORDINATOR'] };
const goodPayload = { position: 'WARD_COORDINATOR', name: 'ola adebayo', phone: '08012345678', lgaCode: '27/01', wardCode: '27/01/03', puCode: '27/01/03/001' };
test('valid payload is cleaned', () => {
  const r = json(call('validateSubmissionFields_', goodPayload, rules));
  assert.deepStrictEqual(r.errors, {});
  assert.strictEqual(r.clean.name, 'Ola Adebayo');
  assert.strictEqual(r.clean.phone, '+2348012345678');
});
test('every required field is enforced', () => {
  const r = json(call('validateSubmissionFields_', {}, rules));
  assert.deepStrictEqual(Object.keys(r.errors).sort(), ['lga', 'name', 'phone', 'position', 'pu', 'ward']);
});
test('each field rejected individually', () => {
  [['position', 'CHAIRMAN', 'position'], ['name', 'X', 'name'], ['phone', '123', 'phone'], ['lgaCode', '', 'lga'],
    ['wardCode', 'bad', 'ward'], ['puCode', '27/01/03', 'pu']].forEach(([key, value, field]) => {
    const r = json(call('validateSubmissionFields_', Object.assign({}, goodPayload, { [key]: value }), rules));
    assert.ok(r.errors[field], field);
  });
});

console.log('Geography');
const lookup = {
  lgaName: (c) => (c === '27/01' ? 'Abeokuta North' : null),
  wardName: (l, w) => (w === '27/01/03' ? 'Ago Oko' : null),
  pu: (w, f) => (f === '27/01/03/001' ? { name: 'Space At Itamorin I', code: '001', fullCode: f } : null)
};
const clean = (o) => Object.assign({ lgaCode: '27/01', wardCode: '27/01/03', fullPuCode: '27/01/03/001' }, o);
test('valid hierarchy resolves names from the master, not the browser', () => {
  const r = json(call('resolveGeography_', clean(), lookup));
  assert.deepStrictEqual(r.errors, {});
  assert.strictEqual(r.geo.puName, 'Space At Itamorin I');
});
test('invalid hierarchy is rejected', () => {
  assert.ok(json(call('resolveGeography_', clean({ lgaCode: '27/99' }), lookup)).errors.lga);
  assert.ok(json(call('resolveGeography_', clean({ wardCode: '27/02/03' }), lookup)).errors.ward);   // ward not under LGA
  assert.ok(json(call('resolveGeography_', clean({ wardCode: '27/01/09' }), lookup)).errors.ward);   // unknown ward
  assert.ok(json(call('resolveGeography_', clean({ fullPuCode: '27/01/04/001' }), lookup)).errors.pu); // PU not under ward
  assert.ok(json(call('resolveGeography_', clean({ fullPuCode: '27/01/03/099' }), lookup)).errors.pu); // unknown PU
});

console.log('Duplicates');
const existing = [
  { recordId: 'OG-WC-000001', nameKey: call('nameKey_', 'Ola Adebayo'), phone: '+2348012345678', position: 'WARD_COORDINATOR', fullPuCode: '27/01/03/001' }
];
const cand = (o) => Object.assign({ nameKey: call('nameKey_', 'Zainab Musa'), phone: '+2347000000000', position: 'WARD_COORDINATOR', fullPuCode: '27/05/01/001' }, o);
test('name key ignores order, case, punctuation', () => {
  assert.strictEqual(call('nameKey_', 'ADEBAYO ola'), call('nameKey_', 'Ola  Adebayo'));
  assert.strictEqual(call('nameKey_', 'Ola Adebayo.'), call('nameKey_', 'Ola Adebayo'));
});
test('different person is not flagged', () => assert.strictEqual(json(call('findDuplicateMatches_', cand(), existing)).length, 0));
test('same phone, different name is flagged', () => {
  const m = json(call('findDuplicateMatches_', cand({ phone: '+2348012345678' }), existing));
  assert.deepStrictEqual(m[0].reasons, ['same phone number']);
});
test('exact duplicate lists every reason', () => {
  const m = json(call('findDuplicateMatches_', cand({ nameKey: existing[0].nameKey, phone: existing[0].phone, fullPuCode: existing[0].fullPuCode }), existing));
  assert.strictEqual(m[0].reasons.length, 3);
});
test('same name, different position and place is not flagged', () => {
  assert.strictEqual(json(call('findDuplicateMatches_', cand({ nameKey: existing[0].nameKey, position: 'STATE_EXCO' }), existing)).length, 0);
});
test('similar but different name is not flagged', () => {
  assert.strictEqual(json(call('findDuplicateMatches_', cand({ nameKey: call('nameKey_', 'Ola Adebayor') }), existing)).length, 0);
});

console.log('Record rows');
const cfg = { ACTIVE_STATE: 'Ogun', STATE_CODE: 'OG' };
const geo = { lgaName: 'Abeokuta North', lgaCode: '27/01', wardName: 'Ago Oko', wardCode: '27/01/03', puName: 'Space At Itamorin I', puCode: '001', fullPuCode: '27/01/03/001' };
test('record id format', () => {
  assert.strictEqual(call('formatRecordId_', 'OG', 'WARD_COORDINATOR', 184), 'OG-WC-000184');
  assert.strictEqual(call('formatRecordId_', 'OG', 'STATE_EXCO', 1), 'OG-EXCO-000001');
  assert.strictEqual(call('formatRecordId_', 'OG', 'LGA_COORDINATOR', 12), 'OG-LGA-000012');
});
test('record row matches the 21-column schema', () => {
  const row = json(call('buildRecordRow_', { name: 'Ola Adebayo', position: 'WARD_COORDINATOR', phone: '+2348012345678' }, geo, [], 'OG-WC-000001', '2026-10-20T10:00:00.000Z', cfg, 'key-key-key-key-key'));
  assert.strictEqual(row.length, vm.runInContext('TK27.HEADERS.RECORDS.length', context));
  assert.strictEqual(row[0], 'OG-WC-000001');
  assert.strictEqual(row[12], 'PENDING');
  assert.strictEqual(row[13], 'FALSE');
  assert.strictEqual(row[18], 'key-key-key-key-key');
});
test('duplicate row is flagged with a note', () => {
  const row = json(call('buildRecordRow_', { name: 'Ola Adebayo', position: 'WARD_COORDINATOR', phone: '+2348012345678' }, geo,
    [{ recordId: 'OG-WC-000001', reasons: ['same phone number'] }], 'OG-WC-000002', 'now', cfg, 'k'));
  assert.strictEqual(row[13], 'TRUE');
  assert.ok(row[17].includes('OG-WC-000001'));
});

console.log('Geography index');
const masterRows = [
  ['OG-01-03-001', 'Ogun', 'OG', 'Abeokuta North', '27/01', 'Ago Oko', '27/01/03', 'B Place', '001', '27/01/03/001', 'ACTIVE'],
  ['OG-01-03-002', 'Ogun', 'OG', 'Abeokuta North', '27/01', 'Ago Oko', '27/01/03', 'A Place', '002', '27/01/03/002', 'ACTIVE'],
  ['OG-01-01-001', 'Ogun', 'OG', 'Abeokuta North', '27/01', 'Ikereku', '27/01/01', 'X', '001', '27/01/01/001', 'ACTIVE'],
  ['OG-02-01-001', 'Ogun', 'OG', 'Abeokuta South', '27/02', 'Ake I', '27/02/01', 'Y', '001', '27/02/01/001', 'ACTIVE'],
  ['OG-02-01-002', 'Ogun', 'OG', 'Abeokuta South', '27/02', 'Ake I', '27/02/01', 'Retired', '002', '27/02/01/002', 'INACTIVE']
];
test('index groups LGA > ward > PU and skips inactive', () => {
  const idx = json(call('buildGeoIndex_', masterRows));
  assert.deepStrictEqual(idx.lgas.map((l) => l.name), ['Abeokuta North', 'Abeokuta South']);
  assert.deepStrictEqual(idx.wardsByLga['27/01'].map((w) => w.name), ['Ago Oko', 'Ikereku']);
  assert.strictEqual(idx.pusByWard['27/02/01'].length, 1);
  assert.deepStrictEqual(idx.pusByWard['27/01/03'].map((p) => p.code), ['001', '002']);
});

console.log('Admin stats and analytics');
const recRow = (id, pos, status, dup, lga, ward, when) => {
  const r = new Array(21).fill('');
  r[0] = id; r[4] = pos; r[7] = lga; r[9] = ward; r[12] = status; r[13] = dup; r[14] = when;
  r[3] = 'Name ' + id; r[5] = '+2348012345678'; r[6] = 'LGA'; r[8] = 'Ward'; r[10] = 'PU';
  return r;
};
const today = new Date('2026-10-20T15:00:00Z');
const rows = [
  recRow('A1', 'WARD_COORDINATOR', 'PENDING', 'FALSE', '27/01', '27/01/03', '2026-10-20T10:00:00Z'),
  recRow('A2', 'WARD_COORDINATOR', 'VERIFIED', 'TRUE', '27/01', '27/01/03', '2026-10-19T08:00:00Z'),
  recRow('A3', 'WARD_COORDINATOR', 'REJECTED', 'FALSE', '27/01', '27/01/01', '2026-10-10T08:00:00Z'),
  recRow('A4', 'LGA_COORDINATOR', 'PENDING', 'FALSE', '27/02', '27/02/01', '2026-10-20T11:00:00Z'),
  recRow('A5', 'STATE_EXCO', 'PENDING', 'FALSE', '27/02', '27/02/01', '2026-09-01T11:00:00Z')
];
test('dashboard counts', () => {
  assert.deepStrictEqual(json(call('computeStats_', rows)), { total: 5, STATE_EXCO: 1, LGA_COORDINATOR: 1, WARD_COORDINATOR: 3, pendingReview: 3, possibleDuplicates: 1 });
});
const geoIdx = () => call('buildGeoIndex_', [
  ['x', 'Ogun', 'OG', 'Abeokuta North', '27/01', 'Ago Oko', '27/01/03', 'p', '001', '27/01/03/001', 'ACTIVE'],
  ['x', 'Ogun', 'OG', 'Abeokuta North', '27/01', 'Ikereku', '27/01/01', 'p', '001', '27/01/01/001', 'ACTIVE'],
  ['x', 'Ogun', 'OG', 'Abeokuta South', '27/02', 'Ake I', '27/02/01', 'p', '001', '27/02/01/001', 'ACTIVE']
]);
test('analytics: coverage, status, position, daily', () => {
  const a = json(call('computeAnalytics_', rows, geoIdx(), today));
  assert.strictEqual(a.total, 5);
  assert.deepStrictEqual(a.byPosition, { STATE_EXCO: 1, LGA_COORDINATOR: 1, WARD_COORDINATOR: 3 });
  assert.deepStrictEqual(a.byStatus, { PENDING: 3, VERIFIED: 1, REJECTED: 1 });
  assert.deepStrictEqual(a.coverage, { wardsTotal: 3, wardsCovered: 2, lgasTotal: 2, lgasWithCoordinator: 1 });
  assert.strictEqual(a.daily.length, 14);
  assert.strictEqual(a.daily[13].date, '2026-10-20');
  assert.strictEqual(a.daily[13].count, 2);
  assert.strictEqual(a.daily[12].count, 1);
  assert.strictEqual(a.daily.reduce((s, d) => s + d.count, 0), 4); // the 1 Sep record is outside the 14-day window
  assert.strictEqual(a.lastSubmission, '2026-10-20T11:00:00Z');
  const north = a.lgas.filter((l) => l.code === '27/01')[0];
  assert.deepStrictEqual([north.lga, north.records, north.wardsCovered, north.wardsTotal], ['Abeokuta North', 3, 2, 2]);
});
test('analytics with no records', () => {
  const a = json(call('computeAnalytics_', [], geoIdx(), today));
  assert.strictEqual(a.total, 0);
  assert.strictEqual(a.coverage.wardsCovered, 0);
  assert.strictEqual(a.lastSubmission, '');
});
test('daily buckets use Nigerian time (UTC+1)', () => {
  const late = [recRow('L1', 'WARD_COORDINATOR', 'PENDING', 'FALSE', '27/01', '27/01/03', '2026-10-19T23:30:00Z')];
  const a = json(call('computeAnalytics_', late, geoIdx(), today));
  assert.strictEqual(a.daily.filter((d) => d.date === '2026-10-20')[0].count, 1);
});
test('record filtering and search', () => {
  assert.strictEqual(json(call('filterRecords_', rows, { position: 'WARD_COORDINATOR' })).length, 3);
  assert.strictEqual(json(call('filterRecords_', rows, { duplicatesOnly: true })).length, 1);
  assert.strictEqual(json(call('filterRecords_', rows, { status: 'VERIFIED' })).length, 1);
  assert.strictEqual(json(call('filterRecords_', rows, { q: 'a3' }))[0][0], 'A3');
  assert.strictEqual(json(call('filterRecords_', rows, { q: '8012345678' })).length, 5);
  assert.strictEqual(json(call('filterRecords_', rows, {}))[0][0], 'A5'); // newest (last row) first
});
test('admin passcode comparison', () => {
  assert.strictEqual(call('safeEquals_', 'ABC123', 'ABC123'), true);
  assert.strictEqual(call('safeEquals_', 'ABC123', 'ABC124'), false);
  assert.strictEqual(call('safeEquals_', 'ABC123', 'ABC12'), false);
});

console.log('CSV export');
test('csv escaping and formula protection', () => {
  assert.strictEqual(call('csvCell_', 'a,b', true), '"a,b"');
  assert.strictEqual(call('csvCell_', 'say "hi"', true), '"say ""hi"""');
  assert.strictEqual(call('csvCell_', '=HYPERLINK("x")', true), '"\'=HYPERLINK(""x"")"');
  assert.strictEqual(call('csvCell_', '+2348012345678', false), '+2348012345678');
  assert.strictEqual(call('csvCell_', null, true), '');
});
test('csv structure', () => {
  const out = call('toCsv_', ['Name', 'Phone'], [['Ola, A', '+234801'], ['=bad', '+234802']]);
  assert.strictEqual(out, 'Name,Phone\r\n"Ola, A",+234801\r\n\'=bad,+234802');
});

console.log('Router — Supabase cutover');
const parse = (out) => JSON.parse(out.text);
test('legacy public endpoints return the migration envelope', () => {
  ['getState', 'getLGAs', 'getWards', 'getPollingUnits', 'submitCoordinator', 'getRecords', 'getDashboardStats', 'exportRecords'].forEach((action) => {
    const method = ['submitCoordinator', 'exportRecords'].includes(action) ? 'POST' : 'GET';
    const r = parse(call('handleRequest_', action, {}, method));
    assert.strictEqual(r.success, false, action);
    assert.strictEqual(r.error.code, 'MIGRATED', action);
  });
});
test('sync receiver is not exposed through GET', () => {
  const r = parse(call('handleRequest_', 'syncSupabaseRecord', { syncSecret: 'not-a-secret' }, 'GET'));
  assert.strictEqual(r.success, false);
  assert.strictEqual(r.error.code, 'MIGRATED');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
