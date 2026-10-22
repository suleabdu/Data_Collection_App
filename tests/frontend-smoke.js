// Structural smoke checks for the current Supabase-backed frontend (no browser dependency).
// Run: node tests/frontend-smoke.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const frontend = path.join(root, 'frontend');

function htmlInfo(file) {
  const html = fs.readFileSync(path.join(frontend, file), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const unique = new Set(ids);
  assert.strictEqual(ids.length, unique.size, file + ' contains duplicate id attributes');
  for (const m of html.matchAll(/\b(?:src|href)="(\/[^"#?]+)"/g)) {
    const rel = m[1].replace(/^\//, '');
    assert.ok(fs.existsSync(path.join(frontend, rel)), file + ' references missing asset ' + m[1]);
  }
  return { html, ids: unique };
}

const pub = htmlInfo('index.html');
const admin = htmlInfo('admin.html');
for (const id of ['stepTitle','stepSubtitle','position','name','phone','lga','ward','pu','next1','next2','submitBtn']) {
  assert.ok(pub.ids.has(id), 'public page missing ' + id);
}
assert.match(pub.html, /STEP 01 \/ 03/);
assert.match(pub.html, /STEP 02 \/ 03/);
assert.match(pub.html, /STEP 03 \/ 03/);
assert.match(pub.html, /A clear, dependable record of our coordination structure/);
for (const id of ['email','password','q','fPosition','fStatus','fLga','fWard','fFrom','fTo','fDup','resetFilters','prev','next','statsGrid','recordRows','retrySyncBtn']) {
  assert.ok(admin.ids.has(id), 'admin page missing ' + id);
}
for (const [htmlFile, jsFile] of [['index.html','app.js'],['admin.html','admin.js']]) {
  const html = htmlFile === 'index.html' ? pub : admin;
  const js = fs.readFileSync(path.join(frontend, jsFile), 'utf8');
  const staticRefs = [...js.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]).filter((id) => !id.includes('+'));
  for (const id of staticRefs) assert.ok(html.ids.has(id), jsFile + ' references missing HTML id ' + id);
}
const adminJs = fs.readFileSync(path.join(frontend, 'admin.js'), 'utf8');
assert.match(adminJs, /postgres_changes/);
assert.match(adminJs, /function applyQuickFilter/);
assert.match(adminJs, /db\.functions\.invoke\('sync-google-sheet'/);
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/202610210001_tk27_supabase.sql'), 'utf8');
for (const token of ['create table if not exists public.coordinator_records','enable row level security','public.submit_coordinator','public.admin_dashboard_stats','public.sheet_sync_outbox','supabase_realtime']) {
  assert.ok(sql.toLowerCase().includes(token.toLowerCase()), 'migration missing ' + token);
}
const gas = fs.readFileSync(path.join(root, 'apps-script/SupabaseSyncService.gs'), 'utf8');
assert.match(gas, /SHEET_SYNC_STATE/);
assert.match(gas, /LockService\.getScriptLock/);
console.log('Frontend structure, filters, Realtime hooks, SQL migration and Sheet-sync smoke checks passed.');
