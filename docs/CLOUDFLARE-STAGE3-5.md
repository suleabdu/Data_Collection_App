# Cloudflare Pages setup — Stage 3–5

1. Create a PRIVATE GitHub repository, e.g. `tk27-ogun-coordinator`.
2. Push this project to `main`.
3. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git.
4. Select the repository.
5. Build settings:
   - Production branch: `main`
   - Root directory: `/`
   - Build command: `exit 0`
   - Build output directory: `public`
6. Deploy.
7. Settings → Variables and Secrets → add:
   - `TK27_APPS_SCRIPT_URL` = your Apps Script `/exec` URL
8. Redeploy after adding the variable.
9. Public form: `https://YOUR_PROJECT.pages.dev/`
10. Admin: `https://YOUR_PROJECT.pages.dev/admin/`

The Function is at `functions/api/[[path]].js`. It maps:
- GET `/api/health`
- GET `/api/state`
- GET `/api/lgas`
- GET `/api/wards?lgaCode=27/01`
- GET `/api/polling-units?lgaCode=27/01&wardCode=27/01/01`
- POST `/api/submit`
- POST `/api/admin/login`
- POST `/api/admin/status`
- POST `/api/admin/validate-master`
- POST `/api/admin/refresh-master`
- POST `/api/admin/logout`

Do not use Direct Upload for this repository when Functions are required; use Git integration.
