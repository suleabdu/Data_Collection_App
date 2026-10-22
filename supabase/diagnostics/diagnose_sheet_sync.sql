-- Read-only TK27 Google Sheets sync diagnostic. Does not return coordinator names or phone numbers.

select status, count(*) as event_count, min(id) as oldest_event_id, max(id) as newest_event_id,
       min(created_at) as oldest_created_at, max(created_at) as newest_created_at
from public.sheet_sync_outbox
group by status
order by status;

select id, event_type, record_id, status, attempts, created_at, last_attempt_at,
       synced_at, left(coalesce(last_error, ''), 500) as last_error
from public.sheet_sync_outbox
where status in ('PENDING', 'PROCESSING', 'FAILED')
order by id asc
limit 100;

select count(*) as supabase_coordinator_records from public.coordinator_records;

select id, high_watermark, total_records, status, created_at
from public.sheet_sync_snapshot_jobs
order by created_at desc
limit 20;

select count(*) as snapshot_rows
from public.sheet_sync_snapshot_rows;
