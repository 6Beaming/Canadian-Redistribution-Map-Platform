# Demo 3 Map and Submission Backend

## 1. Scope and Contract

This document describes the backend dependencies of map rendering and
submissions. It distinguishes repository-owned map assets, existing Supabase
submission records, the durable Archived Tree API, and temporary frontend
adapters that must be replaced before production use.

The actual source of truth for this milestone is the Supabase project configured
through the Git-ignored root `.env` and the committed migrations under
`supabase/migrations/`. The older Demo 2 schema report is not an implementation
plan for this work.

## 2. Current Server Composition

| Route prefix | Module | Current responsibility |
| --- | --- | --- |
| `/api/map` | `server/map-api-service/` | Repository-backed map assets, DA profiles, metadata shards, PMTiles byte ranges, and a development-only assignments store. |
| `/api/comments` | `server/routes/comments.js` | Existing Supabase feedback/objection read and legacy write paths. |
| `/api/workspace` | `server/routes/workspace.js` | Commissioner-only reviewer lookup, temporary status updates, and durable Archived Tree operations. |
| `/api/auth` | `server/routes/auth.js` | Session, profile, invitation, and authentication endpoints. |

`server/lib/supabase.js` exposes the normal Supabase client and a server-only
service-role data client. The service-role key must never be sent to the browser.

## 3. Map Asset Data Flow

The map asset API is intentionally not a geographic database API. It reads
versioned files under `src/data/map/` and exposes only expected paths.

| Endpoint | Used by | Data source | Mutation status |
| --- | --- | --- | --- |
| `GET /api/map/da-profiles` | Map InfoPanel, Workspace hydration, archive labels | compact DA profile index | read-only |
| `GET /api/map/assets/manifests/da_asset_manifest.json` | MapCanvas | asset manifest | read-only |
| `GET /api/map/assets/render/*.pmtiles` | MapLibre PMTiles protocol | render bundle | read-only, byte-range enabled |
| `GET /api/map/assets/metadata/*.geojson` | objection/counter workflows | canonical FED shards | read-only |
| `GET/PUT /api/map/assignments` | development utility only | `server/map-api-service/store/assignments.json` | not a submission or proposal store |

The browser never changes PMTiles or canonical GeoJSON. Focused workflow
geometry is an overlay generated from the canonical source.

## 4. Existing Submissions API

### 4.1 Current live read path

`src/services/commentsApi.js#getAllComments()` requests `GET /api/comments`
with credential cookies. `server/routes/comments.js` protects this specific
route with `requireAuth` and `requireCommissioner`, queries Supabase
`submissions`, and joins only author `{ id, email }` data using
`getSupabaseProfileEmailsAsAdmin()`.

`src/services/tempWorkspace.js#loadLiveSubmissions()` calls this route and
normalizes the records for Workspace, the Commissioner submissions table,
Dashboard submission cards, and the current heatmap. Comments and objections
therefore share one list retrieval path.

### 4.2 Current public-route safeguard and remaining refactor work

`server/app.js` now registers `requireAuth` for the entire `/api/comments`
router. `server/routes/comments.js` applies `requirePublicUser` to public
operations and `requireCommissioner` to the Commissioner-wide list. The same
role boundary is registered in `App.jsx`: a signed-in Commissioner who manually
opens a public route is redirected to `/dashboard`.

The following methods remain part of the current demo flow, but still require
payload/domain refactoring:

| Method | Current behaviour | Required refactor |
| --- | --- | --- |
| `GET /proposal/:proposalId` | Authenticated Public-only proposal feedback read. | Add proposal-level access policy and limit output fields. |
| `GET /:user_id` | Authenticated Public-only self read; verifies `req.params.user_id === req.user.id`. | Consider a separate Commissioner detail endpoint instead of widening this route. |
| `POST /` | Authenticated Public-only insert; derives `user_id` from `req.user.id`. | Validate fields and type, then split objection writes into a dedicated geometry endpoint. |
| `DELETE /:commentId` | Authenticated Public-only delete scoped by `id`, `user_id`, and feedback type. | Add soft-delete/audit policy where needed. |

The new dual-sided guard prevents role fall-through and user-ID spoofing on this
router. Payload validation and durable objection geometry remain the next
priority.

### 4.3 Objection geometry

The live `submissions` table contains `neighboring_dguid` and `geometry JSONB`.
Current live objection records identify both DAs, but the generic write path does
not write an immutable geometry snapshot. The Workspace hydrator can reconstruct
an exact current pair from canonical map metadata, but that is not historical
evidence if the baseline data changes.

The recommended replacement is `POST /api/submissions/objections`:

1. authenticate the requester and derive the author from the session;
2. validate both DGUIDs and their FED scope;
3. load canonical metadata server-side and verify adjacency;
4. derive the shared edge and selected-pair FeatureCollection server-side;
5. insert the pair, text payload, geometry snapshot, and a source
   version/hash in a transaction; and
6. return a minimal normalized submission response.

The browser may send intended DGUIDs and text, but it must not be the authority
for a persisted geometry result. A later CHECK/trigger should require
`neighboring_dguid` and non-null `geometry` for objection rows.

## 5. Commissioner Workspace and Archive API

All routes in `server/routes/workspace.js` run behind `requireAuth` and the
local `requireCommissioner` guard.

| Route | Source method | Current persistence | Notes |
| --- | --- | --- | --- |
| `GET /api/workspace/reviewers` | reviewer lookup route | `profiles` | Returns only Commissioner email addresses for assignment UI. |
| `GET /api/workspace/archive` | archive read route | `archive_tree` + `profiles` | Resolves `merged_by`/`reverted_by` email server-side. |
| `PATCH /api/workspace/submissions/:submissionId/status` | temporary status route | `submissions.status` | Works for live Supabase submissions; should move to a dedicated submissions domain service. |
| `POST /api/workspace/archive` | archive merge route | `merge_submission_into_archive(...)` RPC | Durable atomic merge. |
| `PATCH /api/workspace/archive/branch/latest` | archive revert route | `revert_archive_branch(...)` RPC | Durable latest-version switch. |
| `DELETE /api/workspace/archive/branch` | archive delete route | `delete_archive_branch(...)` RPC | Durable destructive branch deletion. |

The route source contains maintenance comments before the durable archive read,
revert, and delete handlers. `archiveRpcError()` converts missing RPC errors to
an actionable 503 migration message rather than reporting a false success.

### 5.1 Durable Archived Tree flow

```text
Workspace Review
  -> tempWorkspace.commitWorkspaceAction(..., "archive-merge")
  -> POST /api/workspace/archive
  -> merge_submission_into_archive(submission id, commissioner id, closing comment)
  -> archive_tree snapshot/version/latest state + submissions.status = archived

Archived Tree / Archived Map
  -> tempWorkspace.getArchiveTreeRecords()
  -> GET /api/workspace/archive
  -> archive_tree records with resolved commissioner emails
```

The merge RPC locks the source submission and the calculated branch key,
creates or updates a snapshot, increments `version_number`, removes the prior
`is_latest`, marks the new version latest, clears corresponding Workspace table
rows, and updates the source submission status in one PostgreSQL transaction.

Revert changes the one persisted latest version. Delete permanently removes all
archive versions in a branch and their corresponding source submissions. This
is appropriate only for the demonstration policy; production should introduce a
soft-delete/audit restoration model.

## 6. Frontend Service Boundaries

`src/services/tempWorkspace.js` is a documented transitional façade, not the
target production architecture.

| Export or helper | Current source | Target replacement |
| --- | --- | --- |
| `getWorkspaceSubmissions()` | protected live list + temporary Counter-Proposal fixture | submission repository querying all persisted types |
| `getCommissionerSubmissionRows()` | same hybrid list | paginated Commissioner submissions API |
| `getWorkspaceSubmission()` | hybrid list then browser hydration | detail API returning immutable review geometry |
| `getWorkspaceReviewerEmails()` | `GET /api/workspace/reviewers` | retain, possibly expose reviewer IDs and roles |
| `setWorkspaceSubmissionStatus()` | temporary status API + local mirror | dedicated authorized submission transition API |
| `commitWorkspaceAction()` | durable archive only; other review work local | transactional Workspace command API |
| `getSubmissionHeatmap()` | hybrid browser aggregate | compact authenticated DGUID-count API |
| `getArchiveTreeRecords()` / `revertArchiveBranch()` / `deleteArchiveBranch()` | commissioner `/api/workspace` routes | durable path already in place |

`src/services/tempCounterProposal.js` has equivalent source comments. Its
`getTemporaryCounterProposalSubmissions()`,
`getTemporaryCounterProposalById()`, and `getDashboardSubmissionCollections()`
read `src/data/map/temp.json`; `hydrateWorkspaceSubmission()` replays geometry
in the browser. They must be replaced by a Counter-Proposal repository and
server-approved immutable geometry revisions.

## 7. Heatmap and Archived Map Backend Dependencies

The optional heatmap module calls `getSubmissionHeatmap()` and currently counts
only `pending` and `archive-request` hybrid records by their one or two DGUIDs.
The map layer is already decoupled from the loader. Add a route such as
`GET /api/submissions/heatmap?status=pending,archive-request` that returns:

```json
{ "countsByDguid": { "2021S051260010118": 3 } }
```

The route should aggregate server-side, enforce Commissioner access, filter
out archived/deleted data, and avoid sending full submission content to the
map.

The Archived Map already uses the durable `GET /api/workspace/archive` path.
It can outline archived DGUIDs today. Exact Counter-Proposal overlay playback
will become reliable only after archival snapshots contain persisted proposed
geometry rather than temporary fixture operations.

## 8. Required Refactor Sequence

1. Apply the committed migrations and verify the status constraint and Archive
   RPCs in the target Supabase project.
2. Add exhaustive payload validation and proposal-level authorization to the
   newly authenticated comments routes.
3. Add dedicated objection and Counter-Proposal write/read APIs with server
   geometry validation, immutable GeoJSON snapshots, and map source revisions.
4. Implement CRUD endpoints for `workspace_comments`, `workspace_labels`, and
   `workspace_archive_requests`; replace all localStorage writes in
   `tempWorkspace`.
5. Split `tempWorkspace` into submission, workspace, archive, and map-aggregate
   repositories; add query caching and error handling at the UI layer.
6. Add Supabase Realtime, server events, or controlled polling so multiple
   Commissioners observe review and archive changes.
7. Replace destructive archive deletion with an auditable recovery policy.

## 9. Operational Notes

- Apply `20260719160000_create_workspace_tables.sql`, then
  `20260719170000_normalize_submission_status_constraint.sql`, then
  `20260719180000_archive_tree_supabase_versions.sql` through an approved
  Supabase migration workflow or SQL Editor.
- Do not commit `.env`, the service-role key, database passwords, or management
  tokens. The root `.env` is Git-ignored and distributed separately.
- `GET /api/map/assignments` is a development utility and must not be used as a
  substitute for Counter-Proposal persistence.

For full Workspace implementation details, see [workspace.md](./workspace.md)
and [workspace-backend.md](./workspace-backend.md).
