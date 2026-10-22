-- TK27 admin bulk actions. Apply after the base schema and duplicate-prevention patch.
-- All actions require an active Supabase Auth administrator. Existing row triggers
-- write the audit trail and queue Google Sheets mirror events for updates/deletes.

create or replace function public.admin_bulk_record_action(
  p_record_ids text[],
  p_action text
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_ids text[];
  v_requested integer;
  v_affected integer := 0;
begin
  if not public.is_tk27_admin() then
    raise exception using errcode = '42501', message = 'Administrator access required.';
  end if;

  if v_action not in ('VERIFY', 'REJECT', 'DELETE') then
    raise exception using errcode = '22023', message = 'Unsupported bulk action.';
  end if;

  if p_record_ids is null or cardinality(p_record_ids) = 0 then
    raise exception using errcode = '22023', message = 'Select at least one record.';
  end if;

  v_requested := cardinality(p_record_ids);
  if v_requested > 500 then
    raise exception using errcode = '22023', message = 'Bulk actions are limited to 500 records at a time.';
  end if;

  select array_agg(q.record_id order by q.record_id)
    into v_ids
  from (
    select distinct btrim(x) as record_id
    from unnest(p_record_ids) as u(x)
    where nullif(btrim(x), '') is not null
  ) q;

  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception using errcode = '22023', message = 'No valid record IDs were supplied.';
  end if;

  if v_action = 'VERIFY' then
    update public.coordinator_records
      set verification_status = 'VERIFIED'
      where record_id = any(v_ids) and verification_status <> 'VERIFIED';
    get diagnostics v_affected = row_count;
  elsif v_action = 'REJECT' then
    update public.coordinator_records
      set verification_status = 'REJECTED'
      where record_id = any(v_ids) and verification_status <> 'REJECTED';
    get diagnostics v_affected = row_count;
  else
    delete from public.coordinator_records
      where record_id = any(v_ids);
    get diagnostics v_affected = row_count;
  end if;

  return jsonb_build_object(
    'success', true,
    'action', v_action,
    'affected_count', v_affected,
    'requested_count', cardinality(v_ids)
  );
end;
$$;

revoke all on function public.admin_bulk_record_action(text[], text) from public;
grant execute on function public.admin_bulk_record_action(text[], text) to authenticated;
