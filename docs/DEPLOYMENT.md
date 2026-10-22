# Deployment

The V2 rebuild uses Supabase for the primary database and Realtime, Google Sheets as a mirrored copy, and Cloudflare Pages for the static frontend.

Follow [`docs/MIGRATION.md`](docs/MIGRATION.md) in order. Do not reopen collection until the geography master, historical records, admin allow-list, Apps Script receiver, and Supabase database webhook have been configured and tested.

The old passcode-based Apps Script API has deliberately been retired in `apps-script/Router.gs` after the cutover. Do not point the new frontend back at that legacy API.
