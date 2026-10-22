(function () {
  'use strict';
  var config = window.TK27_CONFIG || {};
  var configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.SUPABASE_URL || '') &&
    !!config.SUPABASE_ANON_KEY && !/YOUR_|CHANGE_ME|PLACEHOLDER/i.test(config.SUPABASE_ANON_KEY);
  window.TK27_DB_READY = configured && !!(window.supabase && window.supabase.createClient);
  window.TK27_DB = window.TK27_DB_READY
    ? window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;
})();
