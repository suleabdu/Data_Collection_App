const MASTER_HEADERS=['ID','State','State_Code','LGA','LGA_Code','Ward','Ward_Code','Polling_Unit','Polling_Unit_Code','Full_PU_Code','Status','Source','Source_Date','Created_At','Updated_At'];
const RAW_HEADERS=['Imported_At','Filename','Source','Row_JSON'];
const MasterDataService = {
  getStatus(){
    const sh=getSheet_(CONFIG.SHEETS.MASTER), count=Math.max(0,sh.getLastRow()-1);
    const status=count>0?'READY':'EMPTY'; return {status,count};
  },
  importCsv(payload){
    const csv=payload.csv||'', filename=normalizeText_(payload.filename||'official.csv');
    if(!csv) throw new Error('CSV is empty.');
    const rows=Utilities.parseCsv(csv);
    if(rows.length<2) throw new Error('CSV must contain a header and at least one data row.');
    const raw=ensureHeaders_(CONFIG.SHEETS.RAW,RAW_HEADERS);
    rows.slice(1).forEach(r=>raw.appendRow([now_(),filename,'ADMIN_CSV',JSON.stringify(r)]));
    getSheet_(CONFIG.SHEETS.IMPORT).appendRow([now_(),'ADMIN_CSV',filename,rows.length-1,'RAW_IMPORTED']);
    audit_('GEOGRAPHY_RAW_IMPORTED',{filename,count:rows.length-1},'ADMIN');
    return {count:rows.length-1};
  },
  buildMasterList(){
    const raw=values_(CONFIG.SHEETS.RAW);
    if(!raw.length) throw new Error('No raw geography import exists. Upload an official CSV first.');
    const headers=['State','State_Code','LGA','LGA_Code','Ward','Ward_Code','Polling_Unit','Polling_Unit_Code','Full_PU_Code'];
    const output=[], seen={};
    const errors=[];
    const target=raw.map(r=>{try{return JSON.parse(r[3])}catch(_){return null}}).filter(Boolean);
    target.forEach((r,i)=>{
      const vals=r.map(normalizeText_);
      // Expected CSV order: State, State_Code, LGA, LGA_Code, Ward, Ward_Code, Polling_Unit, Polling_Unit_Code, Full_PU_Code
      const [state,stateCode,lga,lgaCode,ward,wardCode,pu,puCode,fullCode]=vals;
      if(!state||!lga||!lgaCode||!ward||!wardCode||!pu||!puCode){errors.push({row:i+2,error:'Missing required geography field'});return}
      if(normalizeKey_(state)!==normalizeKey_(CONFIG.STATE)){errors.push({row:i+2,error:'State is not Ogun'});return}
      const key=[stateCode,lgaCode,wardCode,puCode].join('|');
      if(seen[key]) return; seen[key]=1;
      output.push([key,state,stateCode,lga,lgaCode,ward,wardCode,pu,puCode,fullCode||'','ACTIVE', 'ADMIN_CSV', '', now_(), now_()]);
    });
    if(!output.length) throw new Error('No valid geography rows were produced. Previous master list was preserved.');
    if(errors.length>0) throw new Error('Validation failed: '+errors.length+' invalid rows. Previous master list was preserved.');
    const sh=getSheet_(CONFIG.SHEETS.MASTER);
    sh.clearContents();sh.getRange(1,1,1,MASTER_HEADERS.length).setValues([MASTER_HEADERS]);
    sh.getRange(2,1,output.length,MASTER_HEADERS.length).setValues(output);
    getSheet_(CONFIG.SHEETS.IMPORT).appendRow([now_(),'ADMIN_CSV','RAW_IMPORT',output.length,'MASTER_PUBLISHED']);
    audit_('MASTER_PUBLISHED',{count:output.length},'ADMIN');
    return {count:output.length};
  },
  validateMasterList(){
    const rows=this.getStatus().count;
    if(!rows) return {valid:false,count:0};
    const data=GeographyService.getRows_(), keys={}; let valid=true;
    data.forEach(r=>{const k=[r.stateCode,r.lgaCode,r.wardCode,r.pollingUnitCode].join('|');if(keys[k])valid=false;keys[k]=1});
    const sh=ensureHeaders_(CONFIG.SHEETS.VALIDATION,['Timestamp','Valid','Count','Details']);
    sh.appendRow([now_(),valid,rows,valid?'OK':'Duplicate unique geography identifiers']);
    audit_('MASTER_VALIDATED',{valid,count:rows},'ADMIN');
    return {valid,count:rows};
  }
};
