# Demo 4 Implementation Plan

**Status:** Planning baseline  
**Source of truth:** `local/Demo-3-Report.md`, the current `main` implementation, and the read-only Supabase audit performed on 2026-07-21.  
**Scope:** Complete the broken or transitional Demo 3 data flows, separate list/detail geometry payloads, improve map editing performance, and finish the remaining submission, Workspace, Archive, and Statistics capabilities.

This document is an implementation plan, not a claim that the work is complete. The historical Demo 3 reports remain unchanged.

## 1. Current Baseline and Definition of Done

The audited Supabase project contained 70 `submissions`, 6 `counter_proposal_revisions`, and 1 `archive_tree` record. `workspace_comments`, `workspace_labels`, and `workspace_archive_requests` existed but contained no records, which confirms that Workspace collaboration is still browser-local. The audit did not inspect PostgreSQL system catalogs, so migration history, constraints, RPC grants, and RLS policies must be verified separately by the project owner.

Demo 4 is complete only when:

1. Objections and Counter-Proposals have the same immutable snapshot contract.
2. Every list, table, Workspace tree, InfoPanel, and heatmap request returns only a small projection; GeoJSON is returned only by an authorized detail or archive endpoint.
3. Public, Commissioner, Workspace, and Archived Tree queries are independent and scoped by identity, role, and province.
4. Workspace collaboration is durable in Supabase and synchronized between Commissioners.
5. Counter-Proposal editing is local-first, smooth during dragging, and server-validated only at commit.
6. Export, archive recovery, and Statistics data have explicit authorization and versioned contracts.

## 2. Target Data Architecture

### 2.1 Submission projection versus geometry detail

All three submission types must use the following two-layer read model.

**List projection** (safe for tables, Workspace, InfoPanel, and heatmap):

```text
id
type
status
public_status
title
created_at
updated_at
author_email
primary_dguid
secondary_dguid
community_label
province_pruid
latest_revision_number
```

The projection must not contain `original_geometry`, `proposed_geometry`, `shared_boundary`, or any other large GeoJSON value.

**Detail snapshot** (one record at a time, authorized):

```text
submission
  id, type, title, comment, author, status, timestamps
  primary_dguid, secondary_dguid, fed/province scope
revision
  revision_number
  original_geometry
  proposed_geometry        # Counter-Proposal only
  shared_boundary
  outer_boundary
  baseline_revision
  validation_report
  created_by, created_at
```

### 2.2 Objection schema

Add an `objection_revisions` table, or an equivalent strongly constrained snapshot extension, containing:

```text
id uuid primary key
submission_id uuid unique/foreign key
primary_dguid text
secondary_dguid text
original_geometry jsonb
shared_boundary jsonb
outer_boundary jsonb
baseline_revision text
validation_report jsonb
created_by uuid
created_at timestamptz
```

The first Objection write must be a server transaction: validate both DGUIDs from the local map authority, verify adjacency, construct the canonical pair snapshot, and insert the submission plus revision. The browser sends DGUIDs and text but is never the persisted geometry authority.

### 2.3 Counter-Proposal schema

Keep `counter_proposal_revisions`, but add or verify:

- `province_pruid` or an immutable source-scope reference;
- a unique latest-revision strategy;
- an explicit `revision_status` / draft-submitted state if editing after initial submission is required;
- a transaction or Supabase RPC for submission plus first revision creation;
- archive snapshot linkage so the selected revision geometry is copied into `archive_tree` atomically.

The existing list route must select revision metadata only. A detail route selects full geometry.

### 2.4 Workspace tables

Connect the existing tables through Commissioner-only server routes:

| Table | Required durable content |
| --- | --- |
| `workspace_comments` | submission, author profile ID, text, action, closing flag, timestamps |
| `workspace_labels` | submission, label name/color, custom flag, updater, timestamps |
| `workspace_archive_requests` | requester, assignee profile IDs, votes, state, timestamps |
| `archive_tree` | immutable submission/revision snapshot, branch/version/latest flags, merge/revert/delete audit fields |

Emails are display projections. Identity, assignees, votes, and authorization use profile UUIDs.

## 3. Target API and Service Architecture

### 3.1 Submission routes

Add a dedicated repository-backed router, preferably `server/routes/submissions.js` plus `server/lib/submissions/` domain modules:

```text
POST  /api/submissions/objections
GET   /api/submissions/mine?cursor=&limit=&type=&status=
GET   /api/submissions?cursor=&limit=&type=&status=&sort=&province=
GET   /api/submissions/:submissionId
GET   /api/submissions?dguid=&active=&limit=
GET   /api/submissions/heatmap?status=pending,archive-request
GET   /api/submissions/export.csv
```

Rules:

- Public list/detail routes derive `user_id` from the verified session.
- Commissioner routes require Commissioner role and server-side province scope.
- The list endpoint returns only projection fields.
- Detail endpoints return geometry only after role/ownership checks.
- `GET /api/submissions/heatmap` returns only `countsByDguid`.
- Export uses the same role, identity, province, and filter rules.

The current `server/routes/comments.js` generic route can remain temporarily for feedback compatibility, but Objection writes must move to the dedicated route. `src/services/commentsApi.js` should expose separate `getPublicSubmissions`, `getCommissionerSubmissions`, `getSubmissionDetail`, and `submitObjection` methods instead of making one service represent every flow.

### 3.2 Capability and province authorization

Add a local-authority capability service:

```text
GET /api/map/capabilities?dguid=<id>
GET /api/map/capabilities?dguid=<id>&neighboring_dguid=<id>
```

The response should identify:

```json
{
  "available": true,
  "objection": true,
  "counterProposal": true,
  "primaryFed": "...",
  "secondaryFed": "...",
  "provincePruid": "...",
  "reason": null,
  "baselineRevision": "..."
}
```

Use the same function in:

- `src/pages/UserHome.jsx` Step 1/Step 2 gating;
- `src/components/non_prebuilt/MapInfoPanel.jsx` activity availability;
- `server/lib/map/mapAssetAuthority.js`;
- Objection and Counter-Proposal write validation.

Do not add a Yukon-only special case. If a non-Yukon Enabled FED is unavailable, report the missing manifest, metadata, or pair capability explicitly and add a FED-level smoke test.

Commissioner province scope must be derived from the authenticated profile and canonical `PRUID`, not from a browser parameter. Apply it to map hit testing, submissions, Workspace, Archive, heatmap, detail, and exports. Same-province cross-FED pairs remain possible; cross-province pairs are rejected.

### 3.3 Workspace API

Extend `server/routes/workspace.js` with authenticated Commissioner endpoints:

```text
GET    /api/workspace/submissions/summary
GET    /api/workspace/comments/:submissionId
POST   /api/workspace/comments
PATCH  /api/workspace/comments/:commentId
DELETE /api/workspace/comments/:commentId
GET    /api/workspace/labels/:submissionId
PUT    /api/workspace/labels/:submissionId
DELETE /api/workspace/labels/:labelId
GET    /api/workspace/archive-requests/:submissionId
POST   /api/workspace/archive-requests
PATCH  /api/workspace/archive-requests/:submissionId
POST   /api/workspace/archive-requests/:submissionId/votes
```

Replace localStorage functions in `src/services/tempWorkspace.js` with `src/services/workspaceApi.js`, retaining a short compatibility facade only while components migrate.

### 3.4 Archive API

Keep the existing merge/revert routes, but change archive merge to accept an explicit source revision and include that revision’s immutable geometry in `submission_snapshot`. Add:

```text
GET /api/workspace/archive/export.csv
POST/PATCH /api/workspace/archive/restore-request   # if policy requires approval
```

Replace permanent delete with a tombstone operation. At minimum record `deleted_at`, `deleted_by`, and `delete_reason`; ideally retain all versions and expose a recovery operation.

### 3.5 Frontend services and query cache

Introduce the following structure:

```text
src/services/
  submissionsApi.js       # list/detail/create/export projection APIs
  objectionApi.js         # objection write/detail snapshot APIs
  counterProposalApi.js   # durable CP lifecycle and detail geometry
  workspaceApi.js         # comments, labels, archive requests, votes
  archiveApi.js            # archive list, merge, revert, export
  mapCapabilitiesApi.js   # DA/FED capability and province scope
src/lib/query/
  submissionCache.js       # keyed request cache and invalidation
  workspaceCache.js        # summary/detail cache
```

If a query library is not introduced, implement a small in-memory cache with request de-duplication, cursor keys, and explicit invalidation after writes. Do not use localStorage for shared server state.

## 4. Progressive Loading and UX Plan

### 4.1 Tables and Workspace

Replace browser-only React Table pagination with cursor pagination:

- Public My Submissions requests the first 10 rows from `/api/submissions/mine`;
- Commissioner User Submissions requests the first 10 rows from the scoped Commissioner endpoint;
- Workspace requests branch/status counts and the first three rows for visible branches;
- `Show more` requests the next cursor for that branch;
- detail navigation requests one submission snapshot and does not refetch every submission.

The UI should render the first response immediately, prefetch the next cursor opportunistically, and show an inline branch loading indicator rather than blocking the whole page.

### 4.2 Counter-Proposal local-first editing

Current `src/pages/UserHome.jsx` already loads local metadata and uses `requestAnimationFrame`; the next implementation must separate rendering from validation:

1. Preserve canonical vertices and generate UI-only handles at uniform distance along each shared-boundary segment.
2. Keep endpoints locked and store each virtual point as `(segmentId, t)`.
3. On `pointermove`, update only the projected coordinate, minimum clearance, and MapLibre source data.
4. On `pointerup`, insert/update the actual shared vertex, run JSTS validity, overlap, area, and population impact checks.
5. Move full validation and impact calculation to a Web Worker.
6. Revert by binary search to the last valid position when necessary.
7. Cache drafts by `pair + baselineRevision`; use localStorage only for small history metadata and IndexedDB for large GeoJSON.
8. Upload only the final proposed geometry to the server; the server reloads canonical metadata and validates again before creating a revision.

Likely files:

- `src/lib/map/counterProposalWorkflow.js` — handle sampling, lightweight drag state, worker payloads;
- new `src/lib/map/counterProposalHandles.js` — uniform density and segment parameterization;
- new `src/workers/counterProposalValidation.worker.js` — JSTS and impact calculation;
- `src/pages/UserHome.jsx` — worker lifecycle and local draft cache;
- `src/components/non_prebuilt/MapCanvas.jsx` — source updates without full layer rebuild;
- `src/services/counterProposalApi.js` — final upload only.

### 4.3 Rollout toggle

`MapCanvas.jsx` currently loops through rollout areas and periodically updates `blinkHidden` feature state. Remove the interval blink. Precompute immutable Enabled/Data Blocked sets and use a single layer filter or paint expression. Toggle should update one presentation mode and necessary layer opacity/filter values. If a visual transition is desired, animate the control button with CSS rather than repeatedly repainting all FED features.

## 5. Export Plan

Implement server-side streaming exports:

- Submission Table export: filtered Commissioner projection CSV;
- Public export: own-submissions projection only;
- Archived Tree export: branch/version/status/DGUID/audit metadata CSV;
- optional explicit GeoJSON/ZIP export: separate endpoint, explicit confirmation, role and province checks.

Likely files:

- `server/routes/submissions.js`;
- `server/routes/workspace.js`;
- new `server/lib/export/csvWriter.js`;
- `src/services/submissionsApi.js` / `archiveApi.js`;
- `src/pages/DashboardSubmissionsTable/SubmissionsTable.jsx`;
- `src/pages/ArchivedTree.jsx`.

## 6. Public Status Contract

The Public API must expose `public_status`, not raw Commissioner workflow status:

```text
pending + archive-request -> pending
accepted + archived       -> accepted
rejected                  -> rejected
```

`MySubmissions.jsx` should render only this projection. Public users must not see internal Archive Tree state or be sent to Archived Tree. Commissioner views continue to receive the internal status and archive controls.

## 7. Archived Tree Navigation

Update:

- `src/pages/ArchivedTree.jsx` — default Back to Workspace button and `location.state.from` support;
- `src/pages/ArchivedDifference.jsx` — Back to Archived Tree;
- `src/components/non_prebuilt/ArchivedTreePanel.jsx` — panel navigation actions;
- `src/pages/Header.jsx` — role-aware labels and route defaults.

No deep link should fall back to the Dashboard map when the logical parent is Workspace.

## 8. Demographic Statistics Plan

Use Statistics Canada’s 2021 Census Profile Web Data Service (SDMX REST) as the authoritative source:

- [2021 Census Profile WDS Guide](https://www12.statcan.gc.ca/wds-sdw/2021profile-profil2021-eng.cfm)
- [2021 Census Profile open dataset](https://open.canada.ca/data/en/dataset/750e6035-adf8-4426-966f-4c25b12a999e)

Do not call the external service on every map click. Build a versioned server-side ETL:

1. Select a stable indicator contract: age bands, population density, housing/dwellings, household/family structure, median income, education, labour participation, commuting, and language.
2. Batch-fetch values by DA geographic identifier / DGUID.
3. Store `census_year`, source variable code, source URL, retrieval timestamp, suppression flags, and unavailable markers.
4. Write to a `da_demographics` table or versioned local `da_demographics_index.json`.
5. Add `GET /api/map/da/:dguid/statistics` returning a compact current-DA projection.
6. Display source, year, suppression, and missing-data explanations in `UserViewStatistics.jsx`.

Likely new files:

```text
scripts/reusable/collect_da_demographics.py
src/data/map/indexes/da_demographics_index.json   # if local release is selected
server/routes/demographics.js
server/lib/demographics/statisticsCanada.js
src/services/demographicsApi.js
```

## 9. Security, Migration, and Deployment Checklist

Before enabling the new routes:

1. Apply and verify the Objection revision migration and Counter-Proposal revision updates.
2. Verify the old DGUID foreign keys, status constraints, archive RPCs, grants, and indexes in the target Supabase project.
3. Define explicit RLS policies or document the server-only service-role boundary for every new table.
4. Add `requireAuth`, role, ownership, and province checks to `comment-tags`, submission, workspace, export, archive, and demographic routes.
5. Replace `GET /api/comments/proposal/:proposalId`’s stale `profiles!submissions_user_id_fkey` relationship with normal profile hydration.
6. Keep service-role credentials server-only and keep `.env` out of version control.
7. Add migration smoke tests against a disposable Supabase database or SQL Editor verification checklist.

## 10. Test and Acceptance Plan

### API and database tests

- Objection create rejects unknown, inactive, equal, and non-adjacent DGUID pairs.
- Objection detail returns the same immutable geometry after local asset changes.
- Counter-Proposal create/list/detail never exposes geometry from list endpoints.
- Revision creation is atomic and archive merge includes the selected revision snapshot.
- Public list is session-scoped and returns only `public_status`.
- Commissioner list/detail/export is province-scoped.
- Workspace CRUD writes to Supabase tables and rejects unauthorized identity changes.
- Archive delete is recoverable under the chosen tombstone policy.

### Frontend tests

- First-page table and Workspace branch render before later pages load.
- `Show more` fetches only the next branch cursor.
- Counter-Proposal handles have uniform density and locked endpoints.
- Dragging remains responsive while worker validation runs.
- Invalid geometry reverts to the last valid position.
- Public users cannot see Archive Tree statuses or routes.
- Commissioner cannot click, hit-test, query, or export another province.
- Toggle changes are stable and do not blink or repaint every FED repeatedly.
- Archived Tree returns to Workspace and Difference returns to Archived Tree.

Existing regression commands remain required:

```text
npm run check:server
npm test -- --runInBand
npm run build
git diff --check
```

## 11. Implementation Checkpoints

Priority is intentionally embedded in these checkpoints. A later checkpoint must not be treated as complete when its prerequisite checkpoint has unresolved data-contract or authorization failures.

### Checkpoint 1 — P1: Freeze the database contract and security boundary

Apply and verify migrations for Objection revisions, Counter-Proposal revision metadata, Workspace tables, archive fields, constraints, indexes, grants, RPCs, and RLS policies. Remove obsolete DGUID foreign-key assumptions and repair the stale `profiles!submissions_user_id_fkey` relationship route. Confirm that service-role credentials remain server-only.

**Exit criteria:** the target Supabase project has an auditable schema, each new table has an explicit browser/server access boundary, and migration smoke tests pass.

### Checkpoint 2 — P1: Make all submission geometry immutable and separate list/detail reads

Create `objection_revisions`, add the missing Counter-Proposal lifecycle fields, and implement transactional create/detail routes. Introduce the shared projection repository and cursor-based list endpoints so tables, Workspace, InfoPanel, and heatmap never retrieve GeoJSON. Validate all writes against the local map authority and preserve baseline revision references.

**Exit criteria:** Objection and Counter-Proposal detail pages replay their submitted geometry after local assets change; no list response contains full geometry.

### Checkpoint 3 — P1: Replace transitional Workspace state and enforce identity scope

Replace `tempWorkspace.js` browser persistence with `workspaceApi.js` and durable comments, labels, archive requests, assignees, votes, and summaries. Add role, ownership, public-status, and Commissioner province checks to submissions, Workspace, Archive, map capability, heatmap, and export routes. Test every Enabled FED capability rather than retaining any Yukon-only behavior.

**Exit criteria:** two Commissioners can observe the same Workspace state, public users see only their own projected status, and a Commissioner cannot query another province.

### Checkpoint 4 — P1: Finish Counter-Proposal revision and archive integrity

Complete server-validated Counter-Proposal revision creation, select an explicit source revision during merge, and atomically copy it into `archive_tree.submission_snapshot`. Add controlled invalidation or Realtime for shared writes, retain recoverable archive tombstones, and ensure archived detail/history uses immutable snapshots.

**Exit criteria:** revisions, merge, revert, and recovery preserve a complete audit trail without relying on browser state.

### Checkpoint 5 — P2: Deliver progressive list, Workspace, and navigation UX

Move public and Commissioner tables to first-page cursor loading; request Workspace branch counts plus only the initial visible rows; make `Show more` fetch the next branch cursor. Add projection-level query caching and remove duplicate full-list requests. Correct Archived Tree and difference-page back navigation, then implement scoped CSV exports.

**Exit criteria:** the first useful content appears without waiting for the full dataset, branch expansion remains functional, and exports obey the same authorization filters as the UI.

### Checkpoint 6 — P2: Refactor Counter-Proposal editing and map presentation

Use uniformly sampled UI handles, locked endpoints, local-first drafts, worker-based JSTS/impact validation, and final server validation only on commit. Update MapLibre source data without rebuilding layers. Replace rollout blinking/feature-state loops with stable filters or paint expressions, then complete responsive, loading, status, and remaining map UX regression fixes.

**Exit criteria:** dragging is responsive on complex boundaries, invalid positions revert predictably, and the Enabled/Data Blocked toggle does not visibly blink or stall.

### Checkpoint 7 — P3: Add demographics and presentation metadata

Build the versioned Statistics Canada ETL and DA statistics API, then render demographic source, census year, suppression, and missing-value states in `UserViewStatistics.jsx`. Resolve smaller UI/UX regressions discovered after the P1/P2 architecture is stable.

**Exit criteria:** Statistics are served from the project data store rather than per-click external calls, and every shown value is attributable to a source and vintage.

### Checkpoint 8 — Release verification and documentation synchronization

Run the API/database and frontend acceptance suite in Section 10, verify production migrations and policies, and refresh Demo 3 historical documentation only when the new contracts are deployed and stable.

**Exit criteria:** `npm run check:server`, tests, build, and `git diff --check` pass; production configuration has been verified by the project owner.
