const DuplicateService = {
  check_(data){
    const rows=values_(CONFIG.SHEETS.RECORDS);
    if(!rows.length) return {flag:false,reasons:[]};
    const headers=getSheet_(CONFIG.SHEETS.RECORDS).getRange(1,1,1,getSheet_(CONFIG.SHEETS.RECORDS).getLastColumn()).getValues()[0];
    const m=headerMap_(headers), reasons=[];
    const name=normalizeKey_(data.name), phone=data.phone;
    rows.forEach(r=>{
      if(String(r[m.Phone])===phone) reasons.push('Same phone number');
      if(normalizeKey_(r[m.Name])===name && String(r[m.Position])===data.position) reasons.push('Same name and position');
      if(normalizeKey_(r[m.Name])===name && String(r[m.LGA_Code])===String(data.geo.lgaCode) && String(r[m.Ward_Code])===String(data.geo.wardCode)) reasons.push('Same name and geography');
    });
    return {flag:reasons.length>0,reasons:[...new Set(reasons)]};
  }
};
