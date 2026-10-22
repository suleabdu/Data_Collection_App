-- TK27 record ID allocator optimisation. Apply after migrations 001-004 and after
-- importing historical coordinator records. This reconciles existing counters once,
-- then allocates each future ID atomically without scanning coordinator_records.
create index if not exists idx_coordinator_coverage_rollup
  on public.coordinator_records(lga_code, ward_code, position, verification_status, polling_unit_code);
create index if not exists idx_master_valid_coverage
  on public.master_geography(lga_code, ward_code, full_pu_code) where status = 'VALID';

with parsed_ids as (
  select regexp_replace(record_id, '[0-9]+$', '') as prefix,
         substring(record_id from '([0-9]+)$')::bigint as sequence_value
  from public.coordinator_records
  where record_id ~ '^[A-Z0-9]+-(EXCO|LGA|WC)-[0-9]+$'
), maxima as (
  select prefix, max(sequence_value) as max_sequence from parsed_ids group by prefix
)
insert into public.record_sequences(prefix, last_value)
select prefix, max_sequence from maxima
on conflict (prefix) do update
set last_value = greatest(public.record_sequences.last_value, excluded.last_value);

create or replace function public.submit_coordinator(
  p_position text,p_name text,p_phone text,p_lga_code text,p_ward_code text,p_pu_code text,p_submission_key text,p_website text default ''
) returns jsonb language plpgsql security definer set search_path=public,auth as $$
declare
  v_state text; v_state_code text; v_app_status text; v_name text:=btrim(coalesce(p_name,''));
  v_position text:=upper(btrim(coalesce(p_position,''))); v_digits text; v_phone text; v_normalized_name text;
  v_geo public.master_geography%rowtype; v_prefix text; v_sequence bigint; v_record_id text;
  v_matches text[]; v_duplicate boolean:=false; v_notes text:=''; v_existing public.coordinator_records%rowtype;
begin
  if coalesce(p_website,'')<>'' then raise exception using errcode='22023',message='Unable to submit this record.'; end if;
  if coalesce(p_submission_key,'') !~ '^[A-Za-z0-9-]{16,64}$' then raise exception using errcode='22023',message='Please refresh the form and try again.'; end if;
  select value into v_app_status from public.app_settings where key='APPLICATION_STATUS';
  if v_app_status='PAUSED' then raise exception using errcode='55000',message='Data collection is paused at the moment. Please try again later.'; end if;
  if v_position not in ('STATE_EXCO','LGA_COORDINATOR','WARD_COORDINATOR') then raise exception using errcode='22023',message='Please select a valid position.'; end if;
  if length(v_name)<4 or length(v_name)>100 or array_length(regexp_split_to_array(v_name,'\s+'),1)<2 then raise exception using errcode='22023',message='Please enter the coordinator’s first and last name.'; end if;
  v_digits:=regexp_replace(coalesce(p_phone,''),'\D','','g');
  if length(v_digits)=11 and left(v_digits,1)='0' then v_phone:='+234'||substr(v_digits,2);
  elsif length(v_digits)=13 and left(v_digits,3)='234' then v_phone:='+'||v_digits;
  elsif length(v_digits)=10 and left(v_digits,1) in ('7','8','9') then v_phone:='+234'||v_digits;
  else raise exception using errcode='22023',message='Please enter a valid Nigerian phone number.'; end if;
  if v_phone !~ '^\+234[789][0-9]{9}$' then raise exception using errcode='22023',message='Please enter a valid Nigerian phone number.'; end if;
  if coalesce(p_lga_code,'')='' or coalesce(p_ward_code,'')='' or coalesce(p_pu_code,'')='' then raise exception using errcode='22023',message='Please select a local government, ward and polling unit.'; end if;
  select * into v_geo from public.master_geography g where g.full_pu_code=p_pu_code and g.lga_code=p_lga_code and g.ward_code=p_ward_code and g.status='VALID' limit 1;
  if not found then raise exception using errcode='22023',message='The selected location is not valid. Please choose it again.'; end if;
  select * into v_existing from public.coordinator_records where submission_key=p_submission_key limit 1;
  if found then
    return jsonb_build_object('success',true,'submitted',true,'alreadySubmitted',true,
      'recordId',v_existing.record_id,'duplicate',v_existing.duplicate_flag,
      'summary',jsonb_build_object('name',v_existing.name,'position',v_existing.position,'phone',v_existing.phone,'lga',v_existing.lga,'ward',v_existing.ward,'pollingUnit',v_existing.polling_unit));
  end if;
  v_normalized_name:=public.normalize_tk27_name(v_name);
  -- Serialise submissions that could collide on the defined duplicate keys. This makes
  -- same-phone/name duplicates visible even when two people submit at almost the same time.
  perform pg_advisory_xact_lock(hashtextextended('phone:'||v_phone, 0));
  perform pg_advisory_xact_lock(hashtextextended('name-position:'||v_normalized_name||':'||v_position, 0));
  perform pg_advisory_xact_lock(hashtextextended('name-location:'||v_normalized_name||':'||v_geo.lga_code||':'||v_geo.ward_code||':'||v_geo.polling_unit_code, 0));
  -- Recheck the idempotency key after any lock wait. Another request may have completed it.
  select * into v_existing from public.coordinator_records where submission_key=p_submission_key limit 1;
  if found then
    return jsonb_build_object('success',true,'submitted',true,'alreadySubmitted',true,
      'recordId',v_existing.record_id,'duplicate',v_existing.duplicate_flag,
      'summary',jsonb_build_object('name',v_existing.name,'position',v_existing.position,'phone',v_existing.phone,'lga',v_existing.lga,'ward',v_existing.ward,'pollingUnit',v_existing.polling_unit));
  end if;
  select array_agg(hit.record_id order by hit.submitted_at desc) into v_matches from (
    select r.record_id,r.submitted_at from public.coordinator_records r
    where r.normalized_phone=v_phone or (r.normalized_name=v_normalized_name and r.position=v_position)
      or (r.normalized_name=v_normalized_name and r.lga_code=v_geo.lga_code and r.ward_code=v_geo.ward_code and r.polling_unit_code=v_geo.polling_unit_code)
    order by r.submitted_at desc limit 5
  ) hit;
  v_duplicate:=coalesce(array_length(v_matches,1),0)>0;
  if v_duplicate then
    -- Strict duplicate policy: do not allocate a record ID or insert a second row.
    -- Do not return the matched record's name, phone, ID, or other personal details.
    return jsonb_build_object(
      'success',false,
      'submitted',false,
      'duplicate',true,
      'code','DUPLICATE_RECORD',
      'message','We could not submit this registration because a record with matching details already exists. No new record has been created. Please check the name and phone number, or contact the administrator if you believe this is an error.'
    );
  end if;
  select value into v_state from public.app_settings where key='ACTIVE_STATE';
  select value into v_state_code from public.app_settings where key='STATE_CODE';
  v_state:=coalesce(v_state,'Ogun'); v_state_code:=coalesce(v_state_code,'OG');
  v_prefix:=v_state_code||'-'||case v_position when 'STATE_EXCO' then 'EXCO' when 'LGA_COORDINATOR' then 'LGA' else 'WC' end||'-';

  -- The migration backfills counters from every existing record once. Future IDs
  -- are allocated by a single atomic UPSERT, which is concurrency-safe and avoids
  -- scanning the coordinator table on each public submission.
  insert into public.record_sequences(prefix,last_value)
  values(v_prefix,1)
  on conflict(prefix) do update
    set last_value = public.record_sequences.last_value + 1
  returning last_value into v_sequence;
  v_record_id:=v_prefix||lpad(v_sequence::text,6,'0');
  begin
    insert into public.coordinator_records(record_id,state,state_code,name,position,phone,lga,lga_code,ward,ward_code,polling_unit,polling_unit_code,verification_status,duplicate_flag,submitted_at,updated_at,submitted_by,notes,submission_key,normalized_name,normalized_phone)
    values(v_record_id,v_state,v_state_code,v_name,v_position,v_phone,v_geo.lga,v_geo.lga_code,v_geo.ward,v_geo.ward_code,v_geo.polling_unit,v_geo.polling_unit_code,'PENDING',v_duplicate,now(),now(),'public-form',v_notes,p_submission_key,v_normalized_name,v_phone);
  exception when unique_violation then
    -- If the same submission key won a race, return the already-created record instead of
    -- displaying an error after the browser retries a request whose response was delayed.
    select * into v_existing from public.coordinator_records where submission_key=p_submission_key limit 1;
    if found then
      return jsonb_build_object('success',true,'submitted',true,'alreadySubmitted',true,
      'recordId',v_existing.record_id,'duplicate',v_existing.duplicate_flag,
      'summary',jsonb_build_object('name',v_existing.name,'position',v_existing.position,'phone',v_existing.phone,'lga',v_existing.lga,'ward',v_existing.ward,'pollingUnit',v_existing.polling_unit));
    end if;
    raise;
  end;
  return jsonb_build_object('success',true,'submitted',true,'alreadySubmitted',false,
    'recordId',v_record_id,'duplicate',false,
    'summary',jsonb_build_object('name',v_name,'position',v_position,'phone',v_phone,'lga',v_geo.lga,'ward',v_geo.ward,'pollingUnit',v_geo.polling_unit));
end;
$$;
revoke all on function public.submit_coordinator(text,text,text,text,text,text,text,text) from public;
grant execute on function public.submit_coordinator(text,text,text,text,text,text,text,text) to anon,authenticated;
