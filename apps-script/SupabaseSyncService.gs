/**
 * SupabaseSyncService.gs
 *
 * Receives server-to-server sync events from the Supabase Edge Function and upserts the
 * Supabase source-of-truth into COORDINATOR_RECORDS. The shared secret belongs in Apps Script
 * Script Properties as SUPABASE_SYNC_SECRET; it must never be embedded in a browser file.
 * A private state tab stores the latest processed outbox ID per record so delayed webhooks
 * cannot overwrite a newer state or resurrect a deleted record.
 */
function syncSupabaseRecord_(payload) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty('SUPABASE_SYNC_SECRET') || '';
  const supplied = String((payload && payload.syncSecret) || '');
  if (!expected || !safeEquals_(expected, supplied)) {
    throw new AppError('UNAUTHORIZED', 'Sheet synchronisation is not authorised.');
  }

  const eventType = String((payload && payload.eventType) || '').toUpperCase();
  const record = (payload && payload.record) || {};
  const recordId = String((record && record.record_id) || (payload && payload.recordId) || '');
  const outboxId = Number(payload && payload.outboxId);
  if (!recordId) throw new AppError('BAD_REQUEST', 'The sync event is missing its record reference.');
  if (!Number.isSafeInteger(outboxId) || outboxId < 1) {
    throw new AppError('BAD_REQUEST', 'The sync event is missing its valid outbox sequence.');
  }
  if (['INSERT', 'UPDATE', 'DELETE'].indexOf(eventType) === -1) {
    throw new AppError('BAD_REQUEST', 'Unknown sheet sync event.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const stateSheet = getOrCreateSheet_('SHEET_SYNC_STATE');
    const stateHeaders = ['Record_ID', 'Last_Outbox_ID', 'Last_Event_Type', 'Synced_At'];
    if (!ensureHeaders_(stateSheet, stateHeaders, true)) {
      throw new AppError('SCHEMA_MISMATCH', 'SHEET_SYNC_STATE headers do not match the expected schema.');
    }
    if (SpreadsheetApp.getActiveSpreadsheet().getSheets().length > 1 && !stateSheet.isSheetHidden()) {
      stateSheet.hideSheet();
    }

    const stateRow = findRowByKey_(stateSheet, 1, recordId);
    if (stateRow) {
      const priorOutboxId = Number(stateSheet.getRange(stateRow, 2).getValue()) || 0;
      if (outboxId <= priorOutboxId) {
        return { synced: true, skipped: true, reason: 'stale-or-replayed-event', eventType: eventType, recordId: recordId, outboxId: outboxId };
      }
    }

    const sheet = getOrCreateSheet_(TK27.SHEETS.RECORDS);
    if (!ensureHeaders_(sheet, TK27.HEADERS.RECORDS, true)) {
      throw new AppError('SCHEMA_MISMATCH', 'COORDINATOR_RECORDS headers do not match the configured 21-column schema.');
    }
    const rowNumber = findRowByKey_(sheet, 1, recordId);
    let operation = '';

    if (eventType === 'DELETE') {
      if (rowNumber) sheet.deleteRow(rowNumber);
      operation = rowNumber ? 'deleted' : 'already-absent';
    } else {
      // Match TK27.HEADERS.RECORDS in Config.gs exactly (21 columns).
      const row = [
        recordId,
        String(record.state || 'Ogun'),
        String(record.state_code || 'OG'),
        String(record.name || ''),
        String(record.position || ''),
        String(record.phone || ''),
        String(record.lga || ''),
        String(record.lga_code || ''),
        String(record.ward || ''),
        String(record.ward_code || ''),
        String(record.polling_unit || ''),
        String(record.polling_unit_code || ''),
        String(record.verification_status || 'PENDING'),
        record.duplicate_flag === true || String(record.duplicate_flag).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
        String(record.submitted_at || ''),
        String(record.updated_at || record.submitted_at || ''),
        String(record.submitted_by || 'public-form'),
        String(record.notes || ''),
        String(record.submission_key || ''),
        String(record.normalized_name || ''),
        String(record.normalized_phone || record.phone || '')
      ];

      if (row.length !== TK27.HEADERS.RECORDS.length) {
        throw new AppError('SCHEMA_MISMATCH', 'COORDINATOR_RECORDS must have the 21 configured columns before sync can continue.');
      }
      if (rowNumber) {
        sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
        operation = 'updated';
      } else {
        sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length).setValues([row]);
        operation = 'inserted';
      }
    }

    const stateValues = [recordId, String(outboxId), eventType, nowIso_()];
    if (stateRow) stateSheet.getRange(stateRow, 1, 1, stateValues.length).setValues([stateValues]);
    else stateSheet.getRange(stateSheet.getLastRow() + 1, 1, 1, stateValues.length).setValues([stateValues]);
    logAudit_('SUPABASE_SYNC_' + eventType, recordId, 'OUTBOX_' + outboxId, 'SHEETS_MIRROR_' + operation.toUpperCase(), 'OK');
    return { synced: true, eventType: eventType, recordId: recordId, outboxId: outboxId, operation: operation };
  } finally {
    lock.releaseLock();
  }
}
