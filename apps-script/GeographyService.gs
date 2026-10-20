const GeographyService = {
  getRows_() {
    const sh=getSheet_(CONFIG.SHEETS.MASTER);
    if(sh.getLastRow()<2) return [];
    const data=sh.getDataRange().getValues(), headers=data.shift(), m=headerMap_(headers);
    return data.filter(r=>String(r[m.Status]||'ACTIVE')==='ACTIVE').map(r=>({
      state:r[m.State],stateCode:r[m.State_Code],lga:r[m.LGA],lgaCode:String(r[m.LGA_Code]),
      ward:r[m.Ward],wardCode:String(r[m.Ward_Code]),pollingUnit:r[m.Polling_Unit],pollingUnitCode:String(r[m.Polling_Unit_Code])
    }));
  },
  getLGAs(){
    const seen={}, items=[];
    this.getRows_().forEach(r=>{if(!seen[r.lgaCode]){seen[r.lgaCode]=1;items.push({code:r.lgaCode,name:r.lga})}});
    items.sort((a,b)=>a.name.localeCompare(b.name)); return {items};
  },
  getWards(lgaCode){
    if(!lgaCode) throw new Error('LGA is required.');
    const seen={}, items=[];
    this.getRows_().filter(r=>r.lgaCode===String(lgaCode)).forEach(r=>{if(!seen[r.wardCode]){seen[r.wardCode]=1;items.push({code:r.wardCode,name:r.ward})}});
    items.sort((a,b)=>a.name.localeCompare(b.name)); return {items};
  },
  getPollingUnits(lgaCode,wardCode){
    if(!lgaCode||!wardCode) throw new Error('LGA and Ward are required.');
    const items=this.getRows_().filter(r=>r.lgaCode===String(lgaCode)&&r.wardCode===String(wardCode))
      .map(r=>({code:r.pollingUnitCode,name:r.pollingUnit}));
    items.sort((a,b)=>a.name.localeCompare(b.name)); return {items};
  },
  find(lgaCode,wardCode,pollingUnitCode){
    return this.getRows_().find(r=>r.lgaCode===String(lgaCode)&&r.wardCode===String(wardCode)&&r.pollingUnitCode===String(pollingUnitCode)) || null;
  }
};
