# TK27 Ogun: Deployment Guide

Everything runs on free tiers: Google Sheets and Apps Script (backend and database), GitHub (code), Vercel (public website).
Allow about 45 minutes the first time. Do the parts in order.

```
Phone / laptop  ->  Vercel website (frontend/)  ->  Apps Script Web App  ->  Google Sheet
                       your-project.vercel.app          .../exec URL             TK27 Ogun Database
```

---

## Part 1. Backend (Google Apps Script)

You already have the Sheet and the Phase 1 files, and the master list is built. Now add the API.

### 1.1 Update the script project
Open the Sheet, then **Extensions > Apps Script**.

| File | Action |
|---|---|
| `Config`, `Utilities` | **Replace** the whole content with the new versions |
| `ValidationService`, `DuplicateService`, `GeographyService`, `SubmissionService`, `AdminService`, `ExportService`, `Router` | **Create** (+ > Script) and paste |
| `Code`, `AuditService`, `MasterDataService` | Unchanged from Phase 1 |

Click **Save** (disk icon). If anything shows a red error, you pasted into the wrong file. File names must match exactly.

### 1.2 Deploy as a Web App
1. Click **Deploy > New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Description: `TK27 API v1`. **Execute as: Me**. **Who has access: Anyone**.
4. Click **Deploy** and approve the permission prompts (Advanced > Go to project > Allow).
5. Copy the **Web app URL**. It ends in `/exec`. You need it in Part 2.

"Anyone" only means the public form can reach the API. Every admin action still requires your admin passcode.

### 1.3 Check it works
Paste this into a browser (use your URL):

`https://script.google.com/macros/s/XXXX/exec?action=ping`

You should see `{"success":true,"data":{...}}`. Also try `?action=getState` (it should show `"ready":true`) and `?action=getLGAs` (20 LGAs).

### 1.4 Updating the backend later
Edit the code, then **Deploy > Manage deployments > pencil icon > Version: New version > Deploy**.
The URL stays the same. Choosing "New deployment" instead creates a different URL, which is the usual cause of a form that suddenly stops working.

### 1.5 Admin passcode
It was shown once during setup. If you lost it: Sheet menu **TK27 Admin > Reset admin passcode**.

---

## Part 1b. Test on your own computer first (recommended)

The backend is already live after Part 1, so your local copy of the website can talk to the real Sheet.
You need Node.js installed (nodejs.org, the LTS version). Nothing else.

1. Put your `/exec` URL into `frontend/config.js` (see 2.1).
2. Open a terminal in the project folder (the one containing `serve-local.js`) and run:
   ```
   node serve-local.js
   ```
3. Open `http://localhost:3000` for the form and `http://localhost:3000/admin` for the dashboard.
   This server sends the same security headers as Vercel, so anything Vercel would block shows up here first.
4. Do the Part 4 test from this page (use the browser on your computer, or your phone on the same Wi-Fi at `http://YOUR-COMPUTER-IP:3000`).
5. Press F12 > **Console**. A healthy page shows no red messages. Stop the server with Ctrl+C.

Do not open `index.html` by double-clicking it (a `file://` address). Always use the server above.

---

## Part 2. Put the code on GitHub

### 2.1 Connect the frontend to your backend
Open `frontend/config.js` and replace the placeholder:

```js
window.TK27_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/XXXX/exec'
};
```
This URL is public by design, so it is safe to commit. **Never** put the admin passcode in any file.

### 2.2 Create the repository
1. Sign in at github.com (create a free account if needed).
2. Click **+ > New repository**. Name it `tk27-ogun`. Choose **Private**. Do not tick "Add a README". Click **Create repository**.

### 2.3 Upload the code. Choose one way

**A. No tools (browser only)**
1. On the empty repo page click **uploading an existing file**.
2. On your computer open the project folder and drag in **the contents**: the folders `frontend`, `apps-script`, `tests`, and the files `vercel.json`, `.gitignore`, `DEPLOYMENT.md`, `PHASE1-SETUP.md`.
3. Write a message such as `Initial TK27 system` and click **Commit changes**.
4. Check that `vercel.json` sits at the top level of the repo and `frontend/index.html` exists. GitHub shows folders on the repo page.

**B. With Git (from the project folder)**
```bash
git init
git add .
git commit -m "Initial TK27 system"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/tk27-ogun.git
git push -u origin main
```
If asked to sign in, use a GitHub personal access token as the password (GitHub > Settings > Developer settings > Tokens).

### 2.4 Making changes later
Edit a file on GitHub (pencil icon) or push from Git. Vercel redeploys automatically within a minute (Part 3).

---

## Part 3. Publish the website on Vercel

1. Go to vercel.com and choose **Sign Up > Continue with GitHub**. Approve access.
2. Click **Add New... > Project**. Find `tk27-ogun` and click **Import**.
   (If it is not listed: **Adjust GitHub App Permissions** and allow that repository.)
3. Settings screen. Leave everything as detected, but check:
   - **Framework Preset:** Other
   - **Root Directory:** `./` (default)
   - **Build Command / Install Command:** leave empty. `vercel.json` already tells Vercel to publish the `frontend` folder.
   - **Environment Variables:** none needed.
4. Click **Deploy**. After about 30 seconds you get `https://tk27-ogun.vercel.app` (or similar).

| Page | Address |
|---|---|
| Public form (share this with coordinators) | `https://YOUR-PROJECT.vercel.app/` |
| Admin dashboard (keep private) | `https://YOUR-PROJECT.vercel.app/admin` |

### Security headers
The site is served with a Content-Security-Policy (only its own scripts and styles, and connections only to your Apps Script backend), plus anti-framing and no-index headers. There are two `vercel.json` files on purpose: one at the top level and one inside `frontend/`, with identical headers. That way the headers apply whether Vercel's Root Directory is `./` or `frontend`. If you change a header, change it in both. If you ever add an outside script, font or image, add its address to the policy, or the browser will block it.

### Optional
- **Project name / URL:** Vercel > Project > Settings > Domains.
- **Your own domain:** Settings > Domains > Add, then follow the DNS instructions. Nothing in the code changes.
- **Pages:** every push to `main` goes live. Pushes to other branches get a private preview URL.

### Licensing note
Vercel's free Hobby plan is, as far as I know, meant for personal, non-commercial use. If TK27 is run by an organisation or campaign, check Vercel's current terms before relying on it. The same `frontend` folder deploys unchanged on Cloudflare Pages (free): connect the repo, set the output directory to `frontend`, no build command.

---

## Part 4. First end-to-end test (do this before sharing the link)

1. Open the form on your **phone**. Choose Ward Coordinator > a name > your phone number > LGA > Ward > Polling unit > **Submit**. You should get a reference like `OG-WC-000001`.
2. In the Sheet, open **COORDINATOR_RECORDS**. The row should appear with Verification_Status `PENDING`.
3. Submit the **same phone number** again with a different name. The second row should have `Duplicate_Flag = TRUE`, with a note naming the first record.
4. Open `/admin`, sign in, and confirm the cards, coverage table and records list show your two test records. Click **Verify** on one.
5. Delete the test rows from the Sheet (leave the header row) before real collection starts.
   Reference numbers continue after the highest number used, so the next real record may start after your test numbers. That is expected.

### Acceptance checklist (from your spec, section 40)

| # | Criterion | How to confirm |
|---|---|---|
| 1 | Opens on a phone from the public URL | Step 1 |
| 2 | Position > LGA > Ward > Polling Unit selectable | Step 1 |
| 3, 4 | Submit; record appears in Sheets | Steps 1 and 2 |
| 5, 6 | Server validates; invalid geography cannot be submitted | Automated tests (see below). Try an altered request if you want to see it for yourself |
| 7 | Duplicates flagged | Step 3 |
| 8, 9 | Reference number and "Add another record" | Step 1 |
| 10, 11 | Build/refresh master; failed import keeps the old master | Admin page > Build; already proven by the failure-handling tests |
| 12, 13 | Statistics and export | Step 4; click each Export button |
| 14 | Works on mobile | Step 1; also tested at 320px and 375px |
| 15 | No secrets in the browser | Passcode lives only in Apps Script Properties. Check that `config.js` holds only the `/exec` URL |

### Automated tests (optional, need Node.js)
```
node tests/run-tests.js        # master import, validation, analytics, export, router (46 tests)
node tests/run-tests-api.js    # submission rules, duplicates, phone/name, router (33 tests)
```
`tests/browser-smoke.js` drives the real pages in a headless browser against a mocked backend (it needs Playwright).

---

## Part 5. Running the collection

- **Pause / resume:** Admin page > Pause collection. The form then shows a "paused" message.
- **Review:** filter by "Possible duplicates only", then Verify or Reject each record. Nothing is ever deleted automatically.
- **Export:** Admin page > Export. The CSV opens in Excel. Free-text cells that start with `=`, `+`, `-` or `@` are neutralised so they cannot run as formulas.
- **Backup:** Sheet > File > Make a copy, or version history (File > Version history). Do this daily during heavy collection.
- **Verify the master list.** The Ogun list comes from Nigeria 2.0, a third-party compilation, and matches INEC's published totals (20 / 236 / 5,042). Once you have reconciled it with an INEC publication, set `MASTER_SOURCE_VERIFICATION` to `OFFICIAL` in the CONFIG sheet.

## Personal data
The Sheet holds names and phone numbers. Keep it **private** and share it only with people who need it (Share > restrict access). Tell coordinators why the data is collected and who sees it, and delete it when the exercise ends. Nigeria's data protection law (NDPA 2023) applies. This guide is not legal advice.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Form says "not connected to the backend" | `config.js` still has the placeholder, or the URL does not start with `https://script.google.com/`. Fix, commit, wait for the Vercel redeploy |
| Dropdowns stay on "Loading..." / "failed to load" | Work through the list below |
| "The location list is not available yet" | Master list is not built. Sheet menu > TK27 Admin > Build master list |
| Admin says "Incorrect admin passcode" | Reset it from the Sheet menu |
| Changes to the code have no effect | You saved but did not create a **New version** (1.4) |
| `/admin` gives 404 | `vercel.json` is not at the top level of the repo, so redeploy |
| Master build from the admin page times out | Use the Sheet menu route instead (it has a longer limit) |

### If the page cannot load locations ("failed to load", "not reachable")
Vercel only hands the browser the website files. It never touches your Sheet. The browser talks to Google directly, so check these in order:

1. **Backend reachable?** Open `YOUR-EXEC-URL?action=getLGAs` in a private browser window. You should see JSON. If you see a Google sign-in page, set the deployment's access to **Anyone** (1.2, then redeploy a **New version**, 1.4).
2. **Old URL?** The URL in `config.js` must be from the latest deployment (Deploy > Manage deployments).
3. **Master list built?** `?action=getState` must show `"ready":true`.
4. **Blocked by the site's own security policy?** Press F12 > Console. A message starting with "Refused to connect..." means the Content-Security-Policy blocked a Google address. Fix: in both `vercel.json` files change the `connect-src` part to `connect-src 'self' https://*.google.com https://*.googleusercontent.com`, then commit.
5. **Vercel login wall?** Vercel can protect some addresses with a Vercel sign-in page (Settings > Deployment Protection). As far as I know this applies to preview and per-deployment URLs and not to your main `*.vercel.app` address. Share only the main address, and if people are asked to sign in to Vercel, turn protection off for production.
6. **Admin page only:** a wrong or old passcode shows "Incorrect admin passcode", which is a different message.

## Known limits of this version
- Tested offline with mocks and a headless browser. The first real run in Apps Script (locking, caching, text search) is the final check, so do Part 4 before sharing the link.
- One admin passcode, no individual accounts. Anyone who has it can use every admin function.
- No load test. The script lock serialises writes, so a burst of very many simultaneous submissions may see some people get "The system is busy" and need to tap Submit again (their data stays on screen and retries safely without duplicating).
