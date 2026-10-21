// Headless-browser smoke test of the real pages against a mocked backend.
// Run: node tests/browser-smoke.js   (needs Playwright + Chromium; used here only for QA, not for deployment)
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', 'frontend');
const API = 'https://script.google.com/macros/s/TESTID/exec';
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const CSP = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8')).headers[0].headers.filter((h) => h.key === 'Content-Security-Policy')[0].value;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Security-Policy', CSP);
  const file = path.join(root, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  if (req.url.startsWith('/config.js')) { res.setHeader('content-type', 'text/javascript'); return res.end(`window.TK27_CONFIG={API_URL:'${API}'}`); }
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', types[path.extname(file)] || 'text/plain');
  res.end(fs.readFileSync(file));
});

const ok = (data) => ({ success: true, data });
const geo = {
  lgas: [{ code: '27/01', name: 'Abeokuta North' }, { code: '27/02', name: 'Abeokuta South' }],
  wards: { '27/01': [{ code: '27/01/03', name: 'Ago Oko' }], '27/02': [{ code: '27/02/01', name: 'Ake I' }] },
  pus: { '27/01/03': [{ code: '001', fullCode: '27/01/03/001', name: 'Space At Itamorin I' }, { code: '002', fullCode: '27/01/03/002', name: 'Space At Itamorin I' }] }
};

let results = [], failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('  ok   ' + name); } catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + e.message.split('\n')[0]); }
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = 'http://localhost:' + server.address().port;
  const browser = await chromium.launch();

  async function newPage(width, backend) {
    const ctx = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => { failures++; console.log('  PAGE ERROR ' + e.message); });
    page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) { failures++; console.log('  CSP VIOLATION ' + m.text().slice(0, 160)); } });
    await page.route(API + '**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const body = req.method() === 'POST' ? JSON.parse(req.postData() || '{}') : null;
      const out = await backend(req.method() === 'GET' ? url.searchParams.get('action') : body.action, req.method() === 'GET' ? Object.fromEntries(url.searchParams) : body);
      if (out === 'DROP') return route.abort('failed');
      route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
    });
    return page;
  }

  // ------------------------------------------------------------------ public form
  console.log('Public form');
  let submitCalls = [], dropNext = false;
  const publicBackend = async (action, p) => {
    if (action === 'getState') return ok({ state: 'Ogun', paused: false, ready: true, positions: [{ value: 'STATE_EXCO', label: 'State Exco' }, { value: 'LGA_COORDINATOR', label: 'LGA Coordinator' }, { value: 'WARD_COORDINATOR', label: 'Ward Coordinator' }] });
    if (action === 'getLGAs') return ok(geo.lgas);
    if (action === 'getWards') return ok(geo.wards[p.lgaCode] || []);
    if (action === 'getPollingUnits') return ok(geo.pus[p.wardCode] || []);
    if (action === 'submitCoordinator') {
      submitCalls.push(p);
      if (dropNext) { dropNext = false; return 'DROP'; }
      return ok({ recordId: 'OG-WC-000184', duplicate: false, duplicateMessage: '', summary: { name: 'Ola Adebayo', position: 'Ward Coordinator', phone: '+2348012345678', lga: 'Abeokuta North', ward: 'Ago Oko', pollingUnit: 'Space At Itamorin I' } });
    }
    return { success: false, error: { code: 'NOT_FOUND', message: 'x' } };
  };

  const page = await newPage(375, publicBackend);
  await page.goto(base + '/');
  await page.waitForSelector('#lga:not([disabled])');

  await step('loads state name and positions', async () => {
    assert.strictEqual((await page.textContent('#stateName')).trim(), 'OGUN STATE');
    assert.strictEqual(await page.locator('#position option').count(), 4);
  });
  await step('ward and polling unit start disabled; LGA enabled', async () => {
    assert.ok(await page.isDisabled('#ward')); assert.ok(await page.isDisabled('#pu')); assert.ok(!(await page.isDisabled('#lga')));
  });
  await step('empty submit shows every error and sends nothing', async () => {
    await page.click('#submitBtn');
    for (const f of ['position', 'name', 'phone', 'lga', 'ward', 'pu']) assert.ok(await page.isVisible('#e-' + f), f);
    assert.strictEqual(submitCalls.length, 0);
  });
  await step('invalid phone is rejected client-side', async () => {
    await page.fill('#name', 'Ola Adebayo'); await page.fill('#phone', '12345'); await page.click('#submitBtn');
    assert.ok((await page.textContent('#e-phone')).includes('valid Nigerian phone'));
  });
  await step('LGA -> Ward -> PU cascade, with reset on change', async () => {
    await page.selectOption('#lga', '27/01');
    await page.waitForFunction(() => !document.getElementById('ward').disabled);
    assert.strictEqual(await page.locator('#ward option').count(), 2);
    await page.selectOption('#ward', '27/01/03');
    await page.waitForFunction(() => !document.getElementById('pu').disabled);
    assert.strictEqual(await page.locator('#pu option').count(), 3);
    assert.ok((await page.locator('#pu option').nth(1).textContent()).includes('(001)'));   // same-name units are distinguishable
    await page.selectOption('#lga', '27/02');
    await page.waitForFunction(() => document.getElementById('ward').options.length === 2 && !document.getElementById('ward').disabled);
    assert.ok(await page.isDisabled('#pu'));
    assert.strictEqual(await page.inputValue('#ward'), '');
  });
  await step('no horizontal overflow at 375px', async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  });

  await page.selectOption('#position', 'WARD_COORDINATOR'); await page.fill('#phone', '0801 234 5678');
  await page.selectOption('#lga', '27/01'); await page.waitForFunction(() => !document.getElementById('ward').disabled && document.getElementById('ward').options.length === 2);
  await page.selectOption('#ward', '27/01/03'); await page.waitForFunction(() => !document.getElementById('pu').disabled && document.getElementById('pu').options.length === 3);
  await page.selectOption('#pu', '27/01/03/001');

  await step('network failure keeps the form, shows the message, never a false success', async () => {
    dropNext = true;
    await page.click('#submitBtn');
    await page.waitForSelector('#banner:not([hidden])');
    assert.ok((await page.textContent('#banner')).includes('Connection interrupted. Your information has not been submitted'));
    assert.ok(await page.isHidden('#successCard'));
    assert.strictEqual(await page.inputValue('#name'), 'Ola Adebayo');
    assert.strictEqual(await page.inputValue('#pu'), '27/01/03/001');
  });
  await step('retry reuses the same submission key (safe against duplicates)', async () => {
    await page.click('#submitBtn');
    await page.waitForSelector('#successCard:not([hidden])');
    assert.strictEqual(submitCalls.length, 2);
    assert.strictEqual(submitCalls[0].submissionKey, submitCalls[1].submissionKey);
    assert.strictEqual(submitCalls[1].puCode, '27/01/03/001');
  });
  await step('success shows reference number and summary', async () => {
    assert.strictEqual((await page.textContent('#refNumber')).trim(), 'OG-WC-000184');
    assert.ok((await page.textContent('#summary')).includes('Ago Oko'));
  });
  await step('add another record: fresh form, position kept, new key', async () => {
    await page.click('#addAnother');
    assert.ok(await page.isVisible('#formCard'));
    assert.strictEqual(await page.inputValue('#position'), 'WARD_COORDINATOR');
    assert.strictEqual(await page.inputValue('#name'), '');
    assert.ok(await page.isDisabled('#ward'));
  });
  await step('double-click submits only once', async () => {
    const before = submitCalls.length;
    await page.fill('#name', 'Zainab Musa'); await page.fill('#phone', '07061234567');
    await page.selectOption('#lga', '27/01'); await page.waitForFunction(() => !document.getElementById('ward').disabled && document.getElementById('ward').options.length === 2);
    await page.selectOption('#ward', '27/01/03'); await page.waitForFunction(() => !document.getElementById('pu').disabled && document.getElementById('pu').options.length === 3);
    await page.selectOption('#pu', '27/01/03/002');
    await page.dblclick('#submitBtn');
    await page.waitForSelector('#successCard:not([hidden])');
    assert.strictEqual(submitCalls.length - before, 1);
    assert.notStrictEqual(submitCalls[submitCalls.length - 1].submissionKey, submitCalls[0].submissionKey);
  });
  await page.context().close();

  await step('320px width: no horizontal overflow, buttons >= 48px', async () => {
    const p = await newPage(320, publicBackend);
    await p.goto(base + '/'); await p.waitForSelector('#lga:not([disabled])');
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    assert.ok((await p.locator('#submitBtn').boundingBox()).height >= 48);
    assert.ok((await p.locator('#lga').boundingBox()).height >= 48);
    await p.context().close();
  });
  await step('backend error on startup shows a retry, not a blank page', async () => {
    const p = await newPage(375, async () => 'DROP');
    await p.goto(base + '/'); await p.waitForSelector('#banner:not([hidden])');
    assert.ok((await p.textContent('#banner')).length > 10);
    await p.context().close();
  });
  await step('paused collection disables submitting', async () => {
    const p = await newPage(375, async (a) => (a === 'getState' ? ok({ state: 'Ogun', paused: true, ready: true, positions: [] }) : ok([])));
    await p.goto(base + '/'); await p.waitForSelector('#banner:not([hidden])');
    assert.ok((await p.textContent('#banner')).includes('paused'));
    assert.ok(await p.isDisabled('#submitBtn'));
    await p.context().close();
  });

  // ------------------------------------------------------------------ admin
  console.log('Admin');
  const rowsData = [{ recordId: 'OG-WC-000001', name: 'Ola Adebayo', position: 'WARD_COORDINATOR', phone: '+2348012345678', lga: 'Abeokuta North', ward: 'Ago Oko', pollingUnit: 'Space', pollingUnitCode: '001', verificationStatus: 'PENDING', duplicate: true, submittedAt: '2026-10-20T10:00:00Z', notes: 'Possible duplicate of OG-WC-000000' }];
  const adminBackend = async (action, p) => {
    if (p.passcode !== 'GOODCODE12') return { success: false, error: { code: 'UNAUTHORIZED', message: 'Incorrect admin passcode.' } };
    if (action === 'adminCheck') return ok({ ok: true });
    if (action === 'getDashboardStats') return ok({ stats: { total: 1, STATE_EXCO: 0, LGA_COORDINATOR: 0, WARD_COORDINATOR: 1, pendingReview: 1, possibleDuplicates: 1 }, applicationStatus: 'LIVE', master: { state: 'Ogun', lgas: 20, wards: 236, pollingUnits: 5042, lastUpdated: '2026-10-20T08:00:00Z', source: 'Nigeria 2.0', verification: 'UNVERIFIED_THIRD_PARTY', status: 'WARNING', lastImportMessage: 'ok' } });
    if (action === 'getAnalytics') return ok({ total: 1, byPosition: {}, byStatus: { PENDING: 1, VERIFIED: 0, REJECTED: 0 }, daily: Array.from({ length: 14 }, (_, i) => ({ date: '2026-10-' + String(7 + i).padStart(2, '0'), count: i === 13 ? 1 : 0 })), lgas: [{ code: '27/01', lga: 'Abeokuta North', records: 1, lgaCoordinators: 0, wardCoordinators: 1, wardsTotal: 16, wardsCovered: 1 }], coverage: { wardsTotal: 236, wardsCovered: 1, lgasTotal: 20, lgasWithCoordinator: 0 }, lastSubmission: '2026-10-20T10:00:00Z' });
    if (action === 'getRecords') return ok({ total: 1, page: 1, pageSize: 25, rows: rowsData });
    return ok({});
  };
  const admin = await newPage(1024, adminBackend);
  await admin.goto(base + '/admin.html');
  await step('wrong passcode is refused', async () => {
    await admin.fill('#passcode', 'WRONG'); await admin.click('#loginBtn');
    await admin.waitForSelector('#loginBanner:not([hidden])');
    assert.ok((await admin.textContent('#loginBanner')).includes('Incorrect'));
    assert.ok(await admin.isHidden('#dash'));
  });
  await step('correct passcode opens the dashboard with cards, analytics, records', async () => {
    await admin.fill('#passcode', 'GOODCODE12'); await admin.click('#loginBtn');
    await admin.waitForSelector('#dash:not([hidden])');
    await admin.waitForSelector('#records tr td');
    assert.strictEqual(await admin.locator('#cards .stat').count(), 6);
    assert.ok((await admin.textContent('#progress')).includes('Wards with a coordinator (1 of 236)'));
    assert.ok((await admin.textContent('#lgaTable')).includes('Abeokuta North'));
    assert.ok((await admin.textContent('#records')).includes('OG-WC-000001'));
    assert.ok((await admin.textContent('#master')).includes('WARNING'));
    assert.strictEqual(await admin.locator('#exports button').count(), 6);
  });
  await step('sign out returns to the login form', async () => {
    await admin.click('#signOut');
    assert.ok(await admin.isVisible('#loginCard')); assert.ok(await admin.isHidden('#dash'));
  });

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : '\nall browser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
