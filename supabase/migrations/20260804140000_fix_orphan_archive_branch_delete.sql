-- Delete Forever must tolerate legacy Archived Tree rows whose source
-- submission was already removed. Apply after
-- 20260804130000_fix_archive_branch_delete.sql.

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

  -- Only submissions with an existing parent row can receive immutable scope.
  -- Orphaned archive rows still continue through the cleanup below.
  for submission_id in
    select submission.id
    from public.submissions submission
    where submission.id = any(submission_ids)
    order by submission.id
  loop
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

revoke all on function public.delete_archive_branch(text)
  from public, anon, authenticated;
grant execute on function public.delete_archive_branch(text) to service_role;
