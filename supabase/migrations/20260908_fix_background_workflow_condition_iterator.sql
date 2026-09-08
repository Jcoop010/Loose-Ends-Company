-- Fix PL/pgSQL iterator ambiguity in the background workflow condition evaluator.
create or replace function public.workflow_conditions_match(record jsonb, conditions jsonb)
returns boolean language plpgsql immutable as $$
declare c jsonb; field_value text; expected text; op text;
begin
  for c in select elem from jsonb_array_elements(coalesce(conditions,'[]'::jsonb)) as t(elem) loop
    field_value := record ->> (c ->> 'field'); expected := c ->> 'value'; op := coalesce(c ->> 'operator','equals');
    if op='equals' and coalesce(field_value,'')<>coalesce(expected,'') then return false; end if;
    if op='not_equals' and coalesce(field_value,'')=coalesce(expected,'') then return false; end if;
    if op='contains' and position(lower(coalesce(expected,'')) in lower(coalesce(field_value,'')))=0 then return false; end if;
    if op='exists' and coalesce(field_value,'')='' then return false; end if;
    if op='gt' and not (coalesce(field_value,'0')::numeric > coalesce(expected,'0')::numeric) then return false; end if;
    if op='gte' and not (coalesce(field_value,'0')::numeric >= coalesce(expected,'0')::numeric) then return false; end if;
    if op='lt' and not (coalesce(field_value,'0')::numeric < coalesce(expected,'0')::numeric) then return false; end if;
    if op='lte' and not (coalesce(field_value,'0')::numeric <= coalesce(expected,'0')::numeric) then return false; end if;
  end loop; return true;
exception when invalid_text_representation then return false; end $$;