# Apps Script Stage 3–5 installation

1. Open the SAME bound Apps Script project used for Phase 1.
2. Add one Script file named `ApiService.gs`.
3. Paste the provided `ApiService.gs`.
4. Save.
5. Do not delete/replace Phase 1 `Code.gs`, `Config.gs`, `Utilities.gs`, `AuditService.gs`, or `MasterDataService.gs`.
6. Run Phase 1 setup if not already completed.
7. Confirm `MASTER_GEOGRAPHY` contains the published master.
8. Confirm `CONFIG` reports:
   - MASTER_STATUS = VALID or WARNING
   - MASTER_PUS = 5042 (based on your current result)
9. Deploy → New deployment → Web app.
10. Execute as yourself.
11. Use `/exec` URL.
12. Test:
    `/exec?action=health`
    `/exec?action=getLGAs`
13. Then configure the Cloudflare variable.

The API uses the existing Phase 1 schema. It does not create a second database.
