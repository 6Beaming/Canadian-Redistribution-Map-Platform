-- Counter-Proposal revision storage and local-metadata submission authority.
-- Apply after 20260720210000_add_profile_postal_map_centers.sql.

-- National DA validation moves to the Express map asset service. The legacy
-- dissemination_areas FK only covers the seeded Yukon subset and blocks valid
-- map selections elsewhere.
alter table public.submissions
  drop constraint if exists submissions_dguid_fkey;

alter table public.submissions
  drop constraint if exists submissions_neighboring_dguid_fkey;

create table if not exists public.counter_proposal_revisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  revision_number integer not null check (revision_number > 0),
  primary_dguid text not null check (length(trim(primary_dguid)) > 0),
  secondary_dguid text not null check (length(trim(secondary_dguid)) > 0),
  original_geometry jsonb not null,
  proposed_geometry jsonb not null,
  shared_boundary jsonb not null,
  outer_boundary jsonb not null,
  baseline_revision text not null check (length(trim(baseline_revision)) > 0),
  validation_report jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint counter_proposal_revisions_distinct_dguids_check
    check (primary_dguid <> secondary_dguid),
  constraint counter_proposal_revisions_submission_revision_unique
    unique (submission_id, revision_number)
);

create index if not exists counter_proposal_revisions_submission_idx
  on public.counter_proposal_revisions (submission_id, revision_number desc);

create index if not exists counter_proposal_revisions_primary_dguid_idx
  on public.counter_proposal_revisions (primary_dguid);

create index if not exists counter_proposal_revisions_secondary_dguid_idx
  on public.counter_proposal_revisions (secondary_dguid);

create index if not exists counter_proposal_revisions_da_pair_idx
  on public.counter_proposal_revisions (primary_dguid, secondary_dguid);

create index if not exists counter_proposal_revisions_created_by_idx
  on public.counter_proposal_revisions (created_by, created_at desc);

-- Browser access has no direct policies in this milestone. Authenticated
-- Express routes use the server-only service-role client.
alter table public.counter_proposal_revisions enable row level security;
