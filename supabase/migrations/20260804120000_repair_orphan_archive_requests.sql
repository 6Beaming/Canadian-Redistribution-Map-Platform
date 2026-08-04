-- CP4 replaced the legacy Archive Request table. Submissions that were already
-- marked archive-request could therefore be left without an active durable
-- request. Return only those orphaned submissions to accepted so a
-- commissioner can create a complete request through the CP4 workflow.
update public.submissions as submission
set
  status = 'accepted',
  resource_version = greatest(coalesce(submission.resource_version, 1), 1) + 1,
  active_claim_pruid = null,
  active_claim_kind = null,
  active_claim_actor_id = null,
  active_claim_at = null,
  updated_at = now()
where submission.status = 'archive-request'
  and not exists (
    select 1
    from public.workspace_archive_requests as request
    where request.submission_id = submission.id
      and request.state in ('open', 'approved')
  );
