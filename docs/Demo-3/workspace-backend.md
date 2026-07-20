# Demo 3 Workspace and Archived Tree Backend

## 1. Scope

Workspace has two different persistence levels in the current demonstration:

1. **Archived Tree** is durable and Supabase-backed through authenticated,
   Commissioner-only Express routes and PostgreSQL RPCs.
2. **Workspace collaboration state** is represented by localStorage while the
   database tables and server CRUD API are still incomplete.

This distinction is intentional and must remain visible in future changes.
`tempWorkspace.js` does not make local storage a backend.

## 2. Authentication and Service Boundaries

`server/routes/workspace.js` starts with `requireAuth` and a
`requireCommissioner` role guard. The route handlers use
`getSupabaseAdminDataClient()` from `server/lib/supabase.js`; the browser only
receives HTTP responses and never a service-role key.

| Frontend method | HTTP dependency | Route guard | Status |
| --- | --- | --- | --- |
| `getWorkspaceReviewerEmails()` | `GET /api/workspace/reviewers` | authenticated Commissioner | durable read |
| `setWorkspaceSubmissionStatus()` | `PATCH /api/workspace/submissions/:id/status` | authenticated Commissioner | temporary route over durable submission column |
| `getArchiveTreeRecords()` | `GET /api/workspace/archive` | authenticated Commissioner | durable read |
| archive merge within `commitWorkspaceAction()` | `POST /api/workspace/archive` | authenticated Commissioner | durable RPC write |
| `revertArchiveBranch()` | `PATCH /api/workspace/archive/branch/latest` | authenticated Commissioner | durable RPC write |
| `deleteArchiveBranch()` | `DELETE /api/workspace/archive/branch` | authenticated Commissioner | durable destructive RPC write |

The relevant frontend and server methods have English source comments marking
durable calls, temporary paths, and required refactors.

## 3. Durable Archive Tree Data Flow

### 3.1 Merge

```text
Commissioner decision panel
  -> commitWorkspaceAction(action = "archive-merge")
  -> POST /api/workspace/archive
  -> merge_submission_into_archive(...)
  -> archive_tree version record + source submission status = archived
```

`merge_submission_into_archive(target_submission_id, target_merged_by,
target_closing_comment)` is a `security definer` PostgreSQL function. It locks
the submission and branch, calculates a stable branch key from the snapshot,
creates or refreshes the archive snapshot, increments `version_number`, changes
the sole `is_latest` marker, writes merge metadata, clears related Workspace
rows, and updates `submissions.status` atomically.

### 3.2 Read, revert, and delete

`GET /api/workspace/archive` returns `archive_tree` rows and resolves
`merged_by`/`reverted_by` emails through a server-side profiles query. The
client builds its presentation tree from these records.

`revert_archive_branch(target_branch_key, target_submission_id,
target_reverted_by)` locks the branch, clears its current latest flag, marks the
requested archived record latest, and writes revert audit metadata.

`delete_archive_branch(target_branch_key)` locks a branch and deletes all of
its `archive_tree` rows and their related source `submissions`. It is a
permanent delete. The frontend confirmation is helpful UX but not a recovery
mechanism.

## 4. Migrations

| Migration | Purpose |
| --- | --- |
| `20260719160000_create_workspace_tables.sql` | Creates initial `archive_tree`, `workspace_comments`, `workspace_labels`, and `workspace_archive_requests` tables; enables RLS. |
| `20260719170000_normalize_submission_status_constraint.sql` | Converts legacy `under_review` / `approved` values and replaces the old submission status CHECK. |
| `20260719180000_archive_tree_supabase_versions.sql` | Adds archive branch/version/latest/revert fields, indexes, backfill, and the merge/revert/delete RPCs. |

Apply them in the listed order. The third migration must be applied before
archive actions can succeed; the Express route reports a 503 with the migration
path when Supabase reports a missing RPC.

## 5. Workspace Tables Not Yet Connected

The first migration creates durable tables, but the frontend currently does not
read or write them:

| Table | Intended use | Current frontend implementation | Required API work |
| --- | --- | --- | --- |
| `workspace_comments` | Commissioner comments and closing messages | `localStorage.comments` | list/create/update/delete endpoints; author from session; close-message semantics |
| `workspace_labels` | selected labels | `localStorage.labels` | list/upsert/delete endpoints and a shared catalog design |
| `workspace_archive_requests` | requester, assignees, votes | `localStorage.archiveRequests` | create/cancel, assignee update, vote endpoint, state-machine validation |

The migration enables RLS but supplies no direct browser policies. This is
appropriate only while the server-side API has not been built. Do not expose the
tables to the browser with permissive policies as a shortcut.

### Recommended replacement sequence

1. Add authenticated Commissioner routes under `/api/workspace` for each table.
2. Derive `author_id`, `requester_id`, and vote identity from `req.user.id`.
3. Store assignees as profile IDs, not only email strings; use email only as a
   display projection.
4. Make archive-request transitions transactional and enforce who may accept,
   reject, cancel, or merge.
5. Replace `readWorkspaceState`, `writeWorkspaceState`, and local override
   merges in `tempWorkspace.js` with query/mutation repositories.
6. Add Realtime subscriptions or controlled invalidation after server writes.

## 6. Submission Types and Geometry Dependencies

### Comments and objections

The protected Commissioner list currently comes from `GET /api/comments`.
`server/app.js` registers authentication for the comments router, and
`comments.js` separates Public-only self-service operations from the
Commissioner-only list. Payload and geometry validation are still pending as
described in [map-backend.md](./map-backend.md). Objections store DGUID pair
identifiers, but their historical GeoJSON is not reliably written by the
generic `POST /api/comments` route. A dedicated objection API must persist a
server-validated pair geometry snapshot and source revision/hash. The intended
validation authority is the versioned local map profile index plus canonical
metadata, not a duplicated national `dissemination_areas` catalog. Until the
legacy primary-DA foreign key and its PostgREST joins are replaced, however,
the 74-row Yukon reference table rejects submissions for the other selectable
map DGUIDs before they can enter Workspace.

### Counter-Proposals

`src/services/tempCounterProposal.js` imports `src/data/map/temp.json` and
hydrates it in the browser. There is no Counter-Proposal table, write route,
immutable geometry snapshot, or durable revision sequence. The fixture is
explicitly refused by `persistArchiveMerge()` so that Archive Tree cannot claim
to archive an unpersisted submission.

Required production contract:

1. Counter-Proposal submission/revision storage with author, DA pair, original
   geometry reference, proposed GeoJSON, shared boundary, title/comment, status,
   baseline revision, and timestamps.
2. Server-side adjacency and topology validation equivalent to the current JSTS
   browser guard.
3. Authorized create/read/update/submit endpoints and a pagination/list API.
4. Immutable submission snapshots used by Workspace and Archive Tree.
5. A heatmap aggregate that counts persisted active submissions only.

## 7. Realtime and Audit Gaps

No Supabase Realtime subscription, server-sent event, or WebSocket is currently
configured. Workspace local storage sends same-window custom events and browser
storage events; neither synchronizes separate users. Archived Tree refreshes by
fetching its API after a successful action.

For multi-user operation, add table-change subscriptions or server events after
the Workspace tables and Counter-Proposals are durable. Also replace permanent
archive deletion with a soft-delete/tombstone policy and retain an audit trail.

## 8. Operational Security Notes

- Do not place a Supabase `secret`/service-role key in `VITE_*` variables.
- Keep `.env` Git-ignored and obtain it through the project-approved channel.
- Use the server-only service-role client only after authentication and role
  checks; it bypasses normal RLS protections.
- Comments routes now derive `user_id` from the authenticated session; do not
  reintroduce client-supplied author identity in future endpoints.
