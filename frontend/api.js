// Public-form API client: talks to the Supabase functions (PostgREST RPC) with plain fetch, no library needed.
// Always resolves to { success, data } or { success:false, error:{code,message,fields?} }, and never throws.
(function () {
  'use strict';

  var NETWORK_MESSAGE = 'Connection interrupted. Your information has not been submitted. Please try again.';
  var READ_NETWORK_MESSAGE = 'Connection interrupted. Please check your internet connection and try again.';

  // action name used by app.js  ->  database function and how to build its arguments
  var ACTIONS = {
    getState:        { fn: 'get_public_state' },
    getLGAs:         { fn: 'get_lgas' },
    getWards:        { fn: 'get_wards',         args: function (p) { return { p_lga_code: p.lgaCode }; } },
    getPollingUnits: { fn: 'get_polling_units', args: function (p) { return { p_lga_code: p.lgaCode, p_ward_code: p.wardCode }; } },
    submitCoordinator: { fn: 'submit_coordinator', envelope: true, args: function (p) { return { p: p }; } }
  };

  function settings() {
    var c = window.TK27_CONFIG || {};
    var url = String(c.SUPABASE_URL || '').replace(/\/+$/, '');
    var key = String(c.SUPABASE_KEY || '');
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/.test(url) || key.length < 20 || /PASTE_/.test(key)) return null;
    return { url: url, key: key };
  }

  function failure(code, message) { return { success: false, error: { code: code, message: message } }; }

  function call(action, params, timeoutMs, networkMessage) {
    var def = ACTIONS[action], cfg = settings();
    if (!def) return Promise.resolve(failure('BAD_REQUEST', 'Unknown request.'));
    if (!cfg) return Promise.resolve(failure('NOT_CONFIGURED', 'This page is not connected to the database yet. Please contact the administrator.'));

    var headers = { 'Content-Type': 'application/json', 'apikey': cfg.key };
    if (/^eyJ/.test(cfg.key)) headers.Authorization = 'Bearer ' + cfg.key;   // legacy JWT-style keys also need this header

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 30000) : null;

    return fetch(cfg.url + '/rest/v1/rpc/' + def.fn, {
      method: 'POST', headers: headers, signal: controller ? controller.signal : undefined,
      body: JSON.stringify(def.args ? def.args(params || {}) : {})
    })
      .then(function (response) {
        return response.text().then(function (text) {
          var body; try { body = text ? JSON.parse(text) : null; } catch (e) { body = undefined; }
          if (!response.ok || body === undefined) {
            return failure('SERVER_ERROR', 'The service is not reachable right now. Please try again shortly.');
          }
          if (def.envelope) return body && typeof body === 'object' && 'success' in body ? body : failure('SERVER_ERROR', 'Unexpected response. Please try again.');
          return { success: true, data: body };
        });
      })
      .catch(function () { return failure('NETWORK', networkMessage || NETWORK_MESSAGE); })
      .then(function (result) { if (timer) clearTimeout(timer); return result; });
  }

  window.TK27_API = {
    get: function (action, params, timeoutMs) { return call(action, params, timeoutMs, READ_NETWORK_MESSAGE); },
    post: function (action, payload, timeoutMs) { return call(action, payload, timeoutMs, NETWORK_MESSAGE); }
  };
})();
