# TK27 migration runbook: Google Sheets database → Supabase + Sheets mirror

This procedure is intentionally ordered to prevent record-ID collisions or public submissions against an incomplete database. Use the same private Google Spreadsheet you currently use for TK27 so historical rows remain available there as the mirror.

## 0. Make a safe backup

1. In Google Sheets, make a copy of the current TK27 spreadsheet.
2. Check that `MASTER_GEOGRAPHY` has the expected headers and roughly 5,042 valid geography rows.
3. Export these two tabs as **CSV**: `MASTER_GEOGRAPHY` and `COORDINATOR_RECORDS`. Name the downloaded files `MASTER_GEOGRAPHY.csv` and `COORDINATOR_RECORDS.csv`.
4. Keep these exports private. They contain coordinator names and phone numbers; do not commit them to GitHub or attach them to a public issue.

## 1. Create the Supabase database

1. Create a Supabase project and keep its database password in a password manager.
2. Open **SQL Editor → New query**.
3. Paste and run the complete file `supabase/migrations/202610210001_tk27_supabase.sql` from this package.
4. Confirm the following tables exist: `master_geography`, `coordinator_records`, `app_settings`, `admin_users`, `record_sequences`, `audit_log`, and `sheet_sync_outbox`.
5. The application status is seeded as `PAUSED`. Do not resume it until all migration steps are complete.

## 2. Convert and import the existing Google Sheet data

Run the included converter locally from the unzipped project folder. Python 3 is sufficient; no packages are required.

```bash
python scripts/prepare_sheet_exports.py "C:/path/to/MASTER_GEOGRAPHY.csv" "C:/path/to/COORDINATOR_RECORDS.csv"
```

On Windows, replace the two example paths with the real file locations. The converter writes:

- `migration-data/master_geography.csv`
- `migration-data/coordinator_records.csv`

The converter stops and reports missing required values instead of silently dropping rows. Fix any listed source rows and run it again. The `migration-data/` folder is git-ignored.

Import in this order, using **Table Editor → table → Import data from CSV**:

1. Import `migration-data/master_geography.csv` into `master_geography`.
2. Import `migration-data/coordinator_records.csv` into `coordinator_records`.

Confirm the column mapping before committing each import. The CSV headers are already converted to the Supabase column names. `full_pu_code` is the unique key for geography; `record_id` is the unique key for coordinator records.

Check the imported counts match the source tabs. For the geography list built earlier, expected totals were 20 LGAs, 236 wards, and 5,042 polling units. Do not proceed if the row counts unexpectedly differ.

### Seed record number sequences after importing existing records

Run this in SQL Editor after the coordinator CSV import. This continues numbering after the highest existing reference for each position.

```sql
insert into public.record_sequences(prefix, last_value)
select regexp_replace(record_id, '[0-9]{6}$', '') as prefix,
       max(substring(record_id from '([0-9]{6})$')::bigint) as last_value
from public.coordinator_records
where record_id ~ '^OG-(EXCO|LGA|WC)-[0-9]{6}$'
group by regexp_replace(record_id, '[0-9]{6}$', '')
on conflict (prefix) do update
set last_value = greatest(public.record_sequences.last_value, excluded.last_value);
```

**Existing spreadsheet mirror:** importing historical records creates outbox entries because the migration trigger is active. If you imported records from the exact same spreadsheet that will remain the mirror, clear only those initial queue events now, before creating the webhook, because those rows already exist in the Sheet:

```sql
truncate table public.sheet_sync_outbox restart identity;
```

If the spreadsheet being used as the mirror is blank or does not already contain those rows, do **not** truncate the queue. Instead, leave the events in place and run “Retry Sheet sync” in the admin dashboard in batches until the queue is clear.

## 3. Create the administrator account

1. In Supabase, open **Authentication → Users** and create the administrator with a strong, unique email/password. Do not use a public sign-up link for admin provisioning.
2. In SQL Editor, replace `admin@example.com` below with the account's exact email and run:

```sql
insert into public.admin_users(user_id, email, active)
select id, email, true
from auth.users
where lower(email) = lower('admin@example.com')
on conflict (user_id) do update set email = excluded.email, active = true;
```

3. Confirm one row exists in `admin_users` and `active = true`. Only users listed as active in this table can read coordinator records or use admin actions.

## 4. Connect the frontend to Supabase

1. In Supabase, open **Project Settings → API** (or the API Keys section in the current dashboard) and copy the Project URL plus the **publishable key** (or legacy `anon` key).
2. Open `frontend/config.js` and replace the two placeholders:

```js
window.TK27_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT_REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
  STATE_FALLBACK: 'Ogun'
};
```

The publishable/anon key is expected to be visible in the browser. It is safe only because the database has row-level security and the public role is granted only the necessary location reads and guarded submission RPC. **Never use a `service_role` or secret key in `config.js`.**

## 5. Add the Sheets mirror receiver to Apps Script

Use the same Google Spreadsheet as your private mirror.

1. Open the spreadsheet → **Extensions → Apps Script**.
2. Add a script file named `SupabaseSyncService.gs` and paste in the included file of that name.
3. Replace the contents of `Router.gs` with the included revised `apps-script/Router.gs`.
4. Keep `Config.gs`, `Utilities.gs`, `AdminService.gs`, `AuditService.gs`, `MasterDataService.gs`, and the other existing files in the project. The sync service depends on helpers in those files, including `safeEquals_`, `AppError`, `getOrCreateSheet_`, `findRowByKey_`, and `logAudit_`.
5. In **Project Settings → Script properties**, add `SUPABASE_SYNC_SECRET` with a strong random value (at least 32 random bytes). Keep it private. Do not put this value in any frontend or Git file.
6. Deploy → **Manage deployments** → edit the existing Web App deployment and choose a new version. Keep **Execute as: Me** and **Who has access: Anyone** so the Supabase server can reach it. Copy the stable `/exec` URL. The receiver checks the shared secret on every sync request. It also creates a hidden `SHEET_SYNC_STATE` tab to track the latest processed outbox sequence for each record, which helps prevent delayed webhook deliveries from undoing newer updates or resurrecting deleted rows.

The revised router intentionally retires the legacy public submission and passcode-admin routes. After cutover, changes should be made through Supabase so the Sheet cannot become an independent, conflicting source of truth. Spreadsheet-bound menu operations remain in the project, but use the new web application for coordinator collection and administration.

## 6. Deploy the Supabase sync function

Install the Supabase CLI if needed, then from the unzipped project folder run:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy sync-google-sheet --no-verify-jwt
```

The function validates either the private database-webhook header or a live Supabase session belonging to an active admin. It uses server-only secrets to write the matching row into Google Sheets.

In **Supabase → Edge Functions → Secrets**, set these values:

| Secret name | Value |
|---|---|
| `GOOGLE_APPS_SCRIPT_URL` | Your Apps Script Web App URL ending in `/exec` |
| `GOOGLE_APPS_SCRIPT_SYNC_SECRET` | Exactly the same value as Apps Script Script Property `SUPABASE_SYNC_SECRET` |
| `TK27_WEBHOOK_SECRET` | A second, different random secret used only by the Supabase database webhook |

You may also set them by CLI:

```bash
supabase secrets set GOOGLE_APPS_SCRIPT_URL="https://script.google.com/macros/s/DEPLOYMENT_ID/exec" GOOGLE_APPS_SCRIPT_SYNC_SECRET="YOUR_SCRIPT_SYNC_SECRET" TK27_WEBHOOK_SECRET="YOUR_SEPARATE_WEBHOOK_SECRET"
```

Use your real secret values locally; don't paste secrets into chat, GitHub, or the browser's runtime variables.

## 7. Trigger reliable Sheet syncs

In Supabase, open **Database → Webhooks → Create a new webhook**:

- Name: `tk27-sheet-sync-outbox`
- Table/schema: `public.sheet_sync_outbox`
- Event: **INSERT only**
- Method: `POST`
- URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/sync-google-sheet`
- Headers:
  - `Content-Type: application/json`
  - `x-tk27-webhook-secret: YOUR_SEPARATE_WEBHOOK_SECRET`

Create the webhook and verify it is enabled. The SQL trigger creates a durable outbox row whenever a coordinator record is inserted, updated or deleted. The webhook wakes the Edge Function, which claims that event and upserts/deletes the corresponding Sheet row. The receiver serialises Sheet writes and tracks each record's latest outbox ID to ignore older events delivered late. If a webhook or Sheet request fails, the event remains `FAILED` (or `PENDING`) and can be retried from the dashboard. Retries are idempotent by `record_id`.

The sync direction is **Supabase → Google Sheets**. Do not edit `COORDINATOR_RECORDS` manually after cutover; edit the record in the admin dashboard. If an administrator changes the record status in Supabase, the resulting event updates the existing Sheet row.

## 8. Enable Realtime and publish the frontend on Cloudflare Pages

The migration tries to add `public.coordinator_records` to `supabase_realtime`. If the admin dashboard shows it cannot connect to Realtime, go to **Database → Publications / Realtime** and enable `coordinator_records` for the `supabase_realtime` publication. Admin users still need SELECT permission to receive row-change events, which is granted through the table's RLS policy.

For Cloudflare Pages:

1. Push the rebuilt package to your **private GitHub repository**, without `migration-data/` files.
2. In Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git** select the repository.
3. Framework preset: **None / Other**; build command can be blank or `exit 0`; build output directory: `frontend`; root directory: `/`.
4. Deploy. The application uses the `pages.dev` address Cloudflare shows for the Pages project. Public registration is `/`; admin is `/admin` (or `/admin.html`).

You do not need the old Cloudflare `TK27_APPS_SCRIPT_URL` runtime variable for the new static frontend. The Apps Script URL is configured as the server-only Supabase Edge Function secret `GOOGLE_APPS_SCRIPT_URL`. The browser only needs the project URL and publishable/anon key in `frontend/config.js`.

## 9. Verify before reopening registration

1. Open `https://YOUR_PROJECT_REF.supabase.co/rest/v1/` only as a diagnostic if desired; normal user access should go through the frontend and database RPCs.
2. Load the public page. It should show the first of three steps and populate position and location choices.
3. Sign in at `/admin`. If sign-in succeeds but access is denied, confirm the Auth user's `admin_users.active` row exists.
4. Use the dashboard's **Resume collection** control only after confirming all imports are complete.
5. Submit a clearly labelled test record. Confirm it appears in Supabase `coordinator_records`, then appears in `COORDINATOR_RECORDS` in Google Sheets within a few seconds.
6. Keep `/admin` open and submit another test in a second browser or phone. Confirm the count and list update without a reload, and the live indicator says connected.
7. Test search, each dropdown, the duplicate checkbox, date filters, clicking statistic cards, Reset filters, CSV export, Verify/Reject/Reset, and the audit log.
8. Temporarily make the Apps Script secret invalid only in a controlled test if needed; the row should remain in Supabase and be retryable after the secret is corrected.
9. Delete test records from the admin UI only after confirming that the corresponding change also propagates. The current UI does not expose delete, to avoid accidental data loss.

## 10. Operational notes

- Supabase is the authoritative database; the sheet is a mirror. If you change rows directly in Google Sheets, the changes do not flow back into Supabase.
- `sheet_sync_outbox` is durable. The dashboard's **Retry Sheet sync** processes up to 100 pending/failed events per click. Repeat until the pending/failed counter reaches zero if backfilling to a blank mirror.
- The form does not expose coordinator records to public users. Admin access is through Supabase Auth plus the `admin_users` allow-list.
- Before wide public launch, consider adding Cloudflare Turnstile or another challenge/rate-control mechanism to further reduce automated spam against the public form.
- Keep Supabase database backups and the original Google Sheet backup. Rotate either shared sync secret immediately if it is ever exposed.
