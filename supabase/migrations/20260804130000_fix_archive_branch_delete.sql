-- Keep Archived Tree Delete Forever compatible with the CP4 Archive Request
-- state machine and with archived submissions created before immutable scopes.
-- Apply after 20260804120000_repair_orphan_archive_requests.sql.

create or replace function public.checkpoint0_submission_scope(
  target_submission_id uuid
)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  scope_pruids text[];
begin
  select array_agg(scope.pruid order by scope.pruid)
  into scope_pruids
  from public.submission_scope_pruids scope
  where scope.submission_id = target_submission_id;

  -- Sealed Archive Request sources carry the immutable scope even when the
  -- lazy submission_scope_pruids backfill did not run for a legacy row.
  if coalesce(cardinality(scope_pruids), 0) = 0 then
    select array_agg(candidate.pruid order by candidate.pruid)
    into scope_pruids
    from (
      select distinct trim(source_pruid) as pruid
      from unnest(coalesce((
        select revision.scope_pruids
        from public.archive_source_revisions revision
        where revision.submission_id = target_submission_id
        order by revision.created_at desc, revision.id desc
        limit 1
      ), '{}'::text[])) as source(source_pruid)
      where trim(source_pruid) in (
        '10', '11', '12', '13', '24', '35', '46',
        '47', '48', '59', '60', '61', '62'
      )
      order by pruid
      limit 2
    ) candidate;
  end if;

  -- Active/request claims and archived snapshots are the next-best durable
  -- scope sources for records created before source revisions were introduced.
  if coalesce(cardinality(scope_pruids), 0) = 0 then
    select array_agg(candidate.pruid order by candidate.pruid)
    into scope_pruids
    from (
      select distinct candidates.pruid
      from (
        select nullif(trim(submission.active_claim_pruid), '') as pruid
        from public.submissions submission
        where submission.id = target_submission_id

        union all

        select nullif(trim(request.operating_pruid), '')
        from public.workspace_archive_requests request
        where request.submission_id = target_submission_id

        union all

        select nullif(trim(archive.submission_snapshot ->> 'active_claim_pruid'), '')
        from public.archive_tree archive
        where archive.submission_id = target_submission_id
      ) candidates
      where candidates.pruid in (
        '10', '11', '12', '13', '24', '35', '46',
        '47', '48', '59', '60', '61', '62'
      )
      order by candidates.pruid
      limit 2
    ) candidate;
  end if;

  -- A previously published event can restore the same immutable delivery
  -- scope without guessing from display-oriented map identifiers.
  if coalesce(cardinality(scope_pruids), 0) = 0 then
    select array_agg(candidate.pruid order by candidate.pruid)
    into scope_pruids
    from (
      select distinct trim(outbox_pruid) as pruid
      from unnest(coalesce((
        select outbox.scope_pruids
        from public.realtime_outbox outbox
        where outbox.aggregate_id = target_submission_id::text
        order by outbox.committed_at desc, outbox.id desc
        limit 1
      ), '{}'::text[])) as published(outbox_pruid)
      where trim(outbox_pruid) in (
        '10', '11', '12', '13', '24', '35', '46',
        '47', '48', '59', '60', '61', '62'
      )
      order by pruid
      limit 2
    ) candidate;
  end if;

  -- Support both canonical Statistics Canada DGUIDs and the legacy eight-digit
  -- DA identifiers already stored by early versions of the application.
  if coalesce(cardinality(scope_pruids), 0) = 0 then
    select array_agg(distinct derived.pruid order by derived.pruid)
    into scope_pruids
    from public.submissions submission
    cross join lateral (
      select coalesce(
        substring(trim(dguid) from '^[0-9]{4}S0512([0-9]{2})'),
        substring(trim(dguid) from '^([0-9]{2})[0-9]{6}$')
      ) as pruid
      from (values (submission.dguid), (submission.neighboring_dguid)) as dguids(dguid)
    ) derived
    where submission.id = target_submission_id
      and derived.pruid in (
        '10', '11', '12', '13', '24', '35', '46',
        '47', '48', '59', '60', '61', '62'
      );
  end if;

  if coalesce(cardinality(scope_pruids), 0) = 0 then
    raise exception 'Realtime scope is unavailable for submission %', target_submission_id;
  end if;

  insert into public.submission_scope_pruids (submission_id, pruid)
  select target_submission_id, pruid
  from unnest(scope_pruids) as pruid
  on conflict (submission_id, pruid) do nothing;

  return scope_pruids;
end;
$$;

create or replace function public.delete_archive_branch(
  target_branch_key text
)
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_id uuid;
  submission_ids uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended(target_branch_key, 0));
  perform 1
  from public.archive_tree
  where branch_key = target_branch_key
  for update;

  select array_agg(distinct archive.submission_id order by archive.submission_id)
  into submission_ids
  from public.archive_tree archive
  where archive.branch_key = target_branch_key;

  if coalesce(cardinality(submission_ids), 0) = 0 then
    raise exception 'Archived branch not found.' using errcode = 'P0002';
  end if;

  perform 1
  from public.submissions submission
  where submission.id = any(submission_ids)
  for update;

  -- Resolve and persist scope while every possible legacy source still exists.
  foreach submission_id in array submission_ids loop
    perform public.checkpoint0_submission_scope(submission_id);
  end loop;

  -- Remove restrictive Archive Request dependencies before their submissions.
  -- Request votes cascade from workspace_archive_requests.
  delete from public.workspace_archive_requests request
  where request.submission_id = any(submission_ids);

  delete from public.archive_source_revisions revision
  where revision.submission_id = any(submission_ids);

  delete from public.archive_tree archive
  where archive.branch_key = target_branch_key;

  delete from public.submissions submission
  where submission.id = any(submission_ids);

  return submission_ids;
end;
$$;

revoke all on function public.checkpoint0_submission_scope(uuid)
  from public, anon, authenticated;
revoke all on function public.delete_archive_branch(text)
  from public, anon, authenticated;
grant execute on function public.delete_archive_branch(text) to service_role;
