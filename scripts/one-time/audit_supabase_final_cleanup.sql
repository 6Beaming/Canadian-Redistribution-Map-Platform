-- Final Supabase cleanup preflight (READ-ONLY for persistent schemas).
--
-- Run the whole file in Supabase SQL Editor as the postgres role. The script
-- only writes pg_temp tables and returns one JSON document named
-- cleanup_audit. It does NOT drop, alter, grant, revoke, update, or delete any
-- persistent application object or row.
--
-- Save/export the returned JSON before creating the cleanup migration.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

drop table if exists pg_temp.cleanup_relation_contract;
create temp table cleanup_relation_contract (
  relation_name text primary key,
  disposition text not null,
  rationale text not null
);

insert into cleanup_relation_contract (relation_name, disposition, rationale)
values
  -- Runtime source-of-truth tables.
  ('profiles', 'KEEP', 'Authenticated profile CRUD and Commissioner identity.'),
  ('pending_invites', 'KEEP', 'Commissioner invitation lifecycle.'),
  ('submissions', 'KEEP', 'Submission aggregate root.'),
  ('workspace_comments', 'KEEP', 'Submission-local Commissioner comments/system notes.'),
  ('workspace_labels', 'KEEP', 'Submission-local fixed/custom label state.'),
  ('workspace_archive_requests', 'KEEP', 'Archive Request state machine.'),
  ('workspace_archive_request_votes', 'KEEP', 'Archive Request votes.'),
  ('submission_scope_pruids', 'KEEP', 'Immutable two-province authorization scope.'),
  ('archive_source_revisions', 'KEEP', 'Sealed Archive Request sources.'),
  ('realtime_outbox', 'KEEP', 'Durable realtime event outbox.'),
  ('realtime_scope_deliveries', 'KEEP', 'Per-PRUID realtime delivery ordering.'),
  ('map_data_releases', 'KEEP', 'Canonical immutable release identity.'),
  ('submission_geometry_revisions', 'KEEP', 'Submission geometry revision headers.'),
  ('submission_geometry_operations', 'KEEP', 'Sparse absolute vertex operations.'),
  ('archive_branches', 'KEEP', 'Archived Tree branches.'),
  ('archive_versions', 'KEEP', 'Immutable Archived Tree history.'),
  ('archive_version_operations', 'KEEP', 'Operations sealed into archive versions.'),
  ('archive_vertex_state', 'KEEP', 'Branch-scoped LWW vertex heads.'),
  ('archive_map_revisions', 'KEEP', 'Global Archived Map transition log.'),
  ('archive_map_da_heads', 'KEEP', 'Current Archived Map DA geometry heads.'),

  -- Hosted legacy objects with no current runtime data consumer.
  ('audit_log', 'DROP_CANDIDATE', 'Unreferenced legacy audit surface; realtime/archive logs supersede it.'),
  ('da_adjacency', 'DROP_CANDIDATE', 'Adjacency now comes from immutable local release topology.'),
  ('da_assignments', 'DROP_CANDIDATE', 'Legacy proposal assignment model is retired.'),
  ('fed_districts', 'DROP_AFTER_FK_REMOVAL', 'FED metadata is local; submissions.fed_num must remain as unconstrained text.'),
  ('map_release_legacy_aliases', 'DROP_AFTER_GEOMETRY_GATE', 'Migration-only alias map; no runtime consumer remains.'),
  ('workspace_label_catalog', 'DROP_AFTER_LABEL_NORMALIZATION', 'Global labels are retired; workspace_labels is submission-local.'),

  -- Empty in the audited database, but still referenced by mounted code.
  ('map_proposals', 'BLOCKED_BY_RUNTIME_CODE', 'comments proposal route/body validation and submissions.proposal_id still depend on it.'),
  ('comment_tags', 'BLOCKED_BY_RUNTIME_CODE', 'Mounted /api/comment-tags router and client exports still depend on it.'),

  -- These should already have been removed by the 20260902163000 cutover.
  ('archive_tree', 'EXPECTED_ABSENT', 'Replaced by archive_branches/archive_versions.'),
  ('counter_proposal_revisions', 'EXPECTED_ABSENT', 'Replaced by submission_geometry_revisions/operations.'),
  ('dissemination_areas', 'EXPECTED_ABSENT', 'Replaced by immutable local release assets.');

drop table if exists pg_temp.cleanup_candidate_counts;
create temp table cleanup_candidate_counts (
  relation_name text primary key,
  exact_rows bigint,
  count_error text
);

do $audit_counts$
declare
  candidate record;
  row_count bigint;
begin
  for candidate in
    select relation_name
    from cleanup_relation_contract
    where disposition <> 'KEEP'
      and to_regclass(format('public.%I', relation_name)) is not null
  loop
    begin
      execute format('select count(*) from public.%I', candidate.relation_name)
        into row_count;
      insert into cleanup_candidate_counts values (candidate.relation_name, row_count, null);
    exception when others then
      insert into cleanup_candidate_counts values (
        candidate.relation_name,
        null,
        sqlstate || ': ' || sqlerrm
      );
    end;
  end loop;
end
$audit_counts$;

drop table if exists pg_temp.cleanup_gates;
create temp table cleanup_gates (
  gate_name text primary key,
  passed boolean not null,
  severity text not null,
  observed text,
  requirement text not null
);

do $audit_gates$
declare
  observed_count bigint;
  observed_names text;
begin
  select count(*), string_agg(contract.relation_name, ', ' order by contract.relation_name)
  into observed_count, observed_names
  from cleanup_relation_contract contract
  where contract.disposition = 'KEEP'
    and to_regclass(format('public.%I', contract.relation_name)) is null;
  insert into cleanup_gates values (
    'required_relations_exist', observed_count = 0, 'BLOCKER',
    coalesce(observed_names, 'none'), 'Every KEEP relation must exist.'
  );

  select count(*), string_agg(contract.relation_name, ', ' order by contract.relation_name)
  into observed_count, observed_names
  from cleanup_relation_contract contract
  where contract.disposition = 'EXPECTED_ABSENT'
    and to_regclass(format('public.%I', contract.relation_name)) is not null;
  insert into cleanup_gates values (
    'cutover_relations_are_absent', observed_count = 0, 'BLOCKER',
    coalesce(observed_names, 'none'),
    'archive_tree, counter_proposal_revisions, and dissemination_areas must already be absent.'
  );

  select count(*), string_agg(class.relname, ', ' order by class.relname)
  into observed_count, observed_names
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  left join cleanup_relation_contract contract on contract.relation_name = class.relname
  left join pg_depend extension_dependency
    on extension_dependency.classid = 'pg_class'::regclass
   and extension_dependency.objid = class.oid
   and extension_dependency.deptype = 'e'
  where namespace.nspname = 'public'
    and class.relkind in ('r', 'p')
    and contract.relation_name is null
    and extension_dependency.objid is null;
  insert into cleanup_gates values (
    'no_unclassified_public_tables', observed_count = 0, 'BLOCKER',
    coalesce(observed_names, 'none'),
    'Every non-extension public table must be explicitly classified before deletion.'
  );

  select count(*), string_agg(class.relname, ', ' order by class.relname)
  into observed_count, observed_names
  from cleanup_relation_contract contract
  join pg_class class on class.relname = contract.relation_name
  join pg_namespace namespace on namespace.oid = class.relnamespace and namespace.nspname = 'public'
  where contract.disposition = 'KEEP' and not class.relrowsecurity;
  insert into cleanup_gates values (
    'rls_enabled_on_keep_tables', observed_count = 0, 'SECURITY_BLOCKER',
    coalesce(observed_names, 'none'), 'Every runtime table must have RLS enabled.'
  );

  select count(*), string_agg(distinct grants.table_name, ', ' order by grants.table_name)
  into observed_count, observed_names
  from information_schema.role_table_grants grants
  where grants.table_schema = 'public'
    and grants.grantee in ('anon', 'authenticated')
    and not (
      grants.table_name = 'profiles'
      and grants.grantee = 'authenticated'
      and grants.privilege_type in ('SELECT', 'INSERT', 'UPDATE')
    );
  insert into cleanup_gates values (
    'browser_table_grants_are_minimal', observed_count = 0, 'SECURITY_BLOCKER',
    coalesce(observed_names, 'none'),
    'Only authenticated SELECT/INSERT/UPDATE on profiles is allowed; all application data uses the server.'
  );

  if to_regclass('public.map_data_releases') is null then
    insert into cleanup_gates values (
      'exactly_one_active_release', false, 'BLOCKER', 'map_data_releases missing',
      'Exactly one immutable map release must be active.'
    );
  else
    execute 'select count(*) from public.map_data_releases where state = ''active'''
      into observed_count;
    insert into cleanup_gates values (
      'exactly_one_active_release', observed_count = 1, 'BLOCKER', observed_count::text,
      'Exactly one immutable map release must be active.'
    );
  end if;

  if to_regclass('public.submission_geometry_revisions') is null then
    insert into cleanup_gates values (
      'all_geometry_revisions_ready', false, 'BLOCKER', 'table missing',
      'Every geometry revision must be ready before legacy aliases are removed.'
    );
  else
    execute $$select count(*) from public.submission_geometry_revisions
      where migration_state <> 'ready'$$ into observed_count;
    insert into cleanup_gates values (
      'all_geometry_revisions_ready', observed_count = 0, 'BLOCKER', observed_count::text,
      'Every geometry revision must be ready before legacy aliases are removed.'
    );
  end if;

  if to_regclass('public.submissions') is not null
     and to_regclass('public.submission_geometry_revisions') is not null then
    execute $$select count(*)
      from public.submissions submission
      where submission.type in ('objection', 'counter_proposal')
        and (
          submission.release_id is null
          or not exists (
            select 1 from public.submission_geometry_revisions revision
            where revision.submission_id = submission.id
          )
        )$$ into observed_count;
    insert into cleanup_gates values (
      'geometry_submissions_have_release_and_revision', observed_count = 0, 'BLOCKER',
      observed_count::text,
      'Every Objection/CP must have a release_id and geometry revision.'
    );
  else
    insert into cleanup_gates values (
      'geometry_submissions_have_release_and_revision', false, 'BLOCKER', 'required table missing',
      'Every Objection/CP must have a release_id and geometry revision.'
    );
  end if;

  if to_regclass('public.archive_source_revisions') is not null then
    execute $$select count(*) from public.archive_source_revisions
      where submission_type in ('objection', 'counter_proposal', 'counter-proposal')
        and source_geometry_revision_id is null$$ into observed_count;
    insert into cleanup_gates values (
      'archive_sources_have_geometry_revision', observed_count = 0, 'BLOCKER',
      observed_count::text,
      'Every geometry-bearing sealed source must reference the v2 geometry revision.'
    );
  else
    insert into cleanup_gates values (
      'archive_sources_have_geometry_revision', false, 'BLOCKER', 'table missing',
      'Every geometry-bearing sealed source must reference the v2 geometry revision.'
    );
  end if;

  if to_regclass('public.archive_branches') is not null
     and to_regclass('public.archive_versions') is not null then
    execute $$select count(*)
      from public.archive_branches branch
      left join public.archive_versions version
        on version.id = branch.head_version_id
       and version.branch_id = branch.id
       and version.version_number = branch.head_version_number
      where branch.head_version_id is null or version.id is null$$ into observed_count;
    insert into cleanup_gates values (
      'archive_branch_heads_are_valid', observed_count = 0, 'BLOCKER', observed_count::text,
      'Every archive branch must point to its own existing head version and number.'
    );
  else
    insert into cleanup_gates values (
      'archive_branch_heads_are_valid', false, 'BLOCKER', 'required table missing',
      'Every archive branch must point to its own existing head version and number.'
    );
  end if;

  if to_regclass('public.archive_map_da_heads') is not null
     and to_regclass('public.archive_map_revisions') is not null then
    execute $$select count(*)
      from public.archive_map_da_heads head
      left join public.archive_map_revisions revision
        on revision.sequence = head.last_map_revision_sequence
      where revision.sequence is null
         or (not head.uses_base and head.display_geometry is null)$$ into observed_count;
    insert into cleanup_gates values (
      'archive_map_heads_are_materializable', observed_count = 0, 'BLOCKER', observed_count::text,
      'Every map head must reference a revision and non-base heads must retain display geometry.'
    );
  else
    insert into cleanup_gates values (
      'archive_map_heads_are_materializable', false, 'BLOCKER', 'required table missing',
      'Every map head must reference a revision and non-base heads must retain display geometry.'
    );
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'submissions' and column_name = 'proposal_id'
  ) then
    execute 'select count(*) from public.submissions where proposal_id is not null'
      into observed_count;
    insert into cleanup_gates values (
      'legacy_proposal_links_are_empty', observed_count = 0, 'BLOCKER', observed_count::text,
      'submissions.proposal_id must be empty before its FK/column and map_proposals are removed.'
    );
  else
    insert into cleanup_gates values (
      'legacy_proposal_links_are_empty', true, 'INFO', 'column absent',
      'submissions.proposal_id has already been removed.'
    );
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'workspace_labels' and column_name = 'catalog_id'
  ) then
    execute 'select count(*) from public.workspace_labels where catalog_id is not null'
      into observed_count;
    insert into cleanup_gates values (
      'workspace_catalog_links_are_detached', observed_count = 0, 'BLOCKER', observed_count::text,
      'Copy/normalize label identity locally, then clear catalog_id before dropping the FK/column.'
    );
  else
    insert into cleanup_gates values (
      'workspace_catalog_links_are_detached', true, 'INFO', 'column absent',
      'workspace_labels.catalog_id has already been removed.'
    );
  end if;

  if to_regclass('public.workspace_labels') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'workspace_labels' and column_name = 'label_key'
     ) then
    execute $$select count(*) from public.workspace_labels
      where not is_custom and label_key is null$$ into observed_count;
    insert into cleanup_gates values (
      'workspace_fixed_labels_have_keys', observed_count = 0, 'BLOCKER', observed_count::text,
      'Standard rows need canonical keys; non-standard historical rows must be reclassified as custom.'
    );
  else
    insert into cleanup_gates values (
      'workspace_fixed_labels_have_keys', false, 'BLOCKER', 'table/column missing',
      'Standard rows need canonical keys; non-standard historical rows must be reclassified as custom.'
    );
  end if;
end
$audit_gates$;

commit;

with
relation_inventory as (
  select
    namespace.nspname as schema_name,
    class.relname as relation_name,
    case class.relkind
      when 'r' then 'table'
      when 'p' then 'partitioned_table'
      when 'v' then 'view'
      when 'm' then 'materialized_view'
      else class.relkind::text
    end as relation_kind,
    class.relrowsecurity as rls_enabled,
    class.reltuples::bigint as estimated_rows,
    pg_total_relation_size(class.oid) as total_bytes,
    extension.extname as extension_owner,
    coalesce(contract.disposition,
      case when extension.oid is not null then 'EXTENSION_OWNED' else 'UNCLASSIFIED' end
    ) as disposition,
    contract.rationale
  from pg_class class
  join pg_namespace namespace on namespace.oid = class.relnamespace
  left join cleanup_relation_contract contract on contract.relation_name = class.relname
  left join pg_depend extension_dependency
    on extension_dependency.classid = 'pg_class'::regclass
   and extension_dependency.objid = class.oid
   and extension_dependency.deptype = 'e'
  left join pg_extension extension on extension.oid = extension_dependency.refobjid
  where namespace.nspname = 'public'
    and class.relkind in ('r', 'p', 'v', 'm')
),
candidate_foreign_keys as (
  select
    constraint_record.conname as constraint_name,
    source_class.relname as source_relation,
    target_class.relname as target_relation,
    pg_get_constraintdef(constraint_record.oid, true) as definition
  from pg_constraint constraint_record
  join pg_class source_class on source_class.oid = constraint_record.conrelid
  join pg_class target_class on target_class.oid = constraint_record.confrelid
  where constraint_record.contype = 'f'
    and constraint_record.connamespace = 'public'::regnamespace
    and exists (
      select 1 from cleanup_relation_contract contract
      where contract.disposition <> 'KEEP'
        and contract.relation_name in (source_class.relname, target_class.relname)
    )
),
routine_definitions as (
  select
    procedure_record.oid,
    procedure_record.proname,
    pg_get_function_identity_arguments(procedure_record.oid) as identity_arguments,
    pg_get_functiondef(procedure_record.oid) as definition
  from pg_proc procedure_record
  where procedure_record.pronamespace = 'public'::regnamespace
    and procedure_record.prokind in ('f', 'p')
),
candidate_routine_references as (
  select
    contract.relation_name,
    routine.proname as routine_name,
    routine.identity_arguments
  from cleanup_relation_contract contract
  join routine_definitions routine
    -- Match an explicit SQL relation reference rather than a JSON key or
    -- compatibility field with the same spelling (for example the
    -- "dissemination_areas" key returned by list RPCs).
    on lower(routine.definition) ~ (
      '(from|join|update|insert[[:space:]]+into|delete[[:space:]]+from|references)'
      || '[[:space:]]+(only[[:space:]]+)?public\.'
      || lower(contract.relation_name)
      || '([^a-z0-9_]|$)'
    )
  where contract.disposition <> 'KEEP'
),
candidate_trigger_references as (
  select
    table_class.relname as trigger_table,
    trigger_record.tgname as trigger_name,
    procedure_record.proname as trigger_function,
    pg_get_triggerdef(trigger_record.oid, true) as definition
  from pg_trigger trigger_record
  join pg_class table_class on table_class.oid = trigger_record.tgrelid
  join pg_namespace namespace on namespace.oid = table_class.relnamespace
  join pg_proc procedure_record on procedure_record.oid = trigger_record.tgfoid
  where namespace.nspname = 'public'
    and not trigger_record.tgisinternal
    and (
      exists (
        select 1 from cleanup_relation_contract contract
        where contract.disposition <> 'KEEP'
          and (
            contract.relation_name = table_class.relname
            or position(lower(contract.relation_name) in lower(pg_get_functiondef(procedure_record.oid))) > 0
          )
      )
    )
),
candidate_view_references as (
  select
    views.schemaname,
    views.viewname,
    contract.relation_name
  from pg_views views
  join cleanup_relation_contract contract
    on position(lower(contract.relation_name) in lower(views.definition)) > 0
  where contract.disposition <> 'KEEP'
),
candidate_policy_references as (
  select
    policy.schemaname,
    policy.tablename,
    policy.policyname,
    contract.relation_name
  from pg_policies policy
  join cleanup_relation_contract contract
    on contract.relation_name = policy.tablename
    or position(
      lower(contract.relation_name)
      in lower(coalesce(policy.qual, '') || ' ' || coalesce(policy.with_check, ''))
    ) > 0
  where contract.disposition <> 'KEEP'
),
obsolete_routines as (
  select
    procedure_record.proname as routine_name,
    pg_get_function_identity_arguments(procedure_record.oid) as identity_arguments
  from pg_proc procedure_record
  where procedure_record.pronamespace = 'public'::regnamespace
    and procedure_record.proname in (
      'archive_branch_key',
      'merge_submission_into_archive',
      'revert_archive_branch',
      'delete_archive_branch',
      'set_workspace_labels',
      'sync_workspace_label_catalog_assignments'
    )
),
browser_table_grants as (
  select table_name, grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated')
),
browser_routine_grants as (
  select routine_name, grantee, privilege_type
  from information_schema.routine_privileges
  where routine_schema = 'public' and grantee in ('PUBLIC', 'anon', 'authenticated')
),
publication_membership as (
  select pubname as publication_name, schemaname, tablename
  from pg_publication_tables
  where schemaname = 'public'
),
legacy_columns as (
  select table_name, column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public'
    and (table_name, column_name) in (
      ('submissions', 'proposal_id'),
      ('submissions', 'geometry'),
      ('workspace_labels', 'catalog_id'),
      ('submission_geometry_revisions', 'legacy_revision_id'),
      ('archive_source_revisions', 'source_counter_proposal_revision_id')
    )
),
recent_migrations as (
  select version
  from supabase_migrations.schema_migrations
  order by version desc
  limit 20
)
select jsonb_pretty(jsonb_build_object(
  'schemaVersion', '1.0',
  'checkedAt', clock_timestamp(),
  'database', current_database(),
  'executedAs', current_user,
  'cleanupReady', not exists (
    select 1 from cleanup_gates where severity in ('BLOCKER', 'SECURITY_BLOCKER') and not passed
  ) and not exists (
    select 1 from cleanup_relation_contract
    where disposition = 'BLOCKED_BY_RUNTIME_CODE'
      and to_regclass(format('public.%I', relation_name)) is not null
  ) and not exists (select 1 from candidate_foreign_keys)
    and not exists (select 1 from candidate_routine_references)
    and not exists (select 1 from obsolete_routines),
  'gates', coalesce((
    select jsonb_agg(to_jsonb(gate) order by
      case gate.severity when 'SECURITY_BLOCKER' then 0 when 'BLOCKER' then 1 else 2 end,
      gate.gate_name)
    from cleanup_gates gate
  ), '[]'::jsonb),
  'relationInventory', coalesce((
    select jsonb_agg(to_jsonb(inventory) order by inventory.relation_name)
    from relation_inventory inventory
  ), '[]'::jsonb),
  'candidateExactRows', coalesce((
    select jsonb_agg(to_jsonb(candidate) order by candidate.relation_name)
    from cleanup_candidate_counts candidate
  ), '[]'::jsonb),
  'candidateForeignKeys', coalesce((
    select jsonb_agg(to_jsonb(foreign_key) order by foreign_key.source_relation, foreign_key.constraint_name)
    from candidate_foreign_keys foreign_key
  ), '[]'::jsonb),
  'candidateRoutineReferences', coalesce((
    select jsonb_agg(to_jsonb(reference) order by reference.relation_name, reference.routine_name)
    from candidate_routine_references reference
  ), '[]'::jsonb),
  'candidateTriggerReferences', coalesce((
    select jsonb_agg(to_jsonb(reference) order by reference.trigger_table, reference.trigger_name)
    from candidate_trigger_references reference
  ), '[]'::jsonb),
  'candidateViewReferences', coalesce((
    select jsonb_agg(to_jsonb(reference) order by reference.schemaname, reference.viewname)
    from candidate_view_references reference
  ), '[]'::jsonb),
  'candidatePolicyReferences', coalesce((
    select jsonb_agg(to_jsonb(reference) order by reference.schemaname, reference.tablename, reference.policyname)
    from candidate_policy_references reference
  ), '[]'::jsonb),
  'obsoleteRoutines', coalesce((
    select jsonb_agg(to_jsonb(routine) order by routine.routine_name, routine.identity_arguments)
    from obsolete_routines routine
  ), '[]'::jsonb),
  'browserTableGrants', coalesce((
    select jsonb_agg(to_jsonb(grant_record) order by grant_record.table_name, grant_record.grantee, grant_record.privilege_type)
    from browser_table_grants grant_record
  ), '[]'::jsonb),
  'browserRoutineGrants', coalesce((
    select jsonb_agg(to_jsonb(grant_record) order by grant_record.routine_name, grant_record.grantee)
    from browser_routine_grants grant_record
  ), '[]'::jsonb),
  'publicationMembership', coalesce((
    select jsonb_agg(to_jsonb(member) order by member.publication_name, member.tablename)
    from publication_membership member
  ), '[]'::jsonb),
  'legacyColumns', coalesce((
    select jsonb_agg(to_jsonb(column_record) order by column_record.table_name, column_record.column_name)
    from legacy_columns column_record
  ), '[]'::jsonb),
  'recentMigrations', coalesce((
    select jsonb_agg(to_jsonb(migration) order by migration.version desc)
    from recent_migrations migration
  ), '[]'::jsonb)
)) as cleanup_audit;
