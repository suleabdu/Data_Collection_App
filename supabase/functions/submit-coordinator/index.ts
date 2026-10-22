import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

type JsonObject = Record<string, unknown>;

function json(body: JsonObject, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function env(name: string): string { return Deno.env.get(name) || ''; }
async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((part) => part.toString(16).padStart(2, '0')).join('');
}
function clientIp(req: Request): string {
  // Supabase's edge gateway supplies cf-connecting-ip / x-real-ip for requests.
  // The raw address is used transiently and only its SHA-256 hash is stored.
  const cfIp = req.headers.get('cf-connecting-ip')?.trim();
  const realIp = req.headers.get('x-real-ip')?.trim();
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return cfIp || realIp || forwarded || '';
}
function safeValidationMessage(code: string, message: string): string {
  if (code === '55000' || /paused/i.test(message)) return 'Registration is temporarily paused. Please try again later.';
  if (/valid position|select a valid position/i.test(message)) return 'Please select a valid coordinator position.';
  if (/first and last name|coordinator.?s name/i.test(message)) return 'Please enter the coordinator’s first and last name.';
  if (/valid Nigerian phone/i.test(message)) return 'Please enter a valid Nigerian phone number.';
  if (/local government|polling unit|selected location|ward/i.test(message)) return 'Please reselect the local government, ward and polling unit.';
  if (/submission key|refresh the form/i.test(message)) return 'This form session could not be validated. Refresh the page and try again.';
  if (code === '22023') return 'Please review the required details and try again.';
  return 'The submission service could not complete this request. Your details remain on the form; please contact the administrator if the problem continues.';
}

const url = env('SUPABASE_URL');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
const adminDb = url && serviceKey ? createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, code: 'METHOD_NOT_ALLOWED', status: 405, message: 'POST requests only.' }, 405);
  if (!adminDb) return json({ success: false, code: 'SUBMISSION_SERVICE_NOT_CONFIGURED', status: 503, message: 'The submission service is not configured. Please contact the administrator.' });

  let body: JsonObject;
  try {
    const length = Number(req.headers.get('content-length') || 0);
    if (length > 16384) return json({ success: false, code: 'REQUEST_TOO_LARGE', status: 413, message: 'The submitted request is too large.' });
    const parsed = await req.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    body = parsed as JsonObject;
  } catch {
    return json({ success: false, code: 'INVALID_REQUEST', status: 400, message: 'The submission request could not be read. Refresh the form and try again.' });
  }

  const ip = clientIp(req);
  if (!ip) {
    return json({ success: false, code: 'RATE_LIMIT_IP_UNAVAILABLE', status: 503, message: 'The submission service cannot verify this request right now. Your form is still here; please try again later.' });
  }

  // A generous per-network burst limit reduces nuisance blocking on shared mobile/carrier networks.
  // The database upsert makes the counter safe across concurrent edge instances.
  const ipHash = await sha256(ip);
  const rate = await adminDb.rpc('consume_tk27_submission_rate_limit', {
    p_ip_hash: ipHash, p_window_seconds: 600, p_max_attempts: 120
  });
  if (rate.error || !rate.data) {
    console.error('[TK27 submit] Rate-limit check failed', { code: rate.error?.code || 'NO_DATA' });
    return json({ success: false, code: 'RATE_LIMIT_CHECK_FAILED', status: 503, message: 'The submission service is temporarily unavailable. Your details remain on this page; please try again later.' });
  }
  if (rate.data.allowed !== true) {
    return json({
      success: false, code: 'RATE_LIMITED', status: 429,
      retryAfterSeconds: Number(rate.data.retryAfterSeconds || 600),
      message: 'Too many submission attempts have come from this network in a short period. Please wait a few minutes and try again.'
    });
  }

  const p = {
    p_position: String(body.p_position || ''),
    p_name: String(body.p_name || ''),
    p_phone: String(body.p_phone || ''),
    p_lga_code: String(body.p_lga_code || ''),
    p_ward_code: String(body.p_ward_code || ''),
    p_pu_code: String(body.p_pu_code || ''),
    p_submission_key: String(body.p_submission_key || ''),
    p_website: String(body.p_website || '')
  };
  const result = await adminDb.rpc('submit_coordinator', p);
  if (result.error) {
    const code = String(result.error.code || '');
    const message = String(result.error.message || '');
    console.error('[TK27 submit] Database RPC failed', { code: code || 'UNSPECIFIED' });
    if (code === '23505') {
      return json({ success: false, code: '23505', status: 409, message: 'The database could not allocate a unique record reference. No submission was confirmed. Please contact the administrator and avoid repeated attempts.' });
    }
    if (code === '42501') {
      return json({ success: false, code: '42501', status: 403, message: 'The submission service is not authorised to complete this request. Please contact the administrator.' });
    }
    return json({ success: false, code: code || 'SUBMISSION_SERVICE_ERROR', status: 400, message: safeValidationMessage(code, message) });
  }

  const data = result.data as JsonObject | null;
  if (!data || typeof data !== 'object') {
    return json({ success: false, code: 'INVALID_SUBMISSION_RESPONSE', status: 502, message: 'The submission service returned an unexpected response. Your form is still here; please contact the administrator before retrying.' });
  }
  return json(data);
});
