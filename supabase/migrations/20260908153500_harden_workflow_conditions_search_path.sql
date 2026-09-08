create or replace function public.workflow_conditions_match(record jsonb, conditions jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $function$
declare
  condition jsonb;
  actual jsonb;
  expected text;
  op text;
begin
  if conditions is null or jsonb_typeof(conditions) <> 'array' or jsonb_array_length(conditions) = 0 then
    return true;
  end if;

  for condition in select value from jsonb_array_elements(conditions)
  loop
    actual := record -> (condition ->> 'field');
    op := coalesce(condition ->> 'operator', 'equals');
    expected := condition ->> 'value';

    if op = 'exists' then
      if not (actual is not null and actual <> 'null'::jsonb) then return false; end if;
    elsif op = 'equals' then
      if coalesce(actual #>> '{}', '') <> coalesce(expected, '') then return false; end if;
    elsif op = 'not_equals' then
      if coalesce(actual #>> '{}', '') = coalesce(expected, '') then return false; end if;
    elsif op = 'contains' then
      if position(lower(coalesce(expected, '')) in lower(coalesce(actual #>> '{}', ''))) = 0 then return false; end if;
    elsif op in ('gt','gte','lt','lte') then
      if not (coalesce(actual #>> '{}','') ~ '^-?[0-9]+(\.[0-9]+)?$' and coalesce(expected,'') ~ '^-?[0-9]+(\.[0-9]+)?$') then return false; end if;
      if op = 'gt' and not ((actual #>> '{}')::numeric > expected::numeric) then return false; end if;
      if op = 'gte' and not ((actual #>> '{}')::numeric >= expected::numeric) then return false; end if;
      if op = 'lt' and not ((actual #>> '{}')::numeric < expected::numeric) then return false; end if;
      if op = 'lte' and not ((actual #>> '{}')::numeric <= expected::numeric) then return false; end if;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$function$;