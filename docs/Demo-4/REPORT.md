# Demo 4 Checkpoint Audit and Plan Change Index

## 1. Checkpoint audit

Status is assessed against the current checkout and the acceptance criteria in `PLAN.md`.

| Checkpoint | Status | Result |
| --- | --- | --- |
| CP0 | Not accepted | No authenticated durable WebSocket/dispatch/replay runtime is present. Priority 1 is now limited to all Workspace operations and Commissioner Table CRUD effects. Runtime/status adapters can start against contract fixtures, but production acceptance also waits for CP4's P1 durable event store and each slice's named domain dependency. |
| CP1 | Not accepted | No complete live-object inventory, keep/migrate/drop decision, obsolete-object deletion migration, production-copy rehearsal, or security matrix proves that the production database is clean and protected. Minimum Objection/Counter-Proposal persistence is also incomplete. |
| CP2 | Partial | Submission and local validation paths exist, but Objection detail is not yet proven independent from current local metadata, the Yukon fallback remains a confirmed failure path, and coverage does not exhaust every DA and declared adjacent pair in Enabled FED assets. |
| CP3 | P1 accepted; P3 not started | Authenticated durable Workspace status behavior is present for the allocated P1 scope. The optional Priority 3 Workspace Summary table/API is not implemented. Reassigned audit findings are retained only in the behavioral history below. |
| CP4 | Partial | A minimum Archived Tree/archive-request skeleton exists, but mandatory P1 province scope, first-commit claim, same-province Archive Request state machine, and CP4-owned schema/source seal/domain-event records are incomplete. Archived Tree archive/delete refactoring is optional P2. |
| CP5 | Not accepted | Geometry-free direct-select list reads, the Public Pending/Received presentation, reliable Workspace CRUD/browser convergence, focused Workspace loading, source-aware navigation, readiness-based loading, Commissioner CSV, and Archived Tree JSON are not implemented. |
| CP6 | Partial | Counter-Proposal editing and map UI exist, but the planned editing/presentation contract and acceptance coverage are incomplete. |
| CP7 | Not started | No versioned statistics pipeline/API and presentation contract are present. |
| CP8 | Not started | The release verification and documentation synchronization gate has not been completed. |

## 2. PLAN.md change index

This index records the plan clarifications and responsibility allocation adopted to date; the definitions themselves remain authoritative in `PLAN.md`.

| Topic | PLAN.md index |
| --- | --- |
| Realtime data model, event contract, delivery semantics | Sections 2.5 and 3.6; CP0 consumes committed domain events and owns runtime, replay, invalidation, and delivery gates |
| Self-contained CP1/CP2 minimum persistence/write contract and parallel boundary | Section 3.0; Checkpoints 1 and 2 |
| Production database inventory, obsolete-object deletion, minimum persistence, security, and rollback acceptance | Sections 2.2–2.3, 9, and 10; Checkpoint 1 |
| Durable Objection GeoJSON snapshot with no detail-time local reconstruction | Sections 2.2, 3.1, and 10; Checkpoint 2 |
| Geometry-free direct-select table/list contract; no Projection Table or cursor adapter | Sections 2.1 and 3.1.1; Checkpoint 5 |
| Enabled-DA Counter-Proposal/Yukon incident diagnosis and exhaustive remediation | Section 3.2.1; Checkpoints 1 and 2 |
| Durable Workspace status P1 and optional Workspace Summary table/API P3 | Section 3.3; Checkpoint 3 |
| Reliable comments, labels, label catalog, and removal of browser-authoritative Workspace state | Sections 3.5, 4.1, and 10; Checkpoint 5 |
| Independent CP4 scope/archive/vote/outbox schema, sealed archive source, first-commit province model, and P1/P2 split | Sections 2.5, 3.4, 3.4.1, and 3.4.2; Checkpoints 0 and 4 |
| Focus-first Workspace reads, target-only detail hydration, loading, and source-aware navigation | Sections 3.5, 4.1, and 7; Checkpoint 5 |
| Commissioner CSV, Archived Tree JSON, and Public Pending/Received presentation | Sections 5 and 6; Checkpoint 5 |
| CP1/CP2/CP4 P1 change classification, backend test additions, frontend tests, and reproducible manual acceptance | Section 10 supplemental checklists; Checkpoints 1, 2, and 4 |
| CP0 P1 Workspace/Commissioner Table CRUD realtime, dependency order, automated tests, and browser examples | Sections 3.6.1 and 10; Checkpoint 0 |
| CP0 P2 remaining realtime dependency register without a dedicated checklist | Section 3.6.2; Checkpoint 0 |
| Cross-cutting final verification | Section 10; Checkpoint 8 |
| Checkpoint ordering, parallelism, ownership, and exit criteria | Section 11 |

### 2026-08-02 behavioral verification

The CP3 audit concerns are now demonstrated user-visible defects, not theoretical architecture gaps:

- after a hard refresh, persisted labels lose their selected identity, can be added again, and deleting one old label can remove another; custom catalog labels can duplicate and revert to their defaults;
- a comment added on a slow connection can disappear because the client does not await the durable write;
- after Commissioner B commits `accepted`, Commissioner A can remain in the Rejected branch because `crmp.workspace.v1` overrides the newer server value.

The corrective contract and acceptance cases are indexed at `PLAN.md` Sections 4.1 and 10 and Checkpoint 5. Default custom catalog labels are standardized as `Custom Label 1`, `Custom Label 2`, and `Custom Label 3`. CP0 owns WebSocket transport, while CP5 owns authoritative HTTP reconciliation and its mutation-specific event/outbox integration.

The Workspace Summary table/API is now an optional CP3 Priority 3 deliverable and never blocks durable status acceptance. If it is not delivered, Workspace tables and branches continue to use the geometry-free direct select, including exact-ID-first focused entry. See `PLAN.md` Sections 3.1.1, 3.3, and 4.1 and Checkpoint 3. The three-workflow physical table split remains discarded; see Section 2.4.

### 2026-08-02 CP4 scope and ownership revision

- Cross-province resources now use two eligible provinces but one province-local, first-commit-wins operation; there is no cross-province Workspace membership or approval. See `PLAN.md` Section 3.4.2 and Checkpoint 4.
- CP4 Priority 1 comprises the province-scope refactor, complete Archive Request state machine, CP4-owned scope/archive/vote/outbox migrations, sealed archival `sourceRevisionId`, and its own domain-event tests. See Sections 2.5 and 3.4 and Checkpoint 4.
- Archived Tree archive/delete refactoring is optional Priority 2, subject to the no-regression and completed-slice test rule. See Section 3.4.1 and Checkpoint 4.
- CP4 is a standalone scope/archive workstream. The dependency direction is one-way: CP0 consumes CP4's committed P1 event/delivery records when that realtime slice becomes available. See Sections 2.5, 3.6.1, and 3.4 and Checkpoints 0 and 4.

### 2026-08-02 CP3 and CP0 priority refinement

- CP3 now contains only durable Workspace status as Priority 1 and the optional Workspace Summary table/API as Priority 3. The moved comment/label/catalog, browser-authority, scope, and realtime findings are absent from CP3 in `PLAN.md` and remain recorded in this report's behavioral verification and ownership history. See `PLAN.md` Section 3.3 and Checkpoint 3.
- CP0 Priority 1 is all Workspace operations plus Commissioner Table CRUD effects. Runtime/status adapters that can be developed now are ordered before dependency-blocked table, branch, collaboration, and Archive Request slices. Production acceptance of every slice also requires CP4's P1 durable event store; each additional domain dependency is named. See Sections 2.5 and 3.6.1 and Checkpoint 0.
- CP0 Priority 1 now has change-specific backend/integration tests, frontend tests, a CRUD matrix, and reproducible two-browser/manual examples. See Section 10, “Checkpoint 0 Priority 1 realtime supplemental checklist.”
- CP0 Priority 2 is only a dependency register for Public lists, InfoPanel/heatmap, Archived Tree, optional Summary, exports, committed impact, and statistics; it has no dedicated acceptance checklist. See Section 3.6.2.
- The remaining dependency direction is explicit: CP1 and CP2 share only their frozen submission contract; CP0 consumes named completed domain requirements; CP3 and CP4 are standalone. CP5–CP8 retain only the dependencies stated in their own plans. See Sections 3.0 and 3.6 and Section 11.

### 2026-08-02 CP1/CP2 requirements refactor

- CP1 P1 is reduced to cleaning and securing the real production database and supplying the minimum persistence for Objection snapshots and Counter-Proposals. See Sections 2.2–2.3, 3.0, 3.2.1, and Checkpoint 1.
- CP2 P1 is reduced to durable Objection GeoJSON snapshots and Counter-Proposal capability/write behavior for every DA and declared adjacent pair in Enabled FED assets. See Sections 3.1–3.2 and Checkpoint 2.
- CP1 and CP2 form one self-contained workstream connected only by the frozen minimum repository contract. They have no implementation or acceptance dependency on another checkpoint.
- Previous heatmap, compatibility-adapter, generalized response/route abstraction, extra revision lifecycle, schema-reporting, and non-critical normalization work is Priority 2 and cannot block P1. The physical three-workflow table split is discarded.

### 2026-08-02 P1 acceptance evidence gate

- Every CP1, CP2, and CP4 P1 change is classified as backend-only, frontend-visible, or both. Backend-only changes must append behavior-specific automated coverage; frontend-visible changes additionally require frontend automation and a completed manual behavior record. See `PLAN.md` Section 10.
- The checkpoint-specific checklists include real checked-in DA pairs, failure/rollback cases, authorization negatives, hard-refresh behavior, CP4 first-commit concurrency, and province-local realtime examples. Checkpoint exits now require this evidence.
