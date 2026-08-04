-- Checkpoint 0 Priority 1: transactional adapters for the frozen CP4 outbox.
-- Apply after 20260803160000_archive_request_state_machine.sql.

-- Every application instance reads the same per-PRUID stream. Allocate its
-- sequence under a transaction-scoped advisory lock so concurrent writers
-- cannot create duplicate sequence numbers.
create or replace function public.checkpoint0_assign_realtime_scope_sequence()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('checkpoint0-realtime:' || trim(new.pruid), 0)
  );

  select coalesce(max(scope_sequence), 0) + 1
  into new.scope_sequence
  from public.realtime_scope_deliveries
  where pruid = new.pruid;

  return new;
end;
$$;

drop trigger if exists checkpoint0_realtime_scope_sequence_trg
  on public.realtime_scope_deliveries;
create trigger checkpoint0_realtime_scope_sequence_trg
  before insert on public.realtime_scope_deliveries
  for each row
  execute function public.checkpoint0_assign_realtime_scope_sequence();

-- CP4 persists the immutable scope relation lazily. Mutation triggers cannot
-- call the map service, so this adapter first uses that relation and only
-- derives a missing PRUID from the canonical Statistics Canada DA DGUID.
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
    select array_agg(distinct derived.pruid order by derived.pruid)
    into scope_pruids
    from public.submissions submission
    cross join lateral (
      select substring(dguid from '^[0-9]{4}S0512([0-9]{2})') as pruid
      from (values (submission.dguid), (submission.neighboring_dguid)) as dguids(dguid)
    ) derived
    where submission.id = target_submission_id
      and derived.pruid in (
        '10', '11', '12', '13', '24', '35', '46',
        '47', '48', '59', '60', '61', '62'
      );

    if coalesce(cardinality(scope_pruids), 0) = 0 then
      raise exception 'Realtime scope is unavailable for submission %', target_submission_id;
    end if;

    insert into public.submission_scope_pruids (submission_id, pruid)
    select target_submission_id, pruid
    from unnest(scope_pruids) as pruid
    on conflict (submission_id, pruid) do nothing;
  end if;

  return scope_pruids;
end;
$$;

create or replace function public.checkpoint0_realtime_timestamp_version()
returns bigint
language sql
volatile
as $$
  select floor(extract(epoch from clock_timestamp()) * 1000000)::bigint;
$$;

create or replace function public.checkpoint0_enqueue_realtime_event(
  target_entity text,
  target_aggregate_id text,
  target_entity_id text,
  target_operation text,
  target_resource_version bigint,
  target_submission_id uuid,
  target_actor_profile_id uuid default null,
  target_operating_pruid text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  delivery_pruid text;
  event_id uuid;
  scope_pruids text[];
begin
  if target_operation not in ('create', 'update', 'delete') then
    raise exception 'Unsupported realtime operation: %', target_operation;
  end if;

  scope_pruids := public.checkpoint0_submission_scope(target_submission_id);

  insert into public.realtime_outbox (
    aggregate_type,
    aggregate_id,
    operation,
    actor_profile_id,
    scope_pruids,
    operating_pruid,
    resource_version,
    projection_hints
  ) values (
    target_entity,
    target_aggregate_id,
    target_operation,
    target_actor_profile_id,
    scope_pruids,
    target_operating_pruid,
    target_resource_version,
    jsonb_build_object(
      'entity', target_entity,
      'entityId', target_entity_id
    )
  )
  returning id into event_id;

  foreach delivery_pruid in array scope_pruids loop
    insert into public.realtime_scope_deliveries (
      outbox_id,
      pruid,
      scope_sequence
    ) values (
      event_id,
      delivery_pruid,
      0
    );
  end loop;

  return event_id;
end;
$$;

-- Issue 102/103: submission creation and supported feedback deletion.
create or replace function public.checkpoint0_submission_insert_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.checkpoint0_submission_scope(new.id);

  if new.type in ('feedback', 'objection') then
    perform public.checkpoint0_enqueue_realtime_event(
      'submission',
      new.id::text,
      new.id::text,
      'create',
      new.resource_version,
      new.id,
      new.user_id
    );
  end if;

  return new;
end;
$$;

drop trigger if exists checkpoint0_submission_insert_realtime_trg
  on public.submissions;
create trigger checkpoint0_submission_insert_realtime_trg
  after insert on public.submissions
  for each row
  execute function public.checkpoint0_submission_insert_realtime();

create or replace function public.checkpoint0_counter_proposal_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.checkpoint0_enqueue_realtime_event(
    'submission',
    new.submission_id::text,
    new.submission_id::text,
    case when new.revision_number = 1 then 'create' else 'update' end,
    new.revision_number,
    new.submission_id,
    new.created_by
  );
  return new;
end;
$$;

drop trigger if exists checkpoint0_counter_proposal_realtime_trg
  on public.counter_proposal_revisions;
create trigger checkpoint0_counter_proposal_realtime_trg
  after insert on public.counter_proposal_revisions
  for each row
  execute function public.checkpoint0_counter_proposal_realtime();

create or replace function public.checkpoint0_submission_delete_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- CP2 exposes deletion only for a public user's own feedback submission.
  if old.type = 'feedback' then
    perform public.checkpoint0_enqueue_realtime_event(
      'submission',
      old.id::text,
      old.id::text,
      'delete',
      old.resource_version + 1,
      old.id,
      old.user_id
    );
  end if;
  return old;
end;
$$;

drop trigger if exists checkpoint0_submission_delete_realtime_trg
  on public.submissions;
create trigger checkpoint0_submission_delete_realtime_trg
  before delete on public.submissions
  for each row
  execute function public.checkpoint0_submission_delete_realtime();

-- Issue 101: every committed status transition gets its own durable event.
create or replace function public.checkpoint0_workspace_status_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    perform public.checkpoint0_enqueue_realtime_event(
      'workspace.status',
      new.id::text,
      new.id::text,
      'update',
      new.resource_version,
      new.id,
      coalesce(old.active_claim_actor_id, new.active_claim_actor_id),
      coalesce(old.active_claim_pruid, new.active_claim_pruid)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists checkpoint0_workspace_status_realtime_trg
  on public.submissions;
create trigger checkpoint0_workspace_status_realtime_trg
  after update of status on public.submissions
  for each row
  execute function public.checkpoint0_workspace_status_realtime();

-- Issue 104: comments publish identifiers only; bodies remain HTTP-only.
create or replace function public.checkpoint0_workspace_comment_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.workspace_comments%rowtype;
begin
  if tg_op = 'DELETE' then
    event_row := old;
  else
    event_row := new;
  end if;
  perform public.checkpoint0_enqueue_realtime_event(
    'workspace.comment',
    event_row.submission_id::text,
    event_row.id::text,
    lower(tg_op),
    public.checkpoint0_realtime_timestamp_version(),
    event_row.submission_id,
    event_row.author_id
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists checkpoint0_workspace_comment_realtime_trg
  on public.workspace_comments;
create trigger checkpoint0_workspace_comment_realtime_trg
  after insert or update or delete on public.workspace_comments
  for each row
  execute function public.checkpoint0_workspace_comment_realtime();

-- Issues 105/106: direct row mutations distinguish the selected label set
-- from a submission-local custom label definition.
create or replace function public.checkpoint0_workspace_label_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.workspace_labels%rowtype;
  event_entity text;
begin
  if current_setting('crmp.checkpoint0_label_batch', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    event_row := old;
  else
    event_row := new;
  end if;
  event_entity := case
    when event_row.is_custom then 'workspace.custom-label'
    else 'workspace.label'
  end;

  perform public.checkpoint0_enqueue_realtime_event(
    event_entity,
    event_row.submission_id::text,
    case
      when event_row.is_custom then event_row.id::text
      else event_row.submission_id::text
    end,
    lower(tg_op),
    public.checkpoint0_realtime_timestamp_version(),
    event_row.submission_id,
    event_row.updated_by
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists checkpoint0_workspace_label_realtime_trg
  on public.workspace_labels;
create trigger checkpoint0_workspace_label_realtime_trg
  after insert or update or delete on public.workspace_labels
  for each row
  execute function public.checkpoint0_workspace_label_realtime();

create or replace function public.checkpoint0_set_submission_workspace_labels(
  target_submission_id uuid,
  target_updated_by uuid,
  target_labels jsonb
)
returns setof public.workspace_labels
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('crmp.checkpoint0_label_batch', 'on', true);

  return query
  select * from public.set_submission_workspace_labels(
    target_submission_id,
    target_updated_by,
    target_labels
  );

  perform public.checkpoint0_enqueue_realtime_event(
    'workspace.label',
    target_submission_id::text,
    target_submission_id::text,
    'update',
    public.checkpoint0_realtime_timestamp_version(),
    target_submission_id,
    target_updated_by
  );
end;
$$;

revoke all on function public.checkpoint0_assign_realtime_scope_sequence()
  from public, anon, authenticated;
revoke all on function public.checkpoint0_submission_scope(uuid)
  from public, anon, authenticated;
revoke all on function public.checkpoint0_realtime_timestamp_version()
  from public, anon, authenticated;
revoke all on function public.checkpoint0_enqueue_realtime_event(
  text, text, text, text, bigint, uuid, uuid, text
) from public, anon, authenticated;
revoke all on function public.checkpoint0_submission_insert_realtime()
  from public, anon, authenticated;
revoke all on function public.checkpoint0_counter_proposal_realtime()
  from public, anon, authenticated;
revoke all on function public.checkpoint0_submission_delete_realtime()
  from public, anon, authenticated;
revoke all on function public.checkpoint0_workspace_status_realtime()
  from public, anon, authenticated;
revoke all on function public.checkpoint0_workspace_comment_realtime()
  from public, anon, authenticated;
revoke all on function public.checkpoint0_workspace_label_realtime()
  from public, anon, authenticated;
revoke all on function public.checkpoint0_set_submission_workspace_labels(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.checkpoint0_set_submission_workspace_labels(uuid, uuid, jsonb)
  to service_role;
