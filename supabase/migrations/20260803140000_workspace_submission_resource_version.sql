-- CP4 Priority 1: durable Workspace status versioning.
-- Apply after 20260802130000_local_workspace_custom_labels.sql.

alter table public.submissions
  add column if not exists resource_version bigint;

update public.submissions
set resource_version = 1
where resource_version is null;

alter table public.submissions
  alter column resource_version set default 1;

alter table public.submissions
  alter column resource_version set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_resource_version_positive_check'
      and conrelid = 'public.submissions'::regclass
  ) then
    alter table public.submissions
      add constraint submissions_resource_version_positive_check
      check (resource_version > 0);
  end if;
end
$$;

create index if not exists submissions_resource_version_idx
  on public.submissions (id, resource_version);
