-- Supabase-only Archived Tree version state and atomic mutations.
-- Apply after 20260719160000_create_workspace_tables.sql.

create or replace function public.archive_branch_key(
  snapshot jsonb,
  fallback_submission_id uuid
)
returns text
language plpgsql
immutable
as $$
declare
  submission_type text := replace(lower(coalesce(snapshot ->> 'type', 'feedback')), '_', '-');
  first_dguid text := nullif(trim(coalesce(snapshot ->> 'dguid', '')), '');
  second_dguid text := nullif(trim(coalesce(snapshot ->> 'neighboring_dguid', '')), '');
begin
  if submission_type in ('comment', 'comments') then
    submission_type := 'feedback';
  elsif submission_type = 'counterproposal' then
    submission_type := 'counter-proposal';
  end if;

  if submission_type = 'feedback' or second_dguid is null then
    return submission_type || ':' || coalesce(first_dguid, fallback_submission_id::text);
  end if;

  return submission_type || ':' || least(first_dguid, second_dguid) || '|' || greatest(first_dguid, second_dguid);
end;
$$;

alter table public.archive_tree
  add column if not exists branch_key text,
  add column if not exists version_number integer,
  add column if not exists is_latest boolean not null default false,
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_by uuid references public.profiles(id) on delete restrict;

update public.archive_tree
set branch_key = public.archive_branch_key(submission_snapshot, submission_id)
where branch_key is null;

with ranked as (
  select
    id,
    row_number() over (
      partition by branch_key
      order by merged_at asc, id asc
    ) as next_version
  from public.archive_tree
)
update public.archive_tree as archive
set version_number = ranked.next_version::integer
from ranked
where archive.id = ranked.id
  and archive.version_number is null;

update public.archive_tree set is_latest = false;

with latest as (
  select distinct on (branch_key) id
  from public.archive_tree
  order by branch_key, version_number desc, merged_at desc, id desc
)
update public.archive_tree as archive
set is_latest = true
from latest
where archive.id = latest.id;

alter table public.archive_tree
  alter column branch_key set not null,
  alter column version_number set not null;

create index if not exists archive_tree_branch_version_idx
  on public.archive_tree (branch_key, version_number);

create unique index if not exists archive_tree_one_latest_per_branch_idx
  on public.archive_tree (branch_key)
  where is_latest;

create or replace function public.merge_submission_into_archive(
  target_submission_id uuid,
  target_merged_by uuid,
  target_closing_comment jsonb default null
)
returns public.archive_tree
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_row public.submissions%rowtype;
  existing_row public.archive_tree%rowtype;
  archived_row public.archive_tree%rowtype;
  target_branch_key text;
  next_version integer;
begin
  select * into submission_row
  from public.submissions
  where id = target_submission_id
  for update;

  if not found then
    raise exception 'Submission not found.' using errcode = 'P0002';
  end if;

  target_branch_key := public.archive_branch_key(to_jsonb(submission_row), submission_row.id);
  perform pg_advisory_xact_lock(hashtextextended(target_branch_key, 0));

  perform 1
  from public.archive_tree
  where branch_key = target_branch_key
  for update;

  select * into existing_row
  from public.archive_tree
  where submission_id = target_submission_id;

  update public.archive_tree
  set is_latest = false
  where branch_key = target_branch_key
    and is_latest;

  if existing_row.id is not null then
    update public.archive_tree
    set
      submission_snapshot = to_jsonb(submission_row),
      merged_by = target_merged_by,
      merged_at = now(),
      closing_comment = target_closing_comment,
      branch_key = target_branch_key,
      is_latest = true,
      reverted_at = null,
      reverted_by = null
    where id = existing_row.id
    returning * into archived_row;
  else
    select coalesce(max(version_number), 0) + 1
      into next_version
    from public.archive_tree
    where branch_key = target_branch_key;

    insert into public.archive_tree (
      submission_id,
      submission_snapshot,
      merged_by,
      merged_at,
      closing_comment,
      branch_key,
      version_number,
      is_latest
    ) values (
      submission_row.id,
      to_jsonb(submission_row),
      target_merged_by,
      now(),
      target_closing_comment,
      target_branch_key,
      next_version,
      true
    )
    returning * into archived_row;
  end if;

  delete from public.workspace_comments where submission_id = target_submission_id;
  delete from public.workspace_labels where submission_id = target_submission_id;
  delete from public.workspace_archive_requests where submission_id = target_submission_id;
  update public.submissions
  set status = 'archived', updated_at = now()
  where id = target_submission_id;

  return archived_row;
end;
$$;

create or replace function public.revert_archive_branch(
  target_branch_key text,
  target_submission_id uuid,
  target_reverted_by uuid
)
returns public.archive_tree
language plpgsql
security definer
set search_path = public
as $$
declare
  reverted_row public.archive_tree%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_branch_key, 0));
  perform 1
  from public.archive_tree
  where branch_key = target_branch_key
  for update;

  if not exists (
    select 1 from public.archive_tree
    where branch_key = target_branch_key
      and submission_id = target_submission_id
  ) then
    raise exception 'Archived version not found in this branch.' using errcode = 'P0002';
  end if;

  update public.archive_tree
  set is_latest = false
  where branch_key = target_branch_key
    and is_latest;

  update public.archive_tree
  set
    is_latest = true,
    reverted_at = now(),
    reverted_by = target_reverted_by
  where branch_key = target_branch_key
    and submission_id = target_submission_id
  returning * into reverted_row;

  return reverted_row;
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
  submission_ids uuid[];
begin
  perform pg_advisory_xact_lock(hashtextextended(target_branch_key, 0));
  perform 1
  from public.archive_tree
  where branch_key = target_branch_key
  for update;

  select array_agg(submission_id)
    into submission_ids
  from public.archive_tree
  where branch_key = target_branch_key;

  if coalesce(array_length(submission_ids, 1), 0) = 0 then
    raise exception 'Archived branch not found.' using errcode = 'P0002';
  end if;

  delete from public.archive_tree
  where branch_key = target_branch_key;

  delete from public.submissions
  where id = any(submission_ids);

  return submission_ids;
end;
$$;

revoke all on function public.archive_branch_key(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.merge_submission_into_archive(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.revert_archive_branch(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.delete_archive_branch(text) from public, anon, authenticated;

grant execute on function public.merge_submission_into_archive(uuid, uuid, jsonb) to service_role;
grant execute on function public.revert_archive_branch(text, uuid, uuid) to service_role;
grant execute on function public.delete_archive_branch(text) to service_role;
