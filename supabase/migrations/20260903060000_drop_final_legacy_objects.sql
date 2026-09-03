-- Contract phase: final legacy contraction after the application, data, and
-- security cutovers have all passed. This migration is intentionally strict:
-- unknown dependencies make the transaction fail instead of being removed by
-- automatic dependency removal.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtext('crmp-final-legacy-cleanup'));

do $preflight$
declare
  audit jsonb;
  relation_name text;
  relation_has_rows boolean;
  unexpected_dependencies text;
  empty_legacy_relations constant text[] := array[
    'audit_log', 'comment_tags', 'da_adjacency', 'da_assignments',
    'map_proposals', 'map_release_legacy_aliases'
  ];
  required_runtime_relations constant text[] := array[
    'profiles', 'pending_invites', 'submissions',
    'workspace_comments', 'workspace_labels',
    'workspace_archive_requests', 'workspace_archive_request_votes',
    'submission_scope_pruids', 'archive_source_revisions',
    'realtime_outbox', 'realtime_scope_deliveries',
    'map_data_releases', 'submission_geometry_revisions',
    'submission_geometry_operations', 'archive_branches', 'archive_versions',
    'archive_version_operations', 'archive_vertex_state',
    'archive_map_revisions', 'archive_map_da_heads'
  ];
begin
  foreach relation_name in array required_runtime_relations loop
    if to_regclass(format('public.%I', relation_name)) is null then
      raise exception 'Final cleanup refused: required runtime table public.% is missing', relation_name;
    end if;
  end loop;

  audit := public.audit_final_refactor_database();
  if coalesce((audit->>'activeReleaseCount')::integer, 0) <> 1
     or coalesce((audit->>'geometrySubmissionMissingRelease')::bigint, 0) <> 0
     or coalesce((audit->>'geometrySubmissionMissingRevision')::bigint, 0) <> 0
     or coalesce((audit->>'archiveSourceMissingGeometryRevision')::bigint, 0) <> 0
     or coalesce((audit->>'legacyArchiveRows')::bigint, 0) <> 0
     or coalesce((audit->>'workspaceCatalogLinks')::bigint, 0) <> 0
     or coalesce((audit->>'workspaceFixedLabelsMissingKey')::bigint, 0) <> 0
     or jsonb_array_length(coalesce(audit->'rlsDisabled', '[]'::jsonb)) <> 0
     or jsonb_array_length(coalesce(audit->'browserTableGrants', '[]'::jsonb)) <> 0
     or exists (
       select 1
       from jsonb_each_text(coalesce(audit->'geometryDisposition', '{}'::jsonb)) state
       where state.key <> 'ready' and state.value::bigint > 0
     ) then
    raise exception 'Final cleanup refused: database cutover audit is not green: %', audit;
  end if;

  -- These tables are obsolete event/relationship state. A non-empty table
  -- means a legacy writer became active again after the preparation migration.
  foreach relation_name in array empty_legacy_relations loop
    if to_regclass(format('public.%I', relation_name)) is not null then
      execute format('select exists (select 1 from public.%I)', relation_name)
        into relation_has_rows;
      if relation_has_rows then
        raise exception 'Final cleanup refused: legacy table public.% contains rows', relation_name;
      end if;
    end if;
  end loop;

  if exists (select 1 from public.submissions where proposal_id is not null) then
    raise exception 'Final cleanup refused: submissions.proposal_id still contains data';
  end if;
  if exists (select 1 from public.workspace_labels where catalog_id is not null) then
    raise exception 'Final cleanup refused: workspace_labels.catalog_id still contains data';
  end if;

  -- Only the three explicitly reviewed KEEP -> legacy foreign keys may remain.
  select string_agg(
    format('%I.%I', source_class.relname, constraint_record.conname),
    ', ' order by source_class.relname, constraint_record.conname
  )
  into unexpected_dependencies
  from pg_constraint constraint_record
  join pg_class source_class on source_class.oid = constraint_record.conrelid
  join pg_class target_class on target_class.oid = constraint_record.confrelid
  join pg_namespace target_namespace on target_namespace.oid = target_class.relnamespace
  where constraint_record.contype = 'f'
    and target_namespace.nspname = 'public'
    and target_class.relname in (
      'audit_log', 'comment_tags', 'da_adjacency', 'da_assignments',
      'fed_districts', 'map_proposals', 'map_release_legacy_aliases',
      'workspace_label_catalog'
    )
    -- Foreign keys wholly inside the retired set are removed by the explicit
    -- child-before-parent DROP order below. Only a retained source relation
    -- can make the contraction unsafe.
    and source_class.relname not in (
      'audit_log', 'comment_tags', 'da_adjacency', 'da_assignments',
      'fed_districts', 'map_proposals', 'map_release_legacy_aliases',
      'workspace_label_catalog'
    )
    and constraint_record.conname not in (
      'submissions_fed_num_fkey',
      'submissions_proposal_id_fkey',
      'workspace_labels_catalog_id_fkey'
    );
  if unexpected_dependencies is not null then
    raise exception 'Final cleanup refused: unexpected foreign-key dependencies: %', unexpected_dependencies;
  end if;
end
$preflight$;

-- Replace the audit before dropping catalog_id, so the audit remains callable
-- throughout and after the contraction.
create or replace function public.audit_final_refactor_database()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog, information_schema
stable
as $$
  with protected_tables(name) as (
    values
      ('profiles'), ('pending_invites'), ('submissions'),
      ('workspace_comments'), ('workspace_labels'),
      ('workspace_archive_requests'), ('workspace_archive_request_votes'),
      ('submission_scope_pruids'), ('archive_source_revisions'),
      ('realtime_outbox'), ('realtime_scope_deliveries'),
      ('map_data_releases'), ('submission_geometry_revisions'),
      ('submission_geometry_operations'), ('archive_branches'),
      ('archive_versions'), ('archive_version_operations'),
      ('archive_vertex_state'), ('archive_map_revisions'),
      ('archive_map_da_heads')
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
    where table_schema = 'public'
      and grantee in ('anon', 'authenticated')
      and not (
        table_name = 'profiles'
        and grantee = 'authenticated'
        and privilege_type in ('SELECT', 'INSERT', 'UPDATE')
      )
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
        and not exists (
          select 1 from public.submission_geometry_operations operation
          where operation.revision_id = revision.id
        )),
    'geometrySubmissionMissingRelease', (select count(*) from public.submissions
      where type in ('objection', 'counter_proposal') and release_id is null),
    'geometrySubmissionMissingRevision', (select count(*) from public.submissions submission
      where submission.type in ('objection', 'counter_proposal')
        and not exists (
          select 1 from public.submission_geometry_revisions revision
          where revision.submission_id = submission.id
        )),
    'archiveSourceMissingGeometryRevision', (select count(*)
      from public.archive_source_revisions source
      where source.submission_type in ('objection', 'counter_proposal', 'counter-proposal')
        and source.source_geometry_revision_id is null),
    'legacyArchiveRows', 0,
    'archiveV2Versions', (select count(*) from public.archive_versions),
    'workspaceCatalogLinks', 0,
    'workspaceFixedLabelsMissingKey', (select count(*) from public.workspace_labels
      where not is_custom and label_key is null),
    'rlsDisabled', coalesce((select jsonb_agg(name order by name) from rls_disabled), '[]'::jsonb),
    'browserTableGrants', coalesce((select jsonb_agg(value order by value) from browser_grants), '[]'::jsonb)
  );
$$;

revoke all on function public.audit_final_refactor_database()
  from public, anon, authenticated;
grant execute on function public.audit_final_refactor_database()
  to service_role;

-- Preserve submissions.fed_num as application data, but detach it from the
-- retired Supabase FED snapshot. Remove only columns whose values were already
-- normalized into the current contracts.
alter table public.submissions
  drop constraint if exists submissions_fed_num_fkey;
alter table public.submissions
  drop constraint if exists submissions_proposal_id_fkey;
alter table public.workspace_labels
  drop constraint if exists workspace_labels_catalog_id_fkey;

alter table public.submissions
  drop column if exists proposal_id restrict;
alter table public.workspace_labels
  drop column if exists catalog_id restrict;

-- Dependency order is explicit, and RESTRICT is deliberate. Any view,
-- trigger, policy, function, or unknown foreign key aborts the transaction.
drop table if exists public.da_assignments restrict;
drop table if exists public.comment_tags restrict;
drop table if exists public.audit_log restrict;
drop table if exists public.da_adjacency restrict;
drop table if exists public.map_proposals restrict;
drop table if exists public.fed_districts restrict;
drop table if exists public.map_release_legacy_aliases restrict;
drop table if exists public.workspace_label_catalog restrict;

drop function if exists public.archive_branch_key(jsonb, uuid) restrict;

commit;

notify pgrst, 'reload schema';
