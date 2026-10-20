# Production Deployment Checklist

## A. Google Apps Script

1. Create Google Sheet.
2. Open Extensions → Apps Script.
3. Add all files from `apps-script/`.
4. Set `TK27_ADMIN_KEY`.
5. Deploy Web App.
6. Copy `/exec` URL.
7. Test:
   - `?action=getState`
   - `?action=getLGAs` after master data exists.

## B. Cloudflare Pages

1. Upload repository to GitHub, or upload the project to Cloudflare Pages.
2. Build command: none.
3. Output directory: `frontend` is NOT used as a build output for Functions; deploy the project root so `functions/` is detected.
4. Configure:
   - `TK27_APPS_SCRIPT_URL`
   - `TK27_ADMIN_KEY`
5. Deploy.
6. Open `/` and `/admin/`.

## C. Security

- Use a long random admin key.
- Never put the admin key into frontend source.
- Keep the Google Sheet private.
- Do not publish `MASTER_GEOGRAPHY` as a public sheet.
- Rotate the admin key if exposed.
- Restrict editing of the database sheet to trusted administrators.
- Review `AUDIT_LOG` regularly.
- Do not collect fields that are not operationally necessary.

## D. Operational workflow

1. Obtain authoritative Ogun geography file.
2. Upload CSV.
3. Build master.
4. Validate master.
5. Test public form.
6. Start collection.
7. Review duplicates/pending records.
8. Export for national submission.

## E. Scaling to other states

Do not create a separate application per state.

Move state selection into `CONFIG`, add state-specific master rows, and make the published master state-aware. The current public form defaults to Ogun for V1, but the data model already contains State and State_Code.
