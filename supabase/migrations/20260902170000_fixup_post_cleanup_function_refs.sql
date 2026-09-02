-- Post-cleanup fix: remove references to dropped legacy tables from live
-- functions that still run on every submission insert.

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
      ) candidates
      where candidates.pruid in (
        '10', '11', '12', '13', '24', '35', '46',
        '47', '48', '59', '60', '61', '62'
      )
      order by candidates.pruid
      limit 2
    ) candidate;
  end if;

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

create or replace function public.submission_matches_commissioner_pruid(
  p_submission_id uuid,
  p_dguid text,
  p_neighboring_dguid text,
  p_pruid text
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.submission_scope_pruids scope
    where scope.submission_id = p_submission_id
      and scope.pruid = trim(p_pruid)
  )
  or exists (
    select 1
    from (
      select coalesce(
        substring(trim(dguid) from '^[0-9]{4}S0512([0-9]{2})'),
        substring(trim(dguid) from '^([0-9]{2})[0-9]{6}$')
      ) as pruid
      from (values (p_dguid), (p_neighboring_dguid)) as dguids(dguid)
    ) derived
    where derived.pruid = trim(p_pruid)
  );
$$;

revoke all on function public.checkpoint0_submission_scope(uuid) from public, anon, authenticated;
grant execute on function public.checkpoint0_submission_scope(uuid) to service_role;
