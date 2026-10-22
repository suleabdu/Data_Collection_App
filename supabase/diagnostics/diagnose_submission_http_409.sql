-- TK27 read-only diagnosis for a submission endpoint returning HTTP 409.
-- Run in Supabase SQL Editor. This file does not alter records or schema.

-- 1) Inspect the exact function currently installed in THIS project.
select pg_get_functiondef(
  'public.submit_coordinator(text,text,text,text,text,text,text,text)'::regprocedure
) as installed_submit_coordinator_definition;

-- 2) List constraints on coordinator_records. Any HTTP 409 / SQLSTATE 23505 is a
-- PostgreSQL uniqueness violation, but it may be submission_key or record_id rather
-- than a match on coordinator identity.
select c.conname,
       c.contype,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.coordinator_records'::regclass
order by c.contype, c.conname;

-- 3) List indexes, including any extra unique indexes not present in the package.
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('coordinator_records', 'record_sequences')
order by tablename, indexname;

-- 4) Optional: after replacing the sample values below, check which duplicate rule
-- would match a test submission. Use the same values selected in the public form.
-- Normalize the phone to +234XXXXXXXXXX. The query returns only matching rule names,
-- record ID, and timestamp; run this only in the trusted Supabase SQL Editor.
/*
with candidate as (
  select public.normalize_tk27_name('REPLACE WITH TEST FULL NAME') as normalized_name,
         '+2348012345678'::text as normalized_phone,
         'STATE_EXCO'::text as position,
         'REPLACE_WITH_LGA_CODE'::text as lga_code,
         'REPLACE_WITH_WARD_CODE'::text as ward_code,
         'REPLACE_WITH_PU_CODE'::text as polling_unit_code
)
select r.record_id,
       r.submitted_at,
       case
         when r.normalized_phone = c.normalized_phone then 'PHONE_MATCH'
         when r.normalized_name = c.normalized_name and r.position = c.position then 'NAME_POSITION_MATCH'
         when r.normalized_name = c.normalized_name
          and r.lga_code = c.lga_code
          and r.ward_code = c.ward_code
          and r.polling_unit_code = c.polling_unit_code then 'NAME_LOCATION_MATCH'
       end as match_reason
from public.coordinator_records r
cross join candidate c
where r.normalized_phone = c.normalized_phone
   or (r.normalized_name = c.normalized_name and r.position = c.position)
   or (r.normalized_name = c.normalized_name
       and r.lga_code = c.lga_code
       and r.ward_code = c.ward_code
       and r.polling_unit_code = c.polling_unit_code)
order by r.submitted_at desc;
*/

-- Interpretation:
-- * If the function definition uses RAISE EXCEPTION for matching details, run
--   ../migrations/202610220001_block_duplicate_submissions.sql to update it so an
--   expected duplicate is returned as structured JSON, not an HTTP 409 exception.
-- * If the definition already returns jsonb on a match, investigate the exact SQLSTATE
--   and constraint name in the failed request's JSON response/logs; do not assume it is
--   an identity duplicate just from HTTP 409.
