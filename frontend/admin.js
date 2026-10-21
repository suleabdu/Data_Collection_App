// Admin dashboard. The passcode is kept in sessionStorage only (cleared when the tab closes) and is
// re-checked by the backend on every request.
(function () {
  'use strict';

  var api = window.TK27_API;
  var $ = function (id) { return document.getElementById(id); };
  var POSITION_LABELS = { STATE_EXCO: 'State Exco', LGA_COORDINATOR: 'LGA Coordinator', WARD_COORDINATOR: 'Ward Coordinator' };
  var EXPORTS = [['ALL', 'All records'], ['STATE_EXCO', 'State Excos'], ['LGA_COORDINATOR', 'LGA Coordinators'],
    ['WARD_COORDINATOR', 'Ward Coordinators'], ['DUPLICATES', 'Duplicate review list'], ['MASTER', 'Master geography']];

  var passcode = '';
  var page = 1;
  var pageSize = 25;
  var total = 0;
  var paused = false;
  var searchTimer = null;

  function store(value) { try { sessionStorage.setItem('tk27_admin', value); } catch (e) { /* ignore */ } }
  function stored() { try { return sessionStorage.getItem('tk27_admin') || ''; } catch (e) { return ''; } }
  function forget() { try { sessionStorage.removeItem('tk27_admin'); } catch (e) { /* ignore */ } }

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function call(action, payload, timeout) {
    return api.post(action, Object.assign({ passcode: passcode }, payload || {}), timeout || 60000).then(function (res) {
      if (!res.success && res.error.code === 'UNAUTHORIZED') signOut('Your session ended. Please sign in again.');
      return res;
    });
  }

  function banner(node, message, kind) {
    node.className = 'banner ' + (kind || 'error');
    node.textContent = message;
    node.hidden = !message;
  }

  // ---------- sign in / out ----------
  function showLogin(message) {
    $('dash').hidden = true;
    $('loginCard').hidden = false;
    banner($('loginBanner'), message || '', 'error');
  }

  function signOut(message) {
    passcode = '';
    forget();
    showLogin(message);
  }

  function signIn(code) {
    passcode = code;
    $('loginBtn').disabled = true;
    $('loginBtn').textContent = 'Checking...';
    return call('adminCheck').then(function (res) {
      $('loginBtn').disabled = false;
      $('loginBtn').textContent = 'Sign in';
      if (!res.success) { passcode = ''; showLogin(res.error.code === 'UNAUTHORIZED' ? 'Incorrect admin passcode.' : res.error.message); return; }
      store(code);
      $('passcode').value = '';
      $('loginCard').hidden = true;
      $('dash').hidden = false;
      refreshAll();
    });
  }

  // ---------- dashboard ----------
  function statCard(value, label, accent) {
    var box = el('div', null, 'stat' + (accent ? ' accent' : ''));
    box.appendChild(el('div', String(value), 'n'));
    box.appendChild(el('div', label, 'l'));
    return box;
  }

  function renderStats(data) {
    var s = data.stats;
    var cards = $('cards');
    cards.innerHTML = '';
    cards.appendChild(statCard(s.total, 'Total records', true));
    cards.appendChild(statCard(s.STATE_EXCO, 'State Excos'));
    cards.appendChild(statCard(s.LGA_COORDINATOR, 'LGA Coordinators'));
    cards.appendChild(statCard(s.WARD_COORDINATOR, 'Ward Coordinators'));
    cards.appendChild(statCard(s.pendingReview, 'Pending review'));
    cards.appendChild(statCard(s.possibleDuplicates, 'Possible duplicates'));

    paused = data.applicationStatus === 'PAUSED';
    $('appStatus').textContent = 'Collection: ' + (paused ? 'PAUSED' : 'OPEN');
    $('pauseBtn').textContent = paused ? 'Resume collection' : 'Pause collection';
    renderMaster(data.master);
  }

  function pill(status) {
    var kind = status === 'VALID' ? 'ok' : (status === 'WARNING' ? 'warn' : 'bad');
    return el('span', status || 'NOT BUILT', 'pill ' + kind);
  }

  function renderMaster(m) {
    var box = $('master');
    box.innerHTML = '';
    var head = el('div', null, 'row');
    head.appendChild(el('strong', m.state + ' State'));
    head.appendChild(pill(m.status));
    box.appendChild(head);
    box.appendChild(el('p', 'LGAs: ' + m.lgas + '   Wards: ' + m.wards + '   Polling units: ' + m.pollingUnits, 'meta'));
    box.appendChild(el('p', 'Last updated: ' + (m.lastUpdated ? new Date(m.lastUpdated).toLocaleString() : 'never'), 'meta'));
    box.appendChild(el('p', 'Source: ' + (m.source || 'none') + (m.verification === 'OFFICIAL' ? ' (official)' : ' (not yet verified against INEC)'), 'meta'));
    if (m.lastImportMessage) box.appendChild(el('p', 'Last import: ' + m.lastImportMessage, 'meta'));
  }

  function bar(count, max) {
    var wrap = el('div');
    wrap.style.cssText = 'background:#F3F4F6;border-radius:4px;height:10px;min-width:60px';
    var fill = el('div');
    fill.style.cssText = 'background:#F59E0B;border-radius:4px;height:10px;width:' + (max ? Math.round(count / max * 100) : 0) + '%';
    wrap.appendChild(fill);
    return wrap;
  }

  function renderAnalytics(a) {
    var progress = $('progress');
    progress.innerHTML = '';
    var c = a.coverage;
    var wardPercent = c.wardsTotal ? Math.round(c.wardsCovered / c.wardsTotal * 100) : 0;
    var verifiedPercent = a.total ? Math.round(a.byStatus.VERIFIED / a.total * 100) : 0;
    var today = a.daily.length ? a.daily[a.daily.length - 1].count : 0;
    progress.appendChild(statCard(wardPercent + '%', 'Wards with a coordinator (' + c.wardsCovered + ' of ' + c.wardsTotal + ')', true));
    progress.appendChild(statCard(c.lgasWithCoordinator + ' / ' + c.lgasTotal, 'LGAs with an LGA coordinator'));
    progress.appendChild(statCard(today, 'Submitted today' + (a.lastSubmission ? ' (last: ' + new Date(a.lastSubmission).toLocaleTimeString() + ')' : '')));
    progress.appendChild(statCard(verifiedPercent + '%', 'Verified (' + a.byStatus.VERIFIED + ' verified, ' + a.byStatus.REJECTED + ' rejected)'));

    var daily = $('daily');
    daily.innerHTML = '';
    var max = a.daily.reduce(function (m, d) { return Math.max(m, d.count); }, 0);
    a.daily.forEach(function (d) {
      var row = el('div', null, 'row');
      row.style.cssText = 'flex-wrap:nowrap;gap:8px;margin:2px 0';
      var label = el('span', d.date.slice(5), 'meta');
      label.style.cssText = 'flex:0 0 52px;margin:0';
      var count = el('span', String(d.count), 'meta');
      count.style.cssText = 'flex:0 0 36px;margin:0;text-align:right';
      var barWrap = el('div'); barWrap.style.flex = '1 1 auto'; barWrap.appendChild(bar(d.count, max));
      row.appendChild(label); row.appendChild(barWrap); row.appendChild(count);
      daily.appendChild(row);
    });

    var table = $('lgaTable');
    table.innerHTML = '';
    var headRow = el('tr');
    ['Local government', 'Records', 'LGA coordinators', 'Ward coordinators', 'Ward coverage', ''].forEach(function (h) { headRow.appendChild(el('th', h)); });
    table.appendChild(headRow);
    a.lgas.forEach(function (l) {
      var tr = el('tr');
      tr.appendChild(el('td', l.lga));
      tr.appendChild(el('td', String(l.records)));
      tr.appendChild(el('td', String(l.lgaCoordinators)));
      tr.appendChild(el('td', String(l.wardCoordinators)));
      tr.appendChild(el('td', l.wardsCovered + ' / ' + l.wardsTotal));
      var cell = el('td'); cell.appendChild(bar(l.wardsCovered, l.wardsTotal)); tr.appendChild(cell);
      table.appendChild(tr);
    });
  }

  // ---------- records ----------
  function filters() {
    return { q: $('q').value.trim(), position: $('fPosition').value, status: $('fStatus').value,
      duplicatesOnly: $('fDup').checked, page: page, pageSize: pageSize };
  }

  function loadRecords() {
    return call('getRecords', filters()).then(function (res) {
      var table = $('records');
      table.innerHTML = '';
      if (!res.success) { banner($('dashBanner'), res.error.message, 'error'); return; }
      total = res.data.total;
      var headRow = el('tr');
      ['ID', 'Name', 'Position', 'Phone', 'LGA', 'Ward', 'Polling unit', 'Status', 'Submitted', 'Notes', ''].forEach(function (h) { headRow.appendChild(el('th', h)); });
      table.appendChild(headRow);

      if (!res.data.rows.length) {
        var empty = el('tr'); var td = el('td', 'No records found.'); td.colSpan = 11; empty.appendChild(td); table.appendChild(empty);
      }
      res.data.rows.forEach(function (r) {
        var tr = el('tr', null, r.duplicate ? 'dup' : '');
        tr.appendChild(el('td', r.recordId));
        tr.appendChild(el('td', r.name, 'wrap'));
        tr.appendChild(el('td', POSITION_LABELS[r.position] || r.position));
        tr.appendChild(el('td', r.phone));
        tr.appendChild(el('td', r.lga));
        tr.appendChild(el('td', r.ward, 'wrap'));
        tr.appendChild(el('td', r.pollingUnit + ' (' + r.pollingUnitCode + ')', 'wrap'));
        var statusCell = el('td');
        var kind = r.verificationStatus === 'VERIFIED' ? 'ok' : (r.verificationStatus === 'REJECTED' ? 'bad' : 'warn');
        statusCell.appendChild(el('span', r.verificationStatus, 'pill ' + kind));
        tr.appendChild(statusCell);
        tr.appendChild(el('td', r.submittedAt ? new Date(r.submittedAt).toLocaleString() : ''));
        tr.appendChild(el('td', r.notes, 'wrap'));

        var actions = el('td');
        [['VERIFIED', 'Verify'], ['REJECTED', 'Reject'], ['PENDING', 'Reset']].forEach(function (a) {
          if (r.verificationStatus === a[0]) return;
          var button = el('button', a[1], 'btn small');
          button.type = 'button';
          button.style.marginRight = '4px';
          button.addEventListener('click', function () {
            button.disabled = true;
            call('setVerification', { recordId: r.recordId, status: a[0] }).then(function (res) {
              if (!res.success) banner($('dashBanner'), res.error.message, 'error');
              loadRecords(); loadStats();
            });
          });
          actions.appendChild(button);
        });
        tr.appendChild(actions);
        table.appendChild(tr);
      });

      var pages = Math.max(1, Math.ceil(total / pageSize));
      $('pageInfo').textContent = 'Page ' + page + ' of ' + pages + ' (' + total + ' records)';
      $('prev').disabled = page <= 1;
      $('next').disabled = page >= pages;
    });
  }

  function loadStats() {
    return call('getDashboardStats').then(function (res) {
      if (res.success) renderStats(res.data); else banner($('dashBanner'), res.error.message, 'error');
    });
  }

  function loadAnalytics() {
    return call('getAnalytics').then(function (res) {
      if (res.success) renderAnalytics(res.data);
      else if (res.error.code !== 'UNAUTHORIZED') banner($('dashBanner'), res.error.message, 'warn');
    });
  }

  function refreshAll() {
    banner($('dashBanner'), '', 'error');
    return Promise.all([loadStats(), loadAnalytics(), loadRecords()]);
  }

  // ---------- actions ----------
  function showResult(text) {
    var box = $('result');
    box.textContent = text;
    box.hidden = !text;
  }

  function importSummary(data) {
    var r = data.report;
    if (!r) return data.message || '';
    var text = data.message + '\n\nStatus: ' + r.status + '\nSource records: ' + r.totalSource + '\nValid: ' + r.valid +
      '   Invalid: ' + r.invalid + '\nDuplicates removed: ' + r.duplicates + '   Orphans: ' + r.orphans +
      '\nFinal master records: ' + r.finalMaster + '\nLGAs: ' + r.lgas + '   Wards: ' + r.wards + '   Polling units: ' + r.pollingUnits;
    if (data.topIssues && data.topIssues.length) {
      text += '\n\nTop issues:\n' + data.topIssues.slice(0, 8).map(function (i) { return '- [' + i.severity + '] ' + i.message; }).join('\n');
    }
    return text;
  }

  function runAction(button, label, action, busyText, onDone) {
    button.addEventListener('click', function () {
      if (button.disabled) return;
      var original = button.textContent;
      button.disabled = true;
      button.textContent = busyText;
      showResult('');
      call(action, {}, 330000).then(function (res) {
        button.disabled = false;
        button.textContent = original;
        if (!res.success) { showResult(res.error.message); return; }
        onDone(res.data);
        refreshAll();
      });
    });
  }

  function download(filename, content) {
    var blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
  }

  function setupExports() {
    var box = $('exports');
    EXPORTS.forEach(function (e) {
      var button = el('button', e[1], 'btn');
      button.type = 'button';
      button.addEventListener('click', function () {
        button.disabled = true;
        call('exportRecords', { type: e[0] }, 120000).then(function (res) {
          button.disabled = false;
          if (!res.success) { showResult(res.error.message); return; }
          download(res.data.filename, res.data.content);
          showResult('Exported ' + res.data.rowCount + ' rows to ' + res.data.filename);
        });
      });
      box.appendChild(button);
    });
  }

  function renderAudit(entries) {
    $('auditWrap').hidden = false;
    var table = $('audit');
    table.innerHTML = '';
    var headRow = el('tr');
    ['Time', 'User', 'Action', 'Record', 'Old', 'New', 'Result'].forEach(function (h) { headRow.appendChild(el('th', h)); });
    table.appendChild(headRow);
    entries.forEach(function (e) {
      var tr = el('tr');
      [new Date(e.timestamp).toLocaleString(), e.user, e.action, e.recordId, e.oldValue, e.newValue, e.result].forEach(function (v) { tr.appendChild(el('td', v)); });
      table.appendChild(tr);
    });
  }

  // ---------- wire up ----------
  $('loginForm').addEventListener('submit', function (event) {
    event.preventDefault();
    var code = $('passcode').value.trim();
    if (code) signIn(code);
  });
  $('signOut').addEventListener('click', function () { signOut(''); });
  $('refreshBtn').addEventListener('click', refreshAll);
  $('pauseBtn').addEventListener('click', function () {
    var button = $('pauseBtn');
    button.disabled = true;
    call('setApplicationStatus', { status: paused ? 'LIVE' : 'PAUSED' }).then(function () { button.disabled = false; loadStats(); });
  });

  runAction($('buildBtn'), 'build', 'buildMasterList', 'Building master list... (up to 3 minutes)', function (d) { showResult(importSummary(d)); });
  runAction($('validateBtn'), 'validate', 'validateMasterList', 'Validating...', function (d) { showResult(importSummary(d)); });
  runAction($('auditBtn'), 'audit', 'getAuditLog', 'Loading...', renderAudit);
  setupExports();

  var positionFilter = $('fPosition');
  Object.keys(POSITION_LABELS).forEach(function (key) {
    var option = el('option', POSITION_LABELS[key]); option.value = key; positionFilter.appendChild(option);
  });
  ['fPosition', 'fStatus', 'fDup'].forEach(function (id) { $(id).addEventListener('change', function () { page = 1; loadRecords(); }); });
  $('q').addEventListener('input', function () { clearTimeout(searchTimer); searchTimer = setTimeout(function () { page = 1; loadRecords(); }, 400); });
  $('prev').addEventListener('click', function () { if (page > 1) { page--; loadRecords(); } });
  $('next').addEventListener('click', function () { page++; loadRecords(); });

  var saved = stored();
  if (saved) signIn(saved); else showLogin('');
})();
