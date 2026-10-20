# TK27 Ogun — Stage 3–5 build around Claude Phase 1

This package is intentionally built around the uploaded Claude Phase 1 files and schema.

## What is preserved
- `CONFIG`, `MASTER_GEOGRAPHY`, `RAW_IMPORT`, `NORMALIZED_GEOGRAPHY`, `COORDINATOR_RECORDS`, `AUDIT_LOG`, `VALIDATION_LOG`, `IMPORT_LOG`
- 5,042 PU / 236 ward / 20 LGA master result
- existing normalization and validation pipeline
- safe publish rule: failed imports do not replace the previous master
- record schema including Submission_Key, Normalized_Name, Normalized_Phone

## Stage 3 — Apps Script API
Add `apps-script/ApiService.gs` to the same Apps Script project. Do not create a second Apps Script project.
It provides doGet/doPost, geography lookup, secure admin sessions, and coordinator submission.

Important: this file expects the Phase 1 functions already present, including:
`getConfig_`, `readDataRows_`, `appendRows_`, `cleanText_`, `compareKey_`, `nowIso_`, `getMasterStatus`, `validateMasterList`, `buildMasterFromWeb`, `logAudit_`.

## Stage 4 — Cloudflare Pages frontend
The `public/` directory is the static site. The `functions/api/[[path]].js` file proxies `/api/*` to Apps Script.
Use Git integration rather than dashboard Direct Upload.

Cloudflare:
- root directory: `/`
- build command: `exit 0`
- build output directory: `public`

Add environment variable:
`TK27_APPS_SCRIPT_URL = https://script.google.com/macros/s/.../exec`

## Stage 5 — submission and validation
The backend:
- normalizes Nigerian phone numbers
- validates position
- validates LGA/Ward/PU against MASTER_GEOGRAPHY
- prevents accidental double-submit using Submission_Key
- flags potential duplicates
- writes audit events
- uses a script lock around writes
- generates OG-EXCO-000001 / OG-LGA-000001 / OG-WC-000001 IDs

## Apps Script deployment
Deploy the bound script as a Web App:
Execute as: Me
Who has access: Anyone who needs the public form to work, according to your Google account/workspace policy.
Use the `/exec` URL, not `/dev`.

## Security
The admin passcode is exchanged for a 6-hour opaque session token stored in Apps Script CacheService.
Do not put the admin passcode in frontend source code or Git.
The passcode that was previously exposed in chat should be reset before production.

## Master data
Do not replace the existing 5,042-row master merely because it has 18 duplicate-name warnings. The Phase 1 validator treats same-name/different-code polling units as warnings, while code conflicts are errors.
