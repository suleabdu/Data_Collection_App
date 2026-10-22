-- TK27 public submission hardening: rate limit requests at the server boundary and
-- remove direct anon/authenticated EXECUTE access to the record-insertion RPC.
-- Apply after migrations 001-005 and after historical imports are complete.

create table if not exists public.submission_rate_limits (
  ip_hash text primary key check (ip_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists idx_submission_rate_limits_updated_at
  on public.submission_rate_limits(updated_at);

alter table public.submission_rate_limits enable row level security;
revoke all on table public.submission_rate_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.submission_rate_limits to service_role;

create or replace function public.consume_tk27_submission_rate_limit(
  p_ip_hash text, p_window_seconds integer default 600, p_max_attempts integer default 120
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window integer := greatest(60, least(coalesce(p_window_seconds, 600), 3600));
  v_limit integer := greatest(5, least(coalesce(p_max_attempts, 120), 500));
  v_started timestamptz;
  v_attempts integer;
  v_retry_after integer;
begin
  if coalesce(p_ip_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid rate-limit key.';
  end if;

  -- Opportunistic cleanup keeps only a short history of hashed client identifiers.
  if random() < 0.01 then
    delete from public.submission_rate_limits
    where updated_at < now() - interval '2 days';
  end if;

  insert into public.submission_rate_limits as current_window
    (ip_hash, window_started_at, attempt_count, updated_at)
  values (p_ip_hash, now(), 1, now())
  on conflict (ip_hash) do update set
    window_started_at = case
      when current_window.window_started_at <= now() - make_interval(secs => v_window) then now()
      else current_window.window_started_at
    end,
    attempt_count = case
      when current_window.window_started_at <= now() - make_interval(secs => v_window) then 1
      else least(current_window.attempt_count + 1, v_limit + 1)
    end,
    updated_at = now()
  returning window_started_at, attempt_count into v_started, v_attempts;

  v_retry_after := greatest(1, ceil(extract(epoch from (v_started + make_interval(secs => v_window) - now())))::integer);
  return jsonb_build_object(
    'allowed', v_attempts <= v_limit,
    'attemptsRemaining', greatest(v_limit - v_attempts, 0),
    'retryAfterSeconds', case when v_attempts <= v_limit then 0 else v_retry_after end
  );
end;
$$;

revoke all on function public.consume_tk27_submission_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_tk27_submission_rate_limit(text, integer, integer) to service_role;

-- Browser clients must submit through the Edge Function, which limits request rates.
-- The server-side function uses a service-role client after applying this limiter.
revoke all on function public.submit_coordinator(text,text,text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.submit_coordinator(text,text,text,text,text,text,text,text) to service_role;
