/**
 * AuditService.gs — audit trail, validation log and import log.
 * Logging must never break the operation being logged, so every writer swallows its own errors.
 */

function logAudit_(action, recordId, oldValue, newValue, result) {
  try {
    appendRows_(TK27.SHEETS.AUDIT, [[
      newId_('LOG'), nowIso_(), currentUserLabel_(), action, recordId || '',
      oldValue || '', newValue || '', result || 'OK'
    ]]);
  } catch (err) {
    console.error('Audit log failed: ' + err);
  }
}

/** Only the Apps Script account that ran the action; no IP addresses or device data. */
function currentUserLabel_() {
  try {
    return Session.getEffectiveUser().getEmail() || 'system';
  } catch (err) {
    return 'system';
  }
}

function logValidationIssues_(importId, issues) {
  try {
    if (!issues.length) return;
    const capped = issues.slice(0, TK27.MAX_VALIDATION_LOG_ROWS);
    const rows = capped.map(function (issue) {
      return [newId_('VAL'), importId, nowIso_(), issue.severity, issue.code, issue.message, issue.reference || ''];
    });
    if (issues.length > capped.length) {
      rows.push([newId_('VAL'), importId, nowIso_(), 'INFO', 'LOG_TRUNCATED',
        (issues.length - capped.length) + ' further issues not logged', '']);
    }
    appendRows_(TK27.SHEETS.VALIDATION, rows);
  } catch (err) {
    console.error('Validation log failed: ' + err);
  }
}

function logImport_(ctx, report, published, message) {
  try {
    appendRows_(TK27.SHEETS.IMPORT, [[
      ctx.importId, ctx.startedAt.toISOString(), nowIso_(), ctx.sourceName, ctx.sourceUrl || '',
      ctx.trigger, report.totalSource, report.valid, report.invalid, report.duplicates,
      report.orphans, report.finalMaster, report.lgas, report.wards, report.pollingUnits,
      report.status, published ? 'YES' : 'NO', message || ''
    ]]);
  } catch (err) {
    console.error('Import log failed: ' + err);
  }
}
