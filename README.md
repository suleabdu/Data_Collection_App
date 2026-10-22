# TK27 Ogun Coordinator System — Supabase migration

This rebuild keeps the existing TK27 indigo/slate visual style while moving the live application database from Google Sheets to Supabase Postgres. Google Sheets remains a mirror of new submissions and administrator record changes.

## What's included

- `frontend/index.html`: redesigned three-step public registration form (Coordinator → Location → Review & Submit).
- `frontend/admin.html`: email/password administrator workspace with clickable statistics, cascading filters, CSV export, audit activity, Sheet-sync retry, and live Supabase Realtime record updates.
- `supabase/migrations/202610210001_tk27_supabase.sql`: tables, validation RPCs, row-level security, audit trail, outbox queue, and Realtime publication setup.
- `supabase/functions/sync-google-sheet/`: secure server-side outbox processor that mirrors inserts/updates/deletes to the existing Google Sheet.
- `apps-script/SupabaseSyncService.gs` and the revised `apps-script/Router.gs`: Apps Script receiver for the server-to-server mirror. Keep the rest of the existing Apps Script files and same spreadsheet.
- `scripts/prepare_sheet_exports.py`: converts exported master and record tabs to CSV import files.
- `docs/MIGRATION.md`: step-by-step setup and cutover instructions.

## Important before you deploy

1. This ZIP does **not** contain your live Supabase project credentials or a copy of the live Google Sheet data. Create a Supabase project, run the SQL, and import your actual CSV exports.
2. Set `SUPABASE_URL` and the **publishable/anon key only** in `frontend/config.js`. Never put a Supabase secret/service-role key or any sync secret in browser files.
3. The migration starts collection in `PAUSED` mode on purpose. Import the master list and historical records, create an admin, verify the mirror, then resume collection from the dashboard.
4. The Google Sheet should remain private. Supabase is the source of truth after cutover; the Sheet is a one-way mirror.
5. The original `.git` folder is intentionally excluded from this package so previous history or credentials aren't copied into the new deployment.

See **[docs/MIGRATION.md](docs/MIGRATION.md)** for the full runbook.

## Local checks

Run the local checks from the project root:

```bash
node tests/run-tests.js
node tests/run-tests-api.js
node tests/frontend-smoke.js
```

These check retained validation/normalisation logic, confirm legacy Apps Script web routes are retired, and verify frontend/schema wiring. They do **not** replace a live Supabase + Google Apps Script integration test; that can only be completed after you connect your own project and spreadsheet following the migration runbook.


## Local testing before deployment

Follow `docs/LOCAL-TESTING-GUIDE.md` to test the website from `http://127.0.0.1:3000` against an isolated development Supabase project before creating/pushing to GitHub or deploying to Vercel.
