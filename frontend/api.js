// Tiny API client shared by the public form and the admin page.
// Always resolves to { success, data } or { success:false, error:{code,message,fields?} } — never throws.
(function () {
  'use strict';

  var NETWORK_MESSAGE = 'Connection interrupted. Your information has not been submitted. Please try again.';

  function baseUrl() {
    var url = (window.TK27_CONFIG || {}).API_URL || '';
    return /^https:\/\/script\.google\.com\//.test(url) ? url : '';
  }

  function failure(code, message) {
    return { success: false, error: { code: code, message: message } };
  }

  function request(url, options, timeoutMs, networkMessage) {
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || 30000) : null;
    if (controller) options.signal = controller.signal;

    return fetch(url, options)
      .then(function (response) { return response.text(); })
      .then(function (text) {
        try { return JSON.parse(text); }
        catch (e) { return failure('SERVER_ERROR', 'The service is not reachable right now. Please try again shortly.'); }
      })
      .catch(function () { return failure('NETWORK', networkMessage || NETWORK_MESSAGE); })
      .then(function (result) { if (timer) clearTimeout(timer); return result; });
  }

  function notConfigured() {
    return Promise.resolve(failure('NOT_CONFIGURED', 'This page is not connected to the backend yet. Please contact the administrator.'));
  }

  window.TK27_API = {
    get: function (action, params, timeoutMs) {
      var base = baseUrl();
      if (!base) return notConfigured();
      var query = new URLSearchParams(Object.assign({ action: action }, params || {}));
      return request(base + '?' + query.toString(), { method: 'GET' }, timeoutMs,
        'Connection interrupted. Please check your internet connection and try again.');
    },

    // text/plain avoids a CORS preflight, which Apps Script cannot answer.
    post: function (action, payload, timeoutMs) {
      var base = baseUrl();
      if (!base) return notConfigured();
      return request(base, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({}, payload || {}, { action: action }))
      }, timeoutMs);
    }
  };
})();
