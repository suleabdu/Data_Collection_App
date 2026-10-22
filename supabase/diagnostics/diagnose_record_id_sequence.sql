-- Read-only comparison of record_sequences with actual record IDs.
with parsed_ids as (
  select regexp_replace(record_id, '[0-9]+$', '') as prefix,
         substring(record_id from '([0-9]+)$')::bigint as max_id
  from public.coordinator_records
  where record_id ~ '^[A-Z0-9]+-(EXCO|LGA|WC)-[0-9]+$'
), maxima as (
  select prefix, max(max_id) as highest_existing_id
  from parsed_ids group by prefix
)
select coalesce(s.prefix, m.prefix) as prefix,
       s.last_value as sequence_counter,
       m.highest_existing_id,
       case when s.last_value is null then 'MISSING COUNTER'
            when s.last_value < m.highest_existing_id then 'COUNTER BEHIND RECORDS'
            else 'COUNTER OK' end as diagnosis
from public.record_sequences s
full outer join maxima m on m.prefix=s.prefix
order by prefix;
