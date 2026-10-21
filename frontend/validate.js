// Client-side checks for instant feedback. The backend repeats every one of them; it never trusts this file.
// Works in the browser (window.TK27_VALIDATE) and in Node (module.exports) so tests can compare it with the server.
(function (root) {
  'use strict';

  function normalizePhone(input) {
    var raw = String(input == null ? '' : input).replace(/[\s\-().]/g, '');
    if (!raw) return '';
    var national;
    if (raw.indexOf('+234') === 0) national = raw.slice(4);
    else if (raw.indexOf('234') === 0 && raw.length >= 13) national = raw.slice(3);
    else if (raw.charAt(0) === '0') national = raw.slice(1);
    else national = raw;
    if (national.charAt(0) === '0' && national.length === 11) national = national.slice(1);
    return /^[789][01]\d{8}$/.test(national) ? '+234' + national : '';
  }

  function isValidName(value) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (text.length < 3 || text.length > 100) return false;
    if (!/^\p{L}[\p{L}\s'.\-]*$/u.test(text)) return false;
    if (text.split(' ').filter(Boolean).length < 2) return false;
    return text.replace(/[^\p{L}]/gu, '').length >= 3;
  }

  var api = { normalizePhone: normalizePhone, isValidName: isValidName };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TK27_VALIDATE = api;
})(typeof window !== 'undefined' ? window : this);
