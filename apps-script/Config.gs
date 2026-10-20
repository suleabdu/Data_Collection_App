/**
 * Config.gs — constants, sheet schemas and default CONFIG values.
 * Nothing else in the project hard-codes sheet names, headers or state values.
 */

const TK27 = {
  VERSION: '1.0.0-phase1',

  SHEETS: {
    CONFIG: 'CONFIG',
    MASTER: 'MASTER_GEOGRAPHY',
    RAW: 'RAW_IMPORT',
    NORM: 'NORMALIZED_GEOGRAPHY',
    RECORDS: 'COORDINATOR_RECORDS',
    AUDIT: 'AUDIT_LOG',
    VALIDATION: 'VALIDATION_LOG',
    IMPORT: 'IMPORT_LOG'
  },

  // Sheets whose every column is forced to plain text. Codes such as 27/01/03
  // would otherwise be silently converted to dates by Google Sheets.
  TEXT_SHEETS: ['CONFIG', 'MASTER', 'RAW', 'NORM', 'RECORDS'],

  HEADERS: {
    CONFIG: ['Key', 'Value', 'Description'],

    MASTER: [
      'ID', 'State', 'State_Code', 'LGA', 'LGA_Code', 'Ward', 'Ward_Code',
      'Polling_Unit', 'Polling_Unit_Code', 'Full_PU_Code', 'Status', 'Source',
      'Source_Date', 'Created_At', 'Updated_At'
    ],

    RAW: [
      'Import_ID', 'Source', 'Source_URL', 'Retrieved_At', 'Raw_State', 'Raw_LGA',
      'Raw_Ward', 'Raw_Polling_Unit', 'Raw_State_Code', 'Raw_LGA_Code',
      'Raw_Ward_Code', 'Raw_PU_Code', 'Raw_Expected_Ward_PUs'
    ],

    NORM: [
      'Import_ID', 'State', 'State_Code', 'LGA', 'LGA_Code', 'Ward', 'Ward_Code',
      'Polling_Unit', 'Polling_Unit_Code', 'Full_PU_Code', 'Row_Status', 'Row_Note'
    ],

    // Columns 1-18 follow the specification exactly; 19-21 are additions that
    // make idempotent submissions and fast duplicate checks possible.
    RECORDS: [
      'Record_ID', 'State', 'State_Code', 'Name', 'Position', 'Phone', 'LGA',
      'LGA_Code', 'Ward', 'Ward_Code', 'Polling_Unit', 'Polling_Unit_Code',
      'Verification_Status', 'Duplicate_Flag', 'Submitted_At', 'Updated_At',
      'Submitted_By', 'Notes', 'Submission_Key', 'Normalized_Name', 'Normalized_Phone'
    ],

    AUDIT: ['Log_ID', 'Timestamp', 'User', 'Action', 'Record_ID', 'Old_Value', 'New_Value', 'Result'],

    VALIDATION: ['Log_ID', 'Import_ID', 'Timestamp', 'Severity', 'Code', 'Message', 'Reference'],

    IMPORT: [
      'Import_ID', 'Started_At', 'Finished_At', 'Source', 'Source_URL', 'Trigger',
      'Total_Source_Records', 'Valid_Records', 'Invalid_Records', 'Duplicates',
      'Orphan_Records', 'Final_Master_Records', 'LGAs', 'Wards', 'Polling_Units',
      'Status', 'Published', 'Message'
    ]
  },

  // Format of INEC geographic codes: state/LGA/ward/polling-unit.
  CODE_PATTERNS: {
    LGA: /^\d{2}\/\d{2}$/,
    WARD: /^\d{2}\/\d{2}\/\d{2}$/,
    PU: /^\d{2}\/\d{2}\/\d{2}\/\d{3}$/
  },

  MAX_VALIDATION_LOG_ROWS: 500
};

/** [key, default value, description]. Seeded once; existing values are never overwritten. */
const DEFAULT_CONFIG = [
  ['SYSTEM_NAME', 'TK27 Coordinator Data Collection', 'Display name'],
  ['VERSION', TK27.VERSION, 'Application version'],
  ['APPLICATION_STATUS', 'SETUP', 'SETUP | LIVE | PAUSED'],
  ['ACTIVE_STATE', 'Ogun', 'State currently being collected'],
  ['STATE_CODE', 'OG', 'Short state code used in record IDs'],
  ['INEC_STATE_NO', '27', 'INEC numeric state code (first segment of every INEC code)'],
  ['POSITION_OPTIONS', 'STATE_EXCO,LGA_COORDINATOR,WARD_COORDINATOR', 'Allowed position values'],

  ['MASTER_SOURCE_NAME', 'Nigeria 2.0 (nigeria2.com)', 'Name stored with every master row'],
  ['MASTER_SOURCE_TYPE', 'WEB_THIRD_PARTY', 'WEB_THIRD_PARTY | MANUAL_UPLOAD | OFFICIAL_FILE'],
  ['MASTER_SOURCE_URL', 'https://nigeria2.com/states/ogun/wards', 'Ward index page of the source'],
  ['MASTER_SOURCE_BASE', 'https://nigeria2.com', 'Base URL used to build ward page URLs'],
  ['MASTER_SOURCE_VERIFICATION', 'UNVERIFIED_THIRD_PARTY', 'Set to OFFICIAL only after the data is reconciled with an INEC publication'],

  ['EXPECTED_LGAS', '20', 'INEC published LGA count for the state'],
  ['EXPECTED_WARDS', '236', 'INEC published ward count for the state'],
  ['EXPECTED_PUS', '5042', 'INEC published polling-unit count for the state'],

  ['FETCH_BATCH_SIZE', '10', 'Parallel page requests per batch (be polite to the source)'],
  ['MAX_RUNTIME_SECONDS', '300', 'Abort an import after this long (Apps Script limit is 360s)'],

  ['LAST_MASTER_REFRESH', '', 'When MASTER_GEOGRAPHY was last published'],
  ['MASTER_STATUS', 'NOT_BUILT', 'NOT_BUILT | VALID | WARNING (published master)'],
  ['MASTER_LGAS', '0', 'LGAs in published master'],
  ['MASTER_WARDS', '0', 'Wards in published master'],
  ['MASTER_PUS', '0', 'Polling units in published master'],
  ['MASTER_PUBLISHED_SOURCE', '', 'Source of the published master'],

  ['LAST_IMPORT_AT', '', 'Last import attempt'],
  ['LAST_IMPORT_STATUS', '', 'VALID | WARNING | FAILED'],
  ['LAST_IMPORT_MESSAGE', '', 'Summary of last import attempt']
];

// ---------------------------------------------------------------------------
// CONFIG sheet access
// ---------------------------------------------------------------------------

let CONFIG_CACHE_ = null;

/** Returns all CONFIG values as { KEY: 'value' } (all strings). */
function getConfig_() {
  if (CONFIG_CACHE_) return CONFIG_CACHE_;
  const sheet = getOrCreateSheet_(TK27.SHEETS.CONFIG);
  const config = {};
  DEFAULT_CONFIG.forEach(function (row) { config[row[0]] = row[1]; });
  const last = sheet.getLastRow();
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 2).getValues().forEach(function (row) {
      const key = String(row[0]).trim();
      if (key) config[key] = String(row[1] == null ? '' : row[1]);
    });
  }
  CONFIG_CACHE_ = config;
  return config;
}

function setConfigValue_(key, value) {
  const sheet = getOrCreateSheet_(TK27.SHEETS.CONFIG);
  const last = sheet.getLastRow();
  const text = String(value == null ? '' : value);
  if (last >= 2) {
    const keys = sheet.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < keys.length; i++) {
      if (String(keys[i][0]).trim() === key) {
        sheet.getRange(i + 2, 2).setValue(text);
        CONFIG_CACHE_ = null;
        return;
      }
    }
  }
  sheet.appendRow([key, text, '']);
  CONFIG_CACHE_ = null;
}

function setConfigValues_(map) {
  Object.keys(map).forEach(function (key) { setConfigValue_(key, map[key]); });
}

/** Adds any missing default keys. Never overwrites an existing value. */
function seedConfig_() {
  const sheet = getOrCreateSheet_(TK27.SHEETS.CONFIG);
  const last = sheet.getLastRow();
  const existing = {};
  if (last >= 2) {
    sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (row) {
      existing[String(row[0]).trim()] = true;
    });
  }
  const missing = DEFAULT_CONFIG.filter(function (row) { return !existing[row[0]]; });
  if (missing.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  }
  CONFIG_CACHE_ = null;
}
