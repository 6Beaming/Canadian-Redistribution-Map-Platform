# Demo 4 Checkpoint Audit and Plan Change Index

## 1. Checkpoint audit

Status is assessed against the current checkout and the acceptance criteria in `PLAN.md`.

| Checkpoint | Status | Result |
| --- | --- | --- |
| CP0 | Not accepted; developable | No authenticated durable WebSocket/dispatch/replay runtime is present. CP5-backed Workspace list/comment/label/local-custom-label adapters and CP5/CP6/CP7 Priority 2 consumers are ready now. Status and Archive Request adapters wait only on CP4 P1; Commissioner create effects wait only on CP2 P1. Production acceptance still requires the CP4 P1 durable outbox/delivery store. |
| CP1 | Not accepted; developable | No complete live-object inventory, keep/migrate/drop decision, obsolete-object deletion migration, production-copy rehearsal, or security matrix proves that the production database is clean and protected. Minimum Objection/Counter-Proposal persistence is also incomplete. May proceed in parallel with CP2 under the Section 3.0 contract. |
| CP2 | Partial; developable | Submission and local validation paths exist, but Objection detail is not yet proven independent from current local metadata, the Yukon fallback remains a confirmed failure path, and coverage does not exhaust every DA and declared adjacent pair in Enabled FED assets. May proceed against doubles pending CP1 migration. |
| CP3 | Delivered; P3 excluded | Mandatory Demo 4 work is complete by reassignment: former status P1 gaps are owned by CP4 P1. The optional Workspace Summary table/API remains excluded. No further CP3 implementation is required. |
| CP4 | Not accepted; developable | Owns every former CP3 status gap and every remaining Archive Request / province-scope gap as mandatory P1: durable `accepted`/`rejected` status GET/version/`expectedVersion`, rejection of Archive-owned status writes, province scope and first-commit claim, complete Archive Request state machine, sealed `sourceRevisionId`, and durable outbox/delivery. A minimum archive-request skeleton exists but does not satisfy P1. Archived Tree refactoring remains optional P2. |
| CP5 | Delivered | Geometry-free direct selects, Public Pending/Received, reliable comments and submission-local labels, browser-authority removal, readiness loading/navigation, Commissioner CSV, Archived Tree JSON, and their tests are present. Production smoke should still apply `20260802130000_local_workspace_custom_labels.sql` when deploying. |
| CP6 | Delivered | Uniform/locked handles, compact local-first history, worker preview/commit validation, final server validation, persisted Commissioner impact, source-only MapLibre updates, and static selected-category rollout paint are implemented and covered. |
| CP7 | Delivered | The checked-in versioned Statistics Canada DA release, public `/api/map` read route, compact API/cache contract, source/vintage/suppression presentation, scrollable InfoPanel, and coverage tests are present. |
| CP8 | Ignored for this reassignment | The release verification and documentation synchronization gate is out of scope for this allocation pass. |

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
| Durable Workspace status owned by CP4 P1; optional Workspace Summary table/API remains deferred CP3 P3 | Section 3.3; Checkpoints 3 and 4 |
| Reliable comments, assigned labels, submission-local custom labels, deprecated global catalog, and removal of browser-authoritative Workspace state | Sections 3.5, 4.1, and 10; Checkpoint 5 |
| Independent CP4 status/scope/archive/vote/outbox schema, sealed archive source, first-commit province model, and P1/P2 split | Sections 2.5, 3.3, 3.4, 3.4.1, and 3.4.2; Checkpoint 4 (consumed one-way by CP0 under Section 3.6.1) |
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

The corrective contract and acceptance cases are indexed at `PLAN.md` Sections 4.1 and 10 and Checkpoint 5. Fixed label candidates are application-defined; custom definitions and selection state are submission-local in `workspace_labels`, and the global `workspace_label_catalog` is retained only as deprecated recoverable data. CP5 owns committed CRUD and authoritative HTTP reconciliation; CP0 separately owns the transactional event adapters, outbox/delivery integration, and WebSocket transport.

The Workspace Summary table/API remains an optional deferred CP3 Priority 3 deliverable and never blocks durable status acceptance. If it is not delivered, Workspace tables and branches continue to use the geometry-free direct select, including exact-ID-first focused entry. See `PLAN.md` Sections 3.1.1, 3.3, and 4.1 and Checkpoint 3. The three-workflow physical table split remains discarded; see Section 2.4.

### 2026-08-02 CP4 scope and ownership revision

- Cross-province resources now use two eligible provinces but one province-local, first-commit-wins operation; there is no cross-province Workspace membership or approval. See `PLAN.md` Section 3.4.2 and Checkpoint 4.
- CP4 Priority 1 comprises the province-scope refactor, complete Archive Request state machine, CP4-owned scope/archive/vote/outbox migrations, sealed archival `sourceRevisionId`, and its own domain-event tests. See Sections 2.5 and 3.4 and Checkpoint 4.
- Archived Tree archive/delete refactoring is optional Priority 2, subject to the no-regression and completed-slice test rule. See Section 3.4.1 and Checkpoint 4.
- CP4 is a standalone scope/archive workstream. The dependency direction is one-way: CP0 consumes CP4's committed P1 event/delivery records when that realtime slice becomes available. See Sections 2.5, 3.6.1, and 3.4 and Checkpoints 0 and 4.

### 2026-08-02 CP3 and CP0 priority refinement

- CP3 originally contained only durable Workspace status as Priority 1 and the optional Workspace Summary table/API as Priority 3. Comment/label/catalog, browser-authority, scope, and realtime findings remain outside CP3 and are recorded in this report's behavioral verification and ownership history. See `PLAN.md` Section 3.3 and Checkpoint 3.
- CP0 Priority 1 enumerates the generic runtime first, then every Commissioner Table and Workspace CRUD slice with its exact readiness state. CP5-backed Workspace list/comments/labels/submission-local custom-label adapters are ready; Commissioner create effects remain blocked by CP2; status and Archive Request wait on CP4; all production slices retain the common CP4 durable-store dependency. See `PLAN.md` Sections 3.6.1 and 11, Checkpoint 0.
- CP0 Priority 1 has backend/integration tests, frontend tests, a resource-by-resource CRUD matrix, and reproducible two-browser/manual examples covering Commissioner Table effects, Workspace list/branch refresh, status, comments, assigned labels, submission-local custom labels, and Archive Requests. See `PLAN.md` Section 10, “Checkpoint 0 Priority 1 realtime supplemental checklist” and “Priority 1 CRUD and realtime acceptance matrix.”
- CP0 Priority 2 is only a dependency register for Public lists, InfoPanel/heatmap, Archived Tree, optional Summary, exports, committed impact, and statistics; it has no dedicated acceptance checklist. See `PLAN.md` Section 3.6.2 and Checkpoint 0.
- CP1 and CP2 are the only mutually coupled checkpoints, through their frozen minimum submission contract. CP0 is the only one-way integration consumer and names every dependency it consumes. CP5–CP7 are delivered; CP8 is ignored for this reassignment. See `PLAN.md` Sections 3.0, 3.6, and 11.

### 2026-08-02 CP1/CP2 requirements refactor

- CP1 P1 is reduced to cleaning and securing the real production database and supplying the minimum persistence for Objection snapshots and Counter-Proposals. See Sections 2.2–2.3, 3.0, 3.2.1, and Checkpoint 1.
- CP2 P1 is reduced to durable Objection GeoJSON snapshots and Counter-Proposal capability/write behavior for every DA and declared adjacent pair in Enabled FED assets. See Sections 3.1–3.2 and Checkpoint 2.
- CP1 and CP2 form one self-contained workstream connected only by the frozen minimum repository contract. They have no implementation or acceptance dependency on another checkpoint.
- Previous heatmap, compatibility-adapter, generalized response/route abstraction, extra revision lifecycle, schema-reporting, and non-critical normalization work is Priority 2 and cannot block P1. The physical three-workflow table split is discarded.

### 2026-08-02 P1 acceptance evidence gate

- Every CP1, CP2, and CP4 P1 change is classified as backend-only, frontend-visible, or both. Backend-only changes must append behavior-specific automated coverage; frontend-visible changes additionally require frontend automation and a completed manual behavior record. See `PLAN.md` Section 10.
- The checkpoint-specific checklists include real checked-in DA pairs, failure/rollback cases, authorization negatives, hard-refresh behavior, CP4 first-commit concurrency, and province-local realtime examples. Checkpoint exits now require this evidence.

### 2026-08-02 CP3/CP5/CP6/CP7 delivery audit and CP0 readiness

- CP5, CP6, and CP7 satisfy their implementation and automated acceptance contracts; see `PLAN.md` Sections 3.5, 4.1–4.3, 5–8, 10, and Checkpoints 5–7. CP5's production smoke gate remains applying `supabase/migrations/20260802130000_local_workspace_custom_labels.sql` when deploying.
- CP0 no longer waits for CP3, CP5, CP6, or CP7 implementation. CP5-backed P1 adapters and CP5/CP6/CP7 P2 consumers may start immediately. Remaining domain blockers are only CP2 (submission create effects / Public create refresh) and CP4 (status, Archive Request, durable event store).

### 2026-08-02 CP3→CP4 gap reassignment and delivery boundary

Independent audit conclusions for CP3 and CP4 are retained, but their remaining gaps are both allocated to CP4 Priority 1. CP3 does not block CP4 development.

**Former CP3 gaps now owned by CP4 P1**

- missing `GET /api/workspace/submissions/:submissionId/status` blocks precise CP0 status refetch after invalidation;
- missing committed version / optional `expectedVersion` allows stale PATCH writes to overwrite newer results instead of returning `409 STALE_RESOURCE_VERSION`;
- the current status PATCH accepts `archive-request` / `archived` and can flip archived rows back to `pending` without Archive Request records, sealed source, archive tree, or outbox events.

Correct CP4 boundary:

```text
CP4 P1
├─ accepted / rejected status
│  ├─ GET current status/version
│  ├─ conditional PATCH
│  └─ stale write -> 409
└─ archive-request / archived
   ├─ province scope and first claim
   ├─ request/assignee/vote state machine
   ├─ sealed source revision
   ├─ transactional status change
   └─ outbox/delivery event
```

**Former CP4 P1 gaps that remain mandatory**

- Archive Request schema lacks request ID/state/version/operating PRUID/scope/`sourceRevisionId`;
- assignees are resolved by email without active same-province Commissioner checks;
- votes use email keys and accept arbitrary strings, including from non-assignees;
- read-modify-write vote JSON can drop concurrent ballots;
- no `expectedVersion` / `409` on assignee, vote, or cancel paths;
- no operating-province first-commit claim across Manitoba/Saskatchewan boundaries;
- role-only checks leak or allow unrelated-province discovery;
- cancel deletes the row instead of retaining cancelled state/version/audit;
- no transactional outbox/delivery writes;
- no sealed `sourceRevisionId`.

**Delivery consequence**

- CP3, CP5, CP6, and CP7 are delivered for Demo 4 (CP3 P3 Summary excluded; CP8 ignored).
- CP0, CP1, CP2, and CP4 have no cross-checkpoint blockers that prevent development from starting now.
- CP4 P2 Archived Tree may defer; the CP4 P1 items above may not.

### 2026-08-02 GitHub Issues for remaining P1 bullets

One issue per Priority 1 bullet for developable Checkpoints 0, 1, 2, and 4. Obsolete CP3 issues #97–#99 were closed.

| Checkpoint | Issue | P1 bullet |
| --- | --- | --- |
| CP0 | [#100](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/100) | Generic authenticated WebSocket transport, replay, and client convergence |
| CP0 | [#101](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/101) | Workspace submission-status read/update realtime adapter |
| CP0 | [#102](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/102) | Commissioner Table submission CRUD realtime projection |
| CP0 | [#103](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/103) | Workspace list/branch read invalidation |
| CP0 | [#104](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/104) | Workspace comment CRUD realtime adapter |
| CP0 | [#105](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/105) | Workspace assigned-label CRUD realtime adapter |
| CP0 | [#106](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/106) | Workspace submission-local custom-label CRUD realtime adapter |
| CP0 | [#107](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/107) | Workspace Archive Request CRUD/state realtime adapter |
| CP1 | [#108](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/108) | Inventory and delete obsolete production database objects |
| CP1 | [#109](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/109) | Minimum Objection and Counter-Proposal persistence |
| CP1 | [#110](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/110) | Production database security boundary |
| CP1 | [#111](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/111) | Fresh and production-copy migration acceptance |
| CP2 | [#112](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/112) | Durable Objection GeoJSON snapshot write and detail |
| CP2 | [#113](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/113) | Counter-Proposal capability and write for every Enabled DA |
| CP2 | [#114](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/114) | Exhaustive Enabled-DA coverage and route/repository integration |
| CP4 | [#115](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/115) | Durable non-archive Workspace status GET/PATCH with version conflicts |
| CP4 | [#116](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/116) | Commissioner province scope guard and first-commit claim |
| CP4 | [#117](https://github.com/UTSC-CSCC01-Software-Engineering-I/course-project-five-guys/issues/117) | Complete Archive Request state machine, sealed source, and outbox |
