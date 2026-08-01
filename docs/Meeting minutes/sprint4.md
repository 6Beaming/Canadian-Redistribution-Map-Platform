## Division of labour

Eric:

### Checkpoint 0 — P0: Cross-cutting CRUD and WebSocket acceptance gate

Own the generic realtime platform and its standing acceptance gate, as specified in Sections 2.5 and 3.6. Consume the Checkpoint 1 outbox/delivery migration. Implement the authenticated WebSocket gateway, durable dispatcher/replay path, server-derived user/role/PRUID channels, shared client reconnect/deduplication/resync behavior, event-envelope validation, invalidation registry, and reusable disposable-database/two-browser CRUD matrix. Do not add domain tables, policies, grants, RPCs, or mutation-specific outbox inserts.

Checkpoint 0 is a standing release gate rather than a prerequisite claim that all domain implementations already exist. Checkpoints 2, 3, and 4 add their own atomic outbox/delivery writes and matrix rows as they add submission, Workspace, and Archive mutations; Checkpoint 5 adds public-table/cache invalidation rows. CP0 remains open while any applicable CRUD cell is missing, while a mutation can commit without its domain event, while a replay/resync path fails, or while HTTP and WebSocket authorization differ.

**Exit criteria:** the generic gateway/dispatcher/client/harness pass independently against synthetic contract events; every implemented domain mutation writes one logical replayable event and one delivery per authorized PRUID in its transaction; two authorized clients converge without manual refresh; reconnect/resync converges to the HTTP source of truth; cross-province resources converge for each participating scope; and public, cross-owner, cross-role, and out-of-scope clients receive neither unauthorized records nor event metadata.

Arvindh:

### Checkpoint 1 — P1: Freeze the database contract and security boundary

Implement the schema and access boundary defined in Sections 2.2–2.5 and the deployment controls in Section 9. Under Section 3.0, this checkpoint is the platform workstream and owns the Section 3.2.1 production-schema audit and persistence-side fail-closed contract.

1. **Schema, migration, and backfill contract.** Create/alter versioned Supabase migrations for canonical submissions and normalized `submission_scope_pruids`; immutable `objection_revisions` and `counter_proposal_revisions`; Workspace comments, labels, label catalog, Archive Requests, and UUID-keyed votes; `archive_tree`; and `realtime_outbox` plus `realtime_scope_deliveries`. Backfill only from deterministic canonical sources, quarantine unverifiable rows, and apply migrations to both an empty disposable database and a copy/backup of target data.
2. **RLS, grants, RPCs, and server-only data access.** Establish and verify a precise browser/server boundary for every affected table, RPC, and credential.
3. **Interface and route-boundary definition.** Commit the Section 3.0 contract artifact, repository/MapAuthority doubles, route catalogue and ordering, common envelopes, and verified identity/scope service inputs. Record the DGUID foreign-key and stale profile relationship repairs as migration/compatibility requirements.
4. **Migration/security verification harness.** Add the isolated database harness for fresh and existing-data migration, expected schema probes, RLS/RPC-grant probes, rollback rehearsal, and interface-double compatibility.
5. **Enabled-FED Counter-Proposal platform remediation.** Execute the Section 3.2.1 Supabase audit; replace every confirmed Yukon/`60001` or legacy-map restriction with a rollback-tested migration; and validate one- and two-PRUID persistence invariants.

**Exit criteria:** the Sections 2.2–2.5 and Section 9 contracts are represented by an auditable target schema; each table/RPC has an explicit browser/server access boundary; deterministic backfill and rollback/restore procedures have been rehearsed; router ownership and common response contracts are established; and the Section 10 migration/database smoke tests pass.

Alex:

### Checkpoint 2 — P1: Make all submission geometry immutable and separate list/detail reads

Under the Section 3.0 frozen contract, implement application behavior only. Implement `server/routes/submissions.js`, submission domain/repository adapters, the MapAuthority capability endpoint, and the local-authority Objection/Counter-Proposal transaction flow using the Section 3.0 schema, scope, transaction, authorization, and error/projection contracts.

1. **Submission API behavior.** Implement the Section 3.1 Objection/Counter-Proposal create, list projection, and authorized detail handlers; server-owned `SubmissionProjectionV1` cursor semantics; and its contract tests.
2. **Capability and local authority.** Implement `GET /api/map/capabilities`; use MapAuthority for Public User gating and every submission write; derive validated one- or two-PRUID scopes and server-owned FED/baseline values; and remove the Yukon-only fallback described in Section 3.2.1.
3. **Transactional persistence adapter.** Atomically write the submission, immutable revision, `submission_scope_pruids`, and required outbox record through the Section 3.0 contract.
4. **Enabled-FED and integration tests.** Cover every Enabled FED, a valid cross-province pair, all defined negative cases, and the authenticated route/database integration suite.

**Exit criteria:** the Checkpoint 2 implementation passes its MapAuthority/domain/handler suite against contract doubles; the joint disposable-database suite passes after Checkpoint 1 migration integration; Objection and Counter-Proposal detail pages replay their submitted geometry after local assets change; no list response contains full geometry; every Enabled FED has capability coverage; and the behavior introduces no schema, policy, grant, RPC, or migration change.

### Checkpoint 3 — P1: Replace transitional Workspace state and complete durable Workspace APIs

Implement the Section 3.3 Workspace core: durable server summary, comments, labels, label catalog, Workspace cache, and migration away from localStorage/hybrid submission aggregation. Consume the Checkpoint 2 projection/capability contracts and the CP4 reusable scope guard. Register Workspace event mappings with the shared CP0 runtime and insert its own comment/label/catalog/summary-status events transactionally.

**Exit criteria:** the Section 3.3 summary/comments/labels/catalog CRUD contract passes with the CP4 scope guard; shared Workspace data contains no localStorage, browser-event, temporary-override, or hybrid aggregation fallback; two authorized Commissioners converge on the same permitted Workspace state through CP0 without manual refresh; and every C3 mutation creates its required outbox/delivery rows.

Erfang:

### Checkpoint 5 — P2: Deliver progressive list, Workspace, and navigation UX

Implement the public ownership/projection portions of Section 3.1, the Section 3.1.1 mock-to-HTTP submission data source, Section 3.5 query cache, Section 4.1 loading model, Section 5 exports, Section 6 public-status contract, and their Section 10 tests. Develop tables first against `SubmissionProjectionV1` mock data; replace only the data-source adapter with CP2's authenticated HTTP result. Move public and Commissioner tables to first-page cursor loading; add Workspace branch cursors and cache; derive public ownership from the verified session; correct navigation; and implement scoped CSV exports through the reusable CP4 scope guard. Register public-table/cache invalidation mappings with CP0.

**Exit criteria:** mock-table tests and the CP2 HTTP-adapter contract test pass without component changes; the Section 4.1 first-page/cursor tests and Section 6 public-status tests pass; the first useful content appears without waiting for the full dataset; public users can read/export only their own projected status; branch expansion remains functional; and every export obeys the same authorization filters as the UI.

### Checkpoint 6 — P2: Refactor Counter-Proposal editing and map presentation

Implement the editing contract in Section 4.2, the rollout presentation plan in Section 4.3, and the corresponding Section 10 frontend tests. Use uniformly sampled UI handles, locked endpoints, local-first drafts, worker-based JSTS/impact validation, and final server validation only on commit. Update MapLibre source data without rebuilding layers. Replace rollout blinking/feature-state loops with stable filters or paint expressions, then complete responsive, loading, status, and remaining map UX regression fixes.

**Exit criteria:** the Section 4.2/4.3 behaviors and Section 10 frontend tests pass: dragging is responsive on complex boundaries, invalid positions revert predictably, and the Enabled/Data Blocked toggle does not visibly blink or stall.

### Checkpoint 7 — P3: Add demographics and presentation metadata

Implement the versioned ETL, compact statistics API, and presentation contract in Section 8, comply with the route boundary in Section 9, and add the Section 10 statistics test. Build the versioned Statistics Canada ETL and DA statistics API, then render demographic source, census year, suppression, and missing-value states in `UserViewStatistics.jsx`. Resolve smaller UI/UX regressions discovered after the P1/P2 architecture is stable.

**Exit criteria:** the Section 8 contract and its Section 10 test pass: Statistics are served from the project data store rather than per-click external calls, and every shown value is attributable to a source and vintage.

Hamza:

### Checkpoint 4 — P1: Archived Tree, Archive Request, and Commissioner scope integrity

Implement the Archived Tree contract in Sections 3.4 and 3.4.1, and the Section 3.4.2 Archive Request scope guard, target API, client API, response model, UUID identity/state machine, and Commissioner province isolation. Select the existing sealed Counter-Proposal revision during merge and atomically copy it into a new immutable `archive_tree` version. Implement `server/lib/authorization/resourceScopeGuard.js`, `server/lib/archiveRequests/`, authenticated Archive Request routes, `src/services/archiveRequestApi.js`, `ArchiveRequestReadModelV1`, server-derived PRUID checks across Commissioner map/submission/Workspace/Archive/heatmap paths, branch latest/revert semantics, recoverable tombstone/restore, complete audit metadata, scoped archive reads, and CP0 outbox delivery writes.

**Exit criteria:** the Sections 3.2, 3.4.1, and 3.4.2 contracts and their Section 10 tests pass: archived detail/history replay the selected immutable source snapshot after live map/submission changes; Counter-Proposal revision count is unchanged by archive actions; Archive Request API/state transitions and `ArchiveRequestReadModelV1` use authorized UUID identities; each participating Commissioner scope can read/subscribe to a cross-province resource, a two-PRUID archive transition has the required approval from both scopes, and an unrelated province cannot read, mutate, hit-test, or subscribe; branch versions, merge, revert, tombstone, and recovery preserve a complete audit trail without browser state; and every C4 mutation writes its CP0 delivery rows.
