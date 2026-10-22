(function () {
  'use strict';
  var db = window.TK27_DB;
  var $ = function (id) { return document.getElementById(id); };
  var fieldsByStep = { 1: ['position', 'name', 'phone'], 2: ['lga', 'ward', 'pu'] };
  var state = { step: 1, busy: false, ready: false, paused: false, positionOptions: [], submissionKey: newKey(), requestId: 0 };
  var el = {
    form: $('form'), banner: $('banner'), formCard: $('formCard'), successCard: $('successCard'),
    stateName: $('stateName'), position: $('position'), name: $('name'), phone: $('phone'),
    lga: $('lga'), ward: $('ward'), pu: $('pu'), submit: $('submitBtn'), website: $('website')
  };
  var titles = {
    1: ['Let’s get your details in place.', 'Share a few accurate details so the directory stays useful and up to date.'],
    2: ['Let’s pin down the right location.', 'Select the coordinator’s local government, ward and polling unit.'],
    3: ['A quick final check.', 'Confirm the details below before adding the record to the directory.']
  };
  function newKey() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }
  function showBanner(message, kind, retry) {
    el.banner.className = 'banner ' + (kind || 'error'); el.banner.textContent = message || '';
    if (retry) { var b = document.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = 'Try again'; b.addEventListener('click', retry); el.banner.appendChild(b); }
    el.banner.hidden = !message;
  }
  function hideBanner() { el.banner.hidden = true; }
  function setError(id, message) {
    var box = $('f-' + id), text = $('e-' + id); if (!box || !text) return;
    box.classList.toggle('invalid', !!message); text.textContent = message || ''; text.hidden = !message;
  }
  function clearErrors(ids) { (ids || ['position','name','phone','lga','ward','pu']).forEach(function (id) { setError(id, ''); }); }
  function fillSelect(select, placeholder, data, value, label) {
    select.innerHTML = ''; var first = document.createElement('option'); first.value = ''; first.textContent = placeholder; select.appendChild(first);
    (data || []).forEach(function (item) { var o = document.createElement('option'); o.value = value(item); o.textContent = label(item); select.appendChild(o); });
  }
  function lockSelect(select, placeholder) { fillSelect(select, placeholder, [], String, String); select.disabled = true; }
  function renderStep() {
    state.step = Math.max(1, Math.min(3, state.step));
    document.querySelectorAll('[data-panel]').forEach(function (panel) { panel.hidden = Number(panel.getAttribute('data-panel')) !== state.step; });
    document.querySelectorAll('.stepper-step').forEach(function (button) {
      var n = Number(button.dataset.step); button.classList.toggle('active', n === state.step); button.classList.toggle('complete', n < state.step);
      if (n === state.step) button.setAttribute('aria-current','step'); else button.removeAttribute('aria-current');
      button.disabled = n > state.step || state.busy;
    });
    $('stepTitle').textContent = titles[state.step][0]; $('stepSubtitle').textContent = titles[state.step][1];
    $('next1').disabled = !state.ready || state.busy; $('next2').disabled = state.busy; el.submit.disabled = !state.ready || state.busy;
    if (state.step === 3) fillReview();
  }
  function validateStep(step) {
    var errors = {};
    if (step === 1) {
      if (!el.position.value) errors.position = 'Please choose a position.';
      var parts = el.name.value.trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2 || el.name.value.trim().length > 100) errors.name = 'Enter the coordinator’s first and last name.';
      if (!normalizePhone(el.phone.value)) errors.phone = 'Enter a valid Nigerian phone number, for example 08012345678.';
    } else if (step === 2) {
      if (!el.lga.value) errors.lga = 'Please choose a local government.';
      if (!el.ward.value) errors.ward = 'Please choose a ward.';
      if (!el.pu.value) errors.pu = 'Please choose a polling unit.';
    }
    clearErrors(fieldsByStep[step] || []);
    var first = null;
    Object.keys(errors).forEach(function (id) { setError(id, errors[id]); if (!first) first = id; });
    if (first) $(first).focus();
    return !Object.keys(errors).length;
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
      if (state.paused) { showBanner('Registration is temporarily paused. Please try again later.', 'warn'); return; }
      if (!state.ready) { showBanner('The location directory is not available yet. Please contact the administrator.', 'warn'); return; }
      var lgas = await db.rpc('get_public_lgas');
      if (lgas.error) throw lgas.error;
      fillSelect(el.lga, 'Choose a local government', lgas.data || [], function (l) { return l.lga_code; }, function (l) { return l.lga; });
      el.lga.disabled = false; hideBanner(); renderStep();
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
  function selectedText(select) { return select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : '—'; }
  function fillReview() {
    $('reviewPosition').textContent = selectedText(el.position); $('reviewName').textContent = el.name.value.trim();
    $('reviewPhone').textContent = normalizePhone(el.phone.value) || el.phone.value.trim(); $('reviewLga').textContent = selectedText(el.lga);
    $('reviewWard').textContent = selectedText(el.ward); $('reviewPu').textContent = selectedText(el.pu);
  }
  function moveTo(step) { hideBanner(); state.step = step; renderStep(); var heading = $('stepTitle'); if (heading) heading.focus({ preventScroll: true }); }
  async function submit(event) {
    event.preventDefault(); if (state.busy || !state.ready || state.paused) return;
    if (!validateStep(1)) { moveTo(1); return; }
    if (!validateStep(2)) { moveTo(2); return; }
    state.busy = true; hideBanner(); $('submitBtn').textContent = 'Submitting securely…'; renderStep();
    try {
      var result = await db.rpc('submit_coordinator', {
        p_position: el.position.value, p_name: el.name.value.trim(), p_phone: el.phone.value.trim(),
        p_lga_code: el.lga.value, p_ward_code: el.ward.value, p_pu_code: el.pu.value,
        p_submission_key: state.submissionKey, p_website: el.website.value
      });
      if (result.error) throw result.error;
      var data = result.data || {}; $('referenceNumber').textContent = data.recordId || 'Received';
      $('dupNotice').hidden = !data.duplicate; $('dupNotice').textContent = data.duplicateMessage || '';
      el.formCard.hidden = true; el.successCard.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error(error); var msg = String(error && error.message || '');
      if (/paused/i.test(msg)) { state.paused = true; showBanner('Registration is temporarily paused. Please try again later.', 'warn'); }
      else if (/phone/i.test(msg)) { moveTo(1); setError('phone','Please enter a valid Nigerian phone number.'); showBanner('Please check the highlighted detail.', 'error'); }
      else if (/location|polling unit|ward|local government/i.test(msg)) { moveTo(2); showBanner('Please reselect the location and submit again.', 'error'); }
      else showBanner('We could not submit this record. Your form is still here; please check your connection and try again.', 'error');
    } finally { state.busy = false; $('submitBtn').textContent = 'Submit registration'; renderStep(); }
  }
  function addAnother() {
    el.form.reset(); el.website.value = ''; state.submissionKey = newKey(); state.paused = false;
    lockSelect(el.ward,'Choose a local government first'); lockSelect(el.pu,'Choose a ward first');
    try { var saved = localStorage.getItem('tk27_position'); if (saved) el.position.value = saved; } catch (_) {}
    el.successCard.hidden = true; el.formCard.hidden = false; clearErrors(); hideBanner(); moveTo(1); init();
  }
  el.position.addEventListener('change', function () { clearErrors(['position']); try { localStorage.setItem('tk27_position',el.position.value); } catch (_) {} });
  ['name','phone'].forEach(function (id) { $(id).addEventListener('input', function () { setError(id,''); }); });
  el.lga.addEventListener('change', onLgaChange); el.ward.addEventListener('change', onWardChange);
  $('next1').addEventListener('click', function () { if (validateStep(1)) moveTo(2); });
  $('next2').addEventListener('click', function () { if (validateStep(2)) moveTo(3); });
  $('back2').addEventListener('click', function () { moveTo(1); }); $('back3').addEventListener('click', function () { moveTo(2); });
  document.querySelectorAll('.stepper-step').forEach(function (b) { b.addEventListener('click', function () { var n = Number(b.dataset.step); if (n < state.step) moveTo(n); }); });
  el.form.addEventListener('submit', submit); $('addAnother').addEventListener('click', addAnother);
  renderStep(); init();
})();
