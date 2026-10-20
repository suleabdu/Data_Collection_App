/**
 * Code.gs — entry points: spreadsheet menu and first-run setup.
 * Phase 1 is operated from the "TK27 Admin" menu inside the Google Sheet.
 * (The public web API arrives in Phase 3.)
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('TK27 Admin')
    .addItem('1. Set up system (first run)', 'menuSetup')
    .addSeparator()
    .addItem('2. Build master list from web', 'menuBuildMasterFromWeb')
    .addItem('2b. Process RAW_IMPORT sheet (manual file)', 'menuProcessRawImport')
    .addItem('3. Validate published master list', 'menuValidateMaster')
    .addItem('Show master status', 'menuShowStatus')
    .addSeparator()
    .addItem('Reset admin passcode', 'menuResetPasscode')
    .addToUi();
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Creates every tab with headers, seeds CONFIG, creates the admin passcode. Safe to re-run. */
function setupSystem() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const created = [];
  const mismatched = [];

  Object.keys(TK27.SHEETS).forEach(function (key) {
    const name = TK27.SHEETS[key];
    const existed = !!ss.getSheetByName(name);
    const sheet = getOrCreateSheet_(name);
    const ok = ensureHeaders_(sheet, TK27.HEADERS[key], TK27.TEXT_SHEETS.indexOf(key) !== -1);
    if (!existed) created.push(name);
    if (!ok) mismatched.push(name);
  });

  seedConfig_();
  removeDefaultSheet_(ss);
  const passcode = ensureAdminPasscode_();
  logAudit_('SYSTEM_SETUP', '', '', TK27.VERSION, mismatched.length ? 'WARNING' : 'OK');

  return { createdSheets: created, headerMismatch: mismatched, newPasscode: passcode };
}

function removeDefaultSheet_(ss) {
  const sheet = ss.getSheetByName('Sheet1');
  if (sheet && ss.getSheets().length > 1 && sheet.getLastRow() === 0 && sheet.getLastColumn() === 0) {
    ss.deleteSheet(sheet);
  }
}

/** Creates the admin passcode once. Returns it only on creation (it is never shown again). */
function ensureAdminPasscode_() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('ADMIN_PASSCODE')) return '';
  const passcode = generatePasscode_();
  props.setProperty('ADMIN_PASSCODE', passcode);
  return passcode;
}

function generatePasscode_() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alike characters
  const source = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += alphabet.charAt(parseInt(source.substr(i * 2, 2), 16) % alphabet.length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Menu handlers (thin wrappers that show plain-language results)
// ---------------------------------------------------------------------------

function alert_(title, text) {
  SpreadsheetApp.getUi().alert(title, text, SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuSetup() {
  const result = setupSystem();
  let text = 'Setup complete.\n\nSheets created: ' + (result.createdSheets.join(', ') || 'none (all already existed)');
  if (result.headerMismatch.length) {
    text += '\n\nWARNING: these sheets already had different headers and were left untouched: ' + result.headerMismatch.join(', ');
  }
  if (result.newPasscode) {
    text += '\n\nADMIN PASSCODE (save it now, it will not be shown again):\n' + result.newPasscode;
  }
  alert_('TK27 setup', text);
}

function formatImportResult_(result) {
  const r = result.report;
  let text = result.message + '\n\nStatus: ' + r.status +
    '\nSource records: ' + r.totalSource + '\nValid: ' + r.valid + '   Invalid: ' + r.invalid +
    '\nDuplicates removed: ' + r.duplicates + '   Orphans: ' + r.orphans +
    '\nFinal master records: ' + r.finalMaster +
    '\nLGAs: ' + r.lgas + '   Wards: ' + r.wards + '   Polling units: ' + r.pollingUnits;
  if (result.topIssues && result.topIssues.length) {
    text += '\n\nTop issues:\n' + result.topIssues.slice(0, 8).map(function (i) {
      return '- [' + i.severity + '] ' + i.message;
    }).join('\n');
    text += '\n\nFull list: VALIDATION_LOG sheet.';
  }
  return text;
}

function menuBuildMasterFromWeb() {
  const ui = SpreadsheetApp.getUi();
  const choice = ui.alert('Build master list',
    'This downloads about 240 pages from the configured source and can take 1-3 minutes. ' +
    'The current master list is only replaced if validation passes.\n\nContinue?', ui.ButtonSet.YES_NO);
  if (choice !== ui.Button.YES) return;
  alert_('Build master list', formatImportResult_(buildMasterFromWeb('MENU')));
}

function menuProcessRawImport() {
  alert_('Process RAW_IMPORT', formatImportResult_(processRawImportSheet('MENU')));
}

function menuValidateMaster() {
  const result = validateMasterList();
  alert_('Validate master list', result.report ? formatImportResult_(result) : result.message);
}

function menuShowStatus() {
  const s = getMasterStatus();
  alert_('Master list status',
    s.state + '\nStatus: ' + s.status + '\nLGAs: ' + s.lgas + '   Wards: ' + s.wards + '   Polling units: ' + s.pollingUnits +
    '\nLast updated: ' + (s.lastUpdated || 'never') + '\nSource: ' + (s.source || 'none') +
    '\nSource verification: ' + s.verification + '\n\nLast import: ' + (s.lastImportStatus || 'none') +
    '\n' + (s.lastImportMessage || ''));
}

function menuResetPasscode() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset admin passcode', 'Create a new passcode? The old one stops working immediately.', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const passcode = generatePasscode_();
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSCODE', passcode);
  logAudit_('ADMIN_PASSCODE_RESET', '', '', '', 'OK');
  alert_('New admin passcode', 'Save it now, it will not be shown again:\n\n' + passcode);
}
