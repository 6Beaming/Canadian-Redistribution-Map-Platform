-- CP4 Priority 1: immutable submission PRUID eligibility + operation claim fields.
-- Apply after 20260803140000_workspace_submission_resource_version.sql.

create table if not exists public.submission_scope_pruids (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  pruid text not null,
  created_at timestamptz not null default now(),
  primary key (submission_id, pruid),
  constraint submission_scope_pruids_pruid_check
    check (length(trim(pruid)) > 0)
);

create index if not exists submission_scope_pruids_pruid_idx
  on public.submission_scope_pruids (pruid);

create or replace function public.enforce_submission_scope_pruid_limit()
returns trigger
language plpgsql
as $$
declare
  scope_count integer;
begin
  select count(*)::integer
  into scope_count
  from public.submission_scope_pruids
  where submission_id = new.submission_id;

  if scope_count > 2 then
    raise exception 'submission_scope_pruids allows at most two PRUIDs per submission';
  end if;

  return new;
end;
$$;

drop trigger if exists submission_scope_pruids_limit_trg on public.submission_scope_pruids;
create trigger submission_scope_pruids_limit_trg
  after insert on public.submission_scope_pruids
  for each row
  execute function public.enforce_submission_scope_pruid_limit();

alter table public.submissions
  add column if not exists active_claim_pruid text;

alter table public.submissions
  add column if not exists active_claim_kind text;

alter table public.submissions
  add column if not exists active_claim_actor_id uuid;

alter table public.submissions
  add column if not exists active_claim_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_active_claim_actor_id_fkey'
      and conrelid = 'public.submissions'::regclass
  ) then
    alter table public.submissions
      add constraint submissions_active_claim_actor_id_fkey
      foreign key (active_claim_actor_id) references public.profiles (id)
      on delete set null;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'submissions_active_claim_kind_check'
      and conrelid = 'public.submissions'::regclass
  ) then
    alter table public.submissions
      add constraint submissions_active_claim_kind_check
      check (
        active_claim_kind is null
        or active_claim_kind in ('workspace-status', 'archive-request')
      );
  end if;
end
$$;

create index if not exists submissions_active_claim_pruid_idx
  on public.submissions (active_claim_pruid)
  where active_claim_pruid is not null;

-- Browser clients have no direct policies. Express uses the service-role client,
-- which bypasses RLS. Enabling RLS blocks anon/authenticated table access.
alter table public.submission_scope_pruids enable row level security;

revoke all on function public.enforce_submission_scope_pruid_limit()
  from public, anon, authenticated;
