/**
 * Router.gs — the web API. One deployed Web App, two entry points:
 *
 *   GET  ?action=getState | getLGAs | getWards&lgaCode= | getPollingUnits&lgaCode=&wardCode=   (public, read-only)
 *   POST {"action":"submitCoordinator", ...}                                                  (public)
 *   POST {"action":"<admin action>", "passcode":"..."}                                        (admin)
 *
 * POST bodies are sent as text/plain so browsers do not make a CORS preflight request
 * (Apps Script cannot answer one). Responses always use the same envelope:
 *   {"success":true,"data":{...}}  |  {"success":false,"error":{"code","message","fields"?}}
 */

function doGet(e) {
  const params = (e && e.parameter) || {};
  return handleRequest_(String(params.action || ''), params, 'GET');
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return jsonOut_(failure_('BAD_REQUEST', 'Unable to read the request.'));
  }
  return handleRequest_(String(body.action || ''), body, 'POST');
}

function ok_(data) {
  return { success: true, data: data };
}

function failure_(code, message, fields) {
  const error = { code: code, message: message };
  if (fields) error.fields = fields;
  return { success: false, error: error };
}

function jsonOut_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

function handleRequest_(action, params, method) {
  try {
    return jsonOut_(ok_(dispatch_(action, params, method)));
  } catch (err) {
    if (err && err.isAppError) return jsonOut_(failure_(err.code, err.message, err.fields));
    console.error('Unhandled error in action "' + action + '": ' + (err && err.stack ? err.stack : err));
    return jsonOut_(failure_('SERVER_ERROR', 'Unable to complete this request right now. Please try again.'));
  }
}

function dispatch_(action, params, method) {
  // ---- public reads (GET) ----
  if (method === 'GET') {
    switch (action) {
      case 'ping': return { time: nowIso_(), version: TK27.VERSION };
      case 'getState': return getPublicState_();
      case 'getLGAs': return getLGAs_();
      case 'getWards': return getWards_(params.lgaCode);
      case 'getPollingUnits': return getPollingUnits_(params.lgaCode, params.wardCode);
      default: throw new AppError('NOT_FOUND', 'Unknown request.');
    }
  }

  // ---- public write (POST) ----
  if (action === 'submitCoordinator') return submitCoordinator(params);

  // ---- admin (POST + passcode) ----
  requireAdmin_(params.passcode);
  switch (action) {
    case 'adminCheck': return { ok: true };
    case 'getDashboardStats': return getDashboardStats();
    case 'getAnalytics': return getAnalytics();
    case 'getAnalytics': return getAnalytics();
    case 'getRecords': return getRecordsPage(params);
    case 'setVerification': return setVerification(params.recordId, params.status);
    case 'getAuditLog': return getAuditLog(params.limit);
    case 'setApplicationStatus': return setApplicationStatus(params.status);
    case 'buildMasterList': return adminBuildMaster();
    case 'validateMasterList': return validateMasterList();
    case 'exportRecords': return exportData(params.type);
    default: throw new AppError('NOT_FOUND', 'Unknown request.');
  }
}

/** What the public form needs to start: state name, positions and whether locations are ready. */
function getPublicState_() {
  const cfg = getConfig_();
  const positions = String(cfg.POSITION_OPTIONS).split(',').map(cleanText_).filter(function (p) { return TK27.POSITIONS[p]; });
  return {
    systemName: cfg.SYSTEM_NAME,
    state: cfg.ACTIVE_STATE,
    stateCode: cfg.STATE_CODE,
    paused: cfg.APPLICATION_STATUS === 'PAUSED',
    ready: cfg.MASTER_STATUS === 'VALID' || cfg.MASTER_STATUS === 'WARNING',
    positions: positions.map(function (value) { return { value: value, label: TK27.POSITIONS[value].label }; })
  };
}
