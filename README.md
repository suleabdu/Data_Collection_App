# TK27 Ogun State Coordinator Collection System

A mobile-first public collection system with:

**Cloudflare Pages + Pages Functions → Google Apps Script → Google Sheets**

## What is included

- Public mobile form
- Cascading LGA → Ward → Polling Unit selectors
- Server-side geography validation
- Nigerian phone normalization
- Duplicate flagging without silent deletion
- Server-generated record IDs
- Admin dashboard
- Master geography CSV import
- Safe master publication (failed validation preserves previous master)
- Validation/import/audit logs
- CSV export
- No geography data is fabricated or bundled

## Folder structure

```text
frontend/
  index.html
  admin/index.html
  assets/
    app.js
    admin.js
    styles.css
    admin.css

functions/
  api/[[path]].js

apps-script/
  Code.gs
  Config.gs
  Utilities.gs
  GeographyService.gs
  ValidationService.gs
  DuplicateService.gs
  SubmissionService.gs
  MasterDataService.gs
  AdminService.gs
  ExportService.gs
  Router.gs
  Security.gs
  Authentication.gs
  AnalyticsService.gs
  EmailService.gs
  StudentService.gs
  TutorService.gs
  AssignmentService.gs
  ResultService.gs
  CourseService.gs
```

## 1. Google Sheet

Create a blank Google Sheet named `TK27 Ogun Coordinator Database`.

Open **Extensions → Apps Script**.

Create the `.gs` files in `apps-script/` and paste their contents.

In Apps Script **Project Settings → Script Properties**, add:

- `TK27_ADMIN_KEY` = a long random secret
- `GEOGRAPHY_SOURCE_URL` = optional; leave blank for controlled CSV import

Deploy as **Web app**:

- Execute as: Me
- Who has access: Anyone

Copy the deployment `/exec` URL.

## 2. Master geography

Do not invent or manually guess Ogun geography.

The system expects an official CSV with these nine columns, in this order:

```text
State,State_Code,LGA,LGA_Code,Ward,Ward_Code,Polling_Unit,Polling_Unit_Code,Full_PU_Code
```

Use an official/authoritative source. Upload it from `/admin`, then:

1. Upload Official CSV
2. Build / Refresh Master List
3. Validate Master List

If validation fails, the previous published master is preserved.

## 3. Cloudflare Pages

Create a new Cloudflare Pages project from this folder.

Set these environment variables/secrets:

- `TK27_APPS_SCRIPT_URL` = Apps Script `/exec` URL
- `TK27_ADMIN_KEY` = exactly the same secret used in Apps Script

Deploy.

Your public URL will be a normal HTTPS Pages URL, e.g.:

`https://your-project.pages.dev`

Public form:

`https://your-project.pages.dev/`

Admin:

`https://your-project.pages.dev/admin/`

## 4. First test

Before collecting real records:

- Open the public URL on Android Chrome.
- Confirm the page loads.
- Confirm LGA dropdown contains data after the master is published.
- Select LGA → Ward → Polling Unit.
- Submit a test record.
- Confirm the record appears in `COORDINATOR_RECORDS`.
- Confirm the generated ID.
- Test a duplicate.
- Test invalid geography by attempting to alter browser requests.
- Open admin and verify stats/export/audit logs.

## 5. Google Sheets tabs

The backend creates:

- CONFIG
- MASTER_GEOGRAPHY
- RAW_IMPORT
- NORMALIZED_GEOGRAPHY
- COORDINATOR_RECORDS
- AUDIT_LOG
- VALIDATION_LOG
- IMPORT_LOG

## Important

The frontend never contains the admin secret.

The Cloudflare function validates the admin session and injects the secret only server-side when communicating with Apps Script.

The public browser cannot choose arbitrary geography codes successfully because Apps Script validates the LGA/Ward/Polling Unit relationship against the published master.

This V1 intentionally keeps AI out of the critical submission path. AI can be added later for reporting, duplicate review assistance, anomaly summaries, and natural-language admin queries without making it responsible for authoritative geography.
