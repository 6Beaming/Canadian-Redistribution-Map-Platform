-- Archived Tree v2: immutable branch history plus a materialized current map.
-- Expand-only. The legacy archive_tree remains the read authority until its
-- backfill report has no unresolved rows and the cutover is explicitly run.

create sequence if not exists public.archive_merge_sequence_seq start with 1;
create sequence if not exists public.archive_map_revision_sequence_seq start with 1;

create table if not exists public.archive_branches (
  id uuid primary key default gen_random_uuid(),
  branch_key text not null unique check (length(trim(branch_key)) > 0),
  submission_type text not null check (submission_type in ('comment', 'objection', 'counter_proposal')),
  release_id text not null references public.map_data_releases (release_id) on delete restrict,
  primary_dguid text not null check (length(trim(primary_dguid)) > 0),
  secondary_dguid text,
  head_version_id uuid,
  head_version_number integer not null default 0 check (head_version_number >= 0),
  resource_version bigint not null default 1 check (resource_version > 0),
  scope_pruids text[] not null check (cardinality(scope_pruids) between 1 and 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (submission_type = 'comment' and secondary_dguid is null)
    or (submission_type in ('objection', 'counter_proposal') and primary_dguid < secondary_dguid)
  )
);

create table if not exists public.archive_versions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.archive_branches (id) on delete cascade,
  version_number integer not null check (version_number > 0),
  merge_sequence bigint not null default nextval('public.archive_merge_sequence_seq') unique,
  version_kind text not null check (version_kind in ('merge', 'revert', 'migration')),
  source_submission_id uuid references public.submissions (id) on delete restrict,
  source_geometry_revision_id uuid references public.submission_geometry_revisions (id) on delete restrict,
  revert_target_version_id uuid references public.archive_versions (id) on delete restrict,
  submission_projection jsonb not null,
  branch_vertex_snapshot jsonb,
  result_geometry jsonb,
  display_geometry jsonb,
  geometry_digest text,
  validation_report jsonb not null default '{}'::jsonb,
  closing_comment jsonb,
  merged_by uuid not null references public.profiles (id) on delete restrict,
  merged_at timestamptz not null default now(),
  unique (branch_id, version_number),
  check (geometry_digest is null or geometry_digest ~ '^sha256:[0-9a-f]{64}$')
);

alter table public.archive_branches
  add constraint archive_branches_head_version_fk
  foreign key (head_version_id) references public.archive_versions (id) on delete restrict;

create index if not exists archive_versions_branch_history_idx
  on public.archive_versions (branch_id, version_number desc);
create index if not exists archive_versions_submission_idx
  on public.archive_versions (source_submission_id);
create unique index if not exists archive_versions_source_submission_uidx
  on public.archive_versions (branch_id, source_submission_id)
  where source_submission_id is not null and version_kind in ('merge', 'migration');

create or replace function public.validate_archive_version_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  branch_type text;
begin
  select submission_type into branch_type
  from public.archive_branches where id = new.branch_id;
  if branch_type is null then
    raise exception 'archive branch not found' using errcode = '23503';
  end if;
  if branch_type = 'counter_proposal' then
    if new.branch_vertex_snapshot is null or new.result_geometry is null
      or new.display_geometry is null or new.geometry_digest is null
    then
      raise exception 'counter-proposal archive versions require exact/display geometry and vertex state'
        using errcode = '23514';
    end if;
  elsif new.branch_vertex_snapshot is not null or new.result_geometry is not null
    or new.display_geometry is not null or new.geometry_digest is not null
  then
    raise exception 'comment/objection archive versions must not persist geometry'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists archive_versions_shape_trg on public.archive_versions;
create trigger archive_versions_shape_trg
  before insert or update on public.archive_versions
  for each row execute function public.validate_archive_version_shape();

create table if not exists public.archive_version_operations (
  archive_version_id uuid not null references public.archive_versions (id) on delete cascade,
  operation_index integer not null check (operation_index >= 0),
  vertex_id text not null check (length(trim(vertex_id)) > 0),
  from_lng double precision not null check (from_lng between -180 and 180),
  from_lat double precision not null check (from_lat between -90 and 90),
  to_lng double precision not null check (to_lng between -180 and 180),
  to_lat double precision not null check (to_lat between -90 and 90),
  source_submission_operation_index integer check (source_submission_operation_index >= 0),
  primary key (archive_version_id, vertex_id),
  unique (archive_version_id, operation_index)
);

create table if not exists public.archive_vertex_state (
  branch_id uuid not null references public.archive_branches (id) on delete cascade,
  vertex_id text not null check (length(trim(vertex_id)) > 0),
  lng double precision not null check (lng between -180 and 180),
  lat double precision not null check (lat between -90 and 90),
  last_merge_sequence bigint not null,
  last_version_id uuid not null references public.archive_versions (id) on delete cascade,
  source_submission_id uuid references public.submissions (id) on delete set null,
  primary key (branch_id, vertex_id)
);

create table if not exists public.archive_map_revisions (
  sequence bigint primary key default nextval('public.archive_map_revision_sequence_seq'),
  release_id text not null references public.map_data_releases (release_id) on delete restrict,
  source_archive_version_id uuid references public.archive_versions (id) on delete set null,
  source_branch_key text not null check (length(trim(source_branch_key)) > 0),
  source_submission_ids uuid[] not null default '{}'::uuid[],
  transition_kind text not null check (transition_kind in ('genesis', 'merge', 'revert', 'delete')),
  affected_dguids text[] not null,
  before_digests jsonb not null default '{}'::jsonb,
  after_digests jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  check ((sequence = 0) = (transition_kind = 'genesis'))
);

create index if not exists archive_map_revisions_release_sequence_idx
  on public.archive_map_revisions (release_id, sequence desc);

create table if not exists public.archive_map_da_heads (
  release_id text not null references public.map_data_releases (release_id) on delete restrict,
  dguid text not null check (length(trim(dguid)) > 0),
  uses_base boolean not null,
  geometry jsonb,
  display_geometry jsonb,
  geometry_digest text not null check (geometry_digest ~ '^sha256:[0-9a-f]{64}$'),
  resource_version bigint not null default 1 check (resource_version > 0),
  last_map_revision_sequence bigint not null references public.archive_map_revisions (sequence) on delete restrict,
  last_archive_version_id uuid references public.archive_versions (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (release_id, dguid),
  check (
    (uses_base and geometry is null and display_geometry is null)
    or (not uses_base and geometry is not null and display_geometry is not null)
  )
);

alter table public.archive_branches enable row level security;
alter table public.archive_versions enable row level security;
alter table public.archive_version_operations enable row level security;
alter table public.archive_vertex_state enable row level security;
alter table public.archive_map_revisions enable row level security;
alter table public.archive_map_da_heads enable row level security;

revoke all on table public.archive_branches from anon, authenticated;
revoke all on table public.archive_versions from anon, authenticated;
revoke all on table public.archive_version_operations from anon, authenticated;
revoke all on table public.archive_vertex_state from anon, authenticated;
revoke all on table public.archive_map_revisions from anon, authenticated;
revoke all on table public.archive_map_da_heads from anon, authenticated;

create or replace function public.ensure_archive_map_genesis(p_release_id text)
returns public.archive_map_revisions
language plpgsql
security definer
set search_path = public
as $$
declare
  genesis public.archive_map_revisions;
begin
  if not exists (
    select 1 from public.map_data_releases
    where release_id = p_release_id and state in ('draft', 'active')
  ) then
    raise exception 'unknown map release' using errcode = '23503';
  end if;
  insert into public.archive_map_revisions (
    sequence, release_id, source_branch_key, transition_kind,
    affected_dguids, before_digests, after_digests
  ) values (0, p_release_id, 'genesis:' || p_release_id, 'genesis', '{}', '{}', '{}')
  on conflict (sequence) do update set sequence = excluded.sequence
  where public.archive_map_revisions.release_id = excluded.release_id
  returning * into genesis;
  if genesis.sequence is null then
    raise exception 'archive genesis already belongs to a different release' using errcode = '23505';
  end if;
  return genesis;
end;
$$;

revoke all on function public.ensure_archive_map_genesis(text) from public, anon, authenticated;
grant execute on function public.ensure_archive_map_genesis(text) to service_role;
revoke all on function public.validate_archive_version_shape() from public, anon, authenticated;
