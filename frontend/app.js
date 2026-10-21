// Public collection form: Position, Name, Phone, then LGA > Ward > Polling Unit (cascading).
(function () {
  'use strict';

  var api = window.TK27_API;
  var check = window.TK27_VALIDATE;
  var $ = function (id) { return document.getElementById(id); };

  var fields = ['position', 'name', 'phone', 'lga', 'ward', 'pu'];
  var el = {
    form: $('form'), banner: $('banner'), submit: $('submitBtn'), stateName: $('stateName'),
    formCard: $('formCard'), successCard: $('successCard'), website: $('website'),
    position: $('position'), name: $('name'), phone: $('phone'), lga: $('lga'), ward: $('ward'), pu: $('pu')
  };

  var token = { ward: 0, pu: 0 };           // ignore responses that arrive after the user changed their choice
  var busy = false;
  var ready = false;
  var submissionKey = newKey();
  var lastFingerprint = '';

  // ---------- helpers ----------
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var out = '';
    for (var i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
    return out;
  }

  function showBanner(message, kind, retry) {
    el.banner.className = 'banner ' + (kind || 'error');
    el.banner.textContent = message;
    if (retry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn small';
      button.textContent = 'Try again';
      button.addEventListener('click', retry);
      el.banner.appendChild(button);
    }
    el.banner.hidden = false;
  }

  function hideBanner() { el.banner.hidden = true; }

  function setError(field, message) {
    var box = $('f-' + field), text = $('e-' + field);
    if (!box || !text) return;
    box.classList.toggle('invalid', !!message);
    text.hidden = !message;
    text.textContent = message || '';
  }

  function clearErrors() { fields.forEach(function (f) { setError(f, ''); }); }

  function fillSelect(select, placeholder, items, valueOf, labelOf) {
    select.innerHTML = '';
    var first = document.createElement('option');
    first.value = '';
    first.textContent = placeholder;
    select.appendChild(first);
    (items || []).forEach(function (item) {
      var option = document.createElement('option');
      option.value = valueOf(item);
      option.textContent = labelOf(item);
      select.appendChild(option);
    });
  }

  function lockSelect(select, placeholder) {
    fillSelect(select, placeholder, [], String, String);
    select.disabled = true;
  }

  function refreshSubmit() {
    el.submit.disabled = busy || !ready;
  }

  // ---------- startup ----------
  function loadState() {
    api.get('getState').then(function (res) {
      if (!res.success) { showBanner(res.error.message, 'error', loadState); return; }
      var s = res.data;
      el.stateName.textContent = String(s.state || '').toUpperCase() + ' STATE';
      document.title = 'TK27 ' + s.state + ' Coordinator Data Collection';

      fillSelect(el.position, 'Select position', s.positions, function (p) { return p.value; }, function (p) { return p.label; });
      el.position.disabled = false;
      try { var saved = localStorage.getItem('tk27_position'); if (saved) el.position.value = saved; } catch (e) { /* ignore */ }

      if (s.paused) { showBanner('Data collection is paused at the moment. Please try again later.', 'warn'); return; }
      if (!s.ready) { showBanner('The location list is not available yet. Please contact the administrator.', 'warn'); return; }
      ready = true;
      refreshSubmit();
      loadLgas();
    });
  }

  function loadLgas() {
    fillSelect(el.lga, 'Loading LGAs...', [], String, String);
    el.lga.disabled = true;
    api.get('getLGAs').then(function (res) {
      if (!res.success) { fillSelect(el.lga, 'Could not load', [], String, String); showBanner(res.error.message, 'error', loadLgas); return; }
      hideBanner();
      fillSelect(el.lga, 'Select local government', res.data, function (l) { return l.code; }, function (l) { return l.name; });
      el.lga.disabled = false;
    });
  }

  function onLgaChange() {
    token.ward++; token.pu++;
    lockSelect(el.pu, 'Select a ward first');
    setError('lga', ''); setError('ward', ''); setError('pu', '');
    if (!el.lga.value) { lockSelect(el.ward, 'Select a local government first'); return; }

    var mine = token.ward;
    fillSelect(el.ward, 'Loading wards...', [], String, String);
    el.ward.disabled = true;
    api.get('getWards', { lgaCode: el.lga.value }).then(function (res) {
      if (mine !== token.ward) return;
      if (!res.success) { lockSelect(el.ward, 'Could not load wards'); showBanner(res.error.message, 'error', onLgaChange); return; }
      hideBanner();
      fillSelect(el.ward, 'Select ward', res.data, function (w) { return w.code; }, function (w) { return w.name; });
      el.ward.disabled = false;
    });
  }

  function onWardChange() {
    token.pu++;
    setError('ward', ''); setError('pu', '');
    if (!el.ward.value) { lockSelect(el.pu, 'Select a ward first'); return; }

    var mine = token.pu;
    fillSelect(el.pu, 'Loading polling units...', [], String, String);
    el.pu.disabled = true;
    api.get('getPollingUnits', { lgaCode: el.lga.value, wardCode: el.ward.value }).then(function (res) {
      if (mine !== token.pu) return;
      if (!res.success) { lockSelect(el.pu, 'Could not load polling units'); showBanner(res.error.message, 'error', onWardChange); return; }
      hideBanner();
      // Show the unit number: a few wards have two units with the same name.
      fillSelect(el.pu, 'Select polling unit', res.data, function (p) { return p.fullCode; }, function (p) { return p.name + ' (' + p.code + ')'; });
      el.pu.disabled = false;
    });
  }

  // ---------- submit ----------
  function readValues() {
    return {
      position: el.position.value, name: el.name.value.trim(), phone: el.phone.value.trim(),
      lgaCode: el.lga.value, wardCode: el.ward.value, puCode: el.pu.value
    };
  }

  function validateLocally(v) {
    var errors = {};
    if (!v.position) errors.position = 'Please select a position.';
    if (!check.isValidName(v.name)) errors.name = "Please enter the coordinator's full name (first and last name).";
    if (!check.normalizePhone(v.phone)) errors.phone = 'Please enter a valid Nigerian phone number, for example 08012345678.';
    if (!v.lgaCode) errors.lga = 'Please select a local government.';
    if (!v.wardCode) errors.ward = 'Please select a ward.';
    if (!v.puCode) errors.pu = 'Please select a valid polling unit.';
    return errors;
  }

  function showErrors(errors) {
    clearErrors();
    var first = null;
    fields.forEach(function (f) {
      if (errors[f]) { setError(f, errors[f]); if (!first) first = f; }
    });
    if (first) el[first].focus();
  }

  function onSubmit(event) {
    event.preventDefault();
    if (busy || !ready) return;
    hideBanner();

    var values = readValues();
    var errors = validateLocally(values);
    if (Object.keys(errors).length) { showErrors(errors); return; }
    clearErrors();

    // Same details => same key (safe retry). Changed details => new key, so a retry never replays an old save.
    var fingerprint = JSON.stringify(values);
    if (fingerprint !== lastFingerprint) { submissionKey = newKey(); lastFingerprint = fingerprint; }

    busy = true;
    el.submit.textContent = 'Submitting record...';
    refreshSubmit();

    api.post('submitCoordinator', Object.assign({ submissionKey: submissionKey, website: el.website.value }, values)).then(function (res) {
      busy = false;
      el.submit.textContent = 'Submit record';
      refreshSubmit();

      if (res.success) { showSuccess(res.data); return; }
      if (res.error.fields) { showErrors(res.error.fields); }
      showBanner(res.error.message, res.error.code === 'NETWORK' ? 'error' : 'error');
    });
  }

  function showSuccess(data) {
    $('refNumber').textContent = data.recordId;
    var notice = $('dupNotice');
    notice.hidden = !data.duplicate;
    notice.textContent = data.duplicateMessage || '';

    var rows = [
      ['Name', data.summary.name], ['Position', data.summary.position], ['Phone', data.summary.phone],
      ['Local government', data.summary.lga], ['Ward', data.summary.ward], ['Polling unit', data.summary.pollingUnit]
    ];
    var list = $('summary');
    list.innerHTML = '';
    rows.forEach(function (r) {
      var dt = document.createElement('dt'); dt.textContent = r[0];
      var dd = document.createElement('dd'); dd.textContent = r[1];
      var wrap = document.createElement('div'); wrap.appendChild(dt); wrap.appendChild(dd);
      list.appendChild(wrap);
    });

    try { localStorage.setItem('tk27_position', el.position.value); } catch (e) { /* ignore */ }
    el.formCard.hidden = true;
    el.successCard.hidden = false;
    window.scrollTo(0, 0);
  }

  function addAnother() {
    var keepPosition = el.position.value;
    el.form.reset();
    el.position.value = keepPosition;
    lockSelect(el.ward, 'Select a local government first');
    lockSelect(el.pu, 'Select a ward first');
    clearErrors();
    hideBanner();
    submissionKey = newKey();
    lastFingerprint = '';
    el.successCard.hidden = true;
    el.formCard.hidden = false;
    window.scrollTo(0, 0);
    el.name.focus();
  }

  // ---------- wire up ----------
  el.lga.addEventListener('change', onLgaChange);
  el.ward.addEventListener('change', onWardChange);
  el.form.addEventListener('submit', onSubmit);
  $('addAnother').addEventListener('click', addAnother);
  fields.forEach(function (f) {
    var input = el[f];
    input.addEventListener('input', function () { setError(f, ''); });
  });

  refreshSubmit();
  loadState();
})();
