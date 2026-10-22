import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-tk27-webhook-secret, x-tk27-dispatch-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};
const RECONCILE_CHUNK_SIZE = 500;
const MAX_RECONCILE_DRAIN_EVENTS = 50;
const RECONCILE_DRAIN_BATCH = 50;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}
function env(name: string): string { return Deno.env.get(name) || ''; }
function namedKey(jsonValue: string): string {
  if (!jsonValue) return '';
  try { const keys = JSON.parse(jsonValue) as Record<string, string>; return keys.default || Object.values(keys)[0] || ''; }
  catch { return ''; }
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
const dispatcherSecret = env('TK27_DISPATCH_SECRET');
const gasUrl = env('GOOGLE_APPS_SCRIPT_URL');
const gasSyncSecret = env('GOOGLE_APPS_SCRIPT_SYNC_SECRET');

let adminDb: ReturnType<typeof createClient> | null = null;
if (supabaseUrl && serviceKey) {
  try { adminDb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } }); }
  catch { adminDb = null; }
}
function getAdminDb() {
  if (!adminDb) throw new Error('Server database secrets are not configured.');
  return adminDb;
}
function createUserClient(jwt: string) {
  if (!anonKey || !supabaseUrl) throw new Error('Supabase public client configuration is missing on the server.');
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
}
async function activeAdminClient(req: Request) {
  const authHeader = req.headers.get('authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || !anonKey || !supabaseUrl || !adminDb) return null;
  const userClient = createUserClient(jwt);
  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData.user) return null;
  const { data, error } = await getAdminDb().from('admin_users')
    .select('user_id,active').eq('user_id', userData.user.id).eq('active', true).maybeSingle();
  return !error && data ? userClient : null;
}

function text(value: unknown, fallback = ''): string {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}
/** Must match recordToSheetRow_ in Apps Script and TK27.HEADERS.RECORDS exactly. */
function toSheetRow(record: Record<string, unknown>): string[] {
  return [
    text(record.record_id), text(record.state, 'Ogun'), text(record.state_code, 'OG'),
    text(record.name), text(record.position), text(record.phone), text(record.lga),
    text(record.lga_code), text(record.ward), text(record.ward_code), text(record.polling_unit),
    text(record.polling_unit_code), text(record.verification_status, 'PENDING'),
    record.duplicate_flag === true || String(record.duplicate_flag).toUpperCase() === 'TRUE' ? 'TRUE' : 'FALSE',
    text(record.submitted_at), text(record.updated_at || record.submitted_at),
    text(record.submitted_by, 'public-form'), text(record.notes), text(record.submission_key),
    text(record.normalized_name), text(record.normalized_phone || record.phone)
  ];
}
async function checksumRows(rows: string[][]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(rows)));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function callAppsScript(body: Record<string, unknown>) {
  if (!gasUrl || !gasSyncSecret) throw new Error('Google Apps Script URL or sync secret is not configured in Supabase Edge Function secrets.');
  const response = await fetch(gasUrl, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...body, syncSecret: gasSyncSecret })
  });
  const responseText = await response.text();
  let decoded: Record<string, unknown>;
  try { decoded = JSON.parse(responseText) as Record<string, unknown>; }
  catch { throw new Error('Apps Script returned a non-JSON response (HTTP ' + response.status + ').'); }
  if (!response.ok || decoded.success !== true) {
    const nested = (decoded.error || {}) as Record<string, unknown>;
    throw new Error(String(nested.message || decoded.message || ('Apps Script request failed with HTTP ' + response.status + '.')));
  }
  return (decoded.data || {}) as Record<string, unknown>;
}

async function processOutbox(row: Record<string, unknown>) {
  const id = Number(row.id);
  if (!Number.isFinite(id)) throw new Error('Outbox event has no valid ID.');
  const nextAttempt = Number(row.attempts || 0) + 1;
  const claim = await getAdminDb().from('sheet_sync_outbox')
    .update({ status: 'PROCESSING', attempts: nextAttempt, last_attempt_at: new Date().toISOString(), last_error: null })
    .eq('id', id).in('status', ['PENDING', 'FAILED']).select('id,payload,event_type,record_id').maybeSingle();
  if (claim.error) throw new Error('Could not claim sync event: ' + claim.error.message);
  if (!claim.data) return { skipped: true, id, reason: 'already processing or synced' };

  try {
    const payload = (claim.data.payload || {}) as Record<string, unknown>;
    const record = (payload.record || {}) as Record<string, unknown>;
    const eventType = String(payload.eventType || claim.data.event_type || '').toUpperCase();
    if (!['INSERT', 'UPDATE', 'DELETE'].includes(eventType)) throw new Error('Unknown record event type.');
    await callAppsScript({
      action: 'syncSupabaseRecord', eventType, outboxId: Number(claim.data.id),
      recordId: String(payload.recordId || claim.data.record_id || ''), record
    });
    const updated = await getAdminDb().from('sheet_sync_outbox').update({
      status: 'SYNCED', synced_at: new Date().toISOString(), last_error: null, payload: {}
    }).eq('id', id).eq('status', 'PROCESSING');
    if (updated.error) throw new Error('Sheet updated, but queue status could not be saved: ' + updated.error.message);
    return { synced: true, id, recordId: claim.data.record_id, eventType };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await getAdminDb().from('sheet_sync_outbox').update({ status: 'FAILED', last_error: message.slice(0, 1500) })
      .eq('id', id).eq('status', 'PROCESSING');
    if (failed.error) throw new Error(message + ' Also failed to record queue error: ' + failed.error.message);
    // A concurrent full reconciliation may already have verified this event into the mirror.
    const current = await getAdminDb().from('sheet_sync_outbox').select('status').eq('id', id).maybeSingle();
    if (current.data?.status === 'SYNCED') return { synced: true, skipped: true, id, reason: 'reconciliation already covered event' };
    throw new Error(message);
  }
}

async function recoverStaleClaims() {
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const recovered = await getAdminDb().from('sheet_sync_outbox')
    .update({ status: 'FAILED', last_error: 'Recovered an event that remained PROCESSING for over 10 minutes.' })
    .eq('status', 'PROCESSING').lt('last_attempt_at', staleCutoff);
  if (recovered.error) throw new Error('Could not recover stuck sync events: ' + recovered.error.message);
}
async function drainQueue(maxEvents: number, minId?: number) {
  let synced = 0; let failed = 0; let skipped = 0; let attempted = 0;
  const outcomes: Array<Record<string, unknown>> = [];
  let cursorId = minId === undefined ? 0 : minId;
  while (attempted < maxEvents) {
    const pending = await getAdminDb().from('sheet_sync_outbox')
      .select('id,event_type,record_id,payload,status,attempts,created_at,last_attempt_at')
      .in('status', ['PENDING', 'FAILED']).gt('id', cursorId)
      .order('id', { ascending: true }).limit(Math.min(RECONCILE_DRAIN_BATCH, maxEvents - attempted));
    if (pending.error) throw new Error('Could not load pending sync events: ' + pending.error.message);
    const rows = (pending.data || []) as Array<Record<string, unknown>>;
    if (!rows.length) break;
    // Advance the cursor before processing. A failed low-ID row must not be selected again
    // during this run and starve later events; it remains durable for the next attempt.
    cursorId = Number(rows[rows.length - 1].id) || cursorId;
    let madeProgress = 0;
    for (const row of rows) {
      attempted++;
      try {
        const result = await processOutbox(row);
        if (result.synced) { synced++; madeProgress++; }
        else skipped++;
        outcomes.push(result);
      } catch (error) {
        failed++;
        outcomes.push({ id: row.id, recordId: row.record_id, error: error instanceof Error ? error.message : String(error) });
      }
      if (attempted >= maxEvents) break;
    }
    if (madeProgress === 0) break; // avoid spinning if another worker owns the remaining rows
  }
  return { synced, failed, skipped, attempted, outcomes };
}
async function countOutstandingQueue() {
  const result = await getAdminDb().from('sheet_sync_outbox')
    .select('id', { count: 'exact', head: true }).in('status', ['PENDING', 'PROCESSING', 'FAILED']);
  if (result.error) throw new Error('Could not verify queue status: ' + result.error.message);
  return Number(result.count || 0);
}

async function reconcileSheetMirror(userClient: ReturnType<typeof createClient>) {
  if (!gasUrl || !gasSyncSecret) throw new Error('Google Apps Script URL or sync secret is not configured in Supabase Edge Function secrets.');
  const reconciliationId = crypto.randomUUID();
  let snapshotId = '';
  let reconciliationBegun = false;
  let sheetFinalized = false;
  try {
    // Pause incrementals at the Sheet receiver BEFORE the database snapshot is taken.
    await callAppsScript({ action: 'syncSupabaseReconciliation', phase: 'begin', reconciliationId });
    reconciliationBegun = true;

    // SQL RPC uses an advisory-lock barrier so the materialised snapshot and outbox
    // watermark represent one consistent point in the coordinator-record history.
    const snapshotResult = await userClient.rpc('admin_create_sheet_sync_snapshot');
    if (snapshotResult.error) throw new Error('Could not create a consistent Supabase snapshot. Apply migration 202610220007_reliable_sheet_reconciliation.sql and verify administrator permissions. Details: ' + snapshotResult.error.message);
    const snapshot = Array.isArray(snapshotResult.data) ? snapshotResult.data[0] : snapshotResult.data;
    if (!snapshot?.job_id) throw new Error('The database returned no reconciliation snapshot.');
    snapshotId = String(snapshot.job_id);
    const expectedCount = Number(snapshot.total_records || 0);
    const highWatermark = Number(snapshot.high_watermark || 0);
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0 || !Number.isSafeInteger(highWatermark) || highWatermark < 0) {
      throw new Error('The database snapshot returned invalid count or outbox watermark values.');
    }

    await callAppsScript({ action: 'syncSupabaseReconciliation', phase: 'configure', reconciliationId, expectedCount, highWatermark });

    const canonicalRows: string[][] = [];
    let chunkIndex = 0;
    for (let offset = 0; offset < expectedCount; offset += RECONCILE_CHUNK_SIZE) {
      const last = Math.min(offset + RECONCILE_CHUNK_SIZE, expectedCount) - 1;
      const batch = await getAdminDb().from('sheet_sync_snapshot_rows')
        .select('record_id,payload').eq('job_id', snapshotId).order('record_id', { ascending: true })
        .range(offset, last);
      if (batch.error) throw new Error('Could not read database snapshot rows: ' + batch.error.message);
      const items = (batch.data || []) as Array<{ record_id: string; payload: Record<string, unknown> }>;
      if (items.length !== last - offset + 1) throw new Error('Snapshot page count mismatch. No sheet replacement was finalised.');
      const records = items.map((item) => item.payload);
      const rows = records.map(toSheetRow);
      canonicalRows.push(...rows);
      const written = await callAppsScript({
        action: 'syncSupabaseReconciliation', phase: 'chunk', reconciliationId, chunkIndex, records
      });
      if (Number(written.received) !== offset + records.length) throw new Error('Apps Script staged-row count does not match the expected chunk boundary.');
      chunkIndex++;
    }
    if (canonicalRows.length !== expectedCount) throw new Error('The number of rows read from Supabase did not match the snapshot total.');
    const expectedChecksum = await checksumRows(canonicalRows);
    const finalResult = await callAppsScript({
      action: 'syncSupabaseReconciliation', phase: 'finish', reconciliationId,
      expectedCount, highWatermark, expectedChecksum
    });
    if (Number(finalResult.sheetCount) !== expectedCount || String(finalResult.sheetChecksum || '') !== expectedChecksum) {
      throw new Error('The Google Sheet did not verify against the Supabase snapshot. Do not treat the mirror as matched.');
    }
    sheetFinalized = true;

    // All outbox events at or below the barrier watermark are represented in the exact snapshot.
    // Mark them synced only AFTER Apps Script has verified the destination sheet checksum.
    const settled = await getAdminDb().from('sheet_sync_outbox').update({
      status: 'SYNCED', synced_at: new Date().toISOString(), last_error: null, payload: {}
    }).lte('id', highWatermark).in('status', ['PENDING', 'FAILED', 'PROCESSING']);
    const queueSettleError = settled.error ? settled.error.message : '';

    const deletedSnapshot = await getAdminDb().from('sheet_sync_snapshot_jobs').delete().eq('id', snapshotId);
    const snapshotCleanupError = deletedSnapshot.error ? deletedSnapshot.error.message : '';

    // New writes after the snapshot are replayed in outbox-ID order. A bounded drain keeps
    // the Edge invocation inside its execution budget; remaining work is still durable/retryable.
    let replay = { synced: 0, failed: 0, skipped: 0, attempted: 0, outcomes: [] as Array<Record<string, unknown>> };
    let remaining = 0;
    try {
      await recoverStaleClaims();
      replay = await drainQueue(MAX_RECONCILE_DRAIN_EVENTS, queueSettleError ? undefined : highWatermark);
      remaining = await countOutstandingQueue();
    } catch (error) {
      replay.failed++;
      replay.outcomes.push({ phase: 'post-snapshot-replay', error: error instanceof Error ? error.message : String(error) });
      try { remaining = await countOutstandingQueue(); } catch { remaining = -1; }
    }

    const matched = remaining === 0 && !queueSettleError;
    return {
      success: true,
      action: 'reconcile',
      status: matched ? 'MATCHED' : 'CATCHING_UP',
      sourceRecords: expectedCount,
      sheetRecords: Number(finalResult.sheetCount),
      sourceChecksum: expectedChecksum,
      sheetChecksum: String(finalResult.sheetChecksum || ''),
      checksumsMatch: true,
      snapshotHighWatermark: highWatermark,
      incrementalReplay: { synced: replay.synced, failed: replay.failed, skipped: replay.skipped, attempted: replay.attempted },
      outstandingEvents: remaining,
      queueSettleWarning: queueSettleError || null,
      snapshotCleanupWarning: snapshotCleanupError || null,
      message: matched
        ? 'Google Sheets matched the verified Supabase snapshot, and no outstanding sync events remained at verification time.'
        : 'The Sheet matches the verified snapshot. Some newer events remain queued; use Retry pending sync and verify the queue reaches zero.'
    };
  } catch (error) {
    const failureMessage = error instanceof Error ? error.message : String(error);
    const rollbackFailed = /rollback also failed|rollback failed/i.test(failureMessage);
    if (reconciliationBegun && !sheetFinalized && !rollbackFailed) {
      try {
        await callAppsScript({ action: 'syncSupabaseReconciliation', phase: 'abort', reconciliationId, reason: failureMessage });
      } catch { /* best effort; Apps Script keeps an active lock if it could not safely restore */ }
    }
    if (snapshotId) {
      try { await getAdminDb().from('sheet_sync_snapshot_jobs').delete().eq('id', snapshotId); } catch { /* best effort cleanup */ }
    }
    throw error;
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
  const suppliedDispatcherSecret = req.headers.get('x-tk27-dispatch-secret') || '';
  const isWebhook = !!webhookSecret && safeEquals(suppliedWebhookSecret, webhookSecret);
  const isDispatcher = !!dispatcherSecret && safeEquals(suppliedDispatcherSecret, dispatcherSecret);

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

  // Fallback dispatcher called by a one-minute Apps Script time trigger. This does not rely
  // on Supabase Database Webhooks / the supabase_functions schema being present.
  if (isDispatcher) {
    if (body.action !== 'dispatch') return json({ error: 'Unknown dispatcher action.' }, 400);
    try {
      await recoverStaleClaims();
      const result = await drainQueue(25);
      const outstanding = await countOutstandingQueue();
      return json({ success: true, mode: 'scheduled-dispatch', ...result, outstandingEvents: outstanding });
    } catch (error) {
      return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }

  const userClient = await activeAdminClient(req);
  if (!userClient) return json({ error: 'Administrator access required.' }, 401);
  if (body.action === 'reconcile') {
    try { return json(await reconcileSheetMirror(userClient)); }
    catch (error) { return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500); }
  }
  if (body.action !== 'retry') return json({ error: 'Unknown action.' }, 400);
  try {
    await recoverStaleClaims();
    const result = await drainQueue(50);
    const outstandingEvents = await countOutstandingQueue();
    return json({ success: true, ...result, outstandingEvents });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
