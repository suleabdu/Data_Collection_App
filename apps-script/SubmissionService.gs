const SubmissionService = {
  submit(d){
    const v=ValidationService.validateSubmission_(d);
    const duplicate=DuplicateService.check_({...d,...v});
    const sh=ensureHeaders_(CONFIG.SHEETS.RECORDS,[
      'Record_ID','State','State_Code','Name','Position','Phone','LGA','LGA_Code','Ward','Ward_Code',
      'Polling_Unit','Polling_Unit_Code','Verification_Status','Duplicate_Flag','Submitted_At','Updated_At','Submitted_By','Notes'
    ]);
    const id=makeRecordId_(d.position), t=now_();
    sh.appendRow([id,CONFIG.STATE,v.geo.stateCode,v.name,d.position,v.phone,v.geo.lga,v.geo.lgaCode,v.geo.ward,v.geo.wardCode,
      v.geo.pollingUnit,v.geo.pollingUnitCode,duplicate.flag?'PENDING_REVIEW':'NEW',duplicate.flag?'YES':'NO',t,t,'PUBLIC_FORM',duplicate.reasons.join('; ')]);
    audit_('RECORD_CREATED',{recordId:id,position:d.position,duplicate},'PUBLIC_FORM');
    return {recordId:id,duplicateFlag:duplicate.flag,duplicateReasons:duplicate.reasons};
  }
};
