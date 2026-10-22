-- TK27 reliable, exact Supabase -> Google Sheets mirror reconciliation.
-- Apply after migrations 001-006. This migration does not modify coordinator data.

create table if not exists public.sheet_sync_snapshot_jobs (
  id uuid primary key,
  high_watermark bigint not null default 0,
  total_records bigint not null default 0,
  created_by uuid,
  status text not null default 'READY' check (status in ('READY','COMPLETE','FAILED')),
  created_at timestamptz not null default now()
);

create table if not exists public.sheet_sync_snapshot_rows (
  job_id uuid not null references public.sheet_sync_snapshot_jobs(id) on delete cascade,
  record_id text not null,
  payload jsonb not null,
  primary key (job_id, record_id)
);

alter table public.sheet_sync_snapshot_jobs enable row level security;
alter table public.sheet_sync_snapshot_rows enable row level security;
revoke all on public.sheet_sync_snapshot_jobs from public, anon, authenticated;
revoke all on public.sheet_sync_snapshot_rows from public, anon, authenticated;
grant select, insert, update, delete on public.sheet_sync_snapshot_jobs to service_role;
grant select, insert, update, delete on public.sheet_sync_snapshot_rows to service_role;

-- Every record-writing transaction takes a shared transaction lock BEFORE changing a row.
-- Snapshot generation takes the exclusive lock, waiting for earlier writers and preventing
-- new writers from changing coordinator_records until the database snapshot is materialised.
create or replace function public.lock_coordinator_change_for_sheet_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock_shared(27127, 7007);
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
revoke all on function public.lock_coordinator_change_for_sheet_snapshot() from public, anon, authenticated;
drop trigger if exists coordinator_records_snapshot_barrier on public.coordinator_records;
create trigger coordinator_records_snapshot_barrier
before insert or update or delete on public.coordinator_records
for each row execute function public.lock_coordinator_change_for_sheet_snapshot();

-- Materialise records and queue watermark in the same statement snapshot. The exclusive
-- advisory lock guarantees that all committed record changes through the watermark are
-- represented in coordinator_records, and all later writes receive later outbox events.
create or replace function public.admin_create_sheet_sync_snapshot()
returns table(job_id uuid, high_watermark bigint, total_records bigint)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_job_id uuid := gen_random_uuid();
begin
  if not public.is_tk27_admin() then
    raise exception 'Administrator access required.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(27127, 7007);

  -- Remove snapshots abandoned by terminated Edge Function runs.
  delete from public.sheet_sync_snapshot_jobs
  where created_at < now() - interval '6 hours';

  return query
  with created as (
    insert into public.sheet_sync_snapshot_jobs as j(id, high_watermark, total_records, created_by, status)
    select v_job_id,
           coalesce((select max(o.id) from public.sheet_sync_outbox o), 0),
           (select count(*) from public.coordinator_records),
           auth.uid(), 'READY'
    returning j.id, j.high_watermark, j.total_records
  ), copied as (
    insert into public.sheet_sync_snapshot_rows(job_id, record_id, payload)
    select created.id, r.record_id, to_jsonb(r)
    from public.coordinator_records r
    cross join created
    returning record_id
  )
  select created.id, created.high_watermark, created.total_records
  from created
  where (select count(*) from copied) = created.total_records;
end;
$$;
revoke all on function public.admin_create_sheet_sync_snapshot() from public, anon;
grant execute on function public.admin_create_sheet_sync_snapshot() to authenticated;

comment on table public.sheet_sync_snapshot_jobs is
  'Short-lived server-only snapshots used to make COORDINATOR_RECORDS in Google Sheets exactly match Supabase.';
comment on table public.sheet_sync_snapshot_rows is
  'Materialised coordinator rows for a single reconciliation job; only the service role can read the snapshot payloads.';
comment on function public.admin_create_sheet_sync_snapshot() is
  'Active-admin-only consistent snapshot creation using an advisory-lock barrier with coordinator writes.';
