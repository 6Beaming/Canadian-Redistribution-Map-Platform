-- Prepare the hosted database for the final legacy-object cleanup.
--
-- This migration intentionally does not drop any legacy table. It makes
-- Workspace labels self-contained, retires the old catalog write path, and
-- restores the server-owned data boundary before a separately reviewed drop.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';

-- Resolve duplicate fixed rows before assigning canonical keys. Prefer a
-- selected row, then the most recently updated row.
with classified as (
  select
    label.id,
    label.submission_id,
    label.is_selected,
    label.updated_at,
    case
      when label.label_key in (
        'discussion-required', 'constructive', 'worth-to-achieve',
        'negligible', 'over-aggressive'
      ) then label.label_key
      when lower(trim(label.name)) = 'discussion required' then 'discussion-required'
      when lower(trim(label.name)) = 'constructive' then 'constructive'
      when lower(trim(label.name)) = 'worth to achieve' then 'worth-to-achieve'
      when lower(trim(label.name)) = 'negligible' then 'negligible'
      when lower(trim(label.name)) = 'over aggressive' then 'over-aggressive'
      else null
    end as canonical_key
  from public.workspace_labels label
  where not label.is_custom
), ranked as (
  select
    classified.id,
    row_number() over (
      partition by classified.submission_id, classified.canonical_key
      order by classified.is_selected desc, classified.updated_at desc, classified.id desc
    ) as duplicate_rank
  from classified
  where classified.canonical_key is not null
)
delete from public.workspace_labels label
using ranked
where label.id = ranked.id
  and ranked.duplicate_rank > 1;

-- A historical row that is not one of the five application-owned labels is a
-- submission-local custom label. Preserve its UUID, text, color and selection.
update public.workspace_labels label
set is_custom = true,
    label_key = null
where not label.is_custom
  and (
    label.label_key is null
    or label.label_key not in (
      'discussion-required', 'constructive', 'worth-to-achieve',
      'negligible', 'over-aggressive'
    )
  )
  and lower(trim(label.name)) not in (
    'discussion required', 'constructive', 'worth to achieve',
    'negligible', 'over aggressive'
  );

-- Canonical fixed-label presentation belongs to application code and to each
-- local assignment row, not to workspace_label_catalog.
update public.workspace_labels label
set label_key = fixed.key,
    name = fixed.name,
    color = fixed.color,
    is_custom = false
from (values
  ('discussion-required', 'Discussion Required', '#f4b400'),
  ('constructive', 'Constructive', '#0f9d58'),
  ('worth-to-achieve', 'Worth to Achieve', '#1a73e8'),
  ('negligible', 'Negligible', '#f57c00'),
  ('over-aggressive', 'Over Aggressive', '#ea4335')
) as fixed(key, name, color)
where not label.is_custom
  and (
    label.label_key = fixed.key
    or lower(trim(label.name)) = lower(fixed.name)
  );

update public.workspace_labels
set label_key = null
where is_custom and label_key is not null;

-- Every row now carries its complete local identity. Keep the nullable column
-- temporarily so this preparation can be deployed before the final table drop.
update public.workspace_labels
set catalog_id = null
where catalog_id is not null;

alter table public.workspace_labels
  drop constraint if exists workspace_labels_local_identity_check;
alter table public.workspace_labels
  add constraint workspace_labels_local_identity_check check (
    (is_custom and label_key is null)
    or (
      not is_custom
      and label_key in (
        'discussion-required', 'constructive', 'worth-to-achieve',
        'negligible', 'over-aggressive'
      )
    )
  );

-- Prevent any legacy service-role caller or catalog update from recreating a
-- catalog association. The current functions remain
-- set_submission_workspace_labels() and checkpoint0_set_submission_workspace_labels().
drop trigger if exists workspace_label_catalog_assignment_sync
  on public.workspace_label_catalog;
drop function if exists public.sync_workspace_label_catalog_assignments();
drop function if exists public.set_workspace_labels(uuid, uuid, jsonb);

do $label_invariants$
begin
  if exists (
    select 1 from public.workspace_labels where catalog_id is not null
  ) then
    raise exception 'Workspace label catalog detachment failed';
  end if;

  if exists (
    select 1
    from public.workspace_labels
    where (is_custom and label_key is not null)
       or (not is_custom and label_key is null)
       or length(trim(name)) = 0
       or length(trim(color)) = 0
  ) then
    raise exception 'Workspace label normalization failed';
  end if;
end
$label_invariants$;

-- All application data except the authenticated user's own profile is served
-- through Express with the service-role client. Restore that boundary for both
-- existing and legacy tables; missing candidates are deliberately tolerated.
do $table_security$
declare
  relation_name text;
  runtime_relations constant text[] := array[
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
  known_relations constant text[] := runtime_relations || array[
    'audit_log', 'comment_tags', 'da_adjacency', 'da_assignments',
    'fed_districts', 'map_proposals', 'map_release_legacy_aliases',
    'workspace_label_catalog'
  ];
begin
  foreach relation_name in array runtime_relations loop
    if to_regclass(format('public.%I', relation_name)) is null then
      raise exception 'Required runtime table public.% is missing', relation_name;
    end if;
    execute format('alter table public.%I enable row level security', relation_name);
  end loop;

  foreach relation_name in array known_relations loop
    if to_regclass(format('public.%I', relation_name)) is not null then
      execute format(
        'revoke all privileges on table public.%I from anon, authenticated',
        relation_name
      );
    end if;
  end loop;
end
$table_security$;

-- Profile completion currently uses an authenticated Supabase user client.
-- RLS remains authoritative; anonymous clients receive no table privilege.
grant select, insert, update on table public.profiles to authenticated;

-- UUID-backed application tables do not require browser sequence privileges.
revoke all privileges on all sequences in schema public from anon, authenticated;

-- These are internal helpers used by service-role list RPCs, not public RPCs.
revoke all on function public.province_code_to_pruid(text)
  from public, anon, authenticated;
revoke all on function public.submission_matches_commissioner_pruid(uuid, text, text, text)
  from public, anon, authenticated;

-- Replace the old audit function so it covers every runtime table and no
-- longer treats the migration-only alias table as protected runtime state.
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
    'workspaceCatalogLinks', (select count(*) from public.workspace_labels where catalog_id is not null),
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

commit;

notify pgrst, 'reload schema';
