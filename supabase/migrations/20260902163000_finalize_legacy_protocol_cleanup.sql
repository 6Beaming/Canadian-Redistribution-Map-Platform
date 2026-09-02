-- Final legacy-protocol cleanup after cutover verification.
-- Removes dormant tables/functions and rewrites list RPCs to stop joining
-- dissemination_areas. DA display metadata is enriched server-side via the
-- canonical map asset index.

create or replace function public.list_my_submission_rows_v2(
  p_user_id uuid,
  p_query text default '',
  p_created_from date default null,
  p_created_to date default null,
  p_type text default '',
  p_status text default '',
  p_sort text default 'newest',
  p_page_size integer default 25,
  p_cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_type text := lower(replace(replace(coalesce(p_type, ''), '_', '-'), 'comment', 'feedback'));
  normalized_status text := lower(replace(replace(coalesce(p_status, ''), '_', '-'), ' ', '-'));
  effective_page_size integer := greatest(1, least(coalesce(p_page_size, 25), 100));
  cursor_created_at timestamptz := nullif(p_cursor->>'createdAt', '')::timestamptz;
  cursor_id uuid := nullif(p_cursor->>'id', '')::uuid;
  result_items jsonb := '[]'::jsonb;
  result_count integer := 0;
  fetched_count integer := 0;
  next_cursor jsonb := null;
  has_more boolean := false;
begin
  with filtered as (
    select
      s.id,
      s.user_id,
      s.type,
      s.fed_num,
      s.dguid,
      s.neighboring_dguid,
      s.title,
      s.status,
      s.resource_version,
      s.created_at,
      s.updated_at,
      s.status as visible_status,
      null::text as community_name,
      s.fed_num as primary_fed_num,
      null::text as secondary_fed_num,
      null::bigint as primary_population,
      null::bigint as secondary_population
    from public.submissions s
    where s.user_id = p_user_id
      and (
        coalesce(p_query, '') = ''
        or concat_ws(
          ' ',
          s.id::text,
          s.title,
          s.type,
          s.status,
          s.fed_num,
          s.dguid,
          s.neighboring_dguid
        ) ilike '%' || p_query || '%'
      )
      and (p_created_from is null or s.created_at >= p_created_from::timestamptz)
      and (p_created_to is null or s.created_at < (p_created_to + interval '1 day')::timestamptz)
      and (
        normalized_type = ''
        or lower(replace(s.type, '_', '-')) = case
          when normalized_type = 'feedback' then 'feedback'
          when normalized_type = 'counter-proposal' then 'counter_proposal'
          else normalized_type
        end
      )
      and (
        normalized_status = ''
        or lower(replace(s.status, '_', '-')) = normalized_status
      )
  ),
  ordered as (
    select *
    from filtered
    order by
      case when coalesce(p_sort, 'newest') = 'title-asc' then title end asc nulls last,
      case when coalesce(p_sort, 'newest') = 'title-desc' then title end desc nulls last,
      case when coalesce(p_sort, 'newest') in ('newest', 'oldest', '') then created_at end desc nulls last,
      case when coalesce(p_sort, 'newest') = 'oldest' then created_at end asc nulls last,
      id desc
  ),
  paged as (
    select *
    from ordered
    where cursor_id is null
      or (
        coalesce(p_sort, 'newest') = 'oldest'
        and (created_at, id) > (cursor_created_at, cursor_id)
      )
      or (
        coalesce(p_sort, 'newest') <> 'oldest'
        and (created_at, id) < (cursor_created_at, cursor_id)
      )
    limit effective_page_size + 1
  ),
  limited as (
    select * from paged limit effective_page_size
  ),
  counts as (
    select count(*)::integer as total from paged
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', limited.id,
        'user_id', limited.user_id,
        'type', limited.type,
        'fed_num', limited.fed_num,
        'dguid', limited.dguid,
        'neighboring_dguid', limited.neighboring_dguid,
        'title', limited.title,
        'status', limited.status,
        'visible_status', limited.visible_status,
        'resource_version', limited.resource_version,
        'created_at', limited.created_at,
        'updated_at', limited.updated_at,
        'primary_fed_num', limited.primary_fed_num,
        'secondary_fed_num', limited.secondary_fed_num,
        'primary_population', limited.primary_population,
        'secondary_population', limited.secondary_population,
        'dissemination_areas', jsonb_build_object('community_name', limited.community_name)
      )
    ), '[]'::jsonb),
    count(*)::integer,
    max(counts.total)
  into result_items, result_count, fetched_count
  from limited
  cross join counts;

  has_more := fetched_count > effective_page_size;

  if has_more and result_count > 0 then
    next_cursor := jsonb_build_object(
      'createdAt', result_items->(result_count - 1)->>'created_at',
      'id', result_items->(result_count - 1)->>'id',
      'title', result_items->(result_count - 1)->>'title'
    );
  end if;

  return jsonb_build_object(
    'items', result_items,
    'page', jsonb_build_object(
      'pageSize', effective_page_size,
      'nextCursor', next_cursor,
      'hasMore', has_more
    )
  );
end;
$$;

create or replace function public.list_commissioner_submission_rows_v2(
  p_actor_id uuid,
  p_commissioner_pruid text,
  p_query text default '',
  p_created_from date default null,
  p_created_to date default null,
  p_type text default '',
  p_status text default '',
  p_sort text default 'newest',
  p_page_size integer default 25,
  p_cursor jsonb default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  normalized_type text := lower(replace(replace(coalesce(p_type, ''), '_', '-'), 'comment', 'feedback'));
  normalized_status text := lower(replace(replace(coalesce(p_status, ''), '_', '-'), ' ', '-'));
  effective_page_size integer := greatest(1, least(coalesce(p_page_size, 25), 100));
  cursor_created_at timestamptz := nullif(p_cursor->>'createdAt', '')::timestamptz;
  cursor_id uuid := nullif(p_cursor->>'id', '')::uuid;
  result_items jsonb := '[]'::jsonb;
  result_count integer := 0;
  fetched_count integer := 0;
  next_cursor jsonb := null;
  has_more boolean := false;
begin
  with scoped as (
    select distinct on (s.id)
      s.id,
      s.user_id,
      s.type,
      s.fed_num,
      s.dguid,
      s.neighboring_dguid,
      s.title,
      s.status,
      s.resource_version,
      s.created_at,
      s.updated_at,
      coalesce(
        array_agg(distinct scope.pruid) filter (where scope.pruid is not null),
        '{}'::text[]
      ) as scope_pruids,
      s.active_claim_pruid as operating_pruid,
      null::text as community_name,
      s.fed_num as primary_fed_num,
      null::text as secondary_fed_num,
      null::bigint as primary_population,
      null::bigint as secondary_population,
      author.id as author_id,
      author.email as author_email,
      archive_request.id as archive_request_id,
      archive_request.resource_version as archive_request_version,
      (
        archive_request.id is not null
        and (
          p_actor_id = archive_request.requester_id
          or p_actor_id = any(coalesce(archive_request.assignee_ids, '{}'::uuid[]))
        )
      ) as archive_request_assigned_to_viewer,
      case
        when lower(replace(s.status, '_', '-')) in ('archive-request', 'archive-requested')
          and archive_request.id is not null
          and (
            p_actor_id = archive_request.requester_id
            or p_actor_id = any(coalesce(archive_request.assignee_ids, '{}'::uuid[]))
          )
          then 'archive-request'
        when lower(replace(s.status, '_', '-')) in ('archive-request', 'archive-requested')
          then 'accepted'
        else lower(replace(s.status, '_', '-'))
      end as visible_status
    from public.submissions s
    left join public.submission_scope_pruids scope on scope.submission_id = s.id
    left join public.profiles author on author.id = s.user_id
    left join lateral (
      select war.id, war.requester_id, war.assignee_ids, war.resource_version
      from public.workspace_archive_requests war
      where war.submission_id = s.id
        and war.state in ('open', 'approved')
      order by war.created_at desc
      limit 1
    ) archive_request on true
    where public.submission_matches_commissioner_pruid(
      s.id,
      s.dguid,
      s.neighboring_dguid,
      trim(p_commissioner_pruid)
    )
    group by
      s.id,
      author.id,
      author.email,
      archive_request.id,
      archive_request.resource_version,
      archive_request.requester_id,
      archive_request.assignee_ids
  ),
  filtered as (
    select *
    from scoped
    where (
      coalesce(p_query, '') = ''
      or concat_ws(
        ' ',
        id::text,
        title,
        type,
        visible_status,
        fed_num,
        dguid,
        neighboring_dguid,
        author_email
      ) ilike '%' || p_query || '%'
    )
    and (p_created_from is null or created_at >= p_created_from::timestamptz)
    and (p_created_to is null or created_at < (p_created_to + interval '1 day')::timestamptz)
    and (
      normalized_type = ''
      or lower(replace(type, '_', '-')) = case
        when normalized_type = 'feedback' then 'feedback'
        when normalized_type = 'counter-proposal' then 'counter_proposal'
        else normalized_type
      end
    )
    and (
      normalized_status = ''
      or visible_status = normalized_status
    )
  ),
  ordered as (
    select *
    from filtered
    order by
      case when coalesce(p_sort, 'newest') = 'title-asc' then title end asc nulls last,
      case when coalesce(p_sort, 'newest') = 'title-desc' then title end desc nulls last,
      case when coalesce(p_sort, 'newest') in ('newest', 'oldest', '') then created_at end desc nulls last,
      case when coalesce(p_sort, 'newest') = 'oldest' then created_at end asc nulls last,
      id desc
  ),
  paged as (
    select *
    from ordered
    where cursor_id is null
      or (
        coalesce(p_sort, 'newest') = 'oldest'
        and (created_at, id) > (cursor_created_at, cursor_id)
      )
      or (
        coalesce(p_sort, 'newest') <> 'oldest'
        and (created_at, id) < (cursor_created_at, cursor_id)
      )
    limit effective_page_size + 1
  ),
  limited as (
    select * from paged limit effective_page_size
  ),
  counts as (
    select count(*)::integer as total from paged
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'id', limited.id,
        'user_id', limited.user_id,
        'type', limited.type,
        'fed_num', limited.fed_num,
        'dguid', limited.dguid,
        'neighboring_dguid', limited.neighboring_dguid,
        'title', limited.title,
        'status', limited.status,
        'visible_status', limited.visible_status,
        'archive_request_assigned_to_viewer', limited.archive_request_assigned_to_viewer,
        'archive_request_id', limited.archive_request_id,
        'archive_request_version', limited.archive_request_version,
        'resource_version', limited.resource_version,
        'created_at', limited.created_at,
        'updated_at', limited.updated_at,
        'primary_fed_num', limited.primary_fed_num,
        'secondary_fed_num', limited.secondary_fed_num,
        'primary_population', limited.primary_population,
        'secondary_population', limited.secondary_population,
        'scope_pruids', limited.scope_pruids,
        'operating_pruid', limited.operating_pruid,
        'crossProvinceWarning', coalesce(array_length(limited.scope_pruids, 1), 0) > 1,
        'dissemination_areas', jsonb_build_object(
          'community_name', coalesce(limited.community_name, 'Unknown')
        ),
        'profile', jsonb_build_object(
          'id', limited.author_id,
          'email', limited.author_email
        )
      )
    ), '[]'::jsonb),
    count(*)::integer,
    max(counts.total)
  into result_items, result_count, fetched_count
  from limited
  cross join counts;

  has_more := fetched_count > effective_page_size;

  if has_more and result_count > 0 then
    next_cursor := jsonb_build_object(
      'createdAt', result_items->(result_count - 1)->>'created_at',
      'id', result_items->(result_count - 1)->>'id',
      'title', result_items->(result_count - 1)->>'title'
    );
  end if;

  return jsonb_build_object(
    'items', result_items,
    'page', jsonb_build_object(
      'pageSize', effective_page_size,
      'nextCursor', next_cursor,
      'hasMore', has_more
    )
  );
end;
$$;

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
    'legacyArchiveRows', 0,
    'archiveV2Versions', (select count(*) from public.archive_versions),
    'rlsDisabled', coalesce((select jsonb_agg(name order by name) from rls_disabled), '[]'::jsonb),
    'browserTableGrants', coalesce((select jsonb_agg(value order by value) from browser_grants), '[]'::jsonb)
  );
$$;

revoke all on function public.audit_final_refactor_database() from public, anon, authenticated;
grant execute on function public.audit_final_refactor_database() to service_role;

drop trigger if exists checkpoint0_counter_proposal_realtime_trg
  on public.counter_proposal_revisions;

drop trigger if exists checkpoint0_submission_geometry_counter_proposal_realtime_trg
  on public.submission_geometry_revisions;
create trigger checkpoint0_submission_geometry_counter_proposal_realtime_trg
  after insert on public.submission_geometry_revisions
  for each row
  when (new.submission_type = 'counter_proposal')
  execute function public.checkpoint0_counter_proposal_realtime();

drop function if exists public.merge_submission_into_archive(uuid, uuid, jsonb);
drop function if exists public.revert_archive_branch(text, uuid, uuid);
drop function if exists public.delete_archive_branch(text);

alter table public.submission_geometry_revisions
  drop constraint if exists submission_geometry_revisions_legacy_revision_id_fkey;
alter table public.submission_geometry_revisions
  drop column if exists legacy_revision_id;

alter table public.archive_source_revisions
  drop column if exists source_counter_proposal_revision_id;

drop table if exists public.archive_tree cascade;
drop table if exists public.counter_proposal_revisions cascade;
drop table if exists public.dissemination_areas cascade;
