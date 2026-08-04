-- Map PostgreSQL trigger operation names to the frozen realtime contract.
-- PostgreSQL calls row creation INSERT; the realtime envelope calls it create.

create or replace function public.checkpoint0_workspace_comment_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.workspace_comments%rowtype;
  event_operation text;
begin
  if tg_op = 'DELETE' then
    event_row := old;
  else
    event_row := new;
  end if;

  event_operation := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    when 'DELETE' then 'delete'
    else lower(tg_op)
  end;

  perform public.checkpoint0_enqueue_realtime_event(
    'workspace.comment',
    event_row.submission_id::text,
    event_row.id::text,
    event_operation,
    public.checkpoint0_realtime_timestamp_version(),
    event_row.submission_id,
    event_row.author_id
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.checkpoint0_workspace_label_realtime()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_row public.workspace_labels%rowtype;
  event_entity text;
  event_operation text;
begin
  if current_setting('crmp.checkpoint0_label_batch', true) = 'on' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    event_row := old;
  else
    event_row := new;
  end if;
  event_entity := case
    when event_row.is_custom then 'workspace.custom-label'
    else 'workspace.label'
  end;
  event_operation := case tg_op
    when 'INSERT' then 'create'
    when 'UPDATE' then 'update'
    when 'DELETE' then 'delete'
    else lower(tg_op)
  end;

  perform public.checkpoint0_enqueue_realtime_event(
    event_entity,
    event_row.submission_id::text,
    case
      when event_row.is_custom then event_row.id::text
      else event_row.submission_id::text
    end,
    event_operation,
    public.checkpoint0_realtime_timestamp_version(),
    event_row.submission_id,
    event_row.updated_by
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
