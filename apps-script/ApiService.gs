/**
 * Stage 3-5 API layer for TK27 Ogun.
 * Add this file to the SAME bound Apps Script project as the Phase 1 files.
 *
 * Public:
 *   GET ?action=health
 *   GET ?action=getState
 *   GET ?action=getLGAs
 *   GET ?action=getWards&lgaCode=27%2F01
 *   GET ?action=getPollingUnits&lgaCode=27%2F01&wardCode=27%2F01%2F01
 *   POST {action:"submitCoordinator", data:{...}}
 *
 * Admin:
 *   POST {action:"adminLogin", passcode:"..."}
 *   POST {action:"adminStatus", token:"..."}
 *   POST {action:"adminRecords", token:"...", filters:{...}}
 *   POST {action:"adminValidateMaster", token:"..."}
 *   POST {action:"adminRefreshMaster", token:"..."}
 *
 * The browser never receives the Apps Script admin secret. Admin login exchanges
 * the passcode for a short-lived opaque session token stored in Script Cache.
 */

const API = {
  SESSION_TTL: 6 * 60 * 60,
  MAX_RECORDS_RETURNED: 500
};

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = String(p.action || 'health').trim();
    let data;
    switch (action) {
      case 'health': data = apiHealth_(); break;
      case 'getState': data = getState_(); break;
      case 'getLGAs': data = getLGAs_(); break;
      case 'getWards': data = getWards_(p.lgaCode); break;
      case 'getPollingUnits': data = getPollingUnits_(p.lgaCode, p.wardCode); break;
      case 'getMasterStatus': data = getMasterStatus(); break;
      default: return apiJson_(false, null, 'UNKNOWN_ACTION', 'Unknown GET action.');
    }
    return apiJson_(true, data);
  } catch (err) {
    console.error(err);
    return apiJson_(false, null, 'SERVER_ERROR', 'The server could not complete the request.');
  }
}

function doPost(e) {
  try {
    const body = parseJsonBody_(e);
    const action = String(body.action || '').trim();
    switch (action) {
      case 'submitCoordinator':
        return apiJson_(true, submitCoordinator_(body.data || {}));
      case 'adminLogin':
        return apiJson_(true, adminLogin_(body.passcode || ''));
      case 'adminStatus':
        requireAdminSession_(body.token);
        return apiJson_(true, getAdminStatus_());
      case 'adminRecords':
        requireAdminSession_(body.token);
        return apiJson_(true, getAdminRecords_(body.filters || {}));
      case 'adminValidateMaster':
        requireAdminSession_(body.token);
        return apiJson_(true, validateMasterList());
      case 'adminRefreshMaster':
        requireAdminSession_(body.token);
        return apiJson_(true, buildMasterFromWeb('ADMIN_API'));
      case 'adminLogout':
        logoutAdmin_(body.token);
        return apiJson_(true, {loggedOut:true});
      default:
        return apiJson_(false, null, 'UNKNOWN_ACTION', 'Unknown POST action.');
    }
  } catch (err) {
    console.error(err);
    const code = err && err.code ? err.code : 'SERVER_ERROR';
    const message = err && err.publicMessage ? err.publicMessage : 'The server could not complete the request.';
    return apiJson_(false, null, code, message);
  }
}

function apiJson_(success, data, code, message) {
  const payload = success
    ? {success:true, data:data}
    : {success:false, error:{code:code || 'ERROR', message:message || 'Request failed.'}};
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseJsonBody_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    throw publicError_('BAD_REQUEST', 'Request body is required.');
  }
  try { return JSON.parse(e.postData.contents); }
  catch (err) { throw publicError_('INVALID_JSON', 'The request body is not valid JSON.'); }
}

function publicError_(code, message) {
  const e = new Error(message);
  e.code = code; e.publicMessage = message;
  return e;
}

function apiHealth_() {
  const cfg = getConfig_();
  return {
    system: cfg.SYSTEM_NAME,
    version: cfg.VERSION,
    status: cfg.APPLICATION_STATUS,
    state: cfg.ACTIVE_STATE,
    masterStatus: cfg.MASTER_STATUS,
    master: {
      lgas:Number(cfg.MASTER_LGAS||0),
      wards:Number(cfg.MASTER_WARDS||0),
      pollingUnits:Number(cfg.MASTER_PUS||0)
    },
    timestamp: nowIso_()
  };
}

function getState_() {
  const cfg = getConfig_();
  return {
    state: cfg.ACTIVE_STATE,
    stateCode: cfg.STATE_CODE,
    inecStateNo: cfg.INEC_STATE_NO
  };
}

function masterRows_() {
  return readDataRows_(TK27.SHEETS.MASTER, TK27.HEADERS.MASTER.length);
}

function getLGAs_() {
  const cache = CacheService.getScriptCache();
  const key = 'TK27_LGAS_V1';
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const map = {};
  masterRows_().forEach(function(r) {
    if (String(r[10]) !== 'VALID') return;
    const code = String(r[4]||'').trim(), name = String(r[3]||'').trim();
    if (code && name) map[code] = {code:code, name:name};
  });
  const out = Object.keys(map).sort().map(function(k){return map[k];});
  cache.put(key, JSON.stringify(out), 21600);
  return out;
}

function getWards_(lgaCode) {
  lgaCode = cleanText_(lgaCode);
  if (!/^\d{2}\/\d{2}$/.test(lgaCode)) throw publicError_('INVALID_LGA', 'Invalid Local Government.');
  const key = 'TK27_WARDS_'+lgaCode.replace(/\//g,'_');
  const cache = CacheService.getScriptCache(), cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const map = {};
  masterRows_().forEach(function(r) {
    if (String(r[10]) !== 'VALID' || String(r[4]) !== lgaCode) return;
    const code=String(r[6]||'').trim(), name=String(r[5]||'').trim();
    if(code && name) map[code]={code:code,name:name};
  });
  const out=Object.keys(map).sort().map(function(k){return map[k];});
  cache.put(key, JSON.stringify(out),21600);
  return out;
}

function getPollingUnits_(lgaCode, wardCode) {
  lgaCode=cleanText_(lgaCode); wardCode=cleanText_(wardCode);
  if(!/^\d{2}\/\d{2}$/.test(lgaCode)) throw publicError_('INVALID_LGA','Invalid Local Government.');
  if(!/^\d{2}\/\d{2}\/\d{2}$/.test(wardCode) || wardCode.indexOf(lgaCode+'/')!==0)
    throw publicError_('INVALID_WARD','Invalid Ward for the selected LGA.');
  const key='TK27_PUS_'+wardCode.replace(/\//g,'_');
  const cache=CacheService.getScriptCache(), cached=cache.get(key);
  if(cached) return JSON.parse(cached);
  const out=[];
  masterRows_().forEach(function(r){
    if(String(r[10])!=='VALID' || String(r[6])!==wardCode) return;
    out.push({code:String(r[9]||''), name:String(r[7]||'')});
  });
  out.sort(function(a,b){return a.code.localeCompare(b.code,undefined,{numeric:true});});
  cache.put(key,JSON.stringify(out),21600);
  return out;
}

function clearGeoCache_() {
  const c=CacheService.getScriptCache();
  c.remove('TK27_LGAS_V1');
  // Versioned keys are intentionally short-lived; master refresh will naturally expire them.
}

/** Secure, short-lived admin session. */
function adminLogin_(passcode) {
  const expected=PropertiesService.getScriptProperties().getProperty('ADMIN_PASSCODE');
  if(!expected || String(passcode)!==String(expected)) {
    Utilities.sleep(300);
    throw publicError_('AUTH_FAILED','Invalid admin passcode.');
  }
  const token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
  CacheService.getScriptCache().put('TK27_ADMIN_'+token,'1',API.SESSION_TTL);
  logAudit_('ADMIN_LOGIN','','','SESSION_CREATED','OK');
  return {token:token,expiresInSeconds:API.SESSION_TTL};
}

function requireAdminSession_(token) {
  token=cleanText_(token);
  if(!token || !CacheService.getScriptCache().get('TK27_ADMIN_'+token)) {
    throw publicError_('AUTH_REQUIRED','Admin session expired or is invalid.');
  }
}

function logoutAdmin_(token) {
  if(token) CacheService.getScriptCache().remove('TK27_ADMIN_'+cleanText_(token));
  logAudit_('ADMIN_LOGOUT','','','SESSION_ENDED','OK');
}

function getAdminStatus_() {
  return {
    master:getMasterStatus(),
    applicationStatus:getConfig_().APPLICATION_STATUS,
    timestamp:nowIso_()
  };
}

function getAdminRecords_(filters) {
  const rows=readDataRows_(TK27.SHEETS.RECORDS,TK27.HEADERS.RECORDS.length);
  const f=filters||{};
  const wantedPosition=cleanText_(f.position).toUpperCase();
  const wantedLga=cleanText_(f.lgaCode);
  const wantedWard=cleanText_(f.wardCode);
  const wantedSearch=compareKey_(f.search||'');
  const out=[];
  rows.forEach(function(r){
    if(wantedPosition && String(r[4]).toUpperCase()!==wantedPosition) return;
    if(wantedLga && String(r[7])!==wantedLga) return;
    if(wantedWard && String(r[9])!==wantedWard) return;
    if(wantedSearch && compareKey_(r[3]).indexOf(wantedSearch)<0 && compareKey_(r[5]).indexOf(wantedSearch)<0) return;
    out.push({
      recordId:String(r[0]),state:String(r[1]),name:String(r[3]),position:String(r[4]),
      phone:String(r[5]),lga:String(r[6]),ward:String(r[8]),pollingUnit:String(r[10]),
      verificationStatus:String(r[12]),duplicateFlag:String(r[13]),submittedAt:String(r[14]),updatedAt:String(r[15])
    });
  });
  out.reverse();
  return {total:out.length,records:out.slice(0,API.MAX_RECORDS_RETURNED),truncated:out.length>API.MAX_RECORDS_RETURNED};
}

function submitCoordinator_(input) {
  const cfg=getConfig_();
  if(String(cfg.APPLICATION_STATUS).toUpperCase()==='PAUSED')
    throw publicError_('COLLECTION_PAUSED','Coordinator collection is temporarily paused.');
  if(String(cfg.MASTER_STATUS)==='NOT_BUILT' || Number(cfg.MASTER_PUS||0)<=0)
    throw publicError_('MASTER_NOT_READY','The geography master list is not ready.');

  const data=normalizeSubmissionInput_(input,cfg);
  validateSubmissionGeography_(data,cfg);

  const lock=LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const existing=findSubmissionByKey_(data.submissionKey);
    if(existing) return {recordId:existing.recordId,duplicate:true,message:'This submission was already received.'};

    const duplicate=detectPotentialDuplicate_(data);
    const recordId=nextRecordId_(data.position);
    const now=nowIso_();
    const verification=duplicate ? 'PENDING_REVIEW' : 'PENDING';
    const duplicateFlag=duplicate ? duplicate.flag : 'NONE';

    appendRows_(TK27.SHEETS.RECORDS,[[
      recordId,cfg.ACTIVE_STATE,cfg.STATE_CODE,data.name,data.position,data.phone,
      data.lga,data.lgaCode,data.ward,data.wardCode,data.pollingUnit,data.pollingUnitCode,
      verification,duplicateFlag,now,now,'PUBLIC_FORM','',data.submissionKey,
      data.normalizedName,data.normalizedPhone
    ]]);

    logAudit_('COORDINATOR_CREATED',recordId,'',verification,'OK');
    return {
      recordId:recordId,
      duplicate:!!duplicate,
      verificationStatus:verification,
      duplicateFlag:duplicateFlag,
      message:duplicate
        ? 'Record received and flagged for review because it may duplicate an existing coordinator.'
        : 'Record received successfully.'
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeSubmissionInput_(input,cfg) {
  const position=cleanText_(input.position).toUpperCase();
  const allowed=String(cfg.POSITION_OPTIONS||'STATE_EXCO,LGA_COORDINATOR,WARD_COORDINATOR').split(',');
  if(allowed.indexOf(position)<0) throw publicError_('INVALID_POSITION','Select a valid coordinator position.');

  const name=cleanText_(input.name);
  if(name.length<2 || name.length>120) throw publicError_('INVALID_NAME','Enter a valid full name.');

  const phone=normalizeNigeriaPhone_(input.phone);
  if(!phone) throw publicError_('INVALID_PHONE','Enter a valid Nigerian phone number.');

  const lgaCode=cleanText_(input.lgaCode);
  const wardCode=cleanText_(input.wardCode);
  const pollingUnitCode=cleanText_(input.pollingUnitCode);
  if(!lgaCode || !wardCode || !pollingUnitCode)
    throw publicError_('INCOMPLETE_GEOGRAPHY','Select Local Government, Ward and Polling Unit.');

  const submissionKey=cleanText_(input.submissionKey);
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(submissionKey))
    throw publicError_('INVALID_SUBMISSION_KEY','Invalid submission reference. Please reload the form.');

  return {
    name:name, position:position, phone:phone,
    lga:String(input.lga||'').trim(), lgaCode:lgaCode,
    ward:String(input.ward||'').trim(), wardCode:wardCode,
    pollingUnit:String(input.pollingUnit||'').trim(), pollingUnitCode:pollingUnitCode,
    submissionKey:submissionKey,
    normalizedName:compareKey_(name), normalizedPhone:phone.replace(/\D/g,'')
  };
}

function normalizeNigeriaPhone_(value) {
  let s=String(value==null?'':value).replace(/[^\d+]/g,'');
  if(s.indexOf('+234')===0) s='+234'+s.slice(4).replace(/\D/g,'');
  else if(/^234\d{10}$/.test(s)) s='+'+s;
  else if(/^0\d{10}$/.test(s)) s='+234'+s.slice(1);
  else return '';
  if(!/^\+234[789]\d{9}$/.test(s)) return '';
  return s;
}

function validateSubmissionGeography_(data,cfg) {
  const rows=masterRows_();
  let match=null;
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    if(String(r[10])!=='VALID') continue;
    if(String(r[4])===data.lgaCode && String(r[6])===data.wardCode && String(r[9])===data.pollingUnitCode){
      match=r; break;
    }
  }
  if(!match) throw publicError_('INVALID_GEOGRAPHY','The selected Polling Unit does not belong to the selected Ward and Local Government.');
  data.lga=String(match[3]); data.ward=String(match[5]); data.pollingUnit=String(match[7]);
  if(data.wardCode.indexOf(data.lgaCode+'/')!==0)
    throw publicError_('INVALID_GEOGRAPHY','Ward does not belong to the selected Local Government.');
}

function findSubmissionByKey_(key) {
  const rows=readDataRows_(TK27.SHEETS.RECORDS,TK27.HEADERS.RECORDS.length);
  for(let i=0;i<rows.length;i++) if(String(rows[i][18])===key)
    return {recordId:String(rows[i][0])};
  return null;
}

function detectPotentialDuplicate_(data) {
  const rows=readDataRows_(TK27.SHEETS.RECORDS,TK27.HEADERS.RECORDS.length);
  for(let i=0;i<rows.length;i++){
    const r=rows[i];
    const phone=String(r[20]||'').trim();
    const name=String(r[19]||'').trim();
    const position=String(r[4]||'').trim();
    if(phone && phone===data.normalizedPhone) return {flag:'PHONE_MATCH',recordId:r[0]};
    if(name && name===data.normalizedName && position===data.position) return {flag:'NAME_POSITION_MATCH',recordId:r[0]};
    if(name && name===data.normalizedName && String(r[7])===data.lgaCode && String(r[9])===data.wardCode)
      return {flag:'NAME_GEOGRAPHY_MATCH',recordId:r[0]};
  }
  return null;
}

function nextRecordId_(position) {
  const prefix=position==='STATE_EXCO'?'EXCO':position==='LGA_COORDINATOR'?'LGA':'WC';
  const rows=readDataRows_(TK27.SHEETS.RECORDS,TK27.HEADERS.RECORDS.length);
  let max=0;
  rows.forEach(function(r){
    const m=String(r[0]).match(/^OG-(EXCO|LGA|WC)-(\d+)$/);
    if(m) max=Math.max(max,Number(m[2]));
  });
  return 'OG-'+prefix+'-'+zeroPad_(max+1,6);
}
