-- TK27 admin coverage analytics. Apply after migrations 001-003.
-- Every analytical RPC is restricted to active TK27 administrators.
create index if not exists idx_coordinator_coverage_rollup
  on public.coordinator_records(lga_code, ward_code, position, verification_status, polling_unit_code);
create index if not exists idx_master_valid_coverage
  on public.master_geography(lga_code, ward_code, full_pu_code) where status = 'VALID';


create or replace function public.admin_coverage_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare v_result jsonb;
begin
  if not public.is_tk27_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  with valid_geo as (
    select distinct lga_code, lga, ward_code, full_pu_code, polling_unit_code
    from public.master_geography where status = 'VALID'
  ), valid_wards as (
    select distinct lga_code, ward_code from valid_geo
  ), submitted_wards as (
    select distinct r.lga_code, r.ward_code
    from public.coordinator_records r
    join valid_wards w on w.lga_code = r.lga_code and w.ward_code = r.ward_code
    where r.position = 'WARD_COORDINATOR' and r.verification_status <> 'REJECTED'
  ), verified_wards as (
    select distinct r.lga_code, r.ward_code
    from public.coordinator_records r
    join valid_wards w on w.lga_code = r.lga_code and w.ward_code = r.ward_code
    where r.position = 'WARD_COORDINATOR' and r.verification_status = 'VERIFIED'
  ), represented_pus as (
    select distinct g.full_pu_code
    from valid_geo g
    join public.coordinator_records r on r.lga_code = g.lga_code
      and r.ward_code = g.ward_code and r.polling_unit_code = g.polling_unit_code
    where r.position = 'WARD_COORDINATOR' and r.verification_status <> 'REJECTED'
  ), totals as (
    select
      (select count(distinct lga_code) from valid_geo) as official_lgas,
      (select count(*) from valid_wards) as official_wards,
      (select count(*) from submitted_wards) as covered_wards,
      (select count(*) from verified_wards) as verified_covered_wards,
      (select count(distinct full_pu_code) from valid_geo) as official_polling_units,
      (select count(*) from represented_pus) as represented_polling_units,
      (select count(*) from public.coordinator_records) as total_records
  )
  select jsonb_build_object(
    'officialLgas', official_lgas,
    'officialWards', official_wards,
    'coveredWards', covered_wards,
    'verifiedCoveredWards', verified_covered_wards,
    'uncoveredWards', greatest(official_wards - covered_wards, 0),
    'submissionCoveragePercent', case when official_wards = 0 then 0 else round(covered_wards * 100.0 / official_wards, 1) end,
    'verifiedCoveragePercent', case when official_wards = 0 then 0 else round(verified_covered_wards * 100.0 / official_wards, 1) end,
    'officialPollingUnits', official_polling_units,
    'representedPollingUnits', represented_polling_units,
    'pollingUnitCoveragePercent', case when official_polling_units = 0 then 0 else round(represented_polling_units * 100.0 / official_polling_units, 1) end,
    'totalRecords', total_records
  ) into v_result from totals;

  return v_result;
end;
$$;

create or replace function public.admin_lga_coverage()
returns table(
  lga_code text,
  lga text,
  total_wards bigint,
  covered_wards bigint,
  verified_covered_wards bigint,
  uncovered_wards bigint,
  total_polling_units bigint,
  represented_polling_units bigint,
  coverage_percent numeric,
  verified_coverage_percent numeric
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_tk27_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  return query
  with valid_geo as (
    select distinct lga_code, lga, ward_code, full_pu_code, polling_unit_code
    from public.master_geography where status = 'VALID'
  ), lga_totals as (
    select g.lga_code, max(g.lga) as lga,
      count(distinct g.ward_code)::bigint as total_wards,
      count(distinct g.full_pu_code)::bigint as total_polling_units
    from valid_geo g group by g.lga_code
  ), valid_wards as (
    select distinct lga_code, ward_code from valid_geo
  ), ward_flags as (
    select r.lga_code, r.ward_code,
      bool_or(r.verification_status <> 'REJECTED') as has_submission,
      bool_or(r.verification_status = 'VERIFIED') as has_verified
    from public.coordinator_records r
    join valid_wards w on w.lga_code = r.lga_code and w.ward_code = r.ward_code
    where r.position = 'WARD_COORDINATOR'
    group by r.lga_code, r.ward_code
  ), ward_counts as (
    select w.lga_code,
      (count(*) filter (where coalesce(f.has_submission, false)))::bigint as covered_wards,
      (count(*) filter (where coalesce(f.has_verified, false)))::bigint as verified_covered_wards
    from valid_wards w left join ward_flags f on f.lga_code=w.lga_code and f.ward_code=w.ward_code
    group by w.lga_code
  ), pu_counts as (
    select g.lga_code, count(distinct g.full_pu_code)::bigint as represented_polling_units
    from valid_geo g join public.coordinator_records r on r.lga_code=g.lga_code
      and r.ward_code=g.ward_code and r.polling_unit_code=g.polling_unit_code
    where r.position='WARD_COORDINATOR' and r.verification_status <> 'REJECTED'
    group by g.lga_code
  )
  select t.lga_code, t.lga, t.total_wards,
    coalesce(wc.covered_wards,0), coalesce(wc.verified_covered_wards,0),
    greatest(t.total_wards-coalesce(wc.covered_wards,0),0),
    t.total_polling_units, coalesce(pc.represented_polling_units,0),
    case when t.total_wards=0 then 0::numeric else round(coalesce(wc.covered_wards,0)*100.0/t.total_wards,1) end,
    case when t.total_wards=0 then 0::numeric else round(coalesce(wc.verified_covered_wards,0)*100.0/t.total_wards,1) end
  from lga_totals t
  left join ward_counts wc on wc.lga_code=t.lga_code
  left join pu_counts pc on pc.lga_code=t.lga_code
  order by t.lga;
end;
$$;

create or replace function public.admin_lga_ward_coverage(p_lga_code text)
returns table(
  lga_code text,
  ward_code text,
  ward text,
  total_polling_units bigint,
  represented_polling_units bigint,
  coordinator_records bigint,
  verified_coordinator_records bigint,
  coverage_status text,
  latest_submission_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_tk27_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;
  if coalesce(btrim(p_lga_code),'') = '' then
    raise exception using errcode = '22023', message = 'Select a local government area.';
  end if;

  return query
  with geo_wards as (
    select g.lga_code, g.ward_code, max(g.ward) as ward,
      count(distinct g.full_pu_code)::bigint as total_polling_units
    from public.master_geography g
    where g.status='VALID' and g.lga_code=p_lga_code
    group by g.lga_code, g.ward_code
  ), rec as (
    select r.lga_code, r.ward_code,
      count(*) filter(where r.verification_status <> 'REJECTED')::bigint as coordinator_records,
      count(*) filter(where r.verification_status = 'VERIFIED')::bigint as verified_coordinator_records,
      count(distinct r.polling_unit_code) filter(where r.verification_status <> 'REJECTED')::bigint as represented_polling_units,
      max(r.submitted_at) filter(where r.verification_status <> 'REJECTED') as latest_submission_at
    from public.coordinator_records r
    where r.position='WARD_COORDINATOR' and r.lga_code=p_lga_code
    group by r.lga_code, r.ward_code
  )
  select g.lga_code, g.ward_code, g.ward, g.total_polling_units,
    coalesce(r.represented_polling_units,0), coalesce(r.coordinator_records,0),
    coalesce(r.verified_coordinator_records,0),
    case when coalesce(r.verified_coordinator_records,0)>0 then 'VERIFIED'
         when coalesce(r.coordinator_records,0)>0 then 'COVERED'
         else 'UNCOVERED' end,
    r.latest_submission_at
  from geo_wards g left join rec r on r.lga_code=g.lga_code and r.ward_code=g.ward_code
  order by g.ward;
end;
$$;

create or replace function public.admin_recent_activity_3d()
returns table(
  activity_date date,
  submissions bigint,
  verified_changes bigint,
  rejected_changes bigint,
  newly_covered_wards bigint
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_tk27_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  return query
  with bounds as (
    select (now() at time zone 'Africa/Lagos')::date as today
  ), dates as (
    select (b.today - series.day_offset)::date as activity_date
    from bounds b cross join generate_series(0,2) as series(day_offset)
  ), submitted as (
    select (r.submitted_at at time zone 'Africa/Lagos')::date as activity_date,
      count(*)::bigint as submissions
    from public.coordinator_records r, bounds b
    where (r.submitted_at at time zone 'Africa/Lagos')::date between b.today-2 and b.today
    group by (r.submitted_at at time zone 'Africa/Lagos')::date
  ), changes as (
    select (a.created_at at time zone 'Africa/Lagos')::date as activity_date,
      count(*) filter(where a.new_value->>'verification_status'='VERIFIED')::bigint as verified_changes,
      count(*) filter(where a.new_value->>'verification_status'='REJECTED')::bigint as rejected_changes
    from public.audit_log a, bounds b
    where a.action='RECORD_UPDATE'
      and a.old_value->>'verification_status' is distinct from a.new_value->>'verification_status'
      and (a.created_at at time zone 'Africa/Lagos')::date between b.today-2 and b.today
    group by (a.created_at at time zone 'Africa/Lagos')::date
  ), first_coverage as (
    select r.lga_code, r.ward_code,
      min((r.submitted_at at time zone 'Africa/Lagos')::date) as first_date
    from public.coordinator_records r
    join public.master_geography g on g.status='VALID' and g.lga_code=r.lga_code and g.ward_code=r.ward_code
    where r.position='WARD_COORDINATOR' and r.verification_status <> 'REJECTED'
    group by r.lga_code, r.ward_code
  ), new_coverage as (
    select first_date as activity_date, count(*)::bigint as newly_covered_wards
    from first_coverage, bounds b where first_date between b.today-2 and b.today
    group by first_date
  )
  select d.activity_date, coalesce(s.submissions,0), coalesce(c.verified_changes,0),
    coalesce(c.rejected_changes,0), coalesce(n.newly_covered_wards,0)
  from dates d
  left join submitted s on s.activity_date=d.activity_date
  left join changes c on c.activity_date=d.activity_date
  left join new_coverage n on n.activity_date=d.activity_date
  order by d.activity_date desc;
end;
$$;

revoke all on function public.admin_coverage_summary() from public, anon;
revoke all on function public.admin_lga_coverage() from public, anon;
revoke all on function public.admin_lga_ward_coverage(text) from public, anon;
revoke all on function public.admin_recent_activity_3d() from public, anon;
grant execute on function public.admin_coverage_summary() to authenticated;
grant execute on function public.admin_lga_coverage() to authenticated;
grant execute on function public.admin_lga_ward_coverage(text) to authenticated;
grant execute on function public.admin_recent_activity_3d() to authenticated;
