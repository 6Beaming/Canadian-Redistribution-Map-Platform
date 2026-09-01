-- Reconstruct the application tables that predate the committed migration
-- history.  Hosted environments already contain these objects, so every
-- statement is additive/idempotent; fresh local and CI databases need them
-- before the Workspace migrations can be replayed.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique check (length(trim(email)) > 0),
  first_name text,
  last_name text,
  province text,
  postal_code text,
  phone text unique,
  role text not null default 'public_user'
    check (role in ('public_user', 'commissioner')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pending_invites (
  email text primary key check (length(trim(email)) > 0),
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.dissemination_areas (
  dguid text primary key,
  dauid text,
  province_code text,
  fed_num text,
  geo_name text,
  population integer,
  community_name text,
  is_unorganized boolean not null default false,
  land_area double precision,
  status text,
  source_label text,
  source_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.map_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  title text not null,
  province_code text not null,
  status text not null default 'draft',
  is_baseline boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  type text not null default 'feedback'
    check (type in ('feedback', 'objection', 'counter_proposal')),
  proposal_id uuid references public.map_proposals (id) on delete set null,
  fed_num text,
  dguid text references public.dissemination_areas (dguid) on delete restrict,
  neighboring_dguid text references public.dissemination_areas (dguid) on delete restrict,
  title text not null,
  comment text not null,
  geometry jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'under_review', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint submissions_user_id_fkey
    foreign key (user_id) references public.profiles (id) on delete restrict
);

create index if not exists submissions_user_created_idx
  on public.submissions (user_id, created_at desc);
create index if not exists submissions_status_created_idx
  on public.submissions (status, created_at desc);
create index if not exists submissions_dguid_created_idx
  on public.submissions (dguid, created_at desc);
create index if not exists submissions_neighboring_dguid_created_idx
  on public.submissions (neighboring_dguid, created_at desc);

create table if not exists public.comment_tags (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.submissions (id) on delete cascade,
  tag text not null check (length(trim(tag)) > 0),
  created_at timestamptz not null default now()
);

create index if not exists comment_tags_comment_created_idx
  on public.comment_tags (comment_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.pending_invites enable row level security;
alter table public.dissemination_areas enable row level security;
alter table public.map_proposals enable row level security;
alter table public.submissions enable row level security;
alter table public.comment_tags enable row level security;

revoke all on table public.pending_invites from anon, authenticated;
