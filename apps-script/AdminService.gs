const AdminService = {
  getDashboardStats(){
    const rows=values_(CONFIG.SHEETS.RECORDS), sh=getSheet_(CONFIG.SHEETS.RECORDS);
    if(!rows.length)return {totalRecords:0,stateExcos:0,lgaCoordinators:0,wardCoordinators:0};
    const m=headerMap_(sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]);
    return {
      totalRecords:rows.length,
      stateExcos:rows.filter(r=>r[m.Position]==='STATE_EXCO').length,
      lgaCoordinators:rows.filter(r=>r[m.Position]==='LGA_COORDINATOR').length,
      wardCoordinators:rows.filter(r=>r[m.Position]==='WARD_COORDINATOR').length
    };
  },
  listRecords(){
    const sh=getSheet_(CONFIG.SHEETS.RECORDS); if(sh.getLastRow()<2)return {items:[]};
    const data=sh.getDataRange().getDisplayValues(), headers=data.shift(), m=headerMap_(headers);
    return {items:data.slice(-200).reverse().map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])))};
  }
};
