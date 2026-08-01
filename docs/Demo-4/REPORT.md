# Demo 4 Checkpoint Audit and Plan Change Index

## 1. Checkpoint audit

Status is assessed against the current checkout and the acceptance criteria in `PLAN.md`.

| Checkpoint | Status | Result |
| --- | --- | --- |
| CP0 | Not accepted | No durable realtime delivery, authenticated WebSocket gateway, replay/resync, or complete CRUD matrix is present. |
| CP1 | Not accepted | The required migrations, access boundary, production-schema audit, and verification harness are not present. |
| CP2 | Partial | Submission flows and local map validation exist, but the frozen route/projection/capability contract, atomic persistence, and all-Enabled-FED coverage are incomplete. |
| CP3 | Partial | Some Commissioner Workspace endpoints exist, but the durable summary/full CRUD, projection-backed state, scope integration, and realtime work remain incomplete. |
| CP4 | Partial | Legacy archive and archive-request code exists, but the required immutable archive, UUID identity, reusable scope guard, and province-isolation contract are incomplete. |
| CP5 | Not started | The mock-to-HTTP projection adapter, cursor/cache refactor, public-status projection, and scoped exports are not implemented. |
| CP6 | Partial | Counter-Proposal editing and map UI exist, but the planned editing/presentation contract and acceptance coverage are incomplete. |
| CP7 | Not started | No versioned statistics pipeline/API and presentation contract are present. |
| CP8 | Not started | The release verification and documentation synchronization gate has not been completed. |

## 2. PLAN.md change index

This index records the plan clarifications and responsibility allocation adopted to date; the definitions themselves remain authoritative in `PLAN.md`.

| Topic | PLAN.md index |
| --- | --- |
| Realtime data model, event contract, delivery semantics | Sections 2.5, 3.6; Checkpoints 0 and 1 |
| CP1/CP2 parallel boundary and frozen route/database contract | Section 3.0; Checkpoints 1 and 2 |
| Submission projection shared by CP2 and CP5 | Section 3.1.1; Checkpoints 2 and 5 |
| Enabled-FED Counter-Proposal/Yukon incident diagnosis and remediation | Section 3.2.1; Checkpoints 1 and 2 |
| Workspace API and state ownership | Section 3.3; Checkpoint 3 |
| Archived Tree, Archive Request identity, and Commissioner scope guard | Sections 3.4, 3.4.1, and 3.4.2; Checkpoint 4 |
| Client service boundaries, cache behavior, exports, and public status | Sections 3.5, 4.1, 5, and 6; Checkpoint 5 |
| Cross-cutting CRUD/realtime acceptance and final verification | Section 10; Checkpoints 0 and 8 |
| Checkpoint ordering, parallelism, ownership, and exit criteria | Section 11 |
