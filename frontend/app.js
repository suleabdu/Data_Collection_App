(function () {
  'use strict';
  var db = window.TK27_DB;
  var $ = function (id) { return document.getElementById(id); };
  var state = { busy: false, ready: false, paused: false, positionOptions: [], submissionKey: newKey(), requestId: 0 };
  var el = {
    form: $('form'), banner: $('banner'), formCard: $('formCard'), successCard: $('successCard'),
    stateName: $('stateName'), position: $('position'), name: $('name'), phone: $('phone'),
    lga: $('lga'), ward: $('ward'), pu: $('pu'), submit: $('submitBtn'), website: $('website')
  };
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function showBanner(message, kind, retry) {
    el.banner.className = 'banner ' + (kind || 'error');
    el.banner.textContent = message || '';
    if (retry) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = 'Try again';
      b.addEventListener('click', retry); el.banner.appendChild(b);
    }
    el.banner.hidden = !message;
  }
  function hideBanner() { el.banner.hidden = true; }
  function setError(id, message) {
    var box = $('f-' + id), text = $('e-' + id); if (!box || !text) return;
    box.classList.toggle('invalid', !!message);
    text.textContent = message || '';
    text.hidden = !message;
    var field = $(id);
    if (field) {
      if (message) field.setAttribute('aria-invalid', 'true');
      else field.removeAttribute('aria-invalid');
    }
  }
  function clearErrors(ids) { (ids || ['position','name','phone','lga','ward','pu']).forEach(function (id) { setError(id, ''); }); }
  function fillSelect(select, placeholder, data, value, label) {
    select.innerHTML = '';
    var first = document.createElement('option'); first.value = ''; first.textContent = placeholder; select.appendChild(first);
    (data || []).forEach(function (item) { var o = document.createElement('option'); o.value = value(item); o.textContent = label(item); select.appendChild(o); });
  }
  function lockSelect(select, placeholder) { fillSelect(select, placeholder, [], String, String); select.disabled = true; }
  function refreshSubmitState() {
    el.submit.disabled = !state.ready || state.busy || state.paused;
    if (state.busy) el.submit.textContent = 'Submitting securely…';
    else el.submit.textContent = 'Submit registration';
  }
  function validateAll() {
    var errors = {};
    if (!el.position.value) errors.position = 'Please choose a position.';
    var parts = el.name.value.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2 || el.name.value.trim().length > 100) errors.name = 'Enter the coordinator’s first and last name.';
    if (!normalizePhone(el.phone.value)) errors.phone = 'Enter a valid Nigerian phone number, for example 08012345678.';
    if (!el.lga.value) errors.lga = 'Please choose a local government.';
    if (!el.ward.value) errors.ward = 'Please choose a ward.';
    if (!el.pu.value) errors.pu = 'Please choose a polling unit.';

    clearErrors();
    var order = ['position','name','phone','lga','ward','pu'];
    order.forEach(function (id) { if (errors[id]) setError(id, errors[id]); });
    var first = order.find(function (id) { return !!errors[id]; });
    if (first) {
      var field = $(first);
      if (field && !field.disabled) {
        field.focus({ preventScroll: true });
        field.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      showBanner('Please check the fields marked below, then submit the form again.', 'warn');
    }
    return !first;
  }
  function normalizePhone(value) {
    var d = String(value || '').replace(/\D/g, '');
    if (d.length === 11 && d.charAt(0) === '0') d = '234' + d.slice(1);
    else if (d.length === 10 && /^[789]/.test(d)) d = '234' + d;
    if (d.length === 13 && d.slice(0,3) === '234' && /^[789]/.test(d.slice(3,4))) return '+' + d;
    return '';
  }
  async function request(table, select, apply) {
    var result = await db.from(table).select(select).order(apply.order || 'lga').limit(6000);
    if (result.error) throw result.error;
    return apply.map(result.data || []);
  }
  async function init() {
    if (!window.TK27_DB_READY || !db) { showBanner('This form has not been connected to Supabase yet. Please contact the administrator.', 'error'); return; }
    try {
      var result = await db.rpc('public_app_status'); if (result.error) throw result.error;
      var config = result.data || {}; el.stateName.textContent = String(config.state || 'Ogun').toUpperCase() + ' STATE';
      document.title = 'TK27 ' + (config.state || 'Ogun') + ' Coordinator Registration';
      state.paused = !!config.paused; state.ready = !!config.ready; state.positionOptions = config.positions || [];
      fillSelect(el.position, 'Choose a position', state.positionOptions, function (p) { return p.value; }, function (p) { return p.label; });
      el.position.disabled = false;
      try { var saved = localStorage.getItem('tk27_position'); if (saved) el.position.value = saved; } catch (_) {}
      if (state.paused) { refreshSubmitState(); showBanner('Registration is temporarily paused. Please try again later.', 'warn'); return; }
      if (!state.ready) { refreshSubmitState(); showBanner('The location directory is not available yet. Please contact the administrator.', 'warn'); return; }
      var lgas = await db.rpc('get_public_lgas');
      if (lgas.error) throw lgas.error;
      fillSelect(el.lga, 'Choose a local government', lgas.data || [], function (l) { return l.lga_code; }, function (l) { return l.lga; });
      el.lga.disabled = false; hideBanner(); refreshSubmitState();
    } catch (error) {
      console.error(error); showBanner('We could not load the location directory. Check your connection and try again.', 'error', init);
    }
  }
  async function onLgaChange() {
    state.requestId++; var token = state.requestId; lockSelect(el.ward, 'Loading wards…'); lockSelect(el.pu, 'Choose a ward first'); clearErrors(['lga','ward','pu']);
    if (!el.lga.value) { lockSelect(el.ward, 'Choose a local government first'); return; }
    try {
      var result = await db.rpc('get_public_wards', { p_lga_code: el.lga.value });
      if (token !== state.requestId) return; if (result.error) throw result.error;
      fillSelect(el.ward, 'Choose a ward', result.data || [], function (w) { return w.ward_code; }, function (w) { return w.ward; }); el.ward.disabled = false;
    } catch (error) { console.error(error); showBanner('Could not load wards. Please try again.', 'error', onLgaChange); }
  }
  async function onWardChange() {
    state.requestId++; var token = state.requestId; lockSelect(el.pu, 'Loading polling units…'); clearErrors(['ward','pu']);
    if (!el.ward.value) { lockSelect(el.pu, 'Choose a ward first'); return; }
    try {
      var result = await db.rpc('get_public_polling_units', { p_lga_code: el.lga.value, p_ward_code: el.ward.value });
      if (token !== state.requestId) return; if (result.error) throw result.error;
      fillSelect(el.pu, 'Choose a polling unit', result.data || [], function (p) { return p.full_pu_code; }, function (p) { return p.polling_unit + ' (' + p.polling_unit_code + ')'; }); el.pu.disabled = false;
    } catch (error) { console.error(error); showBanner('Could not load polling units. Please try again.', 'error', onWardChange); }
  }
  async function submit(event) {
    event.preventDefault(); if (state.busy || !state.ready || state.paused) return;
    if (!validateAll()) return;
    state.busy = true; hideBanner(); refreshSubmitState();
    try {
      // Public submission is routed through the server-side Edge Function so direct
      // anonymous RPC execution can be revoked and attempts can be rate-limited.
      var result = await db.functions.invoke('submit-coordinator', {
        body: {
          p_position: el.position.value, p_name: el.name.value.trim(), p_phone: el.phone.value.trim(),
          p_lga_code: el.lga.value, p_ward_code: el.ward.value, p_pu_code: el.pu.value,
          p_submission_key: state.submissionKey, p_website: el.website.value
        }
      });
      if (result.error) {
        var invokeError = result.error;
        var response = invokeError && invokeError.context;
        // Supabase FunctionsHttpError exposes the Response as context. Read a clone so
        // the body remains available to the SDK and map known deployment failures.
        if (response && typeof response.clone === 'function') {
          var responseBody = null;
          try { responseBody = await response.clone().json(); } catch (_) {}
          if (responseBody && typeof responseBody === 'object' && responseBody.code) {
            var responseError = new Error(responseBody.message || invokeError.message || 'The submission service could not complete this request.');
            responseError.code = String(responseBody.code);
            responseError.status = Number(responseBody.status || response.status || 0);
            responseError.details = responseBody.details || null;
            responseError.hint = responseBody.hint || null;
            throw responseError;
          }
          if (response.status === 404) {
            var missingGateway = new Error('The submit-coordinator Edge Function was not found.');
            missingGateway.code = 'SUBMISSION_GATEWAY_NOT_FOUND';
            missingGateway.status = 404;
            throw missingGateway;
          }
          if (response.status === 429) {
            var limitedGateway = new Error('Too many submission attempts came from this network.');
            limitedGateway.code = 'RATE_LIMITED';
            limitedGateway.status = 429;
            throw limitedGateway;
          }
        }
        throw invokeError;
      }
      var data = result.data || {};
      if (data.code === 'RATE_LIMITED') {
        showBanner(data.message || 'There have been too many attempts from this network. Please wait a few minutes before trying again.', 'warn');
        el.banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      // Edge Function envelopes retain the database diagnostic code, but keep raw
      // PostgreSQL errors and record details out of the public response.
      if (data.success === false && data.code && data.code !== 'DUPLICATE_RECORD') {
        var serviceError = new Error(data.message || 'The submission service could not complete this request.');
        serviceError.code = data.code;
        serviceError.status = data.status || 0;
        serviceError.details = data.details || null;
        serviceError.hint = data.hint || null;
        throw serviceError;
      }
      // The database RPC blocks matching records and returns a structured result.
      // A duplicate rejection must never transition the page to the success state.
      if (data.duplicate === true && data.success === false) {
        showBanner(data.message || 'We could not submit this registration because a record with matching details already exists. No new record has been created. Please check the name and phone number, or contact the administrator if you believe this is an error.', 'warn');
        el.banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      // Defensive compatibility warning: an older SQL function may flag a duplicate
      // without confirming it was blocked. Do not falsely claim that it was rejected.
      if (data.duplicate === true && data.success !== true) {
        showBanner('A matching record was detected, but the server is running an older submission routine. Please stop here and ask the administrator to apply the duplicate-prevention database update before trying again.', 'error');
        el.banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (data.success === false) throw new Error(data.message || 'The server could not accept this submission.');
      el.formCard.hidden = true; el.successCard.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      // Log the Supabase/PostgREST diagnostic fields locally. Do not expose raw SQL or
      // personal data in the public UI, but make the likely setup problem actionable.
      var msg = String(error && error.message || '');
      var code = String(error && error.code || '');
      var status = Number(error && (error.status || error.statusCode) || 0);
      var diagnostic = {
        code: code || '(none)', status: status || '(none)', message: msg,
        details: error && error.details || null, hint: error && error.hint || null
      };
      // Keep diagnostics useful without logging the submitted name, phone, or request key.
      console.error('[TK27] Submission request failed. Diagnostic (no form values): ' + JSON.stringify(diagnostic));
      if (/paused/i.test(msg) || code === '55000') {
        state.paused = true;
        showBanner('Registration is temporarily paused. Please try again later.', 'warn');
      } else if (code === '23505' || status === 409) {
        // HTTP 409 usually means a database constraint conflict. It is not proof that
        // the name/phone duplicate rule matched; do not mislabel it as a duplicate.
        showBanner('The database reported a uniqueness conflict (HTTP 409' + (code ? ', code ' + code : '') + '). This does not by itself confirm that the coordinator details are duplicated. Your form is still here. Please avoid repeated submissions and contact the administrator with this diagnostic so the affected database constraint can be checked.', 'error');
      } else if (/duplicate_record|matching details already exists/i.test(msg) || code === 'DUPLICATE_RECORD') {
        showBanner('We could not submit this registration because a record with matching details already exists. No new record has been created. Please check the details or contact the administrator if you believe this is an error.', 'warn');
      } else if (/phone/i.test(msg) || code === 'TK27_PHONE_INVALID') {
        setError('phone','Please enter a valid Nigerian phone number.'); el.phone.focus({ preventScroll: true }); el.phone.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showBanner('Please check the highlighted phone number.', 'error');
      } else if (/first and last name|coordinator.?s name|valid position|select a valid position/i.test(msg)) {
        var invalidId = /valid position|select a valid position/i.test(msg) ? 'position' : 'name';
        setError(invalidId, invalidId === 'position' ? 'Please choose a valid position.' : 'Enter the coordinator’s first and last name.');
        $(invalidId).focus({ preventScroll: true }); $(invalidId).scrollIntoView({ behavior: 'smooth', block: 'center' });
        showBanner('Please check the highlighted coordinator details, then try again.', 'error');
      } else if (/refresh the form|submission key/i.test(msg)) {
        showBanner('This form session could not be validated. Refresh the page, re-enter the details and submit again. If a previous attempt may have completed, ask the administrator to check before resubmitting.', 'error');
      } else if (/location|polling unit|ward|local government/i.test(msg)) {
        var locationId = /polling unit/i.test(msg) ? 'pu' : /ward/i.test(msg) ? 'ward' : 'lga';
        setError(locationId, 'Please select a valid ' + (locationId === 'pu' ? 'polling unit' : locationId === 'lga' ? 'local government' : 'ward') + '.');
        $(locationId).focus({ preventScroll: true }); $(locationId).scrollIntoView({ behavior: 'smooth', block: 'center' });
        showBanner('The selected location could not be validated. Please check the location fields, then try again.', 'error');
      } else if (code === 'RATE_LIMITED' || status === 429) {
        showBanner('Too many submission attempts have come from this network in a short period. Please wait a few minutes and try again.', 'warn');
      } else if (code === 'SUBMISSION_GATEWAY_NOT_FOUND' || status === 404) {
        showBanner('The public submission service is not deployed or could not be found. The administrator should deploy the submit-coordinator Edge Function, then try again.', 'error');
      } else if (code === 'PGRST202' || /could not find the function|schema cache/i.test(msg)) {
        showBanner('The submission service is not fully installed in Supabase. The administrator should apply migrations 001–006 and deploy the submit-coordinator Edge Function, then try again.' + (code ? ' Diagnostic: ' + code + '.' : ''), 'error');
      } else if (code === '42501' || status === 401 || status === 403 || /permission denied|not authorized|invalid api key|jwt/i.test(msg)) {
        showBanner('Supabase rejected the submission request. The administrator should check the project URL, public key and execute permissions for the submit_coordinator database function.' + (code ? ' Diagnostic: ' + code + '.' : ''), 'error');
      } else if (/failed to fetch|networkerror|network request failed|load failed|fetch failed/i.test(msg) || error instanceof TypeError) {
        showBanner('We could not reach the TK27 database. Check your internet connection and the Supabase URL in frontend/config.js, then retry. Your entered details are still on this page.');
      } else if (code || status) {
        showBanner('The server could not complete this submission. Your details are still on this page. Please contact the administrator and provide diagnostic code ' + (code || ('HTTP ' + status)) + '.');
      } else {
        showBanner('The server could not complete this submission. Your details are still on this page. Check the browser Console for the [TK27] submission diagnostic, then retry or contact the administrator.');
      }
      el.banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } finally { state.busy = false; refreshSubmitState(); }
  }
  el.position.addEventListener('change', function () { clearErrors(['position']); hideBanner(); try { localStorage.setItem('tk27_position',el.position.value); } catch (_) {} });
  el.name.addEventListener('input', function () { setError('name',''); });
  el.phone.addEventListener('input', function () { setError('phone',''); });
  el.lga.addEventListener('change', function () { hideBanner(); onLgaChange(); });
  el.ward.addEventListener('change', function () { hideBanner(); onWardChange(); });
  el.pu.addEventListener('change', function () { setError('pu',''); });
  [el.name, el.phone].forEach(function (field) { field.addEventListener('input', function () { if (!el.banner.hidden) hideBanner(); }); });
  el.form.addEventListener('submit', submit);
  refreshSubmitState(); init();
})();
