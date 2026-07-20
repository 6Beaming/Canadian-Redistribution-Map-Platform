-- Replace the legacy submission status constraint with the Workspace contract.
-- The prior constraint accepted `under_review` and `approved`, while the
-- Workspace uses `archive-request` and `accepted`.

update public.submissions
set status = case status
  when 'under_review' then 'pending'
  when 'approved' then 'accepted'
  else status
end
where status in ('under_review', 'approved');

alter table public.submissions
  drop constraint if exists submissions_status_check;

alter table public.submissions
  drop constraint if exists submissions_workspace_status_check;

alter table public.submissions
  add constraint submissions_status_check
  check (status in ('pending', 'accepted', 'rejected', 'archive-request', 'archived'));

-- The existing type contract deliberately retains `counter_proposal` with an
-- underscore. The frontend normalizes it to `counter-proposal` for display.
