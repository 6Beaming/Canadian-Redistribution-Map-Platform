-- Immutable map-release identity and compact submission geometry revisions.
-- Expand-only: legacy geometry columns and tables remain available until the
-- verification/cutover migration is explicitly approved.

create table if not exists public.map_data_releases (
  release_id text primary key check (length(trim(release_id)) > 0),
  geometry_revision text not null check (length(trim(geometry_revision)) > 0),
  manifest_sha256 text not null check (manifest_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  topology_revision text not null check (length(trim(topology_revision)) > 0),
  normalization_version text not null check (length(trim(normalization_version)) > 0),
  vertex_schema_version text not null check (length(trim(vertex_schema_version)) > 0),
  lod_schema_version text not null check (length(trim(lod_schema_version)) > 0),
  state text not null default 'draft' check (state in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb,
  activated_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  unique (release_id, geometry_revision),
  check (
    (state = 'draft' and activated_at is null and retired_at is null)
    or (state = 'active' and activated_at is not null and retired_at is null)
    or (state = 'retired' and activated_at is not null and retired_at is not null)
  )
);

create unique index if not exists map_data_releases_one_active_uidx
  on public.map_data_releases ((state)) where state = 'active';

create table if not exists public.map_release_legacy_aliases (
  legacy_base_revision text primary key check (length(trim(legacy_base_revision)) > 0),
  release_id text not null references public.map_data_releases (release_id) on delete restrict,
  verification_state text not null default 'unverified'
    check (verification_state in ('unverified', 'verified', 'rejected')),
  evidence jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  check ((verification_state = 'verified') = (verified_at is not null))
);

alter table public.submissions
  add column if not exists release_id text references public.map_data_releases (release_id) on delete restrict;

create index if not exists submissions_release_id_idx on public.submissions (release_id);

create table if not exists public.submission_geometry_revisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions (id) on delete cascade,
  submission_type text not null check (submission_type in ('objection', 'counter_proposal')),
  revision_number integer not null check (revision_number > 0),
  release_id text not null,
  base_revision text not null,
  primary_dguid text not null check (length(trim(primary_dguid)) > 0),
  secondary_dguid text not null check (length(trim(secondary_dguid)) > 0),
  geometry_digest text not null check (geometry_digest ~ '^sha256:[0-9a-f]{64}$'),
  validation_report jsonb not null default '{}'::jsonb,
  migration_state text not null default 'pending'
    check (migration_state in ('pending', 'ready', 'manual_review', 'failed')),
  migration_error text,
  legacy_revision_id uuid unique references public.counter_proposal_revisions (id) on delete set null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (submission_id, revision_number),
  foreign key (release_id, base_revision)
    references public.map_data_releases (release_id, geometry_revision) on delete restrict,
  check (primary_dguid < secondary_dguid),
  check ((migration_state in ('manual_review', 'failed')) = (migration_error is not null))
);

create index if not exists submission_geometry_revisions_submission_idx
  on public.submission_geometry_revisions (submission_id, revision_number desc);
create index if not exists submission_geometry_revisions_pair_idx
  on public.submission_geometry_revisions (release_id, primary_dguid, secondary_dguid);
create index if not exists submission_geometry_revisions_migration_idx
  on public.submission_geometry_revisions (migration_state, created_at);

create table if not exists public.submission_geometry_operations (
  revision_id uuid not null references public.submission_geometry_revisions (id) on delete cascade,
  operation_index integer not null check (operation_index >= 0),
  vertex_id text not null check (length(trim(vertex_id)) > 0),
  operation_type text not null default 'set_vertex' check (operation_type = 'set_vertex'),
  base_lng double precision not null check (base_lng between -180 and 180),
  base_lat double precision not null check (base_lat between -90 and 90),
  to_lng double precision not null check (to_lng between -180 and 180),
  to_lat double precision not null check (to_lat between -90 and 90),
  primary key (revision_id, vertex_id),
  unique (revision_id, operation_index)
);

alter table public.archive_source_revisions
  add column if not exists source_geometry_revision_id uuid
    references public.submission_geometry_revisions (id) on delete restrict;

create index if not exists archive_source_revisions_geometry_revision_idx
  on public.archive_source_revisions (source_geometry_revision_id);

alter table public.map_data_releases enable row level security;
alter table public.map_release_legacy_aliases enable row level security;
alter table public.submission_geometry_revisions enable row level security;
alter table public.submission_geometry_operations enable row level security;

revoke all on table public.map_data_releases from anon, authenticated;
revoke all on table public.map_release_legacy_aliases from anon, authenticated;
revoke all on table public.submission_geometry_revisions from anon, authenticated;
revoke all on table public.submission_geometry_operations from anon, authenticated;

create or replace function public.activate_map_data_release(
  p_release_id text,
  p_geometry_revision text,
  p_manifest_sha256 text,
  p_topology_revision text,
  p_normalization_version text,
  p_vertex_schema_version text,
  p_lod_schema_version text,
  p_metadata jsonb default '{}'::jsonb
)
returns public.map_data_releases
language plpgsql
security definer
set search_path = public
as $$
declare
  activated public.map_data_releases;
begin
  if nullif(trim(p_release_id), '') is null
    or p_manifest_sha256 !~ '^sha256:[0-9a-f]{64}$'
  then
    raise exception 'invalid map release identity' using errcode = '22023';
  end if;

  update public.map_data_releases
  set state = 'retired', retired_at = clock_timestamp()
  where state = 'active' and release_id <> p_release_id;

  insert into public.map_data_releases (
    release_id, geometry_revision, manifest_sha256, topology_revision,
    normalization_version, vertex_schema_version, lod_schema_version,
    state, metadata, activated_at, retired_at
  ) values (
    p_release_id, p_geometry_revision, p_manifest_sha256, p_topology_revision,
    p_normalization_version, p_vertex_schema_version, p_lod_schema_version,
    'active', coalesce(p_metadata, '{}'::jsonb), clock_timestamp(), null
  )
  on conflict (release_id) do nothing;

  select * into activated
  from public.map_data_releases
  where release_id = p_release_id
  for update;

  if activated.geometry_revision <> p_geometry_revision
    or activated.manifest_sha256 <> p_manifest_sha256
    or activated.topology_revision <> p_topology_revision
    or activated.normalization_version <> p_normalization_version
    or activated.vertex_schema_version <> p_vertex_schema_version
    or activated.lod_schema_version <> p_lod_schema_version
  then
    raise exception 'release_id is immutable and already has a different identity'
      using errcode = '23505';
  end if;

  update public.map_data_releases
  set state = 'active',
      metadata = coalesce(p_metadata, '{}'::jsonb),
      activated_at = coalesce(activated_at, clock_timestamp()),
      retired_at = null
  where release_id = p_release_id
  returning * into activated;

  return activated;
end;
$$;

revoke all on function public.activate_map_data_release(text, text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.activate_map_data_release(text, text, text, text, text, text, text, jsonb)
  to service_role;
