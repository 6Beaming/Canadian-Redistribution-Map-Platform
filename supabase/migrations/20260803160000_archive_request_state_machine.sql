-- CP4 Priority 1: Archive Request state machine, sealed source, votes, outbox.
-- Apply after 20260803150000_submission_scope_pruids_and_claims.sql.

create table if not exists public.archive_source_revisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete restrict,
  submission_type text not null,
  revision_number integer not null default 1 check (revision_number > 0),
  primary_dguid text not null check (length(trim(primary_dguid)) > 0),
  secondary_dguid text,
  scope_pruids text[] not null check (cardinality(scope_pruids) between 1 and 2),
  baseline_revision text,
  original_geometry jsonb,
  proposed_geometry jsonb,
  shared_boundary jsonb,
  outer_boundary jsonb,
  validation_report jsonb not null default '{}'::jsonb,
  source_counter_proposal_revision_id uuid
    references public.counter_proposal_revisions (id) on delete set null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists archive_source_revisions_submission_idx
  on public.archive_source_revisions (submission_id, created_at desc);

create table if not exists public.realtime_outbox (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id text not null,
  operation text not null check (operation in ('create', 'update', 'delete')),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  owner_profile_id uuid references public.profiles (id) on delete set null,
  scope_pruids text[] not null,
  operating_pruid text,
  resource_version bigint,
  projection_hints jsonb not null default '{}'::jsonb,
  committed_at timestamptz not null default now()
);

create index if not exists realtime_outbox_committed_at_idx
  on public.realtime_outbox (committed_at desc);

create index if not exists realtime_outbox_aggregate_idx
  on public.realtime_outbox (aggregate_type, aggregate_id, committed_at desc);

create table if not exists public.realtime_scope_deliveries (
  outbox_id uuid not null references public.realtime_outbox (id) on delete cascade,
  pruid text not null check (length(trim(pruid)) > 0),
  scope_sequence bigint not null,
  dispatched_at timestamptz,
  primary key (outbox_id, pruid),
  unique (pruid, scope_sequence)
);

create index if not exists realtime_scope_deliveries_pruid_seq_idx
  on public.realtime_scope_deliveries (pruid, scope_sequence);

-- Replace the Demo-3 email/JSONB skeleton with the CP4 request identity model.
drop table if exists public.workspace_archive_requests cascade;

create table public.workspace_archive_requests (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  requester_id uuid not null references public.profiles (id) on delete restrict,
  operating_pruid text not null check (length(trim(operating_pruid)) > 0),
  source_revision_id uuid not null
    references public.archive_source_revisions (id) on delete restrict,
  state text not null
    check (state in ('open', 'approved', 'rejected', 'cancelled', 'consumed')),
  resource_version bigint not null default 1 check (resource_version > 0),
  assignee_ids uuid[] not null default '{}'::uuid[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists workspace_archive_requests_active_submission_uidx
  on public.workspace_archive_requests (submission_id)
  where state in ('open', 'approved');

create index if not exists workspace_archive_requests_state_idx
  on public.workspace_archive_requests (state, updated_at desc);

create index if not exists workspace_archive_requests_operating_pruid_idx
  on public.workspace_archive_requests (operating_pruid);

create table if not exists public.workspace_archive_request_votes (
  request_id uuid not null
    references public.workspace_archive_requests (id) on delete cascade,
  voter_id uuid not null references public.profiles (id) on delete restrict,
  vote text not null check (vote in ('accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (request_id, voter_id)
);

create index if not exists workspace_archive_request_votes_voter_idx
  on public.workspace_archive_request_votes (voter_id);

alter table public.archive_source_revisions enable row level security;
alter table public.realtime_outbox enable row level security;
alter table public.realtime_scope_deliveries enable row level security;
alter table public.workspace_archive_requests enable row level security;
alter table public.workspace_archive_request_votes enable row level security;
