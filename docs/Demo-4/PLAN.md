# Demo 4 Implementation Plan

**Status:** Planning baseline  
**Source of truth:** `local/Demo-3-Report.md`, the current `main` implementation, and the read-only Supabase audit performed on 2026-07-21.  
**Scope:** Complete the broken or transitional Demo 3 data flows, separate list/detail geometry payloads, improve map editing performance, and finish the remaining submission, Workspace, Archive, and Statistics capabilities.

This document is an implementation plan, not a claim that the work is complete. The historical Demo 3 reports remain unchanged.

## 1. Current Baseline and Definition of Done

The 2026-07-21 Supabase audit contained 70 `submissions`, 6 `counter_proposal_revisions`, and 1 `archive_tree` record. A later read-only audit on 2026-08-02 found durable Workspace rows, but behavioral verification still reproduced two source-of-truth failures: comments can disappear immediately on a slow write, and labels/custom-label catalog values can duplicate or reset after a hard refresh because server identifiers are serialized incorrectly and mutations are not awaited. A two-Commissioner test also proved that `crmp.workspace.v1` can keep one browser in `rejected` after another Commissioner commits `accepted`. These verified defects are Checkpoint 5 work under Sections 3.3 and 4.1. The audit did not inspect every PostgreSQL system catalog, so migration history, constraints, RPC grants, and RLS policies must still be verified separately by the project owner.

Demo 4 is complete only when:

1. Objections and Counter-Proposals have the same immutable snapshot contract.
2. Every list, table, Workspace tree, InfoPanel, and heatmap request returns only a small projection; GeoJSON is returned only by an authorized detail or archive endpoint.
3. Public, Commissioner, Workspace, and Archived Tree queries are independent and scoped by identity, role, and province.
4. Workspace collaboration is durable in Supabase and synchronized between Commissioners.
5. Counter-Proposal editing is local-first, smooth during dragging, and server-validated only at commit.
6. Export, archive recovery, and Statistics data have explicit authorization and versioned contracts.
7. Every committed Demo 4 domain mutation is observable through an authenticated, scope-filtered WebSocket event and converges all authorized clients without a manual refresh.

## 2. Target Data Architecture

### 2.1 Submission projection versus geometry detail

All three submission types must use the following two-layer read model.

**List projection** (safe for tables, Workspace, InfoPanel, and heatmap):

```text
id
type
status
title
created_at
updated_at
author_email
primary_dguid
secondary_dguid
community_label
scope_pruids              # one PRUID normally; primary + secondary for a cross-province pair
latest_revision_number
```

The projection must not contain `original_geometry`, `proposed_geometry`, `shared_boundary`, or any other large GeoJSON value.

This list projection is an API response shape, not a PostgreSQL projection table, materialized view, or Checkpoint 2 repository abstraction. Checkpoint 5 implements it with an explicit Supabase `.select(...)` column list and normal server-side role/ownership checks. Checkpoint 2 does not build a Projection Table, cursor adapter, or table-facing read model.

**Detail snapshot** (one record at a time, authorized):

```text
submission
  id, type, title, comment, author, status, timestamps
  primary_dguid, secondary_dguid, primary/secondary FED and immutable PRUID scope set
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

- an immutable primary/secondary PRUID scope reference (a normalized `submission_scope_pruids` relation or equivalent), preserving a one- or two-PRUID source scope;
- an immutable, submitted source revision created with the initial submission;
- an explicit `revision_status` only if a future product requirement permits post-submission editing;
- a transaction or Supabase RPC for submission plus first revision creation;
- archive snapshot linkage so the selected revision geometry is copied into `archive_tree` atomically.

For Demo 4, the submitted Counter-Proposal is immutable: the server-side submit transaction creates one sealed source revision containing the canonical original DA-pair geometry, the submitted proposed geometry, boundaries, baseline reference, and validation report. Workspace status changes, archive merge/revert/tombstone/restore, and map rendering must not create or overwrite another Counter-Proposal revision. If the product later permits re-submission, it must be an explicit new revision workflow with its own authorization and validation contract; it is not an Archived Tree operation.

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

**Optional P3 normalization:** physically splitting the legacy `comments`/`submissions` persistence into three workflow-specific Feedback, Objection, and Counter-Proposal tables is optional, not a Demo 4 prerequisite. The P1/P2 implementation may retain one typed `submissions` table plus the immutable Objection and Counter-Proposal revision tables. No CP1, CP2, CP3, or CP5 exit criterion depends on completing that physical split.

### 2.5 Realtime event and delivery state

Realtime is a consistency layer over committed Supabase state, not a second source of truth. Add a transactional outbox table, or an equivalent PostgreSQL change-data-capture mechanism with the same guarantees, for all Demo 4 durable domain mutations:

```text
realtime_outbox
  id uuid primary key
  aggregate_type text
  aggregate_id uuid/text
  operation create/update/delete
  actor_profile_id uuid
  owner_profile_id uuid null
  scope_pruids text[] not null
  resource_version bigint/timestamptz
  projection_hints jsonb
  committed_at timestamptz

realtime_scope_deliveries
  outbox_id uuid references realtime_outbox(id)
  pruid text
  scope_sequence bigint
  dispatched_at timestamptz null
  primary key (outbox_id, pruid)
  unique (pruid, scope_sequence)
```

Checkpoint 1 owns these migrations, constraints, indexes, retention, and server-only grants. A domain mutation inserts one logical `realtime_outbox` event and one delivery row per PRUID in its immutable scope set in the same database transaction. Rolled-back writes emit no event. The same event ID is therefore delivered once to each authorized scope while preserving a resumable per-scope sequence. Events contain identifiers, versions, scope, and cache/projection hints only; comments, profile details, full submission bodies, and GeoJSON are fetched afterward through the normal authorized HTTP read endpoint.

Checkpoint 0 owns dispatch, WebSocket transport, replay/resync, and the CRUD/realtime acceptance matrix; it does not own a domain migration or invent a domain event. Checkpoints 2, 3, 4, and 5 define and transactionally insert events for the mutations allocated to them; Checkpoint 5 also owns table/Workspace invalidation consumers. Delivery is at-least-once. Consumers deduplicate by event ID, ignore older resource versions, and refetch the authoritative HTTP result. A reconnect replays retained deliveries for the connection's derived PRUID or sends `resync-required`, after which the client invalidates and refetches scoped queries.

## 3. Target API and Service Architecture

### 3.0 Checkpoint 1/2 parallel delivery contract

Checkpoint 1 and Checkpoint 2 may proceed in parallel only after a short, versioned interface freeze is reviewed and committed. This is a contract artifact, not a third implementation checkpoint: it records the agreed names, types, invariants, request/response projections, and error codes before either workstream begins. A contract change requires joint review and an incremented contract version.

The frozen interface contains:

```text
Persistence schema owned by Checkpoint 1
  submissions; submission_scope_pruids; objection_revisions;
  counter_proposal_revisions; realtime_outbox; realtime_scope_deliveries;
  indexes, constraints, RLS/grants

Domain ports consumed by Checkpoint 2
  SubmissionRepository.createObjection(input, actor)
  SubmissionRepository.createCounterProposal(input, actor)
  SubmissionRepository.getDetail(submissionId, scope)
  MapAuthority.getCapability(primaryDguid, secondaryDguid?)
  MapAuthority.prepareObjection(input)
  MapAuthority.prepareCounterProposal(input)

HTTP contract owned by Checkpoint 2
  POST /api/submissions/objections
  POST /api/submissions/counter-proposals
  GET  /api/submissions/:submissionId
  GET  /api/map/capabilities
  shared detail/capability/error envelopes
```

The contract fixes canonical primary/secondary DGUID and FED fields, ordered immutable `scope_pruids`, revision and outbox transaction boundaries, authorized detail behavior, authorization inputs, and standard validation/conflict/not-found response shapes. The browser never supplies an authoritative owner, PRUID scope, revision, or derived FED. Checkpoint 5's direct-select table reads are intentionally outside this CP1/CP2 interface freeze.

Parallel ownership is strict:

- **Checkpoint 1** creates and verifies the database migrations, RLS/grants, service-role boundary, backfill/rollback procedure, and disposable-database schema/security harness. It provides fixtures and repository-interface test doubles, but does not implement submission business handlers, capability logic, or route tests that require real submission behavior.
- **Checkpoint 2** implements `server/routes/submissions.js`, its domain/repository adapters, map-capability endpoint, local-authority validation, transactional submission behavior, and submission API tests against the frozen interfaces. It does not create/alter tables, policies, grants, RPCs, or migration files.

Each workstream may use its own branch and test doubles. The only synchronization points are: (1) contract freeze, (2) applying Checkpoint 1 migrations to the disposable database and replacing Checkpoint 2 doubles with the production persistence adapter, and (3) running the combined route/database suite. A failure at integration is assigned to the owner of the violated frozen contract, not solved through ad-hoc cross-checkpoint schema or route edits.

### 3.1 Submission routes

Keep one public URL namespace but split implementation ownership into ordered subrouters. CP5's static/list router is registered before CP2's parameterized detail/write router:

```text
CP5: server/routes/submissionLists.js
GET   /api/submissions/mine?query=&createdFrom=&createdTo=&type=&status=&sort=
GET   /api/submissions?submissionId=&dguid=&active=&query=&createdFrom=&createdTo=&type=&status=&sort=

CP2: server/routes/submissions.js
POST  /api/submissions/objections
POST  /api/submissions/counter-proposals
GET   /api/submissions/heatmap?status=pending,archive-request
GET   /api/submissions/:submissionId
```

Rules:

- Public list/detail routes derive `user_id` from the verified session.
- Commissioner routes require Commissioner role and server-side membership in the resource's canonical PRUID scope set.
- The list endpoints use an explicit direct-select allowlist and return no geometry or revision snapshot fields.
- Detail endpoints return geometry only after role/ownership checks.
- `GET /api/submissions/heatmap` returns only `countsByDguid`.
- The optional exact `submissionId` filter reuses the same lightweight row shape for Workspace focus-first navigation; it is not an authorization input.
- Export routes live under `/api/exports` and use the same role, identity, province, and visibility rules.

Checkpoint 5 owns these lightweight list handlers while replacing table and Workspace list-loading queries. The server derives the public owner from the verified session and never accepts a browser-supplied owner ID as an authorization input. Public status display is the frontend rule in Section 6; this simplified scope does not require a separate database projection or `public_status` column.

The current `server/routes/comments.js` generic route can remain temporarily for feedback compatibility, but Objection writes must move to the dedicated route. `src/services/commentsApi.js` should expose separate `getPublicSubmissions`, `getCommissionerSubmissions`, `getSubmissionDetail`, and `submitObjection` methods instead of making one service represent every flow.

#### 3.1.1 Checkpoint 5 direct-select list contract

Checkpoint 5 implements list reads with a small explicit Supabase `.select(...)` allowlist. It does not create a Projection Table, materialized view, mock/backend source switch, cursor envelope, or CP2-owned table adapter. The HTTP response contains `items` plus normalized `appliedFilters`; the CP5 client service unwraps `items` into the ordinary array expected by the unchanged React Table components.

The minimum selected database fields are:

```text
id, user_id, type, fed_num, dguid, neighboring_dguid,
title, status, created_at, updated_at
```

The server may add only the display values already required by the current UI, such as a batched `profile.email` and `dissemination_areas.community_name`. It must never select or serialize `geometry`, `original_geometry`, `proposed_geometry`, full revisions, private comments, shared boundaries, outer boundaries, or validation reports for a list request. Counter-Proposals come from the same `submissions` select and are not fetched again through the revision-detail route.

The optional list filters remain normalized consistently: `query` is trimmed, internal whitespace is collapsed, and limited to 100 Unicode code points; `createdFrom` and `createdTo` accept `YYYY-MM-DD` and use UTC day boundaries; type/status/sort values are allowlisted. Authorization and owner predicates run before filtering and before any present or future pagination. `appliedFilters` echoes the normalized values actually used. These filters are conveniences for the direct select, not a cursor protocol, and the current client continues to paginate `items` locally.

Checkpoint 2 has no deliverable or acceptance gate in this subsection. Its immutable write/detail work can proceed independently. Checkpoint 5 tests the direct-select field allowlist, owner/role behavior, exact-ID filter, response size, stable sort, absence of GeoJSON, and compatibility with the unchanged Public and Commissioner table components.

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
  "scopePruids": ["..."],
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

Commissioner scope must be derived from the authenticated profile and canonical `PRUID`, not from a browser parameter. Apply it to map hit testing, submissions, Workspace, Archive, heatmap, and detail. A same-province pair has one PRUID; a cross-province adjacent pair is valid and has an ordered, immutable two-PRUID scope set derived from its primary and secondary DGUIDs. A Commissioner is authorized when their PRUID belongs to that set; a Commissioner outside both scopes is denied. Checkpoint 4 owns the reusable scope guard for its domain routes. Checkpoint 5 owns the independent export authorization described in Section 5. The Archive and archive-request-specific rules are defined in Section 3.4.2.

#### 3.2.1 Counter-Proposal Enabled-FED rollout incident: diagnosis and remediation

The observed symptom is that a Public User can submit a Counter-Proposal for Yukon FED `60001`, but not for other Enabled FEDs. The current repository evidence separates the likely causes:

- the canonical local `da_asset_manifest.json` contains 120 Enabled FEDs across NL, PE, MB, SK, AB, BC, and YT, and each declared metadata file is present; the server-side `loadPairObjectionIndex` / `prepareCounterProposalSubmission` path reads that local profile index and FED metadata rather than a Supabase map table. Read-only representative pair validation succeeds for one FED in each of those seven provinces, including six non-Yukon FEDs;
- the client nevertheless starts with a Yukon-only fallback manifest when `/api/map/assets/manifests/da_asset_manifest.json` cannot be loaded. In addition, `getMetadataGeojsonPathsForFed` currently returns the first manifest asset when the requested FED is absent. In a Yukon-first fallback (or a stale/incomplete manifest), that silently substitutes `fed_60001.geojson` for another FED instead of producing a diagnosable unavailable state. This is a confirmed Yukon-only failure path;
- the checked-in migrations do not constitute an inspectable baseline definition for every pre-existing `submissions` constraint, trigger, view, RPC, and policy. The current target database has only Yukon Counter-Proposal rows, which proves the production symptom but cannot prove or rule out an untracked Yukon-only database restriction. It must therefore be inspected before declaring the rollout fixed.

Under the Section 3.0 parallel contract, Checkpoint 1 performs the deployment/database audit and provides the fail-closed persistence contract while Checkpoint 2 implements the canonical capability/write path against contract doubles. After the migration/API integration gate, Checkpoint 2 owns the all-Enabled-FED capability/write acceptance suite. Workspace status/base behavior does not implement or redefine this capability contract. The responsibilities are:

1. **Checkpoint 2 — fail closed on map authority.** Remove the Yukon-only operational fallback. If the canonical manifest, requested FED entry, or declared metadata asset is unavailable, return an explicit `available: false` capability reason and disable the Public User flow; never substitute another FED's metadata. Treat the fallback manifest only as an offline-development fixture that cannot enable editing/submission in a deployed build.
2. **Checkpoint 2 — make the local authority the sole geographic source.** Resolve both DGUIDs to their FED/PRUID from the local profile index; load only manifest-declared local metadata for those FEDs; derive the submitted `fed_num`, ordered `scope_pruids`, and baseline revision on the server; and reject a browser `fed_num` or scope mismatch. The client must consume the same server capability result for Step 1/2 gating instead of making a separate best-effort metadata decision.
3. **Checkpoint 1 — audit and migrate the target Supabase contract.** Capture the live definitions of `submissions` / revision-table checks, defaults, foreign keys, indexes, triggers, RLS policies, views, and RPCs. Search for literals or dependencies that bind Counter-Proposals to `60001`, Yukon, early `map_proposals`, or an old Supabase metadata relation. Replace only confirmed restrictive objects with versioned migrations that permit all locally Enabled FED numbers while retaining canonical DGUID/FED validation in the server authority; backfill/quarantine legacy rows deterministically and rehearse on a target-data copy.
4. **Checkpoint 2, then joint integration — prove publication and write coverage.** Add a non-mutating capability audit for every Enabled FED (manifest entry, profiles, metadata HTTP asset, and at least one adjacent pair) plus submission tests spanning every Enabled FED. While parallel work is in progress, run these against the frozen MapAuthority/SubmissionRepository doubles; after Checkpoint 1 applies the disposable-database migration, run the authenticated route/database version. The test must assert the server-derived FED is the selected primary DA's FED, never `60001` by fallback, and include a cross-province adjacent-pair case that persists both canonical PRUIDs and is visible to each participating province. Keep negative cases for a missing/stale manifest entry, a disabled FED, an unknown/non-adjacent pair, and a mismatched browser `fed_num` or scope. Production verification records the per-FED result and the deployed manifest version/hash before enabling the flow.

### 3.3 Workspace API

The Workspace continues to use authenticated Commissioner endpoints for status, comments, labels, and the label catalog:

```text
PATCH  /api/workspace/submissions/:submissionId/status  # non-archive accepted/rejected transitions only
GET    /api/workspace/comments/:submissionId
POST   /api/workspace/comments
PATCH  /api/workspace/comments/:commentId
DELETE /api/workspace/comments/:commentId
GET    /api/workspace/labels/:submissionId
PUT    /api/workspace/labels/:submissionId
DELETE /api/workspace/labels/:labelId
GET    /api/workspace/label-catalog
POST   /api/workspace/label-catalog
PATCH  /api/workspace/label-catalog/:labelId
DELETE /api/workspace/label-catalog/:labelId
```

There is no required Workspace Summary API, `WorkspaceSummaryV1`, branch cursor, or CP2 projection dependency. Workspace list and branch statistics reuse Checkpoint 5's lightweight submission selects. A direct Workspace entry loads the complete lightweight array; a `?focus=<submissionId>` entry first performs the exact-ID lightweight select, renders that branch immediately, and then refreshes counts and branch rows from the background full lightweight request.

Checkpoint 3 retains the durable Workspace tables and the existing authenticated base handlers/status behavior. Following behavioral verification, Checkpoint 5 owns the remaining reliable comments/labels/label-catalog CRUD completion and the removal of browser-authoritative Workspace state. In particular, CP5 must correct `id`/`is_custom` label serialization, persist custom-label edits, await and report mutations, remove `crmp.workspace.v1` submission overrides and browser-event synchronization, and refetch authoritative server state after writes, focus/visibility changes, and CP0 invalidation events. CP0 still owns the WebSocket transport; CP4 still owns Archive Request and province-scope behavior.

The three seeded custom catalog slots are `Custom Label 1`, `Custom Label 2`, and `Custom Label 3`. Their colors remain independently editable. Initialization/migration is idempotent and must not overwrite a Commissioner-renamed value.

Workspace decision actions must not report success while their required comment/label write is still unawaited. A failed mutation leaves the UI on the authoritative server result and displays an actionable error. Full transactional decision orchestration may use an existing server transaction/RPC when available; it must not be simulated by a localStorage mirror.

Target files:

```text
server/routes/workspace.js                     # composition and frozen registration order only
server/routes/workspaceStatus.js               # CP3 durable status/base reads
server/routes/workspaceCollaboration.js        # CP5 comments/labels/catalog CRUD
server/lib/submissions/lightweightSubmissionSelect.js # CP5 direct select reused by Workspace/export
src/services/workspaceApi.js                    # CP5 removes localStorage authority and awaits writes
src/pages/CommissionerWorkspace.jsx             # CP5 focus-first/background-full loading
src/components/non_prebuilt/WorkspaceReviewPanel.jsx
tests/workspace.api.test.js
tests/workspace.realtime.test.js
```

### 3.4 Archive API

Checkpoint 4 owns the Archived Tree backend. It does not create another Counter-Proposal revision. It packages the already sealed submission/source-revision snapshot into an independently versioned archive branch with merge, revert, tombstone, and recovery audit metadata.

```text
POST   /api/workspace/archive
       { submissionId, sourceRevisionId, closingComment }
GET    /api/workspace/archive?cursor=&branchKey=
GET    /api/workspace/archive/:archiveVersionId
PATCH  /api/workspace/archive/branch/latest
DELETE /api/workspace/archive/branch       # tombstone, not physical delete
POST   /api/workspace/archive/branch/restore
```

`sourceRevisionId` is mandatory for a Counter-Proposal merge even when the submission has only its initial revision. The server locks the submission and revision, verifies that the revision belongs to that submission and is submitted, verifies Commissioner membership in its `scope_pruids` and the Section 3.4.2 two-PRUID approval rule where applicable, then copies—not references—the selected revision into `archive_tree.submission_snapshot`. A Feedback or Objection merge uses its corresponding immutable submission snapshot under the same transaction contract.

#### 3.4.1 Archived Tree snapshot and version contract

The required data flow is:

```text
canonical local map authority
  -> server-validated Counter-Proposal submit
  -> submissions row + one sealed counter_proposal_revisions source snapshot
  -> explicit archive merge(sourceRevisionId)
  -> immutable archive_tree version snapshot
```

`archive_tree.submission_snapshot` must contain the submission projection plus a copied `source_revision` object with `id`, `revision_number`, `primary_dguid`, `secondary_dguid`, immutable `scope_pruids`, `baseline_revision`, `original_geometry`, `proposed_geometry`, `shared_boundary`, `outer_boundary`, `validation_report`, `created_by`, and `created_at`. Archived Tree detail/history reads this copied snapshot only; it must never rehydrate geometry from the current map asset, the live submission, or the current Counter-Proposal revision.

Archive branch versions are separate from Counter-Proposal revisions:

- `counter_proposal_revisions.revision_number` identifies a submitted proposal version and remains unchanged by archive actions;
- `archive_tree.version_number` identifies a historical Archived Tree entry within a branch;
- a new archive version inserts a new archive row and marks the previous row `is_latest = false`; it must not overwrite a historical `submission_snapshot`;
- revert only moves the branch's `is_latest` marker to an existing archive version and records who/when reverted it;
- tombstone retains every archive version and source submission, recording `deleted_at`, `deleted_by`, and `delete_reason`; restore records who/when restored it.

The merge transaction must write the archive version, update the branch latest marker, apply any submission/Workspace cleanup required by policy, and write the Checkpoint 0 outbox event atomically. Merge, revert, tombstone, and restore use the standard Checkpoint 0 event contract after commit.

For a recovery policy requiring peer approval, `POST/PATCH /api/workspace/archive/restore-request` may gate `POST /api/workspace/archive/branch/restore`, but it cannot remove the retained tombstone/audit record.

#### 3.4.2 Commissioner province isolation and Archive request identity

Checkpoint 4 also owns Commissioner scope isolation. The server resolves `profile.province` to canonical `PRUID` once from the verified session and uses that value in every authorization predicate; the browser must not provide an authoritative province, scope, profile UUID, assignee UUID, or vote identity.

The scope applies to Commissioner map hit testing, submissions list/detail/mutations, Workspace list/comments/labels, archive requests, Archive Tree list/detail/merge/revert/tombstone/restore, and heatmap. Every resource has an immutable `scope_pruids` set derived from its canonical primary and secondary DGUID/FED records. A Commissioner may read or perform ordinary Workspace actions when their PRUID is a member of that set; the same cross-province resource is therefore visible in both participating province scopes. A Commissioner outside the entire set receives a non-disclosing `404` or `403` according to the route policy and never sees event metadata. The server creates one logical outbox event and fans it out to every authorized scope channel with the same event ID.

Archive requests use profile UUIDs end-to-end:

- `requester_id` and every `assignee_id` must resolve to active Commissioner profiles whose PRUID belongs to the target submission's `scope_pruids`; a cross-province request must retain each participant's PRUID alongside its UUID for authorization/audit display;
- votes must be stored as durable UUID-keyed records (prefer `workspace_archive_request_votes(request_id, voter_id, vote, voted_at)` with a unique `(request_id, voter_id)` constraint), never as email-keyed JSON;
- only the requester or an assigned Commissioner may cast a vote, according to the documented state-transition policy; changing assignees and removing invalid votes is atomic. For a two-PRUID request, final merge/revert/tombstone/restore approval requires an affirmative eligible vote from each participating PRUID; ordinary read/comment/label actions do not;
- requester/assignee/voter emails may be returned only as server-created display projections after authorization;
- create, read, assignee update, vote, cancel, and any restore-approval operation first resolve the target submission/request against the Commissioner's PRUID membership in `scope_pruids`.

Archive requests and Archived Tree mutations emit only the already-authorized one- or two-scope Checkpoint 0 events after commit.

Checkpoint 4 owns these authenticated Archive Request routes and their state machine:

```text
GET    /api/workspace/archive-requests/:submissionId
POST   /api/workspace/archive-requests
PATCH  /api/workspace/archive-requests/:requestId/assignees
POST   /api/workspace/archive-requests/:requestId/votes
DELETE /api/workspace/archive-requests/:requestId
```

`ArchiveRequestReadModelV1` remains the target response projection of the CP4 API, not a CP3/CP4 shared-data freeze: `id`, `submissionId`, `scopePruids`, `state`, requester display projection, assignee display projections, UUID-backed vote projections, timestamps, and `allowedActions`. It contains no browser-authoritative email or identity. CP4 owns the model definition, its HTTP serialization, client API wrapper, authorization, state transitions, outbox event mapping, and integration tests.

CP4 implementation sequence and target files:

1. Add `server/lib/authorization/resourceScopeGuard.js`: resolve the target submission's immutable one-/two-PRUID scope from server data, derive the requester's PRUID from the verified profile, return a non-disclosing result for an unrelated scope, and expose the reusable guard to Workspace, Archive, and heatmap routes.
2. Add `server/lib/archiveRequests/service.js` and `repository.js`: create/read/update-assignees/cast-vote/cancel operations validate UUID identities, scope membership, request state, per-PRUID approval rules, and optimistic version/conflict behavior inside one transaction.
3. Implement the listed `/api/workspace/archive-requests` routes in `server/routes/workspace.js`; they return `ArchiveRequestReadModelV1` and write their CP0 outbox/delivery rows atomically. No browser or CP3 service constructs request identity, votes, or allowed actions.
4. Add `src/services/archiveRequestApi.js` as the only browser client for those routes, plus `tests/archiveRequests.api.test.js` and scope/two-PRUID/outbox cases. Remove the current Archive Request functions from `workspaceApi.js` as part of this CP4 migration.

### 3.5 Frontend services and data access

Introduce the following structure:

```text
src/services/
  submissionListsApi.js   # CP5 geometry-free table/focus reads
  submissionsApi.js       # CP2 detail/create APIs
  objectionApi.js         # objection write/detail snapshot APIs
  counterProposalApi.js   # durable CP lifecycle and detail geometry
  workspaceApi.js         # CP5 authoritative Workspace CRUD and reads
  archiveRequestApi.js    # CP4 Archive Request API client only
  archiveApi.js            # archive list, merge, revert
  mapCapabilitiesApi.js   # DA/FED capability and one-/two-PRUID scope
src/lib/realtime/
  realtimeClient.js        # authenticated WebSocket, reconnect, deduplication
  realtimeInvalidation.js  # event-to-query-key invalidation rules
```

CP5 may keep component-lifetime request de-duplication, but it does not introduce a new projection cache, cursor store, or browser-persisted Workspace store. HTTP state is authoritative. A successful Workspace mutation is awaited and then reconciled with the relevant authorized HTTP read; a failed mutation remains visibly failed and must not be represented as committed. `localStorage` is reserved for explicitly local drafts and non-authoritative UI preferences.

### 3.6 Authenticated WebSocket realtime gateway

Add one same-origin WebSocket endpoint, preferably `GET /api/realtime` upgraded by the Node server. Reuse the normal session-cookie authentication and profile lookup during the upgrade, reject disallowed `Origin` values, and derive every subscription scope on the server:

```text
public user       -> user:<authenticated profile UUID>:submissions
Commissioner      -> province:<authenticated PRUID>:submissions
Commissioner      -> province:<authenticated PRUID>:workspace
Commissioner      -> province:<authenticated PRUID>:archive
Commissioner      -> province:<authenticated PRUID>:heatmap
```

The browser must never supply an authoritative user UUID or province. The gateway may accept resource-interest hints such as a visible submission ID, but it validates that resource against the connection's derived scope before subscribing. A cross-province resource event is delivered once to each participating province channel; it is neither delivered nor discoverable by a connection whose PRUID is outside the event's `scope_pruids`.

Use a versioned envelope:

```json
{
  "schemaVersion": 1,
  "eventId": "uuid",
  "sequence": 123,
  "entity": "workspace.comment",
  "operation": "create",
  "entityId": "uuid",
  "aggregateId": "submission-uuid",
  "resourceVersion": "timestamp-or-version",
  "scope": { "kind": "provinces", "pruids": ["24", "35"] },
  "invalidate": ["workspace:list", "workspace:submission:submission-uuid"],
  "committedAt": "ISO-8601"
}
```

Ownership and implementation workflow are deliberately split:

1. **Checkpoint 1** migrates the Section 2.5 outbox/delivery tables, server-only grants, indexes, retention, and recovery queries; it does not implement a WebSocket server.
2. **Checkpoint 0** implements the shared runtime only: `server/realtime/gateway.js` for session/origin/scope-validated upgrades, `server/realtime/dispatcher.js` for claim/dispatch/replay, `server/realtime/eventContract.js` for envelope validation, `src/lib/realtime/realtimeClient.js` for reconnect/dedup/resync, `src/lib/realtime/realtimeInvalidation.js` for query invalidation, and `tests/realtime/*.test.js` for the reusable two-browser harness and matrix.
3. **Checkpoint 2** writes submission/revision scope deliveries in its create transaction; **Checkpoint 3** writes durable Workspace status-transition deliveries; **Checkpoint 4** writes Archive Request/Archive deliveries; **Checkpoint 5** writes comment/label/catalog deliveries for the mutations it completes and registers table/Workspace invalidation mappings. No domain handler calls the gateway directly.
4. Each domain PR first passes its unit/API tests with the shared event contract, then adds its CRUD row to the CP0 matrix. The CP0 harness opens two authorized sessions plus an out-of-scope session, performs the HTTP mutation, verifies exactly one logical event and one delivery per authorized scope, forces duplicate/reconnect/resync paths, and confirms the refetched HTTP projection converges without leaking data.
5. A multi-instance deployment uses the durable outbox/delivery source (and an approved broker/notification fan-out) rather than an in-process emitter. A dispatcher marks a delivery dispatched only after handing it to that transport; a client acknowledgement is not required for correctness because replay/resync remains authoritative.

The gateway itself remains generic. It never contains a mutation-specific switch statement, performs a Supabase schema migration, or writes a domain record; mutation-specific event mapping stays with the owning checkpoint.

Required server behavior:

1. Broadcast only after the database transaction commits and the authorized HTTP response can be reproduced.
2. Validate and dispatch every event type registered by a domain checkpoint; the owning domain checkpoint is responsible for atomically creating that event with its mutation.
3. Send heartbeat ping/pong frames, expire dead connections, bound per-connection subscriptions and outbound buffers, and apply connection/rate limits.
4. Support multiple server instances through the database outbox/CDC source; do not rely on an in-process event emitter as the only publisher.
5. Preserve ordering per aggregate where possible and require idempotent clients because delivery is at-least-once.
6. On reconnect, resume from the last acknowledged sequence when retained events are available; otherwise send `resync-required` and refetch all active scoped queries.

Required client behavior:

1. Keep one shared connection per signed-in browser session and close it immediately on logout or role/profile-scope changes.
2. Reconnect with capped exponential backoff and jitter; surface a non-blocking `live/reconnecting/offline` state.
3. Treat events as invalidation signals rather than authoritative records, deduplicate event IDs, and refetch only affected lightweight lists, branch statistics, detail records, heatmap counts, or archive branches.
4. Reconcile optimistic writes with the committed version and roll back the optimistic view on HTTP failure.
5. Never persist shared Workspace or authorization state in localStorage. Local storage remains limited to explicitly local drafts and non-authoritative UI preferences.

## 4. Progressive Loading and UX Plan

### 4.1 Tables and Workspace

Keep the existing TanStack client-side pagination and table presentation. Public My Submissions and Commissioner User Submissions each make one authorized lightweight request using the Section 3.1.1 explicit column select, receive an ordinary array, and paginate it in the browser. Filtering is applied before any future pagination. No table request may select revision rows or a GeoJSON/snapshot field.

Workspace has two read modes over the same lightweight select:

1. **Normal Workspace entry:** when no submission ID is supplied, fetch the complete authorized lightweight array, derive every branch and its technical statistics, and show a spinner in the Workspace header while this request is pending. Do not replace the whole route with a loading page.
2. **Focused Workspace entry:** when a Submission Table or Map Info Panel supplies `?focus=<submissionId>`, run the exact-ID lightweight select first. Render that one branch and row as soon as it returns. Start one background full lightweight request afterward; when it completes, update `Show More` for the focused branch and the technical statistics for every branch without remounting the already-rendered focused row.

Opening a Workspace map/detail child must not call the full Workspace aggregator. Fetch the exact lightweight row first. For a Counter-Proposal, use the existing ID-specific revision-detail route once; for Feedback/Objection during pre-CP2 development, hydrate only the target DGUID(s) from their one or two manifest-declared FED metadata shards. The server may enrich the lightweight row with the target primary/secondary FED lookup so the browser never downloads the full DA profile index merely to locate one target. When CP2's immutable detail route is available, only the geometry provider behind the service changes. The Workspace shell renders immediately, while only the map/content area shows a local spinner until its required detail geometry and map assets are ready.

The current detail chain violates this contract: `WorkspaceReview.jsx` loads the full DA profile index and calls `getWorkspaceSubmissions()` both directly and again through `getWorkspaceSubmission()`. Local measurement returned about 15.9 MB for the profile index and showed that this request alone can consume roughly nine seconds; the duplicate aggregations also read Counter-Proposal revisions with geometry. CP5 removes the duplicate full-list calls and narrows profile/geometry hydration to the selected record. This is a call-graph and select-list optimization, not a new API protocol.

For My Submissions, ownership comes only from the authenticated `/api/submissions/mine` server predicate. The browser applies the Section 6 Pending/Received presentation mapping to the returned raw status; it does not accept an owner ID from the URL or infer state from Archived Tree records.

All normal application loading transitions must be readiness-driven:

- My Submissions, User Submissions, Dashboard, Public User Home, and Workspace map-detail routes replace the translucent fixed-duration overlay with an opaque loading page that remains until the route's required data is ready;
- the timer values in `RouteLoadingOverlay.jsx` are not acceptance signals and must be removed from these routes;
- Workspace root is the exception described above: focused entry renders immediately and background work is local; full entry uses a Workspace-header spinner rather than a route-level loading page;
- errors and empty results terminate loading explicitly and render their own state instead of leaving a timer or spinner running indefinitely.

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

Checkpoint 5 exclusively implements the two required exports, including authorization, selection, serialization, frontend actions, and tests. It does not put export behavior in `workspace.js` or import a CP4 domain service. It reads the existing persistence contract directly under its own server-side authorization.

Add `server/lib/export/exportAuthorization.js`. Its policy derives the authenticated Commissioner profile and canonical PRUID from the server session. Commissioner Submission CSV applies the same visibility predicate and lightweight column allowlist as User Submissions. Archived Tree JSON applies the same one-/two-PRUID visibility rule as an authorized archive read and may include the complete immutable archive snapshots because it is an explicit detail export. Neither endpoint accepts an authoritative profile, owner, or province from the browser.

Implement:

- `GET /api/exports/submissions.csv`: all Commissioner-visible submission rows as a fixed, escaped CSV projection; its only UI entry is the header area of `/dashboard/graphs`, not either Submission Table;
- `GET /api/exports/archive-tree.json`: one JSON document containing all archive branches, versions, immutable snapshots, and audit metadata visible to the Commissioner; its UI entry is the upper-right action on Archived Tree.

There is no Public CSV, Archived Tree CSV, or implicit GeoJSON/ZIP export in this checkpoint. CSV output requires a stable allowlist, UTF-8 handling, RFC 4180 escaping, spreadsheet-formula protection, and no geometry. Archived JSON requires `application/json`, a stable top-level schema/version, deterministic branch/version ordering, and explicit handling for an empty tree.

Target files owned by Checkpoint 5:

- new `server/routes/exports.js`;
- new `server/lib/export/exportAuthorization.js`;
- new `server/lib/export/csvWriter.js`;
- new `src/services/exportApi.js`;
- `src/pages/DashboardGraphs.jsx`;
- `src/pages/ArchivedTree.jsx`.

## 6. Public Status Contract

Checkpoint 5 implements a presentation-only Public User status mapping; it does not require a database `public_status` column or a new CP2 response field:

```text
normalize(raw status) == pending  -> Pending
every other value                  -> Received
```

`MySubmissions.jsx` renders only `Pending` and `Received`. `Received` reuses the current Accepted visual treatment with copy explaining that the submission was received; rejected/resubmit navigation and the Accepted, Rejected, Archived, and Archive Request labels are removed from Public UI. Commissioner views continue to render internal workflow status. This display rule is not an authorization boundary: `/api/submissions/mine` must still enforce session ownership, and no Public UI path links to Archived Tree.

## 7. Workspace and Archived Tree Navigation

Update:

- Submission Table -> focused Workspace carries `location.state.from = /dashboard/submissionsTable`, so the Workspace header returns to User Submissions;
- Dashboard Map Info Panel -> focused Workspace carries `location.state.from = /dashboard`, so the Workspace header returns to Dashboard;
- direct Workspace entry has no `focus`, loads all authorized lightweight rows, and uses the normal dashboard parent;
- Workspace map/detail child -> Workspace, preserving the focused submission context where useful;
- Archived Tree -> Workspace, never Dashboard;
- Archived Difference -> Archived Tree;
- `src/pages/ArchivedTree.jsx` — fixed Back to Workspace button;
- `src/pages/ArchivedDifference.jsx` — Back to Archived Tree;
- `src/components/non_prebuilt/ArchivedTreePanel.jsx` — panel navigation actions;
- `src/pages/Header.jsx` — source-aware Workspace labels and route defaults.

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
4. Add `requireAuth`, role, ownership, and canonical PRUID-set checks to `comment-tags`, submission, workspace, export, archive, and demographic routes; a cross-province resource is authorized for either participating PRUID, never for an unrelated PRUID.
5. Replace `GET /api/comments/proposal/:proposalId`’s stale `profiles!submissions_user_id_fkey` relationship with normal profile hydration.
6. Keep service-role credentials server-only and keep `.env` out of version control.
7. Add migration smoke tests against a disposable Supabase database or SQL Editor verification checklist.
8. Authenticate every WebSocket upgrade, enforce the same role/ownership/PRUID rules as HTTP, validate `Origin`, and verify that logout or a profile-scope change revokes the connection.
9. Audit the outbox/CDC publication grants, retention, replay limits, event payload redaction, connection limits, and multi-instance delivery path before production enablement.

## 10. Test and Acceptance Plan

### API and database tests

- Objection create rejects unknown, inactive, equal, and non-adjacent DGUID pairs.
- Objection detail returns the same immutable geometry after local asset changes.
- Counter-Proposal create/list/detail never exposes geometry from list endpoints.
- Counter-Proposal submit atomically creates its one sealed source revision; Workspace and Archive actions do not create or overwrite another revision.
- Archive merge rejects a missing, mismatched, unsubmitted, or out-of-scope `sourceRevisionId`, and its snapshot is a deep copy of the selected source revision.
- Changing local map assets or the live submission after merge does not alter archived detail/history; archive branch version numbers remain independent of Counter-Proposal revision numbers.
- Merge inserts a new immutable archive version, revert moves only `is_latest`, and tombstone/restore retain a complete audit trail and source records.
- Public list is session-scoped; Public UI maps raw `pending` to Pending and every other status to Received without exposing alternate status actions.
- Commissioner list/detail/export is scoped by membership in the submission's one- or two-PRUID `scope_pruids` set.
- Workspace comments, labels, and label-catalog CRUD writes to Supabase, serializes stable IDs/custom flags, awaits failures, and rejects unauthorized identity changes.
- A hard refresh preserves selected labels and custom catalog text, prevents duplicate label assignment, and deleting one persisted label removes only that label.
- A slow or failed comment/catalog/label write never reports success or clears the draft as though the server committed it.
- Browser `crmp.workspace.v1` content cannot override a newer server status; two Commissioners converge after refetch, focus/visibility reconciliation, or the relevant CP0 invalidation event.
- Archive request requester, assignee, and vote identities are UUID-backed; non-Commissioner, out-of-scope, and stale-assignee mutations are rejected atomically. A two-PRUID archive transition requires an eligible affirmative vote from both participating PRUIDs.
- Commissioner map, submission, Workspace, Archive, heatmap, export, and WebSocket paths allow a cross-province resource to both participating PRUIDs, deny every unrelated PRUID, and never disclose its metadata outside that scope set.
- Archive delete is recoverable under the chosen tombstone policy.
- Demographic statistics return the compact Section 8 projection with source, census year, suppression, and unavailable-value metadata; they do not call the external source per request.
- Every committed create, update, and delete/tombstone writes exactly one replayable realtime event; rolled-back transactions write none.
- Two authenticated WebSocket clients in the same authorized scope converge after each mutation without manual refresh.
- Public-user, cross-owner, cross-role, and out-of-scope WebSocket connections neither receive nor infer unauthorized events; each participating province receives the same cross-province event at most once.
- Disconnect/reconnect, duplicate delivery, out-of-order delivery, and `resync-required` paths converge to the HTTP source of truth.

### Frontend tests

- Public and Commissioner tables preserve their current client pagination/UI while one lightweight, geometry-free response replaces the legacy aggregate.
- Focused Workspace renders the exact-ID branch before its one background full lightweight request completes; only the focused branch's `Show More` state and all branch statistics update afterward.
- Normal Workspace entry loads the full lightweight set with a header spinner; focused entry and map/detail child never block the entire route with a fixed-duration overlay.
- Workspace map/detail reads one target and its required FED shard(s), and never performs two full Workspace aggregations or downloads the complete DA profile index.
- Counter-Proposal handles have uniform density and locked endpoints.
- Dragging remains responsive while worker validation runs.
- Invalid geometry reverts to the last valid position.
- Public users cannot see Archive Tree statuses or routes.
- A Commissioner can click, hit-test, query, and export a cross-province resource only when their PRUID is one of its two canonical scopes; an unrelated province cannot discover it.
- Toggle changes are stable and do not blink or repaint every FED repeatedly.
- Workspace returns to User Submissions or Dashboard according to its entry source; map/detail returns to Workspace; Archived Tree returns to Workspace; Difference returns to Archived Tree.
- Commissioner CSV is available only from Graphs and excludes geometry; Archived Tree exports one authorized, complete, deterministically ordered JSON document.
- Realtime create/update/delete events invalidate only affected lightweight lists, branch statistics, details, heatmap counts, and archive branches.
- Connection state, reconnect, optimistic reconciliation, logout teardown, and forced resync are visible and deterministic.

### CRUD and realtime acceptance matrix

Checkpoint 0 owns a living integration matrix for every durable Demo 4 domain resource. Each applicable cell must verify HTTP authorization, committed database state, the initiator response, delivery to a second authorized WebSocket client, targeted cache invalidation/refetch, and non-delivery to unauthorized clients.

| Resource | Create | Read | Update | Delete/recover | Required realtime effect |
| --- | --- | --- | --- | --- | --- |
| Feedback / Objection / Counter-Proposal submissions | submit | owner projection; scoped Commissioner projection/detail | allowed lifecycle/status/revision operations | owner delete where policy permits; otherwise explicit rejection/tombstone | owner projection, province Workspace/table, InfoPanel, and heatmap invalidate |
| Objection / Counter-Proposal revisions | create atomically | authorized immutable detail | reject in-place mutation; create a new revision | reject physical delete except controlled retention policy | affected detail/version history and archive source choices invalidate |
| Workspace comments | `POST` | `GET` | `PATCH` by authorized policy | `DELETE` by authorized policy | open review panels and branch statistics invalidate |
| Workspace labels | `PUT`/add | `GET` | replace/update | remove one/all under policy | open review panels, branches, and branch statistics invalidate |
| Workspace label catalog | create | list | rename/recolor | delete only when policy permits | all same-province Workspace label pickers invalidate |
| Workspace archive requests | create | scoped read | assignees, UUID-keyed votes, state transitions | cancel/tombstone | request panel, submission status, branch statistics, and assignee clients invalidate |
| Submission Workspace status | status transition | scoped lightweight list/detail | subsequent valid transition | archive cleanup/tombstone semantics | Workspace branches, tables, public list, InfoPanel, and heatmap invalidate |
| Archive tree | merge | scoped tree/detail/history | revert/latest and restore | tombstone and recovery | archive branches, source Workspace rows, map effect, and exports invalidate |

Read-only capability, heatmap, statistics, and export endpoints do not invent CRUD operations; they are included as authorized refetch targets after source mutations. Immutable resources explicitly test that unsupported update/delete calls are rejected rather than silently mutating history.

Existing regression commands remain required:

```text
npm run check:server
npm test -- --runInBand
npm run build
git diff --check
```

## 11. Implementation Checkpoints

Priority is intentionally embedded in Checkpoints 1-8. A later feature checkpoint must not be treated as complete when its prerequisite checkpoint has unresolved data-contract or authorization failures. Checkpoints 1 and 2 may develop in parallel under the Section 3.0 frozen contract; Checkpoint 2 may run against doubles but cannot be accepted until the Checkpoint 1 migration/security integration gate passes. Checkpoint 5's direct-select list, Workspace CRUD/UX, navigation, loading, and export work does not wait for a CP2 Projection Table or Summary API. Checkpoint 0 is the cross-cutting acceptance gate applied throughout that sequence.

### Checkpoint 0 — P0: Cross-cutting CRUD and WebSocket acceptance gate

Own the generic realtime platform and its standing acceptance gate, as specified in Sections 2.5 and 3.6. Consume—do not create—the Checkpoint 1 outbox/delivery migration. Implement the authenticated WebSocket gateway, durable dispatcher/replay path, server-derived user/role/PRUID channels, shared client reconnect/deduplication/resync behavior, event-envelope validation, invalidation registry, and reusable disposable-database/two-browser CRUD matrix. Do not add domain tables, policies, grants, RPCs, or mutation-specific outbox inserts.

Checkpoint 0 is a standing release gate rather than a prerequisite claim that all domain implementations already exist. Checkpoints 2, 3, 4, and 5 add their own atomic outbox/delivery writes and matrix rows for the mutations they own; CP5 also adds table/Workspace invalidation mappings. CP0 remains open while any applicable CRUD cell is missing, while a mutation can commit without its domain event, while a replay/resync path fails, or while HTTP and WebSocket authorization differ.

**Exit criteria:** the generic gateway/dispatcher/client/harness pass independently against synthetic contract events; every implemented domain mutation writes one logical replayable event and one delivery per authorized PRUID in its transaction; two authorized clients converge without manual refresh; reconnect/resync converges to the HTTP source of truth; cross-province resources converge for each participating scope; and public, cross-owner, cross-role, and out-of-scope clients receive neither unauthorized records nor event metadata.

### Checkpoint 1 — P1: Freeze the database contract and security boundary

Implement the schema and access boundary defined in Sections 2.2–2.5 and the deployment controls in Section 9. This checkpoint freezes contracts and creates safe route boundaries; it does not claim to complete the immutable submission behavior in Checkpoint 2, Workspace behavior in Checkpoint 3, Archive behavior in Checkpoint 4, or table/client loading behavior in Checkpoint 5.

Under Section 3.0, this checkpoint is the platform workstream. It explicitly owns the Section 3.2.1 production-schema audit and the persistence-side fail-closed contract, but it does not implement the Public User capability flow, submission business handlers, or submission route behavior.

1. **Schema, migration, and backfill contract.** Create/alter the following as versioned Supabase migrations:
   - `submissions` plus a normalized immutable `submission_scope_pruids(submission_id, pruid)` relation (or equivalent): canonical type/status constraints, owner reference, primary/secondary DGUID/FED fields, one- or two-PRUID source-scope support, and timestamps;
   - `objection_revisions` and `counter_proposal_revisions`: immutable snapshot foreign keys, revision numbers/status where applicable, baseline/validation metadata, author/timestamps, uniqueness constraints, and indexes required by the Sections 2.2–2.3 detail contracts;
   - `workspace_comments`, `workspace_labels`, `workspace_label_catalog`, `workspace_archive_requests`, and a UUID-keyed archive-request vote relation: foreign keys, state/check constraints, updater/requester/assignee/voter identity fields, timestamps, and the indexes used by Workspace record/list reads;
   - `archive_tree`: source submission/revision linkage, immutable `submission_snapshot`, branch/version/latest markers, merge/revert/tombstone/restore audit fields, indexes, and constraints required by Sections 3.4–3.4.2;
   - `realtime_outbox` plus `realtime_scope_deliveries`, or the approved equivalent CDC schema from Section 2.5, including event ID, aggregate/version, PRUID scope, per-scope replay sequence, dispatch state, retention, and idempotency indexes.

   Backfill existing rows only from deterministic canonical sources. Record and quarantine rows whose DGUID, province, owner, source revision, or archive linkage cannot be proved; do not invent values to make a migration succeed. Apply the migration both to an empty disposable database and to a copy/backup of the current target data before production rollout.

2. **RLS, grants, RPCs, and server-only data access.** For every new or altered table, document whether browser access is prohibited or allowed by a precise RLS policy. Grant archive, revision, outbox, and administrative RPCs only to the intended server role; revoke `anon`/`authenticated` execution unless a route explicitly needs direct database access. Use the service-role data client only after Express has authenticated and authorized the request; do not treat an anonymous/publishable Supabase client as a server data client. Verify that service-role credentials never reach the browser or committed configuration.

3. **Interface and route-boundary definition only.** Commit the Section 3.0 contract artifact and provide repository/MapAuthority test doubles. Define the route catalogue, router registration order, common conflict/validation/unauthorized/not-found envelopes, and the rule that verified `user`, `profile`, and canonical scope—not route parameters or query strings—are passed to domain services. `server/routes/submissions.js` and its detail/write handlers are exclusively CP2; `server/routes/submissionLists.js` and its static/list handlers are exclusively CP5 and are mounted first. `server/routes/workspace.js` is composition-only, with CP3 status, CP4 archive/request, and CP5 collaboration handlers in separate modules. The legacy `server/routes/comments.js` remains only a feedback compatibility adapter. Record removal of obsolete DGUID foreign-key assumptions and repair of the stale `profiles!submissions_user_id_fkey` relationship as migration/compatibility requirements, not handler edits in this checkpoint.

4. **Migration/security verification harness.** Add the disposable-Supabase (or equivalent isolated database) harness for fresh schema application, safe existing-data upgrade, expected tables/columns/indexes/constraints, RLS probes as anonymous/public user/Commissioner/service role, RPC-grant probes, rollback rehearsal, and interface-double compatibility checks. It must not claim Checkpoint 2's immutable geometry, capability, or submission route behavior has been implemented.

5. **Enabled-FED Counter-Proposal platform remediation.** Execute the Section 3.2.1 Supabase audit before the migration is accepted. Export and review the live `submissions` and revision-table constraints, defaults, foreign keys, indexes, triggers, RLS policies, views, and RPCs for Yukon/`60001` literals or dependencies on legacy Supabase map metadata; replace each confirmed restriction with a versioned, rollback-tested migration rather than assuming the checked-in migrations are the full baseline. Define and test the database invariants for one- or two-PRUID scope persistence, but leave missing-manifest behavior, MapAuthority/capability behavior, and all Enabled-FED submission route tests to Checkpoint 2. Supply the disposable database and fixtures needed for the later joint integration run.
6. **Optional P3 physical workflow split.** Only after the required contracts are stable, the team may split legacy Feedback, Objection, and Counter-Proposal comments/submissions into three physical workflow tables. This is a schema-maintenance enhancement, not an acceptance dependency; direct typed-table reads plus immutable revision tables are sufficient for Demo 4.

**Exit criteria:** the Sections 2.2–2.5 and Section 9 contracts are represented by an auditable target schema; each table/RPC has an explicit browser/server access boundary; deterministic backfill and rollback/restore procedures have been rehearsed; router ownership and common response contracts are established; and the Section 10 migration/database smoke tests pass.

### Checkpoint 2 — P1: Make submission geometry immutable and complete authorized detail/write behavior

Under the Section 3.0 frozen contract, implement application behavior only; do not create/alter tables, policies, grants, RPCs, or migration files. Implement `server/routes/submissions.js`, submission domain/repository adapters, the MapAuthority capability endpoint, and the local-authority Objection/Counter-Proposal transaction flow. Use the Checkpoint 1 schema names, scope relation, revision/outbox transaction boundary, authorization inputs, and error/projection envelopes without redefining them.

1. **Submission API behavior.** Implement the Section 3.1 Objection/Counter-Proposal create and authorized geometry-detail handlers, preserve static route ordering, and use the legacy comments route only for its scoped feedback compatibility role. CP2 does not build a Projection Table, `SubmissionProjectionV1`, cursor protocol, Workspace Summary, table cache, loading refactor, or export route. CP5 owns the Section 3.1.1 direct-select table reads and must keep them geometry-free.
2. **Capability and local authority.** Implement `GET /api/map/capabilities` and use the same MapAuthority in Public User Step 1/2 gating and every submission write. Resolve DGUIDs through the local profile index and manifest-declared metadata, construct one- or two-PRUID scopes, validate adjacency/topology, derive FED/baseline values server-side, and fail closed for missing or stale authority data. Remove the Yukon-only fallback behavior described in Section 3.2.1.
3. **Transactional persistence adapter.** Implement the repository operations against the Checkpoint 1 schema so each validated create atomically writes the submission, immutable revision, `submission_scope_pruids`, and required outbox record. Until the Checkpoint 1 migration is available, run the identical domain/handler suite against the frozen repository doubles; do not introduce an alternate temporary schema.
4. **Enabled-FED and integration tests.** Build the non-mutating capability audit and the submission test suite for every Enabled FED, including one valid cross-province adjacent pair with both canonical PRUIDs, and the missing/stale-manifest, missing-metadata, disabled-FED, unknown/non-adjacent pair, and mismatched `fed_num`/scope negatives. After Checkpoint 1 delivers its disposable-database migration, run the same authenticated route/database suite against it and resolve only contract violations through the Section 3.0 change process.

**Exit criteria:** the Checkpoint 2 implementation passes its MapAuthority/domain/handler suite against contract doubles; the joint disposable-database suite passes after Checkpoint 1 migration integration; Objection and Counter-Proposal detail pages replay their submitted geometry after local assets change; every Enabled FED has capability coverage; and the behavior introduces no schema, policy, grant, RPC, migration, Projection Table, cursor, or Workspace Summary change.


### Checkpoint 3 — P1: Establish durable Workspace status and authenticated base APIs

Implement the Section 3.3 durable base: authenticated Workspace route registration, Supabase-backed non-archive submission status transitions, and the initial server reads/writes over the existing Workspace tables. Status transitions persist independently of a browser session and insert their CP0 outbox/delivery rows atomically. This checkpoint does not define a Workspace Summary API or table-facing projection/cache protocol.

**Exit criteria:** authenticated base routes are registered; permitted non-archive Workspace status transitions are durable and reject invalid transitions; reads reproduce the committed status in a clean browser session; and every CP3-owned status mutation creates its required outbox/delivery rows. CP4's province scope guard and CP5's CRUD/browser-authority work have their own exit criteria.

### Checkpoint 4 — P1: Archived Tree, Archive Request, and Commissioner scope integrity

Implement the Archived Tree contract in Sections 3.4 and 3.4.1, and the Section 3.4.2 Archive Request scope guard, target API, client API, response model, UUID identity/state machine, and Commissioner province isolation. Counter-Proposal submit creates the sealed source revision in Checkpoint 2; Checkpoint 4 selects that existing revision explicitly during merge and atomically copies it into a new immutable `archive_tree` version. Implement `server/lib/authorization/resourceScopeGuard.js`, `server/lib/archiveRequests/`, authenticated Archive Request routes, `src/services/archiveRequestApi.js`, `ArchiveRequestReadModelV1`, server-derived PRUID checks across Commissioner map/submission/Workspace/Archive/heatmap paths, branch latest/revert semantics, recoverable tombstone/restore, complete audit metadata, scoped archive reads, and CP0 outbox delivery writes.

**Exit criteria:** the Sections 3.2, 3.4.1, and 3.4.2 contracts and their Section 10 tests pass: archived detail/history replay the selected immutable source snapshot after live map/submission changes; Counter-Proposal revision count is unchanged by archive actions; Archive Request API/state transitions and `ArchiveRequestReadModelV1` use authorized UUID identities; each participating Commissioner scope can read/subscribe to a cross-province resource, a two-PRUID archive transition has the required approval from both scopes, and an unrelated province cannot read, mutate, hit-test, or subscribe; branch versions, merge, revert, tombstone, and recovery preserve a complete audit trail without browser state; and every C4 mutation writes its CP0 delivery rows.

### Checkpoint 5 — P2: Deliver progressive list, Workspace, and navigation UX

Implement Sections 3.1.1, 3.3, 3.5, 4.1, 5, 6, and 7 plus their Section 10 tests. Add explicit geometry-free direct selects for Public and Commissioner tables while preserving their current client pagination and UI. Apply Public ownership on the server and the Pending/Received status mapping in `MySubmissions.jsx` only.

Complete reliable comments, labels, and label-catalog CRUD: serialize stable `id` and `is_custom`, use `Custom Label 1`, `Custom Label 2`, and `Custom Label 3` as the default custom slots, persist catalog edits, prevent duplicate assignment after refresh, delete only the selected persisted label, await every mutation, and reconcile from server state. Remove `crmp.workspace.v1` and browser-event/temporary overrides as Workspace authorities; refetch on writes and lifecycle/CP0 invalidation triggers. Add the corresponding mutation-specific CP0 outbox/delivery writes without implementing the CP0 transport.

Implement focused Workspace exact-ID-first rendering, one background full lightweight refresh, normal full-entry header loading, target-only map/detail hydration, source-aware navigation, readiness-based opaque loading pages, Commissioner CSV from `/dashboard/graphs`, and complete Archived Tree JSON from its upper-right action. Do not create a Projection Table, Workspace Summary API, cursor protocol, mock source switch, or persistent query cache.

**Exit criteria:** the geometry-free table response and Section 6 Public status tests pass while existing table pagination/styles remain unchanged; hard refresh preserves label selection/custom text and cannot create duplicates; one persisted label can be deleted without deleting another; slow/failed comment and catalog writes remain recoverable; browser storage cannot override a newer Commissioner status; and two authorized Commissioners converge through authoritative refetch/CP0 invalidation. Focused Workspace renders the exact row before the background list, map/detail performs no duplicate full aggregation or full-profile download, loading is readiness-driven, all return paths match Section 7, Commissioner CSV and Archived Tree JSON obey their server authorization, and every CP5-owned mutation writes its CP0 delivery rows.

### Checkpoint 6 — P2: Refactor Counter-Proposal editing and map presentation

Implement the editing contract in Section 4.2, the rollout presentation plan in Section 4.3, and the corresponding Section 10 frontend tests. Use uniformly sampled UI handles, locked endpoints, local-first drafts, worker-based JSTS/impact validation, and final server validation only on commit. Update MapLibre source data without rebuilding layers. Replace rollout blinking/feature-state loops with stable filters or paint expressions, then complete responsive, loading, status, and remaining map UX regression fixes.

**Exit criteria:** the Section 4.2/4.3 behaviors and Section 10 frontend tests pass: dragging is responsive on complex boundaries, invalid positions revert predictably, and the Enabled/Data Blocked toggle does not visibly blink or stall.

### Checkpoint 7 — P3: Add demographics and presentation metadata

Implement the versioned ETL, compact statistics API, and presentation contract in Section 8, comply with the route boundary in Section 9, and add the Section 10 statistics test. Build the versioned Statistics Canada ETL and DA statistics API, then render demographic source, census year, suppression, and missing-value states in `UserViewStatistics.jsx`. Resolve smaller UI/UX regressions discovered after the P1/P2 architecture is stable.

**Exit criteria:** the Section 8 contract and its Section 10 test pass: Statistics are served from the project data store rather than per-click external calls, and every shown value is attributable to a source and vintage.

### Checkpoint 8 — Release verification and documentation synchronization

Run the API/database and frontend acceptance suite in Section 10, verify production migrations and policies, and refresh Demo 3 historical documentation only when the new contracts are deployed and stable.

**Exit criteria:** `npm run check:server`, tests, build, and `git diff --check` pass; production configuration has been verified by the project owner.
