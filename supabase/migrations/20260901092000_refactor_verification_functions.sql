-- Server-only verification used before read cutover and destructive cleanup.

create or replace function public.audit_final_refactor_database()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog, information_schema
stable
as $$
  with protected_tables(name) as (
    values
      ('map_data_releases'), ('map_release_legacy_aliases'),
      ('submission_geometry_revisions'), ('submission_geometry_operations'),
      ('archive_branches'), ('archive_versions'), ('archive_version_operations'),
      ('archive_vertex_state'), ('archive_map_revisions'), ('archive_map_da_heads')
  ),
  rls_disabled as (
    select protected_tables.name
    from protected_tables
    left join pg_class on pg_class.relname = protected_tables.name
      and pg_class.relnamespace = 'public'::regnamespace
    where coalesce(pg_class.relrowsecurity, false) = false
  ),
  browser_grants as (
    select distinct table_name || ':' || grantee || ':' || privilege_type as value
    from information_schema.role_table_grants
    join protected_tables on protected_tables.name = table_name
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
  )
  select jsonb_build_object(
    'activeReleaseCount', (select count(*) from public.map_data_releases where state = 'active'),
    'activeRelease', (select to_jsonb(release) from (
      select release_id, geometry_revision, manifest_sha256, topology_revision,
             normalization_version, vertex_schema_version, lod_schema_version
      from public.map_data_releases where state = 'active'
    ) release),
    'geometryDisposition', (select jsonb_object_agg(migration_state, count) from (
      select migration_state, count(*) from public.submission_geometry_revisions group by migration_state
    ) disposition),
    'geometryReadyWithoutOperations', (select count(*)
      from public.submission_geometry_revisions revision
      where revision.migration_state = 'ready'
        and revision.submission_type = 'counter_proposal'
        and not exists (select 1 from public.submission_geometry_operations operation where operation.revision_id = revision.id)),
    'geometrySubmissionMissingRelease', (select count(*) from public.submissions
      where type in ('objection', 'counter_proposal') and release_id is null),
    'geometrySubmissionMissingRevision', (select count(*) from public.submissions submission
      where submission.type in ('objection', 'counter_proposal')
        and not exists (select 1 from public.submission_geometry_revisions revision where revision.submission_id = submission.id)),
    'archiveSourceMissingGeometryRevision', (select count(*)
      from public.archive_source_revisions source
      where source.submission_type in ('objection', 'counter_proposal', 'counter-proposal')
        and source.source_geometry_revision_id is null),
    'legacyArchiveRows', (select count(*) from public.archive_tree),
    'archiveV2Versions', (select count(*) from public.archive_versions),
    'rlsDisabled', coalesce((select jsonb_agg(name order by name) from rls_disabled), '[]'::jsonb),
    'browserTableGrants', coalesce((select jsonb_agg(value order by value) from browser_grants), '[]'::jsonb)
  );
$$;

revoke all on function public.audit_final_refactor_database() from public, anon, authenticated;
grant execute on function public.audit_final_refactor_database() to service_role;

