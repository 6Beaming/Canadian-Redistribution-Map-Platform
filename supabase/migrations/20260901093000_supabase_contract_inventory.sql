-- Read-only catalog inventory for the final-refactor cutover gate.  The
-- service-role-only function exposes object metadata, never application rows.

create or replace function public.inventory_final_refactor_database()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog, information_schema
stable
as $$
  select jsonb_build_object(
    'relations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', class.relname,
        'kind', class.relkind,
        'rls', class.relrowsecurity,
        'bytes', pg_total_relation_size(class.oid)
      ) order by class.relname)
      from pg_class class
      where class.relnamespace = 'public'::regnamespace
        and class.relkind in ('r', 'p', 'v', 'm')
    ), '[]'::jsonb),
    'foreignKeys', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', constraint_record.conname,
        'table', constraint_record.conrelid::regclass::text,
        'definition', pg_get_constraintdef(constraint_record.oid)
      ) order by constraint_record.conname)
      from pg_constraint constraint_record
      where constraint_record.contype = 'f'
        and constraint_record.connamespace = 'public'::regnamespace
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table', schemaname || '.' || tablename,
        'name', policyname,
        'roles', roles,
        'command', cmd,
        'using', qual,
        'check', with_check
      ) order by tablename, policyname)
      from pg_policies where schemaname = 'public'
    ), '[]'::jsonb),
    'browserGrants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'grantee', grantee,
        'table', table_name,
        'privilege', privilege_type
      ) order by table_name, grantee, privilege_type)
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
    ), '[]'::jsonb),
    'routines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', procedure_record.proname,
        'identityArguments', pg_get_function_identity_arguments(procedure_record.oid),
        'securityDefiner', procedure_record.prosecdef
      ) order by procedure_record.proname, pg_get_function_identity_arguments(procedure_record.oid))
      from pg_proc procedure_record
      where procedure_record.pronamespace = 'public'::regnamespace
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.inventory_final_refactor_database()
  from public, anon, authenticated;
grant execute on function public.inventory_final_refactor_database()
  to service_role;
