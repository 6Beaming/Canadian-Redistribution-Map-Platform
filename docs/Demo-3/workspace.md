# Demo 3 Workspace and Archived Tree Frontend

## 1. Purpose

Workspace is the Commissioner review surface for comments, objections, and
Counter-Proposals. Archived Tree is the read-only historical surface for
submissions that have been merged into a durable version branch. Both features
reuse MapCanvas but do not expose public editing tools.

This document describes the frontend composition, behaviour, and current data
dependencies. Backend ownership and migration requirements are documented in
[workspace-backend.md](./workspace-backend.md).

## 2. Routes

| Route | Component | Behaviour |
| --- | --- | --- |
| `/dashboard/workspace` | `CommissionerWorkspace.jsx` | Expandable and filterable review tree. Supports `?focus=<submissionId>`. |
| `/dashboard/workspace/:submissionId` | `WorkspaceReview.jsx` | Focused read-only map review, labels, comments, details, and decisions. |
| `/dashboard/archivedTree` | `ArchivedTree.jsx` | Durable archived branch/version browser. |
| `/dashboard/archivedTree/:submissionId/difference` | `ArchivedDifference.jsx` | Read-only selected-versus-latest map comparison. |

All routes are behind the Commissioner route guard in `App.jsx`.

## 3. Workspace Tree

`CommissionerWorkspace.jsx` creates the decision tree from
`getWorkspaceSubmissions({ includeArchived: false })`.

### Category and status model

The tree has three categories:

1. Comments;
2. Objections; and
3. Counter-Proposals.

Each category is divided into Pending, Archive Request, Accepted, and Rejected.
The Pending display has distinct Pending Submissions and Archive Request leaves.
Each root/category/status node supports click-to-expand/collapse with CSS
transition animation. A focus query opens the matching branch rather than
expanding unrelated content.

The Filter control mirrors the same hierarchy as nested checkboxes. Applying a
filter changes the expansion state; it does not discard submission records.
Search is intentionally absent because the parent Commissioner submissions
table owns broad submission searching.

`src/styles/workspace.css` provides the tree structure, transition, responsive
layout, state colours, Status Key, and filter UI.

## 4. Review Page

`WorkspaceReview.jsx` loads three independent inputs:

```text
DA profile index              -> mapApi.getDaProfiles()
selected/sibling submissions  -> tempWorkspace
commissioner reviewer emails  -> GET /api/workspace/reviewers
```

The page passes the selected DGUIDs, exact focused geometry, and
`COUNTER_REVIEW` interaction mode to MapCanvas. This suppresses unrelated map
interactions. It keeps a stable `focusGeoJson` reference: switching a
Counter-Proposal between Proposed and Original changes the overlay geometry but
does not recreate MapLibre or refit the viewport.

`WorkspaceReviewPanel.jsx` provides:

- a full Reference ID submission selector for sibling review records;
- shared labels and a per-submission local label catalog;
- Commissioner comment selection and draft entry;
- DA pair details and Counter-Proposal impact display;
- status decision buttons, archive-request assignee selection, vote display,
  required commit messages, and merge readiness;
- a resolution header that can reveal the full ID.

The page uses the same exact pair rendering contract as the public workflows:
focused PMTiles are hidden by feature state and the exact GeoJSON layer owns
the selected boundary presentation.

## 5. Archived Tree and Difference UI

### 5.1 Tree browser

`ArchivedTree.jsx` reads durable records through
`getArchiveTreeRecords()` and passes them to `buildArchiveTree()` in
`src/lib/archiveTree.js`. The utility:

- normalizes feedback/comment, objection, and counter-proposal types;
- groups comments by DGUID and boundary submissions by sorted DA pair;
- chooses the persisted `isLatest` record when available;
- labels ordered versions as `v1`, `v2`, and so on; and
- filters branches by DGUID, community, title, comment, or ID.

`ArchivedTreeCanvas.jsx` draws the category roots, branches, and version nodes
on an HTML Canvas. It supports pointer pan, wheel zoom, plus/minus/reset
controls, branch expansion, selection, and map navigation. The right-side
`ArchivedTreePanel.jsx` displays the selected version and controls Difference,
Revert, and Delete Forever actions. Revert uses a short confirmation delay;
Delete requires the literal text `I confirm`.

### 5.2 Difference map

`ArchivedDifference.jsx` loads the selected archive record and its branch's
latest record, hydrates both geometry views, and renders one at a time on a
read-only MapCanvas. Its Latest Version / Selected Version toggle changes only
the archived overlay. It deliberately has no Workspace comment or decision
controls.

## 6. Archived Map on Dashboard

`src/lib/map/archivedMapEffect.js` lets the regular Commissioner Dashboard map
show latest archived branches without entering Archived Tree. It calls the
durable archive read, chooses latest branch records, and returns DGUIDs plus
optional exact proposed GeoJSON overrides. MapCanvas adds a green archived
boundary treatment and hides PMTiles for exact override DGUIDs.

The control is optional and Commissioner-only. It is an inspection view, not an
archive mutation surface.

## 7. Frontend Data Sources

| Data | Current source | UI consumers | Durability |
| --- | --- | --- | --- |
| Feedback and objection list | protected `GET /api/comments` | table, Workspace tree, Dashboard cards, heatmap | Supabase read |
| Objection review geometry | canonical map metadata, rebuilt by hydrator | Workspace and Difference map | current-baseline reconstruction |
| Counter-Proposal list/review geometry | `src/data/map/temp.json` and browser JSTS hydration | table, tree, cards, review map | fixture only |
| Reviewer emails | `GET /api/workspace/reviewers` | archive-request controls | Supabase read |
| Workspace labels/comments/archive votes | `crmp.workspace.v1` localStorage | review panel and tree refresh | local browser only |
| Archive records/version state | `GET /api/workspace/archive` | Archived Tree, Difference, Archived Map | Supabase read |

The `tempWorkspace.js` and `tempCounterProposal.js` names intentionally signal
that these are migration adapters. Their exported public methods now have
English comments declaring their persistence boundary and planned replacement.

## 8. File Dependency Graph

```text
CommissionerWorkspace
  -> tempWorkspace.getWorkspaceSubmissions
  -> commentsApi.getAllComments + tempCounterProposal fixture

WorkspaceReview
  -> tempWorkspace.getWorkspaceSubmission
  -> tempCounterProposal.hydrateWorkspaceSubmission
  -> MapCanvas + WorkspaceReviewPanel

ArchivedTree
  -> tempWorkspace.getArchiveTreeRecords
  -> GET /api/workspace/archive
  -> archiveTree -> ArchivedTreeCanvas / ArchivedTreePanel

ArchivedDifference
  -> archive records + hydrateWorkspaceSubmission
  -> MapCanvas

Dashboard archived mode
  -> archivedMapEffect.loadArchivedMapEffect
  -> archive records -> MapCanvas
```

## 9. Frontend Constraints and Next Steps

1. Workspace localStorage state is not shared, durable, or realtime. It must
   migrate to the existing Workspace tables and APIs.
2. Counter-Proposals cannot merge into Archived Tree because their source is a
   fixture. The UI throws a clear error rather than creating an incomplete
   archive record.
3. Objection geometry is reconstructed from current metadata. Persist a
   geometry snapshot and baseline version/hash on write for reproducible review.
4. Archived Counter-Proposal map playback needs stored proposed/original
   geometry, not fixture operation replay.
5. Tree reload is request-driven after archive actions. Add Realtime or a
   robust query-refresh mechanism for concurrent Commissioner sessions.
