(function () {
  'use strict';

  var db = window.TK27_DB;
  var $ = function (id) { return document.getElementById(id); };
  var state = {
    user: null, session: null, page: 1, pageSize: 15, total: 0,
    realtime: null, searchTimer: null, reloadTimer: null,
    paused: false, loading: false, pendingReload: false,
    selected: new Set(), currentRows: [], coverageLoaded: false,
    lgaCoverage: [], selectedLga: null, wardRows: [], recentDays: [],
    bound: false
  };
  var POSITIONS = {
    STATE_EXCO: 'State Exco',
    LGA_COORDINATOR: 'LGA Coordinator',
    WARD_COORDINATOR: 'Ward Coordinator'
  };
  var FIELDS = ['q', 'fPosition', 'fStatus', 'fLga', 'fWard', 'fFrom', 'fTo', 'fDup'];
  var RECORD_FIELDS = 'record_id,state,state_code,name,position,phone,lga,lga_code,ward,ward_code,polling_unit,polling_unit_code,verification_status,duplicate_flag,submitted_at,updated_at,submitted_by,notes';

  function node(tag, text, className) {
    var el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = String(text);
    if (className) el.className = className;
    return el;
  }
  function fmtNumber(value) { return Number(value || 0).toLocaleString(); }
  function niceDate(value, withTime) {
    if (!value) return '—';
    var date = new Date(value);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-GB', withTime
      ? { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }
      : { dateStyle: 'medium', timeZone: 'Africa/Lagos' });
  }
  function dateLabel(dateString) {
    if (!dateString) return '—';
    var parts = String(dateString).split('-').map(Number);
    if (parts.length !== 3 || parts.some(function (part) { return !part; })) return String(dateString);
    var date = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    var today = new Date();
    var todayKey = localDateKey(today);
    var yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 12);
    var yesterdayKey = localDateKey(yesterday);
    var key = String(dateString);
    var label = date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'Africa/Lagos' });
    if (key === todayKey) return label + ' · Today';
    if (key === yesterdayKey) return label + ' · Yesterday';
    return label;
  }
  function localDateKey(date) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    var out = {};
    parts.forEach(function (part) { out[part.type] = part.value; });
    return out.year + '-' + out.month + '-' + out.day;
  }
  function showBanner(target, message, kind) {
    var el = $(target);
    el.className = 'banner ' + (kind || 'error');
    el.textContent = message || '';
    el.hidden = !message;
  }
  function showToast(message) {
    var el = $('toast');
    el.textContent = message || '';
    el.hidden = !message;
    if (message) {
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(function () { el.hidden = true; }, 4200);
    }
  }
  function statusClass(status) {
    return status === 'VERIFIED' ? 'ok' : status === 'REJECTED' ? 'bad' : 'warn';
  }
  function statusLabel(status) { return String(status || 'PENDING').replace(/_/g, ' '); }
  function statusPill(text, kind) { return node('span', text, 'pill ' + (kind || '')); }
  function scrollToElement(id) { $(id).scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function hideLogin() { $('loginCard').hidden = true; $('dashboard').hidden = false; }
  function showLogin(message) {
    $('loginCard').hidden = false;
    $('dashboard').hidden = true;
    if (message) showBanner('loginBanner', message, 'error');
  }

  async function verifyAdmin(user) {
    if (!user) return false;
    var result = await db.from('admin_users').select('user_id,active').eq('user_id', user.id).maybeSingle();
    return !result.error && !!result.data && result.data.active === true;
  }
  async function signIn(event) {
    event.preventDefault();
    if (!window.TK27_DB_READY || !db) {
      showBanner('loginBanner', 'Supabase has not been configured in frontend/config.js.', 'error');
      return;
    }
    var button = $('loginBtn');
    button.disabled = true;
    button.textContent = 'Checking account…';
    try {
      var result = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
      if (result.error) throw result.error;
      if (!(await verifyAdmin(result.data.user))) {
        await db.auth.signOut();
        throw new Error('This account is not on the active TK27 administrator list.');
      }
      state.user = result.data.user;
      state.session = result.data.session;
      $('password').value = '';
      showBanner('loginBanner', '', 'error');
      await startDashboard();
    } catch (error) {
      showBanner('loginBanner', error.message || 'Sign-in failed. Check your account details.', 'error');
    } finally {
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  }
  async function signOut() {
    if (state.realtime) { await db.removeChannel(state.realtime); state.realtime = null; }
    await db.auth.signOut();
    state.user = null;
    state.session = null;
    showLogin('You have signed out.');
  }

  async function loadStats() {
    var results = await Promise.all([
      db.rpc('admin_dashboard_stats'),
      db.rpc('admin_coverage_summary'),
      db.rpc('admin_recent_activity_3d')
    ]);
    results.forEach(function (result) { if (result.error) throw result.error; });
    var stats = results[0].data || {};
    var coverage = results[1].data || {};
    var days = results[2].data || [];
    state.recentDays = days;

    $('totalRecordsValue').textContent = fmtNumber(stats.total);
    $('wardCoverageValue').textContent = Number(coverage.submissionCoveragePercent || 0).toFixed(1) + '%';
    $('wardCoverageNote').textContent = fmtNumber(coverage.coveredWards) + ' of ' + fmtNumber(coverage.officialWards) + ' official wards · View analysis';
    $('recentSubmissionsValue').textContent = fmtNumber(days.reduce(function (sum, day) { return sum + Number(day.submissions || 0); }, 0));
    $('pendingCount').textContent = fmtNumber(stats.PENDING);
    $('verifiedCount').textContent = fmtNumber(stats.VERIFIED);
    $('rejectedCount').textContent = fmtNumber(stats.REJECTED);
    $('duplicateCount').textContent = fmtNumber(stats.duplicates);
    $('masterCount').textContent = fmtNumber(stats.masterRows);
    $('syncCount').textContent = fmtNumber(stats.syncPending);
    $('masterPill').textContent = Number(stats.masterRows || 0) > 0 ? 'Geography ready' : 'Geography not imported';
    renderRecentActivity(days);
    renderCoverageSummary(coverage);
  }
  function renderCoverageSummary(coverage) {
    $('officialWardsValue').textContent = fmtNumber(coverage.officialWards);
    $('coveredWardsValue').textContent = fmtNumber(coverage.coveredWards);
    $('verifiedCoveredWardsValue').textContent = fmtNumber(coverage.verifiedCoveredWards);
    $('verifiedCoverageValue').textContent = Number(coverage.verifiedCoveragePercent || 0).toFixed(1) + '%';
    $('uncoveredWardsValue').textContent = fmtNumber(coverage.uncoveredWards);
    $('pollingUnitCoverageValue').textContent = Number(coverage.pollingUnitCoveragePercent || 0).toFixed(1) + '%';
  }
  async function loadCollectionStatus() {
    var result = await db.rpc('public_app_status');
    if (result.error) throw result.error;
    state.paused = !!(result.data && result.data.paused);
    $('pauseBtn').textContent = state.paused ? 'Resume collection' : 'Pause collection';
    $('collectionPill').textContent = state.paused ? 'Collection paused' : 'Collection open';
    $('collectionPill').className = 'pill ' + (state.paused ? 'warn' : '');
  }
  async function loadLgas() {
    var result = await db.rpc('get_public_lgas');
    if (result.error) throw result.error;
    var select = $('fLga');
    select.innerHTML = '';
    select.appendChild(new Option('All LGAs', ''));
    (result.data || []).forEach(function (lga) { select.appendChild(new Option(lga.lga, lga.lga_code)); });
  }
  async function loadWards() {
    var select = $('fWard');
    select.innerHTML = '';
    select.appendChild(new Option('All wards', ''));
    if (!$('fLga').value) { select.disabled = true; return; }
    select.disabled = true;
    var result = await db.rpc('get_public_wards', { p_lga_code: $('fLga').value });
    if (result.error) throw result.error;
    (result.data || []).forEach(function (ward) { select.appendChild(new Option(ward.ward, ward.ward_code)); });
    select.disabled = false;
  }

  function filterValues() {
    return {
      q: $('q').value.trim(), position: $('fPosition').value, status: $('fStatus').value,
      lga: $('fLga').value, ward: $('fWard').value, from: $('fFrom').value,
      to: $('fTo').value, duplicates: $('fDup').checked
    };
  }
  function buildQuery(columns, withCount) {
    var f = filterValues();
    var query = db.from('coordinator_records').select(columns || RECORD_FIELDS, withCount ? { count: 'exact' } : undefined).order('submitted_at', { ascending: false });
    if (f.position) query = query.eq('position', f.position);
    if (f.status) query = query.eq('verification_status', f.status);
    if (f.lga) query = query.eq('lga_code', f.lga);
    if (f.ward) query = query.eq('ward_code', f.ward);
    if (f.duplicates) query = query.eq('duplicate_flag', true);
    if (f.from) query = query.gte('submitted_at', f.from + 'T00:00:00+01:00');
    if (f.to) query = query.lte('submitted_at', f.to + 'T23:59:59.999+01:00');
    if (f.q) {
      var text = f.q.replace(/[,%()*.\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
      if (text) query = query.or('record_id.ilike.%' + text + '%,name.ilike.%' + text + '%,phone.ilike.%' + text + '%,lga.ilike.%' + text + '%,ward.ilike.%' + text + '%,polling_unit.ilike.%' + text + '%');
    }
    return query;
  }
  function activeFilterChips() {
    var f = filterValues();
    var wrap = $('activeChips');
    wrap.innerHTML = '';
    var chips = [];
    if (f.q) chips.push(['Search: ' + f.q, 'q']);
    if (f.position) chips.push([POSITIONS[f.position] || f.position, 'fPosition']);
    if (f.status) chips.push([f.status, 'fStatus']);
    if (f.lga) chips.push([ $('fLga').selectedOptions[0].textContent, 'fLga' ]);
    if (f.ward) chips.push([ $('fWard').selectedOptions[0].textContent, 'fWard' ]);
    if (f.from) chips.push(['From ' + f.from, 'fFrom']);
    if (f.to) chips.push(['To ' + f.to, 'fTo']);
    if (f.duplicates) chips.push(['Possible duplicates', 'fDup']);
    chips.forEach(function (chip) {
      var button = node('button', chip[0] + ' ×', 'filter-chip');
      button.type = 'button';
      button.title = 'Remove filter';
      button.addEventListener('click', function () {
        var target = $(chip[1]);
        if (chip[1] === 'fDup') target.checked = false;
        else target.value = '';
        state.selected.clear();
        syncSelectionUI();
        if (chip[1] === 'fLga') { target.dispatchEvent(new Event('change')); return; }
        state.page = 1;
        loadRecords();
      });
      wrap.appendChild(button);
    });
    var advancedCount = [f.ward, f.from, f.to, f.duplicates].filter(Boolean).length;
    $('advancedSummary').textContent = advancedCount ? advancedCount + ' advanced filter' + (advancedCount === 1 ? '' : 's') + ' active' : '';
  }

  function renderRecordRow(record) {
    var article = node('article', null, 'record-item' + (record.duplicate_flag ? ' duplicate-row' : '') + (state.selected.has(record.record_id) ? ' row-selected' : ''));
    article.dataset.recordId = record.record_id;
    var selectWrap = node('div', null, 'record-select-cell');
    var checkbox = node('input');
    checkbox.type = 'checkbox'; checkbox.className = 'record-select'; checkbox.checked = state.selected.has(record.record_id);
    checkbox.setAttribute('aria-label', 'Select record ' + record.record_id);
    checkbox.addEventListener('change', function () {
      if (checkbox.checked) state.selected.add(record.record_id); else state.selected.delete(record.record_id);
      article.classList.toggle('row-selected', checkbox.checked);
      syncSelectionUI();
    });
    selectWrap.appendChild(checkbox);

    var main = node('div', null, 'record-main');
    main.appendChild(node('strong', record.name || 'Unnamed coordinator', 'record-person-name'));
    main.appendChild(node('span', POSITIONS[record.position] || record.position || '—', 'record-position'));
    main.appendChild(node('span', record.record_id, 'record-ref'));
    if (record.duplicate_flag) main.appendChild(node('span', 'Possible duplicate', 'duplicate-note'));

    var location = node('div', null, 'record-location');
    location.appendChild(node('strong', record.lga || '—', 'location-main'));
    location.appendChild(node('span', record.ward || '—', 'table-subtext'));
    location.appendChild(node('span', record.polling_unit || '—', 'table-subtext'));

    var meta = node('div', null, 'record-meta');
    meta.appendChild(node('span', record.phone || '—', 'record-phone'));
    meta.appendChild(node('span', niceDate(record.submitted_at, true), 'table-subtext'));

    var controls = node('div', null, 'record-controls');
    controls.appendChild(statusPill(statusLabel(record.verification_status), statusClass(record.verification_status)));
    var view = node('button', 'Details', 'btn micro');
    view.type = 'button'; view.addEventListener('click', function () { openRecordDetails(record); });
    controls.appendChild(view);
    article.appendChild(selectWrap); article.appendChild(main); article.appendChild(location); article.appendChild(meta); article.appendChild(controls);
    return article;
  }
  async function loadRecords() {
    if (state.loading) { state.pendingReload = true; return; }
    state.loading = true;
    activeFilterChips();
    $('recordRows').innerHTML = '';
    $('recordRows').appendChild(emptyState('Loading records…'));
    try {
      var start = (state.page - 1) * state.pageSize;
      var result = await buildQuery(RECORD_FIELDS, true).range(start, start + state.pageSize - 1);
      if (result.error) throw result.error;
      state.total = result.count || 0;
      state.currentRows = result.data || [];
      $('recordRows').innerHTML = '';
      if (!state.currentRows.length) $('recordRows').appendChild(emptyState('No records match these filters. Try removing a filter.'));
      else state.currentRows.forEach(function (record) { $('recordRows').appendChild(renderRecordRow(record)); });
      syncSelectionUI();
      var first = state.total ? start + 1 : 0;
      var last = Math.min(start + state.pageSize, state.total);
      $('resultSummary').textContent = first + '–' + last + ' of ' + state.total.toLocaleString() + ' records';
      $('pageInfo').textContent = 'Page ' + state.page + ' of ' + Math.max(1, Math.ceil(state.total / state.pageSize));
      $('prev').disabled = state.page <= 1;
      $('next').disabled = start + state.pageSize >= state.total;
      $('lastUpdated').textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });
    } catch (error) {
      console.error('[TK27] Record list load failed', { code: error && error.code, message: error && error.message });
      showBanner('dashBanner', 'Unable to load records. Check administrator access and the Supabase connection, then refresh.', 'error');
      $('recordRows').innerHTML = '';
      $('recordRows').appendChild(emptyState('Records could not be loaded.'));
    } finally {
      state.loading = false;
      if (state.pendingReload) {
        state.pendingReload = false;
        setTimeout(function () { Promise.all([loadStats(), loadRecords()]).catch(function (error) { console.error(error); }); }, 0);
      }
    }
  }
  function emptyState(message) { return node('div', message, 'empty-state'); }
  function syncSelectionUI() {
    var count = state.selected.size;
    $('bulkToolbar').hidden = count === 0;
    $('selectedCount').textContent = count + ' record' + (count === 1 ? '' : 's') + ' selected';
    var visible = state.currentRows || [];
    var selectedVisible = visible.filter(function (record) { return state.selected.has(record.record_id); }).length;
    var all = $('selectAllPage');
    all.checked = visible.length > 0 && selectedVisible === visible.length;
    all.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
    all.disabled = visible.length === 0;
    document.querySelectorAll('#recordRows [data-record-id]').forEach(function (row) {
      var selected = state.selected.has(row.dataset.recordId);
      row.classList.toggle('row-selected', selected);
      var input = row.querySelector('.record-select');
      if (input) input.checked = selected;
    });
  }
  function selectCurrentPage(checked) {
    (state.currentRows || []).forEach(function (record) {
      if (checked) state.selected.add(record.record_id); else state.selected.delete(record.record_id);
    });
    syncSelectionUI();
  }
  async function bulkAction(action) {
    var ids = Array.from(state.selected);
    if (!ids.length) { showToast('Select at least one record first.'); return; }
    if (ids.length > 500) { showBanner('dashBanner', 'Bulk actions are limited to 500 records. Process a smaller selection.', 'warn'); return; }
    var label = action === 'VERIFY' ? 'verify' : action === 'REJECT' ? 'reject' : 'permanently delete';
    var prompt = action === 'DELETE'
      ? 'Permanently delete ' + ids.length + ' selected record(s)? This cannot be undone.'
      : 'Mark ' + ids.length + ' selected record(s) as ' + (action === 'VERIFY' ? 'verified' : 'rejected') + '?';
    if (!window.confirm(prompt)) return;
    var buttonId = action === 'VERIFY' ? 'bulkVerify' : action === 'REJECT' ? 'bulkReject' : 'bulkDelete';
    var actionButton = $(buttonId); var oldText = actionButton.textContent;
    ['bulkVerify', 'bulkReject', 'bulkDelete', 'clearSelection', 'selectAllPage'].forEach(function (id) { $(id).disabled = true; });
    actionButton.textContent = 'Processing…';
    try {
      var result = await db.rpc('admin_bulk_record_action', { p_record_ids: ids, p_action: action });
      if (result.error) throw result.error;
      var data = result.data || {};
      state.selected.clear();
      showToast(fmtNumber(data.affected_count) + ' record(s) ' + (action === 'VERIFY' ? 'verified' : action === 'REJECT' ? 'rejected' : 'deleted') + '.');
      await Promise.all([loadStats(), loadRecords()]);
      if (!$('auditWrap').hidden) await loadAudit();
    } catch (error) {
      console.error('[TK27] Bulk record action failed', { action: action, code: error && error.code, message: error && error.message });
      if (error && error.code === 'PGRST202') showBanner('dashBanner', 'The bulk-action database function is not installed. Apply migration 202610220002_admin_bulk_actions.sql.', 'error');
      else showBanner('dashBanner', 'Could not ' + label + ' the selected records. No success was reported; the selection has been retained.', 'error');
    } finally {
      ['bulkVerify', 'bulkReject', 'bulkDelete', 'clearSelection', 'selectAllPage'].forEach(function (id) { $(id).disabled = false; });
      actionButton.textContent = oldText;
      syncSelectionUI();
    }
  }
  async function updateStatus(recordId, status, button) {
    button.disabled = true;
    var oldText = button.textContent;
    button.textContent = 'Saving…';
    try {
      var result = await db.from('coordinator_records').update({ verification_status: status }).eq('record_id', recordId).select('record_id').single();
      if (result.error) throw result.error;
      showToast('Record ' + status.toLowerCase() + '.');
      $('recordDialog').close();
      await Promise.all([loadStats(), loadRecords()]);
      if (!$('coverageWorkspace').hidden) await loadCoverageAnalysis(true);
    } catch (error) {
      console.error('[TK27] Record status update failed', { code: error && error.code, message: error && error.message });
      showBanner('dashBanner', 'Could not update the record. Check administrator permissions and retry.', 'error');
    } finally { button.disabled = false; button.textContent = oldText; }
  }
  function openRecordDetails(record) {
    $('recordDialogTitle').textContent = record.name || record.record_id;
    var content = $('recordDialogContent'); content.innerHTML = '';
    var fields = [
      ['Reference', record.record_id], ['Full name', record.name], ['Position', POSITIONS[record.position] || record.position],
      ['Phone number', record.phone], ['Local government', record.lga], ['Ward', record.ward],
      ['Polling unit', record.polling_unit], ['Polling unit code', record.polling_unit_code],
      ['Submitted', niceDate(record.submitted_at, true)], ['Last updated', niceDate(record.updated_at, true)],
      ['Verification', statusLabel(record.verification_status)], ['Possible duplicate', record.duplicate_flag ? 'Yes' : 'No'],
      ['Notes', record.notes || '—']
    ];
    fields.forEach(function (field) {
      var row = node('div', null, 'detail-pair');
      row.appendChild(node('dt', field[0])); row.appendChild(node('dd', field[1] == null || field[1] === '' ? '—' : field[1])); content.appendChild(row);
    });
    var actions = $('recordDialogActions'); actions.innerHTML = '';
    if (record.verification_status !== 'VERIFIED') {
      var verify = node('button', 'Verify record', 'btn small'); verify.type = 'button';
      verify.addEventListener('click', function () { updateStatus(record.record_id, 'VERIFIED', verify); }); actions.appendChild(verify);
    }
    if (record.verification_status !== 'REJECTED') {
      var reject = node('button', 'Reject record', 'btn small'); reject.type = 'button';
      reject.addEventListener('click', function () { if (window.confirm('Reject this coordinator record?')) updateStatus(record.record_id, 'REJECTED', reject); }); actions.appendChild(reject);
    }
    var close = node('button', 'Close', 'btn small'); close.type = 'button'; close.addEventListener('click', function () { $('recordDialog').close(); }); actions.appendChild(close);
    var dialog = $('recordDialog');
    if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', 'open');
  }

  function clearFilters() {
    FIELDS.forEach(function (id) { if (id === 'fDup') $(id).checked = false; else $(id).value = ''; });
    $('fWard').innerHTML = ''; $('fWard').appendChild(new Option('All wards', '')); $('fWard').disabled = true;
    state.selected.clear(); state.page = 1; syncSelectionUI();
  }
  function applyQuickFilter(filter) {
    clearFilters();
    if (filter === 'duplicates') $('fDup').checked = true;
    else if (filter && filter.indexOf('status:') === 0) $('fStatus').value = filter.split(':')[1];
    else if (filter && filter.indexOf('position:') === 0) $('fPosition').value = filter.split(':')[1];
    loadRecords(); scrollToElement('recordsSection');
  }
  function applyDateFilter(date) {
    clearFilters(); $('fFrom').value = date; $('fTo').value = date;
    $('advancedFilters').hidden = false; $('toggleAdvanced').setAttribute('aria-expanded', 'true');
    state.page = 1; loadRecords(); scrollToElement('recordsSection');
  }

  async function openCoverage() {
    $('coverageWorkspace').hidden = false;
    scrollToElement('coverageWorkspace');
    if (!state.coverageLoaded) await loadCoverageAnalysis(false);
  }
  async function closeCoverage() {
    $('coverageWorkspace').hidden = true;
    scrollToElement('dashboard');
  }
  async function loadCoverageAnalysis(keepSelection) {
    var previousLga = keepSelection ? state.selectedLga : null;
    $('coverageBars').innerHTML = '';
    $('coverageBars').appendChild(emptyState('Loading LGA coverage…'));
    try {
      var result = await db.rpc('admin_lga_coverage');
      if (result.error) throw result.error;
      state.lgaCoverage = result.data || [];
      state.coverageLoaded = true;
      renderCoverageBars();
      if (previousLga && state.lgaCoverage.some(function (row) { return row.lga_code === previousLga; })) {
        await loadWardCoverage(previousLga);
      } else {
        state.selectedLga = null;
        $('wardDetailTitle').textContent = 'Ward detail';
        $('wardDetailSummary').textContent = 'Select a local government to inspect its wards.';
        $('wardCoverageRows').innerHTML = '';
        $('wardCoverageRows').appendChild(emptyState('Choose an LGA from the ranking.'));
        $('wardSearch').disabled = true; $('wardCoverageFilter').disabled = true; $('exportWardGapsBtn').disabled = true;
      }
    } catch (error) {
      console.error('[TK27] Coverage analytics failed', { code: error && error.code, message: error && error.message });
      $('coverageBars').innerHTML = '';
      $('coverageBars').appendChild(emptyState('Coverage analysis could not load. Apply migration 202610220004_admin_coverage_analytics.sql, then refresh.'));
      showBanner('dashBanner', 'Coverage analysis is not available until the analytics migration is applied and administrator permissions are verified.', 'warn');
    }
  }
  function coveragePercent(row) {
    return Number(($('coverageMetric').value === 'verified' ? row.verified_coverage_percent : row.coverage_percent) || 0);
  }
  function coverageNumerator(row) {
    return Number(($('coverageMetric').value === 'verified' ? row.verified_covered_wards : row.covered_wards) || 0);
  }
  function coverageGap(row) {
    return Math.max(0, Number(row.total_wards || 0) - coverageNumerator(row));
  }
  function sortedVisibleLgas() {
    var term = $('coverageSearch').value.trim().toLocaleLowerCase();
    var rows = state.lgaCoverage.filter(function (row) { return !term || String(row.lga || '').toLocaleLowerCase().includes(term); });
    var sort = $('coverageSort').value;
    rows.sort(function (a, b) {
      var pa = coveragePercent(a), pb = coveragePercent(b);
      var aCovered = coverageNumerator(a) > 0;
      var bCovered = coverageNumerator(b) > 0;
      // Keep every LGA with coverage above every LGA with zero coverage,
      // regardless of the selected secondary ordering. This guarantees that
      // uncovered LGAs remain at the bottom of the ranking.
      if (aCovered !== bCovered) return aCovered ? -1 : 1;
      if (sort === 'name') return String(a.lga).localeCompare(String(b.lga));
      // Default ranking: strongest coverage first, then larger covered count,
      // then name for deterministic ties. Uncovered LGAs naturally follow.
      return pb - pa || coverageNumerator(b) - coverageNumerator(a) || String(a.lga).localeCompare(String(b.lga));
    });
    return rows;
  }
  function renderCoverageBars() {
    var wrap = $('coverageBars'); wrap.innerHTML = '';
    var rows = sortedVisibleLgas();
    if (!rows.length) { wrap.appendChild(emptyState('No local governments match this search.')); return; }
    rows.forEach(function (row) {
      var button = node('button', null, 'coverage-row' + (state.selectedLga === row.lga_code ? ' selected' : ''));
      button.type = 'button'; button.setAttribute('aria-pressed', String(state.selectedLga === row.lga_code));
      var top = node('span', null, 'coverage-row-top');
      var name = node('strong', row.lga, 'coverage-lga-name');
      var metricLabel = $('coverageMetric').value === 'verified' ? 'verified' : 'submitted';
      var numerator = coverageNumerator(row);
      var values = node('span', fmtNumber(numerator) + ' / ' + fmtNumber(row.total_wards) + ' · ' + coveragePercent(row).toFixed(1) + '%', 'coverage-row-values');
      top.appendChild(name); top.appendChild(values);
      // Native progress avoids dynamic inline styles, which are blocked by the
      // deployed Content-Security-Policy. It also exposes the value accessibly.
      var track = node('progress', null, 'coverage-track');
      var percent = Math.max(0, Math.min(100, coveragePercent(row)));
      track.max = 100; track.value = percent;
      track.setAttribute('aria-label', row.lga + ' ward ' + metricLabel + ' coverage');
      track.setAttribute('aria-valuetext', fmtNumber(numerator) + ' of ' + fmtNumber(row.total_wards) + ' wards, ' + percent.toFixed(1) + ' percent');
      var foot = node('span', null, 'coverage-row-foot');
      foot.appendChild(node('span', fmtNumber(coverageGap(row)) + ' ' + (metricLabel === 'verified' ? 'not yet verified' : 'uncovered'), ''));
      foot.appendChild(node('span', Number((metricLabel === 'verified' ? row.coverage_percent : row.verified_coverage_percent) || 0).toFixed(1) + '% ' + (metricLabel === 'verified' ? 'submitted' : 'verified'), ''));
      button.appendChild(top); button.appendChild(track); button.appendChild(foot);
      button.addEventListener('click', function () { loadWardCoverage(row.lga_code); });
      wrap.appendChild(button);
    });
  }
  async function loadWardCoverage(lgaCode) {
    var lga = state.lgaCoverage.find(function (row) { return row.lga_code === lgaCode; });
    if (!lga) return;
    state.selectedLga = lgaCode;
    $('wardDetailTitle').textContent = lga.lga;
    $('wardDetailSummary').textContent = fmtNumber(lga.covered_wards) + ' of ' + fmtNumber(lga.total_wards) + ' wards covered · ' + fmtNumber(lga.uncovered_wards) + ' uncovered';
    $('wardCoverageRows').innerHTML = ''; $('wardCoverageRows').appendChild(emptyState('Loading ward details…'));
    $('wardSearch').disabled = false; $('wardCoverageFilter').disabled = false; $('exportWardGapsBtn').disabled = true;
    renderCoverageBars();
    try {
      var result = await db.rpc('admin_lga_ward_coverage', { p_lga_code: lgaCode });
      if (result.error) throw result.error;
      state.wardRows = result.data || [];
      renderWardCoverageRows();
      $('exportWardGapsBtn').disabled = state.wardRows.length === 0;
    } catch (error) {
      console.error('[TK27] Ward detail failed', { code: error && error.code, message: error && error.message });
      $('wardCoverageRows').innerHTML = ''; $('wardCoverageRows').appendChild(emptyState('Ward details could not be loaded. Check the coverage migration and refresh.'));
    }
  }
  function filteredWardRows() {
    var term = $('wardSearch').value.trim().toLocaleLowerCase();
    var filter = $('wardCoverageFilter').value;
    return state.wardRows.filter(function (ward) {
      if (term && !String(ward.ward || '').toLocaleLowerCase().includes(term) && !String(ward.ward_code || '').toLocaleLowerCase().includes(term)) return false;
      if (filter !== 'ALL' && ward.coverage_status !== filter) return false;
      return true;
    }).sort(function (a, b) {
      var order = { UNCOVERED: 0, COVERED: 1, VERIFIED: 2 };
      return order[a.coverage_status] - order[b.coverage_status] || String(a.ward).localeCompare(String(b.ward));
    });
  }
  function renderWardCoverageRows() {
    var wrap = $('wardCoverageRows'); wrap.innerHTML = '';
    var rows = filteredWardRows();
    if (!rows.length) { wrap.appendChild(emptyState('No wards match this filter.')); return; }
    rows.forEach(function (ward) {
      var item = node('article', null, 'ward-coverage-row');
      var main = node('div', null, 'ward-coverage-main');
      main.appendChild(node('strong', ward.ward, ''));
      main.appendChild(node('span', ward.ward_code + ' · ' + fmtNumber(ward.represented_polling_units) + ' of ' + fmtNumber(ward.total_polling_units) + ' polling units represented', 'table-subtext'));
      var meta = node('div', null, 'ward-coverage-meta');
      meta.appendChild(statusPill(ward.coverage_status === 'UNCOVERED' ? 'Uncovered' : ward.coverage_status === 'VERIFIED' ? 'Verified' : 'Submitted', statusClass(ward.coverage_status === 'VERIFIED' ? 'VERIFIED' : ward.coverage_status === 'COVERED' ? 'PENDING' : 'REJECTED')));
      meta.appendChild(node('span', fmtNumber(ward.coordinator_records) + ' records', 'table-subtext'));
      if (ward.latest_submission_at) meta.appendChild(node('span', niceDate(ward.latest_submission_at, false), 'table-subtext'));
      item.appendChild(main); item.appendChild(meta); wrap.appendChild(item);
    });
  }
  function renderRecentActivity(days) {
    var wrap = $('activityDays'); wrap.innerHTML = '';
    if (!days || !days.length) { wrap.appendChild(emptyState('No daily activity is available.')); return; }
    days.slice().sort(function (a, b) { return String(b.activity_date).localeCompare(String(a.activity_date)); }).forEach(function (day) {
      var button = node('button', null, 'activity-day'); button.type = 'button'; button.dataset.date = day.activity_date;
      var date = node('span', dateLabel(day.activity_date), 'activity-date');
      var count = node('strong', fmtNumber(day.submissions), 'activity-count');
      var details = node('span', null, 'activity-detail');
      details.appendChild(node('span', fmtNumber(day.newly_covered_wards) + ' newly covered wards', ''));
      details.appendChild(node('span', fmtNumber(day.verified_changes) + ' verified · ' + fmtNumber(day.rejected_changes) + ' rejected', ''));
      button.appendChild(date); button.appendChild(count); button.appendChild(node('span', 'submissions', 'activity-count-label')); button.appendChild(details);
      button.addEventListener('click', function () { applyDateFilter(day.activity_date); });
      wrap.appendChild(button);
    });
  }

  function csvSafe(value) {
    var text = String(value == null ? '' : value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function downloadCsv(filename, columns, rows) {
    var lines = [columns.map(function (column) { return csvSafe(column[1]); }).join(',')];
    rows.forEach(function (row) { lines.push(columns.map(function (column) { return csvSafe(row[column[0]]); }).join(',')); });
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob); var link = node('a'); link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  async function exportCsv() {
    var button = $('exportBtn'); button.disabled = true; button.textContent = 'Preparing download…';
    try {
      var rows = [], offset = 0, batch = 1000;
      while (true) {
        var result = await buildQuery(RECORD_FIELDS, false).range(offset, offset + batch - 1);
        if (result.error) throw result.error;
        rows = rows.concat(result.data || []);
        if (!result.data || result.data.length < batch) break;
        offset += batch;
      }
      var columns = [
        ['record_id','Record ID'],['state','State'],['state_code','State code'],['name','Name'],['position','Position'],
        ['phone','Phone'],['lga','LGA'],['lga_code','LGA code'],['ward','Ward'],['ward_code','Ward code'],
        ['polling_unit','Polling unit'],['polling_unit_code','Polling unit code'],['verification_status','Verification status'],
        ['duplicate_flag','Possible duplicate'],['submitted_at','Submitted at'],['updated_at','Updated at'],['submitted_by','Submitted by'],['notes','Notes']
      ];
      downloadCsv('tk27-coordinator-records-' + localDateKey(new Date()) + '.csv', columns, rows);
      showToast('CSV exported: ' + fmtNumber(rows.length) + ' matching record(s).');
    } catch (error) {
      console.error('[TK27] Records export failed', { code: error && error.code, message: error && error.message });
      showBanner('dashBanner', 'Export failed. Check your administrator access and retry.', 'error');
    } finally { button.disabled = false; button.textContent = 'Download submitted data (CSV)'; }
  }
  function exportCoverageCsv() {
    var rows = sortedVisibleLgas();
    var cols = [
      ['lga','LGA'],['lga_code','LGA code'],['total_wards','Official wards'],['covered_wards','Covered wards'],
      ['uncovered_wards','Uncovered wards'],['coverage_percent','Submission coverage percent'],
      ['verified_covered_wards','Verified covered wards'],['verified_coverage_percent','Verified coverage percent'],
      ['total_polling_units','Official polling units'],['represented_polling_units','Represented polling units']
    ];
    downloadCsv('tk27-ward-coverage-' + localDateKey(new Date()) + '.csv', cols, rows);
    showToast('Coverage export prepared for ' + rows.length + ' LGA(s).');
  }
  function exportWardCsv() {
    if (!state.selectedLga || !state.wardRows.length) return;
    var current = filteredWardRows();
    var cols = [
      ['lga_code','LGA code'],['ward_code','Ward code'],['ward','Ward'],['coverage_status','Coverage status'],
      ['total_polling_units','Official polling units'],['represented_polling_units','Represented polling units'],
      ['coordinator_records','Non-rejected coordinator records'],['verified_coordinator_records','Verified coordinator records'],['latest_submission_at','Latest submission']
    ];
    downloadCsv('tk27-ward-details-' + state.selectedLga + '-' + localDateKey(new Date()) + '.csv', cols, current);
    showToast('Ward coverage export prepared for ' + current.length + ' ward(s).');
  }
  async function retrySheetSync() {
    var button = $('retrySyncBtn'); button.disabled = true; button.textContent = 'Retrying…';
    try {
      var result = await db.functions.invoke('sync-google-sheet', { body: { action: 'retry' } });
      if (result.error) throw result.error;
      var data = result.data || {};
      showToast('Sheet sync retry finished. Synced: ' + fmtNumber(data.synced) + ', failed: ' + fmtNumber(data.failed) + '.');
      await loadStats();
    } catch (error) {
      console.error('[TK27] Sheet sync retry failed', { code: error && error.code, message: error && error.message });
      showBanner('dashBanner', 'Could not retry Sheet sync. Check Edge Function secrets and the Apps Script receiver.', 'error');
    } finally { button.disabled = false; button.textContent = 'Retry Sheet sync'; }
  }
  async function loadAudit() {
    var result = await db.from('audit_log').select('created_at,actor_label,action,record_id,result').order('created_at', { ascending: false }).limit(100);
    if (result.error) throw result.error;
    var body = $('auditRows'); body.innerHTML = '';
    if (!result.data || !result.data.length) {
      var tr = node('tr'); var td = node('td', 'No activity has been recorded yet.', 'empty-cell'); td.colSpan = 4; tr.appendChild(td); body.appendChild(tr); return;
    }
    result.data.forEach(function (entry) {
      var row = node('tr');
      [niceDate(entry.created_at, true), entry.action, entry.record_id || '—', entry.actor_label || 'system'].forEach(function (value) { row.appendChild(node('td', value)); });
      body.appendChild(row);
    });
  }
  async function pauseToggle() {
    var button = $('pauseBtn'); button.disabled = true;
    try {
      var newStatus = state.paused ? 'LIVE' : 'PAUSED';
      var result = await db.rpc('set_collection_status', { p_status: newStatus });
      if (result.error) throw result.error;
      await loadCollectionStatus();
      showToast(state.paused ? 'Collection paused.' : 'Collection resumed.');
    } catch (error) {
      console.error('[TK27] Collection status change failed', { code: error && error.code, message: error && error.message });
      showBanner('dashBanner', 'Could not change collection status. Check administrator permissions and retry.', 'error');
    } finally { button.disabled = false; }
  }
  function subscribeRealtime() {
    if (state.realtime) db.removeChannel(state.realtime);
    state.realtime = db.channel('tk27-coordinator-updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coordinator_records' }, function () {
        clearTimeout(state.reloadTimer);
        state.reloadTimer = setTimeout(function () {
          var jobs = [loadStats(), loadRecords()];
          if (!$('coverageWorkspace').hidden) jobs.push(loadCoverageAnalysis(true));
          Promise.all(jobs).catch(function (error) { console.error('[TK27] Background refresh failed', error); });
        }, 180);
      })
      .subscribe(function (status) {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          showBanner('dashBanner', 'Automatic updates are interrupted. Use Refresh while the connection is restored.', 'warn');
        } else if (status === 'SUBSCRIBED' && $('dashBanner').textContent.indexOf('Automatic updates are interrupted') === 0) {
          showBanner('dashBanner', '', 'warn');
        }
      });
  }
  async function refreshAll() {
    var button = $('refreshBtn'); button.disabled = true;
    try {
      var jobs = [loadStats(), loadRecords(), loadCollectionStatus()];
      if (!$('coverageWorkspace').hidden) jobs.push(loadCoverageAnalysis(true));
      await Promise.all(jobs);
      showBanner('dashBanner', '', 'error');
      showToast('Dashboard refreshed.');
    } catch (error) {
      console.error('[TK27] Dashboard refresh failed', { code: error && error.code, message: error && error.message });
      showBanner('dashBanner', 'Some dashboard data could not be refreshed. Check database permissions and migrations.', 'error');
    } finally { button.disabled = false; }
  }

  function bindEvents() {
    if (state.bound) return;
    state.bound = true;
    $('selectAllPage').addEventListener('change', function () { selectCurrentPage($('selectAllPage').checked); });
    $('bulkVerify').addEventListener('click', function () { bulkAction('VERIFY'); });
    $('bulkReject').addEventListener('click', function () { bulkAction('REJECT'); });
    $('bulkDelete').addEventListener('click', function () { bulkAction('DELETE'); });
    $('clearSelection').addEventListener('click', function () { state.selected.clear(); syncSelectionUI(); });
    ['fPosition','fStatus','fLga','fWard','fFrom','fTo','fDup'].forEach(function (id) {
      $(id).addEventListener('change', async function () {
        state.selected.clear(); state.page = 1; syncSelectionUI();
        if (id === 'fLga') { try { await loadWards(); } catch (error) { showBanner('dashBanner', 'Could not load ward filters.', 'error'); } }
        loadRecords();
      });
    });
    $('q').addEventListener('input', function () {
      state.selected.clear(); syncSelectionUI(); clearTimeout(state.searchTimer);
      state.searchTimer = setTimeout(function () { state.page = 1; loadRecords(); }, 280);
    });
    $('resetFilters').addEventListener('click', function () { clearFilters(); loadRecords(); });
    $('prev').addEventListener('click', function () { if (state.page > 1) { state.page--; loadRecords(); } });
    $('next').addEventListener('click', function () { if (state.page * state.pageSize < state.total) { state.page++; loadRecords(); } });
    $('toggleAdvanced').addEventListener('click', function () {
      var open = $('advancedFilters').hidden;
      $('advancedFilters').hidden = !open; $('toggleAdvanced').setAttribute('aria-expanded', String(open));
      $('toggleAdvanced').textContent = open ? 'Fewer filters' : 'More filters';
    });
    document.querySelectorAll('[data-quick-filter]').forEach(function (button) {
      button.addEventListener('click', function () { applyQuickFilter(button.dataset.quickFilter); });
    });
    $('totalRecordsCard').addEventListener('click', function () { clearFilters(); loadRecords(); scrollToElement('recordsSection'); });
    $('wardCoverageCard').addEventListener('click', openCoverage);
    $('recentSubmissionsCard').addEventListener('click', function () { scrollToElement('activitySection'); });
    $('closeCoverage').addEventListener('click', closeCoverage);
    $('coverageSearch').addEventListener('input', renderCoverageBars);
    $('coverageMetric').addEventListener('change', renderCoverageBars);
    $('coverageSort').addEventListener('change', renderCoverageBars);
    $('wardSearch').addEventListener('input', renderWardCoverageRows);
    $('wardCoverageFilter').addEventListener('change', renderWardCoverageRows);
    $('exportCoverageBtn').addEventListener('click', exportCoverageCsv);
    $('exportWardGapsBtn').addEventListener('click', exportWardCsv);
    $('exportBtn').addEventListener('click', exportCsv);
    $('retrySyncBtn').addEventListener('click', retrySheetSync);
    $('refreshBtn').addEventListener('click', refreshAll);
    $('pauseBtn').addEventListener('click', pauseToggle);
    $('signOut').addEventListener('click', signOut);
    $('auditBtn').addEventListener('click', async function () {
      var open = $('auditWrap').hidden;
      $('auditWrap').hidden = !open; $('auditBtn').textContent = open ? 'Hide activity' : 'Show activity';
      $('auditBtn').setAttribute('aria-expanded', String(open));
      if (open) { try { await loadAudit(); } catch (error) { showBanner('dashBanner', 'Could not load the activity log. Check administrator permissions.', 'error'); } }
    });
    $('closeRecordDialog').addEventListener('click', function () { $('recordDialog').close(); });
    $('recordDialog').addEventListener('click', function (event) {
      if (event.target === $('recordDialog')) $('recordDialog').close();
    });
  }
  async function startDashboard() {
    try {
      bindEvents();
      hideLogin();
      await Promise.all([loadLgas(), loadCollectionStatus(), loadStats(), loadRecords()]);
      subscribeRealtime();
    } catch (error) {
      console.error('[TK27] Dashboard setup failed', { code: error && error.code, message: error && error.message });
      showBanner('dashBanner', 'Dashboard setup is incomplete. Apply the latest Supabase migrations and verify active administrator access.', 'error');
    }
  }
  async function boot() {
    if (!window.TK27_DB_READY || !db) {
      showLogin('Supabase has not been configured in frontend/config.js.'); $('loginBtn').disabled = true; return;
    }
    var result = await db.auth.getSession();
    if (result.error) { showLogin('Please sign in to continue.'); return; }
    if (result.data.session && result.data.session.user) {
      state.user = result.data.session.user; state.session = result.data.session;
      if (await verifyAdmin(state.user)) await startDashboard();
      else { await db.auth.signOut(); showLogin('This account is not on the active TK27 administrator list.'); }
    }
  }
  $('loginForm').addEventListener('submit', signIn);
  boot();
})();
