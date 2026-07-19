# Demo 3 Database Schema

## 1. Status and Authority

This document is the Demo 3 database contract. It supersedes the older Demo 2
report as the implementation reference for submissions, Workspace, and Archived
Tree. It describes the current Supabase structure used by the application,
committed migrations, and the fields still required for a complete production
workflow.

The schema is split between:

- Supabase authentication tables managed by Supabase;
- existing application tables used by map/submission features; and
- Workspace/Archive tables introduced by the Demo 3 migrations.

Map PMTiles and canonical DA GeoJSON remain repository assets, not database
geometry tables. They are served by `/api/map`.

## 2. Entity Relationship Overview

```text
auth.users
  └─ profiles
       ├─ submissions
       │    ├─ workspace_comments
       │    ├─ workspace_labels
       │    ├─ workspace_archive_requests
       │    └─ archive_tree (versioned snapshot)
       └─ archive_tree.merged_by / reverted_by

dissemination_areas
  └─ submissions.dguid

map_proposals
  └─ submissions.proposal_id
```

`submissions` is currently the central record for feedback and objections.
Future Counter-Proposals may either use a strongly typed extension of this table
or a revision table linked to it; that decision is listed in Section 8.

## 3. Identity and Reference Tables

### 3.1 `auth.users` (Supabase managed)

Supabase owns credentials, sessions, and the canonical authenticated user ID.
Application routes must derive identity from a verified session and must not
trust a client-provided user ID.

### 3.2 `profiles`

One application profile per authenticated user. Existing route code uses at
least:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | UUID, primary key / auth user reference | joins submissions and Workspace actions to an identity |
| `email` | TEXT | Commissioner table and reviewer display projection |
| `role` | TEXT | Commissioner authorization guard |
| profile fields | project-defined | registration and display data |

**Required constraints/fields to confirm or add:** a unique email where
appropriate, a constrained role enum/check, and updated timestamps. The
application must not query profile emails from an anonymous browser client.

### 3.3 `dissemination_areas`

Existing reference table used to show the community name associated with
`submissions.dguid`.

| Column | Type | Purpose |
| --- | --- | --- |
| `dguid` | TEXT primary key | DA identifier shared with map assets and submissions |
| `community_name` | TEXT | display value in tables and Archive Tree |
| other census attributes | existing project fields | population, FED and related metadata |

The canonical polygon itself remains in the map metadata/PMTiles asset pipeline
for this milestone.

### 3.4 `map_proposals`, `da_assignments`, and `da_adjacency`

These existing tables support the longer-term proposal/assignment model:

- `map_proposals` represents proposal-level map metadata;
- `da_assignments` maps DAs to a proposal/district;
- `da_adjacency` can persist precomputed DA adjacency.

They are not the source of current Workspace geometry. At the last project
audit they had no active workflow rows. Do not make the current Counter-Proposal
fixture depend on them until a durable proposal revision design is selected.

## 4. `submissions`

One row per live citizen submission. Existing application code uses the
following contract:

| Column | Type | Required now | Purpose |
| --- | --- | --- | --- |
| `id` | UUID primary key | yes | Reference ID and archive source key |
| `user_id` | UUID FK to profile/user | yes for authenticated submission | author identity |
| `type` | TEXT with type CHECK | yes | `feedback`, `objection`, or future `counter_proposal` |
| `proposal_id` | UUID nullable FK | optional | proposal-level association |
| `fed_num` | TEXT nullable | optional | FED context |
| `dguid` | TEXT nullable FK | yes for DA-targeted work | primary DA |
| `neighboring_dguid` | TEXT nullable FK/reference | required for boundary pair work | second DA in an objection/counter pair |
| `title` | TEXT | yes | list and review heading |
| `comment` | TEXT | yes | submission content |
| `geometry` | JSONB nullable | present but not consistently populated | immutable map snapshot target |
| `status` | TEXT | yes | current workflow state |
| `created_at` | TIMESTAMPTZ | yes | ordering/audit |
| `updated_at` | TIMESTAMPTZ | yes | status/update ordering |

### 4.1 Type contract

The existing CHECK retains `feedback`, `counter_proposal`, and `objection`.
Frontend code normalizes `counter_proposal` to `counter-proposal` for display.
Avoid changing this spelling casually because the database and frontend have an
explicit compatibility normalizer.

### 4.2 Status contract

Migration `20260719170000_normalize_submission_status_constraint.sql` replaces
the legacy status CHECK. The supported values are:

```text
pending | accepted | rejected | archive-request | archived
```

The migration translates legacy `under_review` to `pending` and `approved` to
`accepted` before replacing the constraint.

### 4.3 Missing submission constraints

The generic table is intentionally permissive today. Add the following in a
future migration after data cleanup:

- require a non-empty `title` and `comment` within practical length limits;
- require `dguid` for feedback attached to a DA;
- require both `dguid` and `neighboring_dguid`, and reject equal DGUIDs, for
  objections and Counter-Proposals;
- require a non-null valid geometry snapshot and baseline revision/hash for
  objections when the dedicated write endpoint is deployed;
- add submission author/status/created time indexes for dashboard queries;
- define whether archived source submissions remain mutable or must be locked.

## 5. Workspace Tables

Migration `20260719160000_create_workspace_tables.sql` creates the following
tables and enables RLS on them. The current browser interface still uses local
storage for these records, so no browser RLS policy has been added yet.

### 5.1 `workspace_comments`

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | UUID primary key | comment record ID |
| `submission_id` | UUID FK to `submissions`, cascade delete | reviewed submission |
| `author_id` | UUID FK to `profiles`, restrict delete | Commissioner author |
| `content` | TEXT, non-empty check | comment body |
| `action` | TEXT nullable | decision/action context |
| `is_closing` | BOOLEAN, default false | latest closing-message semantics |
| `created_at` | TIMESTAMPTZ | ordering |

Existing index: `(submission_id, created_at desc)`.

**Still required:** authenticated CRUD routes, a policy for editing/deleting,
an optional `updated_at`, and a database rule that clarifies whether only one
closing comment may be active per author/submission.

### 5.2 `workspace_labels`

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | UUID primary key | label assignment ID |
| `submission_id` | UUID FK to `submissions`, cascade delete | target submission |
| `name` | TEXT, non-empty check | label text |
| `color` | TEXT | display colour |
| `is_custom` | BOOLEAN, default false | distinguishes custom labels |
| `updated_by` | UUID FK to `profiles`, restrict delete | last editor |
| `updated_at` | TIMESTAMPTZ | update audit |

Existing index: `(submission_id)`.

**Still required:** either a separate `workspace_label_catalog` table for
reusable labels or a documented per-submission-only model; unique constraints
for duplicate normalized labels; colour format validation; and CRUD routes.

### 5.3 `workspace_archive_requests`

| Column | Type | Purpose |
| --- | --- | --- |
| `submission_id` | UUID primary key, FK to `submissions`, cascade delete | one request per submission |
| `requester_id` | UUID FK to `profiles`, restrict delete | initiating Commissioner |
| `assignee_ids` | UUID array, default `{}` | invited reviewer identities |
| `votes` | JSONB, default `{}` | current vote map |
| `created_at` | TIMESTAMPTZ | request audit |
| `updated_at` | TIMESTAMPTZ | latest request update |

**Still required:** replace email-keyed local UI state with profile-ID records;
validate vote shape and assignee uniqueness; enforce requester/assignee action
permissions; add a lifecycle/status field or an event table; and expose safe
CRUD/command endpoints.

## 6. `archive_tree`

`archive_tree` stores durable submission snapshots. It is not a local cache.

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | UUID primary key | archive record ID |
| `submission_id` | UUID unique FK to `submissions`, restrict delete | archived source submission/version |
| `submission_snapshot` | JSONB, non-null | immutable-at-merge submission payload |
| `merged_by` | UUID FK to `profiles`, restrict delete | Commissioner who merged |
| `merged_at` | TIMESTAMPTZ | merge time |
| `closing_comment` | JSONB nullable | merge decision payload |
| `branch_key` | TEXT, non-null | stable logical branch key |
| `version_number` | INTEGER, non-null | sequence within branch |
| `is_latest` | BOOLEAN, default false | selected branch version |
| `reverted_at` | TIMESTAMPTZ nullable | latest-selection audit time |
| `reverted_by` | UUID nullable FK to `profiles` | Commissioner who reverted |

Indexes and constraints introduced by the version migration:

- index on `merged_at desc`;
- index on `(branch_key, version_number)`;
- partial unique index: one `is_latest = true` row per branch.

### 6.1 Archive RPC contract

The schema installs and restricts these PostgreSQL functions to `service_role`:

| Function | Purpose |
| --- | --- |
| `archive_branch_key(snapshot, fallback_submission_id)` | derives the branch key from submission type and one/two DGUIDs |
| `merge_submission_into_archive(...)` | atomic snapshot/version/latest/status transition |
| `revert_archive_branch(...)` | atomically selects a prior version as latest |
| `delete_archive_branch(...)` | permanently deletes all records in a branch and linked source submissions |

`security definer` requires careful server-side authorization. Browser clients
must call the protected Express API, never the functions directly.

### 6.2 Archive schema gaps

- A snapshot is only historically correct if `submissions.geometry` contains a
  persisted immutable geometry at merge time. Current objection writes do not
  reliably provide it, and Counter-Proposals are not persisted.
- `submission_id` is unique, so the current version chain represents distinct
  submission rows grouped by a logical branch. Decide whether future edits need
  an explicit `submission_revisions` table instead.
- Delete is permanent; add `deleted_at`, `deleted_by`, `delete_reason`, or a
  separate audit/event table if recovery is required.
- Consider immutable snapshot hashes and baseline asset revision identifiers.

## 7. Recommended Counter-Proposal Schema

The current `temp.json` fixture must become a durable proposal model. A minimal
extension can use `submissions` plus a new `counter_proposal_revisions` table:

| Column | Type | Purpose |
| --- | --- | --- |
| `id` | UUID primary key | revision ID |
| `submission_id` | UUID FK to `submissions` | parent submission |
| `revision_number` | INTEGER | ordered edits within a proposal |
| `primary_dguid` / `secondary_dguid` | TEXT | selected adjacent DA pair |
| `original_geometry` | JSONB | exact baseline pair at edit start |
| `proposed_geometry` | JSONB | server-approved edited pair |
| `shared_boundary` | JSONB | editable boundary FeatureCollection/line |
| `outer_boundary` | JSONB | stable pair exterior for display/validation |
| `baseline_revision` | TEXT | map asset version/hash |
| `validation_report` | JSONB | server validation outcome/tolerances |
| `created_by` | UUID FK to profile | author |
| `created_at` | TIMESTAMPTZ | audit |

Add a unique `(submission_id, revision_number)` constraint and indexes on the
DA pair. The server should create these rows only after topology validation.

## 8. Missing Backend Capabilities

1. Authenticated and authorized CRUD for Workspace comments, labels, and archive
   requests.
2. A dedicated objection submission endpoint that writes a verified immutable
   geometry snapshot and baseline revision.
3. Persistent Counter-Proposal submission and revision APIs.
4. A compact Commissioner heatmap aggregation endpoint.
5. Supabase Realtime/server events for concurrent Workspace and Archive views.
6. Soft-delete and complete audit policy for Archive Tree.
7. Formal RLS policies once the browser/server access model is finalized.

## 9. Migration Order and Deployment Check

Apply the Demo 3 migrations in this order:

```text
20260719160000_create_workspace_tables.sql
20260719170000_normalize_submission_status_constraint.sql
20260719180000_archive_tree_supabase_versions.sql
```

After deployment, verify:

1. `submissions_status_check` allows the five Workspace status values;
2. `archive_tree` contains branch/version/latest/revert columns and indexes;
3. all three Archive RPCs exist and are executable only by `service_role`; and
4. protected `/api/workspace` calls succeed for a Commissioner session and fail
   for an unauthorized user.
