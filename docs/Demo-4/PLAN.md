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
scope_pruids              # CP4-derived eligibility set: one PRUID normally; two for a cross-province pair
latest_revision_number
```

The projection must not contain `original_geometry`, `proposed_geometry`, `shared_boundary`, or any other large GeoJSON value.

This list projection is an API response shape, not a PostgreSQL projection table, materialized view, cursor adapter, or write/detail repository abstraction. Its implementation uses an explicit Supabase `.select(...)` column list and normal server-side role/ownership checks.

**Detail snapshot** (one record at a time, authorized):

```text
submission
  id, type, title, comment, author, status, timestamps
  primary_dguid, secondary_dguid, primary/secondary FED and CP4-derived immutable PRUID eligibility set
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

### 2.3 Counter-Proposal minimum persistence

The minimum Counter-Proposal submission persistence needed to reproduce an authenticated-owner detail contains canonical primary/secondary DGUID and FED fields, original and proposed geometry, shared/outer boundaries, baseline reference, validation report, author, and timestamps. The submission and detail record are written atomically. Browser-supplied geometry, FED, baseline, author, or ownership values are never authoritative.

For P1, one immutable submitted detail is sufficient. In-place geometry mutation, implicit re-submission, and reconstruction from a current map asset are prohibited. Richer revision history or an explicit future re-submission lifecycle is Priority 2.

The existing list route must select revision metadata only. A detail route selects full geometry.

### 2.4 Workspace tables

Connect the existing tables through Commissioner-only server routes:

| Table | Required durable content |
| --- | --- |
| `workspace_comments` | submission, author profile ID, text, action, closing flag, timestamps |
| `workspace_labels` | submission, label name/color, custom flag, updater, timestamps |
| `workspace_archive_requests` (CP4) | operating PRUID, requester, same-province assignee profile IDs, UUID-keyed votes, claim/version, state, timestamps |
| `archive_tree` (CP4) | immutable archive-source snapshot, branch/version/latest flags, merge/revert/delete audit fields |

Emails are display projections. Identity, assignees, votes, and authorization use profile UUIDs.

Physical splitting of Feedback, Objection, and Counter-Proposal into three workflow tables is discarded from the Demo 4 delivery path. One typed `submissions` table plus the required snapshot/detail persistence is sufficient.

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
  operating_pruid text null
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

Checkpoint 4 owns these migrations, constraints, indexes, retention, recovery queries, and server-only grants as an independent P1 deliverable. A domain mutation inserts one logical `realtime_outbox` event and the delivery rows allowed by its workflow in the same database transaction. Rolled-back writes emit no event. For a CP4 cross-province operation, `scope_pruids` records the resource eligibility set for audit, but `realtime_scope_deliveries` contains only the acting request's `operating_pruid`; the other participating province is not a collaborator in that request and receives no live workflow event. Events contain identifiers, versions, scope, and cache/projection hints only; comments, profile details, full submission bodies, and GeoJSON are fetched afterward through the normal authorized HTTP read endpoint.

Checkpoint 0 partially depends on CP4: it consumes, but does not create, CP4's outbox/delivery schema and CP4's mutation-to-event mappings. CP0 owns dispatch, WebSocket transport, replay/resync, and the CRUD/realtime acceptance matrix; it does not invent a domain event. Participating Workspace and archive mutations insert their allocated events once the shared event store is available, and table/Workspace clients register their invalidation consumers. Submission persistence and submission behavior remain outside that implementation dependency. Delivery is at-least-once. Consumers deduplicate by event ID, ignore older resource versions, and refetch the authoritative HTTP result. A reconnect replays retained deliveries for the connection's derived PRUID or sends `resync-required`, after which the client invalidates and refetches scoped queries.

## 3. Target API and Service Architecture

### 3.0 Checkpoint 1/2 parallel delivery contract

Checkpoint 1 and Checkpoint 2 may proceed in parallel only after a short, versioned interface freeze is reviewed and committed. This is a contract artifact, not a third implementation checkpoint: it records the agreed names, types, invariants, request/response projections, and error codes before either workstream begins. A contract change requires joint review and an incremented contract version.

The frozen interface contains:

```text
Persistence schema owned by Checkpoint 1
  submissions; objection_revisions; counter_proposal_revisions;
  indexes, constraints, RLS/grants

Domain ports consumed by Checkpoint 2
  SubmissionRepository.createObjection(input, actor)
  SubmissionRepository.createCounterProposal(input, actor)
  SubmissionRepository.getDetail(submissionId, actor)
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

The contract fixes only canonical primary/secondary DGUID and FED fields, the minimum Objection snapshot and Counter-Proposal detail records, authenticated-owner detail behavior, and standard validation/conflict/not-found response shapes. The browser never supplies an authoritative owner, persisted geometry snapshot, revision, or derived FED.

Parallel ownership is strict:

- **Checkpoint 1** creates and verifies the database migrations, RLS/grants, service-role boundary, backfill/rollback procedure, and disposable-database schema/security harness. It provides fixtures and repository-interface test doubles, but does not implement submission business handlers, capability logic, or route tests that require real submission behavior.
- **Checkpoint 2** implements `server/routes/submissions.js`, its domain/repository adapters, map-capability endpoint, local-authority validation, transactional submission behavior, and submission API tests against the frozen interfaces. It does not create/alter tables, policies, grants, RPCs, or migration files.

Each workstream may use its own branch and test doubles. The only synchronization points are: (1) contract freeze, (2) applying Checkpoint 1 migrations to the disposable database and replacing Checkpoint 2 doubles with the production persistence adapter, and (3) running the combined route/database suite. A failure at integration is assigned to the owner of the violated frozen contract, not solved through ad-hoc cross-checkpoint schema or route edits.

### 3.1 Submission write and detail routes

The CP1/CP2 contract exposes only the routes required by the two P1 submission behaviors:

```text
POST  /api/submissions/objections
POST  /api/submissions/counter-proposals
GET   /api/submissions/:submissionId
GET   /api/map/capabilities
```

The dedicated Objection route atomically persists its GeoJSON snapshot. The Counter-Proposal route uses the same local authority and supports every Enabled DA. The P1 detail contract derives the owner from the authenticated session and returns persisted geometry only after that ownership check; it never reconstructs an Objection from current local metadata. Browser-supplied owner, geometry authority, FED, or baseline values are non-authoritative.

The legacy generic comments adapter, heatmap route, broader service-file decomposition, optional response enrichment, and compatibility cleanup are Priority 2. They must not change or block the P1 write/detail contracts.

#### 3.1.1 Checkpoint 5 direct-select list contract

Checkpoint 5 implements list reads with a small explicit Supabase `.select(...)` allowlist. It does not create a Projection Table, materialized view, mock/backend source switch, cursor envelope, or write/detail table adapter. The HTTP response contains `items` plus normalized `appliedFilters`; the client service unwraps `items` into the ordinary array expected by the unchanged React Table components.

The minimum selected database fields are:

```text
id, user_id, type, fed_num, dguid, neighboring_dguid,
title, status, created_at, updated_at
```

The server may add only the display values already required by the current UI, such as a batched `profile.email` and `dissemination_areas.community_name`. It must never select or serialize `geometry`, `original_geometry`, `proposed_geometry`, full revisions, private comments, shared boundaries, outer boundaries, or validation reports for a list request. Counter-Proposals come from the same `submissions` select and are not fetched again through the revision-detail route.

The optional list filters remain normalized consistently: `query` is trimmed, internal whitespace is collapsed, and limited to 100 Unicode code points; `createdFrom` and `createdTo` accept `YYYY-MM-DD` and use UTC day boundaries; type/status/sort values are allowlisted. Authorization and owner predicates run before filtering and before any present or future pagination. `appliedFilters` echoes the normalized values actually used. These filters are conveniences for the direct select, not a cursor protocol, and the current client continues to paginate `items` locally.

The direct-select work tests its field allowlist, owner/role behavior, exact-ID filter, response size, stable sort, absence of GeoJSON, and compatibility with the unchanged Public and Commissioner table components. It does not alter the submission write/detail contract in Section 3.1.

### 3.2 Capability and local map authority

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
  "reason": null,
  "baselineRevision": "..."
}
```

Use the same function in:

- `src/pages/UserHome.jsx` Step 1/Step 2 gating;
- `src/components/non_prebuilt/MapInfoPanel.jsx` activity availability;
- `server/lib/map/mapAssetAuthority.js`;
- Objection and Counter-Proposal write validation.

Do not add a Yukon-only special case. If any DA contained in the Enabled FED assets is unavailable, report the missing manifest, profile, metadata feature, adjacency, or pair capability explicitly.

#### 3.2.1 Counter-Proposal Enabled-DA rollout incident: diagnosis and remediation

The observed symptom is that a Public User can submit a Counter-Proposal for Yukon FED `60001`, but not for DAs in other Enabled FED assets. The current repository evidence separates the likely causes:

- the canonical local `da_asset_manifest.json` contains 120 Enabled FED asset containers across NL, PE, MB, SK, AB, BC, and YT, and each declared metadata file is present; the server-side `loadPairObjectionIndex` / `prepareCounterProposalSubmission` path reads that local profile index and FED metadata rather than a Supabase map table. Read-only representative pair validation succeeds for one FED in each of those seven provinces, but this does not prove that every contained DA and declared adjacent pair is usable;
- the client nevertheless starts with a Yukon-only fallback manifest when `/api/map/assets/manifests/da_asset_manifest.json` cannot be loaded. In addition, `getMetadataGeojsonPathsForFed` currently returns the first manifest asset when the requested FED is absent. In a Yukon-first fallback (or a stale/incomplete manifest), that silently substitutes `fed_60001.geojson` for another FED instead of producing a diagnosable unavailable state. This is a confirmed Yukon-only failure path;
- the checked-in migrations do not constitute an inspectable baseline definition for every pre-existing `submissions` constraint, trigger, view, RPC, and policy. The current target database has only Yukon Counter-Proposal rows, which proves the production symptom but cannot prove or rule out an untracked Yukon-only database restriction. It must therefore be inspected before declaring the rollout fixed.

Under the Section 3.0 parallel contract, Checkpoint 1 provides the clean, secure persistence boundary while Checkpoint 2 implements the canonical capability/write path against contract doubles. The responsibilities are:

1. **Checkpoint 2 — fail closed on map authority.** Remove the Yukon-only operational fallback. If the canonical manifest, requested FED entry, DA profile, metadata feature, or declared adjacency is unavailable, return an explicit `available: false` capability reason and disable editing/submission; never substitute another FED's metadata. An offline fixture cannot enable a deployed flow.
2. **Checkpoint 2 — make local assets the sole geographic authority.** Resolve both DGUIDs and their FED metadata from the canonical local index, load only manifest-declared assets, validate the pair, and derive FED/baseline values on the server. Capability gating and submission use the same authority result.
3. **Checkpoint 1 — remove database rollout blockers.** Audit live submission/revision constraints, defaults, foreign keys, triggers, views, RPCs, policies, and grants for Yukon/`60001`, obsolete metadata relations, or discarded schema dependencies. Replace confirmed blockers with rollback-tested migrations that accept every locally Enabled DA while retaining server validation.
4. **Checkpoint 2 — prove every Enabled DA.** Exhaustively verify that every DA contained in Enabled FED assets has a canonical profile, correct FED mapping, a matching metadata feature, and a consistent adjacency entry. Validate every declared adjacent pair through the capability domain. Run representative authenticated database writes for every Enabled FED plus cross-FED/cross-province and edge cases, rather than creating a production-like row for every pair. Negative cases cover stale/missing manifest data, missing DA features, disabled FEDs, unknown/non-adjacent pairs, and mismatched browser FED values. Record the exhaustive DA/pair result and deployed manifest version/hash.

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

There is no required Workspace Summary API, `WorkspaceSummaryV1`, branch cursor, or submission write/detail projection dependency. Workspace list and branch statistics reuse the lightweight submission selects. A direct Workspace entry loads the complete lightweight array; a `?focus=<submissionId>` entry first performs the exact-ID lightweight select, renders that branch immediately, and then refreshes counts and branch rows from the background full lightweight request.

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

### 3.4 CP4 independent scope, Archive Request, and Archived Tree service

Checkpoint 4 owns its complete database, authorization, API, client, and test boundary. It independently creates its scope/archive/vote/outbox migrations and sealed archival `sourceRevisionId`. Delivery is divided into three explicit bullet points:

Its P1 schema contains an immutable primary/secondary PRUID eligibility relation (`submission_scope_pruids` or an Archive-domain equivalent), `archive_source_revisions`, `workspace_archive_requests`, normalized UUID-keyed votes/state transitions, optimistic claim/version fields, `realtime_outbox`, and `realtime_scope_deliveries`. The optional P2 schema adds or refactors `archive_tree` source linkage, immutable copied snapshots, branch/version/latest flags, and recovery audit fields.

1. **Priority 1 — Commissioner province scope refactor.** Build the reusable server-side scope guard, immutable one-/two-PRUID eligibility relation, first-commit claim, same-province operating context, cross-province warning projection, and non-disclosing unrelated-province denial defined in Section 3.4.2.
2. **Priority 1 — complete Archive Request state machine.** Build the UUID identity model, same-province requester/assignee/vote rules, transactional state transitions and optimistic conflicts, CP4-owned sealed archive source, authenticated API/client read model, and all required CP0 outbox/event reports and tests defined in Section 3.4.2.
3. **Priority 2 — Archived Tree archive/delete refactor.** Starting from the existing minimum runnable skeleton, build the CP4-owned backend/routes/schema for archive merge, immutable branch versions, revert/latest, recoverable tombstone/restore, and audit history defined in Section 3.4.1. This bullet is optional as a whole. If deferred, incomplete controls/routes must not be exposed and the existing supported tree behavior must remain stable. Any portion delivered must be completed end-to-end and covered by tests; it must not be left in a runtime-error or half-migrated state. Exact performance and non-safety workflow refinements are best effort and need only be reasonable.

Priority 1 is mandatory, including CP0 realtime reporting and the acceptance tests for every P1 mutation. Priority 2 must never regress the rest of the application; if any P2 mutation is shipped, its corresponding API, persistence, authorization, failure behavior, and CP0 test matrix row are mandatory for that shipped portion.

#### 3.4.1 Priority 2 — Archived Tree snapshot and version contract

Target routes, implemented only as completed end-to-end P2 slices, are:

```text
POST   /api/workspace/archive
       { submissionId, archiveRequestId, closingComment, expectedResourceVersion }
GET    /api/workspace/archive?cursor=&branchKey=
GET    /api/workspace/archive/:archiveVersionId
PATCH  /api/workspace/archive/branch/latest
DELETE /api/workspace/archive/branch       # tombstone, not physical delete
POST   /api/workspace/archive/branch/restore
```

The CP4 transaction locks the resource, validates the acting request and expected version, and creates or selects the CP4-owned sealed archive source. Its server-generated `sourceRevisionId` is returned for audit but is never supplied as an authoritative browser choice. The transaction copies—not references—the source into `archive_tree.submission_snapshot`. Feedback and Objection use the same CP4 snapshot contract.

```text
existing authoritative submission/detail persistence
  -> CP4 scope guard and first-commit claim
  -> CP4 seals archive_source_revisions sourceRevisionId
  -> CP4 archive merge copies the sealed source
  -> immutable archive_tree version snapshot
```

`archive_tree.submission_snapshot` contains the submission projection plus a copied `source_revision` object with `id`, `revision_number`, `primary_dguid`, `secondary_dguid`, immutable `scope_pruids`, `baseline_revision`, `original_geometry`, `proposed_geometry`, `shared_boundary`, `outer_boundary`, `validation_report`, `created_by`, and `created_at`. Archived Tree detail/history reads this copied snapshot only; it never rehydrates geometry from the current map asset or live submission.

Archive branch versions are independent historical records: a merge inserts a new row and changes the latest marker without overwriting an older snapshot; revert moves only the latest marker and records actor/time; tombstone retains every version and source record with reason/actor/time; restore records its actor/time. Each shipped mutation atomically updates the archive state and writes its CP0 event. A skipped P2 capability is hidden/disabled rather than routed to an unfinished handler.

#### 3.4.2 Priority 1 — province isolation and Archive Request state machine

The server resolves the authenticated Commissioner's canonical `PRUID` and independently derives the target's eligibility set from canonical DGUID/FED data. The browser cannot provide an authoritative province, scope, operating PRUID, profile UUID, assignee UUID, vote identity, source contents, or state transition.

For a same-province resource the sole eligible PRUID is the operating scope. For a cross-province boundary both canonical provinces are eligible, but they do not form one collaborative Workspace:

- either province may see the resource and attempt the same operation;
- the first state-changing transaction claims the resource for its server-derived `operating_pruid`; a concurrent or later incompatible claim uses a row lock plus expected version and returns `409 RESOURCE_ALREADY_CLAIMED` or `409 STALE_RESOURCE_VERSION`;
- the claim is scoped to that operation, not permanent provincial ownership: a cancelled/rejected request releases its active claim atomically, while a successful operation advances the canonical resource version; either eligible province may attempt a later operation against that new version;
- requesters, assignees, voters, Workspace membership, comments, and workflow notifications remain within that operating province; no member is imported from the other province and no two-province vote or approval is required;
- each P1 outbox event records the full eligibility set for audit but creates a realtime delivery only for the `operating_pruid`; the other eligible province learns the committed canonical result through a later authorized HTTP refetch or receives a conflict when it attempts a stale mutation;
- the application does not arbitrate a policy dispute between the two provinces. Commissioners resolve such disputes outside this application;
- every affected Commissioner UI renders a red warning using the canonical names: `You are processing a boundary between {Province A} and {Province B}.`

Archive requests use profile UUIDs end-to-end. `requester_id`, every `assignee_id`, and every UUID-keyed vote must resolve to an active Commissioner in `operating_pruid`; emails are display projections only. Prefer a normalized vote relation with unique `(request_id, voter_id)` and an explicit request `version`. The state machine must enumerate legal transitions, for example `open -> approved | rejected | cancelled` and `approved -> consumed`; assignee/vote changes occur only in the allowed state, terminal states reject further mutation, repeated identical commands are idempotent, and assignee replacement plus invalid-vote removal is atomic. Approval/quorum, when required by the chosen workflow, is satisfied only by eligible members of the same operating province.

Checkpoint 4 owns these authenticated routes:

```text
GET    /api/workspace/archive-requests/:submissionId
POST   /api/workspace/archive-requests
PATCH  /api/workspace/archive-requests/:requestId/assignees
POST   /api/workspace/archive-requests/:requestId/votes
DELETE /api/workspace/archive-requests/:requestId
```

`ArchiveRequestReadModelV1` contains `id`, `submissionId`, `eligibilityPruids`, `operatingPruid`, `crossProvinceWarning`, `sourceRevisionId`, `state`, `version`, requester display projection, same-province assignee display projections, UUID-backed vote projections, timestamps, and server-derived `allowedActions`. CP4 owns the model, HTTP serialization, `src/services/archiveRequestApi.js`, authorization, state transitions, source sealing, outbox event mapping, migrations, and integration tests.

CP4 implementation sequence and target files:

1. Add the CP4 scope/archive/vote/outbox migrations plus rollback and disposable-database verification.
2. Add `server/lib/authorization/resourceScopeGuard.js` to derive eligibility, operating scope, cross-province warning data, and non-disclosing denials from server authority.
3. Add `server/lib/archiveRequests/service.js` and `repository.js` for source sealing, claim/version locking, UUID validation, assignee/vote invariants, legal transitions, idempotency, conflicts, and atomic P1 outbox writes.
4. Implement the Archive Request routes in a CP4 router mounted by `server/routes/workspace.js`; no CP3 service or browser code constructs identity, scope, state, or allowed actions.
5. Add `src/services/archiveRequestApi.js` and the red cross-province warning to the existing request/Workspace UI. Add API/database tests for both eligible provinces racing the same resource, unrelated-province denial, same-province membership, every state transition, rollback/no-event, and CP0 delivery only to the operating province.
6. If Priority 2 is selected, implement Section 3.4.1 in complete vertical slices and add tests for every delivered merge/revert/tombstone/restore behavior.

### 3.5 Frontend services and data access

Introduce the following structure:

```text
src/services/
  submissionListsApi.js   # CP5 geometry-free table/focus reads
  submissionsApi.js       # submission detail/create APIs
  objectionApi.js         # objection write/detail snapshot APIs
  counterProposalApi.js   # durable CP lifecycle and detail geometry
  workspaceApi.js         # CP5 authoritative Workspace CRUD and reads
  archiveRequestApi.js    # CP4 Archive Request API client only
  archiveApi.js            # archive list, merge, revert
  mapCapabilitiesApi.js   # DA/FED capability and canonical province metadata
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

The browser must never supply an authoritative user UUID or province. The gateway may accept resource-interest hints such as a visible submission ID, but it validates that resource against the connection's derived scope before subscribing. For CP4 workflows, a cross-province event is delivered only to the request's server-derived `operating_pruid`; the other eligible province and every unrelated province receive no live workflow event. This delivery rule does not prevent the other eligible province from reading the canonical resource over its authorized HTTP path.

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
  "scope": { "kind": "operating-province", "pruids": ["24"] },
  "invalidate": ["workspace:list", "workspace:submission:submission-uuid"],
  "committedAt": "ISO-8601"
}
```

Ownership and implementation workflow are deliberately split:

1. **Checkpoint 4** independently migrates the Section 2.5 outbox/delivery tables, server-only grants, indexes, retention, and recovery queries as mandatory P1 work; it does not implement a WebSocket server.
2. **Checkpoint 0** implements the shared runtime only: `server/realtime/gateway.js` for session/origin/scope-validated upgrades, `server/realtime/dispatcher.js` for claim/dispatch/replay, `server/realtime/eventContract.js` for envelope validation, `src/lib/realtime/realtimeClient.js` for reconnect/dedup/resync, `src/lib/realtime/realtimeInvalidation.js` for query invalidation, and `tests/realtime/*.test.js` for the reusable two-browser harness and matrix.
3. Durable Workspace status, Archive Request/Archive, and collaboration mutations write their allocated deliveries and invalidation mappings. Submission persistence/write behavior is not coupled to this event-store implementation. No participating domain handler calls the gateway directly.
4. Each domain PR first passes its unit/API tests with the shared event contract, then adds its CRUD row to the CP0 matrix. For a CP4 cross-province workflow, the harness opens two sessions in the operating province, one session in the other eligible province, and one unrelated session; it verifies convergence for the operating province and non-delivery to both non-operating sessions. The other eligible province is tested separately for authorized HTTP read and deterministic first-commit conflict behavior.
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

Opening a Workspace map/detail child must not call the full Workspace aggregator. Fetch the exact lightweight row first. For a Counter-Proposal, use the existing ID-specific revision-detail route once; any legacy Feedback fallback hydrates only the target DGUID from its manifest-declared FED metadata shard. Objection detail always uses its persisted snapshot. The server may enrich the lightweight row with the target primary/secondary FED lookup so the browser never downloads the full DA profile index merely to locate one target. The Workspace shell renders immediately, while only the map/content area shows a local spinner until its required detail geometry and map assets are ready.

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

Checkpoint 5 implements a presentation-only Public User status mapping; it does not require a database `public_status` column or a submission write/detail response change:

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
2. Verify or remove obsolete DGUID foreign keys, submission/status constraints, archive RPCs, grants, and indexes under the owning domain's migration before enabling its routes.
3. Define explicit RLS policies or document the server-only service-role boundary for every new table.
4. Add `requireAuth`, role, ownership, and canonical PRUID-set checks to `comment-tags`, submission, workspace, export, archive, and demographic routes; a cross-province resource is authorized for either participating PRUID, never for an unrelated PRUID.
5. Replace `GET /api/comments/proposal/:proposalId`’s stale `profiles!submissions_user_id_fkey` relationship with normal profile hydration.
6. Keep service-role credentials server-only and keep `.env` out of version control.
7. Add migration smoke tests against a disposable Supabase database or SQL Editor verification checklist.
8. Authenticate every WebSocket upgrade, enforce the same role/ownership/PRUID rules as HTTP, validate `Origin`, and verify that logout or a profile-scope change revokes the connection.
9. CP4 audits outbox/CDC publication grants and retention; CP0 audits replay limits, event payload redaction, connection limits, and the multi-instance delivery path before production enablement.

## 10. Test and Acceptance Plan

### API and database tests

- The production catalogue audit assigns every table, view/materialized view, function/RPC, trigger, constraint, index, policy, and grant a reviewed `keep`, `migrate`, `export-then-drop`, or `drop` disposition with dependants and data handling.
- Fresh and production-copy migrations remove every approved obsolete object, leave no dangling dependency, preserve deterministic retained data, pass rollback/restore rehearsal, and produce the same final allowlisted schema.
- Anonymous, owner, cross-owner, Commissioner, and service-role probes prove the declared access boundary for every retained minimum submission object; no privileged credential or unintended RPC/table grant is browser-accessible.
- Objection create rejects unknown, inactive, equal, and non-adjacent DGUID pairs.
- Objection create atomically persists its full server-derived GeoJSON snapshot, and detail returns the same immutable geometry after the source local asset is changed or removed.
- Instrumented detail tests fail if an Objection read attempts to reconstruct geometry through DGUID/FED metadata lookup instead of the persisted snapshot.
- Every DA in every Enabled FED asset and every declared adjacent pair passes the exhaustive profile/FED/feature/adjacency capability audit; missing or inconsistent authority returns a specific fail-closed reason.
- Representative authenticated Counter-Proposal writes succeed for every Enabled FED plus cross-FED/cross-province and boundary edge cases, and never substitute Yukon/`60001` or the first manifest asset.
- Counter-Proposal create/list/detail never exposes geometry from list endpoints.
- Counter-Proposal submit atomically persists its normal authorized detail data; it does not create the CP4 archival `sourceRevisionId`.
- CP4 atomically seals the authoritative archive source, returns its server-generated `sourceRevisionId`, and deep-copies that source during any shipped archive merge; browser-supplied source contents or IDs are rejected.
- Changing local map assets or the live submission after merge does not alter archived detail/history; archive branch version numbers remain independent of Counter-Proposal revision numbers.
- Merge inserts a new immutable archive version, revert moves only `is_latest`, and tombstone/restore retain a complete audit trail and source records.
- Public list is session-scoped; Public UI maps raw `pending` to Pending and every other status to Received without exposing alternate status actions.
- Commissioner list/detail/export is scoped by membership in the submission's one- or two-PRUID `scope_pruids` set.
- Workspace comments, labels, and label-catalog CRUD writes to Supabase, serializes stable IDs/custom flags, awaits failures, and rejects unauthorized identity changes.
- A hard refresh preserves selected labels and custom catalog text, prevents duplicate label assignment, and deleting one persisted label removes only that label.
- A slow or failed comment/catalog/label write never reports success or clears the draft as though the server committed it.
- Browser `crmp.workspace.v1` content cannot override a newer server status; two Commissioners converge after refetch, focus/visibility reconciliation, or the relevant CP0 invalidation event.
- Archive Request requester, assignee, and vote identities are UUID-backed and confined to the server-derived `operating_pruid`; non-Commissioner, unrelated-province, cross-province-assignee, stale-version, illegal-transition, and stale-assignee mutations are rejected atomically.
- Both participating provinces can read and independently attempt a cross-province resource operation. The first committed claim wins, the incompatible loser receives `409`, Workspace membership remains province-local, and no second-province vote is required.
- Every affected Commissioner view shows the red canonical `{Province A}`/`{Province B}` warning for a cross-province boundary.
- If CP4 Priority 2 is delivered, archive delete is recoverable under the chosen tombstone policy; any unimplemented P2 control is hidden/disabled and cannot reach an unfinished route.
- Demographic statistics return the compact Section 8 projection with source, census year, suppression, and unavailable-value metadata; they do not call the external source per request.
- Every committed create, update, and delete/tombstone writes exactly one replayable realtime event; rolled-back transactions write none.
- Two authenticated WebSocket clients in the same authorized scope converge after each mutation without manual refresh.
- Public-user, cross-owner, cross-role, non-operating-province, and unrelated-province WebSocket connections neither receive nor infer a CP4 workflow event; two clients in the acting `operating_pruid` converge from the single committed event.
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
- A Commissioner can click, hit-test, query, and export a cross-province resource only when their PRUID is one of its two canonical eligible provinces; an unrelated province cannot discover it, and the UI shows the red cross-province warning before an operation.
- Toggle changes are stable and do not blink or repaint every FED repeatedly.
- Workspace returns to User Submissions or Dashboard according to its entry source; map/detail returns to Workspace; Archived Tree returns to Workspace; Difference returns to Archived Tree.
- Commissioner CSV is available only from Graphs and excludes geometry; Archived Tree exports one authorized, complete, deterministically ordered JSON document.
- Realtime create/update/delete events invalidate only affected lightweight lists, branch statistics, details, heatmap counts, and archive branches.
- Connection state, reconnect, optimistic reconciliation, logout teardown, and forced resync are visible and deterministic.

### CRUD and realtime acceptance matrix

Checkpoint 0 owns a living integration matrix for every required durable Demo 4 domain resource and every optional CP4 P2 slice actually shipped. Each applicable cell verifies HTTP authorization, committed database state, the initiator response, delivery to a second authorized WebSocket client in the operating scope, targeted cache invalidation/refetch, and non-delivery to non-operating or unauthorized clients.

| Resource | Create | Read | Update | Delete/recover | Required realtime effect |
| --- | --- | --- | --- | --- | --- |
| Feedback / Objection / Counter-Proposal submissions | submit | owner projection; scoped Commissioner projection/detail | allowed lifecycle/status/revision operations | owner delete where policy permits; otherwise explicit rejection/tombstone | owner projection, province Workspace/table, InfoPanel, and heatmap invalidate |
| Objection / Counter-Proposal revisions | create atomically | authorized immutable detail | reject in-place mutation; create a new revision | reject physical delete except controlled retention policy | affected detail/version history and archive source choices invalidate |
| Workspace comments | `POST` | `GET` | `PATCH` by authorized policy | `DELETE` by authorized policy | open review panels and branch statistics invalidate |
| Workspace labels | `PUT`/add | `GET` | replace/update | remove one/all under policy | open review panels, branches, and branch statistics invalidate |
| Workspace label catalog | create | list | rename/recolor | delete only when policy permits | all same-province Workspace label pickers invalidate |
| Workspace archive requests (CP4 P1) | create/first claim | eligible read; province-local workflow read | same-province assignees, UUID-keyed votes, state transitions/version conflicts | cancel/tombstone under state policy | operating-province request panel, submission status, branch statistics, and assignee clients invalidate; other eligible province receives no live event |
| Submission Workspace status | status transition | scoped lightweight list/detail | subsequent valid transition | archive cleanup/tombstone semantics | Workspace branches, tables, public list, InfoPanel, and heatmap invalidate |
| Archive tree (only shipped CP4 P2 slices) | merge | scoped tree/detail/history | revert/latest and restore | tombstone and recovery | operating-province archive branches, source Workspace rows, map effect, and exports invalidate |

Read-only capability, heatmap, statistics, and export endpoints do not invent CRUD operations; they are included as authorized refetch targets after source mutations. Immutable resources explicitly test that unsupported update/delete calls are rejected rather than silently mutating history.

Existing regression commands remain required:

```text
npm run check:server
npm test -- --runInBand
npm run build
git diff --check
```

## 11. Implementation Checkpoints

Priority is intentionally embedded in Checkpoints 1-8. Checkpoints 1 and 2 form a self-contained submission workstream and may develop in parallel under the Section 3.0 frozen contract. Checkpoint 2 may run against repository doubles, but its database-backed acceptance requires the clean Checkpoint 1 migration. Their P2 work never blocks either P1 exit criterion. Other checkpoint dependencies are defined only within their own sections.

### Checkpoint 0 — P0: Cross-cutting CRUD and WebSocket acceptance gate

Own the generic realtime platform and its standing acceptance gate, as specified in Sections 2.5 and 3.6. Consume—do not create—the Checkpoint 4 outbox/delivery migration and P1 Archive Request/scope event mappings. Implement the authenticated WebSocket gateway, durable dispatcher/replay path, server-derived user/role/PRUID channels, shared client reconnect/deduplication/resync behavior, event-envelope validation, invalidation registry, and reusable disposable-database/two-browser CRUD matrix. Do not add domain tables, policies, grants, RPCs, or mutation-specific outbox inserts.

Checkpoint 0 is a standing release gate rather than a prerequisite claim that all domain implementations already exist. CP4 provides the shared event-store schema; participating Workspace/archive domain checkpoints add their atomic outbox/delivery writes, matrix rows, and invalidation mappings. CP4 Priority 1 realtime reporting and tests are mandatory. CP4 Priority 2 is optional, but every P2 mutation actually shipped must have a complete CP0 row. CP0 remains open while an applicable participating CRUD cell is missing, while a registered mutation can commit without its domain event, while a replay/resync path fails, or while HTTP and WebSocket authorization differ.

**Exit criteria:** the generic gateway/dispatcher/client/harness pass independently against synthetic contract events; every implemented domain mutation writes one logical replayable event and only its workflow-authorized deliveries in the same transaction; two authorized clients in the operating scope converge without manual refresh; reconnect/resync converges to the HTTP source of truth; a CP4 cross-province event reaches only the acting `operating_pruid`; and public, cross-owner, cross-role, non-operating-province, and unrelated-province clients receive neither unauthorized records nor event metadata.

### Checkpoint 1 — P1: Clean and secure the production database with minimum submission persistence

Checkpoint 1 implements Sections 2.2–2.3, the persistence half of Section 3.0, the database remediation in Section 3.2.1, and the applicable Section 9 controls. Its P1 behavior is a clean, explainable, safely migrated production database that stores the minimum records required for Objection snapshots and Counter-Proposals across all Enabled DAs.

1. **P1 — inventory and delete obsolete database objects.** Export the live catalogue of tables, views/materialized views, functions/RPCs, triggers, constraints, indexes, policies, and grants. Classify every object as `keep`, `migrate`, `export-then-drop`, or `drop`, with its code/database dependants and data disposition. Remove unused tables and every confirmed legacy Yukon/`60001`, old metadata, abandoned proposal, stale view/RPC, or obsolete foreign-key object through explicit versioned migrations. A name alone is not proof of obsolescence; destructive migrations require a verified backup, dependency check, and rollback/restore procedure.
2. **P1 — minimum submission persistence.** Retain or create only the active `submissions`, `objection_revisions`, and Counter-Proposal detail persistence required by Sections 2.2–2.3. Enforce owner, type/status, DGUID/FED, submission-to-snapshot, required geometry/baseline/validation, uniqueness, and timestamp invariants. Deterministically backfill valid legacy rows and export/quarantine rows whose ownership or source cannot be proved.
3. **P1 — security boundary.** Give every retained object an explicit RLS policy or documented server-only boundary; revoke unintended `anon`/`authenticated` table and RPC access; restrict administrative writes to the authenticated server path; and prove service-role credentials never reach browser code or committed configuration. Run anonymous, owner, cross-owner, Commissioner, and service-role probes over the minimum submission schema.
4. **P1 — migration acceptance.** Apply the full migration from empty state and from a copy of current production data. Verify the final allowlist, absence of dropped objects and dangling dependencies, row/data checksums or deterministic counts, constraints, grants, policies, rollback rehearsal, and compatibility with the frozen Section 3.0 repository contract.

**Priority 2:** after P1 passes, optionally improve non-critical indexes/query plans, automate schema-drift reports, enrich migration diagnostics, normalize surviving non-submission legacy objects, repair compatibility relationships not used by the P1 flows, and add broader repository fixtures or common error/route documentation. P2 must not retain an otherwise obsolete object, expand the minimum P1 schema, or block production cleanup and security acceptance. The three-workflow physical table split is discarded rather than scheduled.

**Exit criteria:** a reviewed keep/migrate/drop manifest accounts for every live database object; obsolete objects are removed by rollback-tested migrations; only the minimum active submission persistence and independently owned active-domain objects remain; every retained CP1 object has a proven access boundary; fresh and production-copy migrations pass; and the Objection/Counter-Proposal repository integration tests can persist and read their required records without Yukon-only or legacy metadata constraints.

### Checkpoint 2 — P1: Persist Objection snapshots and enable Counter-Proposals for every Enabled DA

Checkpoint 2 implements the behavior half of Section 3.0 and the P1 routes and authority rules in Sections 3.1–3.2. It consumes the frozen minimum repository contract and does not alter database objects.

1. **P1 — Objection GeoJSON snapshot behavior.** `POST /api/submissions/objections` resolves and validates the submitted DGUID pair through canonical local authority, constructs `original_geometry`, `shared_boundary`, `outer_boundary`, baseline, and validation data on the server, and atomically persists the submission plus snapshot. `GET /api/submissions/:submissionId` reads the persisted snapshot after authorization; it never reconstructs Objection geometry from current local metadata. Tests replace or remove the source asset after submission and require byte/structure-equivalent historical geometry.
2. **P1 — every Enabled DA Counter-Proposal behavior.** Remove the Yukon-only fallback and silent first-manifest substitution. `GET /api/map/capabilities` and `POST /api/submissions/counter-proposals` use the same canonical manifest/profile/metadata/adjacency authority, fail closed with a specific reason, derive FED/baseline values server-side, validate proposed geometry, and persist the complete detail required to reopen the submission.
3. **P1 — exhaustive coverage and integration.** Audit every DA in every Enabled FED asset and every declared adjacent pair for profile/FED/feature/adjacency consistency. Run domain capability tests exhaustively, representative authenticated writes for every Enabled FED, cross-FED/cross-province and boundary edge cases, and the negative cases in Section 3.2.1. Run the same route/repository suite first against doubles and then against the clean production-schema migration.

**Priority 2:** after P1 passes, optionally add the heatmap endpoint, richer detail projections, generalized error envelopes, expanded service-file decomposition, legacy comments/Feedback adapters, compatibility cleanup, performance tuning, additional revision-history metadata, or an explicit future resubmission lifecycle. P2 cannot change the persisted P1 snapshot, restore a Yukon fallback, or block exhaustive Enabled-DA acceptance.

**Exit criteria:** an Objection continues to return its submitted GeoJSON after its original local assets are changed or removed; no Objection detail path reconstructs geometry from stored IDs; every Enabled DA and declared adjacent pair passes the capability audit; representative writes succeed for every Enabled FED without a Yukon fallback; unavailable/corrupt authority fails closed with a specific reason; and the authenticated route/repository suite passes against the clean Checkpoint 1 schema.


### Checkpoint 3 — P1: Establish durable Workspace status and authenticated base APIs

Implement the Section 3.3 durable base: authenticated Workspace route registration, Supabase-backed non-archive submission status transitions, and the initial server reads/writes over the existing Workspace tables. Status transitions persist independently of a browser session and insert their CP0 outbox/delivery rows atomically. This checkpoint does not define a Workspace Summary API or table-facing projection/cache protocol.

**Exit criteria:** authenticated base routes are registered; permitted non-archive Workspace status transitions are durable and reject invalid transitions; reads reproduce the committed status in a clean browser session; and every CP3-owned status mutation creates its required outbox/delivery rows. CP4's province scope guard and CP5's CRUD/browser-authority work have their own exit criteria.

### Checkpoint 4 — P1 scope/request integrity; optional P2 Archived Tree refactor

1. **Priority 1 — province scope.** Independently create the CP4 scope schema/migration, reusable guard, immutable eligible province set, same-province `operating_pruid`, first-commit claim/version conflicts, unrelated-province denial, and red cross-province UI warning in Section 3.4.2.
2. **Priority 1 — Archive Request.** Independently create the Archive Request/vote/outbox schema/migrations, CP4-sealed `sourceRevisionId`, UUID identity model, same-province assignee/vote rules, complete state machine, authenticated routes/client read model, and atomic P1 realtime events/tests in Sections 2.5, 3.4, and 3.4.2.
3. **Priority 2 — Archived Tree.** Optionally deliver Section 3.4.1 archive merge/version/revert/tombstone/restore as complete tested vertical slices over the existing minimum runnable skeleton. Do not expose unfinished behavior, regress the current application, physically delete history, or leave a partial migration/route. Performance and non-safety workflow refinements are best effort; every portion actually delivered must be behaviorally sound and tested, including its CP0 matrix row.

**Exit criteria:** both mandatory P1 bullets pass their Section 10 API/database/frontend tests: either canonical province can attempt a cross-province operation, the first committed claim wins, the loser receives an explicit conflict, request membership and live reports remain in the acting province, no second-province approval is required, unrelated provinces cannot discover or mutate the resource, UUID/state/version rules are atomic, and every committed P1 mutation writes exactly its operating-province CP0 delivery. P2 does not block CP4 acceptance when cleanly deferred; if any P2 slice is delivered, that slice must preserve immutable snapshots and audit/recovery behavior and pass its applicable API, failure, and realtime tests.

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
