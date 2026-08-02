# Demo 4 Checkpoint Audit and Plan Change Index

## 1. Checkpoint audit

Status is assessed against the current checkout and the acceptance criteria in `PLAN.md`.

| Checkpoint | Status | Result |
| --- | --- | --- |
| CP0 | Not accepted | No durable realtime delivery, authenticated WebSocket gateway, replay/resync, or complete CRUD matrix is present. |
| CP1 | Not accepted | The required migrations, access boundary, production-schema audit, and verification harness are not present. |
| CP2 | Partial | Submission flows and local map validation exist, but the frozen write/detail/capability contract, atomic persistence, and all-Enabled-FED coverage are incomplete. No Projection Table is required. |
| CP3 | Accepted for allocated scope | Authenticated Workspace routes and durable status/table primitives are present. Province scope is assessed under CP4; verified CRUD/browser-authority defects are assessed under CP5; CP0 remains a separate release gate. |
| CP4 | Partial | Legacy archive and archive-request code exists, but the required immutable archive, UUID identity, reusable scope guard, and province-isolation contract are incomplete. |
| CP5 | Not accepted | Geometry-free direct-select list reads, the Public Pending/Received presentation, reliable Workspace CRUD/browser convergence, focused Workspace loading, source-aware navigation, readiness-based loading, Commissioner CSV, and Archived Tree JSON are not implemented. |
| CP6 | Partial | Counter-Proposal editing and map UI exist, but the planned editing/presentation contract and acceptance coverage are incomplete. |
| CP7 | Not started | No versioned statistics pipeline/API and presentation contract are present. |
| CP8 | Not started | The release verification and documentation synchronization gate has not been completed. |

## 2. PLAN.md change index

This index records the plan clarifications and responsibility allocation adopted to date; the definitions themselves remain authoritative in `PLAN.md`.

| Topic | PLAN.md index |
| --- | --- |
| Realtime data model, event contract, delivery semantics | Sections 2.5, 3.6; Checkpoints 0 and 1 |
| CP1/CP2 parallel boundary and frozen route/database contract | Section 3.0; Checkpoints 1 and 2 |
| Geometry-free direct-select table/list contract; no Projection Table or cursor adapter | Sections 2.1 and 3.1.1; Checkpoints 2 and 5 |
| Enabled-FED Counter-Proposal/Yukon incident diagnosis and remediation | Section 3.2.1; Checkpoints 1 and 2 |
| Durable Workspace status/base APIs | Section 3.3; Checkpoint 3 |
| Reliable comments, labels, label catalog, and removal of browser-authoritative Workspace state | Sections 3.3, 3.5, and 4.1; Checkpoint 5 |
| Archived Tree, Archive Request identity, and Commissioner scope guard | Sections 3.4, 3.4.1, and 3.4.2; Checkpoint 4 |
| Focus-first Workspace reads, target-only detail hydration, loading, and source-aware navigation | Sections 3.5, 4.1, and 7; Checkpoint 5 |
| Commissioner CSV, Archived Tree JSON, and Public Pending/Received presentation | Sections 5 and 6; Checkpoint 5 |
| Cross-cutting CRUD/realtime acceptance and final verification | Section 10; Checkpoints 0 and 8 |
| Checkpoint ordering, parallelism, ownership, and exit criteria | Section 11 |

### 2026-08-02 behavioral verification

The CP3 audit concerns are now demonstrated user-visible defects, not theoretical architecture gaps:

- after a hard refresh, persisted labels lose their selected identity, can be added again, and deleting one old label can remove another; custom catalog labels can duplicate and revert to their defaults;
- a comment added on a slow connection can disappear because the client does not await the durable write;
- after Commissioner B commits `accepted`, Commissioner A can remain in the Rejected branch because `crmp.workspace.v1` overrides the newer server value.

The corrective contract and acceptance cases are indexed at `PLAN.md` Sections 3.3, 4.1, and 10 and Checkpoint 5. Default custom catalog labels are standardized as `Custom Label 1`, `Custom Label 2`, and `Custom Label 3`. CP0 continues to own WebSocket transport, while CP5 owns authoritative HTTP reconciliation and its mutation-specific event/outbox integration.

Workspace Summary is not a required CP2 or CP3 deliverable. Workspace tables and branches reuse CP5's geometry-free direct select, including exact-ID-first focused entry; the decision and workflow are indexed at `PLAN.md` Sections 3.1.1, 3.3, and 4.1. The optional three-workflow physical table split is P3 and is indexed at Section 2.4 and Checkpoint 1.
