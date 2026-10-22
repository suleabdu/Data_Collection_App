import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-tk27-webhook-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function env(name: string): string {
  return Deno.env.get(name) || '';
}
function namedKey(jsonValue: string): string {
  if (!jsonValue) return '';
  try {
    const keys = JSON.parse(jsonValue) as Record<string, string>;
    return keys.default || Object.values(keys)[0] || '';
  } catch { return ''; }
}
function safeEquals(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let delta = 0;
  for (let i = 0; i < a.length; i++) delta |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return delta === 0;
}

const supabaseUrl = env('SUPABASE_URL');
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY') || namedKey(env('SUPABASE_SECRET_KEYS'));
const anonKey = env('SUPABASE_ANON_KEY') || namedKey(env('SUPABASE_PUBLISHABLE_KEYS'));
const webhookSecret = env('TK27_WEBHOOK_SECRET');
const gasUrl = env('GOOGLE_APPS_SCRIPT_URL');
const gasSyncSecret = env('GOOGLE_APPS_SCRIPT_SYNC_SECRET');

let adminDb: ReturnType<typeof createClient> | null = null;
if (supabaseUrl && serviceKey) {
  try {
    adminDb = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  } catch {
    adminDb = null;
  }
}
function getAdminDb() {
  if (!adminDb) throw new Error('Server database secrets are not configured.');
  return adminDb;
}

async function isActiveAdmin(req: Request): Promise<boolean> {
  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || !anonKey || !supabaseUrl || !adminDb) return false;
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user) return false;
  const { data, error } = await getAdminDb().from('admin_users')
    .select('user_id,active').eq('user_id', userData.user.id).eq('active', true).maybeSingle();
  return !error && !!data;
}

async function processOutbox(row: Record<string, unknown>) {
  const id = Number(row.id);
  if (!Number.isFinite(id)) throw new Error('Outbox event has no valid ID.');

  // Claim only a pending/failed row. Duplicate webhook deliveries safely become no-ops.
  const nextAttempt = Number(row.attempts || 0) + 1;
  const claim = await getAdminDb().from('sheet_sync_outbox')
    .update({ status: 'PROCESSING', attempts: nextAttempt, last_attempt_at: new Date().toISOString(), last_error: null })
    .eq('id', id).in('status', ['PENDING', 'FAILED']).select('id,payload,event_type,record_id').maybeSingle();
  if (claim.error) throw new Error('Could not claim sync event: ' + claim.error.message);
  if (!claim.data) return { skipped: true, id, reason: 'already processing or synced' };

  try {
    if (!gasUrl || !gasSyncSecret) throw new Error('Google Apps Script sync URL or secret is not configured in Edge Function secrets.');
    const payload = (claim.data.payload || {}) as Record<string, unknown>;
    const record = (payload.record || {}) as Record<string, unknown>;
    const eventType = String(payload.eventType || claim.data.event_type || '').toUpperCase();
    if (!['INSERT', 'UPDATE', 'DELETE'].includes(eventType)) throw new Error('Unknown record event type.');

    const gasResponse = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'syncSupabaseRecord',
        syncSecret: gasSyncSecret,
        eventType,
        outboxId: Number(claim.data.id),
        recordId: String(payload.recordId || claim.data.record_id || ''),
        record
      })
    });
    const responseText = await gasResponse.text();
    let decoded: Record<string, unknown>;
    try { decoded = JSON.parse(responseText) as Record<string, unknown>; }
    catch { throw new Error('Apps Script returned a non-JSON response (HTTP ' + gasResponse.status + ').'); }
    if (!gasResponse.ok || decoded.success !== true) {
      const nested = (decoded.error || {}) as Record<string, unknown>;
      throw new Error(String(nested.message || decoded.message || ('Apps Script sync failed with HTTP ' + gasResponse.status + '.')));
    }
    const update = await getAdminDb().from('sheet_sync_outbox').update({
      status: 'SYNCED', synced_at: new Date().toISOString(), last_error: null, payload: {}
    }).eq('id', id);
    if (update.error) throw new Error('Sheet updated, but queue status could not be saved: ' + update.error.message);
    return { synced: true, id, recordId: claim.data.record_id, eventType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await getAdminDb().from('sheet_sync_outbox').update({ status: 'FAILED', last_error: message.slice(0, 1500) }).eq('id', id);
    throw new Error(message);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405);
  if (!supabaseUrl || !serviceKey || !adminDb) return json({ error: 'Server database secrets are not configured.' }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return json({ error: 'Request body must be JSON.' }, 400); }

  const suppliedWebhookSecret = req.headers.get('x-tk27-webhook-secret') || '';
  const isWebhook = !!webhookSecret && safeEquals(suppliedWebhookSecret, webhookSecret);

  if (isWebhook) {
    const event = ((body.record || {}) as Record<string, unknown>);
    if (body.table !== 'sheet_sync_outbox' || !event.id) return json({ accepted: false, error: 'Unexpected webhook payload.' }, 400);
    try {
      const result = await processOutbox(event);
      return json({ accepted: true, ...result });
    } catch (error) {
      return json({ accepted: true, synced: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  // Browser-initiated retries require a valid Supabase session and an active admin_users row.
  if (!(await isActiveAdmin(req))) return json({ error: 'Administrator access required.' }, 401);
  if (body.action !== 'retry') return json({ error: 'Unknown action.' }, 400);

  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recovered = await getAdminDb().from('sheet_sync_outbox')
    .update({ status: 'FAILED', last_error: 'Recovered a sync event that remained PROCESSING for over 10 minutes.' })
    .eq('status', 'PROCESSING').lt('last_attempt_at', staleCutoff);
  if (recovered.error) return json({ error: 'Could not recover stuck sync events: ' + recovered.error.message }, 500);

  const pending = await getAdminDb().from('sheet_sync_outbox')
    .select('id,event_type,record_id,payload,status,attempts,created_at')
    .in('status', ['PENDING', 'FAILED']).order('created_at', { ascending: true }).limit(100);
  if (pending.error) return json({ error: 'Could not load pending sync events: ' + pending.error.message }, 500);

  let synced = 0; let failed = 0; let skipped = 0;
  const outcomes: Array<Record<string, unknown>> = [];
  for (const row of (pending.data || []) as Array<Record<string, unknown>>) {
    try {
      const result = await processOutbox(row);
      if (result.synced) synced++; else skipped++;
      outcomes.push(result);
    } catch (error) {
      failed++;
      outcomes.push({ id: row.id, recordId: row.record_id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return json({ synced, failed, skipped, attempted: (pending.data || []).length, outcomes });
});
