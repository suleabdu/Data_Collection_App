(function () {
  'use strict';
  var db = window.TK27_DB;
  var $ = function (id) { return document.getElementById(id); };
  var state = { user: null, session: null, page: 1, pageSize: 25, total: 0, realtime: null, searchTimer: null, reloadTimer: null, paused: false, lastEvent: null, loading: false, pendingReload: false };
  var POSITIONS = { STATE_EXCO: 'State Exco', LGA_COORDINATOR: 'LGA Coordinator', WARD_COORDINATOR: 'Ward Coordinator' };
  var FIELDS = ['q','fPosition','fStatus','fLga','fWard','fFrom','fTo','fDup'];
  function node(tag, text, className) { var n=document.createElement(tag); if (text !== undefined && text !== null) n.textContent=String(text); if (className) n.className=className; return n; }
  function showBanner(target, message, kind) { var e=$(target); e.className='banner '+(kind||'error'); e.textContent=message||''; e.hidden=!message; }
  function showToast(message) { var t=$('toast'); t.textContent=message; t.hidden=!message; if (message) { clearTimeout(showToast.timer); showToast.timer=setTimeout(function(){t.hidden=true;},5200); } }
  function niceDate(value, withTime) { if (!value) return '—'; var d=new Date(value); return isNaN(d.getTime())?'—':d.toLocaleString(undefined,withTime?{dateStyle:'medium',timeStyle:'short'}:{dateStyle:'medium'}); }
  function statusClass(status) { return status==='VERIFIED'?'ok':status==='REJECTED'?'bad':'warn'; }
  function hideLogin() { $('loginCard').hidden=true; $('dashboard').hidden=false; }
  function showLogin(message) { $('loginCard').hidden=false; $('dashboard').hidden=true; if(message) showBanner('loginBanner',message,'error'); }
  async function verifyAdmin(user) {
    if (!user) return false;
    var r=await db.from('admin_users').select('user_id,active').eq('user_id',user.id).maybeSingle();
    return !r.error && !!r.data && r.data.active===true;
  }
  async function signIn(event) {
    event.preventDefault(); if(!window.TK27_DB_READY||!db){showBanner('loginBanner','Supabase has not been configured in frontend/config.js.','error');return;}
    var btn=$('loginBtn'); btn.disabled=true; btn.textContent='Checking account…';
    try {
      var result=await db.auth.signInWithPassword({email:$('email').value.trim(),password:$('password').value});
      if(result.error) throw result.error;
      if(!(await verifyAdmin(result.data.user))){await db.auth.signOut();throw new Error('This account is not on the active TK27 administrator list.');}
      state.user=result.data.user; state.session=result.data.session; $('password').value=''; showBanner('loginBanner','','error'); hideLogin(); await startDashboard();
    } catch(error) { showBanner('loginBanner',error.message||'Sign-in failed. Check your account details.','error'); }
    finally { btn.disabled=false; btn.textContent='Sign in securely'; }
  }
  async function signOut() { if(state.realtime){await db.removeChannel(state.realtime);state.realtime=null;} await db.auth.signOut(); state.user=null;state.session=null;showLogin('You have signed out.'); }
  function statusPill(text, kind) { return node('span',text,'pill '+(kind||'')); }
  function cardCount(value,label,filter,kind) {
    var b=node('button',null,'stat-button'+(kind?' '+kind:'')); b.type='button'; b.dataset.filter=filter; b.appendChild(node('span',String(value),'stat-number'));b.appendChild(node('span',label,'stat-label'));b.addEventListener('click',function(){applyQuickFilter(filter);}); return b;
  }
  async function loadStats() {
    var result=await db.rpc('admin_dashboard_stats'); if(result.error) throw result.error; var s=result.data||{};
    var grid=$('statsGrid');grid.innerHTML='';
    grid.appendChild(cardCount(s.total||0,'Total records','all','stat-primary'));
    grid.appendChild(cardCount(s.STATE_EXCO||0,'State Excos','position:STATE_EXCO'));
    grid.appendChild(cardCount(s.LGA_COORDINATOR||0,'LGA coordinators','position:LGA_COORDINATOR'));
    grid.appendChild(cardCount(s.WARD_COORDINATOR||0,'Ward coordinators','position:WARD_COORDINATOR'));
    grid.appendChild(cardCount(s.PENDING||0,'Pending review','status:PENDING','stat-warning'));
    grid.appendChild(cardCount(s.VERIFIED||0,'Verified','status:VERIFIED','stat-success'));
    grid.appendChild(cardCount(s.REJECTED||0,'Rejected','status:REJECTED','stat-danger'));
    grid.appendChild(cardCount(s.duplicates||0,'Possible duplicates','duplicates','stat-warning'));
    $('masterCount').textContent=Number(s.masterRows||0).toLocaleString();$('syncCount').textContent=Number(s.syncPending||0).toLocaleString();
    $('masterPill').textContent='Master: '+(Number(s.masterRows||0)>0?'Ready':'Not imported');
  }
  async function loadCollectionStatus() {
    var result=await db.rpc('public_app_status'); if(result.error) throw result.error;
    state.paused=!!(result.data&&result.data.paused);$('pauseBtn').textContent=state.paused?'Resume collection':'Pause collection';
    $('collectionPill').textContent='Collection: '+(state.paused?'Paused':'Open');$('collectionPill').className='pill '+(state.paused?'warn':'ok');
  }
  async function loadLgas() {
    var result=await db.rpc('get_public_lgas');if(result.error)throw result.error;
    var select=$('fLga');select.innerHTML='';select.appendChild(new Option('All LGAs',''));
    (result.data||[]).forEach(function(l){select.appendChild(new Option(l.lga,l.lga_code));});
  }
  async function loadWards() {
    var select=$('fWard');select.innerHTML='';select.appendChild(new Option('All wards',''));
    if(!$('fLga').value){select.disabled=true;return;}
    select.disabled=true;
    var result=await db.rpc('get_public_wards',{p_lga_code:$('fLga').value});
    if(result.error)throw result.error;
    (result.data||[]).forEach(function(w){select.appendChild(new Option(w.ward,w.ward_code));});select.disabled=false;
  }
  function filterValues() {
    return {q:$('q').value.trim(),position:$('fPosition').value,status:$('fStatus').value,lga:$('fLga').value,ward:$('fWard').value,from:$('fFrom').value,to:$('fTo').value,duplicates:$('fDup').checked};
  }
  function buildQuery() {
    var f=filterValues();var query=db.from('coordinator_records').select('*',{count:'exact'}).order('submitted_at',{ascending:false});
    if(f.position)query=query.eq('position',f.position);if(f.status)query=query.eq('verification_status',f.status);
    if(f.lga)query=query.eq('lga_code',f.lga);if(f.ward)query=query.eq('ward_code',f.ward);if(f.duplicates)query=query.eq('duplicate_flag',true);
    if(f.from){var start=new Date(f.from+'T00:00:00');if(!isNaN(start.getTime()))query=query.gte('submitted_at',start.toISOString());}
    if(f.to){var end=new Date(f.to+'T23:59:59.999');if(!isNaN(end.getTime()))query=query.lte('submitted_at',end.toISOString());}
    if(f.q){var q=f.q.replace(/[,%()*.\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);if(q){query=query.or('record_id.ilike.%'+q+'%,name.ilike.%'+q+'%,phone.ilike.%'+q+'%,lga.ilike.%'+q+'%,ward.ilike.%'+q+'%,polling_unit.ilike.%'+q+'%');}}
    return query;
  }
  function activeFilterChips() {
    var f=filterValues(),wrap=$('activeChips');wrap.innerHTML='';var chips=[];
    if(f.q)chips.push(['Search: '+f.q,'q']);if(f.position)chips.push([POSITIONS[f.position]||f.position,'fPosition']);if(f.status)chips.push([f.status,'fStatus']);
    if(f.lga)chips.push([$('fLga').selectedOptions[0].textContent,'fLga']);if(f.ward)chips.push([$('fWard').selectedOptions[0].textContent,'fWard']);
    if(f.from)chips.push(['From '+f.from,'fFrom']);if(f.to)chips.push(['To '+f.to,'fTo']);if(f.duplicates)chips.push(['Possible duplicates','fDup']);
    chips.forEach(function(c){var b=node('button',c[0]+' ×','filter-chip');b.type='button';b.title='Remove filter';b.addEventListener('click',function(){var target=$(c[1]);if(c[1]==='fDup')target.checked=false;else target.value='';if(c[1]==='fLga'){target.dispatchEvent(new Event('change'));return;}if(c[1]==='fWard'&&!$('fLga').value)return;state.page=1;loadRecords();});wrap.appendChild(b);});
  }
  function createCell(row,text,cls) { var td=node('td',text,cls);row.appendChild(td);return td; }
  function renderRecordRow(r) {
    var tr=node('tr',null,r.duplicate_flag?'duplicate-row':'');
    var ref=node('td');ref.appendChild(node('strong',r.record_id,'record-ref'));ref.appendChild(node('span',niceDate(r.submitted_at,true),'table-subtext'));tr.appendChild(ref);
    var person=node('td');person.appendChild(node('strong',r.name,'person-name'));person.appendChild(node('span',r.phone,'table-subtext'));if(r.duplicate_flag)person.appendChild(node('span','Potential duplicate','duplicate-note'));tr.appendChild(person);
    createCell(tr,POSITIONS[r.position]||r.position,'position-cell');
    var location=node('td');location.appendChild(node('strong',r.lga,'location-main'));location.appendChild(node('span',r.ward,'table-subtext'));location.appendChild(node('span',(r.polling_unit||'')+' · '+(r.polling_unit_code||''),'table-subtext'));tr.appendChild(location);
    var status=node('td');status.appendChild(statusPill((r.verification_status||'PENDING').replace('_',' '),statusClass(r.verification_status)));tr.appendChild(status);
    var actions=node('td',null,'action-cell');[['VERIFIED','Verify','action-verify'],['REJECTED','Reject','action-reject'],['PENDING','Reset','action-reset']].forEach(function(a){if(r.verification_status===a[0])return;var b=node('button',a[1],'btn micro '+a[2]);b.type='button';b.addEventListener('click',function(){updateStatus(r.record_id,a[0],b);});actions.appendChild(b);});tr.appendChild(actions);return tr;
  }
  async function loadRecords() {
    if(state.loading){state.pendingReload=true;return;}state.loading=true;activeFilterChips();$('recordRows').innerHTML='';$('recordRows').appendChild(emptyRow('Loading records…'));
    try {
      var start=(state.page-1)*state.pageSize;var result=await buildQuery().range(start,start+state.pageSize-1);if(result.error)throw result.error;
      state.total=result.count||0;$('recordRows').innerHTML='';
      if(!result.data||!result.data.length)$('recordRows').appendChild(emptyRow('No records match these filters. Try resetting one or more filters.'));
      else result.data.forEach(function(r){$('recordRows').appendChild(renderRecordRow(r));});
      var first=state.total?start+1:0,last=Math.min(start+state.pageSize,state.total);$('resultSummary').textContent=first+'–'+last+' of '+state.total.toLocaleString()+' matching records';
      $('pageInfo').textContent='Page '+state.page+' of '+Math.max(1,Math.ceil(state.total/state.pageSize));$('prev').disabled=state.page<=1;$('next').disabled=start+state.pageSize>=state.total;
      $('lastUpdated').textContent='Updated '+new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    } catch(error){console.error(error);showBanner('dashBanner','Unable to load records: '+(error.message||'please try again.'),'error');$('recordRows').innerHTML='';$('recordRows').appendChild(emptyRow('Records could not be loaded.'));}
    finally{state.loading=false;if(state.pendingReload){state.pendingReload=false;setTimeout(function(){Promise.all([loadStats(),loadRecords()]).catch(function(e){console.error(e);});},0);}}
  }
  function emptyRow(message){var tr=node('tr');var td=node('td',message,'empty-cell');td.colSpan=6;tr.appendChild(td);return tr;}
  async function updateStatus(recordId,status,button) {
    button.disabled=true;button.textContent='Saving…';
    try{var result=await db.from('coordinator_records').update({verification_status:status}).eq('record_id',recordId).select('record_id').single();if(result.error)throw result.error;showToast(recordId+' marked '+status.toLowerCase()+'.');await Promise.all([loadStats(),loadRecords()]);}
    catch(error){console.error(error);showBanner('dashBanner','Could not update record: '+(error.message||'please retry.'),'error');button.disabled=false;button.textContent='Retry';}
  }
  function applyQuickFilter(filter) {
    FIELDS.forEach(function(id){if(id==='fDup')$(id).checked=false;else $(id).value='';});
    $('fWard').innerHTML='';$('fWard').appendChild(new Option('All wards',''));$('fWard').disabled=true;
    if(filter==='duplicates')$('fDup').checked=true;
    else if(filter.indexOf('status:')===0)$('fStatus').value=filter.split(':')[1];
    else if(filter.indexOf('position:')===0)$('fPosition').value=filter.split(':')[1];
    state.page=1;loadRecords();
  }
  function bindFilterEvents() {
    ['fPosition','fStatus','fLga','fWard','fFrom','fTo','fDup'].forEach(function(id){$(id).addEventListener('change',async function(){state.page=1;if(id==='fLga'){try{await loadWards();}catch(e){showBanner('dashBanner','Could not load ward filters.','error');}}loadRecords();});});
    $('q').addEventListener('input',function(){clearTimeout(state.searchTimer);state.searchTimer=setTimeout(function(){state.page=1;loadRecords();},280);});
    $('resetFilters').addEventListener('click',async function(){FIELDS.forEach(function(id){if(id==='fDup')$(id).checked=false;else $(id).value='';});$('fWard').disabled=true;$('fWard').innerHTML='';$('fWard').appendChild(new Option('All wards',''));state.page=1;await loadRecords();});
    $('prev').addEventListener('click',function(){if(state.page>1){state.page--;loadRecords();}});$('next').addEventListener('click',function(){if(state.page*state.pageSize<state.total){state.page++;loadRecords();}});
  }
  function csvSafe(value) { var s=String(value==null?'':value);if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'; }
  async function exportCsv() {
    var btn=$('exportBtn');btn.disabled=true;btn.textContent='Preparing CSV…';
    try{var all=[],offset=0,batch=1000;while(true){var res=await buildQuery().range(offset,offset+batch-1);if(res.error)throw res.error;all=all.concat(res.data||[]);if(!res.data||res.data.length<batch)break;offset+=batch;if(offset>=50000)break;}
      var cols=[['record_id','Record_ID'],['state','State'],['state_code','State_Code'],['name','Name'],['position','Position'],['phone','Phone'],['lga','LGA'],['lga_code','LGA_Code'],['ward','Ward'],['ward_code','Ward_Code'],['polling_unit','Polling_Unit'],['polling_unit_code','Polling_Unit_Code'],['verification_status','Verification_Status'],['duplicate_flag','Duplicate_Flag'],['submitted_at','Submitted_At'],['updated_at','Updated_At'],['submitted_by','Submitted_By'],['notes','Notes'],['submission_key','Submission_Key'],['normalized_name','Normalized_Name'],['normalized_phone','Normalized_Phone']];
      var rows=[cols.map(function(c){return csvSafe(c[1]);}).join(',')];all.forEach(function(r){rows.push(cols.map(function(c){return csvSafe(c[0]==='duplicate_flag'?(r[c[0]]?'TRUE':'FALSE'):r[c[0]]);}).join(','));});
      var blob=new Blob(['\ufeff'+rows.join('\r\n')],{type:'text/csv;charset=utf-8;'});var url=URL.createObjectURL(blob);var a=node('a');a.href=url;a.download='tk27-coordinator-records-'+new Date().toISOString().slice(0,10)+'.csv';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url);},1000);showToast('CSV exported: '+all.length+' matching record(s).');
    }catch(error){showBanner('dashBanner','Export failed: '+(error.message||'please retry.'),'error');}
    finally{btn.disabled=false;btn.textContent='Export filtered CSV';}
  }
  async function retrySheetSync() {
    var btn=$('retrySyncBtn');btn.disabled=true;btn.textContent='Retrying…';
    try{var r=await db.functions.invoke('sync-google-sheet',{body:{action:'retry'}});if(r.error)throw r.error;var data=r.data||{};showToast('Sheet sync retry finished. Synced: '+(data.synced||0)+', failed: '+(data.failed||0)+'.');await loadStats();}
    catch(error){console.error(error);showBanner('dashBanner','Could not retry Sheet sync: '+(error.message||'please retry.'),'error');}
    finally{btn.disabled=false;btn.textContent='Retry Sheet sync';}
  }
  async function loadAudit() {
    var r=await db.from('audit_log').select('created_at,actor_label,action,record_id,result').order('created_at',{ascending:false}).limit(100);if(r.error)throw r.error;
    var body=$('auditRows');body.innerHTML='';if(!r.data||!r.data.length){var row=node('tr');var td=node('td','No activity has been recorded yet.','empty-cell');td.colSpan=4;row.appendChild(td);body.appendChild(row);return;}
    r.data.forEach(function(a){var tr=node('tr');[niceDate(a.created_at,true),a.action,a.record_id||'—',a.actor_label||'system'].forEach(function(v){tr.appendChild(node('td',v));});body.appendChild(tr);});
  }
  async function pauseToggle() {
    var btn=$('pauseBtn');btn.disabled=true;
    try{var status=state.paused?'LIVE':'PAUSED';var r=await db.rpc('set_collection_status',{p_status:status});if(r.error)throw r.error;await loadCollectionStatus();showToast('Collection is now '+(state.paused?'paused':'open')+'.');}
    catch(error){showBanner('dashBanner','Could not change collection status: '+(error.message||'please retry.'),'error');}
    finally{btn.disabled=false;}
  }
  function subscribeRealtime() {
    if(state.realtime)db.removeChannel(state.realtime);
    state.realtime=db.channel('tk27-coordinator-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'coordinator_records'},function(payload){
        state.lastEvent=payload.eventType;clearTimeout(state.reloadTimer);
        if(payload.eventType==='INSERT'&&payload.new){showToast('New record received · '+payload.new.record_id);state.page=1;}
        state.reloadTimer=setTimeout(function(){Promise.all([loadStats(),loadRecords()]).catch(function(e){console.error(e);});},120);
      })
      .subscribe(function(status){var dot=$('liveDot');$('connectionStatus').textContent=status==='SUBSCRIBED'?'Live updates connected':status==='CHANNEL_ERROR'?'Live updates interrupted':'Connecting to live updates…';dot.className='live-dot '+(status==='SUBSCRIBED'?'connected':status==='CHANNEL_ERROR'?'disconnected':'');if(status==='CHANNEL_ERROR')showBanner('dashBanner','Realtime connection interrupted. Records will still refresh when you press Refresh data.','warn');});
  }
  async function refreshAll() {
    $('refreshBtn').disabled=true;
    try{await Promise.all([loadStats(),loadRecords(),loadCollectionStatus()]);showBanner('dashBanner','','error');}
    catch(error){showBanner('dashBanner','Some dashboard data could not be refreshed: '+(error.message||'please retry.'),'error');}
    finally{$('refreshBtn').disabled=false;}
  }
  async function startDashboard() {
    try{hideLogin();bindFilterEvents();await Promise.all([loadLgas(),loadCollectionStatus(),loadStats(),loadRecords()]);subscribeRealtime();}
    catch(error){console.error(error);showBanner('dashBanner','Dashboard setup incomplete: '+(error.message||'check Supabase configuration and administrator permissions.'),'error');}
  }
  async function boot() {
    if(!window.TK27_DB_READY||!db){showLogin('Supabase has not been configured in frontend/config.js.');$('loginBtn').disabled=true;return;}
    var session=await db.auth.getSession();if(session.error){showLogin('Please sign in to continue.');return;}
    if(session.data.session&&session.data.session.user){state.user=session.data.session.user;state.session=session.data.session;if(await verifyAdmin(state.user)){await startDashboard();}else{await db.auth.signOut();showLogin('This account is not on the active TK27 administrator list.');}}
  }
  $('loginForm').addEventListener('submit',signIn);$('signOut').addEventListener('click',signOut);$('refreshBtn').addEventListener('click',refreshAll);$('pauseBtn').addEventListener('click',pauseToggle);
  $('exportBtn').addEventListener('click',exportCsv);$('retrySyncBtn').addEventListener('click',retrySheetSync);
  $('auditBtn').addEventListener('click',async function(){var open=$('auditWrap').hidden;$('auditWrap').hidden=!open;$('auditBtn').textContent=open?'Hide activity':'Show activity';$('auditBtn').setAttribute('aria-expanded',String(open));if(open){try{await loadAudit();}catch(e){showBanner('dashBanner','Could not load activity log.','error');}}});
  boot();
})();
