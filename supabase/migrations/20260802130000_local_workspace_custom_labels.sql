-- Make Workspace custom labels submission-local and retire the global catalog
-- from the runtime path. The old workspace_label_catalog table is retained for
-- recoverability, but no API reads or writes it after this migration.

alter table public.workspace_labels
  add column if not exists label_key text,
  add column if not exists is_selected boolean not null default true;

update public.workspace_labels
set label_key = case lower(trim(name))
  when 'discussion required' then 'discussion-required'
  when 'constructive' then 'constructive'
  when 'worth to achieve' then 'worth-to-achieve'
  when 'negligible' then 'negligible'
  when 'over aggressive' then 'over-aggressive'
  else label_key
end
where not is_custom and label_key is null;

-- Keep the newest copy if the legacy catalog allowed the same fixed label to
-- be assigned more than once to one submission.
with ranked_fixed_labels as (
  select id, row_number() over (
    partition by submission_id, label_key
    order by updated_at desc, id desc
  ) as duplicate_rank
  from public.workspace_labels
  where not is_custom and label_key is not null
)
delete from public.workspace_labels label
using ranked_fixed_labels ranked
where label.id = ranked.id and ranked.duplicate_rank > 1;

create unique index if not exists workspace_labels_submission_key_unique
  on public.workspace_labels (submission_id, label_key)
  where not is_custom and label_key is not null;

create or replace function public.set_submission_workspace_labels(
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

  -- A custom ID may only select a row already owned by this submission. This
  -- prevents a client from assigning another Workspace's custom label.
  if exists (
    select 1
    from jsonb_to_recordset(coalesce(target_labels, '[]'::jsonb))
      as requested(id text, key text, name text, color text, custom boolean)
    where requested.custom
      and not exists (
        select 1 from public.workspace_labels local_label
        where local_label.id::text = requested.id
          and local_label.submission_id = target_submission_id
          and local_label.is_custom
      )
  ) then
    raise exception 'Custom label does not belong to this submission' using errcode = '22023';
  end if;

  -- Fixed candidates live in application code; only selected fixed labels have
  -- rows. Custom rows remain as local definitions and toggle is_selected.
  delete from public.workspace_labels existing
  where existing.submission_id = target_submission_id
    and not existing.is_custom
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(target_labels, '[]'::jsonb))
        as requested(id text, key text, name text, color text, custom boolean)
      where not requested.custom and requested.key = existing.label_key
    );

  update public.workspace_labels existing
  set is_selected = false,
      updated_by = target_updated_by,
      updated_at = now()
  where existing.submission_id = target_submission_id
    and existing.is_custom
    and existing.is_selected
    and not exists (
      select 1
      from jsonb_to_recordset(coalesce(target_labels, '[]'::jsonb))
        as requested(id text, key text, name text, color text, custom boolean)
      where requested.custom and requested.id = existing.id::text
    );

  insert into public.workspace_labels (
    submission_id, label_key, name, color, is_custom, is_selected, updated_by, updated_at
  )
  select target_submission_id, fixed.key, fixed.name, fixed.color,
    false, true, target_updated_by, now()
  from jsonb_to_recordset(coalesce(target_labels, '[]'::jsonb))
    as requested(id text, key text, name text, color text, custom boolean)
  join (values
    ('discussion-required', 'Discussion Required', '#f4b400'),
    ('constructive', 'Constructive', '#0f9d58'),
    ('worth-to-achieve', 'Worth to Achieve', '#1a73e8'),
    ('negligible', 'Negligible', '#f57c00'),
    ('over-aggressive', 'Over Aggressive', '#ea4335')
  ) as fixed(key, name, color) on fixed.key = requested.key
  where not requested.custom
  on conflict (submission_id, label_key)
    where not is_custom and label_key is not null
  do update set
    name = excluded.name,
    color = excluded.color,
    is_selected = true,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  update public.workspace_labels existing
  set is_selected = true,
      updated_by = target_updated_by,
      updated_at = now()
  from jsonb_to_recordset(coalesce(target_labels, '[]'::jsonb))
    as requested(id text, key text, name text, color text, custom boolean)
  where requested.custom
    and existing.id::text = requested.id
    and existing.submission_id = target_submission_id
    and existing.is_custom;

  return query
  select * from public.workspace_labels
  where submission_id = target_submission_id and is_selected
  order by is_custom, updated_at, id;
end;
$$;

revoke all on function public.set_submission_workspace_labels(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_submission_workspace_labels(uuid, uuid, jsonb)
  to service_role;

comment on table public.workspace_label_catalog is
  'Deprecated after 20260802130000. Retained temporarily for recoverability; runtime APIs use submission-scoped workspace_labels.';
