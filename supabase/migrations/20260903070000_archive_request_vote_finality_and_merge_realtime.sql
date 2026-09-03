-- Archive Request votes are final, and consuming a request publishes an
-- explicit realtime tombstone in the same transaction as the archive merge.

create or replace function public.prevent_archive_request_vote_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'ARCHIVE_REQUEST_ALREADY_VOTED'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists archive_request_vote_finality_trg
  on public.workspace_archive_request_votes;
create trigger archive_request_vote_finality_trg
  before update on public.workspace_archive_request_votes
  for each row
  execute function public.prevent_archive_request_vote_update();

create or replace function public.checkpoint0_archive_request_consumed_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_id uuid;
begin
  if old.state is distinct from new.state and new.state = 'consumed' then
    event_id := public.checkpoint0_enqueue_realtime_event(
      'workspace.archive-request',
      new.id::text,
      new.id::text,
      'delete',
      new.resource_version,
      new.submission_id,
      new.requester_id,
      new.operating_pruid
    );

    update public.realtime_outbox
    set projection_hints = projection_hints || jsonb_build_object(
      'submissionId', new.submission_id::text,
      'state', 'consumed'
    )
    where id = event_id;
  end if;

  return new;
end;
$$;

drop trigger if exists checkpoint0_archive_request_consumed_realtime_trg
  on public.workspace_archive_requests;
create trigger checkpoint0_archive_request_consumed_realtime_trg
  after update of state on public.workspace_archive_requests
  for each row
  execute function public.checkpoint0_archive_request_consumed_realtime();

revoke all on function public.prevent_archive_request_vote_update() from public, anon, authenticated;
revoke all on function public.checkpoint0_archive_request_consumed_realtime() from public, anon, authenticated;
grant execute on function public.prevent_archive_request_vote_update() to service_role;
grant execute on function public.checkpoint0_archive_request_consumed_realtime() to service_role;
