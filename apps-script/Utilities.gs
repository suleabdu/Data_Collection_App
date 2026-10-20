function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function ok_(data) { return {success:true, data:data || {}}; }
function fail_(code, message) { return {success:false, error:{code:code, message:message}}; }
function now_(){ return new Date(); }
function iso_(d){ return Utilities.formatDate(d || new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd'T'HH:mm:ss"); }
function normalizeText_(v){ return String(v == null ? '' : v).trim().replace(/\s+/g,' '); }
function normalizeKey_(v){ return normalizeText_(v).toUpperCase(); }
function csvEscape_(v){
  const s=String(v == null ? '' : v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
function rowsToCsv_(headers, rows){
  return [headers, ...rows].map(r=>r.map(csvEscape_).join(',')).join('\r\n');
}
function getSheet_(name){
  const ss=SpreadsheetApp.getActive();
  let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  return sh;
}
function ensureHeaders_(sheetName, headers){
  const sh=getSheet_(sheetName);
  if(sh.getLastRow()===0){ sh.getRange(1,1,1,headers.length).setValues([headers]); }
  return sh;
}
function values_(sheetName){
  const sh=getSheet_(sheetName), last=sh.getLastRow(), cols=sh.getLastColumn();
  if(last<2 || cols<1) return [];
  return sh.getRange(2,1,last-1,cols).getValues();
}
function headerMap_(headers){
  const m={}; headers.forEach((h,i)=>m[String(h)]=i); return m;
}
function requireAdmin_(e){
  const key=(e && e.parameter && e.parameter.adminKey) || '';
  const prop=PropertiesService.getScriptProperties().getProperty(CONFIG.ADMIN_KEY_PROPERTY) || '';
  return !!prop && key===prop;
}
function makeRecordId_(position){
  const prefix={STATE_EXCO:'EXCO',LGA_COORDINATOR:'LGA',WARD_COORDINATOR:'WC'}[position] || 'REC';
  const props=PropertiesService.getScriptProperties();
  const k='SEQ_'+prefix, n=Number(props.getProperty(k)||0)+1; props.setProperty(k,String(n));
  return CONFIG.STATE_CODE+'-'+prefix+'-'+String(n).padStart(6,'0');
}
function audit_(action, details, actor){
  const sh=ensureHeaders_(CONFIG.SHEETS.AUDIT,['Timestamp','Action','Actor','Details']);
  sh.appendRow([now_(),action,actor||'SYSTEM',JSON.stringify(details||{})]);
}
function getAdminKey_(){ return PropertiesService.getScriptProperties().getProperty(CONFIG.ADMIN_KEY_PROPERTY)||''; }
