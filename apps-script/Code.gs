function doGet(e) {
  try { return json_(route_(e, 'GET')); }
  catch(err){ console.error(err); return json_(fail_('SERVER_ERROR', err.message || String(err))); }
}
function doPost(e) {
  try { return json_(route_(e, 'POST')); }
  catch(err){ console.error(err); return json_(fail_('SERVER_ERROR', err.message || String(err))); }
}
function route_(e, method){
  const p=e && e.parameter || {};
  let body={};
  if(method==='POST' && e.postData && e.postData.contents){ try{ body=JSON.parse(e.postData.contents); }catch(_){} }
  p.body=body;
  const action=p.action || '';
  if(action==='getState') return ok_({state:CONFIG.STATE,stateCode:CONFIG.STATE_CODE});
  if(action==='getLGAs') return ok_(GeographyService.getLGAs());
  if(action==='getWards') return ok_(GeographyService.getWards(p.lgaCode));
  if(action==='getPollingUnits') return ok_(GeographyService.getPollingUnits(p.lgaCode,p.wardCode));
  if(action==='getMasterStatus') return ok_(MasterDataService.getStatus());
  if(action==='getDashboardStats') { requireApiAdmin_(e); return ok_(AdminService.getDashboardStats()); }
  if(action==='listRecords') { requireApiAdmin_(e); return ok_(AdminService.listRecords()); }
  if(action==='exportRecords') { requireApiAdmin_(e); return ok_({csv:ExportService.exportRecordsCsv()}); }
  if(action==='validateMasterList') { requireApiAdmin_(e); return ok_(MasterDataService.validateMasterList()); }
  if(action==='buildMasterList') { requireApiAdmin_(e); return ok_(MasterDataService.buildMasterList()); }
  if(action==='importGeographyCsv') { requireApiAdmin_(e); return ok_(MasterDataService.importCsv(p.body || '')); }
  if(action==='submitCoordinator') {
    const body=p.body || {};
    return ok_(SubmissionService.submit(body));
  }
  throw new Error('Unknown action: '+action);
}
function requireApiAdmin_(e){
  const key=(e.parameter && e.parameter.adminKey)||'';
  if(key!==getAdminKey_()) throw new Error('Unauthorized.');
}
