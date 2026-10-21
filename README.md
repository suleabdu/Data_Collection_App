# TK27 Ogun State Coordinator Data Collection

Mobile-first collection of State Excos, LGA Coordinators and Ward Coordinators.
Frontend (plain HTML/CSS/JS) on Vercel, backend on Google Apps Script, database in Google Sheets.

- `DEPLOYMENT.md`: start here (backend, GitHub, Vercel, testing, troubleshooting)
- `PHASE1-SETUP.md`: original Sheet and master-list setup (already done)
- `apps-script/`: backend, paste into the Sheet's Apps Script project
- `frontend/`: the website (`index.html` public form, `admin.html` dashboard). Set the API address in `config.js`
- `tests/`: automated checks
- `vercel.json`: tells Vercel to publish `frontend/`
