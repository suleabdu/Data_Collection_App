const ValidationService = {
  positions: ['STATE_EXCO','LGA_COORDINATOR','WARD_COORDINATOR'],
  validateSubmission_(d){
    if(!this.positions.includes(d.position)) throw new Error('Invalid position.');
    const name=normalizeText_(d.name); if(name.length<2 || name.length>120) throw new Error('Invalid full name.');
    const phone=this.phone_(d.phone); if(!phone) throw new Error('Invalid phone number.');
    const geo=GeographyService.find(d.lgaCode,d.wardCode,d.pollingUnitCode);
    if(!geo) throw new Error('The selected LGA, Ward and Polling Unit combination is not valid.');
    return {name,phone,geo};
  },
  phone_(value){
    let s=String(value||'').replace(/[^\d+]/g,'');
    if(/^0\d{10}$/.test(s)) s='+234'+s.slice(1);
    else if(/^234\d{10}$/.test(s)) s='+'+s;
    if(/^\+234\d{10}$/.test(s)) return s;
    return null;
  }
};
