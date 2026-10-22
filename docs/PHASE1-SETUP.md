# TK27 Ogun: Phase 1 setup (database + master geography)

**Legacy reference only:** this document describes the original Apps Script-only Phase 1. For the Supabase migration and current deployment, follow [`docs/MIGRATION.md`](docs/MIGRATION.md). Keep using your existing private Google Sheet as the mirror; do not create a new blank spreadsheet solely for this migration.

## A. Create the Sheet and script (about 5 minutes)
1. Go to sheets.google.com and create a blank spreadsheet. Name it **TK27 Ogun Database**.
2. Menu: **Extensions > Apps Script**. This opens a script bound to the sheet.
3. Rename the default `Code.gs` content: delete everything in it, then paste the contents of `Code.gs` from this folder.
4. Click **+ > Script** four times and create these files (names without `.gs`), pasting each file's content:
   `Config`, `Utilities`, `AuditService`, `MasterDataService`
5. Click **Save**. Reload the spreadsheet tab. A **TK27 Admin** menu appears after a few seconds.

## B. First run
1. **TK27 Admin > 1. Set up system (first run)**. Approve the Google permission prompt
   (Advanced > Go to project > Allow; it only touches this spreadsheet and fetches web pages).
2. Copy the **admin passcode** shown in the popup and save it somewhere safe. It is not shown again.
3. Confirm the tabs exist: CONFIG, MASTER_GEOGRAPHY, RAW_IMPORT, NORMALIZED_GEOGRAPHY,
   COORDINATOR_RECORDS, AUDIT_LOG, VALIDATION_LOG, IMPORT_LOG.

## C. Build the master list
1. **TK27 Admin > 2. Build master list from web**. Takes roughly 1 to 3 minutes (about 240 page requests).
2. Read the result popup. Expected for Ogun: 20 LGAs, 236 wards, 5,042 polling units.
3. Status meanings:
   - **WARNING**: published and usable. For this source it always shows WARNING because the data is a
     third-party compilation, not an INEC publication (see SOURCE_UNVERIFIED in VALIDATION_LOG).
   - **FAILED**: nothing was published and the previous master is untouched. See VALIDATION_LOG for why.
4. Check MASTER_GEOGRAPHY: spot-check a few wards and polling units against what your coordinators know.

## D. If the web import fails (fallback, no code changes)
Paste an official file into **RAW_IMPORT** (columns: Raw_State, Raw_LGA, Raw_Ward, Raw_Polling_Unit,
Raw_PU_Code, with Raw_LGA_Code / Raw_Ward_Code optional), then run **2b. Process RAW_IMPORT sheet**.
The same normalise > validate > publish rules apply.

## Test the logic offline
`node tests/run-tests.js` (23 tests: parsing, normalisation, every validation rule, 5,042-row scale check).
