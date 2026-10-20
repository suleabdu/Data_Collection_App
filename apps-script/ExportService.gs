const ExportService = {
  exportRecordsCsv(){
    const sh=getSheet_(CONFIG.SHEETS.RECORDS);
    if(sh.getLastRow()<2)return '';
    const n=Math.min(sh.getLastRow(),CONFIG.MAX_EXPORT_ROWS+1), data=sh.getRange(1,1,n,sh.getLastColumn()).getDisplayValues();
    return rowsToCsv_(data.shift(),data);
  }
};
