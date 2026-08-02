-- CP5 reliable Workspace comments/labels/catalog persistence.

create table if not exists public.workspace_label_catalog (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  color text not null check (length(trim(color)) > 0),
  is_custom boolean not null default false,
  created_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_label_catalog add column if not exists is_custom boolean not null default false;
alter table public.workspace_label_catalog add column if not exists created_by uuid references public.profiles(id) on delete restrict;
alter table public.workspace_label_catalog add column if not exists created_at timestamptz not null default now();
alter table public.workspace_label_catalog add column if not exists updated_at timestamptz not null default now();
alter table public.workspace_label_catalog enable row level security;

alter table public.workspace_labels
  add column if not exists catalog_id uuid references public.workspace_label_catalog(id) on delete restrict;

-- Link assignments before renaming legacy seed rows, otherwise an assignment
-- named "Custom Cyan" can no longer match its catalog row.
update public.workspace_labels assignment
set catalog_id = catalog.id
from public.workspace_label_catalog catalog
where assignment.catalog_id is null
  and lower(trim(assignment.name)) = lower(trim(catalog.name))
  and assignment.color = catalog.color;

-- Exact legacy default text identifies an untouched seed slot. Any saved
-- Commissioner text differs and is therefore preserved.
update public.workspace_label_catalog set name = 'Custom Label 1', updated_at = now()
where is_custom and name = 'Custom Cyan';
update public.workspace_label_catalog set name = 'Custom Label 2', updated_at = now()
where is_custom and name = 'Custom Pink';
update public.workspace_label_catalog set name = 'Custom Label 3', updated_at = now()
where is_custom and name = 'Custom Purple';

insert into public.workspace_label_catalog (id, name, color, is_custom)
select '00000000-0000-4000-8000-000000000101', 'Custom Label 1', '#26a69a', true
where not exists (select 1 from public.workspace_label_catalog where is_custom and name = 'Custom Label 1');
insert into public.workspace_label_catalog (id, name, color, is_custom)
select '00000000-0000-4000-8000-000000000102', 'Custom Label 2', '#ec407a', true
where not exists (select 1 from public.workspace_label_catalog where is_custom and name = 'Custom Label 2');
insert into public.workspace_label_catalog (id, name, color, is_custom)
select '00000000-0000-4000-8000-000000000103', 'Custom Label 3', '#ab47bc', true
where not exists (select 1 from public.workspace_label_catalog where is_custom and name = 'Custom Label 3');

-- A deployment without a pre-existing catalog can still have legacy label
-- assignments. Map the three known legacy names to the canonical seed slots.
update public.workspace_labels assignment
set catalog_id = catalog.id
from public.workspace_label_catalog catalog
where assignment.catalog_id is null
  and assignment.color = catalog.color
  and (
    lower(trim(assignment.name)) = lower(trim(catalog.name))
    or (assignment.name = 'Custom Cyan' and catalog.name = 'Custom Label 1')
    or (assignment.name = 'Custom Pink' and catalog.name = 'Custom Label 2')
    or (assignment.name = 'Custom Purple' and catalog.name = 'Custom Label 3')
  );

-- Preserve the newest assignment when the pre-migration browser bug created
-- duplicate rows. This must run before the unique index is added.
with ranked_assignments as (
  select id, row_number() over (
    partition by submission_id, catalog_id
    order by updated_at desc, id desc
  ) as duplicate_rank
  from public.workspace_labels
  where catalog_id is not null
)
delete from public.workspace_labels assignment
using ranked_assignments ranked
where assignment.id = ranked.id
  and ranked.duplicate_rank > 1;

-- Keep denormalized assignment presentation in sync with the authoritative
-- catalog so a hard refresh cannot resurrect old default text or colors.
update public.workspace_labels assignment
set name = catalog.name,
    color = catalog.color,
    is_custom = catalog.is_custom
from public.workspace_label_catalog catalog
where assignment.catalog_id = catalog.id;

create unique index if not exists workspace_labels_submission_catalog_unique
  on public.workspace_labels (submission_id, catalog_id)
  where catalog_id is not null;

create or replace function public.sync_workspace_label_catalog_assignments()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.workspace_labels
  set name = new.name,
      color = new.color,
      is_custom = new.is_custom,
      updated_at = new.updated_at
  where catalog_id = new.id;
  return new;
end;
$$;

drop trigger if exists workspace_label_catalog_assignment_sync
  on public.workspace_label_catalog;
create trigger workspace_label_catalog_assignment_sync
after update of name, color, is_custom on public.workspace_label_catalog
for each row execute function public.sync_workspace_label_catalog_assignments();

create or replace function public.set_workspace_labels(
  target_submission_id uuid,
  target_updated_by uuid,
  target_labels jsonb
)
returns setof public.workspace_labels
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.submissions where id = target_submission_id) then
    raise exception 'Submission not found' using errcode = 'P0002';
  end if;

  if jsonb_typeof(coalesce(target_labels, '[]'::jsonb)) <> 'array' then
    raise exception 'target_labels must be an array' using errcode = '22023';
  end if;

  delete from public.workspace_labels existing
  where existing.submission_id = target_submission_id
    and not exists (
      select 1 from jsonb_to_recordset(coalesce(target_labels, '[]'::jsonb))
        as requested("catalogId" uuid, name text, color text, custom boolean)
      where requested."catalogId" = existing.catalog_id
    );

  insert into public.workspace_labels (
    submission_id, catalog_id, name, color, is_custom, updated_by, updated_at
  )
  select target_submission_id, requested."catalogId", catalog.name, catalog.color,
    catalog.is_custom, target_updated_by, now()
  from jsonb_to_recordset(coalesce(target_labels, '[]'::jsonb))
    as requested("catalogId" uuid, name text, color text, custom boolean)
  join public.workspace_label_catalog catalog on catalog.id = requested."catalogId"
  on conflict (submission_id, catalog_id) where catalog_id is not null
  do update set
    name = excluded.name,
    color = excluded.color,
    is_custom = excluded.is_custom,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  return query
  select * from public.workspace_labels
  where submission_id = target_submission_id
  order by updated_at, id;
end;
$$;

revoke all on function public.set_workspace_labels(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_workspace_labels(uuid, uuid, jsonb) to service_role;
revoke all on function public.sync_workspace_label_catalog_assignments() from public, anon, authenticated;
