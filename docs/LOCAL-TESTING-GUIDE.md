# TK27 Ogun Supabase Rebuild — Local Testing Guide

**Goal:** test the rebuilt public form, admin dashboard, filters, Supabase database, Realtime, and (optionally) Google Sheets mirroring from your Windows computer **before pushing code to GitHub or deploying to Vercel**.

## Important: what “local” means for this package

The included `serve-local.js` runs the **website files** on your computer at `http://127.0.0.1:3000`. The website then connects to the Supabase URL configured in `frontend/config.js`.

For the first test, use a **separate Supabase development project** containing test data. Do not connect this local copy to your production database, and do not use real coordinator names or phone numbers in test submissions. This lets the web page run locally while the test database is isolated from production.

This package’s `frontend/supabase-client.js` currently accepts a hosted Supabase URL shaped like `https://<project-ref>.supabase.co`. A fully local Supabase stack from `supabase start` needs extra changes to that URL check and to the local Content Security Policy, so it is not the recommended first path in this guide.

## Phase 0 — Prepare a safe local copy

1. Download `TK27_Ogun_Supabase_Rebuild_with_Local_Guide.zip` (or use the original rebuild ZIP if you have already extracted it).
2. In File Explorer, create a folder such as `C:\TK27\Supabase-Test`.
3. Extract the ZIP into that folder. Do not run commands from inside the ZIP preview.
4. Open the extracted project folder in Visual Studio Code, or open PowerShell in the folder.
5. Confirm the project root contains these items:

   - `serve-local.js`
   - `frontend\index.html`
   - `frontend\admin.html`
   - `frontend\config.js`
   - `supabase\migrations\202610210001_tk27_supabase.sql`
   - `tests\run-tests.js`
   - `tests\run-tests-api.js`
   - `tests\frontend-smoke.js`

**Do not** rename or move the `frontend`, `supabase`, `scripts`, or `tests` folders. The commands below assume you are in the project root—the folder containing `serve-local.js`.

## Phase 1 — Install/check the local tools

Install the current Node.js LTS release from <https://nodejs.org/> if it is not installed. The included static test server and test scripts use Node.js built-ins; no `npm install` is needed for these basic checks. Python 3 is only required if you use the included CSV conversion script.

Open a terminal in the project root and run:

```powershell
node --version
npm --version
python --version
```

`node` and `npm` must return version numbers. If `python` is not recognised, either install Python 3 or use another method to prepare the import CSVs; do not continue with the CSV-conversion step until Python is available.

## Phase 2 — Run the supplied automated checks first

Run each command separately from the project root:

```powershell
node tests/run-tests.js
node tests/run-tests-api.js
node tests/frontend-smoke.js
```

Expected result for this package version:

- `tests/run-tests.js`: **46 passed, 0 failed**
- `tests/run-tests-api.js`: **30 passed, 0 failed**
- `tests/frontend-smoke.js`: `Frontend structure, filters, Realtime hooks, SQL migration and Sheet-sync smoke checks passed.`

These are local unit/structure checks. They do not prove that your real Supabase project, Auth account, Realtime publication, Apps Script receiver, or Sheet sync works. If any check fails, stop and resolve the reported error before proceeding.

## Phase 3 — Create an isolated Supabase development project

1. Open <https://supabase.com/dashboard> and create a new project specifically for development/testing, for example `tk27-ogun-dev`.
2. Use a strong database password and store it privately.
3. Do not select or reuse your eventual production project for this first test.
4. In the project dashboard, open **Project Settings → API** (labels can change). Copy:
   - the **Project URL**, shaped like `https://YOUR_PROJECT_REF.supabase.co`;
   - the **publishable key** (or legacy `anon` key).
5. Never copy a `service_role` or secret key into the browser configuration. The frontend key is public by design; access must be constrained by the migration’s database grants and Row Level Security (RLS).

No GitHub or Vercel project is required for this step.

## Phase 4 — Create the Supabase schema

1. In the unzipped folder, open `supabase/migrations/202610210001_tk27_supabase.sql` in a text editor.
2. Copy the **entire** SQL file.
3. In the development Supabase project, open **SQL Editor → New query**.
4. Paste the SQL and run it.
5. Open **Table Editor** and confirm these tables exist:

   - `master_geography`
   - `coordinator_records`
   - `app_settings`
   - `admin_users`
   - `record_sequences`
   - `audit_log`
   - `sheet_sync_outbox`

6. Confirm `app_settings` contains `APPLICATION_STATUS = PAUSED`.

If the SQL Editor reports an error, do not run random fragments or change production settings. Copy the full error and note the statement/line reported before troubleshooting.

## Phase 5 — Import geography into the development project

For the simplest public-form test, you need the geography master but **not your real historical coordinator records**.

1. In your existing Google Spreadsheet, open `MASTER_GEOGRAPHY` and use **File → Download → Comma-separated values (.csv)**. Save the file as `MASTER_GEOGRAPHY.csv` in a private local folder, for example `C:\TK27\imports`.
2. Create a second, header-only CSV file named `COORDINATOR_RECORDS.csv` in the same private folder. Put this exact single header line in it:

```csv
Record_ID,State,State_Code,Name,Position,Phone,LGA,LGA_Code,Ward,Ward_Code,Polling_Unit,Polling_Unit_Code,Verification_Status,Duplicate_Flag,Submitted_At,Updated_At,Submitted_By,Notes,Submission_Key,Normalized_Name,Normalized_Phone
```

This header-only file tells the converter there are no historical test records to import. Do not export personal coordinator records just to test the public form.

3. From the project root, run the converter, substituting the actual paths:

```powershell
python scripts/prepare_sheet_exports.py "C:\TK27\imports\MASTER_GEOGRAPHY.csv" "C:\TK27\imports\COORDINATOR_RECORDS.csv"
```

4. The script should report around **5,042 geography rows and 0 coordinator records** for the previously validated Ogun master. It writes files into `migration-data\`.
5. In Supabase **Table Editor → master_geography → Import data from CSV**, select `migration-data\master_geography.csv`. Confirm the columns are mapped to the matching table columns, then import.
6. Verify counts. The known master list contained **20 LGAs, 236 wards and 5,042 polling units**. If the imported counts differ unexpectedly, keep collection paused and investigate before testing submissions.

The converter normalises source master rows marked `ACTIVE` to `VALID`, because the new Supabase public selectors read rows with status `VALID`.

## Phase 6 — Create a development admin account

1. In Supabase, open **Authentication → Users** and add a development admin user with an email you control and a strong password.
2. Ensure the account is confirmed/enabled so password sign-in can succeed. Avoid enabling public administrator sign-up for production.
3. Open **SQL Editor → New query** and run this SQL after replacing the email with the exact email for the development account:

```sql
insert into public.admin_users(user_id, email, active)
select id, email, true
from auth.users
where lower(email) = lower('admin@example.com')
on conflict (user_id) do update
set email = excluded.email, active = true;
```

4. Run a check:

```sql
select user_id, email, active
from public.admin_users
where lower(email) = lower('admin@example.com');
```

The account must appear with `active = true`. The authentication user and the `admin_users` allow-list entry are both required: creating only an Auth user is not enough.

## Phase 7 — Connect the local frontend to the development project

1. Open `frontend/config.js` in VS Code or another text editor.
2. Replace the placeholder values with the **development project URL** and its publishable/anon key:

```javascript
window.TK27_CONFIG = {
  SUPABASE_URL: 'https://YOUR_DEV_PROJECT_REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_DEV_PUBLISHABLE_OR_ANON_KEY',
  STATE_FALLBACK: 'Ogun'
};
```

3. Keep the quotation marks and commas as shown. Do not add the database password, service-role/secret key, admin password, Apps Script sync secret or webhook secret to this file.
4. Save the file.

The Project URL must belong to your development project. If you accidentally pasted a production URL/key, correct it before opening the app.

## Phase 8 — Start the local web server

In the terminal, still at the project root, run:

```powershell
node serve-local.js
```

You should see a message showing:

- Public form: `http://127.0.0.1:3000/`
- Admin: `http://127.0.0.1:3000/admin`

Open these exact URLs in Chrome or Edge:

- Public registration: `http://127.0.0.1:3000/`
- Admin dashboard: `http://127.0.0.1:3000/admin`

Keep that terminal open while testing. To stop the server, return to the terminal and press **Ctrl+C**. To use another port, stop the first server and run `node serve-local.js 8080`; then use `http://127.0.0.1:8080/`.

If the browser says the page is not connected to Supabase, recheck `frontend/config.js` for placeholders, URL spelling and saved changes. The provided local server binds to loopback so the test site is available on your computer, not intentionally exposed on your network.

## Phase 9 — Test the public three-step form

Complete these checks before inserting any test record:

1. Page 1 displays the title/subtitle and a **Step 01 / 03** progress indicator.
2. Position options load: State Exco, LGA Coordinator, Ward Coordinator.
3. If the form says collection is paused, sign in to the admin dashboard and resume collection **only in the development project**. Collection is paused by default as a safety measure.
4. Confirm the LGA dropdown contains options. Select an LGA and confirm Ward options load. Select a Ward and confirm its polling units load. Change the LGA and confirm downstream choices reset rather than retaining an invalid Ward/PU.
5. Test required fields and an invalid phone number. The UI should show useful validation messages.
6. Move through steps 1 → 2 → 3 and check that the review screen displays the entered values correctly.
7. Submit only synthetic data, such as the name `Local Test Coordinator`. Use a test phone number accepted by the app but do not use a real person's contact details. This application does not send a phone message during submission, but the saved record remains personal data even in a test system.
8. After success, note the generated reference. In Supabase **Table Editor → coordinator_records**, confirm the same record appears once.
9. Try double-clicking Submit or retrying after a delay. The submission key should help avoid accidental duplicate inserts for the same attempt.

Do not open public collection to actual coordinators until the full cutover and access checks are complete.

## Phase 10 — Test admin filters and realtime updates

1. In another tab, open `http://127.0.0.1:3000/admin`.
2. Sign in using the development admin email/password created earlier.
3. If sign-in works but the admin panel says the account is not authorised, check the matching active row in `public.admin_users`.
4. Check that the record count and test row appear in the dashboard.
5. Exercise the filters one by one:
   - free-text search;
   - position;
   - verification status;
   - LGA;
   - Ward (after choosing an LGA);
   - From and To dates;
   - duplicate-only checkbox;
   - each statistics tile/quick filter;
   - Reset filters;
   - Previous/Next pagination;
   - CSV export.
6. Open the public form in a separate browser window or another browser. Submit a second synthetic record while the admin view stays open.
7. Confirm the admin record list and statistics update without a manual browser refresh. The live indicator should show a connected state.
8. In DevTools, press **F12 → Console** and **Network** if something fails. Look for Supabase 401/403 responses, failed WebSocket connections, policy errors or missing functions.
9. If the record exists in the table but realtime does not update, check the `supabase_realtime` publication includes `public.coordinator_records`. Confirm the signed-in admin has SELECT permission through RLS. Reloading may fetch the record, but that alone does not prove realtime works.

Use test records only and delete/remove them after the test according to the dashboard capabilities; keep a written list of test IDs.

## Phase 11 — Test Google Sheets mirroring (optional integration test)

The public form and admin realtime can be tested before Apps Script syncing is connected. To verify the full Supabase → Google Sheets mirror safely, use a **copy** of the current spreadsheet.

1. In Google Sheets, use **File → Make a copy**. Name it something obvious, such as `TK27 DEV TEST — DO NOT USE FOR OPERATIONS`. Do not alter/share the production sheet.
2. Open the copied spreadsheet → **Extensions → Apps Script**.
3. Add `apps-script/SupabaseSyncService.gs` from this package and replace `Router.gs` with the matching package version. Retain the other existing Apps Script source files the sync code depends upon.
4. In Apps Script **Project Settings → Script properties**, add `SUPABASE_SYNC_SECRET` with a new random secret of at least 32 random bytes. Never put it in frontend code or Git.
5. Deploy → Manage deployments → edit/create the Web App deployment. Use **Execute as: Me** and an access setting that allows the server-to-server call; the receiver still validates the shared secret. Copy the web app URL ending in `/exec`. Keep the copied Sheet private.
6. Install/use Supabase CLI if needed. From the project root, run `npx supabase --version`, then authenticate and link to the **development** project:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_DEV_PROJECT_REF
npx supabase functions deploy sync-google-sheet --no-verify-jwt
```

7. In Supabase **Edge Functions → Secrets**, set:
   - `GOOGLE_APPS_SCRIPT_URL` = the Apps Script `/exec` URL for the copied test sheet;
   - `GOOGLE_APPS_SCRIPT_SYNC_SECRET` = exactly the same secret as Apps Script `SUPABASE_SYNC_SECRET`;
   - `TK27_WEBHOOK_SECRET` = a different random secret reserved for the Supabase database webhook.

   Alternatively, set them with the CLI (substitute real values privately; do not paste them into a chat):

```powershell
npx supabase secrets set GOOGLE_APPS_SCRIPT_URL="https://script.google.com/macros/s/DEPLOYMENT_ID/exec" GOOGLE_APPS_SCRIPT_SYNC_SECRET="YOUR_SCRIPT_SYNC_SECRET" TK27_WEBHOOK_SECRET="YOUR_SEPARATE_WEBHOOK_SECRET"
```

8. In Supabase **Database → Webhooks**, create an INSERT webhook on `public.sheet_sync_outbox` to `https://YOUR_DEV_PROJECT_REF.supabase.co/functions/v1/sync-google-sheet`, using headers `Content-Type: application/json` and `x-tk27-webhook-secret` with the matching webhook secret.
9. Submit a new synthetic record in the local form. Check `coordinator_records`, then the copied Sheet's `COORDINATOR_RECORDS` tab. A record should appear in the Sheet after the webhook runs.
10. Change its verification status in the admin page and confirm the Sheet row updates. If sync fails, inspect Edge Function logs, Apps Script execution logs and the admin's sync retry control. A row remaining in Supabase while Sheet sync is failed is expected: Supabase is the source of truth and the outbox is retryable.

Do not truncate queues or run historical backfill tests against the operating Sheet. For a blank test Sheet, leave queued events and retry until no pending/failed rows remain.

## Phase 12 — Final local acceptance checklist

Before creating/pushing a GitHub repository or deploying to Vercel, tick every box that applies:

1. ☐ All three supplied Node test commands pass.
2. ☐ `frontend/config.js` points to the development Supabase project, not production.
3. ☐ The SQL migration ran without unresolved errors.
4. ☐ Geography counts are verified and dropdown cascades work.
5. ☐ A development admin can sign in and is allow-listed.
6. ☐ Collection remains paused until explicitly enabled for a test.
7. ☐ A synthetic submission appears once in Supabase with a reference ID.
8. ☐ Filters, quick-stat clicks, Reset, pagination and CSV export behave correctly.
9. ☐ A new submission appears in an already-open dashboard without manual refresh.
10. ☐ If testing Sheet sync, a synthetic submission and later status change both mirror to the copied spreadsheet.
11. ☐ No `service_role` key, database password, admin password, Apps Script sync secret, webhook secret, or coordinator CSV is in frontend files or Git-tracked files.
12. ☐ `migration-data/` is local-only and `git status` does not show personal CSV exports.

When these pass, stop the local server with **Ctrl+C**. At this point you can decide to push the tested code to a **private** GitHub repository and deploy a preview to Vercel. A production launch is a separate step and should use its own Supabase project, secrets and reviewed data migration.

## Troubleshooting quick reference

- **Form says not connected to Supabase:** confirm `frontend/config.js` is saved, its URL is `https://<ref>.supabase.co`, and the key is the publishable/anon key. Reopen the browser tab.
- **LGA/Ward/PU selectors are empty:** check that `master_geography` has rows with `status = VALID`, confirm CSV column mapping, and confirm the `get_public_lgas`, `get_public_wards` and `get_public_polling_units` functions exist.
- **Form says collection is paused:** expected default. Resume only in the development project, from the admin dashboard, after imports.
- **Admin can sign in but is denied:** confirm the email matches an active row in `admin_users`.
- **Submission reports a permission/policy error:** verify the full migration completed and its submission RPC grants/RLS policies exist. Do not fix this by making tables public.
- **Dashboard loads but does not live-update:** check browser WebSocket/network errors, the `supabase_realtime` publication, and the admin SELECT/RLS policy.
- **Google Sheet does not update:** check webhook delivery, Edge Function logs/secrets, the Apps Script `/exec` URL, Apps Script execution logs and outbox status.
- **Port 3000 is already in use:** run `node serve-local.js 8080` and browse to `http://127.0.0.1:8080/`.

## Useful official references

- Supabase local development and CLI: <https://supabase.com/docs/guides/local-development>
- Supabase CLI getting started: <https://supabase.com/docs/guides/local-development/cli/getting-started>

