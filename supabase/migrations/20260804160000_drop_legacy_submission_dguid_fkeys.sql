-- Drop legacy dissemination_areas FKs that still block non-Yukon / cross-province
-- objection and submission writes. The earlier migration only removed
-- submissions_neighboring_dguid_fkey; some databases still have the alternate
-- name submissions_neighboringdguid_fkey (no underscore before dguid).
-- Geographic authority for DGUIDs is the local map asset index, not this FK.

alter table public.submissions
  drop constraint if exists submissions_dguid_fkey;

alter table public.submissions
  drop constraint if exists submissions_neighboring_dguid_fkey;

alter table public.submissions
  drop constraint if exists submissions_neighboringdguid_fkey;

alter table public.submissions
  drop constraint if exists submissions_dguid_fkey1;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'submissions'
      and con.contype = 'f'
      and pg_get_constraintdef(con.oid) ilike '%dguid%'
      and pg_get_constraintdef(con.oid) ilike '%dissemination_areas%'
  loop
    execute format('alter table public.submissions drop constraint if exists %I', constraint_name);
  end loop;
end
$$;
