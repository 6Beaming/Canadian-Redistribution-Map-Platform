-- Demo 3 Workspace and Archive Tree persistence.
-- Apply with `supabase db push` or through the Supabase SQL editor.

create table if not exists public.archive_tree (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null unique references public.submissions(id) on delete restrict,
  submission_snapshot jsonb not null,
  merged_by uuid not null references public.profiles(id) on delete restrict,
  merged_at timestamptz not null default now(),
  closing_comment jsonb
);

create index if not exists archive_tree_merged_at_idx
  on public.archive_tree (merged_at desc);

create table if not exists public.workspace_comments (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  content text not null check (length(trim(content)) > 0),
  action text,
  is_closing boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists workspace_comments_submission_created_idx
  on public.workspace_comments (submission_id, created_at desc);

create table if not exists public.workspace_labels (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  color text not null,
  is_custom boolean not null default false,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create index if not exists workspace_labels_submission_idx
  on public.workspace_labels (submission_id);

create table if not exists public.workspace_archive_requests (
  submission_id uuid primary key references public.submissions(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete restrict,
  assignee_ids uuid[] not null default '{}',
  votes jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'submissions_workspace_status_check'
      and conrelid = 'public.submissions'::regclass
  ) then
    alter table public.submissions
      add constraint submissions_workspace_status_check
      check (status in ('pending', 'archive-request', 'accepted', 'rejected', 'archived'));
  end if;
end $$;

-- Browser access has no direct policies in this milestone. Authenticated
-- Express routes use the server-only service-role client.
alter table public.archive_tree enable row level security;
alter table public.workspace_comments enable row level security;
alter table public.workspace_labels enable row level security;
alter table public.workspace_archive_requests enable row level security;
